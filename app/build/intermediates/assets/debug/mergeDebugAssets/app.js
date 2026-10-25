(() => {
  'use strict';

  const C = window.CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const stage = $('#stage');
  const ACCENTS = ['#8ab4ff', '#7ee0c3', '#ffb3c7', '#ffd37a'];

  const BRAND_INFO = {
    spotify: {
      tag: 'MUSIC & PODCASTS',
      sub: 'Listen to songs, albums, and playlists',
      bg: 'linear-gradient(135deg, #1db954 0%, #0d5c2a 100%)',
      ph: '🎵'
    },
    netflix: {
      tag: 'MOVIES & TV SHOWS',
      sub: 'Stream popular movies, series, and originals',
      bg: 'linear-gradient(135deg, #e50914 0%, #5c0000 100%)',
      ph: '🍿'
    },
    youtube: {
      tag: 'VIDEOS & LIVE STREAMING',
      sub: 'Watch videos, music, streams, and creators',
      bg: 'linear-gradient(135deg, #ff0000 0%, #730000 100%)',
      ph: '▶'
    },
    cricfytv: {
      tag: 'LIVE SPORTS & TV',
      sub: 'Watch live cricket matches and sports channels',
      bg: 'linear-gradient(135deg, #0284c7 0%, #075985 100%)',
      ph: '🏏'
    },
    browser: {
      tag: 'WEB BROWSER',
      sub: 'Surf the web, search, and visit websites',
      bg: 'linear-gradient(135deg, #4f46e5 0%, #312e81 100%)',
      ph: '🌐'
    }
  };

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
    return {
      requestApps() { setTimeout(() => window.onApps(JSON.stringify(demo)), 50); },
      launch(p) { toastMock('Would launch ' + p); },
      uninstall(p) { toastMock('Would uninstall ' + p); },
      appInfo(p) { toastMock('Would open app info: ' + p); },
      openVoiceSearch() { toastMock('Would start Voice Search'); },
      openSystem(k) { toastMock('Would open system settings: ' + k); },
      openNotificationAccess() { toastMock('Would open notification access'); },
      hasNotificationAccess() { return true; },
      nowPlaying() {
        return JSON.stringify({
          access: true, active: true, title: 'Northern Lights', subtitle: 'Documentary',
          pkg: 'com.spotify.tv.android', app: 'Spotify', state: 'playing',
          position: 2538000, duration: 6744000, artKey: 'demo'
        });
      },
      nowPlayingArt() { return ''; },
      nowPlayingAll() {
        return JSON.stringify([
          { pkg: 'com.spotify.tv.android', title: 'Blinding Lights', subtitle: 'The Weeknd', state: 'playing', artKey: 'a' },
          { pkg: 'com.google.android.youtube.tv', title: 'Northern Lights 4K', subtitle: 'Nature Channel', state: 'paused', artKey: 'b' }
        ]);
      },
      artFor() { return ''; },
      mediaControl(c) { toastMock('Media: ' + c); }
    };
  })();

  /* ---------------------------------------------------------------------------
   * Scale the 1920x1080 stage to whatever size the WebView reports.
   * ------------------------------------------------------------------------- */
  const SCALES = [80, 85, 90, 95, 100, 105, 110];
  const MARGINS = [0, 2, 3, 4, 5];
  const defaults = { accent: ACCENTS[0], clock24: false, lite: false, scale: 100, margin: 0 };
  let S = Object.assign({}, defaults);

  function fit() {
    const de = document.documentElement;
    const vw = Math.max(innerWidth || 0, de.clientWidth || 0);
    const vh = Math.max(innerHeight || 0, de.clientHeight || 0);
    if (vw < 100 || vh < 100) return; // WebView not laid out yet; a later trigger retries
    const m = 1 - 2 * ((S && S.margin) || 0) / 100; // overscan: shrink to the safe area
    const s = Math.min(vw / 1920, vh / 1080) * m * ((S && S.scale) || 100) / 100;
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

  /* ---------------------------------------------------------------------------
   * Launcher settings (kept in localStorage)
   * ------------------------------------------------------------------------- */
  try { Object.assign(S, JSON.parse(localStorage.getItem('glass.settings') || '{}')); } catch (e) { /* first run */ }
  const save = () => { try { localStorage.setItem('glass.settings', JSON.stringify(S)); } catch (e) { /* ignore */ } };
  fit();

  function applySettings() {
    $('#scale-val').textContent = S.scale + '%';
    $('#margin-val').textContent = S.margin ? S.margin + '%' : 'Off';
    fit();
    document.documentElement.style.setProperty('--accent', S.accent);
    document.body.classList.toggle('lite', !!S.lite);
    $$('[data-action="toggle"]').forEach((b) => b.setAttribute('aria-pressed', String(!!S[b.dataset.key])));
    $('#accent-dots').innerHTML = '';
    ACCENTS.forEach((c) => {
      const i = document.createElement('i');
      i.style.background = c;
      if (c === S.accent) i.className = 'sel';
      $('#accent-dots').appendChild(i);
    });
    tick();
  }

  /* ---------------------------------------------------------------------------
   * Clock + greeting
   * ------------------------------------------------------------------------- */
  function fmtTime(d) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !S.clock24 });
  }
  function tick() {
    const d = new Date();
    const t = fmtTime(d);
    $('#clock-time').textContent = t;
    $('#clock-date').textContent = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    $$('[data-clock]').forEach((e) => { e.textContent = t; });
  }
  setInterval(tick, 20000);

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
   * Screens + focus & dynamic hero updates
   * ------------------------------------------------------------------------- */
  let screen = 'home';
  const lastFocus = {};
  const visible = (e) => e.getClientRects().length > 0;

  function focusEl(el) {
    if (!el) return;
    el.focus({ preventScroll: true });
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* old WebView */ }
  }

  function show(name) {
    lastFocus[screen] = document.activeElement;
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === name));
    screen = name;
    const scope = $('#' + name);
    const prev = lastFocus[name];
    const target = prev && prev.isConnected && visible(prev) && scope.contains(prev)
      ? prev
      : ($('[data-default]', scope) && visible($('[data-default]', scope)) ? $('[data-default]', scope)
        : $$('[data-f]', scope).find(visible));
    focusEl(target);
    if (name === 'settings') refreshAccess();
    if (name === 'now') pollNow();
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
    'com.google.android.inputmethod.latin', 'com.android.providers.', 'com.android.inputmethod.'
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
    const el = document.activeElement;
    if (!el || !el.dataset || !el.dataset.pkg || sheetOpen()) return false;
    openSheet(el.dataset.pkg);
    return true;
  }
  window.onMenu = menuForFocused;

  function onBack() {
    if (sheetOpen()) { closeSheet(); return; }
    if (screen !== 'home') show('home');
  }
  window.onBack = onBack;
  window.goHome = () => show('home');
  window.onVoiceSearch = () => Native.openVoiceSearch();

  /* Keep the greeting text in step with the focused tile. */
  document.addEventListener('focusin', (e) => {
    const target = e.target;
    if (!target || screen !== 'home' || !target.dataset) return;
    if (target.dataset.action === 'launch') {
      const name = target.dataset.label || 'App';
      const info = BRAND_INFO[target.dataset.brand];
      $('#hero-eyebrow').textContent = 'LAUNCH APP';
      $('#hero-title').textContent = name;
      $('#hero-desc').textContent = info ? info.sub : 'Press OK on remote to open ' + name + '.';
    } else if (target.dataset.action === 'screen' && target.dataset.to === 'apps') {
      $('#hero-eyebrow').textContent = 'ALL APPLICATIONS';
      $('#hero-title').textContent = 'All Apps';
      $('#hero-desc').textContent = 'Browse every installed application on your TV.';
    } else if (!target.closest('.row') && !target.closest('#media-row')) {
      const h = new Date().getHours();
      $('#hero-eyebrow').textContent = h < 12 ? 'GOOD MORNING' : h < 18 ? 'GOOD AFTERNOON' : 'GOOD EVENING';
      $('#hero-title').textContent = 'Welcome home';
      $('#hero-desc').textContent = 'Select an app below to launch immediately.';
    }
  });

  /* Spatial D-pad navigation: move to the nearest focusable element in the pressed direction. */
  function move(dir) {
    const scope = sheetOpen() ? $('#sheet') : $('.screen.active');
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

  addEventListener('keydown', (e) => {
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
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
  let nowPkg = '';
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    // The key-up that ends a long press must not also trigger the button that now has focus.
    if (Date.now() - sheetOpenedAt < 600) return;
    const d = b.dataset;
    switch (d.action) {
      case 'manage': openSheet(d.pkg); break;
      case 'sheetClose': closeSheet(); break;
      case 'sheetOpen': { const p = sheetPkg; closeSheet(); if (p) Native.launch(p); break; }
      case 'sheetInfo': if (sheetPkg) Native.appInfo(sheetPkg); break;
      case 'sheetRemove': if (sheetPkg) Native.uninstall(sheetPkg); break;
      case 'screen': show(d.to); break;
      case 'back': show('home'); break;
      case 'launch': Native.launch(d.pkg); break;
      case 'voiceSearch': Native.openVoiceSearch(); break;
      case 'system': Native.openSystem(d.kind); break;
      case 'access': Native.openNotificationAccess(); break;
      case 'openSource': if (nowPkg) Native.launch(nowPkg); break;
      case 'accent': {
        const i = ACCENTS.indexOf(S.accent);
        S.accent = ACCENTS[(i + 1) % ACCENTS.length];
        save(); applySettings();
        break;
      }
      case 'scale': {
        const i = SCALES.indexOf(S.scale);
        S.scale = SCALES[(i + 1) % SCALES.length];
        save(); applySettings();
        break;
      }
      case 'margin': {
        const i = MARGINS.indexOf(S.margin);
        S.margin = MARGINS[(i + 1) % MARGINS.length];
        save(); applySettings();
        break;
      }
      case 'toggle':
        S[d.key] = !S[d.key];
        save(); applySettings();
        break;
      case 'media':
        Native.mediaControl(d.cmd);
        setTimeout(pollNow, 350);
        break;
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

    const l = (a.label || '').toLowerCase();
    const p = (a.pkg || '').toLowerCase();
    if (l.includes('spotify') || p.includes('spotify')) b.dataset.brand = 'spotify';
    else if (l.includes('netflix') || p.includes('netflix')) b.dataset.brand = 'netflix';
    else if (l.includes('youtube') || p.includes('youtube')) b.dataset.brand = 'youtube';
    else if (l.includes('cricfy') || p.includes('cricfy')) b.dataset.brand = 'cricfytv';
    else if (l.includes('browser') || l.includes('chrome') || p.includes('browser') || p.includes('chrome')) b.dataset.brand = 'browser';

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
    b.dataset.label = 'All Apps';
    b.innerHTML = '<svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="6" height="6" rx="1.5"></rect><rect x="14" y="4" width="6" height="6" rx="1.5"></rect><rect x="4" y="14" width="6" height="6" rx="1.5"></rect><rect x="14" y="14" width="6" height="6" rx="1.5"></rect></svg><span>All apps</span>';
    return b;
  }

  function renderApps() {
    const keepPkg = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.pkg : null;
    const byLabel = APPS.slice().sort((x, y) => x.label.localeCompare(y.label));
    const pinned = (C.pinned || []).map((p) => APPS.find((a) => a.pkg === p)).filter(Boolean);
    const rest = byLabel.filter((a) => !pinned.includes(a));
    const home = pinned.concat(rest).slice(0, C.homeRowCount || 5);

    const row = $('#apps-row');
    row.innerHTML = '';
    home.forEach((a, i) => {
      const tile = appTile(a);
      if (i === 0) tile.setAttribute('data-default', '');
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
    if (!document.activeElement || !document.activeElement.isConnected || document.activeElement === document.body) {
      const scope = $('.screen.active');
      const same = keepPkg && $$('[data-pkg="' + keepPkg + '"]', scope).find(visible);
      focusEl(same || $('[data-default]', scope) || $$('[data-f]', scope).find(visible));
    }
    renderSource();
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
    { key: 'spotify', name: 'Spotify', idle: 'Open Spotify' },
    { key: 'netflix', name: 'Netflix', idle: 'Open Netflix' },
    { key: 'youtube', name: 'YouTube', idle: 'Open YouTube' }
  ];
  let sessions = [];
  const artCache = {};
  const mediaCards = {};

  function pollSessions() {
    try { sessions = JSON.parse(Native.nowPlayingAll()); } catch (e) { sessions = []; }
    sessions.forEach((s) => {
      if (artCache[s.pkg] && artCache[s.pkg].key === s.artKey) return;
      artCache[s.pkg] = { key: s.artKey, art: Native.artFor(s.pkg) };
    });
    renderMedia();
  }

  function renderMedia() {
    const row = $('#media-row');
    if (!row) return;
    const hasAccess = Native.hasNotificationAccess();
    MEDIA_BRANDS.forEach((m) => {
      const app = APPS.find((a) => ((a.pkg || '') + ' ' + (a.label || '')).toLowerCase().includes(m.key));
      const ses = sessions.find((s) => s.pkg.toLowerCase().includes(m.key));
      let card = mediaCards[m.key];
      if (!app && !ses) { if (card) { card.remove(); delete mediaCards[m.key]; } return; }
      if (!card) {
        card = document.createElement('button');
        card.className = 'mcard glass';
        card.setAttribute('data-f', '');
        card.dataset.action = 'launch';
        card.dataset.brand = m.key;
        card.innerHTML = '<img class="m-ico" alt=""><span class="m-state"></span>' +
          '<span class="m-app"></span><span class="m-title"></span><span class="m-sub"></span>';
        mediaCards[m.key] = card;
      }
      // Keep a stable order: Spotify, Netflix, YouTube.
      const order = MEDIA_BRANDS.map((b) => mediaCards[b.key]).filter(Boolean);
      order.forEach((c, i) => { if (row.children[i] !== c) row.insertBefore(c, row.children[i] || null); });

      card.dataset.pkg = (ses && ses.pkg) || app.pkg;
      card.dataset.label = m.name;
      const ico = $('.m-ico', card);
      const src = app && app.icon ? 'data:image/png;base64,' + app.icon : '';
      if (src && ico.getAttribute('src') !== src) ico.src = src;
      ico.hidden = !src;
      $('.m-app', card).textContent = m.name;
      const art = ses && artCache[ses.pkg] ? artCache[ses.pkg].art : '';
      card.style.backgroundImage = art ? 'url("data:image/jpeg;base64,' + art + '")' : '';
      card.classList.toggle('idle', !ses);
      if (ses) {
        $('.m-state', card).textContent = ses.state === 'playing' ? 'Playing' : 'Paused';
        $('.m-title', card).textContent = ses.title || 'Playing';
        $('.m-sub', card).textContent = ses.subtitle || '';
      } else {
        $('.m-state', card).textContent = '';
        $('.m-title', card).textContent = hasAccess ? 'Nothing playing' : m.idle;
        $('.m-sub', card).textContent = hasAccess ? m.idle : 'Allow Now playing access in Settings';
      }
    });
  }

  /* ---------------------------------------------------------------------------
   * Now playing
   * ------------------------------------------------------------------------- */
  let np = { access: false, active: false };
  let npArtKey = null;
  let npTimer;
  const fmt = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + ss : m + ':' + ss;
  };

  function renderSource() {
    const app = APPS.find((a) => a.pkg === nowPkg);
    const holder = $('#source-icon');
    if (app && app.icon) {
      holder.innerHTML = '';
      const img = document.createElement('img');
      img.alt = '';
      img.src = 'data:image/png;base64,' + app.icon;
      holder.replaceWith(img);
      img.id = 'source-icon';
    } else if (holder.tagName !== 'DIV') {
      const d = document.createElement('div');
      d.className = 'ph';
      d.id = 'source-icon';
      holder.replaceWith(d);
    }
    const h2 = $('#source-icon');
    if (h2.tagName === 'DIV') h2.textContent = (np.app || '?').charAt(0).toUpperCase();
  }

  function renderNow() {
    const live = np.access && np.active;
    $('#np-chip').hidden = !live;
    if (live) $('#np-chip-text').textContent = np.title;
    if (screen !== 'now') return;

    $('#now-main').hidden = !live;
    $('#now-empty').hidden = live;
    if (!live) {
      const noAccess = !np.access;
      $('#now-empty-title').textContent = noAccess ? 'Allow now playing access' : 'Nothing is playing';
      $('#now-empty-text').textContent = noAccess
        ? 'Android only shares what is playing with apps you allow. Turn on Notification access for Glass Launcher.'
        : 'Start something in any app and it will show up here.';
      $('#now-empty-btn').hidden = !noAccess;
      return;
    }

    nowPkg = np.pkg;
    $('#now').dataset.state = np.state;
    $('#now-title').textContent = np.title;
    $('#now-sub').textContent = np.subtitle || '';
    $('#source-name').textContent = np.app || np.pkg;
    renderSource();

    const dur = np.duration || 0;
    const pct = dur ? Math.min(100, (np.position / dur) * 100) : 0;
    $('#bar-fill').style.width = pct + '%';
    $('#bar-knob').style.left = pct + '%';
    $('#t-pos').textContent = fmt(np.position);
    $('#t-left').textContent = dur ? '-' + fmt(dur - np.position) : '';

    if (np.artKey !== npArtKey) {
      npArtKey = np.artKey;
      const art = Native.nowPlayingArt();
      $('#now-art').style.backgroundImage = art ? 'url("data:image/jpeg;base64,' + art + '")' : '';
    }
  }

  function pollNow() {
    clearTimeout(npTimer);
    try { np = JSON.parse(Native.nowPlaying()); } catch (e) { np = { access: false, active: false }; }
    renderNow();
    pollSessions();
    if (screen === 'now' && (!document.activeElement || document.activeElement === document.body || !visible(document.activeElement))) {
      focusEl($$('[data-f]', $('#now')).find(visible));
    }
    npTimer = setTimeout(pollNow, screen === 'now' ? 1000 : 4000);
  }

  function refreshAccess() {
    $('#access-status').textContent = Native.hasNotificationAccess() ? 'On' : 'Off';
  }

  /* ---------------------------------------------------------------------------
   * Lifecycle
   * ------------------------------------------------------------------------- */
  window.onResumeLauncher = () => {
    Native.requestApps();
    pollNow();
    refreshAccess();
  };

  applySettings();
  show('home');
  Native.requestApps();
  pollNow();
})();
