//! Opening the app when the person logs in, through macOS's own login items (System Settings › General › Login Items),
//! for the switch in the kit's Settings window (settings.rs). What the switch shows is read from macOS every time,
//! never kept: before and after each change, and whenever the window comes forward, so a change made in System
//! Settings shows too.
//!
//! macOS's errors for this come in more than one numbering, which overlap, so whether a change worked is judged from
//! the state macOS reports after it, never from an error's code; a failure shows macOS's own words.

use serde::Serialize;

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
pub(crate) fn read() -> Answer {
    let status = mac::status();
    log::info!("open at login: macOS says {}", status.words());
    Answer { state: status.state(), error: None }
}

/// Turns the login item on or off, then reads it again; the page is told the state macOS reports after it.
pub(crate) fn set(on: bool) -> Answer {
    let error = mac::change(on);
    let after = mac::status();
    let answer = change_answer(on, after, error.as_ref().map(|error| error.message.clone()));
    match (&answer.error, &error) {
        (None, _) => log::info!("open at login: turned {}, macOS says {}", on_or_off(on), after.words()),
        (Some(_), Some(error)) => log::warn!(
            "open at login: could not turn {} ({} {}: {}), macOS says {}",
            on_or_off(on),
            error.domain,
            error.code,
            error.message,
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
#[derive(Debug)]
struct MacError {
    domain: String,
    code: isize,
    message: String,
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

    #[test]
    fn the_page_is_told_the_state_and_an_error_only_when_there_is_one() {
        let on = serde_json::to_string(&Answer { state: State::Enabled, error: None }).unwrap();
        assert_eq!(on, r#"{"state":"enabled"}"#);
        let failed = serde_json::to_string(&Answer { state: State::Off, error: Some("No".into()) }).unwrap();
        assert_eq!(failed, r#"{"state":"off","error":"No"}"#);
    }
}
