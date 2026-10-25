# Glass Launcher (Google TV / Android TV)

A custom home screen with the translucent glass design: home with app tiles,
a settings screen, an all-apps grid, and a Now Playing screen. It's a thin Android app (Kotlin)
that hosts the UI as web assets in a WebView.

> **Status:** written and checked for syntax, and the UI was rendered and navigated in a
> desktop browser. The Android project itself has **not been compiled or run on a TV** yet.
> Expect to fix a small build issue or two on first sync.

## What each screen does

| Screen | What's real |
| --- | --- |
| Home | Your installed apps (pinned ones first) and a clock |
| All apps | Every launchable app on the TV |
| Settings | Shortcuts that open the real Android settings (Network, Display, Sound, Apps, Accessibility, Privacy), plus launcher options (accent color, 24h clock, reduce glass effects) |
| Now playing | What any app is playing right now, with play/pause, skip and ±10s. Needs one permission (see below) |

## Build

1. Install Android Studio and open the `glass-tv-launcher` folder. Let Gradle sync.
2. Optional: edit `app/src/main/assets/config.js` (pinned apps).
3. Build and run: **Run ▶** to a connected TV, or **Build > Build APK(s)**.
   The APK ends up in `app/build/outputs/apk/debug/`.

## Install on the TV (ADB)

1. On the TV: Settings > System > About, tap **Build** seven times to enable developer options.
2. Settings > System > Developer options: turn on **USB debugging** (or **Network debugging**).
3. From your computer (same network): `adb connect <tv-ip>:5555`, then
   `adb install -r app-debug.apk`.
4. Open **Glass Launcher** from the app list once. Press Home: if Android asks which
   home app to use, pick Glass Launcher and choose "Always".

### If Home still opens the stock screen

Many Google TV builds insist on their own launcher. Try, in order:

```
adb shell cmd package set-home-activity com.glasstv.launcher/.MainActivity
```

If that doesn't stick, you can disable the stock launcher. This is the risky step: if
anything goes wrong, the Home button can stop working until you undo it.

```
# disable (Google TV)
adb shell pm disable-user --user 0 com.google.android.apps.tv.launcherx
# undo
adb shell pm enable com.google.android.apps.tv.launcherx
```

(Older Android TV builds use `com.google.android.tvlauncher` instead.) Keep ADB access
working before you try this so you can always undo it.

## Enable "Now playing"

Android only shares what's playing with apps you allow:

- In the launcher: Settings > **Now playing access**, then enable Glass Launcher; or
- Over ADB (works when the TV has no such screen):
  `adb shell cmd notification allow_listener com.glasstv.launcher/com.glasstv.launcher.MediaListener`

On Android 13+ a sideloaded app may be blocked from this setting ("restricted setting").
The ADB command above gets around that. The service never reads notifications; it only
exists to unlock media sessions.

## Preview without a TV

Open `app/src/main/assets/index.html` in Chrome and use the arrow keys, Enter and Esc.
It uses demo data when it isn't running inside the app.

## Customizing

- Look and layout: `style.css` (the UI is a fixed 1920x1080 stage that scales to the screen)
- Behavior and navigation: `app.js`
- Native bits (app list, launching, media session): `LauncherBridge.kt`

## Known limits

- The glass blur can be heavy on budget TV hardware. If it feels slow, turn on
  **Settings > Reduce glass effects**.
- The app icon and TV banner are simple vector drawables. If the banner looks soft in the
  TV's app list, replace `drawable/banner.xml` with a 320x180 PNG named `banner.png`.
- Voice search and the Google TV recommendations/Watch Next feed aren't included.
