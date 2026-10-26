// Edit this file, then rebuild the app.
window.CONFIG = {
  // These apps are shown first on the home row (in this order) if they are installed.
  pinned: [
    "com.spotify.tv.android",
    "com.spotify.music",
    "com.netflix.ninja",
    "com.google.android.youtube.tv",
    "com.cricfytv",
    "com.cricfy.tv",
    "tv.cricfy",
    "com.phlox.tvwebbrowser",
    "com.android.chrome",
    "com.openbrowser.tv",
    "org.mozilla.tv.firefox",
    "com.browsehere.tv"
  ],

  // How many apps appear on the home row (a final "All apps" tile is added after them).
  homeRowCount: 5,

  // The launcher only goes idle when no music is playing and there has been no remote
  // input for this many minutes. With the Screen saver setting on, idle shows the ambient
  // clock/weather screen; with it off, the TV is allowed to dim or sleep.
  idleMinutes: 15,

  // Weather panel below the now-playing cards (current hour and the next two hours).
  // Leave lat/lon null to find the TV's rough position from its public IP address. Set
  // both to pin a location, and use units "c" for Celsius or "f" for Fahrenheit.
  weather: {
    lat: null,
    lon: null,
    place: "",
    units: "c"
  }
};
