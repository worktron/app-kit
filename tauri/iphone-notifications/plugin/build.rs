const COMMANDS: &[&str] = &["request_permission", "get_token", "take_tapped_address"];

fn main() {
    println!("cargo:rerun-if-changed=ios/Sources/IphoneNotificationsPlugin.swift");
    println!("cargo:rerun-if-changed=ios/Package.swift");

    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
