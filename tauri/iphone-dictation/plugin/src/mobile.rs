use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, Runtime};

tauri::ios_plugin_binding!(init_plugin_iphone_dictation);

/// Registers the Swift plugin class, which watches for the app going to the background. The commands call the Swift
/// side directly (commands.rs), not through the class.
pub fn init<R: Runtime, C: DeserializeOwned>(api: PluginApi<R, C>) -> crate::Result<()> {
    api.register_ios_plugin(init_plugin_iphone_dictation)?;
    log::info!("[iphone-dictation] plugin registered");
    Ok(())
}
