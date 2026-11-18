use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, Runtime};

tauri::ios_plugin_binding!(init_plugin_iphone_health);

/// Registers the Swift plugin class, whose start registers Health's watcher and the sync on coming to the front. The
/// commands call the Swift side directly (commands.rs), not through the class.
pub fn init<R: Runtime, C: DeserializeOwned>(api: PluginApi<R, C>) -> crate::Result<()> {
    api.register_ios_plugin(init_plugin_iphone_health)?;
    log::info!("[iphone-health] plugin registered");
    Ok(())
}
