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
    return {
      requestApps() { setTimeout(() => window.onApps(JSON.stringify(demo)), 50); },
      launch(p) { toastMock('Would launch ' + p); },
      uninstall(p) { toastMock('Would uninstall ' + p); },
      appInfo(p) { toastMock('Would open app info: ' + p); },
      openVoiceSearch() { toastMock('Would start Voice Search'); },
      openSystem(k) { toastMock('Would open system settings: ' + k); },
      openNotificationAccess() { toastMock('Would open notification access'); },
      hasNotificationAccess() { return true; },
      nowPlayingAll() {
        return JSON.stringify([
          { pkg: 'com.spotify.tv.android', title: 'Blinding Lights', subtitle: 'The Weeknd', state: 'playing', artKey: 'a' },
          { pkg: 'com.google.android.youtube.tv', title: 'Northern Lights 4K', subtitle: 'Nature Channel', state: 'paused', artKey: 'b' }
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
  const defaults = { clock24: false, scale: 100, margin: 0, favs: null, glass: true };
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
    $('#scale-val').textContent = S.scale + '%';
    $('#margin-val').textContent = S.margin ? S.margin + '%' : 'Off';
    document.body.classList.toggle('flat', !S.glass);
    $$('[data-action="toggle"]').forEach((b) => b.setAttribute('aria-pressed', String(!!S[b.dataset.key])));
    fit();
    tick();
  }

  /* ---------------------------------------------------------------------------
   * Clock + greeting
   * ------------------------------------------------------------------------- */
  function tick() {
    const d = new Date();
    const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !S.clock24 });
    const h = d.getHours();
    $('#clock-time').textContent = t;
    $('#clock-date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    $('#greeting').textContent = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
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
   * Screens + focus
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

  let userMoved = false;
  addEventListener('keydown', (e) => {
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
      case 'launch': Native.launch(d.pkg); break;
      case 'voiceSearch': Native.openVoiceSearch(); break;
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
    { key: 'spotify', name: 'Spotify' },
    { key: 'netflix', name: 'Netflix' },
    { key: 'youtube', name: 'YouTube' }
  ];
  let sessions = [];
  const artCache = {};
  const mediaCards = {};

  // The last track/video seen in each app. Android only exposes what is currently active, so the
  // launcher remembers it and keeps showing it after the app's media session has gone away.
  let last = {};
  try { last = JSON.parse(localStorage.getItem('glass.last') || '{}') || {}; } catch (e) { last = {}; }
  const saveLast = () => { try { localStorage.setItem('glass.last', JSON.stringify(last)); } catch (e) { /* storage full or blocked */ } };

  function pollSessions() {
    try { sessions = JSON.parse(Native.nowPlayingAll()); } catch (e) { sessions = []; }
    sessions.forEach((s) => {
      if (artCache[s.pkg] && artCache[s.pkg].key === s.artKey) return;
      artCache[s.pkg] = { key: s.artKey, art: Native.artFor(s.pkg) };
    });
    let changed = false;
    MEDIA_BRANDS.forEach((m) => {
      const ses = sessions.find((s) => s.pkg.toLowerCase().includes(m.key));
      if (!ses || !ses.title) return;
      const prev = last[m.key] || {};
      const art = (artCache[ses.pkg] && artCache[ses.pkg].art) || (prev.title === ses.title ? prev.art : '') || '';
      if (prev.title === ses.title && prev.subtitle === (ses.subtitle || '') && prev.art === art) return;
      last[m.key] = { title: ses.title, subtitle: ses.subtitle || '', art };
      changed = true;
    });
    if (changed) saveLast();
    renderMedia();
  }

  function renderMedia() {
    const row = $('#media-row');
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
        card.innerHTML = '<span class="m-top"><span class="m-ico"></span><span class="m-app"></span>' +
          '<span class="m-state"><span class="m-eq"><i></i><i></i><i></i></span><b></b></span></span>' +
          '<span class="m-body"><span class="m-title"></span><span class="m-sub"></span></span>';
        mediaCards[m.key] = card;
      }
      // Keep a stable order: Spotify, Netflix, YouTube.
      const order = MEDIA_BRANDS.map((b) => mediaCards[b.key]).filter(Boolean);
      order.forEach((c, i) => { if (row.children[i] !== c) row.insertBefore(c, row.children[i] || null); });

      card.dataset.pkg = (ses && ses.pkg) || app.pkg;
      card.dataset.label = m.name;
      const ico = $('.m-ico', card);
      const src = app && app.icon ? 'url("data:image/png;base64,' + app.icon + '")' : '';
      if (ico.style.backgroundImage !== src) ico.style.backgroundImage = src;
      ico.textContent = src ? '' : m.name.charAt(0);
      $('.m-app', card).textContent = m.name;
      // Live session wins; otherwise fall back to the last thing played in that app.
      const rec = !ses ? last[m.key] : null;
      const art = ses ? (artCache[ses.pkg] ? artCache[ses.pkg].art : '') : (rec ? rec.art : '');
      const bg = art ? 'url("data:image/jpeg;base64,' + art + '")' : '';
      if (card.style.backgroundImage !== bg) card.style.backgroundImage = bg;
      card.classList.toggle('idle', !ses && !rec);
      card.classList.toggle('recent', !!rec);
      card.classList.toggle('is-playing', !!ses && ses.state === 'playing');
      $('.m-state', card).hidden = !ses && !rec;
      if (ses) {
        $('.m-state b', card).textContent = ses.state === 'playing' ? 'Playing' : 'Paused';
        $('.m-title', card).textContent = ses.title || 'Playing';
        $('.m-sub', card).textContent = ses.subtitle || '';
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
  };

  applySettings();
  show('home');
  Native.requestApps();
  poll();
})();
