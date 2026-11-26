// The page's three commands. Each calls the Swift side directly through a C function (IphoneHealthPlugin.swift), as the
// iPhone notifications and dictation plugins do, on a thread of its own, since the Swift blocks until Health and the
// server answer.

use tauri::{command, AppHandle, Runtime};

use crate::Result;

#[cfg(target_os = "ios")]
mod native {
    use std::ffi::{c_char, CStr, CString};

    extern "C" {
        /// Save the address, ask for Health's sleep, watch for new sleep and send what is new, and the same for heart
        /// rate when `heart_rate_address` is not null (null stops heart rate's sends). Blocks until the sends end.
        /// Answers JSON `{ outcome, samples, deleted, status, heartRate? }`, to be freed with `iphone_health_free`.
        fn iphone_health_start(address: *const c_char, heart_rate_address: *const c_char) -> *mut c_char;
        /// Add a made-up night to the Simulator's Health, or delete the newest stretch the app wrote. Blocks. Answers
        /// JSON `{ added }`, `{ deleted }` or `{ error }`, to be freed with `iphone_health_free`.
        fn iphone_health_simulator_sleep(action: *const c_char) -> *mut c_char;
        /// Add a made-up night's heart rate to the Simulator's Health, with a condensed series, or delete the newest
        /// heart rate sample the app wrote. Blocks. Answers JSON `{ added, series }`, `{ deleted }` or `{ error }`, to
        /// be freed with `iphone_health_free`.
        fn iphone_health_simulator_heart_rate(action: *const c_char) -> *mut c_char;
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

    pub fn start(address: &str, heart_rate_address: Option<&str>) -> std::io::Result<serde_json::Value> {
        let address = CString::new(address).map_err(std::io::Error::other)?;
        let heart_rate_address = heart_rate_address.map(CString::new).transpose().map_err(std::io::Error::other)?;
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let heart_rate = heart_rate_address.as_ref().map_or(std::ptr::null(), |text| text.as_ptr());
            let _ = tx.send(answer(unsafe { iphone_health_start(address.as_ptr(), heart_rate) }));
        });
        rx.recv().map_err(|_| std::io::Error::other("the Health thread stopped"))?
    }

    pub fn simulator_sleep(action: &str) -> std::io::Result<serde_json::Value> {
        blocking(iphone_health_simulator_sleep, action)
    }

    pub fn simulator_heart_rate(action: &str) -> std::io::Result<serde_json::Value> {
        blocking(iphone_health_simulator_heart_rate, action)
    }
}

/// Give the address Health's sleep is sent to, and the one its heart rate is sent to, if any. Asks for what Health has
/// not been asked yet (iOS shows its sheet once), then sends what is new and answers how each send ended.
#[command]
pub(crate) async fn start<R: Runtime>(
    _app: AppHandle<R>,
    endpoint: String,
    heart_rate_endpoint: Option<String>,
) -> Result<serde_json::Value> {
    #[cfg(target_os = "ios")]
    {
        let answer = native::start(&endpoint, heart_rate_endpoint.as_deref())?;
        log::info!("[iphone-health] start: {answer}");
        Ok(answer)
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (endpoint, heart_rate_endpoint);
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

/// On the Simulator, `add` a made-up night's heart rate to Health or `delete` the newest heart rate sample the app wrote.
#[command]
pub(crate) async fn simulator_heart_rate<R: Runtime>(_app: AppHandle<R>, action: String) -> Result<serde_json::Value> {
    #[cfg(target_os = "ios")]
    {
        Ok(native::simulator_heart_rate(&action)?)
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = action;
        Err(crate::Error::UnsupportedPlatform)
    }
}
