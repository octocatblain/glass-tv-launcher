package com.glasstv.launcher

import android.service.notification.NotificationListenerService

/**
 * Intentionally empty. Android only lets an app read other apps' media sessions
 * (what's playing) if it holds an enabled notification listener, so this service
 * exists purely to carry that permission. It never reads or stores notifications.
 */
class MediaListener : NotificationListenerService()
