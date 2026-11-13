// The page's four commands. Each calls the Swift side directly through a C function (IphoneDictationPlugin.swift), as
// the iPhone notifications plugin does. None blocks: a start answers with its token at once, and the page reads what it
// heard by polling `dictation_heard`. They are async so Tauri runs them off the main thread, which the Swift never
// waits on.

use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::Result;

#[cfg(target_os = "ios")]
mod native {
    use std::ffi::{c_char, CStr, CString};

    extern "C" {
        /// Start a dictation, ending any earlier one. Returns its token at once; permission and the microphone follow.
        fn iphone_dictation_start(lang: *const c_char) -> i64;
        /// What dictation `token` heard, as JSON `{ words, ended, error }`, to be freed with `iphone_dictation_free`.
        fn iphone_dictation_heard(token: i64) -> *mut c_char;
        fn iphone_dictation_free(text: *mut c_char);
        /// Turn the microphone off; the task's last result or error ends the dictation.
        fn iphone_dictation_stop(token: i64);
        /// End dictation `token` now, or whichever is in force when `token` is 0.
        fn iphone_dictation_cancel(token: i64);
    }

    pub fn start(lang: &str) -> std::io::Result<i64> {
        let lang = CString::new(lang).map_err(std::io::Error::other)?;
        Ok(unsafe { iphone_dictation_start(lang.as_ptr()) })
    }

    pub fn heard(token: i64) -> std::io::Result<super::Heard> {
        let text = unsafe {
            let pointer = iphone_dictation_heard(token);
            let text = CStr::from_ptr(pointer).to_string_lossy().into_owned();
            iphone_dictation_free(pointer);
            text
        };
        serde_json::from_str(&text).map_err(std::io::Error::other)
    }

    pub fn stop(token: i64) {
        unsafe { iphone_dictation_stop(token) }
    }

    pub fn cancel(token: i64) {
        unsafe { iphone_dictation_cancel(token) }
    }
}

/// Start dictation in `lang`, a BCP 47 tag such as `en-US`, or the phone's own language with none.
#[command]
pub(crate) async fn start_dictation<R: Runtime>(_app: AppHandle<R>, lang: Option<String>) -> Result<Started> {
    #[cfg(target_os = "ios")]
    {
        let token = native::start(lang.as_deref().unwrap_or(""))?;
        log::info!("[iphone-dictation] start {token}");
        Ok(Started { token })
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = lang;
        Err(crate::Error::UnsupportedPlatform)
    }
}

#[command]
pub(crate) async fn dictation_heard<R: Runtime>(_app: AppHandle<R>, token: i64) -> Result<Heard> {
    #[cfg(target_os = "ios")]
    {
        Ok(native::heard(token)?)
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = token;
        Err(crate::Error::UnsupportedPlatform)
    }
}

#[command]
pub(crate) async fn stop_dictation<R: Runtime>(_app: AppHandle<R>, token: i64) -> Result<()> {
    #[cfg(target_os = "ios")]
    {
        native::stop(token);
        Ok(())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = token;
        Err(crate::Error::UnsupportedPlatform)
    }
}

#[command]
pub(crate) async fn cancel_dictation<R: Runtime>(_app: AppHandle<R>, token: i64) -> Result<()> {
    #[cfg(target_os = "ios")]
    {
        native::cancel(token);
        Ok(())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = token;
        Err(crate::Error::UnsupportedPlatform)
    }
}

/// End whatever dictation is in force and turn the microphone off. The plugin calls it when a page starts loading; an
/// app's shell calls it from `on_web_content_process_terminate`, since a page that is gone can no longer stop it.
pub fn end_dictation() {
    #[cfg(target_os = "ios")]
    native::cancel(0);
}
