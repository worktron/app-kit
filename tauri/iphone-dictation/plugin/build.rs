const COMMANDS: &[&str] = &["start_dictation", "dictation_heard", "stop_dictation", "cancel_dictation"];

fn main() {
    println!("cargo:rerun-if-changed=ios/Sources/IphoneDictationPlugin.swift");
    println!("cargo:rerun-if-changed=ios/Sources/DictationRules.swift");
    println!("cargo:rerun-if-changed=ios/Package.swift");

    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
