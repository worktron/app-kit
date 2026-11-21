//! The menu bar as the menu check walks it (src/menu_check.rs): every item a person could choose, in every submenu,
//! but those that act on other apps, open macOS's own panels, or would install an update. It holds nothing of Tauri, so
//! tests/menu.rs includes this file by its path and walks a menu bar it builds itself, on the main thread a harness
//! test never runs on.

use objc2::rc::Retained;
use objc2_app_kit::{NSMenu, NSMenuItem};

/// An item of the menu bar: its place in each menu down from the bar, and its title.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Item {
    pub(crate) path: Vec<isize>,
    pub(crate) title: String,
}

/// The actions of macOS's own items, known by what they do rather than their titles, so an app's own "Hide Sidebar"
/// is still chosen: Hide, Hide Others and Show All act on the worker's other apps, and Start Dictation and Emoji &
/// Symbols open macOS's panels or ask for the microphone.
const MACOS_ACTIONS: [&str; 5] = ["hide:", "hideOtherApplications:", "unhideAllApplications:", "startDictation:", "orderFrontCharacterPalette:"];

/// Items and submenus left alone by title: macOS's AutoFill and its own submenus, Services, whose items hand the
/// selection to other apps, Writing Tools, and Speech, which reads aloud on the worker; and the update item once it
/// offers a release (Update to, Could Not Update to), which would install over the copy being checked. A release is
/// always newer than the last one published, so its own check finds none.
pub(crate) fn skipped(title: &str) -> bool {
    title == "AutoFill"
        || title == "Services"
        || title == "Writing Tools"
        || title == "Speech"
        || title.starts_with("Update to ")
        || title.starts_with("Could Not Update to ")
}

fn macos_action(item: &NSMenuItem) -> bool {
    item.action().is_some_and(|action| MACOS_ACTIONS.iter().any(|name| action.name().to_bytes() == name.as_bytes()))
}

/// The bar's items, after each submenu is updated so what is greyed out is current: only those a person could choose
/// when `choosable`, every titled one otherwise. Separators, macOS's own items and the Services menu are never listed.
pub(crate) fn walk_bar(bar: &NSMenu, services: Option<&NSMenu>, choosable: bool) -> Vec<Item> {
    let mut items = Vec::new();
    for menu in 0..bar.numberOfItems() {
        let Some(submenu) = bar.itemAtIndex(menu).and_then(|top| top.submenu()) else { continue };
        walk(&submenu, vec![menu], services, choosable, &mut items);
    }
    items
}

fn walk(menu: &NSMenu, path: Vec<isize>, services: Option<&NSMenu>, choosable: bool, items: &mut Vec<Item>) {
    menu.update();
    for index in 0..menu.numberOfItems() {
        let Some(item) = menu.itemAtIndex(index) else { continue };
        if item.isSeparatorItem() || macos_action(&item) || (choosable && (!item.isEnabled() || item.isHidden())) {
            continue;
        }
        let title = item.title().to_string();
        let mut place = path.clone();
        place.push(index);
        match item.submenu() {
            Some(submenu) => {
                let is_services = services.is_some_and(|services| std::ptr::eq(services, &*submenu));
                if !is_services && !skipped(&title) {
                    walk(&submenu, place, services, choosable, items);
                }
            }
            None => items.push(Item { path: place, title }),
        }
    }
}

/// The submenu a path leads to from the bar, with the item's place in it last.
pub(crate) fn menu_at(bar: Retained<NSMenu>, path: &[isize]) -> Option<(Retained<NSMenu>, isize)> {
    let (last, down) = path.split_last()?;
    let mut menu = bar;
    for index in down {
        menu = menu.itemAtIndex(*index)?.submenu()?;
    }
    Some((menu, *last))
}
