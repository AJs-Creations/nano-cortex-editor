// Bridge between the shell and the pro editor page. The editor receives capture bundles and can reach a few
// settings in the main process here; it never gets access to Node or the Cloud session.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nanoCloud', {
  onCapture: (fn) => ipcRenderer.on('capture-bundle', (_e, bundle) => fn(bundle)),
});

contextBridge.exposeInMainWorld('nanoShell', {
  platform: process.platform,   // shortcut labels: ⌘ on macOS, Ctrl on Windows and Linux
  getSettings: () => ipcRenderer.invoke('settings-get'),
  setAccent: (hex, followDock) => ipcRenderer.invoke('set-accent', String(hex), typeof followDock === 'boolean' ? followDock : undefined),
  forgetPedal: () => ipcRenderer.invoke('forget-pedal'),
  setDevTools: (on) => ipcRenderer.invoke('set-dev-tools', !!on),
  revealRecordings: () => ipcRenderer.invoke('reveal-recordings'),
  saveRecording: (name, json) => ipcRenderer.invoke('save-recording', String(name), String(json)),
  autoConnect: () => ipcRenderer.invoke('auto-connect'),
  openExternal: (url) => ipcRenderer.invoke('open-external', String(url)),
  onOpenSettings: (fn) => ipcRenderer.on('open-settings', () => fn()),
  // Bluetooth picker (src/bt-picker.js): announce a requestDevice() (sync, returns the scan mode 'nano' or 'all'),
  // answer the chooser, and say how connecting went ('ok' remembers the device).
  bluetoothRequest: (opts) => ipcRenderer.sendSync('bt-request', {
    want: opts && (opts.want === 'all' || opts.want === 'nano') ? opts.want : null,
    auto: !!(opts && opts.auto), choose: !!(opts && opts.choose), notice: opts && opts.notice === 'not-nano' ? 'not-nano' : '',
  }),
  bluetoothChoose: (choice) => ipcRenderer.invoke('bt-choose', String(choice)),
  bluetoothResult: (kind) => ipcRenderer.invoke('bt-result', String(kind)),
  onBluetoothChooser: (fn) => ipcRenderer.on('bt-chooser', (_e, view) => fn(view)),
  // Updates (src/updates.js): events for the modal, its answers, and Settings → Check for updates automatically.
  onUpdate: (fn) => ipcRenderer.on('update-event', (_e, ev) => fn(ev)),
  updateAction: (what, version) => ipcRenderer.invoke('update-action', String(what), String(version || '')),
  setAutoUpdate: (on) => ipcRenderer.invoke('set-auto-update', !!on),
});
