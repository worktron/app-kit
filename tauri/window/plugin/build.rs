// The Settings window's commands (src/settings.rs), from which Tauri makes the permissions `allow-<command>` that
// only that window is granted. permissions/default.toml grants none of them. ../names.ts holds the same names, and
// test/tauri-window.test.ts holds them to these.
const COMMANDS: &[&str] = &["open_at_login_status", "open_at_login_set", "open_login_items"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
