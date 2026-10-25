use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

tauri::ios_plugin_binding!(init_plugin_web_auth);

/// Initializes the Swift plugin class.
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<WebAuth<R>> {
    let handle = api.register_ios_plugin(init_plugin_web_auth)?;
    log::info!("[iphone-sign-in] plugin registered");
    Ok(WebAuth(handle))
}

/// Access to the web-auth APIs.
pub struct WebAuth<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> WebAuth<R> {
    pub fn authenticate(&self, payload: AuthenticateRequest) -> crate::Result<AuthenticateResponse> {
        self.0
            .run_mobile_plugin("authenticate", payload)
            .map_err(Into::into)
    }
}
