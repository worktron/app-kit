// README.md's shell (A window onto the hosted site), compiled as an app compiles it, so the README never shows a
// shell that does not build. test/tauri-window.test.ts holds the README's block to the lines below, up to the test.

use tauri::window::Color;
use tauri::{Manager, Runtime, WebviewUrl};
use tauri_plugin_app_kit_window::{log_to_file, show_once_placed, Site};

/// The site this build loads: a dev server's address when the build is given one, else the site.
const PAGE: &str = match option_env!("TAURI_PAGE_ADDRESS") {
    Some(address) => address,
    None => "https://app.example.com",
};

fn shell<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    let site = Site::new(PAGE.parse().expect("PAGE is an address")).scheme("com.example.app");
    let builder = builder
        .plugin(log_to_file("example_app"))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init());
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(
        tauri_plugin_window_state::Builder::new()
            .with_state_flags(tauri_plugin_window_state::StateFlags::all() - tauri_plugin_window_state::StateFlags::VISIBLE)
            .build(),
    );
    let builder = builder.plugin(site.plugin());
    builder.setup(move |app| {
        app.add_capability(site.capability().permission("core:window:allow-start-dragging"))?;
        let start = WebviewUrl::External(site.address().clone());
        let window = site
            .window(app, start)
            .title("Example")
            .inner_size(1280.0, 860.0)
            .background_color(Color(5, 5, 5, 255))
            .build()?;
        show_once_placed(&window);
        Ok(())
    })
}

#[test]
fn the_readme_shell_compiles_for_an_app() {
    let _ = shell::<tauri::test::MockRuntime>;
}
