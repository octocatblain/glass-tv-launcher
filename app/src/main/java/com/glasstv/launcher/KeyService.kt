package com.glasstv.launcher

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
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
        val prev = lastPkg
        lastPkg = pkg
        Log.d(TAG, "window $pkg / ${event.className} (from $prev)")
        if (pkg !in SETTINGS_PACKAGES || prev in SETTINGS_PACKAGES || prev.isEmpty()) return
        val now = System.currentTimeMillis()
        // Hearth's own "All settings" and shortcut buttons open Settings too; leave those alone.
        if (now - lastOwnOpen < 5000 || now - lastHandled < 1500) return
        lastHandled = now
        performGlobalAction(GLOBAL_ACTION_BACK)
        handler.postDelayed({
            startActivity(
                Intent(this, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                    .putExtra(MainActivity.EXTRA_QSET, true)
            )
        }, 250)
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
