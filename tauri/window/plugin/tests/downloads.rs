// A Download link in the window saves its file to the Downloads folder and asks for it to be selected in Finder, in a
// real Mac web view: wry cancels every download in a window with no download handler, which a mocked runtime never
// shows. The window is the one `Site::window` builds, hidden as it opens, onto a page this test serves on loopback,
// whose script clicks an `<a download>`. The process is barred from the Dock and the menu bar and never activates, so
// nothing reaches the screen, and Finder is never asked: `Site::on_downloaded` hands the finished file to this test.
// wry finds the Downloads folder under $HOME, which this test points at a folder of its own, so this Mac's Downloads
// folder is never touched. macOS runs a web view only on the main thread, so this test is its own program
// (harness = false in Cargo.toml).

#[cfg(target_os = "macos")]
mod mac {
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::OnceLock;
    use std::time::Duration;
    use tauri::{ActivationPolicy, WebviewUrl};
    use tauri_plugin_app_kit_window::Site;

    const FILE_NAME: &str = "Exhibit A.pdf";
    const CONTENT: &[u8] = b"%PDF-1.4 a made-up exhibit\n";
    /// How long the test waits before it calls the download lost. A download that works arrives in well under a
    /// second; this only keeps a broken window from holding the test run forever.
    const GIVE_UP_AFTER: Duration = Duration::from_secs(60);

    static HOME: OnceLock<PathBuf> = OnceLock::new();
    /// What the page's server was asked for, so a failure says how far the download got.
    static PAGE_SERVED: AtomicBool = AtomicBool::new(false);
    static FILE_SERVED: AtomicBool = AtomicBool::new(false);

    fn page() -> String {
        format!(
            r#"<!doctype html><a id="download" href="/files/7?token=abc" download="{FILE_NAME}">Download</a>
<script>document.getElementById("download").click();</script>"#
        )
    }

    /// Answers each request on its own connection: the page at `/`, the file under `/files/`.
    fn serve(listener: TcpListener) {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut request = String::new();
            let _ = BufReader::new(&stream).read_line(&mut request);
            let path = request.split_whitespace().nth(1).unwrap_or("/").to_string();
            let (kind, body) = if path.starts_with("/files/") {
                FILE_SERVED.store(true, Ordering::SeqCst);
                ("application/pdf", CONTENT.to_vec())
            } else {
                PAGE_SERVED.store(true, Ordering::SeqCst);
                ("text/html; charset=utf-8", page().into_bytes())
            };
            let head = format!("HTTP/1.1 200 OK\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(&body);
        }
    }

    fn finish(code: i32, line: &str) -> ! {
        if let Some(home) = HOME.get() {
            let _ = std::fs::remove_dir_all(home);
            // The process's folder goes too once nothing else of this process is in it.
            if let Some(process) = home.parent() {
                let _ = std::fs::remove_dir(process);
            }
        }
        if code == 0 {
            println!("{line}");
        } else {
            eprintln!("{line}");
        }
        std::process::exit(code)
    }

    /// Where Finder would have been asked to select the file.
    fn downloaded(path: &Path) {
        let home = HOME.get().expect("the test's home folder");
        let expected = home.join("Downloads").join(FILE_NAME);
        if path != expected {
            finish(1, &format!("failed: the download was saved to {}, not {}", path.display(), expected.display()));
        }
        match std::fs::read(path) {
            Ok(content) if content == CONTENT => {
                finish(0, "ok: a Download link saves its file to the Downloads folder and asks Finder to select it")
            }
            Ok(content) => finish(1, &format!("failed: the downloaded file holds {} bytes, not the {} served", content.len(), CONTENT.len())),
            Err(error) => finish(1, &format!("failed: Finder was asked to select {}, which is not there: {error}", path.display())),
        }
    }

    pub fn main() {
        let home = Path::new("/tmp/app-kit-tests").join(std::process::id().to_string()).join("downloads-home");
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(home.join("Downloads")).unwrap();
        // Before anything reads it: wry finds the Downloads folder as $HOME/Downloads.
        std::env::set_var("HOME", &home);
        HOME.set(home).unwrap();

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address: tauri::Url = format!("http://127.0.0.1:{}/", listener.local_addr().unwrap().port()).parse().unwrap();
        std::thread::spawn(move || serve(listener));
        std::thread::spawn(|| {
            std::thread::sleep(GIVE_UP_AFTER);
            let line = match (PAGE_SERVED.load(Ordering::SeqCst), FILE_SERVED.load(Ordering::SeqCst)) {
                (false, _) => "failed: the window never asked for the page",
                (true, false) => "failed: the page loaded and its Download link was clicked, but the window never asked for the file: it cancelled the download",
                (true, true) => "failed: the file was served, but the window never said the download finished",
            };
            finish(1, line);
        });

        let site = Site::new(address.clone()).on_downloaded(downloaded);
        let window_site = site.clone();
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().identifier = "com.example.downloads".into();
        tauri::Builder::default()
            .activate_ignoring_other_apps(false)
            .plugin(tauri_plugin_opener::init())
            .plugin(site.plugin())
            .setup(move |app| {
                app.set_activation_policy(ActivationPolicy::Prohibited);
                window_site.window(app, WebviewUrl::External(address)).build()?;
                Ok(())
            })
            .build(context)
            .unwrap()
            .run(|_, _| {});
        finish(1, "failed: the app ended before a download arrived");
    }
}

#[cfg(target_os = "macos")]
fn main() {
    mac::main()
}

#[cfg(not(target_os = "macos"))]
fn main() {}
