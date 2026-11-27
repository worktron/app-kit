package app.kit.window

import android.app.Activity
import android.util.Log
import android.view.View
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Plugin

/**
 * Keeps the page between Android's status bar and navigation bar, and above the keyboard, as iOS keeps it in the safe
 * area. Tauri's activity draws edge to edge and its web view gives the page no safe-area insets, so the web view's
 * parent, the activity's content frame, is padded by the bars, the display cutout and the keyboard each time Android
 * says they changed. The strips the padding leaves take the start page's background, which the plugin's Rust sets
 * (src/android.rs).
 */
@TauriPlugin
class WindowPlugin(activity: Activity) : Plugin(activity) {
    private var told = ""

    override fun load(webView: WebView) {
        val frame = webView.parent as? View
        if (frame == null) {
            Log.w(TAG, "the web view has no parent to pad, so the page draws under Android's bars")
            return
        }
        ViewCompat.setOnApplyWindowInsetsListener(frame) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
            )
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            val now = "${bars.top} at the top and ${bars.bottom} at the bottom"
            if (now != told) {
                told = now
                Log.i(TAG, "the page is kept between Android's bars: $now")
            }
            WindowInsetsCompat.CONSUMED
        }
        ViewCompat.requestApplyInsets(frame)
    }

    private companion object {
        const val TAG = "app_kit_window"
    }
}
