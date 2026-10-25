package com.glasstv.launcher

import android.annotation.SuppressLint
import android.app.Activity
import android.app.role.RoleManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * Android TV OS 12 compatible Home Launcher host activity.
 * Renders the Glass UI in a hardware-accelerated WebView and handles TV remote keys.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        web = WebView(this).apply {
            setBackgroundColor(0xFF0E1118.toInt())
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
        web.loadUrl("file:///android_asset/index.html")
        web.post { requestDefaultLauncher() }
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

    fun runJs(js: String) {
        runOnUiThread { web.evaluateJavascript(js, null) }
    }

    override fun onResume() {
        super.onResume()
        runJs("window.onResumeLauncher&&window.onResumeLauncher()")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.hasCategory(Intent.CATEGORY_HOME)) {
            runJs("window.goHome&&window.goHome()")
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        when (keyCode) {
            KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_ESCAPE -> {
                runJs("window.onBack&&window.onBack()")
                return true
            }
            KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_INFO -> {
                runJs("window.onMenu&&window.onMenu()")
                return true
            }
            KeyEvent.KEYCODE_SEARCH,KeyEvent.KEYCODE_VOICE_ASSIST -> {
                runJs("window.onVoiceSearch&&window.onVoiceSearch()")
                return true
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }
}
