const COMMANDS: &[&str] = &["authenticate"];

fn main() {
    println!("cargo:rerun-if-changed=ios/Sources/WebAuthPlugin.swift");
    println!("cargo:rerun-if-changed=ios/Package.swift");

    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
