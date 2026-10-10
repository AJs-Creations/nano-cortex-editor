// Renders assets/icon.svg with the LED ring recoloured to an accent colour, the same way
// scripts/build-icon.js renders the app icon (an offscreen BrowserWindow), and caches the PNG per colour.
// Used by src/main.js for the Dock / window icon and by test/ux-test.js.
const { BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SVG = path.join(__dirname, '..', 'assets', 'icon.svg');
const DEFAULT_ACCENT = '#6954ff';

const normHex = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  return m ? '#' + m[1].toLowerCase() : null;
};
const rgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
// t > 0 mixes toward white, t < 0 toward black.
const mix = (hex, t) => toHex(rgb(hex).map(v => (t >= 0 ? v + (255 - v) * t : v * (1 + t))));

// The three LED gradient stops for an accent: a darker shade, the accent, a lighter shade.
// The default purple keeps the original hand-picked stops.
function ledStops(accent) {
  if (accent === DEFAULT_ACCENT) return ['#4b36e8', '#6954ff', '#9d8dff'];
  return [mix(accent, -0.28), accent, mix(accent, 0.38)];
}

function accentSvg(accent) {
  const [a, b, c] = ledStops(accent);
  const svg = fs.readFileSync(SVG, 'utf8');
  return svg.replace(/(<linearGradient id="led"[\s\S]*?<\/linearGradient>)/, (grad) => {
    let i = 0;
    return grad.replace(/stop-color="#[0-9a-fA-F]{6}"/g, (s) => 'stop-color="' + ([a, b, c][i++] || s) + '"');
  });
}

let chain = Promise.resolve();
// Returns the path of a 1024 px PNG for this accent, rendering it once into `dir`.
function renderAccentIcon(hex, dir) {
  const accent = normHex(hex) || DEFAULT_ACCENT;
  const file = path.join(dir, 'icon-' + accent.slice(1) + '.png');
  const job = chain.then(async () => {
    if (fs.existsSync(file)) return file;
    fs.mkdirSync(dir, { recursive: true });
    const win = new BrowserWindow({ show: false, width: 1024, height: 1024, transparent: true, frame: false, backgroundColor: '#00000000', webPreferences: { offscreen: true } });
    try {
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
        '<!doctype html><body style="margin:0;background:transparent">' + accentSvg(accent) + '</body>'));
      await new Promise(r => setTimeout(r, 300));
      let img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
      if (img.getSize().width !== 1024) img = img.resize({ width: 1024, height: 1024, quality: 'best' }); // Retina captures at 2x
      fs.writeFileSync(file, img.toPNG());
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
    return file;
  });
  chain = job.catch(() => {});
  return job;
}

module.exports = { renderAccentIcon, accentSvg, ledStops, normHex, DEFAULT_ACCENT };
