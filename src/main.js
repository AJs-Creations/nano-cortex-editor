// Nano Cortex Editor — desktop shell
//
// Two views in one window:
//   • Editor: the community BLE editor (editor/index.html), unchanged, running in
//     Chromium so Web Bluetooth + Web MIDI work natively.
//   • Cortex Cloud: Neural DSP's own website, so you sign in on their real login
//     page with your own account. The app never sees or stores your password;
//     the session cookie lives in a persistent Chromium profile (encrypted with
//     the macOS Keychain by Chromium itself).

const { app, BaseWindow, WebContentsView, session, shell, ipcMain, dialog, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { renderAccentIcon, normHex, DEFAULT_ACCENT } = require('./accent-icon');

// Capture pages live under /cloud/discover/… and under pack pages like /cloud/<pack>/…
const CAPTURE_PAGE = /\/neural-capture\/view\/([0-9a-f-]{36})/i;

const CLOUD_URL = 'https://cloud.neuraldsp.com/cloud/';
const CLOUD_PARTITION = 'persist:cortex-cloud';
const TOOLBAR_HEIGHT = 44;
const NANO_NAME = /nano|cortex|ndsp|neural/i;

// Dev remote: lets a terminal drive the editor during hardware sessions.
//   NANO_DEV_PORT=4848 npm start
//   curl -d 'state.selectedPreset' http://127.0.0.1:4848/eval   → runs JS in the editor page
//   curl 'http://127.0.0.1:4848/log?since=0'                    → mirrored Activity log
// Localhost only, off unless the variable is set, never in a packaged build.
const DEV_PORT = app.isPackaged ? 0 : Number(process.env.NANO_DEV_PORT || 0);
const devLog = [];

// Hosts the Cloud tab may navigate to. Sign-in may bounce through Neural DSP's
// account pages, so allow the whole neuraldsp.com family; everything else opens
// in your default browser.
const isCloudHost = (url) => {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && (hostname === 'neuraldsp.com' || hostname.endsWith('.neuraldsp.com'));
  } catch { return false; }
};

// Name and About panel. From source the process is still Electron.app, so the
// Dock keeps Electron's name and icon tooltip; the packaged app (npm run dist)
// carries the real name, bundle id, icon and usage strings from package.json.
app.setName('Nano Cortex Editor');
app.setAboutPanelOptions({
  applicationName: 'Nano Cortex Editor',
  applicationVersion: app.getVersion(),
  version: '',
  copyright: '© 2026 AJs Creations, MIT licence. Unofficial; not affiliated with or endorsed by Neural DSP.',
  credits: 'Protocol layer from the community Nano Cortex Editor (DrD85, MIT) and nano-cortex-web-editor (choldy, MIT). IBM Plex Sans (OFL).',
  iconPath: path.join(__dirname, '..', 'pro', 'assets', 'icon-512.png'),
});

// Web Bluetooth is on by default in Chromium on macOS/Windows; Linux needs this.
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-experimental-web-platform-features');

let win, toolbar, editor, cloud;
let autoConnecting = false;
let active = 'editor';

// ---------- shell settings (userData/settings.json) ----------
// What the main process needs before the editor page has loaded: the accent (for the Dock icon) and the
// remembered pedal. Everything else lives in the editor page's localStorage.
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
let shellSettings = { accent: DEFAULT_ACCENT, dockFollowsAccent: true, pedal: null };
function loadShellSettings() {
  try { Object.assign(shellSettings, JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8'))); } catch { /* defaults */ }
}
function saveShellSettings() {
  try { fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true }); fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(shellSettings, null, 1)); }
  catch (err) { console.log('[settings] could not save: ' + err.message); }
}

// Dock (macOS) / window (Windows, Linux) icon in the accent colour, rendered from assets/icon.svg and
// cached per colour under userData/icons/. Off: the stock icon.
const STOCK_ICON = path.join(__dirname, '..', 'pro', 'assets', 'icon-1024.png');
async function applyAppIcon() {
  let file = STOCK_ICON;
  if (shellSettings.dockFollowsAccent) {
    try { file = await renderAccentIcon(shellSettings.accent, path.join(app.getPath('userData'), 'icons')); }
    catch (err) { console.log('[icon] render failed: ' + err.message); }
  }
  if (!fs.existsSync(file)) return null;
  if (process.platform === 'darwin') {
    // A packaged build with the stock purple keeps its bundle icon; from source Electron's own icon is replaced.
    if (app.isPackaged && file === STOCK_ICON) return file;
    app.dock.setIcon(file);
  } else if (win && !win.isDestroyed()) {
    win.setIcon(nativeImage.createFromPath(file));
  }
  return file;
}

// Session recordings (Record in the status bar) default to the fixtures folder from source.
const recordingsDir = () => (app.isPackaged ? app.getPath('downloads') : path.join(__dirname, '..', 'test', 'fixtures', 'sessions'));

function layout() {
  const { width, height } = win.getContentBounds();
  toolbar.setBounds({ x: 0, y: 0, width, height: TOOLBAR_HEIGHT });
  const body = { x: 0, y: TOOLBAR_HEIGHT, width, height: height - TOOLBAR_HEIGHT };
  editor.setBounds(body);
  cloud.setBounds(body);
}

function show(tab) {
  active = tab;
  editor.setVisible(tab === 'editor');
  cloud.setVisible(tab === 'cloud');
  if (tab === 'cloud' && cloud.webContents.getURL() === '') cloud.webContents.loadURL(CLOUD_URL);
  toolbar.webContents.send('tab-changed', tab);
}

// ---------- Bluetooth device picking ----------
// Web Bluetooth's requestDevice() normally shows Chrome's picker. Electron has no
// picker, so we get a stream of scan results and choose here: auto-connect to
// anything that looks like a Nano Cortex, otherwise offer a native chooser.
function wireBluetooth(contents) {
  let pending = null;

  contents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();

    if (!pending) {
      // autoConnecting: the reconnect at launch. It takes only the remembered pedal and never shows a chooser.
      pending = { callback, seen: new Map(), done: false, auto: autoConnecting };
      autoConnecting = false;
      const p = pending;
      // Give the scan a few seconds; if nothing auto-matched, let the user choose.
      p.timer = setTimeout(async () => {
        if (p.done) return;
        const list = [...p.seen.values()];
        if (p.auto) {
          await contents.executeJavaScript("window.__bleHint = 'auto-none'").catch(() => {});
          finish(p, '');
          return;
        }
        if (list.length === 0) {
          // The editor page explains this in its connect card.
          // Set the hint before cancelling, so it's there when the page sees the error.
          await contents.executeJavaScript("window.__bleHint = 'none-found'").catch(() => {});
          finish(p, '');
          return;
        }
        const shown = list.slice(0, 8);
        const { response } = await dialog.showMessageBox(win, {
          type: 'question',
          message: 'Choose your Nano Cortex',
          buttons: [...shown.map(d => d.deviceName || d.deviceId), 'Cancel'],
          cancelId: shown.length
        });
        finish(p, response < shown.length ? shown[response].deviceId : '');
      }, 5000);
    }

    for (const d of devices) pending.seen.set(d.deviceId, d);
    const known = shellSettings.pedal && shellSettings.pedal.id;
    const match = pending.auto && known ? devices.find(d => d.deviceId === known)
      : devices.find(d => d.deviceId === known) || devices.find(d => NANO_NAME.test(d.deviceName || ''));
    if (match) finish(pending, match.deviceId);
  });

  function finish(p, deviceId) {
    if (p.done) return;
    p.done = true;
    clearTimeout(p.timer);
    p.callback(deviceId); // '' cancels requestDevice()
    if (pending === p) pending = null;
    if (deviceId) {
      const d = p.seen.get(deviceId);
      shellSettings.pedal = { id: deviceId, name: (d && d.deviceName) || 'Nano Cortex', at: new Date().toISOString() };
      saveShellSettings();
    }
  }
}

function grantDevicePermissions(ses) {
  const allowed = new Set(['bluetooth', 'midi', 'midiSysex']);
  // 'media' (audio only): the metronome's output picker needs microphone
  // permission once, because Chromium hides audio output names without it.
  const audioOnly = (details) => !details || !details.mediaTypes || details.mediaTypes.every(t => t === 'audio');
  ses.setPermissionRequestHandler((_wc, permission, cb, details) => cb(allowed.has(permission) || (permission === 'media' && audioOnly(details))));
  ses.setPermissionCheckHandler((_wc, permission, _origin, details) => allowed.has(permission) || (permission === 'media' && audioOnly(details)));
  ses.setDevicePermissionHandler(() => true);
  // Windows/Linux may ask for a pairing PIN confirmation; macOS handles pairing itself.
  if (ses.setBluetoothPairingHandler) {
    ses.setBluetoothPairingHandler((details, cb) => cb({ confirmed: true }));
  }
}

function createWindow() {
  win = new BaseWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Nano Cortex Editor',
    backgroundColor: '#121212',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default'
  });

  // Toolbar
  toolbar = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'toolbar-preload.js'), contextIsolation: true, sandbox: true }
  });
  toolbar.webContents.loadFile(path.join(__dirname, 'toolbar.html')).then(sendAccentToToolbar);

  // Editor (local file, needs BLE + MIDI)
  editor = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'editor-preload.js'), contextIsolation: true, sandbox: true, partition: 'persist:editor' }
  });
  grantDevicePermissions(editor.webContents.session);
  wireBluetooth(editor.webContents);
  loadEditor('pro');
  editor.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  // Running from source: mirror the editor's Activity log to the terminal.
  if (!app.isPackaged) {
    editor.webContents.on('console-message', (e) => {
      const m = e.message ?? e.params?.message;
      if (m == null) return;
      console.log('[editor] ' + m);
      devLog.push({ t: Date.now(), text: String(m) });
      if (devLog.length > 5000) devLog.splice(0, devLog.length - 5000);
    });
  }
  if (DEV_PORT) startDevRemote();
  editor.webContents.session.on('will-download', (_e, item) => {
    const dir = recordingsDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = DEV_PORT ? path.join(dir, item.getFilename())
      : dialog.showSaveDialogSync(win, { defaultPath: path.join(dir, item.getFilename()) });
    if (file) item.setSavePath(file); else item.cancel();
    if (file) item.once('done', (_e, state) => console.log('[download] ' + state + ' ' + file));
  });

  // Cortex Cloud (their real website, persistent login, no device permissions)
  cloud = new WebContentsView({
    webPreferences: { contextIsolation: true, sandbox: true, partition: CLOUD_PARTITION }
  });
  const cloudSes = session.fromPartition(CLOUD_PARTITION);
  cloudSes.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  cloud.webContents.on('will-navigate', (e, url) => {
    if (!isCloudHost(url)) { e.preventDefault(); shell.openExternal(url); }
  });
  cloud.webContents.setWindowOpenHandler(({ url }) => {
    if (isCloudHost(url)) { cloud.webContents.loadURL(url); }
    else { shell.openExternal(url); }
    return { action: 'deny' };
  });
  // Downloads (captures, IRs, backups) go where you choose.
  cloudSes.on('will-download', (_e, item) => {
    const file = dialog.showSaveDialogSync(win, { defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
    if (file) item.setSavePath(file); else item.cancel();
  });
  const pushNav = () => toolbar.webContents.send('cloud-nav', {
    canGoBack: cloud.webContents.navigationHistory.canGoBack(),
    canGoForward: cloud.webContents.navigationHistory.canGoForward(),
    captureId: captureIdOf(cloud.webContents.getURL()),
    pageKind: captureIdOf(cloud.webContents.getURL()) ? 'capture' : /\/preset\/view\//.test(cloud.webContents.getURL()) ? 'preset' : 'other'
  });
  cloud.webContents.on('did-navigate', pushNav);
  cloud.webContents.on('did-navigate-in-page', pushNav);

  win.contentView.addChildView(editor);
  win.contentView.addChildView(cloud);
  win.contentView.addChildView(toolbar);
  win.on('resize', layout);
  layout();
  show('editor');
}

function startDevRemote() {
  require('http').createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      res.setHeader('Content-Type', 'application/json');
      try {
        const url = new URL(req.url, 'http://x');
        const target = url.searchParams.get('target') === 'cloud' ? cloud : editor;
        if (req.method === 'POST' && url.pathname === '/eval') {
          const value = await target.webContents.executeJavaScript(body, true);
          res.end(JSON.stringify({ ok: true, value: value === undefined ? null : value }));
        } else if (url.pathname === '/send-capture') {
          res.end(JSON.stringify(await sendCaptureToNano(url.searchParams.get('id'))));
        } else if (url.pathname === '/show') {
          show(url.searchParams.get('tab') === 'cloud' ? 'cloud' : 'editor');
          res.end(JSON.stringify({ ok: true, url: cloud.webContents.getURL() }));
        } else if (url.pathname === '/shot') {
          const img = await target.webContents.capturePage();
          const file = url.searchParams.get('file') || path.join(app.getPath('temp'), 'nano-shot.png');
          fs.writeFileSync(file, img.toPNG());
          res.end(JSON.stringify({ ok: true, file, url: target.webContents.getURL() }));
        } else if (url.pathname === '/log') {
          const since = Number(url.searchParams.get('since') || 0);
          res.end(JSON.stringify({ next: devLog.length, lines: devLog.slice(since).map(l => l.text) }));
        } else { res.statusCode = 404; res.end('{}'); }
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
      }
    });
  }).listen(DEV_PORT, '127.0.0.1', () => console.log('[dev] remote on http://127.0.0.1:' + DEV_PORT));
}

// The pro UI (pro/) is the default; the original community UI (editor/) stays
// available from View → Classic Editor as a fallback.
let editorFlavor = 'pro';
function loadEditor(flavor) {
  editorFlavor = flavor;
  const file = flavor === 'classic' ? ['..', 'editor', 'index.html'] : ['..', 'pro', 'index.html'];
  editor.webContents.loadFile(path.join(__dirname, ...file));
  buildMenu();
}

// ---------- toolbar IPC ----------
ipcMain.on('show-tab', (_e, tab) => show(tab === 'cloud' ? 'cloud' : 'editor'));
ipcMain.on('cloud-cmd', (_e, cmd) => {
  const wc = cloud.webContents;
  if (cmd === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  if (cmd === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  if (cmd === 'reload') wc.reload();
  if (cmd === 'home') wc.loadURL(CLOUD_URL);
});
ipcMain.on('editor-reload', () => editor.webContents.reload());

// ---------- editor settings IPC (src/editor-preload.js → window.nanoShell) ----------
const fromEditor = (e) => editor && e.sender === editor.webContents;
ipcMain.handle('settings-get', (e) => (fromEditor(e) ? {
  platform: process.platform, accent: shellSettings.accent, dockFollowsAccent: shellSettings.dockFollowsAccent,
  pedal: shellSettings.pedal, recordingsDir: recordingsDir(),
} : null));
ipcMain.handle('set-accent', async (e, hex, follow) => {
  if (!fromEditor(e)) return null;
  const accent = normHex(hex);
  if (accent) shellSettings.accent = accent;
  if (typeof follow === 'boolean') shellSettings.dockFollowsAccent = follow;
  saveShellSettings();
  sendAccentToToolbar();
  return applyAppIcon();
});
// The tab toolbar is its own page: give it the accent (Send to Nano Cortex lights up in it when clickable).
function sendAccentToToolbar() { if (toolbar && !toolbar.webContents.isDestroyed()) toolbar.webContents.send('accent', shellSettings.accent || '#6954ff'); }
ipcMain.handle('forget-pedal', (e) => { if (!fromEditor(e)) return false; shellSettings.pedal = null; saveShellSettings(); return true; });
ipcMain.handle('reveal-recordings', async (e) => {
  if (!fromEditor(e)) return '';
  const dir = recordingsDir();
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});
// Reconnect at launch: requestDevice() needs a user gesture, which executeJavaScript can grant.
ipcMain.handle('auto-connect', async (e) => {
  if (!fromEditor(e) || !shellSettings.pedal) return false;
  autoConnecting = true;
  setTimeout(() => { autoConnecting = false; }, 3000);   // the picker event normally arrives within a second
  await editor.webContents.executeJavaScript('window.__autoConnect && window.__autoConnect()', true).catch(() => {});
  return true;
});
function openSettings() {
  show('editor');
  if (editorFlavor === 'pro') editor.webContents.send('open-settings');
}

// ---------- Cortex Cloud capture → pedal ----------
// "Send to Nano Cortex" on a capture page: fetch the capture bundle with the Cloud
// tab's own session, unpack it here, hand the .cns and its metadata to the
// editor page, which confirms and streams it to the pedal.
function captureIdOf(url) { const m = CAPTURE_PAGE.exec(url || ''); return m ? m[1] : null; }

// Minimal POSIX tar reader: returns { name: Buffer }.
function untar(buf) {
  const files = {};
  for (let off = 0; off + 512 <= buf.length;) {
    const name = buf.toString('utf8', off, off + 100).replace(/\0.*$/s, '');
    if (!name) break;
    const size = parseInt(buf.toString('ascii', off + 124, off + 136).replace(/\0.*$/s, '').trim() || '0', 8);
    const type = buf[off + 156];
    if (type === 0 || type === 0x30) files[path.basename(name)] = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

async function fetchCaptureBundle(id) {
  const res = await cloud.webContents.session.fetch('https://cloud-api.neuraldsp.com/api/v1/products/' + id + '/download', { credentials: 'include' });
  if (!res.ok) throw new Error('Cortex Cloud answered ' + res.status + (res.status === 401 ? ' (not signed in?)' : ''));
  const json = await res.json();
  if (!json.payload) throw new Error('The reply has no capture payload.');
  const files = untar(zlib.gunzipSync(Buffer.from(json.payload, 'base64')));
  const cnsName = Object.keys(files).find(n => n.endsWith('.cns'));
  const jsonName = Object.keys(files).find(n => n.endsWith('.json'));
  if (!cnsName) throw new Error('No .cns file in the bundle (' + Object.keys(files).join(', ') + ').');
  const m = jsonName ? JSON.parse(files[jsonName].toString('utf8')) : {};
  return {
    cns: files[cnsName].toString('base64'),
    meta: {
      hash: m.hash || cnsName.replace(/\.cns$/, ''), name: m.name || json.name, cloudUUID: m.cloudUUID || id,
      authorId: m.authorId, authorName: m.authorName, description: m.description || '', deviceType: m.deviceType,
      tags: m.tags || [], gainType: m.gainType, instrumentType: m.instrumentType, version: m.version,
    },
  };
}

async function sendCaptureToNano(id) {
  id = id || captureIdOf(cloud.webContents.getURL());
  if (!id) return { ok: false, error: 'Open a capture page in Cortex Cloud first.' };
  try {
    const bundle = await fetchCaptureBundle(id);
    editor.webContents.send('capture-bundle', bundle);
    show('editor');
    return { ok: true, name: bundle.meta.name, bytes: Buffer.from(bundle.cns, 'base64').length };
  } catch (err) {
    dialog.showMessageBox(win, { type: 'warning', message: 'Could not fetch the capture', detail: err.message });
    return { ok: false, error: err.message };
  }
}
ipcMain.handle('send-capture', () => sendCaptureToNano());

ipcMain.handle('sign-out', async () => {
  const { response } = await dialog.showMessageBox(win, {
    type: 'question', buttons: ['Sign out', 'Cancel'], cancelId: 1,
    message: 'Sign out of Cortex Cloud?', detail: 'Clears the saved Cortex Cloud session from this app.'
  });
  if (response !== 0) return false;
  await session.fromPartition(CLOUD_PARTITION).clearStorageData();
  cloud.webContents.loadURL(CLOUD_URL);
  return true;
});

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const settingsItem = { label: 'Settings\u2026', accelerator: 'CmdOrCtrl+,', enabled: editorFlavor === 'pro', click: openSettings };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' }, { type: 'separator' }, settingsItem, { type: 'separator' },
        { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' }, { role: 'quit' },
      ],
    }] : []),
    isMac ? { role: 'editMenu' } : {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'selectAll' }, { type: 'separator' }, settingsItem,
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Editor', accelerator: 'CmdOrCtrl+1', click: () => show('editor') },
        { label: 'Cortex Cloud', accelerator: 'CmdOrCtrl+2', click: () => show('cloud') },
        { type: 'separator' },
        { label: 'Classic Editor', type: 'checkbox', checked: editorFlavor === 'classic',
          click: () => { loadEditor(editorFlavor === 'classic' ? 'pro' : 'classic'); show('editor'); } },
        { type: 'separator' },
        { label: 'Reload Current', accelerator: 'CmdOrCtrl+R',
          click: () => (active === 'cloud' ? cloud : editor).webContents.reload() },
        { label: 'Developer Tools', accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: () => (active === 'cloud' ? cloud : editor).webContents.toggleDevTools() },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]));
}

app.whenReady().then(() => {
  loadShellSettings();
  // Packaged builds get the icon from build/icon.icns; from source, set the Dock icon by hand.
  // The cached accent icon (if any) replaces it once rendered.
  if (!app.isPackaged && process.platform === 'darwin' && fs.existsSync(STOCK_ICON)) app.dock.setIcon(STOCK_ICON);
  buildMenu();
  createWindow();
  applyAppIcon();
  app.on('activate', () => { if (!win || win.isDestroyed()) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
