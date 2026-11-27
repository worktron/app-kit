//! Windows: one copy of the app, and desktop sign-in's link from the browser.
//!
//! Windows sends a running app no open event for its link. It starts a second copy of the app with the link as its only
//! argument. Tauri's single-instance plugin, registered before every other plugin, has that copy hand its arguments to
//! the first and quit before anything else of it starts; with its `deep-link` feature the first copy's deep-link plugin
//! reads the link from them and emits it, which `listen` takes through the same `sign_in_link` and `hand_over` the
//! Mac's open event goes through. A copy started by the link with no copy running reads it from its own arguments, which
//! the deep-link plugin keeps as its current link, at `RunEvent::Ready`.
//!
//! Only the installer registers the scheme, from tauri.conf.json's `plugins.deep-link.desktop.schemes`; nothing here
//! calls `register_all`, so a development build never takes the link from the installed app.
//!
//! The Mac's deep-link plugin emits the same event on its open event, so this is wired in on Windows only; the tests
//! run it on the Mac too, through Tauri's test runtime.

// Off Windows this is built only for its tests, which leave the single-instance callback's step unused.
#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

use crate::{opened, Site, MAIN};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_deep_link::DeepLinkExt;

/// What the marker plugin that `single_instance` registers keeps, so the window plugin knows it came first.
struct RegisteredFirst;

pub(crate) const NOT_FIRST: &str = "app-kit's window on Windows needs one copy of the app: register \
    tauri_plugin_app_kit_window::single_instance first, before every other plugin (README.md, A window onto the hosted site)";

pub(crate) const MISSING_DEEP_LINK: &str = "app-kit's window on Windows takes desktop sign-in's link through the \
    deep-link plugin: register tauri_plugin_deep_link::init() before tauri_plugin_app_kit_window, or leave out \
    Site::scheme (README.md, A window onto the hosted site)";

/// Registers Tauri's single-instance plugin, first, as Windows needs: a second copy of the app, as a sign-in link from
/// the browser starts, hands its arguments to the running one and quits, and the running window comes forward. The app
/// calls it on its builder before any other plugin; the window plugin stops the app at launch if it did not.
#[cfg(target_os = "windows")]
pub fn single_instance<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // The arguments can hold a sign-in ticket, so they are not logged.
            log::info!("another copy of the app was started, so it handed over and quit, and this window comes forward");
            bring_forward(app);
        }))
        .plugin(registered_first())
}

/// The plugin after single-instance that marks it registered first: a plugin of the app's started before it means the
/// second copy of the app starts that plugin before it quits, so the app stops at launch saying so.
fn registered_first<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("app-kit-window-first")
        .setup(|app, _api| {
            let earlier = app.try_state::<tauri_plugin_opener::Opener<R>>().is_some()
                || app.try_state::<tauri_plugin_deep_link::DeepLink<R>>().is_some();
            if earlier {
                return Err(NOT_FIRST.into());
            }
            app.manage(RegisteredFirst);
            Ok(())
        })
        .build()
}

/// What the window plugin's setup asks on Windows: single-instance registered first, and the deep-link plugin before
/// the window plugin when the app takes sign-in.
pub(crate) fn check_order<R: Runtime>(app: &AppHandle<R>, site: &Site) -> Result<(), &'static str> {
    if app.try_state::<RegisteredFirst>().is_none() {
        return Err(NOT_FIRST);
    }
    if site.scheme.is_some() && app.try_state::<tauri_plugin_deep_link::DeepLink<R>>().is_none() {
        return Err(MISSING_DEEP_LINK);
    }
    Ok(())
}

/// Takes each link the deep-link plugin hands on, as a second copy of the app passes it.
pub(crate) fn listen<R: Runtime>(app: &AppHandle<R>, site: &Site) {
    if site.scheme.is_none() {
        return;
    }
    let handle = app.clone();
    let site = site.clone();
    app.deep_link().on_open_url(move |event| opened(&handle, &site, &event.urls()));
}

/// Takes the link this copy of the app was started with, when the browser's link started it with none running.
pub(crate) fn launched_with_link<R: Runtime>(app: &AppHandle<R>, site: &Site) {
    if site.scheme.is_none() {
        return;
    }
    if let Some(urls) = app.try_state::<tauri_plugin_deep_link::DeepLink<R>>().and_then(|link| link.get_current().ok().flatten()) {
        opened(app, site, &urls);
    }
}

/// Brings the window to the front, out of the taskbar if it was minimized.
pub(crate) fn bring_forward<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::StartPage;
    use tauri::window::Color;
    use tauri::Emitter;

    fn site() -> Site {
        Site::new("https://app.example.com".parse().unwrap()).scheme("com.example.app")
    }

    const LINK: &str = "com.example.app://sign-in?ticket=abc.def_1&nonce=0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";

    /// An app as an app's shell builds it on Windows, short of single-instance itself, which quits a second copy and so
    /// is not run here: the marker it registers, then the deep-link plugin, the opener and the window plugin.
    fn app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .plugin(registered_first())
            .plugin(tauri_plugin_deep_link::init())
            .plugin(tauri_plugin_opener::init())
            .plugin(site().plugin())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap()
    }

    fn start_page() -> StartPage {
        StartPage::new(Color(10, 14, 31, 255), Color(224, 226, 235, 255))
    }

    /// Hands `link` on as the deep-link plugin does with a second copy's arguments.
    fn hand_on(app: &tauri::App<tauri::test::MockRuntime>, link: &str) {
        app.emit("deep-link://new-url", vec![link]).unwrap();
    }

    fn kept(app: &tauri::App<tauri::test::MockRuntime>) -> bool {
        app.state::<crate::KeptSignIn>().0.lock().unwrap().is_some()
    }

    // The second copy's link reaches the window on the start page, which keeps the sign-in for the site's page, as
    // the Mac's open event does at launch: the start page goes on to the site by itself.
    #[test]
    fn a_link_a_second_copy_hands_over_is_kept_for_the_sites_page() {
        let app = app();
        let window = site().start_page_window(&app, start_page()).build().unwrap();
        listen(app.handle(), &site());
        hand_on(&app, LINK);
        assert!(kept(&app));
        assert_eq!(window.url().unwrap().as_str(), "tauri://localhost");
    }

    #[test]
    fn a_link_that_is_not_a_sign_in_it_can_take_leaves_the_window_where_it_is() {
        let app = app();
        let window = site().start_page_window(&app, start_page()).build().unwrap();
        listen(app.handle(), &site());
        hand_on(&app, "com.example.app://sign-in?ticket=%3Cscript%3E&nonce=0f1e");
        hand_on(&app, "com.other.app://sign-in?ticket=abc&nonce=0f1e");
        assert!(!kept(&app));
        assert_eq!(window.url().unwrap().as_str(), "tauri://localhost");
    }

    #[test]
    fn an_app_with_no_scheme_takes_no_link() {
        let app = app();
        let window = site().start_page_window(&app, start_page()).build().unwrap();
        let no_scheme = Site::new("https://app.example.com".parse().unwrap());
        listen(app.handle(), &no_scheme);
        hand_on(&app, LINK);
        launched_with_link(app.handle(), &no_scheme);
        assert_eq!(window.url().unwrap().as_str(), "tauri://localhost");
    }

    // A copy started with no link, as from the Start menu, has no current link and stays on the start page.
    #[test]
    fn a_copy_started_with_no_link_stays_on_the_start_page() {
        let app = app();
        let window = site().start_page_window(&app, start_page()).build().unwrap();
        launched_with_link(app.handle(), &site());
        bring_forward(app.handle());
        assert_eq!(window.url().unwrap().as_str(), "tauri://localhost");
    }

    // A second copy of the app runs every plugin registered before single-instance before it quits, so the marker
    // refuses to start after the plugins an app's shell registers.
    #[test]
    fn single_instance_registered_after_another_plugin_stops_the_app_at_launch() {
        for late in [
            tauri::test::mock_builder().plugin(tauri_plugin_opener::init()).plugin(registered_first()),
            tauri::test::mock_builder().plugin(tauri_plugin_deep_link::init()).plugin(registered_first()),
        ] {
            let Err(error) = late.build(tauri::test::mock_context(tauri::test::noop_assets())) else {
                panic!("the app started with single-instance registered late");
            };
            assert!(error.to_string().contains("register tauri_plugin_app_kit_window::single_instance first"), "{error}");
        }
    }

    #[test]
    fn the_window_plugin_asks_for_single_instance_first_and_the_deep_link_plugin_for_sign_in() {
        let build = |builder: tauri::Builder<tauri::test::MockRuntime>| {
            builder.build(tauri::test::mock_context(tauri::test::noop_assets())).unwrap()
        };
        let none = build(tauri::test::mock_builder());
        assert_eq!(check_order(none.handle(), &site()), Err(NOT_FIRST));
        let no_deep_link = build(tauri::test::mock_builder().plugin(registered_first()));
        assert_eq!(check_order(no_deep_link.handle(), &site()), Err(MISSING_DEEP_LINK));
        assert_eq!(check_order(no_deep_link.handle(), &Site::new("https://app.example.com".parse().unwrap())), Ok(()));
        assert_eq!(check_order(app().handle(), &site()), Ok(()));
    }
}
