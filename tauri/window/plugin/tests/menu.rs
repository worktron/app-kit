// The menu bar AppMenu builds, read back from macOS: what each menu holds, in order, with each item's shortcut, for
// an app with and without Settings and Sign Out, and one that updates itself. macOS makes menus only on the main
// thread, which a test harness never runs on, so this test is its own program (harness = false in Cargo.toml). The menu
// is read, never shown: the test process is barred from the Dock and the menu bar before anything is built.

#[cfg(target_os = "macos")]
fn main() {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
    use tauri_plugin_app_kit_window::AppMenu;

    let mtm = MainThreadMarker::new().expect("a test with harness = false runs on the main thread");
    let mac = NSApplication::sharedApplication(mtm);
    mac.setActivationPolicy(NSApplicationActivationPolicy::Prohibited);
    let app = tauri::test::mock_app();
    // An app whose tauri.conf.json has plugins.updater, which turns its updates on.
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({ "pubkey": "a public key", "endpoints": ["https://example.com/latest.json"] }),
    );
    let updating = tauri::test::mock_builder().build(context).unwrap();

    let cases = [
        ("an app with settings and sign-in", &app, AppMenu::new().settings().sign_out().commit("3f2a9c1"), WITH_BOTH),
        ("an app with neither", &app, AppMenu::new(), WITH_NEITHER),
        ("an app that updates itself", &updating, AppMenu::new(), WITH_UPDATES),
    ];
    for (name, app, menu, expected) in cases {
        menu.build(app.handle()).unwrap().set_as_app_menu().unwrap();
        let read = read_menu_bar(&mac);
        let expected: Vec<&str> = expected.lines().filter(|line| !line.trim().is_empty()).map(|line| &line[4..]).collect();
        assert_eq!(read, expected, "{name}");
        println!("ok: the menu bar for {name}");
    }
    let windows = mac.windowsMenu().map(|menu| menu.title().to_string());
    assert_eq!(windows.as_deref(), Some("Window"), "macOS lists the windows in the Window menu");
    println!("ok: macOS lists the open windows in the Window menu");
}

/// Each menu's title, then its items indented, a separator as "-", each item's shortcut after it as macOS shows it.
#[cfg(target_os = "macos")]
fn read_menu_bar(mac: &objc2_app_kit::NSApplication) -> Vec<String> {
    use objc2_app_kit::NSEventModifierFlags as Key;
    let bar = mac.mainMenu().expect("the menu bar was set");
    let mut lines = Vec::new();
    for index in 0..bar.numberOfItems() {
        let menu = bar.itemAtIndex(index).unwrap().submenu().expect("each item of the bar is a menu");
        lines.push(menu.title().to_string());
        for index in 0..menu.numberOfItems() {
            let item = menu.itemAtIndex(index).unwrap();
            if item.isSeparatorItem() {
                lines.push("  -".into());
                continue;
            }
            let key = item.keyEquivalent().to_string();
            let mut line = format!("  {}", item.title());
            if !key.is_empty() {
                let mask = item.keyEquivalentModifierMask();
                let held = [(Key::Control, "⌃"), (Key::Option, "⌥"), (Key::Shift, "⇧"), (Key::Command, "⌘")];
                let held: String = held.iter().filter(|(flag, _)| mask.contains(*flag)).map(|(_, mark)| *mark).collect();
                line += &format!(" {held}{}", key.to_uppercase());
            }
            lines.push(line);
        }
    }
    lines
}

#[cfg(target_os = "macos")]
const WITH_BOTH: &str = "
    test
      About test
      -
      Settings… ⌘,
      -
      Services
      -
      Hide test ⌘H
      Hide Others ⌥⌘H
      Show All
      -
      Sign Out
      -
      Quit test ⌘Q
    File
      Close Window ⌘W
    Edit
      Undo ⌘Z
      Redo ⇧⌘Z
      -
      Cut ⌘X
      Copy ⌘C
      Paste ⌘V
      Select All ⌘A
    View
      Actual Size ⌘0
      Zoom In ⌘=
      Zoom Out ⌘-
      -
      Reload ⌘R
      -
      Enter Full Screen ⌃⌘F
    Window
      Minimize ⌘M
      Zoom
      -
      Bring All to Front
";

/// An app that updates itself has Check for Updates… after About.
#[cfg(target_os = "macos")]
const WITH_UPDATES: &str = "
    test
      About test
      Check for Updates…
      -
      Services
      -
      Hide test ⌘H
      Hide Others ⌥⌘H
      Show All
      -
      Quit test ⌘Q
    File
      Close Window ⌘W
    Edit
      Undo ⌘Z
      Redo ⇧⌘Z
      -
      Cut ⌘X
      Copy ⌘C
      Paste ⌘V
      Select All ⌘A
    View
      Actual Size ⌘0
      Zoom In ⌘=
      Zoom Out ⌘-
      -
      Reload ⌘R
      -
      Enter Full Screen ⌃⌘F
    Window
      Minimize ⌘M
      Zoom
      -
      Bring All to Front
";

/// The same bar without Settings… or Sign Out, and without the line each brings with it.
#[cfg(target_os = "macos")]
const WITH_NEITHER: &str = "
    test
      About test
      -
      Services
      -
      Hide test ⌘H
      Hide Others ⌥⌘H
      Show All
      -
      Quit test ⌘Q
    File
      Close Window ⌘W
    Edit
      Undo ⌘Z
      Redo ⇧⌘Z
      -
      Cut ⌘X
      Copy ⌘C
      Paste ⌘V
      Select All ⌘A
    View
      Actual Size ⌘0
      Zoom In ⌘=
      Zoom Out ⌘-
      -
      Reload ⌘R
      -
      Enter Full Screen ⌃⌘F
    Window
      Minimize ⌘M
      Zoom
      -
      Bring All to Front
";

#[cfg(not(target_os = "macos"))]
fn main() {}
