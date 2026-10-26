package com.glasstv.launcher

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.net.Uri
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.provider.Settings
import android.speech.RecognizerIntent
import android.util.Base64
import android.webkit.JavascriptInterface
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/** Methods the page can call as `Launcher.<name>(...)`. Everything returns strings/booleans. */
class LauncherBridge(private val activity: Activity) {

    private val main get() = activity as? MainActivity

    private val pm get() = activity.packageManager

    // ---- Apps -------------------------------------------------------------------------

    /** Builds the installed-app list off the main thread, then calls window.onApps(json). */
    @JavascriptInterface
    fun requestApps() {
        Thread {
            val seen = HashSet<String>()
            val arr = JSONArray()
            val intents = listOf(
                Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER),
                Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            )
            for (intent in intents) {
                for (ri in pm.queryIntentActivities(intent, 0)) {
                    val pkg = ri.activityInfo.packageName
                    if (pkg == activity.packageName || !seen.add(pkg)) continue
                    val o = JSONObject()
                    o.put("pkg", pkg)
                    o.put("label", ri.loadLabel(pm).toString())
                    o.put("system", (ri.activityInfo.applicationInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0)
                    try {
                        o.put("icon", encodePng(ri.loadIcon(pm), 128))
                    } catch (_: Exception) {
                        o.put("icon", "")
                    }
                    arr.put(o)
                }
            }
            (activity as? JsHost)?.runJs("window.onApps(${JSONObject.quote(arr.toString())})")
        }.start()
    }

    @JavascriptInterface
    fun launch(pkg: String) {
        activity.runOnUiThread {
            val intent = pm.getLeanbackLaunchIntentForPackage(pkg) ?: pm.getLaunchIntentForPackage(pkg)
            if (intent == null) {
                toast("That app isn't installed")
            } else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                activity.startActivity(intent)
            }
        }
    }

    @JavascriptInterface
    fun version(): String = try {
        pm.getPackageInfo(activity.packageName, 0).versionName ?: ""
    } catch (_: Exception) {
        ""
    }

    /**
     * True when a package is installed, even if Android does not expose a launcher activity
     * for it (some TV builds hide the Netflix/Spotify icons). The media cards use this to tell
     * "not installed" apart from "the app list has not loaded yet".
     */
    @JavascriptInterface
    fun isInstalled(pkg: String): Boolean = try {
        pm.getPackageInfo(pkg, 0)
        true
    } catch (_: Exception) {
        false
    }

    // ---- Removing apps ------------------------------------------------------------------

    /**
     * User-installed apps get the system uninstall dialog. Pre-installed (bloatware) apps can't be
     * uninstalled by a normal app, so those open their App info page, where Android offers
     * Disable (and "Uninstall updates") when the manufacturer allows it.
     */
    @JavascriptInterface
    fun uninstall(pkg: String) {
        activity.runOnUiThread {
            if (pkg == activity.packageName) {
                toast("Remove Hearth from Settings > Apps")
                return@runOnUiThread
            }
            val info = try {
                pm.getApplicationInfo(pkg, 0)
            } catch (_: Exception) {
                toast("That app isn't installed")
                return@runOnUiThread
            }
            if ((info.flags and ApplicationInfo.FLAG_SYSTEM) != 0) {
                toast("Pre-installed app: choose Disable on the next screen", long = true)
                openAppInfo(pkg)
            } else {
                try {
                    activity.startActivity(
                        Intent(Intent.ACTION_DELETE, Uri.parse("package:$pkg")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    )
                } catch (_: Exception) {
                    openAppInfo(pkg)
                }
            }
        }
    }

    @JavascriptInterface
    fun appInfo(pkg: String) {
        activity.runOnUiThread { openAppInfo(pkg) }
    }

    private fun openAppInfo(pkg: String) {
        try {
            activity.startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (_: Exception) {
            toast("Couldn't open App info. Use Settings > Apps")
        }
    }

    // ---- Voice Search -------------------------------------------------------------------

    @JavascriptInterface
    fun openVoiceSearch() {
        activity.runOnUiThread {
            val intents = listOf(
                Intent(RecognizerIntent.ACTION_WEB_SEARCH),
                Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                },
                Intent(Intent.ACTION_VOICE_COMMAND),
                Intent("android.intent.action.GLOBAL_SEARCH")
            )
            var launched = false
            for (intent in intents) {
                try {
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    activity.startActivity(intent)
                    launched = true
                    break
                } catch (_: Exception) {
                }
            }
            if (!launched) {
                toast("Voice search is not available on this device")
            }
        }
    }

    // ---- System settings shortcuts --------------------------------------------------------

    @JavascriptInterface
    fun openSystem(kind: String) {
        val action = when (kind) {
            "network" -> Settings.ACTION_WIFI_SETTINGS
            "display" -> Settings.ACTION_DISPLAY_SETTINGS
            "sound" -> Settings.ACTION_SOUND_SETTINGS
            "apps" -> Settings.ACTION_APPLICATION_SETTINGS
            "accessibility" -> Settings.ACTION_ACCESSIBILITY_SETTINGS
            "bluetooth" -> Settings.ACTION_BLUETOOTH_SETTINGS
            "privacy" -> Settings.ACTION_PRIVACY_SETTINGS
            "home" -> Settings.ACTION_HOME_SETTINGS
            else -> Settings.ACTION_SETTINGS
        }
        startSettings(action, fallbackToAll = true)
    }

    @JavascriptInterface
    fun openNotificationAccess() {
        val ok = startSettings(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS, fallbackToAll = false)
        if (!ok) {
            toast(
                "Couldn't open that screen. Grant access over ADB: adb shell cmd notification " +
                    "allow_listener com.glasstv.launcher/com.glasstv.launcher.MediaListener",
                long = true
            )
        }
    }

    /** startActivity is safe to call from the bridge thread; returns whether something opened. */
    private fun startSettings(action: String, fallbackToAll: Boolean): Boolean {
        KeyService.lastOwnOpen = System.currentTimeMillis()
        return try {
            activity.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        } catch (_: ActivityNotFoundException) {
            if (!fallbackToAll) return false
            try {
                activity.startActivity(
                    Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
                true
            } catch (_: Exception) {
                toast("Settings isn't available on this device")
                false
            }
        }
    }

    // ---- Home screen behaviour -----------------------------------------------------------

    /** config.js idleMinutes: how long the launcher waits before letting the TV go idle. */
    @JavascriptInterface
    fun setIdleMinutes(minutes: Int) {
        main?.setIdleMinutes(minutes)
    }

    /** Settings > Screen saver. When off, idle lets the TV sleep instead of showing ambient mode. */
    @JavascriptInterface
    fun setScreenSaverEnabled(enabled: Boolean) {
        main?.setScreenSaverEnabled(enabled)
    }

    /** Hourly weather for the home header; answers with window.onWeather(json). */
    @JavascriptInterface
    fun requestWeather(lat: String, lon: String, place: String, units: String) {
        main?.requestWeather(lat, lon, place, units)
    }

    // ---- Now playing (reads other apps' media sessions) -------------------------------------

    @JavascriptInterface
    fun hasNotificationAccess(): Boolean = hasAccess()

    /** Every active media session (Spotify, Netflix, YouTube, ...) for the home screen cards. */
    @JavascriptInterface
    fun nowPlayingAll(): String {
        val arr = JSONArray()
        for (mc in sessions()) {
            val md = mc.metadata
            val ps = mc.playbackState
            val state = ps?.state ?: PlaybackState.STATE_NONE
            // Ignore sessions that are merely alive (for example Netflix keeps one after you
            // leave it) so the card falls back to "recent" instead of claiming it is paused.
            if (state != PlaybackState.STATE_PLAYING && state != PlaybackState.STATE_BUFFERING &&
                state != PlaybackState.STATE_PAUSED) continue
            val title = md?.getString(MediaMetadata.METADATA_KEY_TITLE)
                ?: md?.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE) ?: ""
            val subtitle = md?.getString(MediaMetadata.METADATA_KEY_ARTIST)
                ?: md?.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE)
                ?: md?.getString(MediaMetadata.METADATA_KEY_ALBUM) ?: ""
            val duration = md?.getLong(MediaMetadata.METADATA_KEY_DURATION) ?: 0L
            val position = ps?.position ?: 0L
            val progress = if (duration > 0L) {
                (position.toDouble() / duration).coerceIn(0.0, 1.0)
            } else 0.0
            val o = JSONObject()
            o.put("pkg", mc.packageName)
            o.put("title", title)
            o.put("subtitle", subtitle)
            o.put("progress", progress)
            o.put("state", if (state == PlaybackState.STATE_PLAYING ||
                state == PlaybackState.STATE_BUFFERING) "playing" else "paused")
            o.put("artKey", mc.packageName + "|" + title)
            arr.put(o)
        }
        return arr.toString()
    }

    /** Small cover art (base64 JPEG) for one app's session, fetched only when its track changes. */
    @JavascriptInterface
    fun artFor(pkg: String): String {
        val md = sessions().firstOrNull { it.packageName == pkg }?.metadata ?: return ""
        val bmp = md.getBitmap(MediaMetadata.METADATA_KEY_ART)
            ?: md.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
            ?: md.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
            ?: return ""
        val w = 360
        val scaled = if (bmp.width > w) {
            Bitmap.createScaledBitmap(bmp, w, (bmp.height * w.toFloat() / bmp.width).toInt().coerceAtLeast(1), true)
        } else bmp
        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, 80, out)
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    // ---- Sidebar over other apps -----------------------------------------------------------

    /** Closes the see-through sidebar (no-op inside the launcher itself). */
    @JavascriptInterface
    fun closeSidebar() {
        if (activity is QuickSettingsActivity) activity.runOnUiThread { activity.finish() }
    }

    /** Brings the launcher to the front, optionally on a screen ("settings") or the "saver". */
    @JavascriptInterface
    fun openHearth(target: String) {
        activity.runOnUiThread {
            activity.startActivity(
                Intent(activity, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                    .putExtra(MainActivity.EXTRA_TARGET, target)
            )
            if (activity is QuickSettingsActivity) activity.finish()
        }
    }

    // ---- Notifications (quick settings sidebar) ----------------------------------------------

    /** Active notifications from other apps, newest first. Empty without Notification access. */
    @JavascriptInterface
    fun notifications(): String {
        val arr = JSONArray()
        val svc = MediaListener.instance ?: return arr.toString()
        val list = try { svc.activeNotifications } catch (_: Exception) { null } ?: return arr.toString()
        for (sbn in list.sortedByDescending { it.postTime }) {
            if (sbn.packageName == activity.packageName) continue
            val n = sbn.notification
            if ((n.flags and (android.app.Notification.FLAG_GROUP_SUMMARY or android.app.Notification.FLAG_ONGOING_EVENT)) != 0) continue // skips background-service noise
            if (n.extras.containsKey("android.mediaSession")) continue // now-playing is already on the home cards
            val title = n.extras.getCharSequence(android.app.Notification.EXTRA_TITLE)?.toString() ?: ""
            val text = n.extras.getCharSequence(android.app.Notification.EXTRA_TEXT)?.toString() ?: ""
            if (title.isEmpty() && text.isEmpty()) continue
            val app = try {
                pm.getApplicationLabel(pm.getApplicationInfo(sbn.packageName, 0)).toString()
            } catch (_: Exception) { sbn.packageName }
            val o = JSONObject()
            o.put("key", sbn.key)
            o.put("pkg", sbn.packageName)
            o.put("app", app)
            o.put("title", title)
            o.put("text", text)
            try {
                o.put("icon", encodePng(pm.getApplicationIcon(sbn.packageName), 96))
            } catch (_: Exception) {
                o.put("icon", "")
            }
            arr.put(o)
            if (arr.length() >= 12) break
        }
        return arr.toString()
    }

    @JavascriptInterface
    fun dismissNotification(key: String) {
        try { MediaListener.instance?.cancelNotification(key) } catch (_: Exception) {}
    }

    @JavascriptInterface
    fun clearNotifications() {
        try { MediaListener.instance?.cancelAllNotifications() } catch (_: Exception) {}
    }

    // ---- Watch Next (what an app says you were last watching) -----------------------------------

    /**
     * Most recent Watch Next entry the given app published to the TV provider, as
     * {title, subtitle, progress, art, artUrl}, or "" when there is none or the TV has no provider.
     * Netflix publishes here on devices with a Google TV home; its media session has no title.
     */
    @JavascriptInterface
    fun watchNext(pkg: String): String {
        return try {
            val uri = Uri.parse("content://android.media.tv/watch_next_program")
            val cols = arrayOf("title", "short_description", "poster_art_uri", "duration_millis",
                "last_playback_position_millis", "last_engagement_time_utc_millis")
            activity.contentResolver.query(uri, cols, "package_name=?", arrayOf(pkg),
                "last_engagement_time_utc_millis DESC")?.use { c ->
                if (!c.moveToFirst()) return ""
                val o = JSONObject()
                o.put("title", c.getString(0) ?: "")
                o.put("subtitle", c.getString(1) ?: "")
                val dur = c.getLong(3)
                o.put("progress", if (dur > 0) (c.getLong(4).toDouble() / dur).coerceIn(0.0, 1.0) else 0.0)
                val art = c.getString(2) ?: ""
                o.put("artUrl", if (art.startsWith("http")) art else "")
                o.put("art", if (art.startsWith("content:")) encodeUri(Uri.parse(art)) else "")
                o.toString()
            } ?: ""
        } catch (_: Exception) {
            ""
        }
    }

    private fun encodeUri(uri: Uri): String = try {
        activity.contentResolver.openInputStream(uri)?.use { ins ->
            val bmp = android.graphics.BitmapFactory.decodeStream(ins) ?: return ""
            val w = 360
            val scaled = if (bmp.width > w) Bitmap.createScaledBitmap(bmp, w, (bmp.height * w.toFloat() / bmp.width).toInt().coerceAtLeast(1), true) else bmp
            val out = ByteArrayOutputStream()
            scaled.compress(Bitmap.CompressFormat.JPEG, 80, out)
            Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        } ?: ""
    } catch (_: Exception) { "" }

    // ---- helpers ------------------------------------------------------------------------

    private fun hasAccess(): Boolean {
        val flat = Settings.Secure.getString(activity.contentResolver, "enabled_notification_listeners")
        return flat?.contains(activity.packageName) == true
    }

    private fun sessions(): List<MediaController> {
        if (!hasAccess()) return emptyList()
        val msm = activity.getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
        return try {
            msm.getActiveSessions(ComponentName(activity, MediaListener::class.java))
        } catch (_: SecurityException) {
            emptyList()
        }
    }

    private fun encodePng(d: Drawable, size: Int): String {
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        d.setBounds(0, 0, size, size)
        d.draw(Canvas(bmp))
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
        bmp.recycle()
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    private fun toast(msg: String, long: Boolean = false) {
        activity.runOnUiThread {
            Toast.makeText(activity, msg, if (long) Toast.LENGTH_LONG else Toast.LENGTH_SHORT).show()
        }
    }
}
