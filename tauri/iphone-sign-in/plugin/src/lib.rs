use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

#[cfg(not(target_os = "ios"))]
mod desktop;
#[cfg(target_os = "ios")]
mod mobile;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

#[cfg(not(target_os = "ios"))]
use desktop::WebAuth;
#[cfg(target_os = "ios")]
use mobile::WebAuth;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to access the web-auth APIs.
pub trait WebAuthExt<R: Runtime> {
    fn web_auth(&self) -> &WebAuth<R>;
}

impl<R: Runtime, T: Manager<R>> crate::WebAuthExt<R> for T {
    fn web_auth(&self) -> &WebAuth<R> {
        self.state::<WebAuth<R>>().inner()
    }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("web-auth")
        .invoke_handler(tauri::generate_handler![commands::authenticate])
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            let web_auth = mobile::init(app, api)?;
            #[cfg(not(target_os = "ios"))]
            let web_auth = desktop::init(app, api)?;
            app.manage(web_auth);
            Ok(())
        })
        .build()
}
