// The page's two commands. Each calls the Swift side directly through a C function (IphoneHealthPlugin.swift), as the
// iPhone notifications and dictation plugins do, on a thread of its own, since the Swift blocks until Health and the
// server answer.

use tauri::{command, AppHandle, Runtime};

use crate::Result;

#[cfg(target_os = "ios")]
mod native {
    use std::ffi::{c_char, CStr, CString};

    extern "C" {
        /// Save the address, ask for Health's sleep, watch for new sleep and send what is new. Blocks until the send
        /// ends. Answers JSON `{ outcome, samples, deleted, status }`, to be freed with `iphone_health_free`.
        fn iphone_health_start(address: *const c_char) -> *mut c_char;
        /// Add a made-up night to the Simulator's Health, or delete the newest stretch the app wrote. Blocks. Answers
        /// JSON `{ added }`, `{ deleted }` or `{ error }`, to be freed with `iphone_health_free`.
        fn iphone_health_simulator_sleep(action: *const c_char) -> *mut c_char;
        fn iphone_health_free(text: *mut c_char);
    }

    fn answer(pointer: *mut c_char) -> std::io::Result<serde_json::Value> {
        let text = unsafe {
            let text = CStr::from_ptr(pointer).to_string_lossy().into_owned();
            iphone_health_free(pointer);
            text
        };
        serde_json::from_str(&text).map_err(std::io::Error::other)
    }

    /// Run `call` with `arg` on a thread of its own and wait for it, so neither Tauri's runtime nor the main thread
    /// waits on Health.
    pub fn blocking(call: unsafe extern "C" fn(*const c_char) -> *mut c_char, arg: &str) -> std::io::Result<serde_json::Value> {
        let arg = CString::new(arg).map_err(std::io::Error::other)?;
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(answer(unsafe { call(arg.as_ptr()) }));
        });
        rx.recv().map_err(|_| std::io::Error::other("the Health thread stopped"))?
    }

    pub fn start(address: &str) -> std::io::Result<serde_json::Value> {
        blocking(iphone_health_start, address)
    }

    pub fn simulator_sleep(action: &str) -> std::io::Result<serde_json::Value> {
        blocking(iphone_health_simulator_sleep, action)
    }
}

/// Give the address Health's sleep is sent to. Asks for Health's sleep (iOS shows its sheet once), then sends what is
/// new and answers how that send ended.
#[command]
pub(crate) async fn start<R: Runtime>(_app: AppHandle<R>, endpoint: String) -> Result<serde_json::Value> {
    #[cfg(target_os = "ios")]
    {
        let answer = native::start(&endpoint)?;
        log::info!("[iphone-health] start: {answer}");
        Ok(answer)
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = endpoint;
        Err(crate::Error::UnsupportedPlatform)
    }
}

/// On the Simulator, `add` a made-up night to Health or `delete` the newest stretch the app wrote.
#[command]
pub(crate) async fn simulator_sleep<R: Runtime>(_app: AppHandle<R>, action: String) -> Result<serde_json::Value> {
    #[cfg(target_os = "ios")]
    {
        Ok(native::simulator_sleep(&action)?)
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = action;
        Err(crate::Error::UnsupportedPlatform)
    }
}
