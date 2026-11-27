//! Downloads on the Mac. A link the page marks `download`, or a file WebKit cannot show, is saved to the Downloads
//! folder under the name the site suggests, numbered "name (1).ext" when that name is taken, and once it has arrived
//! the window asks Finder to select it. It never opens it: a file from the site can come from anyone.
//!
//! wry cancels every download in a window with no download handler, so without this a Download link did nothing. wry
//! picks the destination, which `Requested` keeps, and passes no path to `Finished`, even on success, so the
//! destination is remembered at `Requested` by the download's address, first in first out for the same address
//! downloaded twice, and taken at `Finished`. Each step is logged by host only, never a path, query or file name.

use crate::links::loggable;
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Url;

/// The downloads under way in one window, and what is done with each once it has arrived.
pub(crate) struct Downloads {
    waiting: Mutex<HashMap<String, VecDeque<PathBuf>>>,
    reveal: Box<dyn Fn(&Path) + Send + Sync>,
}

impl Downloads {
    pub(crate) fn new(reveal: impl Fn(&Path) + Send + Sync + 'static) -> Self {
        Downloads { waiting: Mutex::default(), reveal: Box::new(reveal) }
    }

    /// A download has started: it goes where wry put it, which is remembered for when it finishes.
    pub(crate) fn requested(&self, url: &Url, destination: &Path) -> bool {
        log::info!("downloading a file from {} to the Downloads folder", loggable(url));
        self.waiting.lock().unwrap().entry(url.as_str().to_owned()).or_default().push_back(destination.to_owned());
        true
    }

    /// A download has ended: one that arrived is selected in Finder, one that failed is forgotten.
    pub(crate) fn finished(&self, url: &Url, success: bool) {
        let destination = {
            let mut waiting = self.waiting.lock().unwrap();
            let destination = waiting.get_mut(url.as_str()).and_then(VecDeque::pop_front);
            if waiting.get(url.as_str()).is_some_and(VecDeque::is_empty) {
                waiting.remove(url.as_str());
            }
            destination
        };
        match (success, destination) {
            (true, Some(destination)) => {
                log::info!("downloaded a file from {} to the Downloads folder, selecting it in Finder", loggable(url));
                (self.reveal)(&destination);
            }
            (true, None) => log::warn!("a download from {} finished that never started here, so Finder is not asked", loggable(url)),
            (false, _) => log::warn!("a download from {} failed, so nothing was saved", loggable(url)),
        }
    }
}

/// Selects `path` in a Finder window, bringing Finder forward, as Safari's downloads do. It never opens the file.
pub(crate) fn select_in_finder(path: &Path) {
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSArray, NSString, NSURL};
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    NSWorkspace::sharedWorkspace().activateFileViewerSelectingURLs(&NSArray::from_retained_slice(&[url]));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn recorded() -> (Downloads, Arc<Mutex<Vec<PathBuf>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let record = seen.clone();
        (Downloads::new(move |path| record.lock().unwrap().push(path.to_owned())), seen)
    }

    fn url(s: &str) -> Url {
        s.parse().unwrap()
    }

    #[test]
    fn a_finished_download_is_selected_where_it_was_saved() {
        let (downloads, seen) = recorded();
        let file = url("https://app.example.com/documents/7/file?token=abc");
        assert!(downloads.requested(&file, Path::new("/Downloads/Exhibit A.pdf")));
        assert!(seen.lock().unwrap().is_empty(), "nothing is selected before it has arrived");
        downloads.finished(&file, true);
        assert_eq!(*seen.lock().unwrap(), [PathBuf::from("/Downloads/Exhibit A.pdf")]);
        assert!(downloads.waiting.lock().unwrap().is_empty(), "nothing is kept once it has finished");
    }

    #[test]
    fn a_failed_download_is_forgotten_and_never_selected() {
        let (downloads, seen) = recorded();
        let file = url("https://app.example.com/documents/7/file");
        downloads.requested(&file, Path::new("/Downloads/Exhibit A.pdf"));
        downloads.finished(&file, false);
        assert!(seen.lock().unwrap().is_empty());
        assert!(downloads.waiting.lock().unwrap().is_empty());
    }

    // wry numbers the second copy "Exhibit A (1).pdf"; each finish takes the oldest destination for its address.
    #[test]
    fn the_same_file_downloaded_twice_selects_each_copy_in_turn() {
        let (downloads, seen) = recorded();
        let file = url("https://app.example.com/documents/7/file");
        let other = url("https://app.example.com/documents/8/file");
        downloads.requested(&file, Path::new("/Downloads/Exhibit A.pdf"));
        downloads.requested(&other, Path::new("/Downloads/Exhibit B.pdf"));
        downloads.requested(&file, Path::new("/Downloads/Exhibit A (1).pdf"));
        downloads.finished(&file, true);
        downloads.finished(&other, true);
        downloads.finished(&file, true);
        let expected: Vec<PathBuf> = ["/Downloads/Exhibit A.pdf", "/Downloads/Exhibit B.pdf", "/Downloads/Exhibit A (1).pdf"].map(PathBuf::from).into();
        assert_eq!(*seen.lock().unwrap(), expected);
    }

    #[test]
    fn a_finish_with_no_start_selects_nothing() {
        let (downloads, seen) = recorded();
        downloads.finished(&url("https://app.example.com/documents/7/file"), true);
        assert!(seen.lock().unwrap().is_empty());
    }
}
