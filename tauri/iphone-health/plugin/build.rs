const COMMANDS: &[&str] = &["start", "simulator_sleep", "simulator_heart_rate"];

fn main() {
    println!("cargo:rerun-if-changed=ios/Sources/IphoneHealthPlugin.swift");
    println!("cargo:rerun-if-changed=ios/Sources/HealthSync.swift");
    println!("cargo:rerun-if-changed=ios/Package.swift");

    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
