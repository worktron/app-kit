use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "ios")]
mod mobile;

mod commands;
mod error;

pub use error::{Error, Result};

/// Initializes the plugin. Its Swift side starts before launch finishes, as Health's watchers need, and from then on
/// sends new sleep, and heart rate, by itself whenever an address is saved for it.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("iphone-health")
        .invoke_handler(tauri::generate_handler![commands::start, commands::simulator_sleep, commands::simulator_heart_rate])
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            mobile::init(_api)?;
            Ok(())
        })
        .build()
}
