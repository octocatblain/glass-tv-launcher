package com.glasstv.launcher

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
class LauncherBridge(private val activity: MainActivity) {

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
            activity.runJs("window.onApps(${JSONObject.quote(arr.toString())})")
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
            val title = md?.getString(MediaMetadata.METADATA_KEY_TITLE)
                ?: md?.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE) ?: ""
            if (title.isEmpty() && ps == null) continue
            val subtitle = md?.getString(MediaMetadata.METADATA_KEY_ARTIST)
                ?: md?.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE)
                ?: md?.getString(MediaMetadata.METADATA_KEY_ALBUM) ?: ""
            val o = JSONObject()
            o.put("pkg", mc.packageName)
            o.put("title", title)
            o.put("subtitle", subtitle)
            o.put("state", if (ps?.state == PlaybackState.STATE_PLAYING ||
                ps?.state == PlaybackState.STATE_BUFFERING) "playing" else "paused")
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
