// Renders assets/icon.svg to build/icon.icns (and pro/assets/icon-512.png for
// the connect screen) with Electron's own renderer, so the icon is built from
// one source and never hand-edited.   npm run build:icon
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'assets', 'icon.svg'), 'utf8');
const iconset = path.join(root, 'build', 'icon.iconset');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1024, height: 1024, transparent: true, frame: false, backgroundColor: '#00000000', webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    '<!doctype html><body style="margin:0;background:transparent">' + svg + '</body>'));
  await new Promise(r => setTimeout(r, 300));
  const png1024 = (await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })).toPNG();
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset, { recursive: true });
  fs.mkdirSync(path.join(root, 'pro', 'assets'), { recursive: true });
  const master = path.join(iconset, 'icon_512x512@2x.png');
  fs.writeFileSync(master, png1024);
  // The capture is at the display's scale factor (2048 px on a Retina Mac); the master must be exactly 1024.
  execFileSync('sips', ['-z', '1024', '1024', master], { stdio: 'ignore' });
  // macOS iconset: 16..512 at 1x and 2x, resized from the 1024 master.
  for (const [size, name] of [[16, 'icon_16x16'], [32, 'icon_16x16@2x'], [32, 'icon_32x32'], [64, 'icon_32x32@2x'], [128, 'icon_128x128'], [256, 'icon_128x128@2x'], [256, 'icon_256x256'], [512, 'icon_256x256@2x'], [512, 'icon_512x512']]) {
    execFileSync('sips', ['-z', String(size), String(size), master, '--out', path.join(iconset, name + '.png')], { stdio: 'ignore' });
  }
  execFileSync('sips', ['-z', '512', '512', master, '--out', path.join(root, 'pro', 'assets', 'icon-512.png')], { stdio: 'ignore' });
  fs.copyFileSync(master, path.join(root, 'pro', 'assets', 'icon-1024.png'));
  fs.copyFileSync(master, path.join(root, 'build', 'icon.png')); // electron-builder derives the Windows .ico from this
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(root, 'build', 'icon.icns')]);
  fs.rmSync(iconset, { recursive: true, force: true });
  console.log('build/icon.icns, pro/assets/icon-512.png and icon-1024.png written');
  app.exit(0);
});
