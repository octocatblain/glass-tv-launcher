(() => {
  'use strict';

  const C = window.CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const stage = $('#stage');

  /* ---------------------------------------------------------------------------
   * Native bridge. On the TV, `window.Launcher` is injected by MainActivity.
   * Opened in a desktop browser it falls back to this mock so you can preview
   * and tweak the UI with the arrow keys before building the app.
   * ------------------------------------------------------------------------- */
  const Native = window.Launcher || (() => {
    const demo = [
      { pkg: 'com.spotify.tv.android', label: 'Spotify', icon: '' },
      { pkg: 'com.netflix.ninja', label: 'Netflix', icon: '' },
      { pkg: 'com.google.android.youtube.tv', label: 'YouTube', icon: '' },
      { pkg: 'com.cricfytv', label: 'CricfyTV', icon: '' },
      { pkg: 'com.phlox.tvwebbrowser', label: 'Browser', icon: '' },
      { pkg: 'com.tcl.demo.bloat', label: 'TCL Demo App', icon: '', system: true }
    ];
    const toastMock = (m) => showToast(m);
    const pad = (n) => (n < 10 ? '0' : '') + n;
    // Demo hourly forecast for the preview: temperatures that peak in the afternoon and a
    // rotating set of conditions, always relative to the hour you open the page.
    const demoWeather = (place, units) => {
      const start = new Date();
      start.setMinutes(0, 0, 0);
      start.setHours(start.getHours() - 25);
      const time = [];
      const temp = [];
      const code = [];
      const precip = [];
      for (let i = 0; i < 73; i++) {
        const d = new Date(start.getTime() + i * 3600000);
        const h = d.getHours();
        time.push(d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(h) + ':00');
        temp.push(Math.round(18 + 8 * Math.sin((h - 8) / 24 * Math.PI * 2)));
        code.push([0, 1, 2, 3, 61, 80][Math.floor(i / 10) % 6]);
        precip.push((i * 13) % 70);
      }
      const now = new Date();
      return {
        place: place || 'Nairobi',
        units: units === 'f' ? 'f' : 'c',
        fetchedAt: Date.now(),
        stale: false,
        current: {
          time: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
            'T' + pad(now.getHours()) + ':' + pad(now.getMinutes()),
          temperature_2m: temp[25],
          weather_code: code[25]
        },
        hourly: { time, temperature_2m: temp, weather_code: code, precipitation_probability: precip }
      };
    };
    return {
      requestApps() { setTimeout(() => window.onApps(JSON.stringify(demo)), 50); },
      launch(p) { toastMock('Would launch ' + p); },
      uninstall(p) { toastMock('Would uninstall ' + p); },
      appInfo(p) { toastMock('Would open app info: ' + p); },
      openVoiceSearch() { toastMock('Would start Voice Search'); },
      openSystem(k) { toastMock('Would open system settings: ' + k); },
      openNotificationAccess() { toastMock('Would open notification access'); },
      hasNotificationAccess() { return true; },
      isInstalled(p) { return ['com.spotify.tv.android', 'com.netflix.ninja', 'com.google.android.youtube.tv'].indexOf(p) >= 0; },
      setIdleMinutes() { /* native only */ },
      setScreenSaverEnabled() { /* native only */ },
      requestWeather(lat, lon, place, units) {
        setTimeout(() => window.onWeather && window.onWeather(JSON.stringify(demoWeather(place, units))), 80);
      },
      nowPlayingAll() {
        return JSON.stringify([
          { pkg: 'com.spotify.tv.android', title: 'Blinding Lights', subtitle: 'The Weeknd', state: 'playing', artKey: 'a', progress: 0.55 },
          { pkg: 'com.google.android.youtube.tv', title: 'Northern Lights 4K', subtitle: 'Nature Channel', state: 'paused', artKey: 'b', progress: 0.35 }
        ]);
      },
      artFor() { return ''; }
    };
  })();

  /* ---------------------------------------------------------------------------
   * Launcher settings (kept in localStorage)
   * ------------------------------------------------------------------------- */
  const SCALES = [80, 85, 90, 95, 100, 105, 110];
  const MARGINS = [0, 2, 3, 4, 5];
  const defaults = { clock24: false, scale: 100, margin: 0, favs: null, glass: true, saver: true };
  let S = Object.assign({}, defaults);
  try { Object.assign(S, JSON.parse(localStorage.getItem('glass.settings') || '{}')); } catch (e) { /* first run */ }
  const save = () => { try { localStorage.setItem('glass.settings', JSON.stringify(S)); } catch (e) { /* ignore */ } };

  /* Scale the 1920x1080 stage to whatever size the WebView reports. */
  function fit() {
    const de = document.documentElement;
    const vw = Math.max(innerWidth || 0, de.clientWidth || 0);
    const vh = Math.max(innerHeight || 0, de.clientHeight || 0);
    if (vw < 100 || vh < 100) return; // WebView not laid out yet; a later trigger retries
    const m = 1 - 2 * (S.margin || 0) / 100; // overscan: shrink to the safe area
    const s = Math.min(vw / 1920, vh / 1080) * m * (S.scale || 100) / 100;
    stage.style.transform = 'scale(' + s + ')';
    stage.style.left = (vw - 1920 * s) / 2 + 'px';
    stage.style.top = (vh - 1080 * s) / 2 + 'px';
  }
  addEventListener('resize', () => fit());
  addEventListener('orientationchange', () => setTimeout(fit, 100));
  addEventListener('load', () => fit());
  if (window.ResizeObserver) new ResizeObserver(() => fit()).observe(document.documentElement);
  // Some TV WebViews report the final size late; re-check a few times after launch.
  [150, 600, 1500, 3000].forEach((ms) => setTimeout(fit, ms));
  fit();

  function applySettings() {
    $('#app-version').textContent = 'v' + (Native.version ? Native.version() : '1.5');
    $('#scale-val').textContent = S.scale + '%';
    $('#margin-val').textContent = S.margin ? S.margin + '%' : 'Off';
    document.body.classList.toggle('flat', !S.glass);
    $$('[data-action="toggle"]').forEach((b) => b.setAttribute('aria-pressed', String(!!S[b.dataset.key])));
    if (Native.setScreenSaverEnabled) Native.setScreenSaverEnabled(!!S.saver);
    if (!S.saver) hideSaver();
    fit();
    tick();
    renderWeather();
  }

  /* ---------------------------------------------------------------------------
   * Clock + greeting
   * ------------------------------------------------------------------------- */
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function tick() {
    const d = new Date();
    const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !S.clock24 }).toLowerCase();
    const h = d.getHours();
    $('#clock-time').textContent = t;
    $('#clock-date').textContent = WEEKDAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
    const greeting = h < 5 ? 'Good Night' : h < 12 ? 'Good Morning' : h < 18 ? 'Good Afternoon' : 'Good Evening';
    $('#greeting').textContent = greeting.replace(' ', '\n');
    const timeOfDay = h < 5 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night';
    const heroCard = $('#hero-card');
    if (heroCard) heroCard.className = 'hero ' + timeOfDay;
    $$('[data-clock]').forEach((e) => { e.textContent = t; });
  }
  setInterval(tick, 20000);

  /* ---------------------------------------------------------------------------
   * Weather: the current hour and the next two hours, under the now-playing
   * cards. The native side finds the position (IP lookup), fetches Open-Meteo
   * and calls window.onWeather(json). config.js can override the position/units.
   * ------------------------------------------------------------------------- */
  const WX_REFRESH_MS = 15 * 60 * 1000;
  const pad2 = (n) => (n < 10 ? '0' : '') + n;
  let wx = null;
  let wxAt = 0;
  let wxTimer;

  const WX_ICON = {
    clear: '<circle cx="12" cy="12" r="4.1"/><path d="M12 2.4v2.1M12 19.5v2.1M4.5 12H2.4M21.6 12h-2.1M6.9 6.9 5.4 5.4M18.6 18.6l-1.5-1.5M17.1 6.9l1.5-1.5M5.4 18.6l1.5-1.5"/>',
    partly: '<circle cx="8.6" cy="8.3" r="3"/><path d="M8.6 2.6v1.5M2.7 8.3h1.5M4.4 4.1l1.1 1.1M12.8 4.1l-1.1 1.1"/><path d="M9.2 19.4h7.9a3.4 3.4 0 0 0 .4-6.7 4.6 4.6 0 0 0-8.9 1.2 2.9 2.9 0 0 0 .6 5.5z"/>',
    cloudy: '<path d="M7.4 18.5h9.2a3.7 3.7 0 0 0 .4-7.4 5.1 5.1 0 0 0-9.8 1.3 3.1 3.1 0 0 0 .2 6.1z"/>',
    fog: '<path d="M4 9.5h10M7.5 13h13M4 16.5h11M9 20h8"/>',
    drizzle: '<path d="M7.4 15.5h9.2a3.7 3.7 0 0 0 .4-7.4 5.1 5.1 0 0 0-9.8 1.3 3.1 3.1 0 0 0 .2 6.1z"/><path d="M9 18.3l-.6 1.9M14 18.3l-.6 1.9"/>',
    rain: '<path d="M7.4 15.5h9.2a3.7 3.7 0 0 0 .4-7.4 5.1 5.1 0 0 0-9.8 1.3 3.1 3.1 0 0 0 .2 6.1z"/><path d="M8 18l-.8 3M12.5 18l-.8 3M17 18l-.8 3"/>',
    snow: '<path d="M7.4 15.5h9.2a3.7 3.7 0 0 0 .4-7.4 5.1 5.1 0 0 0-9.8 1.3 3.1 3.1 0 0 0 .2 6.1z"/><circle cx="8" cy="19.3" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="21" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="19.3" r="1" fill="currentColor" stroke="none"/>',
    storm: '<path d="M7.4 14.5h9.2a3.7 3.7 0 0 0 .4-7.4 5.1 5.1 0 0 0-9.8 1.3 3.1 3.1 0 0 0 .2 6.1z"/><path d="M12.6 16.6 10 20h3l-1.5 3"/>'
  };
  const WX_TEXT = {
    clear: 'Clear', partly: 'Partly cloudy', cloudy: 'Cloudy', fog: 'Fog',
    drizzle: 'Drizzle', rain: 'Rain', snow: 'Snow', storm: 'Thunderstorm'
  };

  // WMO weather codes used by Open-Meteo: https://open-meteo.com/en/docs
  function wxKind(code) {
    if (code === 0) return 'clear';
    if (code <= 2) return 'partly';
    if (code === 3) return 'cloudy';
    if (code === 45 || code === 48) return 'fog';
    if (code >= 51 && code <= 57) return 'drizzle';
    if (code >= 61 && code <= 67) return 'rain';
    if (code >= 71 && code <= 77) return 'snow';
    if (code >= 80 && code <= 82) return 'rain';
    if (code === 85 || code === 86) return 'snow';
    if (code >= 95) return 'storm';
    return 'cloudy';
  }

  function wxSvg(code, size) {
    const s = size || 30;
    return '<svg aria-hidden="true" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      WX_ICON[wxKind(code)] + '</svg>';
  }

  function wxHourLabel(timeStr) {
    const h = parseInt(String(timeStr).slice(11, 13), 10);
    if (isNaN(h)) return '';
    if (S.clock24) return pad2(h) + ':00';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + (h < 12 ? ' AM' : ' PM');
  }

  // The current hour, using the weather service's clock, plus a temperature/condition
  // snapshot for the big card and the screen saver.
  function currentWeather() {
    if (!wx || !wx.hourly || !Array.isArray(wx.hourly.time) ||
      !Array.isArray(wx.hourly.temperature_2m)) return null;
    const times = wx.hourly.time;
    const temps = wx.hourly.temperature_2m;
    const codes = Array.isArray(wx.hourly.weather_code) ? wx.hourly.weather_code : [];

    let key;
    if (wx.current && typeof wx.current.time === 'string' && wx.current.time.length >= 13) {
      key = wx.current.time.slice(0, 13) + ':00';
    } else {
      const d = new Date();
      key = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
        'T' + pad2(d.getHours()) + ':00';
    }
    let idx = times.indexOf(key);
    if (idx < 0) {
      // ISO timestamps sort lexicographically; fall back to the last hour at or before now.
      for (let i = 0; i < times.length; i++) if (times[i] <= key) idx = i;
    }
    if (idx < 0) idx = 0;

    let temp = temps[idx];
    let code = codes[idx];
    if (wx.current) {
      if (typeof wx.current.temperature_2m === 'number') temp = wx.current.temperature_2m;
      if (typeof wx.current.weather_code === 'number') code = wx.current.weather_code;
    }
    if (typeof temp !== 'number') return null;
    if (typeof code !== 'number') code = 3;
    return {
      idx,
      temp,
      code,
      desc: WX_TEXT[wxKind(code)],
      place: wx.place || 'Nearby',
      unit: wx.units === 'f' ? '°F' : '°C'
    };
  }

  function renderWeather() {
    const box = $('#weather');
    if (!box) return;
    const now = currentWeather();
    if (!now) { box.hidden = true; return; }
    const times = wx.hourly.time;
    const temps = wx.hourly.temperature_2m;
    const codes = Array.isArray(wx.hourly.weather_code) ? wx.hourly.weather_code : [];

    $('#wx-current-icon').innerHTML = wxSvg(now.code, 78);
    $('#wx-current-temp').textContent = Math.round(now.temp) + '°';
    $('#wx-current-desc').textContent = now.desc;
    $('#wx-place').textContent = now.place;
    $('#wx-unit').textContent = now.unit;

    const order = [now.idx, now.idx + 1, now.idx + 2]
      .filter((i) => i >= 0 && i < times.length && typeof temps[i] === 'number');
    $('#wx-hours').innerHTML = order.map((i) => {
      const isNow = i === now.idx;
      const temp = Math.round(temps[i]);
      const code = typeof codes[i] === 'number' ? codes[i] : 3;
      const hour = wxHourLabel(times[i]);
      const label = WX_TEXT[wxKind(code)];
      return '<div class="wx-hour' + (isNow ? ' now' : '') + '" role="group" ' +
        'aria-label="' + hour + ', ' + label + ', ' + temp + now.unit + '">' +
        '<b>' + hour + '</b>' +
        '<span class="wx-hi">' + wxSvg(code, 30) + '</span>' +
        '<span class="wx-ht">' + temp + '°</span></div>';
    }).join('');

    box.classList.toggle('stale', !!wx.stale);
    box.hidden = false;
  }

  function loadWeather() {
    clearTimeout(wxTimer);
    if (!Native.requestWeather) return;
    const w = C.weather || {};
    try {
      Native.requestWeather(
        w.lat == null ? '' : String(w.lat),
        w.lon == null ? '' : String(w.lon),
        w.place == null ? '' : String(w.place),
        String(w.units || 'c')
      );
    } catch (e) { /* preview or an older bridge */ }
    wxTimer = setTimeout(loadWeather, WX_REFRESH_MS);
  }

  window.onWeather = (json) => {
    try { wx = JSON.parse(json); } catch (e) { wx = null; }
    wxAt = Date.now();
    renderWeather();
    clearTimeout(wxTimer);
    wxTimer = setTimeout(loadWeather, WX_REFRESH_MS);
  };
  window.onWeatherError = () => {
    // Keep the last good forecast on screen, and retry soon instead of at the normal interval.
    clearTimeout(wxTimer);
    wxTimer = setTimeout(loadWeather, 2 * 60 * 1000);
  };

  /* ---------------------------------------------------------------------------
   * Ambient screen saver: a slow, burn-in friendly clock/weather screen shown when
   * IdleController reports that nothing is playing and nobody touched the remote.
   * ------------------------------------------------------------------------- */
  let saverVisible = false;
  let saverDismissedAt = 0;
  let saverTimer;

  function updateSaver() {
    const d = new Date();
    $('#saver-time').textContent =
      d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !S.clock24 }).toLowerCase();
    $('#saver-date').textContent =
      d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    const now = currentWeather();
    const box = $('#saver-weather');
    if (now) {
      box.hidden = false;
      $('#saver-wx-icon').innerHTML = wxSvg(now.code, 52);
      $('#saver-wx-temp').textContent = Math.round(now.temp) + '°';
      $('#saver-wx-desc').textContent = now.desc + ' · ' + now.place;
    } else {
      box.hidden = true;
    }
  }

  function showSaver() {
    if (saverVisible || !S.saver) return;
    saverVisible = true;
    updateSaver();
    $('#saver').hidden = false;
    clearInterval(saverTimer);
    saverTimer = setInterval(updateSaver, 1000);
  }

  function hideSaver() {
    if (!saverVisible) return;
    saverVisible = false;
    saverDismissedAt = Date.now();
    $('#saver').hidden = true;
    clearInterval(saverTimer);
  }

  window.dismissScreensaver = hideSaver;
  window.onIdleChange = (idle) => { if (idle) showSaver(); else hideSaver(); };

  /* ---------------------------------------------------------------------------
   * Toast
   * ------------------------------------------------------------------------- */
  let toastTimer;
  function showToast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  /* ---------------------------------------------------------------------------
   * Screens + focus
   * ------------------------------------------------------------------------- */
  let screen = 'home';
  const lastFocus = {};
  const visible = (e) => e.getClientRects().length > 0;

  function focusEl(el) {
    if (!el) return;
    el.focus({ preventScroll: true });
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* old WebView */ }
    const st = document.getElementById('stage'); if (st) { st.scrollLeft = 0; st.scrollTop = 0; }
  }

  function show(name) {
    lastFocus[screen] = document.activeElement;
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === name));
    screen = name;
    const scope = $('#' + name);
    const prev = lastFocus[name];
    const def = $('[data-default]', scope);
    const target = prev && prev.isConnected && visible(prev) && scope.contains(prev)
      ? prev
      : (def && visible(def) ? def : $$('[data-f]', scope).find(visible));
    focusEl(target);
    if (name === 'settings') refreshAccess();
  }

  /* ---------------------------------------------------------------------------
   * App options sheet (open / uninstall-or-disable / app info)
   * ------------------------------------------------------------------------- */
  // Never offered for removal on the Pre-installed screen: removing these can break the TV.
  const PROTECTED = [
    'android', 'com.android.settings', 'com.android.systemui', 'com.android.vending',
    'com.android.packageinstaller', 'com.google.android.packageinstaller',
    'com.google.android.permissioncontroller', 'com.google.android.gms', 'com.google.android.gsf',
    'com.google.android.tvlauncher', 'com.google.android.tvrecommendations',
    'com.google.android.leanbacklauncher', 'com.google.android.katniss',
    'com.google.android.inputmethod.latin', 'com.android.providers.', 'com.android.inputmethod.',
    'com.tcl.tv', 'com.tcl.systemserver', 'com.tcl.tvinput', 'com.tcl.providers.config'
  ];
  const isProtected = (pkg) => PROTECTED.some((p) => pkg === p || (p.endsWith('.') && pkg.startsWith(p)));

  let sheetPkg = null;
  let sheetReturn = null;
  let sheetOpenedAt = 0;
  const sheetOpen = () => !$('#sheet').hidden;

  function openSheet(pkg) {
    const app = APPS.find((a) => a.pkg === pkg);
    if (!app) return;
    sheetPkg = pkg;
    sheetReturn = document.activeElement;
    sheetOpenedAt = Date.now();
    const holder = $('#sheet-icon');
    holder.innerHTML = '';
    if (app.icon) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = 'data:image/png;base64,' + app.icon;
      holder.appendChild(img);
      holder.className = '';
    } else {
      holder.className = 'ph';
      holder.textContent = (app.label || '?').charAt(0).toUpperCase();
    }
    $('#sheet-name').textContent = app.label;
    $('#sheet-kind').textContent = app.system ? 'Pre-installed app' : 'Installed app';
    const favs = favList();
    const idx = favs.indexOf(pkg);
    $('#sheet-fav').textContent = idx >= 0 ? 'Remove from favorites' : 'Add to favorites';
    // Reordering only makes sense for an app that is on the home row.
    $('#sheet-ml').hidden = idx <= 0;
    $('#sheet-mr').hidden = idx < 0 || idx >= favs.length - 1;
    $('#sheet-remove').textContent = app.system ? 'Disable / remove' : 'Uninstall';
    $('#sheet-note').textContent = !app.system ? ''
      : isProtected(pkg)
        ? 'Core system app. Disabling it can break your TV.'
        : 'Android only lets you disable pre-installed apps. To remove one fully, run on a PC: adb shell pm uninstall -k --user 0 ' + pkg;
    $('#sheet').hidden = false;
    focusEl($('[data-f]', $('#sheet')));
  }

  function closeSheet() {
    $('#sheet').hidden = true;
    sheetPkg = null;
    if (sheetReturn && sheetReturn.isConnected && visible(sheetReturn)) focusEl(sheetReturn);
    sheetReturn = null;
  }

  function menuForFocused() {
    if (saverVisible) { hideSaver(); return true; }
    const el = document.activeElement;
    if (!el || !el.dataset || !el.dataset.pkg || sheetOpen()) return false;
    openSheet(el.dataset.pkg);
    return true;
  }
  window.onMenu = menuForFocused;

  const qsetOpen = () => !$('#qset').hidden;

  // Notifications shown in the quick settings sidebar (needs Notification access).
  function renderNotifs() {
    const box = $('#qset-notifs');
    let list = [];
    try { list = JSON.parse(Native.notifications ? Native.notifications() : '[]'); } catch (e) { list = []; }
    box.textContent = '';
    $('#qset-clear').hidden = !list.length;
    if (!list.length) {
      const e = document.createElement('div');
      e.className = 'qset-empty';
      let access = false;
      try { access = Native.hasNotificationAccess(); } catch (x) { /* preview */ }
      e.textContent = access ? 'You are all caught up' : 'Allow Now playing access in Settings to see notifications here';
      box.appendChild(e);
      return;
    }
    list.forEach((n) => {
      const b = document.createElement('button');
      b.className = 'qset-n';
      b.setAttribute('data-f', '');
      b.dataset.action = 'qsetNotif';
      b.dataset.key = n.key;
      b.dataset.pkg = n.pkg;
      const ic = document.createElement('span');
      ic.className = 'ni';
      if (n.icon) ic.style.backgroundImage = 'url("data:image/png;base64,' + n.icon + '")';
      else ic.textContent = (n.app || '?').charAt(0);
      const t = document.createElement('span');
      t.className = 'nt';
      const sm = document.createElement('small'); sm.textContent = n.app;
      const ti = document.createElement('b'); ti.textContent = n.title || n.app;
      t.append(sm, ti);
      if (n.text) { const tx = document.createElement('span'); tx.textContent = n.text; t.appendChild(tx); }
      b.append(ic, t);
      box.appendChild(b);
    });
  }

  function openQset() {
    if (saverVisible) { hideSaver(); return; }
    if (sheetOpen()) closeSheet();
    const el = $('#qset');
    if (!el.hidden) return;
    const d = new Date();
    $('#qset-time').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !S.clock24 }).toLowerCase();
    $('#qset-date').textContent = WEEKDAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
    renderNotifs();
    el.hidden = false;
    focusEl($('.qset-tile', el));
  }
  window.openQset = openQset;
  const OVERLAY = location.hash === '#qset';
  function closeQset() {
    $('#qset').hidden = true;
    if (OVERLAY) { try { Native.closeSidebar(); } catch (e) { /* preview */ } }
  }
  window.toggleQset = () => { if (qsetOpen()) closeQset(); else openQset(); };
  // Targets other activities ask the launcher to show (sidebar tiles pressed over another app).
  window.openTarget = (t) => { if (t === 'saver') showSaver(); else if (t) { closeQset(); show(t); } };

  window.onMenu = () => {
    if (saverVisible) { hideSaver(); return true; }
    if (qsetOpen()) { closeQset(); return true; }
    openQset();
    return true;
  };

  function onBack() {
    if (saverVisible) { hideSaver(); return; }
    if (qsetOpen()) { closeQset(); return; }
    if (sheetOpen()) { closeSheet(); return; }
    if (screen !== 'home') show('home');
  }
  window.onBack = onBack;
  window.goHome = () => { if (saverVisible) { hideSaver(); return; } if (qsetOpen()) { closeQset(); return; } show('home'); };
  window.onVoiceSearch = () => {
    if (saverVisible) { hideSaver(); return; }
    Native.openVoiceSearch();
  };

  // The hero's primary action: open whatever medium was most recently active.
  function continueWatching() {
    for (const m of MEDIA_BRANDS) {
      const ses = brandSession(m);
      if (ses) { Native.launch(ses.pkg); return; }
    }
    for (const m of MEDIA_BRANDS) {
      if (!last[m.key]) continue;
      const pkg = brandInstalled(m) || (m.pkgs && m.pkgs[0]) || '';
      if (pkg) { Native.launch(pkg); return; }
    }
    showToast('Nothing to continue yet');
  }

  /* Spatial D-pad navigation: move to the nearest focusable element in the pressed direction. */
  function move(dir) {
    const scope = qsetOpen() ? $('#qset') : (sheetOpen() ? $('#sheet') : $('.screen.active'));
    const cur = document.activeElement && document.activeElement.matches('[data-f]') ? document.activeElement : null;
    const els = $$('[data-f]', scope).filter(visible);
    if (!cur) { focusEl(els[0]); return; }
    const a = cur.getBoundingClientRect();
    const ac = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
    let best = null;
    let bestScore = Infinity;
    for (const el of els) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      const bc = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      const dx = bc.x - ac.x;
      const dy = bc.y - ac.y;
      let primary;
      let secondary;
      if (dir === 'right') { if (dx <= 4) continue; primary = dx; secondary = Math.abs(dy); }
      else if (dir === 'left') { if (dx >= -4) continue; primary = -dx; secondary = Math.abs(dy); }
      else if (dir === 'down') { if (dy <= 4) continue; primary = dy; secondary = Math.abs(dx); }
      else { if (dy >= -4) continue; primary = -dy; secondary = Math.abs(dx); }
      const score = primary + secondary * 2.5;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) focusEl(best);
  }

  let userMoved = false;
  addEventListener('keydown', (e) => {
    // A key that wakes the ambient saver must not also move focus underneath it.
    if (saverVisible || Date.now() - saverDismissedAt < 400) {
      e.preventDefault();
      e.stopPropagation();
      if (saverVisible) hideSaver();
      return;
    }
    userMoved = true;
    const map ={ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (map[e.key]) { e.preventDefault(); move(map[e.key]); }
    else if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack') { e.preventDefault(); onBack(); }
    else if (e.key === 'ContextMenu' || e.key === 'F2') { e.preventDefault(); menuForFocused(); }
    else if (e.key === 'Enter' && e.repeat) {
      // Holding OK on an app opens its options (key auto-repeat only starts after a hold).
      const el = document.activeElement;
      if (el && el.dataset && el.dataset.pkg && !sheetOpen()) { e.preventDefault(); menuForFocused(); }
    }
  });

  /* ---------------------------------------------------------------------------
   * Actions (every focusable carries data-action)
   * ------------------------------------------------------------------------- */
  const cycle = (list, cur) => list[(list.indexOf(cur) + 1) % list.length];

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    // The key-up that ends a long press must not also trigger the button that now has focus.
    if (Date.now() - sheetOpenedAt < 600) return;
    const d = b.dataset;
    if (OVERLAY && d.action === 'screen') { Native.openHearth(d.to); return; }
    if (OVERLAY && d.action === 'qsetSaver') { Native.openHearth('saver'); return; }
    switch (d.action) {
      case 'manage': openSheet(d.pkg); break;
      case 'fav': {
        // Re-rendering rebuilds the grid, so remember the app and put focus back on it.
        const p = d.pkg;
        toggleFav(p);
        focusEl($$('[data-pkg="' + p + '"]', $('#favs-grid'))[0]);
        break;
      }
      case 'favReset': S.favs = null; save(); renderApps(); showToast('Favorites reset'); break;
      case 'sheetFav': { const p = sheetPkg; closeSheet(); if (p) toggleFav(p); break; }
      case 'sheetMoveL':
      case 'sheetMoveR': {
        const p = sheetPkg;
        moveFav(p, d.action === 'sheetMoveL' ? -1 : 1);
        closeSheet();
        focusEl($$('[data-pkg="' + p + '"]', $('#apps-row'))[0]);
        break;
      }
      case 'sheetClose': closeSheet(); break;
      case 'sheetOpen': { const p = sheetPkg; closeSheet(); if (p) Native.launch(p); break; }
      case 'sheetInfo': if (sheetPkg) Native.appInfo(sheetPkg); break;
      case 'sheetRemove': if (sheetPkg) Native.uninstall(sheetPkg); break;
      case 'screen': show(d.to); break;
      case 'back': show('home'); break;
      case 'continue': continueWatching(); break;
      case 'launch': Native.launch(d.pkg); break;
      case 'voiceSearch': Native.openVoiceSearch(); break;
      case 'qsetClear': try { Native.clearNotifications(); } catch (x) { /* preview */ } renderNotifs(); focusEl($('.qset-tile', $('#qset'))); break;
      case 'qsetNotif': {
        const k = d.key, p = d.pkg;
        try { Native.dismissNotification(k); } catch (x) { /* preview */ }
        closeQset();
        if (p) Native.launch(p);
        break;
      }
      case 'qsetSaver':
        closeQset();
        showSaver();
        break;
      case 'qsetSystem':
        closeQset();
        Native.openSystem(d.kind);
        break;
      case 'system': Native.openSystem(d.kind); break;
      case 'access': Native.openNotificationAccess(); break;
      case 'scale': S.scale = cycle(SCALES, S.scale); save(); applySettings(); break;
      case 'margin': S.margin = cycle(MARGINS, S.margin); save(); applySettings(); break;
      case 'toggle': S[d.key] = !S[d.key]; save(); applySettings(); break;
      default: break;
    }
  });

  /* ---------------------------------------------------------------------------
   * Apps
   * ------------------------------------------------------------------------- */
  let APPS = [];

  function appTile(a, action) {
    const b = document.createElement('button');
    b.className = 'tile glass';
    b.setAttribute('data-f', '');
    b.dataset.action = action || 'launch';
    b.dataset.pkg = a.pkg;
    b.dataset.label = a.label;

    let icon;
    if (a.icon) {
      icon = document.createElement('img');
      icon.alt = '';
      icon.src = 'data:image/png;base64,' + a.icon;
    } else {
      icon = document.createElement('div');
      icon.className = 'ph';
      icon.textContent = (a.label || '?').charAt(0).toUpperCase();
    }
    const label = document.createElement('span');
    label.textContent = a.label;
    b.append(icon, label);
    return b;
  }

  function allAppsTile() {
    const b = document.createElement('button');
    b.className = 'tile glass';
    b.setAttribute('data-f', '');
    b.dataset.action = 'screen';
    b.dataset.to = 'apps';
    b.innerHTML = '<svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="6" height="6" rx="1.5"></rect><rect x="14" y="4" width="6" height="6" rx="1.5"></rect><rect x="4" y="14" width="6" height="6" rx="1.5"></rect><rect x="14" y="14" width="6" height="6" rx="1.5"></rect></svg><span>All apps</span>';
    return b;
  }

  /* Favorites: the user's own list (S.favs) once they edit it, else config.js pinned apps first. */
  const MAX_FAVS = 10;
  function defaultFavs() {
    const byLabel = APPS.slice().sort((x, y) => x.label.localeCompare(y.label));
    const pinned = (C.pinned || []).map((p) => APPS.find((a) => a.pkg === p)).filter(Boolean);
    return pinned.concat(byLabel.filter((a) => !pinned.includes(a))).slice(0, C.homeRowCount || 5).map((a) => a.pkg);
  }
  // Installed apps only: an uninstalled favorite quietly drops out (and returns if reinstalled).
  const favList = () => (S.favs || defaultFavs()).filter((p) => APPS.some((a) => a.pkg === p));
  const isFav = (pkg) => favList().includes(pkg);

  function setFavs(list) {
    S.favs = list;
    save();
    renderApps();
  }
  function toggleFav(pkg) {
    const cur = favList();
    if (cur.includes(pkg)) return setFavs(cur.filter((p) => p !== pkg));
    if (cur.length >= MAX_FAVS) { showToast('Up to ' + MAX_FAVS + ' favorites. Remove one first.'); return; }
    setFavs(cur.concat(pkg));
  }
  function moveFav(pkg, dir) {
    const cur = favList();
    const i = cur.indexOf(pkg);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cur.length) return;
    [cur[i], cur[j]] = [cur[j], cur[i]];
    setFavs(cur);
  }

  function renderApps() {
    const keepPkg = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.pkg : null;
    const byLabel = APPS.slice().sort((x, y) => x.label.localeCompare(y.label));
    const favs = favList();
    const home = favs.map((p) => APPS.find((a) => a.pkg === p));

    const fg = $('#favs-grid');
    fg.innerHTML = '';
    byLabel.forEach((a) => {
      const t = appTile(a, 'fav');
      t.classList.toggle('fav', favs.includes(a.pkg));
      fg.appendChild(t);
    });
    $('#favs-hint').textContent = favs.length + ' of ' + MAX_FAVS + ' · OK adds or removes an app';

    const row = $('#apps-row');
    row.innerHTML = '';
    home.forEach((a) => {
      const tile = appTile(a);
      row.appendChild(tile);
    });
    row.appendChild(allAppsTile());

    const grid = $('#apps-grid');
    grid.innerHTML = '';
    byLabel.forEach((a) => grid.appendChild(appTile(a)));

    const bloat = $('#bloat-grid');
    bloat.innerHTML = '';
    byLabel.filter((a) => a.system && !isProtected(a.pkg)).forEach((a) => bloat.appendChild(appTile(a, 'manage')));
    if (!bloat.children.length) {
      const none = document.createElement('span');
      none.className = 'sd';
      none.textContent = 'No removable pre-installed apps found.';
      bloat.appendChild(none);
    }

    // Rebuilding the lists drops focus; put it back on the same app if possible.
    // Until the user presses a key, start on the first favorite app instead of the header.
    const idle = !userMoved && screen === 'home' && !sheetOpen();
    if (idle) {
      focusEl($('[data-default]', $('#home')));
    } else if (!document.activeElement || !document.activeElement.isConnected || document.activeElement === document.body) {
      const scope = $('.screen.active');
      const same = keepPkg && $$('[data-pkg="' + keepPkg + '"]', scope).find(visible);
      focusEl(same || $('[data-default]', scope) || $$('[data-f]', scope).find(visible));
    }
  }
  window.onApps = (json) => {
    try { APPS = JSON.parse(json); } catch (e) { APPS = []; }
    renderApps();
    renderMedia();
  };

  /* ---------------------------------------------------------------------------
   * Media cards: one row showing what is playing in Spotify, Netflix and YouTube.
   * Android only exposes the item that is currently playing or paused in an app,
   * so a card shows "Nothing playing" until something has been started there.
   * ------------------------------------------------------------------------- */
  const MEDIA_BRANDS = [
    { key: 'spotify', name: 'Spotify', pkgs: ['com.spotify.tv.android', 'com.spotify.music'] },
    { key: 'netflix', name: 'Netflix', pkgs: ['com.netflix.ninja', 'com.netflix.mediaclient'] },
    { key: 'youtube', name: 'YouTube', pkgs: ['com.google.android.youtube.tv', 'com.google.android.youtube'] }
  ];
  let sessions = [];
  const artCache = {};
  const mediaCards = {};
  const lower = (v) => String(v || '').toLowerCase();

  // Prefer the exact TV package, then fall back to any package/label containing the brand
  // name (for sideloaded builds with a different package id).
  function brandApp(m) {
    for (const p of (m.pkgs || [])) {
      const a = APPS.find((x) => x.pkg === p);
      if (a) return a;
    }
    return APPS.find((a) => lower(a.pkg + ' ' + a.label).includes(m.key)) || null;
  }

  function brandSession(m) {
    for (const p of (m.pkgs || [])) {
      const s = sessions.find((x) => x.pkg === p);
      if (s) return s;
    }
    return sessions.find((s) => lower(s.pkg).includes(m.key)) || null;
  }

  // Cached package checks, so the three cards can say "not installed" even on a TV whose
  // launcher does not expose that app icon.
  const installCache = {};
  function brandInstalled(m) {
    for (const p of (m.pkgs || [])) {
      if (installCache[p] === undefined) {
        try { installCache[p] = !!Native.isInstalled(p); } catch (e) { installCache[p] = false; }
      }
      if (installCache[p]) return p;
    }
    return '';
  }

  // The last track/video seen in each app. Android only exposes what is currently active, so the
  // launcher remembers it and keeps showing it after the app's media session has gone away.
  let last = {};
  try { last = JSON.parse(localStorage.getItem('glass.last') || '{}') || {}; } catch (e) { last = {}; }
  const saveLast = () => { try { localStorage.setItem('glass.last', JSON.stringify(last)); } catch (e) { /* storage full or blocked */ } };

  // One-time clean-up: the YouTube card used to be fed by a third-party YouTube client that is no longer
  // supported, so forget what it recorded and start again from the official app.
  try {
    if (!localStorage.getItem('hearth.migrated')) {
      delete last.youtube; saveLast();
      localStorage.setItem('hearth.migrated', '1');
    }
  } catch (e) { /* storage unavailable */ }

  // Netflix puts no title in its media session, so ask the TV's Watch Next provider what it last
  // played (only present where the TV publishes one). Cached to keep the 4 s poll cheap.
  let wnCache = { at: 0, v: null };
  function netflixWatchNext(pkg) {
    if (Date.now() - wnCache.at < 60000) return wnCache.v;
    wnCache.at = Date.now();
    try { const r = Native.watchNext ? Native.watchNext(pkg) : ''; wnCache.v = r ? JSON.parse(r) : null; } catch (e) { wnCache.v = null; }
    return wnCache.v;
  }

  function pollSessions() {
    try { sessions = JSON.parse(Native.nowPlayingAll()); } catch (e) { sessions = []; }
    sessions.forEach((s) => {
      if (artCache[s.pkg] && artCache[s.pkg].key === s.artKey) return;
      artCache[s.pkg] = { key: s.artKey, art: Native.artFor(s.pkg) };
    });
    let changed = false;
    MEDIA_BRANDS.forEach((m) => {
      const ses = brandSession(m);
      if (m.key === 'netflix' && !(ses && ses.title)) {
        const wn = netflixWatchNext(m.pkgs[0]);
        if (wn && wn.title) {
          const rec = { title: wn.title, subtitle: wn.subtitle || '', art: wn.art || '', artUrl: wn.artUrl || '', progress: wn.progress || 0 };
          if (JSON.stringify(last.netflix) !== JSON.stringify(rec)) { last.netflix = rec; changed = true; }
          if (ses) return;
        }
      }
      if (!ses) return;
      const prev = last[m.key] || {};
      if (m.key === 'netflix' && !ses.title && prev.title && prev.title !== 'Recently played') { last.netflix = Object.assign({}, prev, { progress: ses.progress || prev.progress || 0 }); return; }
      const art = (artCache[ses.pkg] && artCache[ses.pkg].art) || (prev.title === ses.title ? prev.art : '') || '';
      // Netflix (and a few other players) expose a playback state but no metadata. Remember
      // that something played without pretending to know its name.
      const record = ses.title
        ? { title: ses.title, subtitle: ses.subtitle || '', art, progress: ses.progress || 0 }
        : { title: 'Recently played', subtitle: 'Press OK to open', art, progress: ses.progress || 0 };
      // Progress changes constantly, so only write localStorage when the title/art changes.
      const changedContent = prev.title !== record.title || prev.subtitle !== record.subtitle ||
        prev.art !== record.art;
      last[m.key] = record;
      if (changedContent) changed = true;
    });
    if (changed) saveLast();
    renderMedia();
  }

  function renderMedia() {
    const row = $('#media-row');
    const hasAccess = Native.hasNotificationAccess();
    MEDIA_BRANDS.forEach((m) => {
      let app = brandApp(m);
      const ses = brandSession(m);
      const rec = !ses ? last[m.key] : null;
      const installedPkg = app ? app.pkg : brandInstalled(m);
      const installed = !!app || !!installedPkg;
      let card = mediaCards[m.key];
      // Always keep the three brand cards; a missing app is reported rather than hiding the
      // card, so the row does not jump between one and three cards.
      if (!app) {
        app = { pkg: (ses && ses.pkg) || installedPkg || (m.pkgs && m.pkgs[0]) || '', label: m.name, icon: '' };
      }
      if (!card) {
        card = document.createElement('button');
        card.className = 'mcard glass';
        card.setAttribute('data-f', '');
        card.dataset.action = 'launch';
        card.dataset.brand = m.key;
        card.innerHTML = '<span class="m-top"><span class="m-ico"></span>' +
          '<span class="m-state"><span class="m-eq"><i></i><i></i><i></i></span><b></b></span></span>' +
          '<span class="m-body"><span class="m-title"></span><span class="m-sub"></span></span>' +
          '<span class="m-foot">' +
          '<span class="m-progress"><i></i></span></span>';
        mediaCards[m.key] = card;
      }
      // Keep a stable order: Spotify, Netflix, YouTube.
      const order = MEDIA_BRANDS.map((b) => mediaCards[b.key]).filter(Boolean);
      order.forEach((c, i) => { if (row.children[i] !== c) row.insertBefore(c, row.children[i] || null); });

      card.dataset.pkg = (ses && ses.pkg) || app.pkg;
      card.dataset.label = m.name;
      const ico = $('.m-ico', card);
      const src = app.icon ? 'url("data:image/png;base64,' + app.icon + '")' : '';
      if (ico.style.backgroundImage !== src) ico.style.backgroundImage = src;
      ico.textContent = src ? '' : m.name.charAt(0);
      // Live session wins; otherwise fall back to the last thing played in that app.
      const keep = m.key === 'netflix' && ses && !ses.title ? last.netflix : null; // live Netflix session without a title
      const art = ses ? (artCache[ses.pkg] ? artCache[ses.pkg].art : '') || (keep ? keep.art : '') : (rec ? rec.art : '');
      const artUrl = (rec || keep || {}).artUrl || '';
      const bg = art ? 'url("data:image/jpeg;base64,' + art + '")' : (artUrl ? 'url("' + artUrl + '")' : '');
      if (card.style.backgroundImage !== bg) card.style.backgroundImage = bg;
      const progress = ses ? (typeof ses.progress === 'number' ? ses.progress : 0)
        : (rec && typeof rec.progress === 'number' ? rec.progress : 0);
      $('.m-progress i', card).style.width = Math.round(Math.max(0, Math.min(1, progress)) * 100) + '%';
      card.classList.toggle('idle', !ses && !rec);
      card.classList.toggle('recent', !!rec);
      card.classList.toggle('is-playing', !!ses && ses.state === 'playing');
      $('.m-state', card).hidden = !ses && !rec;
      if (ses) {
        const stateWord = ses.state === 'playing' ? 'Playing' : 'Paused';
        $('.m-state b', card).textContent = stateWord;
        // Netflix publishes no title/art in its media session, so show a useful state rather
        // than a blank card. Other apps still show their real track/video title.
        $('.m-title', card).textContent = ses.title || (keep && keep.title !== 'Recently played' ? keep.title : stateWord + ' on ' + m.name);
        $('.m-sub', card).textContent = ses.subtitle || (ses.title ? '' : (keep && keep.title !== 'Recently played' ? stateWord + ' on ' + m.name : 'Press OK to open'));
      } else if (!installed) {
        $('.m-title', card).textContent = 'Not installed';
        $('.m-sub', card).textContent = 'Install ' + m.name + ' to use this card';
      } else if (rec) {
        $('.m-state b', card).textContent = 'Recent';
        $('.m-title', card).textContent = rec.title;
        $('.m-sub', card).textContent = rec.subtitle || 'Press OK to open';
      } else {
        $('.m-title', card).textContent = hasAccess ? 'Nothing played yet' : 'Not connected';
        $('.m-sub', card).textContent = hasAccess ? 'Press OK to open' : 'Allow Now playing access in Settings';
      }
    });
    row.classList.toggle('empty', !row.children.length);
  }

  let pollTimer;
  function poll() {
    clearTimeout(pollTimer);
    pollSessions();
    pollTimer = setTimeout(poll, 4000);
  }

  function refreshAccess() {
    $('#access-status').textContent = Native.hasNotificationAccess() ? 'On' : 'Off';
  }

  /* ---------------------------------------------------------------------------
   * Lifecycle
   * ------------------------------------------------------------------------- */
  window.onResumeLauncher = () => {
    Native.requestApps();
    poll();
    refreshAccess();
    // Catch up on the weather after the launcher has been in the background for a while.
    if (!wx || Date.now() - wxAt > 10 * 60 * 1000) loadWeather();
  };

  applySettings();
  show('home');
  if (OVERLAY) {
    document.body.classList.add('qset-only');
    openQset();
    return;
  }
  if (location.hash === '#saver') showSaver();
  const idleMinutes = Math.round(Number(C.idleMinutes));
  if (Native.setIdleMinutes) Native.setIdleMinutes(idleMinutes > 0 ? idleMinutes : 15);
  loadWeather();
  Native.requestApps();
  poll();
})();
