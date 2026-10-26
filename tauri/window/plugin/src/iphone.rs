//! What only the iPhone window does.

/// The iPhone's web view drops a page's requests for a new window (wry answers them on the Mac only), so window.open
/// would do nothing, as Google sign-in's trip to Safari or a link opened from a script. This hands each to the opener
/// plugin, which opens it in Safari or the app for it; the opener's own script already does the same for a click on a
/// link with target=_blank. test/tauri-window.test.ts runs it in a simulated page.
pub(crate) const WINDOW_OPEN_SCRIPT: &str = r#"(() => {
  window.open = (url) => {
    if (url) {
      window.__TAURI_INTERNALS__
        .invoke('plugin:opener|open_url', { url: new URL(String(url), location.href).href })
        .catch((error) => console.warn('[app-kit-window] could not open a new window:', String(error)));
    }
    return null;
  };
})();"#;
