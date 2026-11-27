//! Opening the app when the person logs in, through macOS's own login items (System Settings › General › Login Items),
//! for the switch in the kit's Settings window (settings.rs). What the switch shows is read from macOS every time,
//! never kept: before and after each change, and whenever the window comes forward, so a change made in System
//! Settings shows too.
//!
//! macOS's errors for this come in more than one numbering, which overlap, so whether a change worked is judged from
//! the state macOS reports after it, never from an error's code; a failure shows macOS's own words.
//!
//! An app whose menu asks for it (`AppMenu::open_at_login_by_default`) turns the login item on by itself once, at the
//! first launch of a copy the release command built (`first_launch`), and never again: a mark in the app's data folder
//! says it set the item once, written before macOS is asked and taken away again when macOS refuses, so nothing is
//! turned on without it and a refusal is tried again next launch, and written by every change made through the switch,
//! so the person's own choice is never overridden. The mark is the app's own past, never the login
//! item's state, which is read from macOS every time. Tests pass a stand-in for macOS (`LoginItems`), never this Mac's.

use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};

/// The variable `app-kit mac release` builds with, set to the commit it builds (names.ts's `MAC_RELEASE_VARIABLE`).
/// Only a copy it built turns open at login on by itself: a hand build, a release-profile one included, never does.
pub(crate) const MAC_RELEASE_VARIABLE: &str = "APP_KIT_MAC_RELEASE";
/// The commit, in a copy the release command built. Rust records the variable as one of the plugin's inputs, so Cargo
/// builds the plugin again whenever it changes. A unit test is never a release.
#[cfg(not(test))]
const RELEASE: Option<&str> = option_env!("APP_KIT_MAC_RELEASE");
#[cfg(test)]
const RELEASE: Option<&str> = None;
/// The mark, in the app's data folder, that the app has set open at login once: by itself at a first launch, or by the
/// person through the switch.
pub(crate) const MARK: &str = "open-at-login-set-once";

/// What the page is told the login item is: on, waiting for the person's approval in Login Items, off, or not
/// possible on this macOS, which has no login item service before macOS 13. The names are names.ts's
/// `OPEN_AT_LOGIN_STATES`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum State {
    Enabled,
    RequiresApproval,
    Off,
    NotAvailable,
}

/// macOS's own answer, as `SMAppService.status` gives it, with its raw values, so it is logged in macOS's words.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Status {
    NotRegistered,
    Enabled,
    RequiresApproval,
    /// macOS knows nothing of the item: an app never turned on, or one turned off in System Settings.
    NotFound,
    /// A value this build does not know, from a later macOS.
    Other(isize),
    /// This macOS has no login item service.
    NotAvailable,
}

impl Status {
    pub(crate) fn from_raw(raw: isize) -> Self {
        match raw {
            0 => Status::NotRegistered,
            1 => Status::Enabled,
            2 => Status::RequiresApproval,
            3 => Status::NotFound,
            other => Status::Other(other),
        }
    }

    /// The switch's state. "Not found" is macOS's normal answer for an item never turned on, so it is plain off.
    pub(crate) fn state(self) -> State {
        match self {
            Status::Enabled => State::Enabled,
            Status::RequiresApproval => State::RequiresApproval,
            Status::NotRegistered | Status::NotFound | Status::Other(_) => State::Off,
            Status::NotAvailable => State::NotAvailable,
        }
    }

    /// macOS's answer in words, for the log.
    pub(crate) fn words(self) -> String {
        match self {
            Status::NotRegistered => "not registered".into(),
            Status::Enabled => "enabled".into(),
            Status::RequiresApproval => "requires approval".into(),
            Status::NotFound => "not found".into(),
            Status::Other(raw) => format!("an answer this build does not know ({raw})"),
            Status::NotAvailable => "not available before macOS 13".into(),
        }
    }
}

/// What the page is told after reading or changing the login item: its state, and macOS's own words when a change
/// did not take.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct Answer {
    pub(crate) state: State,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<String>,
}

/// Whether turning the item on (`on`) or off worked, judged by the state macOS reports after it: on worked when the
/// item is on or waiting for approval, off when it is off.
pub(crate) fn took(on: bool, after: State) -> bool {
    match after {
        State::Enabled | State::RequiresApproval => on,
        State::Off => !on,
        State::NotAvailable => false,
    }
}

/// The page's answer to a change, from the state after it and macOS's error, if it gave one. A change that took is
/// no error even when macOS gave one (as for an item already on); one that did not take shows macOS's words, or says
/// it did not take when macOS gave none.
pub(crate) fn change_answer(on: bool, after: Status, error: Option<String>) -> Answer {
    let state = after.state();
    if took(on, state) {
        return Answer { state, error: None };
    }
    let error = error.unwrap_or_else(|| match state {
        State::NotAvailable => "Opening at login needs macOS 13 or later.".into(),
        _ => "macOS left it as it was.".into(),
    });
    Answer { state, error: Some(error) }
}

fn on_or_off(on: bool) -> &'static str {
    if on {
        "on"
    } else {
        "off"
    }
}

/// The login item's state, read from macOS and logged.
pub(crate) fn read(items: &impl LoginItems) -> Answer {
    let status = items.status();
    log::info!("open at login: macOS says {}", status.words());
    Answer { state: status.state(), error: None }
}

/// Turns the login item on or off through the switch, then reads it again; the page is told the state macOS reports
/// after it. The person chose, so the mark that it was set once is written whatever macOS answered, and a first launch
/// never overrides them.
pub(crate) fn set(items: &impl LoginItems, on: bool, data: Option<&Path>) -> Answer {
    let _changing = changing();
    keep_mark(data, &format!("turned {} through the Settings switch", on_or_off(on)));
    let error = items.change(on);
    let after = items.status();
    let answer = change_answer(on, after, error.as_ref().map(|error| error.message.clone()));
    match (&answer.error, &error) {
        (None, _) => log::info!("open at login: turned {}, macOS says {}", on_or_off(on), after.words()),
        (Some(_), Some(error)) => log::warn!(
            "open at login: could not turn {} ({}), macOS says {}",
            on_or_off(on),
            error.words(),
            after.words()
        ),
        (Some(_), None) => {
            log::warn!("open at login: could not turn {}, with no error from macOS; macOS says {}", on_or_off(on), after.words())
        }
    }
    answer
}

/// Opens System Settings at Login Items, where the person approves the item or turns it off.
pub(crate) fn open_login_items() {
    log::info!("open at login: opening System Settings at Login Items");
    mac::open_login_items();
}

/// macOS's error from a change: its domain, code and words.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct MacError {
    pub(crate) domain: String,
    pub(crate) code: isize,
    pub(crate) message: String,
}

impl MacError {
    /// The error as the log writes it.
    fn words(&self) -> String {
        format!("{} {}: {}", self.domain, self.code, self.message)
    }
}

/// macOS's login item for the app itself, which the kit reads and changes: this Mac's (`ThisMac`), or a test's
/// stand-in.
pub(crate) trait LoginItems {
    fn status(&self) -> Status;
    /// Registers or unregisters the app; macOS's error, if it gave one.
    fn change(&self, on: bool) -> Option<MacError>;
}

/// This Mac's own login items, through `SMAppService.mainApp`.
pub(crate) struct ThisMac;

impl LoginItems for ThisMac {
    fn status(&self) -> Status {
        mac::status()
    }

    fn change(&self, on: bool) -> Option<MacError> {
        mac::change(on)
    }
}

/// Writes the mark that the app has set open at login once, with why, under another name first and renamed into
/// place, so no launch reads half of one.
fn write_mark(data: &Path, why: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(data)?;
    let writing = data.join(format!("{MARK}.writing"));
    std::fs::write(&writing, format!("{why}\n"))?;
    std::fs::rename(&writing, data.join(MARK))
}

/// Writes the mark, and says in the log when it could not.
fn keep_mark(data: Option<&Path>, why: &str) {
    let written = match data {
        Some(data) => write_mark(data, why).map_err(|error| error.to_string()),
        None => Err("the app has no data folder".into()),
    };
    if let Err(error) = written {
        log::warn!("open at login: could not keep the mark that it was set once ({error}), so a later launch may set it again");
    }
}

/// What the first launch did about the login item.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum FirstLaunch {
    /// Not a copy the release command built, so left as it is.
    HandBuild,
    /// Started by a release's menu check on a worker Mac, whose Login Items it leaves alone.
    MenuCheck,
    /// The app bundles no Settings page, so the person would have no switch in the app to turn it off.
    NoSwitch,
    /// The app has no data folder to keep its mark in, so it cannot know whether it set the item before.
    NoDataFolder,
    /// The mark could not be written, with why: an item turned on with no mark could be turned on again after the
    /// person turned it off, so it is left off.
    MarkNotKept(String),
    /// Set once already, at an earlier launch or by the person through the switch, so left as the person has it.
    SetBefore,
    /// This macOS has no login item service; a later launch on macOS 13 or later turns it on.
    NotAvailable,
    /// Turned on, and macOS's answer: enabled, or waiting for the person's approval.
    TurnedOn(Status),
    /// macOS did not turn it on: its answer after, and its error; the next launch tries again.
    Refused { after: Status, error: Option<MacError> },
}

/// What a launch knows when it decides: the commit, in a copy the release command built; whether the release's menu
/// check started it; whether the app bundles the Settings page, whose switch turns the item off; and the app's data
/// folder, where the mark is kept.
pub(crate) struct Launch<'a> {
    pub(crate) release: Option<&'a str>,
    pub(crate) menu_check: bool,
    pub(crate) settings_page: bool,
    pub(crate) data: Option<&'a Path>,
}

/// Held while the first launch or the switch decides and changes the login item, so a change the person makes through
/// the switch while macOS is still answering the first launch's is made after it, and stands.
static CHANGING: Mutex<()> = Mutex::new(());

fn changing() -> std::sync::MutexGuard<'static, ()> {
    CHANGING.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Turns the login item on once, at the first launch of a copy the release command built, unless the menu check
/// started the app, the app has no switch to turn it off, or its data folder holds the mark that it was set before.
/// The mark is written before macOS is asked, and nothing is turned on when it cannot be, so the item is never on
/// without the mark that keeps a later launch from turning it on again; a refusal takes the mark away, so it is tried
/// again next launch.
pub(crate) fn first_launch(items: &impl LoginItems, launch: &Launch) -> FirstLaunch {
    if launch.release.is_none() {
        return FirstLaunch::HandBuild;
    }
    if launch.menu_check {
        return FirstLaunch::MenuCheck;
    }
    if !launch.settings_page {
        return FirstLaunch::NoSwitch;
    }
    let Some(data) = launch.data else { return FirstLaunch::NoDataFolder };
    let _changing = changing();
    if data.join(MARK).exists() {
        return FirstLaunch::SetBefore;
    }
    if items.status() == Status::NotAvailable {
        return FirstLaunch::NotAvailable;
    }
    if let Err(error) = write_mark(data, "turning on at first launch") {
        return FirstLaunch::MarkNotKept(error.to_string());
    }
    let error = items.change(true);
    let after = items.status();
    if !took(true, after.state()) {
        if let Err(removed) = std::fs::remove_file(data.join(MARK)) {
            log::warn!("open at login: could not take away the mark after macOS refused ({removed}), so no later launch tries again");
        }
        return FirstLaunch::Refused { after, error };
    }
    // The mark is there already; this only adds macOS's answer to it.
    let _ = write_mark(data, &format!("turned on at first launch, macOS said {}", after.words()));
    FirstLaunch::TurnedOn(after)
}

/// The line the log says for what the first launch did, and its level.
pub(crate) fn first_launch_line(outcome: &FirstLaunch) -> (log::Level, String) {
    use log::Level::{Info, Warn};
    match outcome {
        FirstLaunch::HandBuild => (
            Info,
            format!("open at login: left as it is at launch, since the release command did not build this copy (no {MAC_RELEASE_VARIABLE})"),
        ),
        FirstLaunch::MenuCheck => (Info, "open at login: left as it is under the menu check".into()),
        FirstLaunch::NoSwitch => (
            Warn,
            format!(
                "open at login: not turned on at first launch, since the app bundles no {} with the switch that turns it \
                 off: its tauri.conf.json frontendDist must be the kit's start folder",
                crate::settings::SETTINGS_PAGE
            ),
        ),
        FirstLaunch::NoDataFolder => {
            (Warn, "open at login: not turned on at first launch, since the app has no data folder to keep the mark that it did".into())
        }
        FirstLaunch::MarkNotKept(error) => (
            Warn,
            format!("open at login: not turned on at first launch, since the mark that it did could not be kept ({error})"),
        ),
        FirstLaunch::SetBefore => (Info, "open at login: set once already, so left as the person has it".into()),
        FirstLaunch::NotAvailable => (Info, "open at login: not turned on at first launch, since it needs macOS 13 or later".into()),
        FirstLaunch::TurnedOn(after) => (Info, format!("open at login: turned on at first launch, macOS says {}", after.words())),
        FirstLaunch::Refused { after, error } => (
            Warn,
            format!(
                "open at login: could not turn on at first launch ({}), macOS says {}; the next launch tries again",
                error.as_ref().map(MacError::words).unwrap_or_else(|| "no error from macOS".into()),
                after.words()
            ),
        ),
    }
}

/// Where the first launch's turn-on stands in a running app: asked for by the app's menu, and the plugin set up, so
/// the log is too. It starts once both are done, in whichever order, and only once.
#[derive(Default)]
pub(crate) struct ByDefault(Mutex<Steps>);

#[derive(Default, Debug)]
struct Steps {
    asked: bool,
    ready: bool,
    started: bool,
}

impl Steps {
    fn start_now(&mut self) -> bool {
        let start = self.asked && self.ready && !self.started;
        self.started |= start;
        start
    }
}

/// The app's menu asks for open at login by default. Answers whether the turn-on started now.
pub(crate) fn asked<R: Runtime>(app: &AppHandle<R>) -> bool {
    step(app, |steps| steps.asked = true)
}

/// The plugin is set up. Answers whether the turn-on started now.
pub(crate) fn ready<R: Runtime>(app: &AppHandle<R>) -> bool {
    step(app, |steps| steps.ready = true)
}

fn step<R: Runtime>(app: &AppHandle<R>, done: impl FnOnce(&mut Steps)) -> bool {
    app.manage(ByDefault::default());
    let Some(state) = app.try_state::<ByDefault>() else { return false };
    let start = {
        let mut steps = state.0.lock().unwrap();
        done(&mut steps);
        steps.start_now()
    };
    if start {
        let data = app.path().app_data_dir().ok();
        let menu_check = std::env::var_os(crate::menu_check::MENU_CHECK_VARIABLE).is_some();
        let settings_page = crate::settings::bundles_settings_page(app);
        // macOS may take a moment to answer, so the launch does not wait on it.
        std::thread::spawn(move || {
            let launch = Launch { release: RELEASE, menu_check, settings_page, data: data.as_deref() };
            let (level, line) = first_launch_line(&first_launch(&ThisMac, &launch));
            log::log!(level, "{line}");
        });
    }
    start
}

mod mac {
    use super::{MacError, Status};
    use objc2_service_management::SMAppService;

    fn available() -> bool {
        objc2::available!(macos = 13.0)
    }

    pub(super) fn status() -> Status {
        if !available() {
            return Status::NotAvailable;
        }
        // SAFETY: SMAppService exists from macOS 13, checked above; mainAppService and status take no arguments.
        let status = unsafe { SMAppService::mainAppService().status() };
        Status::from_raw(status.0)
    }

    /// Registers or unregisters the app itself as a login item; macOS's error, if it gave one.
    pub(super) fn change(on: bool) -> Option<MacError> {
        if !available() {
            return None;
        }
        // SAFETY: as in `status`; both calls take no arguments and report failure through the NSError they return.
        let result = unsafe {
            let service = SMAppService::mainAppService();
            if on {
                service.registerAndReturnError()
            } else {
                service.unregisterAndReturnError()
            }
        };
        result.err().map(|error| MacError {
            domain: error.domain().to_string(),
            code: error.code(),
            message: error.localizedDescription().to_string(),
        })
    }

    pub(super) fn open_login_items() {
        if available() {
            // SAFETY: as in `status`; it takes no arguments.
            unsafe { SMAppService::openSystemSettingsLoginItems() };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_status_macos_reports_is_shown() {
        assert_eq!(Status::from_raw(0).state(), State::Off);
        assert_eq!(Status::from_raw(1).state(), State::Enabled);
        assert_eq!(Status::from_raw(2).state(), State::RequiresApproval);
        // macOS's answer for an item never turned on, or turned off in System Settings: plain off, no warning.
        assert_eq!(Status::from_raw(3).state(), State::Off);
        assert_eq!(Status::from_raw(9).state(), State::Off);
        assert_eq!(Status::NotAvailable.state(), State::NotAvailable);
        assert_eq!(Status::from_raw(3).words(), "not found");
        assert_eq!(Status::from_raw(9).words(), "an answer this build does not know (9)");
        // The page's names, which names.ts holds.
        let names: Vec<String> = [State::Enabled, State::RequiresApproval, State::Off, State::NotAvailable]
            .iter()
            .map(|state| serde_json::to_value(state).unwrap().as_str().unwrap().to_string())
            .collect();
        assert_eq!(names, ["enabled", "requires-approval", "off", "not-available"]);
    }

    #[test]
    fn a_change_is_judged_by_the_status_read_after_it() {
        // Turned on: on or waiting for approval is done, whatever error macOS gave (as for an item already on).
        assert_eq!(change_answer(true, Status::Enabled, None), Answer { state: State::Enabled, error: None });
        assert_eq!(
            change_answer(true, Status::Enabled, Some("Operation not permitted".into())),
            Answer { state: State::Enabled, error: None }
        );
        assert_eq!(change_answer(true, Status::RequiresApproval, None), Answer { state: State::RequiresApproval, error: None });
        // Turned on but still off: macOS's own words, or a plain line when it gave none.
        assert_eq!(
            change_answer(true, Status::NotFound, Some("Operation not permitted".into())),
            Answer { state: State::Off, error: Some("Operation not permitted".into()) }
        );
        assert_eq!(
            change_answer(true, Status::NotRegistered, None),
            Answer { state: State::Off, error: Some("macOS left it as it was.".into()) }
        );
        // Turned off: not registered and not found are both done; still on is not.
        assert_eq!(change_answer(false, Status::NotRegistered, None), Answer { state: State::Off, error: None });
        assert_eq!(change_answer(false, Status::NotFound, Some("not found".into())), Answer { state: State::Off, error: None });
        assert_eq!(
            change_answer(false, Status::Enabled, Some("Operation not permitted".into())),
            Answer { state: State::Enabled, error: Some("Operation not permitted".into()) }
        );
        assert_eq!(
            change_answer(true, Status::NotAvailable, None),
            Answer { state: State::NotAvailable, error: Some("Opening at login needs macOS 13 or later.".into()) }
        );
    }

    /// macOS's login items as a test makes them: the status it reports, what a change to on leaves it at and the error
    /// it gives, and every change asked of it. This Mac's own are never touched.
    struct StandIn {
        status: Cell<Status>,
        on_gives: RefCell<(Status, Option<MacError>)>,
        changes: RefCell<Vec<bool>>,
    }

    impl StandIn {
        fn new(status: Status) -> Self {
            StandIn { status: Cell::new(status), on_gives: RefCell::new((Status::Enabled, None)), changes: RefCell::new(Vec::new()) }
        }

        fn refusing(self, error: &str) -> Self {
            let error = MacError { domain: "SMAppServiceErrorDomain".into(), code: 1, message: error.into() };
            *self.on_gives.borrow_mut() = (Status::NotFound, Some(error));
            self
        }

        fn changes(&self) -> Vec<bool> {
            self.changes.borrow().clone()
        }
    }

    impl LoginItems for StandIn {
        fn status(&self) -> Status {
            self.status.get()
        }

        fn change(&self, on: bool) -> Option<MacError> {
            self.changes.borrow_mut().push(on);
            if on {
                let (after, error) = self.on_gives.borrow().clone();
                self.status.set(after);
                error
            } else {
                self.status.set(Status::NotRegistered);
                None
            }
        }
    }

    use crate::test_support::Folder;
    use std::cell::{Cell, RefCell};

    const RELEASE_BUILD: Option<&str> = Some("3f2a9c1");

    /// A launch of an app that bundles the Settings page.
    fn launch<'a>(release: Option<&'a str>, menu_check: bool, data: Option<&'a std::path::Path>) -> Launch<'a> {
        Launch { release, menu_check, settings_page: true, data }
    }

    #[test]
    fn a_release_turns_open_at_login_on_at_its_first_launch_and_never_again() {
        let data = Folder::new("first-launch-once");
        let mac = StandIn::new(Status::NotFound);
        let first = first_launch(&mac, &launch(RELEASE_BUILD, false, Some(&data.0)));
        assert_eq!(first, FirstLaunch::TurnedOn(Status::Enabled));
        assert_eq!(first_launch_line(&first), (log::Level::Info, "open at login: turned on at first launch, macOS says enabled".into()));
        assert!(data.0.join(MARK).exists());
        // The person turns it off in System Settings; every later launch leaves it so.
        mac.status.set(Status::NotFound);
        for _ in 0..3 {
            assert_eq!(first_launch(&mac, &launch(RELEASE_BUILD, false, Some(&data.0))), FirstLaunch::SetBefore);
        }
        assert_eq!(mac.changes(), [true]);
        assert_eq!(mac.status(), Status::NotFound);
    }

    #[test]
    fn waiting_for_the_persons_approval_counts_as_turned_on() {
        let data = Folder::new("first-launch-approval");
        let mac = StandIn::new(Status::NotRegistered);
        *mac.on_gives.borrow_mut() = (Status::RequiresApproval, None);
        assert_eq!(first_launch(&mac, &launch(RELEASE_BUILD, false, Some(&data.0))), FirstLaunch::TurnedOn(Status::RequiresApproval));
        assert!(data.0.join(MARK).exists());
        assert_eq!(first_launch(&mac, &launch(RELEASE_BUILD, false, Some(&data.0))), FirstLaunch::SetBefore);
        assert_eq!(mac.changes(), [true]);
    }

    #[test]
    fn a_refusal_writes_no_mark_and_the_next_launch_tries_again() {
        let data = Folder::new("first-launch-refused");
        let mac = StandIn::new(Status::NotFound).refusing("Operation not permitted");
        let refused = first_launch(&mac, &launch(RELEASE_BUILD, false, Some(&data.0)));
        assert!(matches!(&refused, FirstLaunch::Refused { after: Status::NotFound, error: Some(_) }));
        assert_eq!(
            first_launch_line(&refused),
            (
                log::Level::Warn,
                "open at login: could not turn on at first launch (SMAppServiceErrorDomain 1: Operation not permitted), macOS \
                 says not found; the next launch tries again"
                    .into()
            )
        );
        assert!(!data.0.join(MARK).exists());
        // The next launch, with macOS willing now.
        *mac.on_gives.borrow_mut() = (Status::Enabled, None);
        assert_eq!(first_launch(&mac, &launch(RELEASE_BUILD, false, Some(&data.0))), FirstLaunch::TurnedOn(Status::Enabled));
        assert_eq!(first_launch(&mac, &launch(RELEASE_BUILD, false, Some(&data.0))), FirstLaunch::SetBefore);
        assert_eq!(mac.changes(), [true, true]);
    }

    #[test]
    fn the_persons_change_through_the_switch_is_never_overridden() {
        for (name, on) in [("switch-off", false), ("switch-on", true)] {
            let data = Folder::new(name);
            let mac = StandIn::new(Status::Enabled);
            set(&mac, on, Some(&data.0));
            assert!(data.0.join(MARK).exists(), "{name}");
            // Even turned off and refused: the person chose, so a first launch leaves it.
            mac.status.set(Status::NotFound);
            assert_eq!(first_launch(&mac, &launch(RELEASE_BUILD, false, Some(&data.0))), FirstLaunch::SetBefore, "{name}");
            assert_eq!(mac.changes(), [on], "{name}");
        }
        // A change macOS refused still counts as the person's choice.
        let data = Folder::new("switch-refused");
        let mac = StandIn::new(Status::NotFound).refusing("Operation not permitted");
        assert!(set(&mac, true, Some(&data.0)).error.is_some());
        assert_eq!(first_launch(&mac, &launch(RELEASE_BUILD, false, Some(&data.0))), FirstLaunch::SetBefore);
        assert_eq!(mac.changes(), [true]);
    }

    #[test]
    fn a_hand_build_and_the_menu_check_leave_the_login_item_and_the_mark_alone() {
        let data = Folder::new("first-launch-left");
        let mac = StandIn::new(Status::NotFound);
        assert_eq!(first_launch(&mac, &launch(None, false, Some(&data.0))), FirstLaunch::HandBuild);
        assert_eq!(first_launch(&mac, &launch(None, true, Some(&data.0))), FirstLaunch::HandBuild);
        assert_eq!(first_launch(&mac, &launch(RELEASE_BUILD, true, Some(&data.0))), FirstLaunch::MenuCheck);
        assert!(mac.changes().is_empty());
        assert_eq!(std::fs::read_dir(&data.0).unwrap().count(), 0, "nothing written to the app's data folder");
        assert_eq!(first_launch_line(&FirstLaunch::MenuCheck).0, log::Level::Info, "the menu check refuses a warning");
        // A unit test is never a release, whatever the variable held when it was built.
        assert_eq!(RELEASE, None);
    }

    // An item turned on with no mark could be turned on again after the person turned it off, so the first launch keeps
    // its mark before it asks macOS, and asks nothing when it cannot.
    #[test]
    fn a_data_folder_that_cannot_be_written_leaves_the_login_item_off() {
        let folder = Folder::new("first-launch-unwritable");
        // A file where the app's data folder would be, so no folder can be made there.
        let data = folder.0.join("data");
        std::fs::write(&data, "").unwrap();
        let mac = StandIn::new(Status::NotFound);
        let outcome = first_launch(&mac, &launch(RELEASE_BUILD, false, Some(&data)));
        assert!(matches!(&outcome, FirstLaunch::MarkNotKept(_)), "{outcome:?}");
        assert_eq!(first_launch_line(&outcome).0, log::Level::Warn);
        assert!(mac.changes().is_empty(), "macOS was never asked");
        assert_eq!(mac.status(), Status::NotFound);
    }

    #[test]
    fn an_app_with_no_settings_page_has_no_switch_so_nothing_is_turned_on() {
        let data = Folder::new("first-launch-no-switch");
        let mac = StandIn::new(Status::NotFound);
        let no_switch = Launch { settings_page: false, ..launch(RELEASE_BUILD, false, Some(&data.0)) };
        assert_eq!(first_launch(&mac, &no_switch), FirstLaunch::NoSwitch);
        assert!(mac.changes().is_empty());
        assert!(!data.0.join(MARK).exists());
        assert_eq!(first_launch_line(&FirstLaunch::NoSwitch).0, log::Level::Warn);
    }

    /// macOS answering a turn-on only once the test lets it, and saying when it is asked.
    struct Held {
        items: std::sync::Mutex<StandIn>,
        asked: std::sync::mpsc::Sender<()>,
        answer: std::sync::Mutex<std::sync::mpsc::Receiver<()>>,
    }

    impl LoginItems for Held {
        fn status(&self) -> Status {
            self.items.lock().unwrap().status()
        }

        fn change(&self, on: bool) -> Option<MacError> {
            if on {
                self.asked.send(()).unwrap();
                self.answer.lock().unwrap().recv().unwrap();
            }
            self.items.lock().unwrap().change(on)
        }
    }

    // The switch, used while macOS is still answering the first launch's turn-on, waits for it and then stands: the
    // first launch holds the lock from reading the mark to writing it.
    #[test]
    fn a_change_through_the_switch_during_the_first_launch_is_made_after_it_and_stands() {
        use std::sync::mpsc;
        let data = Folder::new("first-launch-overtaken");
        let (asked, at_change) = mpsc::channel();
        let (let_answer, answer) = mpsc::channel();
        let mac = Held { items: std::sync::Mutex::new(StandIn::new(Status::NotFound)), asked, answer: std::sync::Mutex::new(answer) };
        let (switch_started, switch_is_waiting) = mpsc::channel();
        std::thread::scope(|scope| {
            let first = scope.spawn(|| first_launch(&mac, &launch(RELEASE_BUILD, false, Some(&data.0))));
            at_change.recv().unwrap();
            let switch = scope.spawn(|| {
                switch_started.send(()).unwrap();
                set(&mac, false, Some(&data.0))
            });
            switch_is_waiting.recv().unwrap();
            // The switch cannot reach macOS before the turn-on's answer, whatever the order the threads run in.
            assert_eq!(mac.items.lock().unwrap().changes(), Vec::<bool>::new());
            let_answer.send(()).unwrap();
            assert_eq!(first.join().unwrap(), FirstLaunch::TurnedOn(Status::Enabled));
            assert_eq!(switch.join().unwrap().state, State::Off);
        });
        let items = mac.items.lock().unwrap();
        assert_eq!(items.changes(), [true, false]);
        assert_eq!(items.status(), Status::NotRegistered);
        assert_eq!(std::fs::read_to_string(data.0.join(MARK)).unwrap(), "turned off through the Settings switch\n");
    }

    #[test]
    fn with_no_data_folder_or_before_macos_13_nothing_is_turned_on_or_marked() {
        let mac = StandIn::new(Status::NotFound);
        assert_eq!(first_launch(&mac, &launch(RELEASE_BUILD, false, None)), FirstLaunch::NoDataFolder);
        let data = Folder::new("first-launch-old-macos");
        let old = StandIn::new(Status::NotAvailable);
        assert_eq!(first_launch(&old, &launch(RELEASE_BUILD, false, Some(&data.0))), FirstLaunch::NotAvailable);
        assert!(mac.changes().is_empty() && old.changes().is_empty());
        assert!(!data.0.join(MARK).exists());
    }

    #[test]
    fn the_turn_on_starts_once_the_menu_asked_and_the_plugin_is_set_up_in_either_order_and_only_once() {
        let mut menu_first = Steps { asked: true, ..Default::default() };
        assert!(!menu_first.start_now());
        menu_first.ready = true;
        assert!(menu_first.start_now());
        assert!(!menu_first.start_now());
        // In a running app, the plugin set up before the app built its menu.
        let app = tauri::test::mock_app();
        assert!(!ready(app.handle()));
        assert!(asked(app.handle()));
        assert!(!asked(app.handle()));
        assert!(!ready(app.handle()));
        // An app whose menu never asks never starts it.
        let other = tauri::test::mock_app();
        assert!(!ready(other.handle()));
        assert!(!other.state::<ByDefault>().0.lock().unwrap().started);
    }

    #[test]
    fn the_page_is_told_the_state_and_an_error_only_when_there_is_one() {
        let on = serde_json::to_string(&Answer { state: State::Enabled, error: None }).unwrap();
        assert_eq!(on, r#"{"state":"enabled"}"#);
        let failed = serde_json::to_string(&Answer { state: State::Off, error: Some("No".into()) }).unwrap();
        assert_eq!(failed, r#"{"state":"off","error":"No"}"#);
    }
}
