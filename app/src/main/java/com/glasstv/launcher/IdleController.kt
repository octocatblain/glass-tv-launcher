package com.glasstv.launcher

import android.content.Context
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.WindowManager

/**
 * Decides whether the launcher is idle, keeps the TV awake while it is not, and drives the
 * in-app ambient screen saver.
 *
 * Google TV starts its Daydream / screensaver after a period without remote key presses.
 * The home screen sitting still does not count as activity, so the screensaver can cover
 * the launcher while Spotify or YouTube keeps playing in the background. The TV's
 * screensaver scheduler honours [WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON], so the
 * launcher holds that flag whenever something is playing.
 *
 * The launcher counts as idle only when both are true:
 *  - no music is playing (checked through [AudioManager.isMusicActive], which does not
 *    need notification access), and
 *  - there has been no remote input and no audio for [idleMinutes] (15 by default).
 *
 * Audio counts as activity, so the 15 minute countdown starts when the music stops rather
 * than being already expired. When idle, the page is told to show its ambient screen saver.
 * If the saver is enabled the launcher keeps the display on while showing it; if the user
 * turns the saver off, the flag is released and the TV can dim, dream or sleep normally.
 */
class IdleController(private val activity: MainActivity) {

    companion object {
        const val DEFAULT_IDLE_MINUTES = 15
        private const val POLL_MS = 2_500L
        private const val MINUTE_MS = 60_000L
    }

    private val handler = Handler(Looper.getMainLooper())
    private val audio = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    private var idleMinutes = DEFAULT_IDLE_MINUTES
    private var lastActivityAt = SystemClock.elapsedRealtime()
    private var lastAudioAt = 0L
    private var keepScreenOn = false
    private var running = false
    private var lastIdle = false
    private var screenSaverEnabled = true

    private val tick = object : Runnable {
        override fun run() {
            evaluate()
            if (running) handler.postDelayed(this, POLL_MS)
        }
    }

    /** Set from config.js; clamped so a typo cannot keep the TV awake for days. */
    fun setIdleMinutes(minutes: Int) {
        // Called from the WebView's JavaScript bridge thread; window flags need the main thread.
        handler.post {
            idleMinutes = minutes.coerceIn(1, 24 * 60)
            evaluate()
        }
    }

    /** Toggled from Settings. When disabled, idle once again lets the TV sleep. */
    fun setScreenSaverEnabled(enabled: Boolean) {
        handler.post {
            if (screenSaverEnabled == enabled) return@post
            screenSaverEnabled = enabled
            if (!enabled) {
                if (lastIdle) {
                    lastIdle = false
                    activity.runJs("window.dismissScreensaver&&window.dismissScreensaver()")
                }
            } else if (lastIdle) {
                activity.runJs("window.onIdleChange&&window.onIdleChange(true)")
            }
            evaluate()
        }
    }

    fun isScreenSaverActive(): Boolean = running && lastIdle && screenSaverEnabled

    /** Any remote key or touch proves somebody is using the TV. */
    fun onUserInput() {
        val wasSaver = isScreenSaverActive()
        lastActivityAt = SystemClock.elapsedRealtime()
        if (wasSaver) {
            lastIdle = false
            activity.runJs("window.dismissScreensaver&&window.dismissScreensaver()")
        }
        // If the launcher had already gone idle, restore keep-awake immediately rather than
        // waiting for the next poll. While awake there is nothing to do.
        if (running && (wasSaver || !keepScreenOn)) evaluate()
    }

    fun onResume() {
        running = true
        // Coming back to the home screen is itself activity, even if the user was in another
        // app for a while.
        lastActivityAt = SystemClock.elapsedRealtime()
        lastIdle = false
        activity.runJs("window.onIdleChange&&window.onIdleChange(false)")
        handler.removeCallbacks(tick)
        evaluate()
        handler.postDelayed(tick, POLL_MS)
    }

    fun onPause() {
        running = false
        lastIdle = false
        handler.removeCallbacks(tick)
        // Not the visible app any more: whatever is on screen now owns the keep-awake flag.
        applyKeepScreenOn(false)
        activity.runJs("window.dismissScreensaver&&window.dismissScreensaver()")
    }

    fun onDestroy() {
        running = false
        lastIdle = false
        handler.removeCallbacks(tick)
        applyKeepScreenOn(false)
    }

    private fun evaluate() {
        // A queued task must not re-add the flag after the activity has gone to the background.
        if (!running) return
        val now = SystemClock.elapsedRealtime()
        val playing = try {
            audio.isMusicActive
        } catch (_: Exception) {
            false
        }
        if (playing) lastAudioAt = now
        val lastActive = maxOf(lastActivityAt, lastAudioAt)
        val idle = !playing && now - lastActive >= idleMinutes * MINUTE_MS
        if (idle != lastIdle) {
            lastIdle = idle
            activity.runJs("window.onIdleChange&&window.onIdleChange($idle)")
        }
        // With the ambient saver on, the display stays on while the saver is showing. With it
        // off, an idle launcher releases the screen and lets the TV sleep.
        applyKeepScreenOn(!idle || screenSaverEnabled)
    }

    private fun applyKeepScreenOn(on: Boolean) {
        if (on == keepScreenOn) return
        keepScreenOn = on
        if (on) {
            activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }
}
