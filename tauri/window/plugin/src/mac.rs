//! What only the Mac window does: Restart once a newer build is installed, View's zoom kept across launches, the page
//! told when the window goes into or out of full screen, and a window shown only once it has been put where it was.
//! The page's names are tauri/window/names.ts's, and test/tauri-window.test.ts holds them to it.

use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use tauri::Url;

/// The host of the link the page opens to restart the app, `<scheme>://restart`.
const RESTART_HOST: &str = "restart";
/// The flag and window event that tell the page a newer build of the app is installed than the one running.
const NEWER_BUILD_FLAG: &str = "__APP_KIT_NEWER_BUILD__";
const NEWER_BUILD_EVENT: &str = "app-kit-newer-build";
/// The flag and window event that tell the page whether the window is in full screen, where its buttons hide.
const FULL_SCREEN_FLAG: &str = "__APP_KIT_FULL_SCREEN__";
const FULL_SCREEN_EVENT: &str = "app-kit-full-screen";

pub(crate) fn is_restart_link(url: &Url, scheme: Option<&str>) -> bool {
    scheme.is_some_and(|scheme| url.scheme() == scheme) && url.host_str() == Some(RESTART_HOST)
}

/// Which file the app's program is. Installing the app again puts a new file in its place, so a different file at the
/// same path means a newer build is installed than the one running.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct ProgramFile {
    device: u64,
    inode: u64,
    modified: i64,
}

pub(crate) fn program_file(path: &Path) -> Option<ProgramFile> {
    let meta = std::fs::metadata(path).ok()?;
    Some(ProgramFile { device: meta.dev(), inode: meta.ino(), modified: meta.mtime() })
}

/// Whether a newer build is installed than the one running. A program file missing for the moment, as halfway through
/// an install, is not one.
pub(crate) fn newer_build_installed(running: Option<ProgramFile>, installed: Option<ProgramFile>) -> bool {
    matches!((running, installed), (Some(running), Some(installed)) if running != installed)
}

/// The program the app was launched from, read once at launch.
pub(crate) struct Launched {
    pub(crate) path: Option<PathBuf>,
    pub(crate) file: Option<ProgramFile>,
}

impl Launched {
    pub(crate) fn now() -> Self {
        let path = std::env::current_exe().ok();
        let file = path.as_deref().and_then(program_file);
        Launched { path, file }
    }

    pub(crate) fn newer_build_installed(&self) -> bool {
        newer_build_installed(self.file, self.path.as_deref().and_then(program_file))
    }
}

pub(crate) fn newer_build_script() -> String {
    format!("window.{NEWER_BUILD_FLAG} = true; window.dispatchEvent(new Event({NEWER_BUILD_EVENT:?}));")
}

pub(crate) fn full_screen_script(full_screen: bool) -> String {
    format!("window.{FULL_SCREEN_FLAG} = {full_screen}; window.dispatchEvent(new Event({FULL_SCREEN_EVENT:?}));")
}

/// View > Actual Size, Zoom In and Zoom Out, which the window does itself, as Safari does: the page's text and layout
/// grow or shrink by the steps in ZOOM_LEVELS, and the window keeps its zoom across reloads and launches.
pub(crate) const ACTUAL_SIZE: &str = "app-kit-actual-size";
pub(crate) const ZOOM_IN: &str = "app-kit-zoom-in";
pub(crate) const ZOOM_OUT: &str = "app-kit-zoom-out";
const ZOOM_LEVELS: [f64; 11] = [0.5, 0.75, 0.85, 1.0, 1.15, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
/// The file in the app's data folder that holds the zoom, as a number, 1 being actual size: timescale's name, so a zoom
/// saved before it took the kit carries over.
const ZOOM_FILE: &str = "zoom";

/// The zoom a menu item asks for from `current`, or None for an item that is not a zoom: the next level up or down, or
/// actual size. A zoom between two levels moves to the nearer one in that direction, and one at either end stays.
pub(crate) fn zoomed(id: &str, current: f64) -> Option<f64> {
    let (smallest, largest) = (ZOOM_LEVELS[0], ZOOM_LEVELS[ZOOM_LEVELS.len() - 1]);
    match id {
        ACTUAL_SIZE => Some(1.0),
        ZOOM_IN => Some(ZOOM_LEVELS.into_iter().find(|level| *level > current + 1e-6).unwrap_or(largest)),
        ZOOM_OUT => Some(ZOOM_LEVELS.into_iter().rev().find(|level| *level < current - 1e-6).unwrap_or(smallest)),
        _ => None,
    }
}

/// The zoom saved in `folder`, or actual size for a file that is missing or holds anything outside the levels.
pub(crate) fn saved_zoom(folder: &Path) -> f64 {
    let (smallest, largest) = (ZOOM_LEVELS[0], ZOOM_LEVELS[ZOOM_LEVELS.len() - 1]);
    std::fs::read_to_string(folder.join(ZOOM_FILE))
        .ok()
        .and_then(|text| text.trim().parse::<f64>().ok())
        .filter(|zoom| (smallest..=largest).contains(zoom))
        .unwrap_or(1.0)
}

/// Saves the zoom in `folder`, written under another name and renamed into place, so the next launch never reads half
/// a number.
pub(crate) fn save_zoom(folder: &Path, zoom: f64) -> std::io::Result<()> {
    std::fs::create_dir_all(folder)?;
    let aside = folder.join(format!("{ZOOM_FILE}.new"));
    std::fs::write(&aside, zoom.to_string())?;
    std::fs::rename(aside, folder.join(ZOOM_FILE))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A folder of this test's own, in this test process's folder outside the system's temporary folder, removed when
    /// the test ends however it ends.
    struct Folder(PathBuf);

    impl Folder {
        fn new(name: &str) -> Self {
            let path = Path::new("/tmp/app-kit-tests").join(std::process::id().to_string()).join(name);
            let _ = std::fs::remove_dir_all(&path);
            Folder(path)
        }
    }

    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
            // The process's folder goes too once no other test of it has a folder there.
            if let Some(process) = self.0.parent() {
                let _ = std::fs::remove_dir(process);
            }
        }
    }

    fn file(inode: u64, modified: i64) -> Option<ProgramFile> {
        Some(ProgramFile { device: 1, inode, modified })
    }

    #[test]
    fn a_newer_build_is_another_program_file_at_the_same_path() {
        assert!(!newer_build_installed(file(10, 100), file(10, 100)));
        assert!(newer_build_installed(file(10, 100), file(11, 200)));
        assert!(newer_build_installed(file(10, 100), file(10, 200)));
        // Missing halfway through an install, or unreadable at launch: nothing to offer.
        assert!(!newer_build_installed(file(10, 100), None));
        assert!(!newer_build_installed(None, file(11, 200)));
    }

    #[test]
    fn the_running_program_reads_as_itself() {
        assert!(!Launched::now().newer_build_installed());
        assert_eq!(program_file(Path::new("/no/such/program")), None);
    }

    #[test]
    fn only_the_apps_own_restart_link_restarts() {
        let url = |s: &str| s.parse::<Url>().unwrap();
        assert!(is_restart_link(&url("com.example.app://restart"), Some("com.example.app")));
        assert!(!is_restart_link(&url("com.example.app://restart"), None));
        assert!(!is_restart_link(&url("other.app://restart"), Some("com.example.app")));
        assert!(!is_restart_link(&url("com.example.app://sign-in?ticket=abc"), Some("com.example.app")));
        assert!(!is_restart_link(&url("https://restart/"), Some("com.example.app")));
    }

    #[test]
    fn the_page_is_told_by_a_flag_it_can_read_late_and_an_event() {
        assert_eq!(newer_build_script(), r#"window.__APP_KIT_NEWER_BUILD__ = true; window.dispatchEvent(new Event("app-kit-newer-build"));"#);
        assert_eq!(full_screen_script(true), r#"window.__APP_KIT_FULL_SCREEN__ = true; window.dispatchEvent(new Event("app-kit-full-screen"));"#);
        assert!(full_screen_script(false).starts_with("window.__APP_KIT_FULL_SCREEN__ = false;"));
    }

    #[test]
    fn zoom_steps_through_the_levels_and_stops_at_either_end() {
        assert_eq!(zoomed(ZOOM_IN, 1.0), Some(1.15));
        assert_eq!(zoomed(ZOOM_OUT, 1.0), Some(0.85));
        assert_eq!(zoomed(ZOOM_IN, 3.0), Some(3.0));
        assert_eq!(zoomed(ZOOM_OUT, 0.5), Some(0.5));
        assert_eq!(zoomed(ACTUAL_SIZE, 2.5), Some(1.0));
        // Between two levels, a step goes to the nearer one in its direction.
        assert_eq!(zoomed(ZOOM_IN, 1.1), Some(1.15));
        assert_eq!(zoomed(ZOOM_OUT, 1.1), Some(1.0));
        assert_eq!(zoomed("reload", 1.0), None);
    }

    #[test]
    fn a_saved_zoom_reads_back_and_one_outside_the_levels_or_unreadable_is_actual_size() {
        let folder = Folder::new("zoom");
        assert_eq!(saved_zoom(&folder.0), 1.0);
        // Every step lands back on a level, so a saved zoom always reads back.
        let mut zoom = 1.0;
        for _ in 0..12 {
            zoom = zoomed(ZOOM_IN, zoom).unwrap();
            save_zoom(&folder.0, zoom).unwrap();
            assert_eq!(saved_zoom(&folder.0), zoom);
        }
        assert!(!folder.0.join("zoom.new").exists(), "the file written aside is renamed into place");
        for text in ["1.25\n", "", "huge", "40", "0.1", "NaN"] {
            std::fs::write(folder.0.join(ZOOM_FILE), text).unwrap();
            let expected = if text == "1.25\n" { 1.25 } else { 1.0 };
            assert_eq!(saved_zoom(&folder.0), expected, "{text:?}");
        }
    }
}
