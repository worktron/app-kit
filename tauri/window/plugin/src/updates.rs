//! The Mac app's updates from its releases, as practices' desktop app rule asks: the window asks the releases at launch
//! and each time it comes forward, at most once an hour, never while an update installs; the app's menu has Check for
//! Updates…, which shows the result in place and installs the newer version once one is found; and the page is told
//! where the update stands, as each page loads too, so it can offer Update, a link to `<scheme>://update`.
//!
//! An app turns this on with `plugins.updater` in its tauri.conf.json, the public key and the releases' address that
//! `app-kit mac key` prints, and nothing in its shell: the window registers Tauri's updater itself. A build that runs
//! outside an app bundle, as a dev run does, never asks, since there is no app to put an update in place of.
//!
//! Ported from Timescale's shell, where each rule here was learned: an update found is told again to each page that
//! loads, a later release takes the place of the one found, and nothing is asked while an update installs.
//! The page's names are tauri/window/names.ts's, and test/tauri-window.test.ts holds them to it.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::menu::MenuItem;
use tauri::{AppHandle, Manager, Runtime, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

/// The host of the link the page opens to install the newer version found, `<scheme>://update`.
const UPDATE_HOST: &str = "update";
/// The flag and window event that tell the page where an update stands: "available", "installing" or "failed".
const UPDATE_FLAG: &str = "__APP_KIT_UPDATE__";
const UPDATE_EVENT: &str = "app-kit-update";
/// The menu item Check for Updates…, after About.
pub(crate) const UPDATE_ITEM: &str = "app-kit-check-for-updates";
/// How often, at most, the window asks the releases when it comes forward.
const CHECK_EVERY: Duration = Duration::from_secs(60 * 60);

/// Whether the app's tauri.conf.json turns updates on.
pub(crate) fn configured(config: &tauri::Config) -> bool {
    config.plugins.0.contains_key("updater")
}

/// Whether the program is inside an app bundle, `<name>.app/Contents/MacOS/<program>`, which an update replaces. A dev
/// run's program is in the build folder.
pub(crate) fn in_app_bundle(program: &Path) -> bool {
    let mut parts = program.ancestors().skip(1);
    let (macos, contents, app) = (parts.next(), parts.next(), parts.next());
    let named = |path: Option<&Path>, name: &str| path.and_then(Path::file_name).is_some_and(|file| file == name);
    named(macos, "MacOS") && named(contents, "Contents") && app.and_then(Path::extension).is_some_and(|ext| ext == "app")
}

pub(crate) fn is_update_link(url: &Url, scheme: Option<&str>) -> bool {
    scheme.is_some_and(|scheme| url.scheme() == scheme) && url.host_str() == Some(UPDATE_HOST)
}

/// Where an update stands, as the page is told it. The names are `AppUpdate` in tauri/window/index.ts.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum UpdateState {
    Available,
    Installing,
    Failed,
}

impl UpdateState {
    fn name(self) -> &'static str {
        match self {
            UpdateState::Available => "available",
            UpdateState::Installing => "installing",
            UpdateState::Failed => "failed",
        }
    }
}

pub(crate) fn update_script(state: UpdateState) -> String {
    format!("window.{UPDATE_FLAG} = {:?}; window.dispatchEvent(new Event({UPDATE_EVENT:?}));", state.name())
}

/// What the window keeps about updates: whether Tauri's updater is registered, when the releases were last asked, the
/// newer version they named, kept until it is installed, and what the page was last told, which each page that loads is
/// told again.
#[derive(Default)]
pub(crate) struct Updates {
    ready: AtomicBool,
    checked: Mutex<Option<Instant>>,
    found: Mutex<Option<Update>>,
    told: Mutex<Option<UpdateState>>,
}

/// Whether the releases may be asked now: not while an update installs, when a newer one found would offer Update
/// beside the install already running.
fn may_check(told: Option<UpdateState>) -> bool {
    !matches!(told, Some(UpdateState::Installing))
}

fn check_due(last: Option<Instant>, now: Instant) -> bool {
    last.map_or(true, |last| now.duration_since(last) >= CHECK_EVERY)
}

/// Whether the version the releases name is news: none was found before, or one since released after it. The releases
/// only go up, so any other version than the one held is newer.
fn newly_found(held: Option<&str>, found: &str) -> bool {
    held != Some(found)
}

/// Where the menu's update item stands, which its words and whether it can be clicked follow.
#[derive(Debug, PartialEq)]
pub(crate) enum UpdateItem<'a> {
    Check,
    Checking,
    UpToDate(&'a str, &'a str),
    CheckFailed,
    Ready(&'a str),
    Installing(&'a str),
    Failed(&'a str),
    OutsideApp,
}

/// The update item's words, and whether it can be clicked: not while it is checking or installing.
pub(crate) fn update_item_text(item: UpdateItem) -> (String, bool) {
    match item {
        UpdateItem::Check => ("Check for Updates…".into(), true),
        UpdateItem::Checking => ("Checking for Updates…".into(), false),
        UpdateItem::UpToDate(name, version) => (format!("{name} {version} Is Up to Date"), true),
        UpdateItem::CheckFailed => ("Could Not Check for Updates, Try Again".into(), true),
        UpdateItem::Ready(version) => (format!("Update to {version}"), true),
        UpdateItem::Installing(version) => (format!("Updating to {version}…"), false),
        UpdateItem::Failed(version) => (format!("Could Not Update to {version}, Try Again"), true),
        UpdateItem::OutsideApp => ("Updates Only in the Installed App".into(), false),
    }
}

/// The menu's update item, kept so its words can follow the update. AppMenu builds it, or `update_item` for an app that
/// builds its own menu.
pub(crate) struct UpdateMenuItem<R: Runtime>(pub(crate) Mutex<Option<MenuItem<R>>>);

pub(crate) fn keep_menu_item<R: Runtime>(app: &AppHandle<R>, item: MenuItem<R>) {
    match app.try_state::<UpdateMenuItem<R>>() {
        Some(kept) => *kept.0.lock().unwrap() = Some(item),
        None => {
            app.manage(UpdateMenuItem(Mutex::new(Some(item))));
        }
    }
}

fn show_update_item<R: Runtime>(app: &AppHandle<R>, item: UpdateItem) {
    let (text, enabled) = update_item_text(item);
    let Some(kept) = app.try_state::<UpdateMenuItem<R>>() else { return };
    // Cloned out of the lock, since the menu is changed on the main thread.
    let item = kept.0.lock().unwrap().clone();
    if let Some(item) = item {
        let _ = item.set_text(text);
        let _ = item.set_enabled(enabled);
    }
}

fn tell_page<R: Runtime>(app: &AppHandle<R>, state: UpdateState) {
    *app.state::<Updates>().told.lock().unwrap() = Some(state);
    if let Some(window) = app.get_webview_window(crate::MAIN) {
        let _ = window.eval(update_script(state));
    }
}

/// The script that tells a page that has just loaded where the update stands, if the page has been told anything.
pub(crate) fn page_loaded_script<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let told = *app.try_state::<Updates>()?.told.lock().unwrap();
    told.map(update_script)
}

/// Turns updates on at launch when the app's config asks for them. Tauri's updater cannot be registered from this
/// plugin's own setup, since Tauri holds its plugins' lock while each sets up, so a thread of its own registers it once
/// the lock is let go, as `AppHandle::plugin`'s own documentation shows.
pub(crate) fn start<R: Runtime>(app: &AppHandle<R>) {
    app.manage(Updates::default());
    if !configured(app.config()) {
        log::info!("tauri.conf.json has no plugins.updater, so the app does not update itself");
        return;
    }
    let program = std::env::current_exe().ok();
    if !program.as_deref().is_some_and(in_app_bundle) {
        log::info!("this build runs outside an app bundle, as a dev run does, so it never asks the releases for updates");
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || register(&app));
}

/// Registers Tauri's updater, then asks the releases once, since the window may have come forward before it was ready.
/// Until it is registered nothing asks the updater, whose state does not exist before then.
pub(crate) fn register<R: Runtime>(app: &AppHandle<R>) {
    match app.plugin(tauri_plugin_updater::Builder::new().build()) {
        Ok(()) => {
            app.state::<Updates>().ready.store(true, Ordering::SeqCst);
            log::info!("updates are on, asking the releases now and each time the window comes forward, at most once an hour");
            check_for_update(app.clone(), false);
        }
        Err(error) => log::warn!("updates are off: Tauri's updater would not start with plugins.updater in tauri.conf.json: {error}"),
    }
}

fn ready<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.try_state::<Updates>().is_some_and(|updates| updates.ready.load(Ordering::SeqCst))
}

/// Each time the window comes forward it asks the releases, at most once an hour.
pub(crate) fn came_forward<R: Runtime>(app: &AppHandle<R>) {
    check_for_update(app.clone(), false);
}

/// Asks the releases whether there is a newer version than this one, and tells the menu and the page if there is.
/// Unless asked from the menu, it does nothing when they were asked within the hour. It goes on asking once one is
/// found, so a window left open across releases offers the newest, not the first it found.
pub(crate) fn check_for_update<R: Runtime>(app: AppHandle<R>, asked: bool) {
    if !ready(&app) {
        if asked {
            log::info!("Check for Updates chosen, but this build is not the installed app, so it never asks the releases");
            show_update_item(&app, UpdateItem::OutsideApp);
        }
        return;
    }
    let updates = app.state::<Updates>();
    if !may_check(*updates.told.lock().unwrap()) {
        return;
    }
    let now = Instant::now();
    {
        let mut checked = updates.checked.lock().unwrap();
        if !asked && !check_due(*checked, now) {
            return;
        }
        *checked = Some(now);
    }
    if asked {
        show_update_item(&app, UpdateItem::Checking);
    }
    tauri::async_runtime::spawn(async move {
        let found = match app.updater() {
            Ok(updater) => updater.check().await,
            Err(error) => Err(error),
        };
        answered(&app, asked, found);
    });
}

/// What the releases answered.
fn answered<R: Runtime>(app: &AppHandle<R>, asked: bool, found: tauri_plugin_updater::Result<Option<Update>>) {
    match found {
        Ok(Some(update)) => {
            let updates = app.state::<Updates>();
            // Asked again, since an install may have started while the releases answered.
            if !may_check(*updates.told.lock().unwrap()) {
                log::info!("version {} is released, but an update is installing, so it waits", update.version);
                return;
            }
            let version = update.version.clone();
            {
                let mut held = updates.found.lock().unwrap();
                if !newly_found(held.as_ref().map(|held| held.version.as_str()), &version) {
                    log::info!("version {version} is still the newest released, already offered");
                    if asked {
                        show_update_item(app, UpdateItem::Ready(&version));
                    }
                    return;
                }
                log::info!("version {version} is released, running {}, offering Update", update.current_version);
                *held = Some(update);
            }
            // Outside the lock, since the menu is changed on the main thread, where install_update takes it.
            show_update_item(app, UpdateItem::Ready(&version));
            tell_page(app, UpdateState::Available);
        }
        Ok(None) => {
            log::info!("no newer version is released");
            if asked {
                let info = app.package_info();
                show_update_item(app, UpdateItem::UpToDate(&info.name, &info.version.to_string()));
            }
        }
        Err(error) => {
            log::info!("could not ask the releases for a newer version: {error}");
            if asked {
                show_update_item(app, UpdateItem::CheckFailed);
            }
        }
    }
}

/// Downloads the newer version found, checks its signature against the public key in tauri.conf.json, puts it in place
/// of this app and restarts into it. The page is told it is installing, and that it failed if it does.
pub(crate) fn install_update<R: Runtime>(app: AppHandle<R>) {
    let Some(update) = app.state::<Updates>().found.lock().unwrap().clone() else {
        log::info!("Update asked for, but no newer version has been found; ignored");
        return;
    };
    if *app.state::<Updates>().told.lock().unwrap() == Some(UpdateState::Installing) {
        log::info!("Update asked for while version {} installs; ignored", update.version);
        return;
    }
    log::info!("Update asked for, installing version {}", update.version);
    show_update_item(&app, UpdateItem::Installing(&update.version));
    tell_page(&app, UpdateState::Installing);
    tauri::async_runtime::spawn(async move {
        match update.download_and_install(|_, _| {}, || {}).await {
            Ok(()) => {
                // Tauri's restart opens the app through macOS, so the newer version comes back in front as itself.
                log::info!("version {} installed, restarting into it", update.version);
                app.request_restart();
            }
            Err(error) => {
                log::warn!("version {} could not be installed: {error}", update.version);
                show_update_item(&app, UpdateItem::Failed(&update.version));
                tell_page(&app, UpdateState::Failed);
            }
        }
    });
}

/// The menu's update item: a version already found is installed; otherwise the releases are asked now.
pub(crate) fn menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if id != UPDATE_ITEM {
        return;
    }
    let found = app.try_state::<Updates>().is_some_and(|updates| updates.found.lock().unwrap().is_some());
    if found {
        install_update(app.clone());
    } else {
        check_for_update(app.clone(), true);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_program_inside_an_app_bundle_asks_for_updates() {
        assert!(in_app_bundle(Path::new("/Applications/Example App.app/Contents/MacOS/example")));
        assert!(in_app_bundle(Path::new("/Volumes/Apps/Example.app/Contents/MacOS/example")));
        assert!(!in_app_bundle(Path::new("/work/example/src-tauri/target/debug/example")));
        assert!(!in_app_bundle(Path::new("/work/Contents/MacOS/example")));
        assert!(!in_app_bundle(Path::new("example")));
    }

    #[test]
    fn only_the_apps_own_update_link_installs() {
        let url = |s: &str| s.parse::<Url>().unwrap();
        assert!(is_update_link(&url("com.example.app://update"), Some("com.example.app")));
        assert!(!is_update_link(&url("com.example.app://update"), None));
        assert!(!is_update_link(&url("other.app://update"), Some("com.example.app")));
        assert!(!is_update_link(&url("com.example.app://restart"), Some("com.example.app")));
        assert!(!is_update_link(&url("https://update/"), Some("com.example.app")));
    }

    #[test]
    fn the_page_is_told_by_a_flag_it_can_read_late_and_an_event() {
        assert_eq!(
            update_script(UpdateState::Available),
            r#"window.__APP_KIT_UPDATE__ = "available"; window.dispatchEvent(new Event("app-kit-update"));"#
        );
        assert!(update_script(UpdateState::Installing).contains(r#"= "installing";"#));
        assert!(update_script(UpdateState::Failed).contains(r#"= "failed";"#));
    }

    #[test]
    fn the_update_item_says_where_an_update_stands_and_is_clickable_unless_one_is_under_way() {
        let says = |item| update_item_text(item);
        assert_eq!(says(UpdateItem::Check), ("Check for Updates…".to_string(), true));
        assert_eq!(says(UpdateItem::Checking), ("Checking for Updates…".to_string(), false));
        assert_eq!(says(UpdateItem::UpToDate("Example", "0.1.3")), ("Example 0.1.3 Is Up to Date".to_string(), true));
        assert_eq!(says(UpdateItem::CheckFailed), ("Could Not Check for Updates, Try Again".to_string(), true));
        assert_eq!(says(UpdateItem::Ready("0.1.4")), ("Update to 0.1.4".to_string(), true));
        assert_eq!(says(UpdateItem::Installing("0.1.4")), ("Updating to 0.1.4…".to_string(), false));
        assert_eq!(says(UpdateItem::Failed("0.1.4")), ("Could Not Update to 0.1.4, Try Again".to_string(), true));
        assert_eq!(says(UpdateItem::OutsideApp), ("Updates Only in the Installed App".to_string(), false));
    }

    #[test]
    fn the_releases_are_asked_at_most_once_an_hour_and_never_while_an_update_installs() {
        let now = Instant::now();
        assert!(check_due(None, now));
        assert!(!check_due(Some(now), now + Duration::from_secs(59 * 60)));
        assert!(check_due(Some(now), now + CHECK_EVERY));
        assert!(may_check(None));
        assert!(may_check(Some(UpdateState::Available)));
        assert!(may_check(Some(UpdateState::Failed)));
        assert!(!may_check(Some(UpdateState::Installing)));
    }

    #[test]
    fn a_version_released_after_the_one_found_replaces_it_and_the_same_one_is_not_offered_again() {
        assert!(newly_found(None, "0.1.4"));
        assert!(!newly_found(Some("0.1.4"), "0.1.4"));
        assert!(newly_found(Some("0.1.4"), "0.1.5"));
    }
}

/// The window against a releases feed this test serves on a local port, holding a release signed as `tauri build` signs
/// one: the minisign signature of the archive, its trusted comment naming the version, base64-encoded, and the public
/// key the same way. The feed's latest.json is the one `app-kit mac release` writes (test/fixtures/mac-release/).
#[cfg(test)]
mod feed {
    use super::*;
    use base64::Engine;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};

    const VERSION: &str = "0.2.0";
    const ARCHIVE: &[u8] = b"the bytes of Example.app.tar.gz";

    struct Key {
        public: String,
        secret: minisign::SecretKey,
    }

    fn key() -> Key {
        let pair = minisign::KeyPair::generate_unencrypted_keypair().unwrap();
        let public = base64::engine::general_purpose::STANDARD.encode(pair.pk.to_box().unwrap().into_string());
        Key { public, secret: pair.sk }
    }

    /// The `.sig` file's contents, as the Tauri command-line tool writes them.
    fn signature(key: &Key, data: &[u8], version: &str) -> String {
        let comment = format!("timestamp:1791649051\tfile:Example.app.tar.gz\tversion:{version}");
        let signed = minisign::sign(None, &key.secret, data, Some(&comment), Some("signature from tauri secret key")).unwrap();
        base64::engine::general_purpose::STANDARD.encode(signed.into_string())
    }

    /// Serves latest.json and the archive at a local address until the test process ends; returns the feed's address.
    fn serve(signature: String) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let fixture = include_str!("../../../../test/fixtures/mac-release/latest.json");
        let latest = fixture
            .replace("{version}", VERSION)
            .replace("{pub_date}", "2026-11-05T12:00:00Z")
            .replace("{signature}", &signature)
            .replace("{url}", &format!("{address}/Example.app.tar.gz"));
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut request = Vec::new();
                let mut chunk = [0u8; 1024];
                while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                    match stream.read(&mut chunk) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => request.extend_from_slice(&chunk[..n]),
                    }
                }
                let body: &[u8] = if request.starts_with(b"GET /latest.json") { latest.as_bytes() } else { ARCHIVE };
                let head = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                let _ = stream.write_all(head.as_bytes()).and_then(|()| stream.write_all(body));
            }
        });
        address
    }

    /// A mock app on the window plugin, with `updater` as its tauri.conf.json's plugins.updater when given.
    fn app(updater: Option<serde_json::Value>) -> tauri::App<MockRuntime> {
        let mut context = mock_context(noop_assets());
        if let Some(updater) = updater {
            context.config_mut().plugins.0.insert("updater".into(), updater);
        }
        let site = crate::Site::new("https://app.example.com".parse().unwrap()).scheme("com.example.app");
        mock_builder().plugin(tauri_plugin_opener::init()).plugin(site.plugin()).build(context).unwrap()
    }

    fn updater_config(public: &str, address: &str) -> serde_json::Value {
        serde_json::json!({
            "pubkey": public,
            "endpoints": [format!("{address}/latest.json")],
            "dangerousInsecureTransportProtocol": true,
            "requireSignedVersion": true,
        })
    }

    /// Waits for the releases' answer, the fact the check ends on, failing after a minute rather than hanging.
    fn wait_for_answer(app: &tauri::App<MockRuntime>) -> Option<Update> {
        let updates = app.state::<Updates>();
        for _ in 0..6000 {
            if let Some(found) = updates.found.lock().unwrap().clone() {
                return Some(found);
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        None
    }

    #[test]
    fn a_release_in_the_feed_is_found_offered_to_the_page_and_downloads_with_its_signature_checked() {
        let key = key();
        let address = serve(signature(&key, ARCHIVE, VERSION));
        let app = app(Some(updater_config(&key.public, &address)));
        // The test program is not inside an app bundle, so the plugin's own start left updates off.
        assert!(!ready(app.handle()));
        register(app.handle());
        assert!(ready(app.handle()));
        let found = wait_for_answer(&app).expect("the check at registration found the release");
        assert_eq!(found.version, VERSION);
        assert_eq!(found.current_version, "0.1.0");
        assert_eq!(*app.state::<Updates>().told.lock().unwrap(), Some(UpdateState::Available));
        assert_eq!(page_loaded_script(app.handle()), Some(update_script(UpdateState::Available)));
        let downloaded = tauri::async_runtime::block_on(found.download(|_, _| {}, || {}));
        assert_eq!(downloaded.unwrap(), ARCHIVE);
    }

    #[test]
    fn a_release_signed_by_another_key_or_for_another_version_is_refused_at_download() {
        let key = key();
        for (signature, why) in [
            (signature(&self::key(), ARCHIVE, VERSION), "another key"),
            (signature(&key, ARCHIVE, "0.1.9"), "another version"),
        ] {
            let address = serve(signature);
            let app = app(Some(updater_config(&key.public, &address)));
            register(app.handle());
            let found = wait_for_answer(&app).expect("the release is found before its download is checked");
            let downloaded = tauri::async_runtime::block_on(found.download(|_, _| {}, || {}));
            assert!(downloaded.is_err(), "a release signed with {why} downloaded");
        }
    }

    #[test]
    fn an_app_without_updater_settings_or_with_broken_ones_never_asks_and_never_panics() {
        let app = app(None);
        assert!(!configured(app.config()));
        check_for_update(app.handle().clone(), true);
        menu_event(app.handle(), UPDATE_ITEM);
        install_update(app.handle().clone());
        assert_eq!(page_loaded_script(app.handle()), None);

        // No public key: Tauri's updater refuses to start, and updates stay off.
        let app = self::app(Some(serde_json::json!({ "endpoints": ["https://example.com/latest.json"] })));
        register(app.handle());
        assert!(!ready(app.handle()));
        check_for_update(app.handle().clone(), true);
        assert!(app.state::<Updates>().found.lock().unwrap().is_none());
    }
}
