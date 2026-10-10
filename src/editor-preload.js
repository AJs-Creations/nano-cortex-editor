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
});
