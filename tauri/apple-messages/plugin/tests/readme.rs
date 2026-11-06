// README.md's shell lines for reading Apple Messages, compiled as an app compiles them, so the README never shows lines
// that do not build. test/tauri-apple-messages.test.ts holds the README's block to the lines below, up to the test.

use tauri::ipc::CapabilityBuilder;
use tauri::Runtime;

/// Only the Mac has Messages to read, so the plugin is registered for the Mac build only.
fn with_messages<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_plugin_apple_messages::init());
    builder
}

/// The page's capability, which on the iPhone must not name a plugin that is not built there.
fn page_capability(page: CapabilityBuilder) -> CapabilityBuilder {
    #[cfg(target_os = "macos")]
    let page = page.permission("apple-messages:default");
    page
}

#[test]
fn the_readme_shell_compiles_for_an_app() {
    let _ = with_messages::<tauri::test::MockRuntime>;
    let _ = page_capability;
}

#[cfg(target_os = "macos")]
#[test]
fn the_mac_page_may_call_the_plugin() {
    use tauri::ipc::RuntimeCapability;
    let tauri::utils::acl::capability::CapabilityFile::Capability(capability) = page_capability(CapabilityBuilder::new("page")).build()
    else {
        panic!("one capability");
    };
    let permissions: Vec<&str> = capability.permissions.iter().map(|p| p.identifier().get()).collect();
    assert_eq!(permissions, vec!["apple-messages:default"]);
}
