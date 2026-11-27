// README.md's shell, as an Android app takes it: the site from TAURI_PAGE_ADDRESS, which scripts/android-e2e.ts sets to
// its own server on this Mac, reached from the emulator through `adb reverse`.
use tauri::window::Color;
use tauri::Manager;
use tauri_plugin_app_kit_window::{log_to_file, show_once_placed, Site, StartPage};

const PAGE: &str = match option_env!("TAURI_PAGE_ADDRESS") {
    Some(address) => address,
    None => "http://localhost:4000/tauri.html",
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let site = Site::new(PAGE.parse().expect("PAGE is an address")).scheme("com.example.fixture");
    tauri::Builder::default()
        .plugin(log_to_file("android_fixture"))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(site.plugin())
        .setup(move |app| {
            app.add_capability(site.capability())?;
            let window = site.start_page_window(app, StartPage::new(Color(5, 5, 5, 255), Color(230, 230, 230, 255))).title("Fixture").build()?;
            show_once_placed(&window);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("the fixture app runs");
}
