//! The menu check a Mac release runs on a worker Mac before it publishes (tauri/mac-release/menu-check.ts): started
//! with `APP_KIT_MENU_CHECK=1`, the app chooses each item in its own menu bar, the kit's and its own, the way a click
//! reaches it, and logs each choice and whether the app still answers after it. The release's judge on the worker
//! (tauri/mac-release/menu-check-entry.ts) reads these lines, and the kit's own line for each kit item, and refuses to
//! publish a build that froze. Without the variable nothing here runs.
//!
//! Each choice is queued on macOS's main queue, as a click's action arrives, never from inside one of Tauri's own
//! callbacks: Quit chosen from inside `run_on_main_thread` froze even a healthy app, waiting on a lock Tauri holds
//! there, which no click ever does. The round trip through `run_on_main_thread` after each choice is what proves Tauri's
//! event loop still answers, since the item's menu event reaches the app through it. `performActionForItemAtIndex:`
//! does not validate the menu, so each submenu is updated first, and an item a person could not choose, greyed out or
//! hidden, is left alone. Submenus are walked to any depth, but for macOS's own (Services, Writing Tools, Speech).
//!
//! The line words are tauri/window/names.ts's, which test/tauri-window.test.ts holds these to.

use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Runtime};

use crate::menu_walk::{menu_at, skipped, walk_bar, Item};

/// The variable that starts the check, which only the release's run on a worker sets.
pub(crate) const MENU_CHECK_VARIABLE: &str = "APP_KIT_MENU_CHECK";
/// What every line of the check starts with.
const MENU_CHECK_LINE: &str = "menu check: ";
const STARTING: &str = "starting";
/// Followed by the items as a JSON list of their titles, in the order they are chosen, Quit last.
const HOLDS: &str = "the menu holds ";
const CHOOSING: &str = "choosing ";
const ANSWERED: &str = " answered";
/// Followed by the titles a person could not choose, greyed out or hidden, as a JSON list, which the check leaves alone.
const LEFT_ALONE: &str = "left alone, greyed out or hidden: ";
const STOPPED: &str = "the app stopped answering after ";
const STOPPED_END: &str = " was chosen";
/// The menu walked before any item was chosen, when the app did not answer even that.
const NEVER_ANSWERED: &str = "the app did not answer before any item was chosen";

/// How long after the plugin's setup the check starts: the window is up and its page loading by then.
const START_AFTER: Duration = Duration::from_secs(3);
/// How long the check waits for the update check the app makes at launch, while Check for Updates… is greyed out.
const UPDATE_CHECK_WITHIN: Duration = Duration::from_secs(15);
/// How long a choice, and the round trip after it, may take before the app counts as stuck.
const ANSWER_WITHIN: Duration = Duration::from_secs(10);
/// The pause between items, so an item's own work (a window opening, the page reloading) settles before the next.
const BETWEEN: Duration = Duration::from_millis(500);

/// Quit, as the kit's menu names it ("Quit <name>") and macOS's default does.
fn is_quit(title: &str) -> bool {
    title == "Quit" || title.starts_with("Quit ")
}

/// The items in the order they are chosen: those not skipped, in the menu bar's order, and Quit last, which ends the app.
fn in_order(items: Vec<Item>) -> Vec<Item> {
    let (quit, rest): (Vec<Item>, Vec<Item>) = items.into_iter().filter(|item| !skipped(&item.title)).partition(|item| is_quit(&item.title));
    rest.into_iter().chain(quit.into_iter().take(1)).collect()
}

/// An item as the lines name it: its title and its place, so two items with one title stay apart.
fn named(item: &Item, place: usize, total: usize) -> String {
    format!("{} ({place} of {total})", item.title)
}

fn holds_line(items: &[Item]) -> String {
    let titles: Vec<&str> = items.iter().map(|item| item.title.as_str()).collect();
    format!("{MENU_CHECK_LINE}{HOLDS}{}", serde_json::to_string(&titles).unwrap_or_default())
}

fn choosing_line(name: &str) -> String {
    format!("{MENU_CHECK_LINE}{CHOOSING}{name}")
}

fn answered_line(name: &str) -> String {
    format!("{MENU_CHECK_LINE}{name}{ANSWERED}")
}

fn stopped_line(name: &str) -> String {
    format!("{MENU_CHECK_LINE}{STOPPED}{name}{STOPPED_END}")
}

/// Starts the check when the app was started with `APP_KIT_MENU_CHECK=1`.
pub(crate) fn start_if_asked<R: Runtime>(app: &AppHandle<R>) {
    if std::env::var(MENU_CHECK_VARIABLE).as_deref() != Ok("1") {
        return;
    }
    log::info!("{MENU_CHECK_LINE}{STARTING}");
    let app = app.clone();
    std::thread::spawn(move || run(&app));
}

fn run<R: Runtime>(app: &AppHandle<R>) {
    std::thread::sleep(START_AFTER);
    // The app asks the releases as it starts, and its update item is greyed out until they answer, so the check waits
    // for that, or the item would be left out as one a person could not choose.
    let checking = crate::updates::update_item_text(crate::updates::UpdateItem::Checking).0;
    let waited_from = std::time::Instant::now();
    while waited_from.elapsed() < UPDATE_CHECK_WITHIN {
        let titles = on_main_queue(|| menu_items_with(false).into_iter().map(|item| item.title).collect::<Vec<_>>());
        if !titles.is_some_and(|titles| titles.contains(&checking)) {
            break;
        }
        std::thread::sleep(BETWEEN);
    }
    let Some(items) = on_main_queue(menu_items) else {
        log::error!("{MENU_CHECK_LINE}{NEVER_ANSWERED}");
        return;
    };
    let unchoosable: Vec<String> = on_main_queue(|| {
        let choosable = menu_items();
        menu_items_with(false).into_iter().filter(|item| !choosable.contains(item)).map(|item| item.title).collect()
    })
    .unwrap_or_default();
    if !unchoosable.is_empty() {
        log::info!("{MENU_CHECK_LINE}{LEFT_ALONE}{}", serde_json::to_string(&unchoosable).unwrap_or_default());
    }
    let items = in_order(items);
    log::info!("{}", holds_line(&items));
    let total = items.len();
    for (place, item) in items.iter().enumerate() {
        let name = named(item, place + 1, total);
        log::info!("{}", choosing_line(&name));
        let path = item.path.clone();
        if is_quit(&item.title) {
            // Quit ends the app before it can answer; the judge on the worker waits for it to end.
            on_main_queue_only(move || choose(&path));
            return;
        }
        if on_main_queue(move || choose(&path)).is_none() || !event_loop_answers(app) {
            log::error!("{}", stopped_line(&name));
            return;
        }
        log::info!("{}", answered_line(&name));
        std::thread::sleep(BETWEEN);
    }
}

/// Runs `work` on the main thread from macOS's main queue, as a click's action arrives, and waits for its answer.
fn on_main_queue<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    let (sent, answer) = mpsc::channel();
    dispatch2::DispatchQueue::main().exec_async(move || {
        let _ = sent.send(work());
    });
    answer.recv_timeout(ANSWER_WITHIN).ok()
}

/// Queues `work` on the main queue without waiting, for Quit, which never answers.
fn on_main_queue_only(work: impl FnOnce() + Send + 'static) {
    dispatch2::DispatchQueue::main().exec_async(work);
}

/// Whether a message through Tauri's event loop comes back, after the menu event the choice queued there.
fn event_loop_answers<R: Runtime>(app: &AppHandle<R>) -> bool {
    let (sent, answer) = mpsc::channel();
    if app.run_on_main_thread(move || {
        let _ = sent.send(());
    })
    .is_err()
    {
        return false;
    }
    answer.recv_timeout(ANSWER_WITHIN).is_ok()
}

/// Every item a person could choose, in every submenu but macOS's own (src/menu_walk.rs).
fn menu_items() -> Vec<Item> {
    menu_items_with(true)
}

/// The menu bar's items, only those a person could choose when `choosable`, every titled one otherwise.
fn menu_items_with(choosable: bool) -> Vec<Item> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSApplication;
    let Some(main_thread) = MainThreadMarker::new() else { return Vec::new() };
    let app = NSApplication::sharedApplication(main_thread);
    let Some(bar) = app.mainMenu() else { return Vec::new() };
    walk_bar(&bar, app.servicesMenu().as_deref(), choosable)
}

/// Chooses an item as a click does: its action goes to its target, or to the first responder for macOS's own.
fn choose(path: &[isize]) {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSApplication;
    let Some(main_thread) = MainThreadMarker::new() else { return };
    let Some(bar) = NSApplication::sharedApplication(main_thread).mainMenu() else { return };
    if let Some((menu, index)) = menu_at(bar, path) {
        menu.performActionForItemAtIndex(index);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(title: &str) -> Item {
        Item { path: vec![0, 0], title: title.into() }
    }

    #[test]
    fn macos_submenus_and_an_update_offering_to_install_are_left_alone_by_title() {
        for title in ["AutoFill", "Services", "Writing Tools", "Speech", "Update to 0.1.5", "Could Not Update to 0.1.5, Try Again"] {
            assert!(skipped(title), "{title}");
        }
        // macOS's Hide items are known by their action (tests/menu.rs), so an app's own Hide item is still chosen.
        for title in ["About Example", "Check for Updates…", "Example 0.1.4 Is Up to Date", "Settings…", "Sign Out", "Close Window", "Copy", "Reload", "Zoom In", "Minimize", "Hearing Listener", "Hide Sidebar"] {
            assert!(!skipped(title), "{title}");
        }
    }

    #[test]
    fn quit_is_chosen_last_and_once() {
        let items = vec![item("About Example"), item("Quit Example"), item("Settings…"), item("Copy"), item("Quit Example")];
        let titles: Vec<String> = in_order(items).into_iter().map(|item| item.title).collect();
        assert_eq!(titles, ["About Example", "Settings…", "Copy", "Quit Example"]);
        assert!(is_quit("Quit"));
        assert!(!is_quit("Quitting Time"));
    }

    #[test]
    fn the_lines_name_each_item_by_its_title_and_place() {
        let items = vec![item("Settings…"), item("Quit Example")];
        assert_eq!(holds_line(&items), r#"menu check: the menu holds ["Settings…","Quit Example"]"#);
        let name = named(&items[0], 1, 2);
        assert_eq!(choosing_line(&name), "menu check: choosing Settings… (1 of 2)");
        assert_eq!(answered_line(&name), "menu check: Settings… (1 of 2) answered");
        assert_eq!(stopped_line(&name), "menu check: the app stopped answering after Settings… (1 of 2) was chosen");
    }
}
