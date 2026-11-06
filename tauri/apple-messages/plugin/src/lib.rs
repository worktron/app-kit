//! Reading Apple Messages on the Mac, as a Tauri plugin the app's shell registers with `init()` and the page calls
//! through `app-kit/tauri/apple-messages` (../index.ts). Four commands:
//! - `access`: whether the app can open the Messages database, and whether it could read Contacts for names;
//! - `since`: up to 500 new texts after a row, or from the first sent since a day (reader.rs);
//! - `open_full_disk_access`: System Settings at Privacy & Security, Full Disk Access, that address only;
//! - `reopen`: quit and open the app again, for a Full Disk Access grant macOS applies only at launch, and only while
//!   the app still cannot read Messages, so no page can restart the app at will;
//! - `install_service`: open Messages Service, or install it from its latest release when it is missing (service.rs);
//! - `open_connect_link`: hand the installed, checked service its connect link, the one link of another app's the window
//!   lets out.
//!
//! Each logs one `[apple-messages]` line with its result and reason. Only the Mac has Messages to read: on any other
//! target the plugin registers and answers nothing, so a shell that builds it everywhere still builds.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::Runtime;

#[cfg(target_os = "macos")]
pub mod reader;
#[cfg(target_os = "macos")]
pub mod service;

/// The plugin's name, as the page's commands and the permission (`apple-messages:default`) name it.
pub const PLUGIN: &str = "apple-messages";

/// What every log line of the plugin starts with.
pub const LOG_PREFIX: &str = "[apple-messages]";

/// System Settings, Privacy & Security, Full Disk Access.
pub const FULL_DISK_ACCESS_PANE: &str = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

/// Texts per `since` call: the upload's batch.
pub const BATCH_SIZE: usize = 500;

/// The plugin, for the shell's builder: `.plugin(tauri_plugin_apple_messages::init())`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    let builder = Builder::new(PLUGIN);
    #[cfg(target_os = "macos")]
    let builder = builder
        .setup(|app, _api| {
            use tauri::Manager;
            app.manage(mac::Held::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            mac::access,
            mac::since,
            mac::open_full_disk_access,
            mac::reopen,
            service_commands::install_service,
            service_commands::open_connect_link
        ]);
    builder.build()
}

#[cfg(target_os = "macos")]
mod mac {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use serde::Serialize;
    use tauri::{AppHandle, Runtime, State};

    use crate::reader::{self, Access, Batch, Contacts};
    use crate::{BATCH_SIZE, FULL_DISK_ACCESS_PANE};

    /// Rows of the Messages database seen before their chat link, and how many reads each has waited
    /// (reader::HOLD_READS).
    #[derive(Default)]
    pub struct Held(Mutex<HashMap<i64, u32>>);

    /// What the page shows about reading Messages.
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Status {
        access: Access,
        contacts_read: bool,
    }

    fn access_now() -> Access {
        reader::messages_db().map_or(Access::NoDatabase, |db| reader::access(&db))
    }

    fn contacts() -> Result<Contacts, String> {
        reader::address_book_root().ok_or_else(|| "no home folder".to_string()).and_then(|root| Contacts::load(&root))
    }

    #[tauri::command]
    pub async fn access() -> Result<Status, String> {
        let access = access_now();
        let contacts = contacts();
        log::info!(
            "[apple-messages] access {access:?}, contacts {}",
            contacts.as_ref().map_or_else(|e| format!("unavailable: {e}"), |_| "read".into())
        );
        Ok(Status { access, contacts_read: contacts.is_ok() })
    }

    #[tauri::command]
    pub async fn since(held: State<'_, Held>, after_rowid: Option<i64>, since_ms: i64) -> Result<Batch, String> {
        let db = reader::messages_db().ok_or("no home folder")?;
        if reader::access(&db) != Access::Granted {
            log::warn!("[apple-messages] denied: cannot open the Messages database");
            return Err("denied".into());
        }
        let contacts = contacts();
        if let Err(e) = &contacts {
            log::warn!("[apple-messages] contacts unavailable: {e}; nobody is marked unknown");
        }
        let mut held = held.0.lock().map_err(|_| "reader state poisoned")?;
        let batch = reader::read_since(&db, contacts.as_ref().map_err(String::as_str), after_rowid, since_ms, BATCH_SIZE, &mut held)
            .map_err(|e| {
                log::error!("[apple-messages] read failed: {e}");
                format!("read failed: {e}")
            })?;
        log::info!(
            "[apple-messages] read {} texts after {:?}, scanned to {} of {}",
            batch.texts.len(),
            after_rowid,
            batch.scanned_to,
            batch.max_rowid
        );
        Ok(batch)
    }

    #[tauri::command]
    pub async fn open_full_disk_access() -> Result<(), String> {
        // macOS's own `open`, so the app need not register the opener plugin, and the address is this one only.
        let status = std::process::Command::new("/usr/bin/open").arg(FULL_DISK_ACCESS_PANE).status().map_err(|e| {
            log::warn!("[apple-messages] could not open Full Disk Access in System Settings: {e}");
            e.to_string()
        })?;
        if !status.success() {
            log::warn!("[apple-messages] could not open Full Disk Access in System Settings: open {status}");
            return Err(format!("open {status}"));
        }
        log::info!("[apple-messages] opened Full Disk Access in System Settings");
        Ok(())
    }

    /// Whether the page may reopen the app: only while it cannot yet read Messages, the one case reopening is for.
    pub(crate) fn may_reopen(access: Access) -> bool {
        access != Access::Granted
    }

    #[tauri::command]
    pub fn reopen<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
        let access = access_now();
        if !may_reopen(access) {
            log::info!("[apple-messages] reopen asked for, but Messages can already be read; ignored");
            return Err("Messages can already be read".into());
        }
        log::info!("[apple-messages] reopening to pick up Full Disk Access ({access:?} now)");
        // request_restart, not restart: the app's exit events run, so the window plugin saves where the window was.
        app.request_restart();
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod service_commands {
    use crate::service::{Installed, Installer};

    #[tauri::command]
    pub async fn install_service(team_id: String) -> Result<Installed, String> {
        log::info!("[apple-messages] asked to install or open Messages Service");
        Installer::for_this_mac(&team_id)?.install()
    }

    #[tauri::command]
    pub async fn open_connect_link(team_id: String, link: String) -> Result<(), String> {
        Installer::for_this_mac(&team_id)?.connect(&link)
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use reader::Access;

    #[test]
    fn reopen_refuses_while_messages_can_be_read() {
        assert!(!mac::may_reopen(Access::Granted));
        assert!(mac::may_reopen(Access::Denied));
        assert!(mac::may_reopen(Access::NoDatabase));
    }

    #[test]
    fn the_plugin_builds_for_any_runtime() {
        let _ = init::<tauri::test::MockRuntime>;
    }
}
