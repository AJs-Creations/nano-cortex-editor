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
const LINKS = require('../pro/links');   // repo, manual, issues, support: the same constants the editor page uses
const { menuTemplate, menuLabels } = require('./menu');
const { createActivityLog } = require('./activity-log');

// Capture pages live under /cloud/discover/… and under pack pages like /cloud/<pack>/…
const CAPTURE_PAGE = /\/neural-capture\/view\/([0-9a-f-]{36})/i;

const CLOUD_URL = 'https://cloud.neuraldsp.com/cloud/';
const CLOUD_PARTITION = 'persist:cortex-cloud';
const TOOLBAR_HEIGHT = 44;

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
  credits: 'Protocol layer from the community Nano Cortex Editor (DrD85, MIT) and nano-cortex-web-editor (choldy, MIT). IBM Plex Sans (OFL).\n'
    + 'If this editor saves you time, you can buy me a coffee: ' + LINKS.support,
  iconPath: path.join(__dirname, '..', 'pro', 'assets', 'icon-512.png'),
});

// Web Bluetooth is on by default in Chromium on macOS/Windows; Linux needs this.
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-experimental-web-platform-features');

let win, toolbar, editor, cloud;
let active = 'editor';

// ---------- shell settings (userData/settings.json) ----------
// What the main process needs before the editor page has loaded: the accent (for the Dock icon), the
// remembered pedal, Developer tools (for the menu) and the update settings (checked at launch). Everything else
// lives in the editor page's localStorage.
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
let shellSettings = { accent: DEFAULT_ACCENT, dockFollowsAccent: true, pedal: null, devTools: false, autoUpdate: true, skippedVersion: null };
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
// Web Bluetooth's requestDevice() normally shows Chrome's picker. Electron has none, so every scan result comes
// here and src/bt-picker.js decides: the remembered pedal or the first device advertising the Nano's service is
// taken at once, otherwise the editor page shows its chooser. A device is remembered only after the page has found
// the Nano's services on it (bt-result 'ok'); one without them is forgotten (issue #15).
const { createBluetoothPicker } = require('./bt-picker');
let btPicker = null;
const BT_HINT = 'Put the Nano Cortex in pairing mode: hold EXIT + CAPTURE for about a second, until the Gain ring lights up.';
function wireBluetooth(contents) {
  let nativeAbort = null;   // the shell's own chooser, for the Classic Editor (it has none)
  async function showNative(view) {
    if (!view.open) { if (nativeAbort) nativeAbort.abort(); return; }
    if (nativeAbort || !view.devices.length) return;   // a message box can't update; wait for a first device
    nativeAbort = new AbortController();
    const list = view.devices;
    const { response } = await dialog.showMessageBox(win, {
      type: 'question', message: 'Choose your Nano Cortex', detail: BT_HINT, signal: nativeAbort.signal,
      buttons: [...list.map(d => d.name || 'Unnamed device (' + d.id + ')'), 'Cancel'], cancelId: list.length,
    }).catch(() => ({ response: -1 }));
    nativeAbort = null;
    btPicker.choose(response >= 0 && response < list.length ? list[response].id : '');
  }
  btPicker = createBluetoothPicker({
    store: { get: () => shellSettings.pedal, set: (pedal) => { shellSettings.pedal = pedal; saveShellSettings(); } },
    show: (view) => (view.native || (!view.open && nativeAbort) ? showNative(view) : contents.send('bt-chooser', view)),
    hint: (name) => contents.executeJavaScript('window.__bleHint = ' + JSON.stringify(name)).catch(() => {}),
    // A new requestDevice() needs a user gesture, which executeJavaScript can grant.
    connectAgain: (opts) => contents.executeJavaScript('window.__connectAgain && window.__connectAgain(' + JSON.stringify(opts) + ')', true).catch(() => {}),
    log: (msg) => { activityLog().write('[bluetooth] ' + msg); if (!app.isPackaged) console.log('[bluetooth] ' + msg); },
  });
  contents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    btPicker.onSelect(devices, callback);
  });
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
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // Windows and Linux: the window/taskbar icon (macOS takes it from the bundle or the Dock).
    ...(process.platform !== 'darwin' && fs.existsSync(STOCK_ICON) ? { icon: nativeImage.createFromPath(STOCK_ICON) } : {}),
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
  editor.webContents.on('did-finish-load', () => { if (pendingUpdate && editorFlavor === 'pro') editor.webContents.send('update-event', pendingUpdate); });
  loadEditor('pro');
  editor.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  // The editor's Activity log goes to the log file for everyone (Help → Show Log File). Running from source it is
  // also mirrored to the terminal and kept for the dev remote's /log.
  editor.webContents.on('console-message', (e) => {
    const m = e.message ?? e.params?.message;
    if (m == null) return;
    activityLog().write(String(m));
    if (app.isPackaged) return;
    console.log('[editor] ' + m);
    devLog.push({ t: Date.now(), text: String(m) });
    if (devLog.length > 5000) devLog.splice(0, devLog.length - 5000);
  });
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
        } else if (url.pathname === '/menu') {
          res.end(JSON.stringify({ devTools: shellSettings.devTools, labels: menuLabels(Menu.getApplicationMenu().items.map(function walk(i) { return { label: i.label, submenu: i.submenu ? i.submenu.items.map(walk) : null }; })) }));
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
  pedal: shellSettings.pedal, recordingsDir: recordingsDir(), version: app.getVersion(), devTools: shellSettings.devTools,
  logFile: activityLog().file, autoUpdate: shellSettings.autoUpdate !== false, updates: !!updates,
} : null));
// Developer tools (Settings → General → Advanced): the page sends it on every change and at launch; the menu follows.
ipcMain.handle('set-dev-tools', (e, on) => {
  if (!fromEditor(e)) return null;
  on = !!on;
  if (on === shellSettings.devTools) return on;
  shellSettings.devTools = on;
  saveShellSettings();
  if (!on) {
    for (const v of [editor, cloud]) if (v && v.webContents.isDevToolsOpened()) v.webContents.closeDevTools();
    if (editorFlavor === 'classic') loadEditor('pro');   // Classic Editor is a developer view now
  }
  buildMenu();
  return on;
});
// Outside links from the editor page (manual, repo, support): only our own known https links, always in the
// default browser.
const OUTSIDE_HOSTS = new Set(['github.com', 'buymeacoffee.com']);
function openOutside(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && OUTSIDE_HOSTS.has(u.hostname)) { shell.openExternal(u.href); return true; }
  } catch { /* not a URL */ }
  return false;
}
ipcMain.handle('open-external', (e, url) => (fromEditor(e) ? openOutside(String(url)) : false));
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
// A recording stopped by turning Developer tools off: straight into the recordings folder, no dialog.
ipcMain.handle('save-recording', async (e, name, json) => {
  if (!fromEditor(e) || !/^nano-session-[\w-]+\.json$/.test(name)) return '';
  const file = path.join(recordingsDir(), name);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, json);
  console.log('[download] completed ' + file);
  return file;
});
// Reconnect at launch: requestDevice() needs a user gesture, which executeJavaScript can grant. The page then tells
// the picker (bt-request, auto) that this scan takes only the remembered pedal.
ipcMain.handle('auto-connect', async (e) => {
  if (!fromEditor(e) || !shellSettings.pedal) return false;
  await editor.webContents.executeJavaScript('window.__autoConnect && window.__autoConnect()', true).catch(() => {});
  return true;
});
// Bluetooth picker (src/bt-picker.js). bt-request is synchronous: the page sends it right before requestDevice(), so
// the picker knows the scan mode before the first 'select-bluetooth-device' event, and the reply is that mode.
ipcMain.on('bt-request', (e, opts) => {
  e.returnValue = fromEditor(e) && btPicker ? btPicker.beginRequest(opts && typeof opts === 'object' ? opts : {}) : null;
});
ipcMain.handle('bt-choose', (e, choice) => (fromEditor(e) && btPicker ? btPicker.choose(String(choice)) : false));
// How connecting to the picked device went: only 'ok' (the Nano's services and characteristics found) remembers it.
ipcMain.handle('bt-result', (e, kind) => (fromEditor(e) && btPicker ? btPicker.result(String(kind)) : null));
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

// ---------- updates (src/updates.js: electron-updater reading GitHub Releases) ----------
// Only in packaged builds: never from source and never in the UX test, which drives the page's modal itself.
// release.yml uploads the metadata electron-updater reads (latest-mac.yml, latest.yml, latest-linux*.yml) and the
// blockmaps with every release.
const { createUpdates, installMode } = require('./updates');
let updates = null;
let pendingUpdate = null;   // the offer, download or install the page hasn't answered yet: shown again after a reload
function sendUpdate(ev) {
  if (ev.type === 'available' || ev.type === 'progress' || ev.type === 'downloaded') pendingUpdate = ev;
  else if (ev.type === 'error') pendingUpdate = null;
  if (editor && !editor.webContents.isDestroyed()) editor.webContents.send('update-event', ev);
}
function startUpdates() {
  if (!app.isPackaged) return;
  const { autoUpdater } = require('electron-updater');
  const write = (level) => (m) => activityLog().write('[updater] ' + (level ? level + ': ' : '') + m);
  autoUpdater.logger = { info: write(''), warn: write('warn'), error: write('error'), debug: () => {} };
  updates = createUpdates({
    updater: autoUpdater,
    store: {
      get: () => ({ auto: shellSettings.autoUpdate !== false, skipped: shellSettings.skippedVersion || null }),
      set: (p) => {
        if ('auto' in p) shellSettings.autoUpdate = !!p.auto;
        if ('skipped' in p) shellSettings.skippedVersion = p.skipped;
        saveShellSettings();
      },
    },
    send: sendUpdate,
    openExternal: (url) => openOutside(url),
    currentVersion: app.getVersion(),
    mode: installMode(process.platform, process.env),
    releaseUrl: (v) => LINKS.releases + '/tag/v' + v,
    log: (m) => activityLog().write('[updates] ' + m),
  });
  updates.start();
}
// Help → Check for Updates…
function checkForUpdates() {
  show('editor');
  if (updates) updates.check(true);
  else sendUpdate({ type: 'error', message: 'Updates are checked only in the installed app.' });
}
ipcMain.handle('update-action', (e, what, version) => {
  if (!fromEditor(e)) return null;
  what = String(what);
  if (what !== 'download') pendingUpdate = null;
  return updates ? updates.action(what, String(version || '')) : null;
});
ipcMain.handle('set-auto-update', (e, on) => {
  if (!fromEditor(e)) return null;
  if (updates) return updates.setAuto(!!on);
  shellSettings.autoUpdate = !!on;
  saveShellSettings();
  return !!on;
});

// ---------- Activity log file (Help → Show Log File) ----------
let actLog = null;
function activityLog() {
  if (!actLog) {
    actLog = createActivityLog(path.join(app.getPath('logs'), 'nano-cortex-editor.log'));
    actLog.write('--- Nano Cortex Editor ' + app.getVersion() + ' started (' + process.platform + ' ' + process.arch + ', Electron ' + process.versions.electron + ')');
  }
  return actLog;
}
function showLogFile() { shell.showItemInFolder(activityLog().ensureFile()); }
app.on('will-quit', () => { if (actLog) actLog.flushSync(); });

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate({
    isMac: process.platform === 'darwin', appName: app.name, devTools: shellSettings.devTools, editorFlavor, links: LINKS,
    a: {
      show,
      toggleClassic: () => { loadEditor(editorFlavor === 'classic' ? 'pro' : 'classic'); show('editor'); },
      reload: () => (active === 'cloud' ? cloud : editor).webContents.reload(),
      toggleDevTools: () => (active === 'cloud' ? cloud : editor).webContents.toggleDevTools(),
      openSettings,
      openLink: (url) => shell.openExternal(url),
      showLogFile,
      checkForUpdates,
    },
  })));
}

app.whenReady().then(() => {
  loadShellSettings();
  // Packaged builds get the icon from build/icon.icns; from source, set the Dock icon by hand.
  // The cached accent icon (if any) replaces it once rendered.
  if (!app.isPackaged && process.platform === 'darwin' && fs.existsSync(STOCK_ICON)) app.dock.setIcon(STOCK_ICON);
  buildMenu();
  createWindow();
  applyAppIcon();
  startUpdates();
  app.on('activate', () => { if (!win || win.isDestroyed()) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
