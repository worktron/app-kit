// The page's four commands. Each calls the Swift side directly through a C function (IphoneNotificationsPlugin.swift),
// bypassing run_mobile_plugin, which the original plugin found hangs, and blocks on its own thread, never the main one.

use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::Result;

#[cfg(target_os = "ios")]
extern "C" {
    /// Request notification permission. Blocks until the person answers.
    /// Returns 1 if granted, 0 if denied.
    fn iphone_notifications_request_permission() -> i32;

    /// Get the device token from Apple. Blocks until it comes or the timeout.
    /// Writes the hex token to the buffer. Returns its length, -1 on error, -2 on timeout.
    fn iphone_notifications_get_device_token(buffer: *mut i8, buffer_len: i32, timeout_secs: i32) -> i32;

    /// Take the page a tapped notification is about, once: a second call returns nothing until the next tap.
    /// Writes the address to the buffer. Returns its length, 0 when no tap is waiting, -1 when it did not fit.
    fn iphone_notifications_take_tapped_address(buffer: *mut i8, buffer_len: i32) -> i32;

    /// Remove each delivered notification sent before `before` (milliseconds since 1970) whose tag is not in `ids_json`,
    /// a JSON array of strings. Blocks until iOS's list no longer holds them, or a few seconds.
    /// Returns how many it removed, -1 when the list does not parse, -2 when iOS did not answer in time.
    fn iphone_notifications_keep(ids_json: *const std::ffi::c_char, before: f64) -> i32;
}

/// The longest tapped address the page is handed. A longer one is dropped by the Swift side, never cut short.
#[cfg(target_os = "ios")]
const ADDRESS_BUFFER: usize = 4096;

/// A debug build is installed from Xcode and signed for Apple's development service; a release build goes out
/// through TestFlight or the App Store, signed for production.
const ENVIRONMENT: &str = if cfg!(debug_assertions) { "development" } else { "production" };

#[command]
pub(crate) async fn request_permission<R: Runtime>(_app: AppHandle<R>) -> Result<PermissionResponse> {
    #[cfg(target_os = "ios")]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let result = unsafe { iphone_notifications_request_permission() };
            let _ = tx.send(result == 1);
        });
        let granted = rx.recv().unwrap_or(false);
        log::info!("[iphone-notifications] permission {}", if granted { "granted" } else { "denied" });
        Ok(PermissionResponse { granted })
    }

    #[cfg(not(target_os = "ios"))]
    {
        Ok(PermissionResponse { granted: false })
    }
}

#[command]
pub(crate) async fn get_token<R: Runtime>(_app: AppHandle<R>) -> Result<TokenResponse> {
    #[cfg(target_os = "ios")]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut buffer = [0i8; 256];
            let result = unsafe { iphone_notifications_get_device_token(buffer.as_mut_ptr(), 256, 15) };
            if result > 0 {
                let bytes: Vec<u8> = buffer[..result as usize].iter().map(|&b| b as u8).collect();
                let _ = tx.send(String::from_utf8(bytes).map_err(|e| format!("the token is not UTF-8: {e}")));
            } else if result == -2 {
                let _ = tx.send(Err("Apple did not send a device token in time".to_string()));
            } else {
                let _ = tx.send(Err("Apple refused a device token".to_string()));
            }
        });

        match rx.recv() {
            Ok(Ok(token)) => Ok(TokenResponse { token, environment: ENVIRONMENT.to_string() }),
            Ok(Err(e)) => Err(crate::Error::Io(std::io::Error::other(e))),
            Err(_) => Err(crate::Error::Io(std::io::Error::other("the token thread stopped"))),
        }
    }

    #[cfg(not(target_os = "ios"))]
    {
        Ok(TokenResponse { token: String::new(), environment: ENVIRONMENT.to_string() })
    }
}

#[command]
pub(crate) async fn take_tapped_address<R: Runtime>(_app: AppHandle<R>) -> Result<Option<String>> {
    #[cfg(target_os = "ios")]
    {
        let mut buffer = vec![0i8; ADDRESS_BUFFER];
        let result = unsafe { iphone_notifications_take_tapped_address(buffer.as_mut_ptr(), ADDRESS_BUFFER as i32) };
        if result <= 0 {
            return Ok(None);
        }
        let bytes: Vec<u8> = buffer[..result as usize].iter().map(|&b| b as u8).collect();
        Ok(String::from_utf8(bytes).ok())
    }

    #[cfg(not(target_os = "ios"))]
    {
        Ok(None)
    }
}

/// Remove the delivered notifications handled elsewhere: each sent before `before`, in milliseconds since 1970 on the
/// server's clock, whose tag is not in `ids`. Returns how many it removed.
#[command]
pub(crate) async fn keep_notifications<R: Runtime>(_app: AppHandle<R>, ids: Vec<String>, before: f64) -> Result<u32> {
    #[cfg(target_os = "ios")]
    {
        let json = serde_json::to_string(&ids).map_err(std::io::Error::other)?;
        let json = std::ffi::CString::new(json).map_err(std::io::Error::other)?;
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(unsafe { iphone_notifications_keep(json.as_ptr(), before) });
        });
        match rx.recv() {
            Ok(removed) if removed >= 0 => Ok(removed as u32),
            Ok(-1) => Err(crate::Error::Io(std::io::Error::other("the list of tags to keep did not parse"))),
            Ok(_) => Err(crate::Error::Io(std::io::Error::other("iOS did not list its delivered notifications in time"))),
            Err(_) => Err(crate::Error::Io(std::io::Error::other("the removal thread stopped"))),
        }
    }

    #[cfg(not(target_os = "ios"))]
    {
        let _ = (ids, before);
        Ok(0)
    }
}
