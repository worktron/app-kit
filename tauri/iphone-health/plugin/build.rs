const COMMANDS: &[&str] = &["start", "simulator_sleep"];

fn main() {
    println!("cargo:rerun-if-changed=ios/Sources/IphoneHealthPlugin.swift");
    println!("cargo:rerun-if-changed=ios/Sources/SleepSync.swift");
    println!("cargo:rerun-if-changed=ios/Package.swift");

    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
