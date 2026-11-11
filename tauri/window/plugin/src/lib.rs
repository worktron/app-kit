//! A Tauri window onto an app's hosted site, for the Mac and the iPhone: what every such app's shell wrote by hand.
//!
//! The window loads the app's own site, so sign-in, data and every deploy are the site's. This plugin adds:
//! - desktop sign-in's shell half: the browser's `<scheme>://sign-in` link handed to the page (app-kit/tauri/sign-in);
//! - links: the site stays in the window, other sites go to the default browser, mail, phone and text links to their
//!   apps, and anything else does nothing (links.rs);
//! - the page's grant, named as local and remote, since a built app counts a page under frontendDist as local;
//! - the kit's start page (../start/index.html), which the window opens on and which goes on to the site once it
//!   answers, and otherwise says it cannot reach it (`Site::start_page_window`);
//! - on the iPhone, window.open handed to Safari, which the iPhone's web view drops;
//! - on the Mac: closing hides the window and a Dock click brings it back, the page keeps running hidden, Restart once
//!   a newer build is installed, View's zoom kept across launches, the page told about full screen, and a window shown
//!   only once it is back where it was (mac.rs), the menu bar every app shows (menu.rs), and updates from the app's
//!   releases when its tauri.conf.json has plugins.updater (updates.rs).
//!
//! Each decision is logged by host only, never a path, query or fragment, where a sign-in ticket can be. README.md's
//! "A window onto the hosted site" shows an app's shell.

mod links;
mod sign_in;

#[cfg(any(target_os = "ios", target_os = "android"))]
mod iphone;
#[cfg(target_os = "macos")]
mod mac;
#[cfg(target_os = "macos")]
mod menu;
#[cfg(target_os = "macos")]
mod updates;

#[cfg(target_os = "macos")]
pub use menu::{update_item, AppMenu, FILE_MENU, VIEW_MENU};

use links::{link_decision, loggable, new_window_decision, Link};
use tauri::ipc::CapabilityBuilder;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::window::Color;
use tauri::{AppHandle, Manager, RunEvent, Runtime, Url, Webview, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

#[cfg(target_os = "macos")]
use std::sync::Mutex;
#[cfg(target_os = "macos")]
use tauri::menu::{MenuItem, MenuItemBuilder};

/// The window's label. The plugin acts on this window only, so a second window an app opens closes, keeps its zoom
/// and follows its own links.
pub const MAIN: &str = "main";

const MISSING_OPENER: &str = "app-kit's window sends links out through the opener plugin: register \
    tauri_plugin_opener::init() before tauri_plugin_app_kit_window (README.md, A window onto the hosted site)";

/// Where the window hands the start page its settings, and the health route it asks by default (names.ts).
const START_PAGE_SETTINGS: &str = "__APP_KIT_START_PAGE__";
const START_PAGE_HEALTH: &str = "/api/health";
/// The start page, the only file in the folder an app's frontendDist names.
const START_PAGE: &str = "index.html";

/// What the kit's start page shows in an app's own colors: its background, which is also the window's first frame, and
/// its text. It asks the site's health route, `/api/health` unless `health` names another.
#[derive(Clone, Debug)]
pub struct StartPage {
    background: Color,
    text: Color,
    health: String,
}

impl StartPage {
    pub fn new(background: Color, text: Color) -> Self {
        StartPage { background, text, health: START_PAGE_HEALTH.into() }
    }

    /// The path on the site that answers once it is up, for a server not on app-kit/server/start.
    pub fn health(mut self, path: impl Into<String>) -> Self {
        self.health = path.into();
        self
    }
}

/// A color as CSS writes it, without its alpha: the page is opaque.
fn css(color: Color) -> String {
    format!("#{:02x}{:02x}{:02x}", color.0, color.1, color.2)
}

/// The app's hosted site, and what the window keeps of it.
#[derive(Clone, Debug)]
pub struct Site {
    address: Url,
    scheme: Option<String>,
    kept: Vec<String>,
}

impl Site {
    /// The site at `address`. A page under its host, or a subdomain of it, stays in the window.
    pub fn new(address: Url) -> Self {
        Site { address, scheme: None, kept: Vec::new() }
    }

    /// The app's own link scheme, as tauri.conf.json registers it: desktop sign-in's link from the browser arrives on
    /// it, and the page restarts the app through it. Without one, the window takes no sign-in and offers no Restart.
    pub fn scheme(mut self, scheme: impl Into<String>) -> Self {
        self.scheme = Some(scheme.into());
        self
    }

    /// Keeps pages and frames from `host`, and its subdomains, in the window. WebKit asks about every frame, so a
    /// frame the page embeds from another site, such as a video, otherwise goes to the default browser.
    pub fn keep_in_window(mut self, host: impl Into<String>) -> Self {
        self.kept.push(host.into());
        self
    }

    pub fn address(&self) -> &Url {
        &self.address
    }

    fn on_site(&self, url: &Url) -> bool {
        url.origin() == self.address.origin()
    }

    /// The page's grant, which the app adds its own permissions to. Tauri sorts a page as local or remote by its
    /// address: in a built app a page under `frontendDist` counts as local, and in a debug build the dev server counts
    /// as remote, so the grant names both. A grant for remote pages alone left an installed app's page with no
    /// permissions at all, and a debug build hid it. The opener's permissions let its own script send a link with
    /// target=_blank out, and on the iPhone this plugin's script send window.open out.
    pub fn capability(&self) -> CapabilityBuilder {
        let origin = self.address.origin().ascii_serialization();
        CapabilityBuilder::new("app-kit-window-page")
            .remote(format!("{origin}/*"))
            .local(true)
            .window(MAIN)
            .permission("opener:allow-open-url")
            .permission("opener:allow-default-urls")
    }

    /// The window, opening on `start`: the site itself, or a page the app bundles that goes on to it. The app adds
    /// its title, size and first-frame color, and builds it. On the Mac it opens centered and hidden: show it with
    /// `show_once_placed`, after the window-state plugin has put it back where it was.
    pub fn window<'a, R: Runtime, M: Manager<R>>(&self, manager: &'a M, start: WebviewUrl) -> WebviewWindowBuilder<'a, R, M> {
        let app = manager.app_handle().clone();
        let builder = WebviewWindowBuilder::new(manager, MAIN, start).on_new_window(move |url, _features| {
            match new_window_decision(&url) {
                Link::SendOut => send_out(&app, &url, "a new window"),
                Link::Keep | Link::Refuse => {
                    log::info!("opened no new window for {}: only web, mail, phone and text links go out", loggable(&url))
                }
            }
            NewWindowResponse::Deny
        });
        // WebKit suspends a hidden page after about five minutes, which would stop a page's polls and alerts while the
        // window is closed, when they matter most.
        #[cfg(target_os = "macos")]
        let builder = builder
            .center()
            .visible(false)
            .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled);
        #[cfg(any(target_os = "ios", target_os = "android"))]
        let builder = builder.initialization_script(iphone::WINDOW_OPEN_SCRIPT);
        builder
    }

    /// The window, opening on the kit's start page, which goes on to the site as soon as it answers and otherwise says
    /// it cannot reach it, with Try again, so a window with no connection is never blank. The app's tauri.conf.json
    /// points `build.frontendDist` at the page's folder in the kit bun installed; the page uses no permission, so it
    /// needs nothing granted beyond `capability`. Its words name the app by its productName. The window's first frame
    /// is the page's background. The app adds its title and size, as for `window`, and builds it.
    pub fn start_page_window<'a, R: Runtime, M: Manager<R>>(&self, manager: &'a M, page: StartPage) -> WebviewWindowBuilder<'a, R, M> {
        let script = self.start_page_script(&manager.package_info().name, &page);
        log::info!("the window opens on the start page, which goes on to {} once it answers", loggable(&self.address));
        self.window(manager, WebviewUrl::App(START_PAGE.into())).background_color(page.background).initialization_script(script)
    }

    /// The script that hands the start page its settings before its own script runs. The window runs it on every page
    /// it loads, so it sets them only off the site, which never sees them. Each value is JSON, so no name or address
    /// can end the string it is in.
    fn start_page_script(&self, name: &str, page: &StartPage) -> String {
        let settings = serde_json::json!({
            "address": self.address.as_str(),
            "health": page.health,
            "name": name,
            "background": css(page.background),
            "text": css(page.text),
        });
        let origin = serde_json::Value::from(self.address.origin().ascii_serialization());
        format!("if (location.origin !== {origin}) window.{START_PAGE_SETTINGS} = {settings};")
    }

    /// The plugin, registered after the opener plugin, and on the Mac after the window-state plugin.
    pub fn plugin<R: Runtime>(&self) -> TauriPlugin<R> {
        let for_navigation = self.clone();
        let for_events = self.clone();
        Builder::new("app-kit-window")
            .setup(|app, _api| {
                if app.try_state::<tauri_plugin_opener::Opener<R>>().is_none() {
                    return Err(MISSING_OPENER.into());
                }
                #[cfg(target_os = "macos")]
                {
                    app.manage(MacWindow { launched: mac::Launched::now(), full_screen_told: Mutex::new(None), zoom: Mutex::new(None) });
                    updates::start(app);
                }
                Ok(())
            })
            .on_navigation(move |webview, url| navigation(webview, url, &for_navigation))
            .on_page_load(|webview, payload| {
                if on_main(webview.label()) && payload.event() == PageLoadEvent::Finished {
                    #[cfg(target_os = "macos")]
                    mac_page_loaded(webview);
                }
            })
            .on_event(move |app, event| run_event(app, event, &for_events))
            .build()
    }
}

fn on_main(label: &str) -> bool {
    label == MAIN
}

/// Shows the window once the window-state plugin has put it back where it was. That plugin maximizes a window by a
/// block queued on the main dispatch queue, and a showing window zooms there with an animation; a hidden one zooms at
/// once, so the window is shown by a block queued after that one, already maximized. The window-state plugin's own
/// showing is left out (`StateFlags::all() - StateFlags::VISIBLE`), or it shows the window before it zooms.
pub fn show_once_placed<R: Runtime>(window: &WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    {
        let window = window.clone();
        dispatch2::DispatchQueue::main().exec_async(move || {
            let _ = window.show();
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window.show();
}

/// Brings the app and its window to the front, as a Dock click does: for an app's own shortcut or menu item.
#[cfg(target_os = "macos")]
pub fn show<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.show();
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// The log plugin as every app on the kit sets it up: warnings from anything, and every decision of the app's own
/// crate (`app_crate`, as its Cargo.toml names it with dashes as underscores) and of this plugin, written to
/// ~/Library/Logs/<identifier>/, one file of up to a megabyte, as well as to the app's output.
pub fn log_to_file<R: Runtime>(app_crate: &'static str) -> TauriPlugin<R> {
    tauri_plugin_log::Builder::new()
        .level(log::LevelFilter::Warn)
        .level_for(app_crate, log::LevelFilter::Info)
        .level_for(env!("CARGO_CRATE_NAME"), log::LevelFilter::Info)
        .max_file_size(1_000_000)
        .build()
}

/// View's Actual Size (⌘0), Zoom In (⌘=) and Zoom Out (⌘-), for the app's View menu. The plugin carries them out.
#[cfg(target_os = "macos")]
pub fn zoom_items<R: Runtime, M: Manager<R>>(manager: &M) -> tauri::Result<[MenuItem<R>; 3]> {
    Ok([
        MenuItemBuilder::with_id(mac::ACTUAL_SIZE, "Actual Size").accelerator("CmdOrCtrl+0").build(manager)?,
        MenuItemBuilder::with_id(mac::ZOOM_IN, "Zoom In").accelerator("CmdOrCtrl+=").build(manager)?,
        MenuItemBuilder::with_id(mac::ZOOM_OUT, "Zoom Out").accelerator("CmdOrCtrl+-").build(manager)?,
    ])
}

/// Hands `url` to the default browser, or to the app for a mail, phone or text link.
fn send_out<R: Runtime>(app: &AppHandle<R>, url: &Url, what: &str) {
    // The opener's error can quote the whole address, so it is not logged.
    match app.opener().open_url(url.as_str(), None::<&str>) {
        Ok(()) => log::info!(
            "sent {what} for {} out of the window, since it is not the site; a frame from another site lands here too, and Site::keep_in_window keeps it",
            loggable(url)
        ),
        Err(_) => log::warn!("could not send {what} for {} out of the window", loggable(url)),
    }
}

fn navigation<R: Runtime>(webview: &Webview<R>, url: &Url, site: &Site) -> bool {
    if !on_main(webview.label()) {
        return true;
    }
    #[cfg(target_os = "macos")]
    if mac::is_restart_link(url, site.scheme.as_deref()) {
        restart(webview.app_handle());
        return false;
    }
    #[cfg(target_os = "macos")]
    if updates::is_update_link(url, site.scheme.as_deref()) {
        updates::install_update(webview.app_handle().clone());
        return false;
    }
    match link_decision(url, &site.address, &site.kept) {
        Link::Keep => true,
        Link::SendOut => {
            send_out(webview.app_handle(), url, "a link");
            false
        }
        Link::Refuse => {
            log::info!("did nothing with a link to {}: only web, mail, phone and text links go out", loggable(url));
            false
        }
    }
}

fn run_event<R: Runtime>(app: &AppHandle<R>, event: &RunEvent, site: &Site) {
    match event {
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
        RunEvent::Opened { urls } => {
            let Some(scheme) = site.scheme.as_deref() else { return };
            for url in urls.iter().filter(|url| url.scheme() == scheme) {
                match sign_in::sign_in_link(url, scheme) {
                    Some(sign_in) => hand_over(app, site, &sign_in),
                    None => log::info!("ignored a link to {}: not a sign-in with a ticket and nonce it could take", loggable(url)),
                }
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::WindowEvent { label, event, .. } if on_main(label) => mac_window_event(app, event),
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show(app),
        #[cfg(target_os = "macos")]
        RunEvent::MenuEvent(event) => {
            change_zoom(app, event.id().as_ref());
            menu::menu_event(app, event.id().as_ref());
            updates::menu_event(app, event.id().as_ref());
        }
        _ => {}
    }
}

/// Moves a sign-in from the browser's link into the page. The page on the site takes it where it is; a window still
/// on a start page, as at launch, loads the site with it. The ticket itself is never logged.
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
fn hand_over<R: Runtime>(app: &AppHandle<R>, site: &Site, sign_in: &sign_in::SignIn) {
    let Some(window) = app.get_webview_window(MAIN) else {
        log::warn!("a sign-in came back from the browser with no window to hand it to");
        return;
    };
    if window.url().is_ok_and(|url| site.on_site(&url)) {
        log::info!("a sign-in came back from the browser, handing it to the page");
        let _ = window.eval(sign_in::sign_in_script(&site.address, sign_in));
    } else {
        log::info!("a sign-in came back from the browser before the site loaded, loading it to sign in");
        let _ = window.navigate(sign_in::sign_in_page(&site.address, sign_in));
    }
    #[cfg(target_os = "macos")]
    show(app);
}

/// What the Mac window keeps: the program it was launched from, what the page was last told about full screen, and
/// the zoom, read from its file the first time it is needed.
#[cfg(target_os = "macos")]
struct MacWindow {
    launched: mac::Launched,
    full_screen_told: Mutex<Option<bool>>,
    zoom: Mutex<Option<f64>>,
}

#[cfg(target_os = "macos")]
fn zoom_folder<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok()
}

#[cfg(target_os = "macos")]
impl MacWindow {
    fn zoom<R: Runtime>(&self, app: &AppHandle<R>) -> f64 {
        *self.zoom.lock().unwrap().get_or_insert_with(|| zoom_folder(app).map_or(1.0, |folder| mac::saved_zoom(&folder)))
    }
}

#[cfg(target_os = "macos")]
fn mac_window_event<R: Runtime>(app: &AppHandle<R>, event: &tauri::WindowEvent) {
    use tauri::WindowEvent;
    match event {
        // Closing hides, as a Mac app with one window does, and the page keeps running. Quit ends the app.
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            if let Some(window) = app.get_webview_window(MAIN) {
                let _ = window.hide();
            }
            log::info!("the window was closed, so it is hidden and the app runs on; Quit ends it");
        }
        // Each time the window comes forward it looks whether a newer build has been installed, and if so tells the
        // page, which offers Restart, and asks the releases for a newer version, at most once an hour.
        WindowEvent::Focused(true) => {
            updates::came_forward(app);
            let state = app.state::<MacWindow>();
            if state.launched.newer_build_installed() {
                log::info!("a newer build is installed than the one running, telling the page");
                if let Some(window) = app.get_webview_window(MAIN) {
                    let _ = window.eval(mac::newer_build_script());
                }
            }
        }
        // Going into or out of full screen ends with a resize, by which the window knows which it is in.
        WindowEvent::Resized(_) => tell_full_screen(app, false),
        _ => {}
    }
}

/// Tells the page whether the window is in full screen, when that differs from what it was last told, or always when
/// a page has just loaded, since a new page knows nothing.
#[cfg(target_os = "macos")]
fn tell_full_screen<R: Runtime>(app: &AppHandle<R>, page_loaded: bool) {
    let Some(window) = app.get_webview_window(MAIN) else { return };
    let full_screen = window.is_fullscreen().unwrap_or(false);
    let state = app.state::<MacWindow>();
    let mut told = state.full_screen_told.lock().unwrap();
    if page_loaded || *told != Some(full_screen) {
        *told = Some(full_screen);
        let _ = window.eval(mac::full_screen_script(full_screen));
    }
}

/// A page that has just loaded, as after Reload or a sign-in, is told again what an earlier one was: full screen, a
/// newer build, where an update stands, and the zoom, set again whatever WebKit did with it.
#[cfg(target_os = "macos")]
fn mac_page_loaded<R: Runtime>(webview: &Webview<R>) {
    let app = webview.app_handle();
    let state = app.state::<MacWindow>();
    tell_full_screen(app, true);
    if state.launched.newer_build_installed() {
        let _ = webview.eval(mac::newer_build_script());
    }
    if let Some(script) = updates::page_loaded_script(app) {
        let _ = webview.eval(script);
    }
    let _ = webview.set_zoom(state.zoom(app));
}

/// Restarts the app into the newer build installed, through Tauri's restart, which since 2.12.5 opens the app through
/// macOS, so it comes back in front as itself. With no newer build installed it does nothing, so no page or frame can
/// restart the app at will.
#[cfg(target_os = "macos")]
fn restart<R: Runtime>(app: &AppHandle<R>) {
    if app.state::<MacWindow>().launched.newer_build_installed() {
        log::info!("Restart asked for with a newer build installed, restarting into it");
        app.request_restart();
    } else {
        log::info!("Restart asked for with no newer build installed, so there is nothing to restart into; ignored");
    }
}

#[cfg(target_os = "macos")]
fn change_zoom<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let state = app.state::<MacWindow>();
    let Some(next) = mac::zoomed(id, state.zoom(app)) else { return };
    *state.zoom.lock().unwrap() = Some(next);
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.set_zoom(next);
    }
    match zoom_folder(app).map(|folder| mac::save_zoom(&folder, next)) {
        Some(Ok(())) => log::info!("zoomed to {next}, saved for the next launch"),
        Some(Err(error)) => log::warn!("zoomed to {next}, but could not save it for the next launch: {error}"),
        None => log::warn!("zoomed to {next}, but the app has no data folder to save it in"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::utils::acl::capability::CapabilityFile;

    fn site() -> Site {
        Site::new("https://app.example.com".parse().unwrap()).scheme("com.example.app")
    }

    // The built app's page is the site, which Tauri counts as local when it is frontendDist; a grant for remote pages
    // alone left an installed app's page with no permissions at all.
    #[test]
    fn the_page_is_granted_whether_tauri_counts_it_local_or_remote_and_may_send_links_out() {
        use tauri::ipc::RuntimeCapability;
        let site = Site::new("http://localhost:5058/start".parse().unwrap());
        let CapabilityFile::Capability(capability) = site.capability().build() else { panic!("one capability") };
        assert!(capability.local);
        assert_eq!(capability.remote.unwrap().urls, vec!["http://localhost:5058/*".to_string()]);
        assert_eq!(capability.windows, vec![MAIN.to_string()]);
        let permissions: Vec<&str> = capability.permissions.iter().map(|entry| entry.identifier().get()).collect();
        assert_eq!(permissions, ["opener:allow-open-url", "opener:allow-default-urls"]);
    }

    fn start_page() -> StartPage {
        StartPage::new(Color(10, 14, 31, 255), Color(224, 226, 235, 255))
    }

    // The start page reads its settings off the window before its own script runs, and the hosted site never sees them.
    #[test]
    fn the_start_page_is_handed_the_site_the_name_and_the_colors_off_the_site_only() {
        let site = Site::new("https://app.example.com/start".parse().unwrap());
        assert_eq!(
            site.start_page_script("Example", &start_page()),
            r##"if (location.origin !== "https://app.example.com") window.__APP_KIT_START_PAGE__ = {"address":"https://app.example.com/start","background":"#0a0e1f","health":"/api/health","name":"Example","text":"#e0e2eb"};"##
        );
        let script = site.start_page_script("Example \"App\"\n", &start_page().health("/health"));
        assert!(script.contains(r#""name":"Example \"App\"\n""#), "{script}");
        assert!(script.contains(r#""health":"/health""#), "{script}");
    }

    #[test]
    fn the_start_page_reads_its_settings_where_the_window_puts_them() {
        let page = include_str!("../../start/index.html");
        assert!(page.contains(&format!("window.{START_PAGE_SETTINGS};")), "the page reads window.{START_PAGE_SETTINGS}");
    }

    #[test]
    fn a_start_page_window_opens_on_a_bundled_page_not_the_site() {
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_opener::init())
            .plugin(site().plugin())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let window = site().start_page_window(&app, start_page()).build().unwrap();
        // Tauri's test runtime reports a bundled page by the app's own origin alone, never its path: the window is on
        // the bundled page, not the site.
        assert_eq!(window.url().unwrap().as_str(), "tauri://localhost");
    }

    #[test]
    fn only_the_main_window_is_the_sites() {
        assert!(on_main("main"));
        assert!(!on_main("settings"));
    }

    #[test]
    fn a_page_on_the_sites_origin_is_on_the_site_and_a_start_page_or_subdomain_is_not() {
        let site = site();
        assert!(site.on_site(&"https://app.example.com/settings?x=1".parse().unwrap()));
        assert!(!site.on_site(&"tauri://localhost/index.html".parse().unwrap()));
        assert!(!site.on_site(&"https://clerk.app.example.com/".parse().unwrap()));
        assert!(!site.on_site(&"http://app.example.com/".parse().unwrap()));
    }

    #[test]
    fn an_app_that_never_registered_the_opener_is_told_so_at_launch() {
        let Err(error) = tauri::test::mock_builder()
            .plugin(site().plugin())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
        else {
            panic!("the app started with no opener plugin");
        };
        assert!(error.to_string().contains("register tauri_plugin_opener::init() before tauri_plugin_app_kit_window"), "{error}");
        assert!(tauri::test::mock_builder()
            .plugin(tauri_plugin_opener::init())
            .plugin(site().plugin())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .is_ok());
    }
}
