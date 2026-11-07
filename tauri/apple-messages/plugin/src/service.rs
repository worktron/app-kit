//! Installing Messages Service, the Mac app that holds the one Full Disk Access grant and pushes texts to the server of
//! each app the person connects, and handing it a connect link (../../index.ts messagesService, ../../server.ts).
//!
//! An installed copy is checked and opened, never replaced: macOS refuses one app changing another's files unless both
//! are signed by the same team, and the service updates itself. A copy that fails the check is refused, never opened,
//! so a bundle that only borrows the service's name and identifier is not handed Full Disk Access or a connect link.
//! A missing one is downloaded from its latest release (the archive
//! its updater takes too), unpacked into a fresh folder beside Applications, and checked there: signed by the app's
//! team, notarized by Apple, and the service's own bundle. Only a copy that passes is moved into Applications, so an
//! interrupted or refused install leaves nothing behind. This check is the only one: a file an app downloads itself
//! carries no quarantine mark, so macOS does not check it when it opens.

use std::path::{Path, PathBuf};
use std::process::Command;

/// The service's name in Applications, as `<name>.app`.
pub const SERVICE_APP_NAME: &str = "Messages Service";
/// Its bundle identifier.
pub const SERVICE_BUNDLE_ID: &str = "com.worktron.messages-service";
/// Its link scheme, and the host of its connect link.
pub const SERVICE_SCHEME: &str = "messages-service";
pub const SERVICE_CONNECT_HOST: &str = "connect";
/// Its releases' update manifest, which names the archive.
pub const SERVICE_LATEST_JSON: &str = "https://github.com/worktron/messages-service-releases/releases/latest/download/latest.json";
/// The release's platform key in that manifest.
pub const SERVICE_PLATFORM: &str = "darwin-aarch64";

/// What an install did.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    /// "opened" an installed copy, or "installed" a new one.
    pub done: &'static str,
    pub path: String,
}

/// Opens the app, with a link for it when there is one.
pub type Open = fn(&Path, Option<&str>) -> Result<(), String>;

/// One install at a time in this app: a second click while the first downloads waits for it, then opens what it put in place.
static INSTALLING: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Where to look and what to take: the real ones in `Installer::for_this_mac`, folders of a test's own in tests.
pub struct Installer {
    /// Where an installed copy may be, in order; a new one goes in the first that can be written to.
    pub folders: Vec<PathBuf>,
    /// The update manifest's address (a `file://` address in tests).
    pub latest_json: String,
    /// What the copy must satisfy, in codesign's requirement language.
    pub requirement: String,
    /// Opens the app, or hands it a link; tests record it instead, so nothing opens on the screen.
    pub open: Open,
}

/// The requirement a downloaded copy must meet: Apple's chain, the team's Developer ID, notarized, and the service's id.
pub fn requirement(team_id: &str) -> Result<String, String> {
    if team_id.len() != 10 || !team_id.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()) {
        return Err(format!("{team_id:?} is not an Apple Developer team id (10 capital letters and digits)"));
    }
    Ok(format!(
        "anchor apple generic and certificate leaf[subject.OU] = \"{team_id}\" and notarized and identifier \"{SERVICE_BUNDLE_ID}\""
    ))
}

impl Installer {
    pub fn for_this_mac(team_id: &str) -> Result<Installer, String> {
        let home = std::env::var_os("HOME").map(PathBuf::from).ok_or("no home folder")?;
        Ok(Installer {
            folders: vec![PathBuf::from("/Applications"), home.join("Applications")],
            latest_json: SERVICE_LATEST_JSON.into(),
            requirement: requirement(team_id)?,
            open: open_app,
        })
    }

    /// The installed copy: a `Messages Service.app` in one of the folders whose bundle is the service's.
    pub fn installed(&self) -> Option<PathBuf> {
        self.folders.iter().map(|f| f.join(format!("{SERVICE_APP_NAME}.app"))).find(|app| bundle_id(app).as_deref() == Some(SERVICE_BUNDLE_ID))
    }

    /// The installed copy, once codesign says it meets the requirement; an error when it is missing or does not.
    pub fn checked(&self) -> Result<PathBuf, String> {
        let app = self.installed().ok_or("Messages Service is not installed")?;
        self.check(&app).map_err(|e| {
            log::warn!("[apple-messages] refused the Messages Service at {}: {e}", app.display());
            format!("the Messages Service at {} is not the team's notarized build ({e}); remove it and install again", app.display())
        })?;
        Ok(app)
    }

    fn check(&self, app: &Path) -> Result<(), String> {
        run(
            Command::new("/usr/bin/codesign").args(["--verify", "--strict", "--deep"]).arg(format!("-R={}", self.requirement)).arg(app),
            "checking it is the service, signed by this team and notarized",
        )
    }

    /// Open the installed service, or install the latest release and open it.
    pub fn install(&self) -> Result<Installed, String> {
        let _one = INSTALLING.lock().unwrap_or_else(|e| e.into_inner());
        if self.installed().is_some() {
            let app = self.checked()?;
            log::info!("[apple-messages] Messages Service is installed at {}; opening it", app.display());
            (self.open)(&app, None)?;
            return Ok(Installed { done: "opened", path: app.display().to_string() });
        }
        let folder = self.folders.iter().find(|f| writable(f)).ok_or("no Applications folder this app can write to")?;
        // A folder of this install's own beside the destination, so the last step is a rename on one volume. Only this
        // app's installs use the name, one at a time, so what is there is an interrupted earlier one's.
        let staging = folder.join(format!(".{SERVICE_APP_NAME}.installing-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&staging);
        std::fs::create_dir(&staging).map_err(|e| format!("cannot make {}: {e}", staging.display()))?;
        let result = self.install_into(folder, &staging);
        let _ = std::fs::remove_dir_all(&staging);
        match &result {
            Ok(done) => log::info!("[apple-messages] installed Messages Service at {}", done.path),
            Err(e) => log::warn!("[apple-messages] did not install Messages Service: {e}"),
        }
        result
    }

    fn install_into(&self, folder: &Path, staging: &Path) -> Result<Installed, String> {
        let manifest = staging.join("latest.json");
        download(&self.latest_json, &manifest)?;
        let url = archive_url(&std::fs::read_to_string(&manifest).map_err(|e| format!("latest.json: {e}"))?)?;
        let archive = staging.join("release.tar.gz");
        download(&url, &archive)?;
        run(Command::new("/usr/bin/tar").arg("-xzf").arg(&archive).arg("-C").arg(staging), "unpacking the release")?;
        let unpacked = staging.join(format!("{SERVICE_APP_NAME}.app"));
        if !unpacked.is_dir() {
            return Err(format!("the release holds no {SERVICE_APP_NAME}.app"));
        }
        self.check(&unpacked)?;
        let app = folder.join(format!("{SERVICE_APP_NAME}.app"));
        std::fs::rename(&unpacked, &app).map_err(|e| format!("moving it into {}: {e}", folder.display()))?;
        (self.open)(&app, None)?;
        Ok(Installed { done: "installed", path: app.display().to_string() })
    }

    /// Hands a connect link to the installed, checked copy by its path, never to whichever app claims the link's scheme.
    pub fn connect(&self, link: &str) -> Result<(), String> {
        if !is_connect_link(link) {
            log::warn!("[apple-messages] refused to open a link that is not Messages Service's connect link");
            return Err("not a Messages Service connect link".into());
        }
        let app = self.checked()?;
        (self.open)(&app, Some(link)).map_err(|e| format!("opening the connect link: {e}"))?;
        log::info!("[apple-messages] handed a connect link to Messages Service at {}", app.display());
        Ok(())
    }
}

/// The archive the manifest names for this Mac.
fn archive_url(manifest: &str) -> Result<String, String> {
    let json: serde_json::Value = serde_json::from_str(manifest).map_err(|e| format!("latest.json: {e}"))?;
    let url = json["platforms"][SERVICE_PLATFORM]["url"].as_str().ok_or(format!("latest.json names no {SERVICE_PLATFORM} release"))?;
    // A made-up release in a test is a file on disk; a real one is only ever on https.
    if !(url.starts_with("https://") || (cfg!(test) && url.starts_with("file://"))) {
        return Err("latest.json names an archive that is not on https".into());
    }
    Ok(url.into())
}

fn download(url: &str, to: &Path) -> Result<(), String> {
    run(Command::new("/usr/bin/curl").args(["--fail", "--silent", "--show-error", "--location", "--max-time", "600", "--output"]).arg(to).arg(url), "downloading")
}

fn run(command: &mut Command, what: &str) -> Result<(), String> {
    let out = command.output().map_err(|e| format!("{what}: {e}"))?;
    if out.status.success() {
        return Ok(());
    }
    let said = String::from_utf8_lossy(&out.stderr);
    Err(format!("{what} failed: {}", said.trim().lines().last().unwrap_or("no reason given")))
}

fn bundle_id(app: &Path) -> Option<String> {
    let out = Command::new("/usr/bin/plutil")
        .args(["-extract", "CFBundleIdentifier", "raw", "-o", "-"])
        .arg(app.join("Contents/Info.plist"))
        .output()
        .ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn writable(folder: &Path) -> bool {
    if !folder.exists() && std::fs::create_dir_all(folder).is_err() {
        return false;
    }
    // A file made new, so one already there is neither written over nor removed.
    let probe = folder.join(format!(".app-kit-write-check-{}", std::process::id()));
    match std::fs::OpenOptions::new().write(true).create_new(true).open(&probe) {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// macOS's `open -a <app> [link]`: the app at that path, so a link reaches it and no other app that claims the scheme.
fn open_app(app: &Path, link: Option<&str>) -> Result<(), String> {
    let mut open = Command::new("/usr/bin/open");
    open.arg("-a").arg(app);
    if let Some(link) = link {
        open.arg(link);
    }
    run(&mut open, "opening Messages Service")
}

/// Whether `link` is the service's connect link, the only link `open_connect_link` hands over.
pub fn is_connect_link(link: &str) -> bool {
    link.strip_prefix(&format!("{SERVICE_SCHEME}://{SERVICE_CONNECT_HOST}?")).is_some_and(|q| q.contains("address=") && q.contains("code="))
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static OPENED: Mutex<Vec<(PathBuf, Option<String>)>> = Mutex::new(Vec::new());
    fn record(app: &Path, link: Option<&str>) -> Result<(), String> {
        OPENED.lock().unwrap().push((app.to_path_buf(), link.map(String::from)));
        Ok(())
    }
    fn opened(under: &Path) -> Vec<PathBuf> {
        OPENED.lock().unwrap().iter().filter(|(p, _)| p.starts_with(under)).map(|(p, _)| p.clone()).collect()
    }
    fn links(under: &Path) -> Vec<String> {
        OPENED.lock().unwrap().iter().filter(|(p, _)| p.starts_with(under)).filter_map(|(_, l)| l.clone()).collect()
    }
    /// What an ad hoc signature meets: a requirement on its identifier only, the made-up stand-in for the team's.
    fn ad_hoc() -> String {
        format!("identifier \"{SERVICE_BUNDLE_ID}\"")
    }
    const LINK: &str = "messages-service://connect?address=https%3A%2F%2Fapp.example.com%2Fapi%2Fmessages-service&code=ab";

    struct Dir(PathBuf);
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn dir(label: &str) -> Dir {
        let d = Path::new("/tmp/app-kit-tests").join(format!("service-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        Dir(d)
    }

    /// A made-up service bundle, signed ad hoc as `id`: a copy of /usr/bin/true as its program.
    fn fake_app(at: &Path, id: &str) -> PathBuf {
        let app = at.join(format!("{SERVICE_APP_NAME}.app"));
        std::fs::create_dir_all(app.join("Contents/MacOS")).unwrap();
        std::fs::copy("/usr/bin/true", app.join("Contents/MacOS/service")).unwrap();
        std::fs::write(
            app.join("Contents/Info.plist"),
            format!(
                r#"<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>{id}</string><key>CFBundleExecutable</key><string>service</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>"#
            ),
        )
        .unwrap();
        run(Command::new("/usr/bin/codesign").args(["--force", "--sign", "-", "--identifier", id]).arg(&app), "signing the made-up app").unwrap();
        app
    }

    /// A made-up release: the app in a .tar.gz and a latest.json naming it, both as file:// addresses.
    fn release(at: &Path, id: &str) -> String {
        let built = at.join("built");
        fake_app(&built, id);
        let archive = at.join("release.tar.gz");
        run(Command::new("/usr/bin/tar").arg("-czf").arg(&archive).arg("-C").arg(&built).arg(format!("{SERVICE_APP_NAME}.app")), "packing").unwrap();
        let manifest = at.join("latest.json");
        std::fs::write(&manifest, format!(r#"{{"version":"1.0.0","platforms":{{"{SERVICE_PLATFORM}":{{"url":"file://{}","signature":"x"}}}}}}"#, archive.display())).unwrap();
        format!("file://{}", manifest.display())
    }

    fn installer(apps: &Path, latest_json: String, requirement: String) -> Installer {
        Installer { folders: vec![apps.to_path_buf()], latest_json, requirement, open: record }
    }

    #[test]
    fn an_installed_service_is_opened_and_never_replaced() {
        let d = dir("installed");
        let apps = d.0.join("Applications");
        let app = fake_app(&apps, SERVICE_BUNDLE_ID);
        let before = std::fs::metadata(app.join("Contents/MacOS/service")).unwrap().modified().unwrap();
        let done = installer(&apps, "file:///nowhere/latest.json".into(), ad_hoc()).install().unwrap();
        assert_eq!(done, Installed { done: "opened", path: app.display().to_string() });
        assert_eq!(opened(&d.0), vec![app.clone()]);
        assert_eq!(std::fs::metadata(app.join("Contents/MacOS/service")).unwrap().modified().unwrap(), before);
    }

    #[test]
    fn an_installed_copy_not_signed_by_the_team_and_notarized_is_never_opened_or_handed_a_link() {
        let d = dir("installed-impostor");
        let apps = d.0.join("Applications");
        fake_app(&apps, SERVICE_BUNDLE_ID);
        let i = installer(&apps, "file:///nowhere/latest.json".into(), requirement("ABCDE12345").unwrap());
        let err = i.install().unwrap_err();
        assert!(err.contains("is not the team's notarized build"), "{err}");
        assert!(i.connect(LINK).unwrap_err().contains("is not the team's notarized build"));
        assert!(opened(&d.0).is_empty());
    }

    #[test]
    fn the_connect_link_goes_to_the_checked_installed_copy_and_no_other_link_does() {
        let d = dir("connect");
        let apps = d.0.join("Applications");
        let i = installer(&apps, "file:///nowhere/latest.json".into(), ad_hoc());
        assert_eq!(i.connect(LINK).unwrap_err(), "Messages Service is not installed");
        let app = fake_app(&apps, SERVICE_BUNDLE_ID);
        assert!(i.connect("file:///etc/passwd").is_err());
        i.connect(LINK).unwrap();
        assert_eq!(opened(&d.0), vec![app]);
        assert_eq!(links(&d.0), vec![LINK.to_string()]);
    }

    #[test]
    fn a_file_already_named_like_the_write_check_is_left_alone() {
        let d = dir("probe");
        let probe = d.0.join(format!(".app-kit-write-check-{}", std::process::id()));
        std::fs::write(&probe, b"someone's").unwrap();
        assert!(!writable(&d.0));
        assert_eq!(std::fs::read(&probe).unwrap(), b"someone's");
    }

    #[test]
    fn a_copy_not_signed_by_the_team_and_notarized_never_reaches_applications() {
        let d = dir("refused");
        let apps = d.0.join("Applications");
        std::fs::create_dir_all(&apps).unwrap();
        let latest = release(&d.0, SERVICE_BUNDLE_ID);
        let err = installer(&apps, latest, requirement("ABCDE12345").unwrap()).install().unwrap_err();
        assert!(err.contains("signed by this team and notarized"), "{err}");
        assert_eq!(std::fs::read_dir(&apps).unwrap().count(), 0, "nothing in Applications, staging removed");
        assert!(opened(&d.0).is_empty());
    }

    #[test]
    fn a_copy_that_meets_the_requirement_is_moved_into_applications_and_opened() {
        let d = dir("installs");
        let apps = d.0.join("Applications");
        std::fs::create_dir_all(&apps).unwrap();
        let latest = release(&d.0, SERVICE_BUNDLE_ID);
        let done = installer(&apps, latest, ad_hoc()).install().unwrap();
        let app = apps.join(format!("{SERVICE_APP_NAME}.app"));
        assert_eq!(done, Installed { done: "installed", path: app.display().to_string() });
        assert_eq!(std::fs::read_dir(&apps).unwrap().map(|e| e.unwrap().file_name()).collect::<Vec<_>>(), vec![app.file_name().unwrap()]);
        assert_eq!(opened(&d.0), vec![app]);
    }

    #[test]
    fn another_bundle_under_the_services_name_is_not_the_service() {
        let d = dir("impostor");
        let apps = d.0.join("Applications");
        fake_app(&apps, "com.example.other");
        let i = installer(&apps, "file:///nowhere/latest.json".into(), requirement("ABCDE12345").unwrap());
        assert_eq!(i.installed(), None);
    }

    #[test]
    fn the_requirement_names_the_team_notarization_and_the_service() {
        assert_eq!(
            requirement("ABCDE12345").unwrap(),
            "anchor apple generic and certificate leaf[subject.OU] = \"ABCDE12345\" and notarized and identifier \"com.worktron.messages-service\""
        );
        assert!(requirement("abcde12345").is_err());
        assert!(requirement("ABCDE\" or true").is_err(), "nothing can be written into the requirement");
    }

    #[test]
    fn only_the_services_connect_link_is_opened() {
        assert!(is_connect_link("messages-service://connect?address=https%3A%2F%2Fapp.example.com%2Fapi%2Fmessages-service&code=ab"));
        assert!(!is_connect_link("messages-service://other?address=x&code=y"));
        assert!(!is_connect_link("https://example.com/?address=x&code=y"));
    }

    #[test]
    fn a_manifest_names_an_https_archive_for_this_mac() {
        assert_eq!(archive_url(r#"{"platforms":{"darwin-aarch64":{"url":"https://example.com/a.tar.gz"}}}"#).unwrap(), "https://example.com/a.tar.gz");
        assert!(archive_url(r#"{"platforms":{"darwin-aarch64":{"url":"http://example.com/a.tar.gz"}}}"#).is_err());
        assert!(archive_url(r#"{"platforms":{}}"#).is_err());
    }
}
