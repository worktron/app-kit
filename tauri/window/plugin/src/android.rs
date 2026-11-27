//! The Android window's bars. Tauri's Android activity draws edge to edge, and its web view (133 on the emulator the kit
//! checks with) passes the page no safe-area insets, so without the plugin the clock and the battery sat on the page's
//! first line. The plugin's Kotlin half (android/src/main/java/WindowPlugin.kt) pads the web view's parent, the
//! activity's content frame, by the bars; this half colours what the padding leaves: the strips behind the bars take
//! the start page's background, with the bars' icons dark on a light background and light on a dark one.

use jni::objects::{JObject, JValue};
use jni::JNIEnv;
use tauri::window::Color;
use tauri::{Manager, Runtime, Webview};

/// The Kotlin half's package, which its build.gradle.kts names as its namespace.
pub(crate) const IDENTIFIER: &str = "app.kit.window";

/// The start page's background, which the strips behind the bars take, kept by `start_page_window`.
pub(crate) struct BarColor(pub(crate) Color);

/// Android 11, from which a window says whether its bars' icons are dark.
const ANDROID_11: i32 = 30;
/// WindowInsetsController's APPEARANCE_LIGHT_STATUS_BARS and APPEARANCE_LIGHT_NAVIGATION_BARS: dark icons.
const LIGHT_BARS: i32 = 0x8 | 0x10;

/// Colours the strips behind the bars as the start page's background, for a window opened on the start page.
pub(crate) fn colour_bars<R: Runtime>(webview: &Webview<R>) {
    let Some(color) = webview.app_handle().try_state::<BarColor>().map(|kept| kept.0) else { return };
    let result = webview.with_webview(move |platform| {
        platform.jni_handle().exec(move |env, activity, view| match paint(env, activity, view, color) {
            Ok(()) => log::info!("the strips behind Android's bars take the start page's background"),
            Err(error) => {
                let _ = env.exception_clear();
                log::warn!("could not colour the strips behind Android's bars: {error}")
            }
        });
    });
    if let Err(error) = result {
        log::warn!("could not reach the Android web view to colour its bars: {error}");
    }
}

fn paint(env: &mut JNIEnv, activity: &JObject, view: &JObject, color: Color) -> jni::errors::Result<()> {
    let frame = env.call_method(view, "getParent", "()Landroid/view/ViewParent;", &[])?.l()?;
    if !frame.is_null() {
        env.call_method(&frame, "setBackgroundColor", "(I)V", &[JValue::Int(argb(color))])?;
    }
    let sdk = env.get_static_field("android/os/Build$VERSION", "SDK_INT", "I")?.i()?;
    if sdk >= ANDROID_11 {
        let window = env.call_method(activity, "getWindow", "()Landroid/view/Window;", &[])?.l()?;
        let bars = env.call_method(&window, "getInsetsController", "()Landroid/view/WindowInsetsController;", &[])?.l()?;
        if !bars.is_null() {
            let appearance = if is_light(color) { LIGHT_BARS } else { 0 };
            env.call_method(&bars, "setSystemBarsAppearance", "(II)V", &[JValue::Int(appearance), JValue::Int(LIGHT_BARS)])?;
        }
    }
    Ok(())
}

/// The colour as Android's packed ARGB int, opaque.
fn argb(color: Color) -> i32 {
    (0xffu32 << 24 | (color.0 as u32) << 16 | (color.1 as u32) << 8 | color.2 as u32) as i32
}

/// Whether dark icons read on the colour: its relative luminance above the midpoint.
fn is_light(color: Color) -> bool {
    let luminance = 0.2126 * color.0 as f32 + 0.7152 * color.1 as f32 + 0.0722 * color.2 as f32;
    luminance > 127.5
}
