package app.kit.window

import android.app.Activity
import android.os.Build
import android.util.Log
import android.view.View
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Plugin

/**
 * Keeps the page between Android's status bar and navigation bar, and above the keyboard, as iOS keeps it in the safe
 * area. Tauri's activity draws edge to edge and its web view gives the page no safe-area insets, so the activity's
 * content frame, which wry puts the web view in, is padded by the bars, the display cutout and the keyboard each time
 * Android says they changed. The strips the padding leaves take the start page's background, which the plugin's Rust
 * sets (src/android.rs).
 *
 * When Android recreates the activity for a change it does not hand to the app (a font size or a theme overlay), wry
 * builds a new web view in the new activity, but Tauri calls a plugin's `load` only once, for the first. So the frame is
 * padded again as each activity resumes, which Tauri does tell plugins, with the activity.
 */
@TauriPlugin
class WindowPlugin(activity: Activity) : Plugin(activity) {
    private var told = ""
    /** The frame last padded, whose background and window's bar icons a recreated activity takes. */
    private var padded: View? = null

    override fun load(webView: WebView) {
        val activity = webView.context as? Activity
        if (activity == null) {
            Log.w(TAG, "the web view is in no activity to pad, so the page draws under Android's bars")
            return
        }
        pad(activity)
    }

    override fun onResume(activity: AppCompatActivity) = pad(activity)

    /**
     * Pads the activity's content frame, once per frame. When a recreated activity has replaced the frame, the new one
     * takes the old one's background and the new window the old one's bar icons, which the Rust half painted on the
     * first.
     */
    private fun pad(activity: Activity) {
        val frame = activity.findViewById<View>(android.R.id.content) ?: return
        val before = padded
        if (before === frame) return
        if (before != null) {
            frame.background = before.background
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val icons = (before.context as? Activity)?.window?.insetsController?.systemBarsAppearance ?: 0
                activity.window?.insetsController?.setSystemBarsAppearance(icons and LIGHT_BARS, LIGHT_BARS)
            }
            Log.i(TAG, "the recreated window keeps the strips behind Android's bars as they were")
        }
        padded = frame
        told = ""
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
        /** APPEARANCE_LIGHT_STATUS_BARS and APPEARANCE_LIGHT_NAVIGATION_BARS: dark icons, as src/android.rs sets them. */
        const val LIGHT_BARS = 0x8 or 0x10
    }
}
