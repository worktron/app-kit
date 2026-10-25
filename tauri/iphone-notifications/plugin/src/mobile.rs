use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

tauri::ios_plugin_binding!(init_plugin_iphone_notifications);

/// Initializes the Swift plugin class.
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<IphoneNotifications<R>> {
    let handle = api.register_ios_plugin(init_plugin_iphone_notifications)?;
    log::info!("[iphone-notifications] plugin registered");
    Ok(IphoneNotifications(handle))
}

/// Plugin handle. Kept for Tauri's managed state requirement.
/// Commands use direct FFI instead of run_mobile_plugin.
pub struct IphoneNotifications<R: Runtime>(PluginHandle<R>);
