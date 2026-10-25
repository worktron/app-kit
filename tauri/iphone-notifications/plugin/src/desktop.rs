use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<IphoneNotifications<R>> {
    Ok(IphoneNotifications(app.clone()))
}

/// Plugin handle. Kept for Tauri's managed state requirement.
/// Anywhere but an iPhone the commands answer as if notifications were off.
pub struct IphoneNotifications<R: Runtime>(AppHandle<R>);
