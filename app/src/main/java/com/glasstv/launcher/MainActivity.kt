package com.glasstv.launcher

import android.annotation.SuppressLint
import android.app.Activity
import android.app.role.RoleManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * Android TV OS 12 compatible Home Launcher host activity.
 * Hearth: renders the UI in a hardware-accelerated WebView and handles TV remote keys.
 */
class MainActivity : Activity(), JsHost {

    private lateinit var web: WebView
    private lateinit var idle: IdleController
    private lateinit var weather: Weather

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        web = WebView(this).apply {
            setBackgroundColor(0xFF010F28.toInt())
            setLayerType(View.LAYER_TYPE_HARDWARE, null)
            isFocusable = true
            isFocusableInTouchMode = true
            overScrollMode = View.OVER_SCROLL_NEVER
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = true
                allowContentAccess = false
                mediaPlaybackRequiresUserGesture = false
                // TCL's system font-size setting would otherwise inflate all launcher text.
                textZoom = 100
                useWideViewPort = true
                loadWithOverviewMode = false
                setSupportZoom(false)
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            }

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
            }
            addJavascriptInterface(LauncherBridge(this@MainActivity), "Launcher")
        }

        setContentView(
            web,
            ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )
        idle = IdleController(this)
        weather = Weather(this)
        web.loadUrl("file:///android_asset/index.html")
        web.post { requestDefaultLauncher() }
    }

    /** Methods called from the page through LauncherBridge. */
    fun setIdleMinutes(minutes: Int) {
        idle.setIdleMinutes(minutes)
    }

    fun setScreenSaverEnabled(enabled: Boolean) {
        idle.setScreenSaverEnabled(enabled)
    }

    fun requestWeather(lat: String, lon: String, place: String, units: String) {
        weather.request(lat, lon, place, units)
    }

    /**
     * Android never lets an app make itself the home app silently. Ask once via the system
     * role dialog; if the TV doesn't offer it, open the Home app settings screen instead.
     */
    private fun requestDefaultLauncher() {
        val prefs = getSharedPreferences("launcher", MODE_PRIVATE)
        if (prefs.getBoolean("asked_default", false)) return
        val home = packageManager.resolveActivity(
            Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), 0
        )
        if (home?.activityInfo?.packageName == packageName) return
        prefs.edit().putBoolean("asked_default", true).apply()
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                val rm = getSystemService(RoleManager::class.java)
                if (rm != null && rm.isRoleAvailable(RoleManager.ROLE_HOME) && !rm.isRoleHeld(RoleManager.ROLE_HOME)) {
                    startActivityForResult(rm.createRequestRoleIntent(RoleManager.ROLE_HOME), 1)
                    return
                }
            }
            startActivity(Intent(Settings.ACTION_HOME_SETTINGS))
        } catch (_: Exception) {
            // Nothing to show; the Settings screen in the launcher has a "Default launcher" row.
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemUi()
    }

    @Suppress("DEPRECATION")
    private fun hideSystemUi() {
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_FULLSCREEN or
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
    }

        override fun runJs(js: String) {
        runOnUiThread {
            try {
                web.evaluateJavascript(js, null)
            } catch (_: Exception) {
                // The page or WebView has already gone away (for example, during shutdown).
            }
        }
    }

    override fun onResume() {
        super.onResume()
        idle.onResume()
        runJs("window.onResumeLauncher&&window.onResumeLauncher()")
    }

    override fun onPause() {
        idle.onPause()
        super.onPause()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (idle.isScreenSaverActive()) {
            // Any remote key wakes the ambient saver without also activating UI underneath.
            idle.onUserInput()
            return true
        }
        idle.onUserInput()
        return super.dispatchKeyEvent(event)
    }

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (idle.isScreenSaverActive()) {
            idle.onUserInput()
            return true
        }
        idle.onUserInput()
        return super.dispatchTouchEvent(ev)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.hasCategory(Intent.CATEGORY_HOME)) {
            runJs("window.goHome&&window.goHome()")
        }
        intent.getStringExtra(EXTRA_TARGET)?.let { target ->
            intent.removeExtra(EXTRA_TARGET)
            runJs("window.openTarget&&window.openTarget(" + org.json.JSONObject.quote(target) + ")")
        }
        if (intent.getBooleanExtra(EXTRA_QSET, false)) {
            intent.removeExtra(EXTRA_QSET)
            runJs("window.toggleQset&&window.toggleQset()")
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        when (keyCode) {
            KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_ESCAPE -> {
                runJs("window.onBack&&window.onBack()")
                return true
            }
            KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_INFO, KeyEvent.KEYCODE_SETTINGS, KeyEvent.KEYCODE_NOTIFICATION -> {
                runJs("window.onMenu&&window.onMenu()")
                return true
            }
            KeyEvent.KEYCODE_SEARCH, KeyEvent.KEYCODE_VOICE_ASSIST -> {
                runJs("window.onVoiceSearch&&window.onVoiceSearch()")
                return true
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    companion object {
        const val EXTRA_QSET = "open_quick_settings"
        const val EXTRA_TARGET = "open_target"
    }

    override fun onDestroy() {
        idle.onDestroy()
        web.destroy()
        super.onDestroy()
    }
}
