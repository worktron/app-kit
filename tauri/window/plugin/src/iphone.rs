//! What only the iPhone window does.

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
