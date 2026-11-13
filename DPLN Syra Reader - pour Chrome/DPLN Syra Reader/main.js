// DPLN Syra Reader — process principal Electron
const { app, BrowserWindow, ipcMain, clipboard, screen, shell, globalShortcut, Menu } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Mode test : profil séparé pour ne jamais toucher aux réglages réels
if (process.env.DR_SHOT) app.setPath('userData', path.join(app.getPath('temp'), 'dofus-reader-test'));

const PORT = +process.env.DR_PORT || 47800;
const SITE_RE = /^https?:\/\/(www\.)?dofuspourlesnoobs\.com\//i;
let win = null;
let settings = { pinned: true, bounds: null, lastUrl: null, watchClipboard: true, zaapMode: false, font: 17, showImgs: true, posMap: {}, keys: { next: 'F8', prev: 'F7' } };
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try { Object.assign(settings, JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))); } catch (_) {}
  settings.keys = Object.assign({ next: 'F8', prev: 'F7' }, settings.keys);
}
function saveSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch (_) {}
}

function defaultBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  const width = 430;
  return { x: wa.x + wa.width - width, y: wa.y, width, height: wa.height };
}

function boundsVisible(b) {
  return screen.getAllDisplays().some(d => {
    const a = d.workArea;
    return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
  });
}

function createWindow() {
  const b = settings.bounds && boundsVisible(settings.bounds) ? settings.bounds : defaultBounds();
  win = new BrowserWindow({
    ...b,
    show: false,
    minWidth: 180,
    minHeight: 260,
    title: 'DPLN Syra Reader',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    backgroundColor: '#15171c',
    alwaysOnTop: settings.pinned,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  // Écrans avec des mises à l'échelle différentes : Windows décale la fenêtre
  // créée hors de l'écran principal → on réapplique la position une fois créée.
  win.setBounds(b);
  win.setBounds(b);
  if (settings.pinned) win.setAlwaysOnTop(true, 'screen-saver');
  // Windows « oublie » parfois l'épinglage (jeu en plein écran, autre fenêtre épinglée,
  // réduction, changement d'écran…) : on le réapplique dès que nécessaire.
  const enforcePin = () => {
    if (!settings.pinned || !win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return;
    win.setAlwaysOnTop(true, 'screen-saver');
    if (!win.isFocused() && !(zoomWin && !zoomWin.isDestroyed())) win.moveTop();
  };
  win.on('blur', () => setTimeout(enforcePin, 150));
  win.on('restore', enforcePin);
  win.on('show', enforcePin);
  win.on('always-on-top-changed', (_e, on) => { if (!on && settings.pinned) setTimeout(enforcePin, 50); });
  screen.on('display-metrics-changed', enforcePin);
  const pinTimer = setInterval(enforcePin, 2000);
  win.on('closed', () => clearInterval(pinTimer));
  win.once('ready-to-show', () => {
    win.setBounds(b);
    if (settings.maximized) win.maximize();
    win.show();
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Sauvegarde position/taille à chaque déplacement ou redimensionnement, et à la fermeture
  let persistT;
  const persist = () => {
    if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return;
    settings.maximized = win.isMaximized();
    settings.bounds = win.getNormalBounds();
    saveSettings();
  };
  const persistSoon = () => { clearTimeout(persistT); persistT = setTimeout(persist, 400); };
  win.on('move', persistSoon);
  win.on('resize', persistSoon);
  win.on('maximize', persistSoon);
  win.on('unmaximize', persistSoon);
  win.on('close', persist);

  // Liens externes : navigateur par défaut
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function sendUrl(url, source) {
  if (!win || !SITE_RE.test(url)) return;
  url = url.split('#')[0];
  win.webContents.send('load-url', { url, source });
}

// --- Serveur local : reçoit les URLs dofuspourlesnoobs depuis l'extension navigateur ---
function readBody(req, max, cb) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > max) req.destroy(); });
  req.on('end', () => { try { cb(JSON.parse(body)); } catch (_) { cb(null); } });
}
function startServer() {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (req.method === 'GET' && req.url === '/ping') { res.writeHead(200); return res.end('ok'); }
    if (req.method === 'POST' && req.url === '/open') {
      return readBody(req, 10000, (d) => {
        if (d && typeof d.url === 'string' && SITE_RE.test(d.url)) { sendUrl(d.url, 'extension'); res.writeHead(200); return res.end('ok'); }
        res.writeHead(400); res.end('bad');
      });
    }
    res.writeHead(404); res.end();
  });
  server.on('error', (e) => console.error('Serveur local :', e.message));
  server.listen(PORT, '127.0.0.1');
}

// --- Surveillance du presse-papier (secours sans extension) ---
let lastClip = '';
function watchClipboard() {
  setInterval(() => {
    if (!settings.watchClipboard) return;
    const t = (clipboard.readText() || '').trim();
    if (t !== lastClip) {
      lastClip = t;
      if (SITE_RE.test(t) && !/\s/.test(t)) sendUrl(t, 'clipboard');
    }
  }, 800);
}

// --- IPC ---
ipcMain.handle('fetch-page', async (_e, url) => {
  if (!SITE_RE.test(url)) throw new Error('URL hors dofuspourlesnoobs.com');
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) DofusReader/1.0' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  settings.lastUrl = url; saveSettings();
  return await r.text();
});
ipcMain.handle('copy', (_e, text) => { lastClip = text; clipboard.writeText(String(text)); return true; });
ipcMain.handle('get-settings', () => settings);
ipcMain.handle('set-setting', (_e, key, value) => {
  if (!['watchClipboard', 'zaapMode', 'font', 'showImgs', 'posMap'].includes(key)) return settings;
  settings[key] = value; saveSettings(); return settings;
});

// --- Raccourcis globaux (fonctionnent même quand Dofus a le focus) ---
function registerKeys() {
  globalShortcut.unregisterAll();
  const failed = [];
  for (const [action, delta] of [['next', 1], ['prev', -1]]) {
    const acc = settings.keys[action];
    if (!acc) continue;
    let ok = false;
    try { ok = globalShortcut.register(acc, () => win && win.webContents.send('step', delta)); } catch (_) {}
    if (!ok) failed.push(acc);
  }
  return failed;
}
ipcMain.handle('set-key', (_e, action, acc) => {
  if (!['next', 'prev'].includes(action)) return { ok: false };
  const old = settings.keys[action];
  settings.keys[action] = acc;
  const failed = registerKeys();
  if (failed.includes(acc)) { settings.keys[action] = old; registerKeys(); return { ok: false, keys: settings.keys }; }
  saveSettings();
  return { ok: true, keys: settings.keys };
});
ipcMain.handle('suspend-keys', (_e, on) => { if (on) globalShortcut.unregisterAll(); else registerKeys(); });
ipcMain.handle('toggle-pin', () => {
  settings.pinned = !settings.pinned;
  win.setAlwaysOnTop(settings.pinned, 'screen-saver');
  saveSettings();
  return settings.pinned;
});
// Déplace la fenêtre sur l'écran suivant, collée à droite, pleine hauteur
ipcMain.handle('next-display', () => {
  const displays = screen.getAllDisplays();
  const cur = screen.getDisplayMatching(win.getBounds());
  const idx = displays.findIndex(d => d.id === cur.id);
  const next = displays[(idx + 1) % displays.length];
  const wa = next.workArea;
  const width = win.getBounds().width;
  win.setBounds({ x: wa.x + wa.width - width, y: wa.y, width, height: wa.height });
  settings.bounds = win.getBounds(); saveSettings();
  return displays.length;
});
ipcMain.handle('snap', (_e, side) => {
  const wa = screen.getDisplayMatching(win.getBounds()).workArea;
  const width = win.getBounds().width;
  win.setBounds({ x: side === 'left' ? wa.x : wa.x + wa.width - width, y: wa.y, width, height: wa.height });
  settings.bounds = win.getBounds(); saveSettings();
});
ipcMain.handle('open-external', (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });

// --- Zoom d'image dans une fenêtre à part (peut déborder de l'app) ---
const ZOOM_FACTOR = 2; // 2 = +100 %
let zoomWin = null;
let zoomClosed = { src: '', at: 0 };
function closeZoom() { if (zoomWin && !zoomWin.isDestroyed()) zoomWin.close(); }
ipcMain.handle('zoom-image', (_e, src, rect) => {
  if (typeof src !== 'string' || !/^https:\/\//.test(src) || !rect) return false;
  // Re-clic sur la même image juste après la fermeture : on ne rouvre pas
  if (zoomClosed.src === src && Date.now() - zoomClosed.at < 400) return false;
  closeZoom();
  const content = win.getContentBounds();
  const cx = content.x + rect.x + rect.width / 2;
  const cy = content.y + rect.y + rect.height / 2;
  const wa = screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(cy) }).workArea;
  // Image agrandie de 100 % (x2), sans dépasser l'écran
  const k = Math.min(ZOOM_FACTOR, (wa.width * 0.96) / rect.width, (wa.height * 0.94) / rect.height);
  const w = Math.round(rect.width * k), h = Math.round(rect.height * k);
  const x = Math.round(Math.min(Math.max(cx - w / 2, wa.x), wa.x + wa.width - w));
  const y = Math.round(Math.min(Math.max(cy - h / 2, wa.y), wa.y + wa.height - h));
  zoomWin = new BrowserWindow({
    x, y, width: w, height: h, frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, skipTaskbar: true, show: false, hasShadow: false,
    parent: win, alwaysOnTop: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  zoomWin.setAlwaysOnTop(true, 'screen-saver');
  zoomWin.setBounds({ x, y, width: w, height: h }); // écrans à mises à l'échelle différentes
  zoomWin.loadFile(path.join(__dirname, 'renderer', 'zoom.html'), { query: { src } });
  zoomWin.once('ready-to-show', () => { zoomWin.setBounds({ x, y, width: w, height: h }); zoomWin.show(); zoomWin.focus(); });
  zoomWin.on('blur', closeZoom); // clic ailleurs = fermeture
  zoomWin.on('closed', () => { zoomClosed = { src, at: Date.now() }; zoomWin = null; });
  zoomWin.webContents.on('will-navigate', (e) => e.preventDefault());
  return true;
});

app.whenReady().then(() => {
  loadSettings();
  lastClip = (clipboard.readText() || '').trim(); // ne pas réagir au contenu déjà présent
  app.setAppUserModelId('DplnSyraReader'); // icône et nom propres dans la barre des tâches
  Menu.setApplicationMenu(null); // pas de zoom de page Electron : Ctrl+molette règle la taille du texte
  createWindow();
  win.webContents.setVisualZoomLevelLimits(1, 1);
  startServer();
  watchClipboard();
  registerKeys();

  // Test épingle : Windows retire l'épinglage → l'app doit le remettre
  if (process.env.DR_SHOT && process.env.DR_TEST === 'pin') {
    win.webContents.once('did-finish-load', async () => {
      await new Promise(r => setTimeout(r, 1500));
      console.log('PIN départ', win.isAlwaysOnTop());
      win.setAlwaysOnTop(false);
      console.log('PIN retiré', win.isAlwaysOnTop());
      await new Promise(r => setTimeout(r, 2500));
      console.log('PIN après 2,5 s', win.isAlwaysOnTop());
      app.quit();
    });
  } else
  // Test du zoom : Ctrl + molette vers le haut ×3 puis vers le bas ×1 → +2
  if (process.env.DR_SHOT && process.env.DR_TEST === 'zoom') {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    win.webContents.once('did-finish-load', async () => {
      await wait(1500);
      const font = () => win.webContents.executeJavaScript('state.font + " zoomPage=" + ' + win.webContents.getZoomFactor());
      console.log('ZOOM avant', await font());
      for (const dy of [120, 120, 120, -120]) {
        win.webContents.sendInputEvent({ type: 'mouseWheel', x: 200, y: 400, deltaX: 0, deltaY: dy, wheelTicksY: dy / 120, canScroll: true, modifiers: ['control'] });
        await wait(250);
      }
      console.log('ZOOM après', await font(), 'pageZoom=', win.webContents.getZoomFactor());
      fs.writeFileSync(process.env.DR_SHOT, (await win.webContents.capturePage()).toPNG());
      app.quit();
    });
  } else

  // Mode test : DR_SHOT=<fichier.png> [DR_URL=...] → capture d'écran puis fermeture
  if (process.env.DR_SHOT) {
    win.webContents.once('did-finish-load', () => {
      if (process.env.DR_URL) setTimeout(() => sendUrl(process.env.DR_URL, 'extension'), 500);
      setTimeout(async () => {
        const info = await win.webContents.executeJavaScript(
          `JSON.stringify({title: document.title, steps: document.querySelectorAll('#steps .step').length, paras: document.querySelectorAll('.para').length, imgs: document.querySelectorAll('figure').length, first: [...document.querySelectorAll('#steps .step')].slice(0,4).map(s=>s.innerText.replace(/\\n/g,' | ')), res: [...document.querySelectorAll('.res')].map(r=>r.textContent), tags: [...document.querySelectorAll('.dungeon, .fight')].map(r=>r.className+':'+r.textContent), li: [...document.querySelectorAll('.para li')].map(l=>l.innerHTML).filter(h=>/donjon/i.test(h))}, (${process.env.DR_FIGHT ? 1 : 0} ? document.querySelector('${process.env.DR_FIGHT === 'donjon' ? '.dungeon' : '.fight'}') : document.querySelectorAll('.coord')[12])?.scrollIntoView({block:'center'}))`);
        await new Promise(r => setTimeout(r, 400));
        const js = (c) => win.webContents.executeJavaScript(c);
        const top0 = await js(`document.querySelector('#read').scrollTop`);
        console.log('TEST', info, 'keys:', JSON.stringify(settings.keys), 'F8 registered:', globalShortcut.isRegistered(settings.keys.next));
        for (let k = 0; k < 4; k++) {
          win.webContents.send('step', 1);
          await new Promise(r => setTimeout(r, 300));
          console.log('STEP', k + 1, clipboard.readText());
        }
        const wait = (ms) => new Promise(r => setTimeout(r, ms));
        console.log('SCROLL before/after steps:', top0, await js(`document.querySelector('#read').scrollTop`));
        console.log('RES', await js(`JSON.stringify(state.res, (k, v) => k === 'el' ? undefined : v)`));
        if (process.env.DR_FIGHT) { await js("document.querySelector('" + (process.env.DR_FIGHT === 'donjon' ? '#read .dungeon' : '#read .fight') + "').scrollIntoView({block:'center'})"); await wait(300); }
        if (process.env.DR_STEP0) { await js("state.current = 0; updateCurrent()"); await wait(200); }
        if (process.env.DR_ZOOM) {
          const w0 = await js("(() => { const i = [...document.querySelectorAll('figure img')].find(i => { const r = i.getBoundingClientRect(); return r.top > 60 && r.bottom < innerHeight - 60; }); i.click(); return Math.round(i.getBoundingClientRect().width); })()");
          await wait(1200);
          console.log('ZOOM image', w0, 'px -> fenêtre', zoomWin ? JSON.stringify(zoomWin.getBounds()) : 'aucune', 'app', JSON.stringify(win.getContentBounds()));
          if (zoomWin) fs.writeFileSync(process.env.DR_SHOT.replace('.png', '-zoom.png'), (await zoomWin.webContents.capturePage()).toPNG());
          if (zoomWin) zoomWin.webContents.sendInputEvent({ type: 'mouseDown', x: 20, y: 20, button: 'left', clickCount: 1 });
          await wait(500);
          console.log('ZOOM après clic', zoomWin ? 'encore ouverte' : 'fermée');
        }
        fs.writeFileSync(process.env.DR_SHOT, (await win.webContents.capturePage()).toPNG());
        await js(`document.querySelector('#resBtn').click()`);
        await wait(400);
        fs.writeFileSync(process.env.DR_SHOT.replace('.png', '-b.png'), (await win.webContents.capturePage()).toPNG());
        // Changement d'onglet : A → B → A, la position de A doit revenir
        await js(`document.querySelector('#resBtn').click()`);
        const topA = await js(`document.querySelector('#read').scrollTop`);
        await wait(600);
        sendUrl('https://www.dofuspourlesnoobs.com/alignement-bontarien.html', 'extension');
        await wait(4000);
        const topB = await js(`document.querySelector('#read').scrollTop`);
        sendUrl(process.env.DR_URL, 'extension');
        await wait(1500);
        console.log('TABS scrollA=', topA, 'onB=', topB, 'backToA=', await js(`document.querySelector('#read').scrollTop`), 'cur=', await js(`state.current`));
        app.quit();
      }, 7000);
    });
  }
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
