//! The Mac app's restart, after an update installs or into a newer build installed over it: the app quits first, and a
//! helper it leaves behind opens it again through macOS once this copy has exited.
//!
//! Tauri's own restart (since 2.12.2, tauri-apps/tauri#16449, open as of 2.12.6) runs `open -n` while this copy is
//! still running, and when two copies of one app run at once the Dock gives the new one an icon of its own beside the
//! pinned one, which then stays in the Dock's recent apps: another icon after every update. Opening the app only once
//! the old copy is gone keeps it in the icon the person pinned. Once Tauri fixes its restart, this file can go, and
//! its tests say what it held.

use std::ffi::OsString;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, Runtime};

/// Set once a relaunch is asked for, read as the app exits.
static ASKED: AtomicBool = AtomicBool::new(false);
/// macOS's opener, which opens the app through LaunchServices, so launchd owns it and it comes back in front as itself.
const OPENER: &str = "/usr/bin/open";
/// How long the helper waits for this copy to quit, in tenths of a second, before it opens the app anyway: an app slow
/// to quit gets a second icon rather than no restart.
const WAIT_TENTHS: u32 = 100;

/// The helper's script, run by `/bin/sh -c` with the arguments `pid tenths opener bundle program args...`. It waits for
/// the process to exit, at most `tenths` tenths of a second, then opens the bundle with the app's arguments, and if the
/// opener fails, starts the program itself with them, as Tauri's restart does. No `-g`: the app comes back in front.
const SCRIPT: &str = r#"pid=$1 tenths=$2 opener=$3 bundle=$4 program=$5
shift 5
waited=0
while /bin/kill -0 "$pid" 2>/dev/null && [ "$waited" -lt "$tenths" ]; do
  /bin/sleep 0.1
  waited=$((waited + 1))
done
"$opener" -n "$bundle" --args "$@" || exec "$program" "$@""#;

/// The app bundle a program runs from, `<name>.app` for `<name>.app/Contents/MacOS/<program>`, or none outside one, as
/// a dev run is.
pub(crate) fn bundle_of(program: &Path) -> Option<PathBuf> {
    if !crate::updates::in_app_bundle(program) {
        return None;
    }
    program.ancestors().nth(3).map(Path::to_path_buf)
}

/// The helper, which outlives this process: its own process group, nothing of this one's input or output.
fn helper<'a>(
    opener: &Path,
    pid: u32,
    tenths: u32,
    bundle: &Path,
    program: &Path,
    args: impl IntoIterator<Item = &'a OsString>,
) -> Command {
    let mut command = Command::new("/bin/sh");
    command
        .arg("-c")
        .arg(SCRIPT)
        .arg("sh")
        .arg(pid.to_string())
        .arg(tenths.to_string())
        .arg(opener)
        .arg(bundle)
        .arg(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0);
    command
}

/// Restarts the app. Inside an app bundle it quits through the app's usual exit, so the window state and the app's
/// own exit work run, and the helper is started as it exits (`exited`); outside one, Tauri's restart runs.
pub(crate) fn request<R: Runtime>(app: &AppHandle<R>, program: Option<&Path>) {
    if program.and_then(bundle_of).is_some() {
        log::info!("restarting once this copy has quit, so the app comes back in the Dock icon the person pinned");
        ASKED.store(true, Ordering::SeqCst);
        app.exit(0);
    } else {
        log::info!("restarting through Tauri, since this build runs outside an app bundle");
        app.request_restart();
    }
}

/// As the app exits, after a relaunch was asked for: starts the helper, or restarts through Tauri if it cannot start.
pub(crate) fn exited<R: Runtime>(app: &AppHandle<R>, program: Option<&Path>) {
    if !ASKED.swap(false, Ordering::SeqCst) {
        return;
    }
    let env = app.env();
    let pid = std::process::id();
    let started = match program.and_then(|program| bundle_of(program).map(|bundle| (bundle, program))) {
        Some((bundle, program)) => {
            helper(Path::new(OPENER), pid, WAIT_TENTHS, &bundle, program, env.args_os.iter().skip(1)).spawn().map_err(|error| error.to_string())
        }
        None => Err("the program is no longer inside an app bundle".to_string()),
    };
    match started {
        Ok(_) => log::info!("relaunch helper started, waiting for process {pid} to quit before opening the app again"),
        Err(error) => {
            log::warn!("could not start the relaunch helper ({error}), restarting through Tauri");
            tauri::process::restart(&env);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::time::{Duration, Instant};

    /// A folder of its own for one test, emptied first.
    fn folder(name: &str) -> PathBuf {
        let folder = std::env::temp_dir().join(format!("app-kit-relaunch-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder).unwrap();
        folder
    }

    /// A stand-in program that records whether process `$OLD` was still running, its own name, and each argument on a
    /// line of its own, then exits with `status`.
    fn stand_in(folder: &Path, name: &str, status: u8) -> PathBuf {
        let path = folder.join(name);
        let record = folder.join("record");
        let script = format!(
            "#!/bin/sh\nif /bin/kill -0 \"$OLD\" 2>/dev/null; then s=running; else s=exited; fi\nprintf '%s\\n' \"$s\" {name} \"$@\" >> '{}'\nexit {status}\n",
            record.display()
        );
        std::fs::write(&path, script).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    fn args() -> Vec<OsString> {
        vec![OsString::from("--flag"), OsString::from("two words"), OsString::from("it's \"quoted\"")]
    }

    fn wait_for(what: &str, mut done: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(20);
        while !done() {
            assert!(Instant::now() < deadline, "{what} never happened");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn record(folder: &Path) -> String {
        std::fs::read_to_string(folder.join("record")).unwrap_or_default()
    }

    const ARGS: &str = "--flag\ntwo words\nit's \"quoted\"\n";

    #[test]
    fn the_app_opens_only_once_the_old_copy_has_quit_with_its_arguments_intact() {
        let folder = folder("waits");
        let opener = stand_in(&folder, "open", 0);
        let program = stand_in(&folder, "program", 0);
        let mut old = Command::new("/bin/sleep").arg("60").spawn().unwrap();
        let bundle = Path::new("/Applications/Example App.app");
        let args = args();
        let mut waiter =
            helper(&opener, old.id(), WAIT_TENTHS, bundle, &program, &args).env("OLD", old.id().to_string()).spawn().unwrap();
        // The old copy quits only once the helper is polling it, and is reaped, since macOS still finds an unreaped
        // child by `kill -0`; the real app's parent, launchd, reaps it.
        let helper_pid = waiter.id().to_string();
        wait_for("the helper polling", || {
            Command::new("/usr/bin/pgrep").args(["-P", &helper_pid, "sleep"]).stdout(Stdio::null()).status().unwrap().success()
        });
        assert_eq!(record(&folder), "", "the helper opened the app while the old copy ran");
        old.kill().unwrap();
        old.wait().unwrap();
        wait_for("the helper finishing", || waiter.try_wait().unwrap().is_some());
        assert_eq!(record(&folder), format!("exited\nopen\n-n\n/Applications/Example App.app\n--args\n{ARGS}"));
        let _ = std::fs::remove_dir_all(&folder);
    }

    #[test]
    fn an_old_copy_that_never_quits_is_opened_after_the_wait_anyway() {
        let folder = folder("bound");
        let opener = stand_in(&folder, "open", 0);
        let program = stand_in(&folder, "program", 0);
        let mut old = Command::new("/bin/sleep").arg("60").spawn().unwrap();
        let args = args();
        let mut waiter = helper(&opener, old.id(), 3, Path::new("/Applications/Example.app"), &program, &args)
            .env("OLD", old.id().to_string())
            .spawn()
            .unwrap();
        wait_for("the helper finishing", || waiter.try_wait().unwrap().is_some());
        assert!(record(&folder).starts_with("running\nopen\n-n\n"), "{}", record(&folder));
        old.kill().unwrap();
        old.wait().unwrap();
        let _ = std::fs::remove_dir_all(&folder);
    }

    #[test]
    fn a_failing_opener_falls_back_to_starting_the_program_itself() {
        let folder = folder("fallback");
        let opener = stand_in(&folder, "open", 1);
        let program = stand_in(&folder, "program", 0);
        let args = args();
        // A process id that has exited, so the helper does not wait.
        let mut gone = Command::new("/usr/bin/true").spawn().unwrap();
        gone.wait().unwrap();
        let mut waiter = helper(&opener, gone.id(), WAIT_TENTHS, Path::new("/Applications/Example.app"), &program, &args)
            .env("OLD", gone.id().to_string())
            .spawn()
            .unwrap();
        wait_for("the helper finishing", || waiter.try_wait().unwrap().is_some());
        assert_eq!(
            record(&folder),
            format!("exited\nopen\n-n\n/Applications/Example.app\n--args\n{ARGS}exited\nprogram\n{ARGS}")
        );
        let _ = std::fs::remove_dir_all(&folder);
    }

    #[test]
    fn the_bundle_is_found_only_from_a_program_inside_one() {
        assert_eq!(
            bundle_of(Path::new("/Applications/Example App.app/Contents/MacOS/example")),
            Some(PathBuf::from("/Applications/Example App.app"))
        );
        assert_eq!(bundle_of(Path::new("/work/example/src-tauri/target/debug/example")), None);
        assert_eq!(bundle_of(Path::new("/work/Contents/MacOS/example")), None);
    }
}
