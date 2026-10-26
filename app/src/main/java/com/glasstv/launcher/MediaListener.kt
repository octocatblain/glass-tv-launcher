package com.glasstv.launcher

import android.service.notification.NotificationListenerService

/**
 * Android only lets an app read other apps' media sessions (what's playing) and notifications
 * if it holds an enabled notification listener, so this service carries that permission.
 * Nothing is stored or sent anywhere: the launcher reads the live list on demand to show it in
 * the quick settings sidebar.
 */
class MediaListener : NotificationListenerService() {
    override fun onListenerConnected() {
        instance = this
    }

    override fun onListenerDisconnected() {
        if (instance === this) instance = null
    }

    companion object {
        @Volatile
        var instance: MediaListener? = null
    }
}
