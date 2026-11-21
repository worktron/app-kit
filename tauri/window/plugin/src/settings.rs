//! The kit's own Settings window on the Mac, which Settings… (⌘,) opens for an app whose menu asks for it
//! (`AppMenu::settings_window`): a page bundled beside the start page (../start/settings.html), with one switch that
//! opens the app when the person logs in (login_item.rs).
//!
//! The switch's three commands are this plugin's, declared in build.rs, so Tauri's own permission check stands in front
//! of them: only this window, on a page bundled in the app, is granted them (`settings_capability`), and the main
//! window, the hosted site and any other window are refused. The grant is added the first time the window opens, so an
//! app that never opens it has none. The window stays on its page; a web link goes to the browser.

use crate::login_item::{self, Answer};
use crate::StartPage;
use std::sync::Mutex;
use tauri::ipc::CapabilityBuilder;
use tauri::{AppHandle, Manager, Runtime, Url, WebviewUrl, WebviewWindowBuilder};

/// The window's label, the only one granted the switch's commands (names.ts's `SETTINGS_WINDOW`).
pub const SETTINGS_WINDOW: &str = "app-kit-settings";
/// The page, beside the start page in the folder an app's frontendDist names.
pub(crate) const SETTINGS_PAGE: &str = "settings.html";
/// Where the window hands the page the app's name and colors before its own script runs (names.ts).
pub(crate) const SETTINGS_PAGE_SETTINGS: &str = "__APP_KIT_SETTINGS_PAGE__";
/// The capability's name, and the three permissions it grants, which build.rs makes from the commands' names.
const CAPABILITY: &str = "app-kit-window-settings";
pub(crate) const PERMISSIONS: [&str; 3] =
    ["app-kit-window:allow-open-at-login-status", "app-kit-window:allow-open-at-login-set", "app-kit-window:allow-open-login-items"];

/// The window's size, which holds the switch and one line under it.
const WIDTH: f64 = 460.0;
const HEIGHT: f64 = 150.0;

/// What the Settings window keeps: the start page's colors, once the app opens its window on it, and whether its
/// grant has been added, which is done once however often the window is closed and opened again.
#[derive(Default)]
pub(crate) struct SettingsState {
    colors: Mutex<Option<StartPage>>,
    granted: Mutex<bool>,
}

/// Keeps the start page's colors for the Settings window, called as the main window opens on the start page.
pub(crate) fn keep_colors<R: Runtime, M: Manager<R>>(manager: &M, page: &StartPage) {
    if let Some(state) = manager.try_state::<SettingsState>() {
        *state.colors.lock().unwrap() = Some(page.clone());
    }
}

/// The Settings window's grant: the switch's three commands, for this window alone, on a page bundled in the app.
/// No remote address is named, so no site, the app's own included, is granted them.
pub fn settings_capability() -> CapabilityBuilder {
    PERMISSIONS.iter().fold(CapabilityBuilder::new(CAPABILITY).local(true).window(SETTINGS_WINDOW), |capability, permission| {
        capability.permission(*permission)
    })
}

/// The script that hands the page the app's name and, when the app opens on the start page, its colors. Each value is
/// JSON, so no name can end the string it is in.
pub(crate) fn page_script(name: &str, colors: Option<&StartPage>) -> String {
    let mut settings = serde_json::json!({ "name": name });
    if let Some(colors) = colors {
        settings["background"] = crate::css(colors.background).into();
        settings["text"] = crate::css(colors.text).into();
    }
    format!("window.{SETTINGS_PAGE_SETTINGS} = {settings};")
}

/// Whether the Settings window keeps an address: only a page bundled in the app, which Tauri serves at
/// tauri://localhost, or http(s)://tauri.localhost on the platforms where it cannot use its own scheme.
pub(crate) fn bundled(url: &Url) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => url.host_str() == Some("tauri.localhost"),
        _ => false,
    }
}

/// Whether the app's bundle holds the settings page itself. Tauri's own lookup answers a missing page with the bundle's
/// index.html, so it would pass for an app whose frontendDist is a folder of its own; the bundle's list of files does
/// not. A debug build with a devUrl bundles nothing, so Settings opens there only in a build without one.
fn bundles_settings_page<R: Runtime>(app: &AppHandle<R>) -> bool {
    let page = format!("/{SETTINGS_PAGE}");
    app.asset_resolver().iter().any(|(key, _)| key == page)
}

/// Opens the Settings window once Tauri has finished handing out the event it was chosen in. Tauri calls each plugin's
/// event handler while it holds its list of plugins, and building a window takes that list again, so a window built
/// inside the handler waits on itself and the app freezes for good, as Settings… did in 0.71.0. A task sent to the
/// event loop from another thread runs after the handler returns; sent from the main thread, Tauri runs it at once,
/// still inside the handler, so it is sent from a thread of its own.
pub(crate) fn open_after_event<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || {
        let opener = app.clone();
        if let Err(error) = app.run_on_main_thread(move || open(&opener)) {
            log::warn!("Settings chosen from the menu, but its window could not be sent to the main thread to open: {error}");
        }
    });
}

/// Opens the Settings window, or brings it forward when it is open already. An app whose frontendDist is not the kit's
/// start folder has no settings page, and is told so in the log rather than shown a window with nothing in it.
pub(crate) fn open<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.show();
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW) {
        log::info!("Settings chosen from the menu with the window open, bringing it forward");
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    if !bundles_settings_page(app) {
        log::warn!(
            "Settings chosen from the menu, but the app bundles no {SETTINGS_PAGE}: its tauri.conf.json frontendDist must \
             be the kit's start folder (README.md, A window onto the hosted site)"
        );
        return;
    }
    let Some(state) = app.try_state::<SettingsState>() else { return };
    {
        let mut granted = state.granted.lock().unwrap();
        if !*granted {
            if let Err(error) = app.add_capability(settings_capability()) {
                log::warn!("Settings chosen from the menu, but its grant could not be added, so it stays closed: {error}");
                return;
            }
            *granted = true;
        }
    }
    let colors = state.colors.lock().unwrap().clone();
    let mut builder = WebviewWindowBuilder::new(app, SETTINGS_WINDOW, WebviewUrl::App(SETTINGS_PAGE.into()))
        .title("Settings")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .center()
        .initialization_script(page_script(&app.package_info().name, colors.as_ref()));
    if let Some(colors) = &colors {
        builder = builder.background_color(colors.background);
    }
    match builder.build() {
        Ok(window) => {
            let _ = window.set_focus();
            log::info!("Settings opened");
        }
        Err(error) => log::warn!("Settings chosen from the menu, but its window could not open: {error}"),
    }
}

/// The login item's state as macOS reports it.
#[tauri::command]
pub(crate) fn open_at_login_status() -> Answer {
    login_item::read()
}

/// Turns the login item on or off; the answer is the state macOS reports after it.
#[tauri::command]
pub(crate) fn open_at_login_set(on: bool) -> Answer {
    login_item::set(on)
}

/// Opens System Settings at Login Items.
#[tauri::command]
pub(crate) fn open_login_items() {
    login_item::open_login_items();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{plugin_authority, Bundled, OWN_FOLDER, START_FOLDER};
    use tauri::window::Color;

    #[test]
    fn the_settings_grant_is_local_to_the_settings_window_and_names_three_permissions() {
        use tauri::ipc::RuntimeCapability;
        use tauri::utils::acl::capability::CapabilityFile;
        let CapabilityFile::Capability(capability) = settings_capability().build() else { panic!("one capability") };
        assert!(capability.local);
        assert!(capability.remote.is_none(), "no site is granted the switch");
        assert_eq!(capability.windows, vec![SETTINGS_WINDOW.to_string()]);
        assert!(capability.webviews.is_empty());
        let permissions: Vec<&str> = capability.permissions.iter().map(|entry| entry.identifier().get()).collect();
        assert_eq!(permissions, PERMISSIONS);
    }

    #[test]
    fn the_page_is_handed_the_name_and_the_start_pages_colors_when_there_are_any() {
        let colors = StartPage::new(Color(10, 14, 31, 255), Color(224, 226, 235, 255));
        assert_eq!(
            page_script("Example", Some(&colors)),
            r##"window.__APP_KIT_SETTINGS_PAGE__ = {"background":"#0a0e1f","name":"Example","text":"#e0e2eb"};"##
        );
        assert_eq!(page_script("Example \"App\"", None), r#"window.__APP_KIT_SETTINGS_PAGE__ = {"name":"Example \"App\""};"#);
    }

    #[test]
    fn the_settings_window_keeps_only_bundled_pages() {
        for kept in ["tauri://localhost/settings.html", "http://tauri.localhost/settings.html", "https://tauri.localhost/"] {
            assert!(bundled(&kept.parse().unwrap()), "{kept}");
        }
        for sent in ["https://app.example.com/", "tauri://evil/settings.html", "file:///etc/hosts", "about:blank", "http://localhost:1420/"] {
            assert!(!bundled(&sent.parse().unwrap()), "{sent}");
        }
    }

    // The hosted site, the main window and any other window are refused by Tauri itself; only the Settings window, on
    // a page bundled in the app, may read or change the login item.
    #[test]
    fn only_the_settings_window_may_change_open_at_login() {
        use tauri::ipc::Origin;
        let mut authority = plugin_authority();
        authority.add_capability(settings_capability()).unwrap();
        let site = Origin::Remote { url: "https://app.example.com/".parse().unwrap() };
        for command in ["open_at_login_status", "open_at_login_set", "open_login_items"] {
            let command = format!("plugin:app-kit-window|{command}");
            assert!(authority.resolve_access(&command, SETTINGS_WINDOW, SETTINGS_WINDOW, &Origin::Local).is_some(), "{command}");
            assert!(authority.resolve_access(&command, SETTINGS_WINDOW, SETTINGS_WINDOW, &site).is_none(), "{command} from a site");
            assert!(authority.resolve_access(&command, crate::MAIN, crate::MAIN, &site).is_none(), "{command} from the main window's site");
            assert!(authority.resolve_access(&command, crate::MAIN, crate::MAIN, &Origin::Local).is_none(), "{command} from the start page");
            assert!(authority.resolve_access(&command, "other", "other", &Origin::Local).is_none(), "{command} from another window");
        }
        // Nothing an app takes by default grants them.
        let mut by_default = plugin_authority();
        let default = CapabilityBuilder::new("default").local(true).window("*").permission("app-kit-window:default");
        by_default.add_capability(default).unwrap();
        assert!(by_default
            .resolve_access("plugin:app-kit-window|open_at_login_set", crate::MAIN, crate::MAIN, &Origin::Local)
            .is_none());
    }

    fn app(assets: impl tauri::Assets<tauri::test::MockRuntime>) -> tauri::App<tauri::test::MockRuntime> {
        let mut context = tauri::test::mock_context(assets);
        *context.runtime_authority_mut() = plugin_authority();
        let site = crate::Site::new("https://app.example.com".parse().unwrap());
        tauri::test::mock_builder().plugin(tauri_plugin_opener::init()).plugin(site.plugin()).build(context).unwrap()
    }

    #[test]
    fn the_settings_window_opens_once_and_its_grant_is_added_with_it() {
        let app = app(START_FOLDER);
        let handle = app.handle();
        assert!(handle.get_webview_window(SETTINGS_WINDOW).is_none());
        open(handle);
        let window = handle.get_webview_window(SETTINGS_WINDOW).expect("Settings opened");
        assert_eq!(window.url().unwrap().as_str(), "tauri://localhost/settings.html");
        assert!(*handle.state::<SettingsState>().granted.lock().unwrap());
        // Chosen again with it open: the same window is brought forward, no second one.
        open(handle);
        assert_eq!(handle.webview_windows().keys().filter(|label| *label == SETTINGS_WINDOW).count(), 1);
        assert!(*handle.state::<SettingsState>().granted.lock().unwrap());
    }

    #[test]
    fn the_settings_window_takes_the_colors_the_main_window_opened_the_start_page_in() {
        let app = app(START_FOLDER);
        assert!(app.state::<SettingsState>().colors.lock().unwrap().is_none());
        let site = crate::Site::new("https://app.example.com".parse().unwrap());
        site.start_page_window(&app, StartPage::new(Color(10, 14, 31, 255), Color(224, 226, 235, 255))).build().unwrap();
        let kept = app.state::<SettingsState>().colors.lock().unwrap().clone().expect("the start page's colors");
        assert_eq!((crate::css(kept.background), crate::css(kept.text)), ("#0a0e1f".to_string(), "#e0e2eb".to_string()));
    }

    #[test]
    fn an_app_that_bundles_no_settings_page_opens_no_window_and_adds_no_grant() {
        // An empty bundle, and one with an index.html of the app's own, which Tauri's lookup would hand out in its place.
        for app in [app(Bundled(&[])), app(OWN_FOLDER)] {
            open(app.handle());
            assert!(app.handle().get_webview_window(SETTINGS_WINDOW).is_none());
            assert!(!*app.handle().state::<SettingsState>().granted.lock().unwrap());
        }
    }

    #[test]
    fn the_page_reads_its_settings_where_the_window_puts_them() {
        let page = include_str!("../../start/settings.html");
        assert!(page.contains(&format!("window.{SETTINGS_PAGE_SETTINGS}")), "the page reads window.{SETTINGS_PAGE_SETTINGS}");
    }
}
