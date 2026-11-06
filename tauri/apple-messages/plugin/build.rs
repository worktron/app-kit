// The page's commands, each allowed by the default permission (permissions/default.toml); ../names.ts holds the same
// names, and test/tauri-apple-messages.test.ts holds them to these.
const COMMANDS: &[&str] = &["access", "since", "open_full_disk_access", "reopen"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
