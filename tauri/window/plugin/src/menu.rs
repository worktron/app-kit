//! The Mac menu bar every window app on the kit shows, as practices' desktop app rule lists it: the app's menu with
//! About, Check for Updates… when the app updates itself (updates.rs), Settings… (⌘,) and Sign Out when the app has
//! them, Services, Hide and Quit; File's Close Window (⌘W); the Edit
//! menu, without which a text field loses ⌘C and ⌘V; View's zoom, Reload (⌘R) and full screen; and Window's Minimize
//! (⌘M), Zoom and Bring All to Front, where macOS lists the open windows. Close Window, Minimize and the rest of macOS's
//! own items are macOS's, with its shortcuts and its handling. The window carries out Reload and the zoom; Settings
//! and Sign Out are the page's, which the window brings forward and tells (`MENU_EVENT`), unless the app asks for the
//! kit's own Settings window (`settings_window`, settings.rs), which the plugin opens.
//! The page's names are tauri/window/names.ts's, and test/tauri-window.test.ts holds them to it.

use tauri::menu::{AboutMetadata, Menu, MenuBuilder, MenuItem, MenuItemBuilder, SubmenuBuilder, WINDOW_SUBMENU_ID};
use tauri::{AppHandle, Manager, Runtime};

/// The window event that hands the page a menu item it carries out, with the item's name as its detail.
const MENU_EVENT: &str = "app-kit-menu";
/// The names of the items the page carries out, as the event's detail.
const SETTINGS: &str = "settings";
const SIGN_OUT: &str = "sign-out";

const SETTINGS_ITEM: &str = "app-kit-settings";
/// Settings… when it opens the kit's own Settings window rather than going to the page.
pub(crate) const SETTINGS_WINDOW_ITEM: &str = "app-kit-settings-window";
const SIGN_OUT_ITEM: &str = "app-kit-sign-out";
pub(crate) const RELOAD_ITEM: &str = "app-kit-reload";

/// The ids of the File and View menus, where an app adds items of its own: `menu.get(FILE_MENU)`, then the
/// submenu's `insert`, `prepend` or `append`.
pub const FILE_MENU: &str = "app-kit-file";
pub const VIEW_MENU: &str = "app-kit-view";

/// The menu bar, built by `build` for `tauri::Builder::menu`. The app names what it has beyond what every app has.
#[derive(Clone, Debug, Default)]
pub struct AppMenu {
    settings: Settings,
    sign_out: bool,
    commit: Option<String>,
}

/// What Settings… does, if the app has it: hand it to the page, or open the kit's own Settings window.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum Settings {
    #[default]
    None,
    Page,
    Window,
}

impl AppMenu {
    pub fn new() -> Self {
        Self::default()
    }

    /// Settings… (⌘,), which the page opens.
    pub fn settings(mut self) -> Self {
        self.settings = Settings::Page;
        self
    }

    /// Settings… (⌘,), which opens the kit's own Settings window, with a switch that opens the app when the person logs
    /// in. The window is a page bundled beside the start page, so the app's frontendDist is the kit's start folder.
    /// Called after `settings`, it takes that one's place, and the other way round.
    pub fn settings_window(mut self) -> Self {
        self.settings = Settings::Window;
        self
    }

    /// Sign Out, which the page carries out, for an app that signs in.
    pub fn sign_out(mut self) -> Self {
        self.sign_out = true;
        self
    }

    /// The commit the build was made from, which About shows after the version, as "Version 1.4.0 (3f2a9c1)".
    pub fn commit(mut self, commit: impl Into<String>) -> Self {
        self.commit = Some(commit.into());
        self
    }

    /// What About shows: the app's name, its version, and the commit, which macOS writes in brackets after it.
    fn about(&self, info: &tauri::PackageInfo, copyright: Option<String>) -> AboutMetadata<'static> {
        AboutMetadata {
            name: Some(info.name.clone()),
            version: Some(info.version.to_string()),
            short_version: self.commit.clone(),
            copyright,
            ..Default::default()
        }
    }

    /// Settings…'s id: the page's, the kit's window's, or none.
    fn settings_item(&self) -> Option<&'static str> {
        match self.settings {
            Settings::None => None,
            Settings::Page => Some(SETTINGS_ITEM),
            Settings::Window => Some(SETTINGS_WINDOW_ITEM),
        }
    }

    pub fn build<R: Runtime>(&self, app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
        let info = app.package_info();
        let about = self.about(info, app.config().bundle.copyright.clone());
        // macOS would name About, Hide and Quit after the program's file; the app's own name is the one it shows.
        let name = &info.name;
        let mut first = SubmenuBuilder::new(app, name).about_with_text(format!("About {name}"), Some(about));
        if crate::updates::configured(app.config()) {
            first = first.item(&update_item(app)?);
        }
        first = first.separator();
        if let Some(id) = self.settings_item() {
            first = first.item(&MenuItemBuilder::with_id(id, "Settings…").accelerator("CmdOrCtrl+,").build(app)?).separator();
        }
        first = first.services().separator().hide_with_text(format!("Hide {name}")).hide_others().show_all().separator();
        if self.sign_out {
            first = first.item(&MenuItemBuilder::with_id(SIGN_OUT_ITEM, "Sign Out").build(app)?).separator();
        }
        let first = first.quit_with_text(format!("Quit {name}")).build()?;
        let file = SubmenuBuilder::with_id(app, FILE_MENU, "File").close_window().build()?;
        let edit = SubmenuBuilder::new(app, "Edit").undo().redo().separator().cut().copy().paste().select_all().build()?;
        let zoom = crate::zoom_items(app)?;
        let view = SubmenuBuilder::with_id(app, VIEW_MENU, "View")
            .items(&zoom.each_ref().map(|item| item as &dyn tauri::menu::IsMenuItem<R>))
            .separator()
            .item(&MenuItemBuilder::with_id(RELOAD_ITEM, "Reload").accelerator("CmdOrCtrl+R").build(app)?)
            .separator()
            .fullscreen_with_text("Enter Full Screen")
            .build()?;
        // Under Tauri's id, macOS lists the app's windows in it.
        let window = SubmenuBuilder::with_id(app, WINDOW_SUBMENU_ID, "Window")
            .minimize()
            .maximize_with_text("Zoom")
            .separator()
            .bring_all_to_front()
            .build()?;
        MenuBuilder::new(app).items(&[&first, &file, &edit, &view, &window]).build()
    }
}

/// Check for Updates…, for an app that builds its own menu instead of `AppMenu`, which adds it after About when the
/// app's tauri.conf.json has plugins.updater. The plugin carries it out, and its words follow the update: checking, up
/// to date, Update to the version found, installing, or failed.
pub fn update_item<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<MenuItem<R>> {
    use crate::updates::{keep_menu_item, update_item_text, UpdateItem, UPDATE_ITEM};
    let (text, enabled) = update_item_text(UpdateItem::Check);
    let item = MenuItemBuilder::with_id(UPDATE_ITEM, text).enabled(enabled).build(app)?;
    keep_menu_item(app, item.clone());
    Ok(item)
}

/// The page's name for a menu item it carries out, or None for an item that is not the page's.
pub(crate) fn page_command(id: &str) -> Option<&'static str> {
    match id {
        SETTINGS_ITEM => Some(SETTINGS),
        SIGN_OUT_ITEM => Some(SIGN_OUT),
        _ => None,
    }
}

/// The script that hands the page `command`.
pub(crate) fn page_script(command: &str) -> String {
    format!("window.dispatchEvent(new CustomEvent({MENU_EVENT:?}, {{ detail: {command:?} }}));")
}

/// Carries out the window's own menu items: Reload, the kit's Settings window, and Settings and Sign Out handed to the
/// page, with the window brought forward, since either can be chosen with it closed. The zoom is `change_zoom`'s.
pub(crate) fn menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if id == SETTINGS_WINDOW_ITEM {
        log::info!("Settings chosen from the menu, opening the kit's Settings window");
        crate::settings::open(app);
        return;
    }
    let Some(window) = app.get_webview_window(crate::MAIN) else { return };
    if id == RELOAD_ITEM {
        log::info!("Reload chosen, reloading the page");
        let _ = window.reload();
    } else if let Some(command) = page_command(id) {
        log::info!("{command} chosen from the menu, bringing the window forward and handing it to the page");
        crate::show(app);
        let _ = window.eval(page_script(command));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn about_shows_the_version_and_the_commit_the_build_was_made_from() {
        let info = tauri::PackageInfo {
            name: "Example".into(),
            version: "1.4.0".parse().unwrap(),
            authors: "",
            description: "",
            crate_name: "example",
        };
        let about = AppMenu::new().commit("3f2a9c1").about(&info, None);
        assert_eq!(about.name.as_deref(), Some("Example"));
        assert_eq!(about.version.as_deref(), Some("1.4.0"));
        assert_eq!(about.short_version.as_deref(), Some("3f2a9c1"));
        assert_eq!(AppMenu::new().about(&info, None).short_version, None);
    }

    #[test]
    fn the_settings_window_item_opens_the_kits_window_and_settings_still_goes_to_the_page() {
        assert_eq!(AppMenu::new().settings_item(), None);
        assert_eq!(AppMenu::new().settings().settings_item(), Some(SETTINGS_ITEM));
        assert_eq!(AppMenu::new().settings_window().settings_item(), Some(SETTINGS_WINDOW_ITEM));
        // The later call wins, so an app never has two Settings… items.
        assert_eq!(AppMenu::new().settings().settings_window().settings_item(), Some(SETTINGS_WINDOW_ITEM));
        assert_eq!(AppMenu::new().settings_window().settings().settings_item(), Some(SETTINGS_ITEM));
        // The kit's window is the plugin's to open, never handed to the page.
        assert_eq!(page_command(SETTINGS_WINDOW_ITEM), None);
    }

    #[test]
    fn settings_and_sign_out_go_to_the_page_and_nothing_else_does() {
        assert_eq!(page_command(SETTINGS_ITEM), Some("settings"));
        assert_eq!(page_command(SIGN_OUT_ITEM), Some("sign-out"));
        assert_eq!(page_command(RELOAD_ITEM), None);
        assert_eq!(page_command(crate::mac::ZOOM_IN), None);
        assert_eq!(
            page_script("sign-out"),
            r#"window.dispatchEvent(new CustomEvent("app-kit-menu", { detail: "sign-out" }));"#
        );
    }
}
