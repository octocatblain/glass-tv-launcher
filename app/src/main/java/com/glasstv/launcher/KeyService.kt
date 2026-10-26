package com.glasstv.launcher

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent

/**
 * Some TVs (TCL, for one) handle the remote's Settings key inside the firmware: they launch their
 * own Settings app before any app, even an accessibility key filter, can see the key. So this
 * service watches for a TV Settings screen coming to the front (from Hearth or any other app) that
 * Hearth did not open itself, backs out of it and opens Hearth's quick settings sidebar instead.
 * It only looks at which app's window opened; it reads no screen content.
 */
class KeyService : AccessibilityService() {
    private val handler = Handler(Looper.getMainLooper())
    private var lastPkg = ""

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null || event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return
        // Volume bars, keyboards and the like pop over apps; they must not count as leaving one.
        if (pkg == "com.android.systemui" || pkg.contains("inputmethod")) return
        if (event.className?.toString()?.endsWith("QuickSettingsActivity") == true) return
        val prev = lastPkg
        lastPkg = pkg
        Log.d(TAG, "window $pkg / ${event.className} (from $prev)")
        if (pkg !in SETTINGS_PACKAGES || prev in SETTINGS_PACKAGES || prev.isEmpty()) return
        val now = System.currentTimeMillis()
        // Hearth's own "All settings" and shortcut buttons open Settings too; leave those alone.
        if (now - lastOwnOpen < 5000 || now - lastHandled < 1500) return
        lastHandled = now
        // The app that was underneath is where the sidebar belongs, so remember it for openSidebar().
        lastPkg = prev
        performGlobalAction(GLOBAL_ACTION_BACK)
        handler.postDelayed({ openSidebar() }, 250)
    }

    /**
     * TCL remotes send the Settings button as KEYCODE_NOTIFICATION.
     * Inside other apps nothing on the TV reacts to it, so take it here and open the sidebar.
     */
    override fun onKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode != KeyEvent.KEYCODE_NOTIFICATION) return false
        Log.d(TAG, "key ${event.keyCode} action ${event.action}")
        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) openSidebar()
        return true
    }

    /**
     * Opens or closes the sidebar. Inside Hearth the page shows it; over any other app a see-through
     * activity shows it so that app stays visible behind it. A second press closes it either way.
     */
    private fun openSidebar() {
        lastHandled = System.currentTimeMillis()
        val overlay = QuickSettingsActivity.instance
        if (overlay != null) {
            overlay.runOnUiThread { overlay.finish() }
            return
        }
        val target = if (lastPkg == packageName) MainActivity::class.java else QuickSettingsActivity::class.java
        startActivity(
            Intent(this, target)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                .putExtra(MainActivity.EXTRA_QSET, true)
        )
    }

    override fun onInterrupt() {}

    companion object {
        private const val TAG = "HearthKeyService"
        private val SETTINGS_PACKAGES = setOf("com.android.tv.settings", "com.android.settings")

        /** Set by the launcher whenever it opens an Android settings screen itself. */
        @Volatile
        var lastOwnOpen = 0L
        private var lastHandled = 0L
    }
}
