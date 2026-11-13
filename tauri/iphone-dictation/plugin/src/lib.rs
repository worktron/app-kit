use tauri::{
    plugin::{Builder, TauriPlugin},
    webview::PageLoadEvent,
    Runtime,
};

pub use models::*;

#[cfg(target_os = "ios")]
mod mobile;

mod commands;
mod error;
mod models;

pub use commands::end_dictation;
pub use error::{Error, Result};

/// Initializes the plugin. A page starting to load ends any dictation the page before it left running.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("iphone-dictation")
        .invoke_handler(tauri::generate_handler![
            commands::start_dictation,
            commands::dictation_heard,
            commands::stop_dictation,
            commands::cancel_dictation
        ])
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            mobile::init(_api)?;
            Ok(())
        })
        .on_page_load(|_webview, payload| {
            if payload.event() == PageLoadEvent::Started {
                end_dictation();
            }
        })
        .build()
}
