//! What only the iPhone window does.

/// Turns on the web view's swipe from the left edge back, and from the right edge forward, which iOS keeps off unless an
/// app turns it on, so a screen the site moved to has a way back, as in every iOS app. It goes through the site's
/// in-page moves (pushState) as well as page loads, except a move the page made without a tap, which WebKit skips on
/// purpose. Wry has the setting but Tauri never passes it on, so it is set on the live web view; wry sets it only on
/// the Mac, so nothing turns it off again. Tauri calls this on the main thread, where `with_webview` runs at once.
#[cfg(target_os = "ios")]
pub(crate) fn allow_swipe_back<R: tauri::Runtime>(webview: &tauri::Webview<R>) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    let reached = webview.with_webview(|platform| {
        // The WKWebView, held by wry for as long as this closure runs; the pointer is not kept past it.
        let Some(view) = (unsafe { (platform.inner() as *const AnyObject).as_ref() }) else {
            log::warn!("the window has no web view to turn on the swipe back in");
            return;
        };
        let () = unsafe { msg_send![view, setAllowsBackForwardNavigationGestures: true] };
        let on: bool = unsafe { msg_send![view, allowsBackForwardNavigationGestures] };
        if on {
            log::info!("the window takes a swipe from the left edge back through its pages");
        } else {
            log::warn!("the window's web view kept its swipe back off after it was turned on");
        }
    });
    if reached.is_err() {
        log::warn!("could not reach the window's web view to turn on the swipe back");
    }
}

/// The iPhone's web view drops a page's requests for a new window (wry answers them on the Mac only), so window.open
/// would do nothing, as Google sign-in's trip to Safari or a link opened from a script. This hands each to the opener
/// plugin, which opens it in Safari or the app for it; the opener's own script already does the same for a click on a
/// link with target=_blank. A target that names this window or one holding it moves the app's own window, which the web
/// view does itself, so it is left to the web view's window.open. test/tauri-window.test.ts runs it in a simulated page.
pub(crate) const WINDOW_OPEN_SCRIPT: &str = r#"(() => {
  const open = window.open.bind(window);
  window.open = (url, target, features) => {
    if (typeof target === 'string' && ['_self', '_parent', '_top'].includes(target.toLowerCase())) return open(url, target, features);
    if (url) {
      window.__TAURI_INTERNALS__
        .invoke('plugin:opener|open_url', { url: new URL(String(url), location.href).href })
        .catch((error) => console.warn('[app-kit-window] could not open a new window:', String(error)));
    }
    return null;
  };
})();"#;
