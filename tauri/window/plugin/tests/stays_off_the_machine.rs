// Nothing a test of the plugin runs touches this Mac's own login items: tests pass a stand-in for macOS
// (login_item.rs's `LoginItems`), and this reads every test, the unit tests at the foot of each source file and the
// files beside this one, for a call that would reach the real one.

use std::path::Path;

/// What reaches this Mac's login items: the kit's own way to them, macOS's, and the Settings window's commands.
const FORBIDDEN: &[&str] = &[
    "ThisMac",
    "mac::status",
    "mac::change",
    "SMAppService::",
    "open_at_login_status(",
    "open_at_login_set(",
    "open_login_items(",
];

fn read(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

#[test]
fn no_test_touches_this_macs_login_items() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut tests: Vec<(String, String)> = Vec::new();
    for entry in std::fs::read_dir(root.join("src")).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|extension| extension == "rs") {
            let source = read(&path);
            if let Some(at) = source.find("#[cfg(test)]\nmod tests") {
                tests.push((path.display().to_string(), source[at..].to_string()));
            }
        }
    }
    let unit_tests = tests.len();
    for entry in std::fs::read_dir(root.join("tests")).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|extension| extension == "rs") && !path.ends_with("stays_off_the_machine.rs") {
            tests.push((path.display().to_string(), read(&path)));
        }
    }
    assert!(unit_tests >= 8, "the unit tests were found ({unit_tests})");
    assert!(tests.iter().any(|(path, _)| path.ends_with("login_item.rs")), "login_item.rs's tests were read");
    for (path, text) in &tests {
        for call in FORBIDDEN {
            assert!(!text.contains(call), "{path}'s tests use {call}, which reaches this Mac's own login items");
        }
    }
}
