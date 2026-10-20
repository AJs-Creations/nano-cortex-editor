// UX test: drives the pro editor (demo data) with real mouse, wheel and
// keyboard input, checks UI state and the Bluetooth packets each action
// produces, and saves a screenshot per step to test-output/.
//   npm run test:ux            (macOS / Windows)
//   xvfb-run -a npm run test:ux   (Linux without a display)
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const PAGE = process.env.PAGE || path.join(__dirname, '..', 'pro', 'index.html');
const OUT = process.env.OUT || path.join(__dirname, '..', 'test-output');
const MOD = process.platform === 'darwin' ? 'meta' : 'control'; // ⌘ on Mac, Ctrl elsewhere
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const consoleErrors = [];
const LINKS = require('../pro/links');
const opened = [];   // outside links the page tried to open (handed to the window-open handler below, never shown)
let win, wc;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const js = (code) => wc.executeJavaScript(code);
const frame = () => js('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : ''));
}

// ---------------------------------------------------------------- waiting on conditions, not on the clock
// Every wait below returns as soon as its condition holds; the timeout only bounds a failure. GitHub's
// macOS VMs are several times slower than a desktop Mac and stall now and then, so the bound is generous.
const TIMEOUT = Number(process.env.UX_TIMEOUT) || 5000;
// Polls `cond` (an async function, or page JS as a string) until it is truthy; returns its last value.
async function waitFor(cond, { timeout = TIMEOUT, interval = 20 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await (typeof cond === 'string' ? js(cond) : cond());
    if (v) return v;
    if (Date.now() - t0 > timeout) { console.log('  … waited ' + timeout + ' ms in vain for: ' + String(cond).replace(/\s+/g, ' ').slice(0, 140)); return v; }
    await sleep(interval);
  }
}
// Waits until page JS `code` returns the same value twice, `gap` ms apart (a transition has finished).
async function stable(code, { gap = 100, timeout = TIMEOUT } = {}) {
  let prev = await js(code);
  for (const t0 = Date.now(); Date.now() - t0 < timeout;) {
    await sleep(gap);
    const v = await js(code);
    if (v === prev) return v;
    prev = v;
  }
  return prev;
}
// check() once `cond` holds (or the timeout passes). For conditions that become true after an async reply.
async function checkSoon(name, cond, detail) {
  const ok = await waitFor(cond);
  check(name, ok, typeof detail === 'function' ? await detail() : (detail || ''));
}

async function box(sel) {
  // Waits for the element (a popover or dialog may still be opening on a slow machine).
  const r = await waitFor(() => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({block:'nearest'}); const b = e.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2, w: b.width, h: b.height}; })()`));
  if (!r) throw new Error('No element for ' + sel);
  await frame();
  return r;
}
async function hitOk(sel, x, y) {
  return js(`(() => { const t = document.elementFromPoint(${x}, ${y}); const e = document.querySelector(${JSON.stringify(sel)}); return !!(t && e && (e === t || e.contains(t))); })()`);
}
async function click(sel, opts = {}) {
  const b = await box(sel);
  const x = Math.round(b.x + (opts.dx || 0)), y = Math.round(b.y + (opts.dy || 0));
  if (!opts.dx && !opts.dy && !(await hitOk(sel, x, y))) check('click target not obscured: ' + sel, false, 'something else is on top');
  wc.sendInputEvent({ type: 'mouseMove', x, y });
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: opts.count || 1 });
  wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: opts.count || 1 });
  await sleep(40); await frame();
}
async function rightClick(sel) {
  const b = await box(sel);
  const x = Math.round(b.x), y = Math.round(b.y);
  wc.sendInputEvent({ type: 'mouseMove', x, y });
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'right', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'right', clickCount: 1 });
  await sleep(60); await frame();
}
const ctxItem = (label) => `[...document.querySelectorAll(".ctx-item")].find(b => b.textContent.startsWith(${JSON.stringify(label)}))`;
async function dblclick(sel) {
  await click(sel, { count: 1 });
  await click(sel, { count: 2 });
}
async function drag(sel, dy, modifiers = []) {
  const b = await box(sel);
  const x = Math.round(b.x), y = Math.round(b.y);
  if (!(await hitOk(sel, x, y))) check('drag target not obscured: ' + sel, false, 'something else is on top');
  wc.sendInputEvent({ type: 'mouseMove', x, y });
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    wc.sendInputEvent({ type: 'mouseMove', x, y: Math.round(y - (dy * i) / steps), modifiers, button: 'left' });
    await sleep(12);
  }
  wc.sendInputEvent({ type: 'mouseUp', x, y: Math.round(y - dy), button: 'left', clickCount: 1 });
  await sleep(60); await frame();
}
async function wheel(sel, deltaY, n = 1) {
  const b = await box(sel);
  for (let i = 0; i < n; i++) {
    wc.sendInputEvent({ type: 'mouseWheel', x: Math.round(b.x), y: Math.round(b.y), deltaX: 0, deltaY, canScroll: true });
    await sleep(20);
  }
  await frame();
}
async function key(keyCode, modifiers = []) {
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  if (keyCode.length === 1 && !modifiers.includes(MOD)) wc.sendInputEvent({ type: 'char', keyCode, modifiers });
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await sleep(40); await frame();
}
async function type(text) {
  for (const ch of text) { wc.sendInputEvent({ type: 'char', keyCode: ch }); await sleep(8); }
  await frame();
}
async function shot(name) {
  await frame(); await sleep(120);
  const img = await wc.capturePage();
  fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
}
// Packets: the Activity log numbers every line (logSeq), so a mark survives the log's trim of old lines.
const txCount = () => js('__ui.logSeq');
const lastTx = () => js('(__ui.logs.filter(l => l.cls === "tx").slice(-1)[0] || {}).text || ""');
const txSince = async (n) => js(`__ui.logs.filter(l => l.cls === "tx" && l.seq > ${n}).map(l => l.text)`);
const lastTxSeq = () => js('(__ui.logs.filter(l => l.cls === "tx").slice(-1)[0] || { seq: 0 }).seq');
// The core's GATT write queue is empty and no FX parameter read is in flight.
const writesIdle = () => js('gattWriteQueue.length === 0 && !gattWritePumpRunning && !state.pendingParamBlock && !state.paramRefreshQueue.length');
// Waits until the writes have stopped: the queue is idle and no packet went out for `quiet` ms.
async function settle({ quiet = 350, timeout = TIMEOUT } = {}) {
  const t0 = Date.now();
  let last = await lastTxSeq(), since = Date.now();
  while (Date.now() - t0 < timeout) {
    await sleep(25);
    const n = await lastTxSeq();
    if (n !== last) { last = n; since = Date.now(); }
    else if (Date.now() - since >= quiet && await writesIdle()) return true;
  }
  console.log('  … writes did not settle within ' + timeout + ' ms');
  return false;
}
// A mark for txSince() taken once earlier writes have left (so they can't be counted as this step's).
async function mark(opts) { await settle(opts); return txCount(); }
// The packets sent since `n0`, once `ready(packets)` holds (by default: at least one was sent) and the
// writes have settled, so exact counts see every packet that is coming and nothing from the next step.
async function txWait(n0, ready = (tx) => tx.length > 0, opts) {
  await waitFor(async () => ready(await txSince(n0)), opts);
  await settle(opts);
  return txSince(n0);
}

// Reload the editor page (demo restarts) and wait until it has booted.
async function reloadPage() {
  const loaded = new Promise(r => wc.once('did-finish-load', r));
  wc.reload();
  await loaded; await waitFor('typeof __ui !== "undefined" && __ui.demo && state.connected'); await settle(); await frame();
}
// Computed colours come back as rgb(…) or, for color-mix(), as color(srgb r g b) in 0..1.
const rgbOf = (css) => {
  let m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(css || '');
  if (m) return [+m[1], +m[2], +m[3]];
  m = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(css || '');
  return m ? [m[1] * 255, m[2] * 255, m[3] * 255].map(Math.round) : null;
};

async function run() {
  // ---------------------------------------------------------------- boot
  await waitFor('typeof __ui !== "undefined" && __ui.demo && state.connected'); await settle();
  // Start like a fresh install (a previous run may have left an accent, a sound or a tempo behind).
  if (await js('Object.keys(localStorage).some(k => k.startsWith("settings.") || k === "metronome")')) {
    await js('Object.keys(localStorage).filter(k => k.startsWith("settings.") || k === "metronome").forEach(k => localStorage.removeItem(k))');
    await reloadPage();
  }
  check('a fresh install opens the metronome at 100 BPM', (await js('__metro.state.bpm')) === 100, String(await js('__metro.state.bpm')));
  check('demo starts automatically with ?demo', await js('__ui.demo && state.connected'));
  check('veil really hidden when connected', await js('getComputedStyle(document.getElementById("veil")).display === "none"'));
  check('header shows preset name', (await js('document.querySelector(".preset-title .name").textContent')) === 'JP2C Lead');
  check('8 chain nodes', (await js('document.querySelectorAll(".node").length')) === 8);
  check('chain nodes have gaps for the cable', await js(`(() => { const r = [...document.querySelectorAll('.node')].map(n => n.getBoundingClientRect()); return r.every((b, i) => i === 0 || b.left - r[i-1].right >= 16); })()`));
  const clipped = async () => js(`[...document.querySelectorAll('.node .stage, .node .sub')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent)`);
  check('no node label is truncated at 1400px', (await clipped()).length === 0, JSON.stringify(await clipped()));
  check('64 presets listed', (await js('document.querySelectorAll(".preset-row").length')) === 64);
  check('active preset row highlighted', (await js('document.querySelector(".preset-row.active .t").textContent')) === 'JP2C Lead');
  check('default inspector is Capture', (await js('document.querySelector(".insp-head h1").textContent')) === 'Capture');
  await shot('01-capture');

  // ---------------------------------------------------------------- developer tools: off by default
  // Settings → General → Advanced → Developer tools. Off (a fresh install): no Record, no Activity, no ⌘L, no
  // "Sent: …", no hashes or raw settings, and the shell's menu has no Classic Editor / Reload / Developer Tools.
  const shown = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.getClientRects().length > 0; })()`);
  const settingsUp = () => js('!!document.querySelector(".modal.settings-modal")');
  check('Developer tools are off on a fresh install', await js('!__devTools.on && !document.body.classList.contains("dev-tools") && localStorage.getItem("settings.devTools") === null'));
  check('dev tools off: no Record or Activity button in the status bar', !(await shown('#recBtn')) && !(await shown('#drawerBtn')) && await shown('#settingsBtn') && await shown('#keysBtn') && await shown('#supportBtn'));
  await js('document.activeElement.blur()');
  await key('l', [MOD]);
  check('dev tools off: ⌘L does nothing', await js('!__ui.drawerOpen && !document.getElementById("drawer").classList.contains("open")'));
  await js('document.getElementById("recBtn").click()');
  check('dev tools off: Record cannot be armed', await js('!__rec.on'));
  let dn = await mark();
  await dblclick('[data-fk="amp-gain"] svg');
  await txWait(dn);
  check('dev tools off: the log is still kept, the status bar shows no "Sent: …"', /^Sent: /.test(await js('__ui.lastAction')) && (await js('document.getElementById("lastAction").textContent')) === '' && (await txSince(dn)).length >= 1, await js('document.getElementById("lastAction").textContent'));
  await js('__ui.dirty = false; render(); document.activeElement.blur()'); await frame();
  await key('?'); await waitFor('!!document.querySelector(".modal .keys")');
  check('dev tools off: the shortcuts sheet has no ⌘L or Record row', await js('!!document.querySelector(".modal .keys") && ![...document.querySelectorAll(".modal .keys kbd")].some(k => /^(⌘|Ctrl\\+)L$/.test(k.textContent) || k.textContent === "Record")'));
  await key('Escape');
  await js('document.activeElement.blur()');
  await key(',', [MOD]); await waitFor(settingsUp);
  check('dev tools off: Settings → Advanced shows the switch, off, with its detail', await js('(() => { const b = document.querySelector(\'[data-fk="set-devtools"]\'); return !!b && b.textContent === "Developer tools" && b.getAttribute("aria-checked") === "false" && b.closest("section").querySelector("h3").textContent === "Advanced"; })()') && (await js('document.querySelector(\'[data-fk="set-devtools-note"]\').textContent')) === 'Shows the Activity log, session recording and protocol details. For troubleshooting and development.');
  check('dev tools off: no "Show the Activity drawer at launch" or recordings folder', !(await shown('[data-fk="set-drawer"]')) && !(await shown('[data-fk="set-reveal"]')));
  await click('[data-fk="set-tab-device"]');
  await waitFor(async () => (await js('document.querySelector(\'[data-fk="dev-serial"]\')?.textContent')) === 'NP00XXXXXX');
  check('dev tools off: Settings → Device has no Hash row and no Raw settings', !(await shown('[data-fk="dev-hash"]')) && !(await shown('[data-fk="dev-raw"]')) && await shown('[data-fk="dev-serial"]') && await shown('[data-fk="dev-brightness"]'));
  await key('Escape'); await waitFor(async () => !(await settingsUp())); await settle();
  await rightClick('[data-fk="capslot-1"]');
  await js(ctxItem('Info') + '.click()');
  await waitFor('!!document.querySelector(\'[data-fk="cap-author"]\')');
  check('dev tools off: capture Info… has no Hash line or Copy button', !(await shown('[data-fk="cap-hash"]')) && !(await shown('[data-fk="cap-copy"]')) && await shown('[data-fk="cap-author"]'));
  await key('Escape'); await waitFor('!document.querySelector(".cap-info")'); await settle();
  // the shell's menu (src/menu.js builds the template main.js uses)
  const { menuTemplate, menuLabels } = require('../src/menu');
  const menuFor = (devTools, isMac = true) => menuLabels(menuTemplate({ isMac, appName: 'Nano Cortex Editor', devTools, editorFlavor: 'pro', links: LINKS, a: new Proxy({}, { get: () => () => {} }) }));
  for (const mac of [true, false]) {
    const off = menuFor(false, mac), on = menuFor(true, mac);
    check('menu (' + (mac ? 'macOS' : 'Windows and Linux') + ', dev tools off): no Classic Editor, Reload Current or Developer Tools; Help → Show Log File', !off.includes('Classic Editor') && !off.includes('Reload Current') && !off.includes('Developer Tools') && off.includes('Show Log File'), off.join(','));
    check('menu (' + (mac ? 'macOS' : 'Windows and Linux') + ', dev tools on): Classic Editor, Reload Current and Developer Tools are back; Show Log File stays', on.includes('Classic Editor') && on.includes('Reload Current') && on.includes('Developer Tools') && on.includes('Show Log File'), on.join(','));
  }
  // the log file on disk (src/activity-log.js, written by main for everyone): batched, capped at 2 MB, one old file
  {
    const { createActivityLog, rotateIfNeeded, MAX_BYTES } = require('../src/activity-log');
    const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nano-log-'));
    const file = path.join(dir, 'activity.log');
    check('the log file cap is 2 MB', MAX_BYTES === 2 * 1024 * 1024);
    const lg = createActivityLog(file, { max: 4096, flushMs: 50 });
    lg.write('TX Amp gain = 128: 0A C0 08 01', new Date(0));
    check('log lines are batched, not written per line', !fs.existsSync(file));
    await lg.flush();
    check('the log file is written with timestamps', fs.readFileSync(file, 'utf8') === '1970-01-01T00:00:00.000Z TX Amp gain = 128: 0A C0 08 01\n', JSON.stringify(fs.readFileSync(file, 'utf8')));
    for (let round = 0; round < 7; round++) { for (let i = 0; i < 10; i++) lg.write('RX line ' + round + '.' + i + ' ' + 'x'.repeat(40)); await lg.flush(); }
    const files = fs.readdirSync(dir).sort();
    const size = (f) => fs.statSync(path.join(dir, f)).size;
    check('rotation keeps the current file under the cap and one old file', files.join(',') === 'activity.1.log,activity.log' && size('activity.log') <= 4096 && size('activity.1.log') > 4096, files.map(f => f + ':' + size(f)).join(','));
    check('the newest lines are in activity.log', /RX line 6\.9 /.test(fs.readFileSync(file, 'utf8')));
    fs.writeFileSync(file, 'y'.repeat(5000));
    check('rotateIfNeeded moves an oversized file to activity.1.log, replacing the old one', rotateIfNeeded(file, 4096) && !fs.existsSync(file) && size('activity.1.log') === 5000 && !rotateIfNeeded(file, 4096));
    lg.write('after rotation'); lg.flushSync();
    check('writing continues in a fresh activity.log', fs.readFileSync(file, 'utf8').endsWith(' after rotation\n'));
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ---------------------------------------------------------------- developer tools: on (once, with the real switch)
  await key(',', [MOD]); await waitFor(settingsUp);
  await click('[data-fk="set-devtools"]');
  check('the Developer tools switch is stored (settings.devTools)', (await js('localStorage.getItem("settings.devTools")')) === 'true' && await js('__devTools.on && document.body.classList.contains("dev-tools")'));
  check('dev tools on: the Activity-at-launch and recordings rows appear live in Settings', await shown('[data-fk="set-drawer"]') && await shown('[data-fk="set-reveal"]'));
  await click('[data-fk="set-tab-device"]');
  await waitFor(() => shown('[data-fk="dev-hash"]'));
  check('dev tools on: Settings → Device shows Hash and Raw settings', await shown('[data-fk="dev-hash"]') && await shown('[data-fk="dev-raw"]'));
  await key('Escape'); await waitFor(async () => !(await settingsUp())); await settle();
  check('dev tools on: Record and Activity are back in the status bar', await shown('#recBtn') && await shown('#drawerBtn'));
  check('dev tools on: the status bar shows the last "Sent: …"', /^Sent: /.test(await js('document.getElementById("lastAction").textContent')));

  // ---------------------------------------------------------------- capture amp knob
  // double-click reset (also puts Gain mid-travel for the drag tests)
  let n0 = await mark();
  await dblclick('[data-fk="amp-gain"] svg');
  check('double-click resets Gain to 50%', (await js('state.amp.gain')) === 128, String(await js('state.amp.gain')));
  check('reset is sent', (await txWait(n0, tx => tx.some(t => /Amp gain = 128/.test(t)))).some(t => /Amp gain = 128/.test(t)));
  await js('__ui.dirty = false; render()'); await frame();

  n0 = await mark();
  const gain0 = await js('state.amp.gain');
  await drag('[data-fk="amp-gain"] svg', 40);
  const gain1 = await js('state.amp.gain');
  check('dragging Gain up raises it', gain1 > gain0, gain0 + ' → ' + gain1);
  let tx = await txWait(n0);
  check('drag sends exactly one amp write on release', tx.length === 1 && /Amp gain/.test(tx[0]), JSON.stringify(tx));
  check('edit marks preset dirty', await js('!document.getElementById("dirtyMark").hidden && getComputedStyle(document.getElementById("dirtyMark")).display !== "none"'));
  check('Save button highlights when dirty', await js('document.getElementById("saveBtn").classList.contains("primary")'));

  // shift drag = fine
  const g2 = await js('state.amp.gain');
  await drag('[data-fk="amp-gain"] svg', 40, ['shift']);
  const g3 = await js('state.amp.gain');
  const coarse = gain1 - gain0, fine = g3 - g2;
  check('shift-drag moves ~10x less', fine > 0 && fine * 5 < coarse, `normal Δ${coarse}, fine Δ${fine}`);

  // tiny jitter (<2px) on mousedown is not treated as a drag
  n0 = await mark();
  await drag('[data-fk="amp-gain"] svg', 1);
  await settle();
  check('1px wobble is ignored (no write)', (await txSince(n0)).length === 0);

  // wheel: several ticks coalesce. The knob commits 160 ms after the last tick; the ticks go 20 ms apart,
  // so a desktop Mac sends exactly one write, but a CI VM that stalls for more than 160 ms between two ticks
  // legitimately commits twice. So: fewer writes than ticks, and the last write carries the final value.
  n0 = await mark();
  const v0 = await js('state.captureVolumeDb');
  await wheel('[data-fk="cap-vol"]', 100, 5); // +deltaY here = scroll up (verified)
  tx = await txWait(n0);
  const v1 = await js('state.captureVolumeDb');
  check('wheel up raises capture volume', v1 > v0, v0 + ' → ' + v1);
  check('5 wheel ticks → debounced writes (fewer than the ticks, the last one with the final value)', tx.length >= 1 && tx.length < 5 && tx.every(t => /Capture volume/.test(t)) && tx[tx.length - 1].includes('Capture volume ' + v1.toFixed(1) + ' dB'), v1 + ' ' + JSON.stringify(tx));

  // keyboard on knob
  await click('[data-fk="amp-bass"] .label');
  const b0 = await js('state.amp.bass');
  n0 = await mark();
  await key('Up'); await key('Up'); await key('Up', ['shift']);
  tx = await txWait(n0);
  const b1 = await js('state.amp.bass');
  check('arrow keys adjust focused knob', b1 > b0, b0 + ' → ' + b1);
  check('knob keeps focus after re-render', await js('document.activeElement && document.activeElement.dataset.fk === "amp-bass"'));
  check('arrow keys send a debounced write', tx.length >= 1);

  // type exact value
  await click('[data-fk="cap-vol"] .val');
  check('clicking value opens an input', await js('document.querySelector("[data-fk=cap-vol] input.val") !== null'));
  await key('a', [MOD]);
  await type('-6.5');
  n0 = await txCount();
  await key('Return');
  check('typed value applied', (await js('state.captureVolumeDb')) === -6.5, String(await js('state.captureVolumeDb')));
  check('typed value sent', (await txWait(n0, tx => tx.some(t => /Capture volume -6.5 dB/.test(t)))).some(t => /Capture volume -6.5 dB/.test(t)));
  check('value input closes after Enter', await js('document.querySelector("[data-fk=cap-vol] input.val") === null'));
  // escape cancels
  await click('[data-fk="cap-vol"] .val');
  await key('a', [MOD]); await type('9');
  await key('Escape');
  check('Escape cancels typed value', (await js('state.captureVolumeDb')) === -6.5);
  // out of range clamps
  await click('[data-fk="cap-vol"] .val');
  await key('a', [MOD]); await type('99'); await key('Return');
  check('out-of-range typed value clamps to max', (await js('state.captureVolumeDb')) === 12, await js('JSON.stringify({v: state.captureVolumeDb, ed: __ui.editing, ae: document.activeElement.outerHTML.slice(0,120)})'));

  // capture slot pick
  n0 = await mark();
  await click('[data-fk="capslot-5"]');
  tx = await txWait(n0, tx => tx.some(t => /capture change 5/.test(t)));
  check('clicking capture slot sends change', tx.some(t => /capture change 5/.test(t)), JSON.stringify(tx));
  await checkSoon('capture node shows new capture', async () => (await js('document.querySelector("[data-stage=capture] .model").textContent')) === 'VH4 Ch3');
  await shot('02-capture-edited');

  // ---------------------------------------------------------------- select stages
  await click('[data-stage="pre1"] .model');
  check('clicking node selects it', (await js('document.querySelector(".insp-head h1").textContent')) === 'Pre FX 1');
  check('selected node outlined', await js('document.querySelector("[data-stage=pre1]").classList.contains("selected")'));
  await shot('03-pre1');

  // keyboard stage nav from body
  await js('document.activeElement.blur()');
  await key('8');
  check('key 8 selects Post FX 3', (await js('__ui.selected')) === 'post3');
  await key('Left');
  check('← selects previous stage', (await js('__ui.selected')) === 'post2');
  await key('Right'); await key('Right');
  check('→ wraps to Gate', (await js('__ui.selected')) === 'gate');
  await key('4');

  // ---------------------------------------------------------------- FX param drag on post3
  await key('8');
  const firstKnob = await js('document.querySelector(".inspector .knob")?.dataset.fk');
  n0 = await mark();
  await drag(`[data-fk="${firstKnob}"] svg`, 40);
  tx = await txWait(n0);
  check('FX knob drag sends a param write', tx.length === 1 && /Post FX 3 param/.test(tx[0]), JSON.stringify(tx));

  // ---------------------------------------------------------------- model picker
  await js('document.activeElement.blur()');
  await key('m');
  check('M opens model picker', await js('!!document.querySelector(".pop")'));
  check('picker search is focused', await js('document.activeElement.classList.contains("search") && !!document.activeElement.closest(".pop")'));
  check('post3 picker offers reverbs, not delays', await js('[...document.querySelectorAll(".pop-item")].some(x => x.textContent === "Cave") && ![...document.querySelectorAll(".pop-item")].some(x => x.textContent === "Tape Delay")'));
  await type('cav');
  check('search filters list', (await js('document.querySelectorAll(".pop-item").length')) === 1);
  await shot('04-picker');
  n0 = await txCount();
  await key('Return');
  check('Enter picks model', (await js('state.blocks.post3.model')) === 'Cave');
  check('popover closes after pick', await js('!document.querySelector(".pop")'));
  tx = await txWait(n0, tx => tx.some(t => /Post FX 3 model select Cave/.test(t)));
  check('model change sent', tx.some(t => /Post FX 3 model select Cave/.test(t)), JSON.stringify(tx));
  check('inspector shows Cave params', (await js('[...document.querySelectorAll(".inspector .knob .label")].map(x=>x.textContent).join(",")')).includes('Decay'));
  // escape closes, no change
  await click('.picker-btn');
  await type('zzz');
  check('empty search shows message', await js('!!document.querySelector(".pop-none")'));
  await key('Escape');
  check('Escape closes picker without change', await js('!document.querySelector(".pop") && state.blocks.post3.model === "Cave"'));
  // click outside closes
  await click('.picker-btn');
  await click('.chain-wrap', { dy: -58 });   // the strip above the nodes: the middle of the row may be a node
  check('click outside closes picker', await js('!document.querySelector(".pop")'));
  // mouse pick
  await click('.picker-btn');
  check('picker opens on click', await js('!!document.querySelector(".pop")'));
  const third = await js('document.querySelectorAll(".pop-item")[2]?.textContent');
  await click('.pop-item[data-i="2"]');
  check('mouse click picks the clicked model', await js('!document.querySelector(".pop")') && (await js('state.blocks.post3.model')) === third, third + ' vs ' + await js('state.blocks.post3.model'));

  // ---------------------------------------------------------------- bypass
  await js('document.activeElement.blur()');
  const on0 = await js('state.blocks.post3.on');
  n0 = await mark();
  await key('b');
  check('B toggles bypass', (await js('state.blocks.post3.on')) === !on0);
  check('bypass sent', (await txWait(n0, tx => tx.some(t => /Post FX 3 (ON|OFF)/.test(t)))).some(t => /Post FX 3 (ON|OFF)/.test(t)));
  check('node LED reflects bypass', (await js('document.querySelector("[data-stage=post3] .stomp").classList.contains("on")')) === !on0);
  // stomp click on another node doesn't select it
  n0 = await mark();
  await click('[data-stage="pre1"] .stomp');
  tx = await txWait(n0, tx => tx.some(t => /Pre FX 1 (ON|OFF)/.test(t)));
  check('stomp click toggles without selecting', (await js('__ui.selected')) === 'post3' && tx.some(t => /Pre FX 1/.test(t)), JSON.stringify(tx));
  n0 = await mark();
  await click('[data-stage="pre1"] .stomp'); // put it back
  // Turning a block on reads its parameters back 250 ms later; let that read go out before the next step.
  await txWait(n0, tx => tx.some(t => /Pre FX 1 (ON|OFF)/.test(t)) && (!/Pre FX 1 ON/.test(tx.join()) || tx.some(t => /Pre FX 1 param refresh/.test(t))));
  // stomp on an empty slot: selects it and explains
  n0 = await mark();
  await click('[data-stage="post1"] .stomp');
  check('stomp on empty slot selects it', (await js('__ui.selected')) === 'post1');
  await settle();
  check('stomp on empty slot explains, sends nothing', (await js('document.getElementById("toast").textContent')).includes('Choose an effect') && (await txSince(n0)).length === 0, (await js('document.getElementById("toast").textContent')) + ' ' + JSON.stringify(await txSince(n0)));
  await key('8');
  // set a slot to None
  await key('2');
  await key('m'); await type('none'); await key('Return');
  check('choosing None empties the slot', await js('state.blocks.pre1.model === "None" && !state.blocks.pre1.on'), await js('state.blocks.pre1.model'));
  check('empty slot shows guidance', await js('!!document.querySelector(".empty-block")'));
  await key('b');
  check('cannot turn on an empty slot', await js('!state.blocks.pre1.on'));
  check('explains why via toast', (await js('document.getElementById("toast").textContent')).includes('Choose an effect'));
  await shot('05-empty-slot');

  // ---------------------------------------------------------------- sync-locked params (Tape Delay)
  await key('7');
  await key('m'); await type('tape'); await key('Return');
  const lockInfo = await js(`(() => {
    const knobs = [...document.querySelectorAll('.inspector .knob')];
    const t = knobs.find(k => k.querySelector('.label').textContent === 'Delay Time');
    const s = [...document.querySelectorAll('.inspector .choice, .inspector .knob')].find(k => k.querySelector('.label').textContent.startsWith('Sync Note'));
    return { time: t && t.classList.contains('locked'), note: s && s.classList.contains('locked') };
  })()`);
  check('Sync off: Delay Time free, Sync Note locked', lockInfo.time === false && lockInfo.note === true, JSON.stringify(lockInfo));
  await click('.inspector .choice .seg button:not(.on)');
  const lock2 = await js(`(() => {
    const t = [...document.querySelectorAll('.inspector .knob')].find(k => k.querySelector('.label').textContent === 'Delay Time');
    return t && t.classList.contains('locked');
  })()`);
  check('turning Sync on locks Delay Time', lock2 === true || lock2 === undefined, String(lock2));
  await shot('06-tape-delay');

  // ---------------------------------------------------------------- cab
  await key('5');
  check('Cab inspector', (await js('document.querySelector(".insp-head h1").textContent')) === 'Cab / IR');
  check('mic switch stays on one line', await js(`(() => { const b = [...document.querySelectorAll('[data-fk^="mic-"]')].map(x => x.getBoundingClientRect().top); return Math.max(...b) - Math.min(...b) < 2; })()`));
  check('position switch stays on one line', await js(`(() => { const b = [...document.querySelectorAll('[data-fk^="pos-"]')].map(x => x.getBoundingClientRect().top); return Math.max(...b) - Math.min(...b) < 2; })()`));
  n0 = await mark();
  const micNow = await js('state.cabIR.mic');
  const micNext = micNow === 'Condenser 414' ? 'Dynamic 57' : 'Condenser 414';
  await click(`[data-fk="mic-${micNext}"]`);
  tx = await txWait(n0, tx => tx.some(t => /^TX Cab mic\/position/.test(t)));
  check('mic click sends', tx.length >= 1 && (await js('state.cabIR.mic')) === micNext, micNow + ' → ' + await js('state.cabIR.mic'));
  check('mic packet carries the cab\'s library index (type 94)', tx.some(t => /^TX Cab mic\/position [^:]+: [0-9A-F]{2} C0 1A [0-9A-F]{2} 08 0[1-9] 12 .* 5E 00 00 00$/.test(t)), JSON.stringify(tx));
  n0 = await mark();
  await click(`[data-fk="mic-${micNext}"]`);
  await settle();
  check('clicking the current mic sends nothing', (await txSince(n0)).length === 0);
  const lp0 = await js('state.cabIR.lowPassHz');
  await drag('[data-fk="cab-lp"] svg', -30);
  const lp1 = await js('state.cabIR.lowPassHz');
  check('low pass drag (log scale) lowers cutoff sensibly', lp1 < lp0 && lp1 > 3000, lp0 + ' → ' + lp1);
  n0 = await mark();
  await click('[data-fk="irslot-4"]');
  check('IR slot click sends', (await txWait(n0, tx => tx.some(t => /Cab\/IR slot select 4/.test(t)))).some(t => /Cab\/IR slot select 4/.test(t)));
  await shot('07-cab');
  check('cab node subtitle not truncated', (await clipped()).length === 0, JSON.stringify(await clipped()));

  // ---------------------------------------------------------------- gate
  await key('1');
  check('Gate inspector', (await js('document.querySelector(".insp-head h1").textContent')) === 'Gate');
  n0 = await mark();
  await click('.inspector .switch');
  check('gate switch sends', (await txWait(n0, tx => tx.some(t => /Gate (ON|OFF)/.test(t)))).some(t => /Gate (ON|OFF)/.test(t)));
  await shot('08-gate');

  // ---------------------------------------------------------------- preset switching with unsaved changes
  const p0 = await js('state.selectedPreset');
  await key('Down', [MOD]);
  check('dirty + next preset asks first', await js('!!document.querySelector(".modal")'));
  await shot('09-unsaved-modal');
  await key('Escape');
  check('Escape keeps current preset', (await js('state.selectedPreset')) === p0 && await js('!document.querySelector(".modal")'));
  await key('Down', [MOD]);
  await click('.modal .btn:nth-of-type(2)'); // Don't save
  await checkSoon('Don’t save switches preset', async () => (await js('state.selectedPreset')) === p0 + 1);
  await checkSoon('dirty cleared after switch', 'document.getElementById("dirtyMark").hidden');
  await checkSoon('header follows preset', async () => (await js('document.querySelector(".preset-title .name").textContent')) === 'Jubilee Crunch');
  await settle();
  // discarded edits don't stick
  await key('Up', [MOD]);
  await checkSoon('discarded edits are gone when returning', async () => (await js('state.selectedPreset')) === p0 && (await js('state.blocks.post3.model')) === 'Hall', () => js('state.blocks.post3.model'));
  await settle();

  // Discard: throw away the live edits and reload the current preset as saved on the pedal
  await js('document.activeElement.blur()');
  const discardPreset = await js('state.selectedPreset');
  check('Discard hidden when there is nothing to discard', await js('document.getElementById("discardBtn").hidden'));
  await key('4');
  const gainSaved = await js('state.amp.gain');
  await drag('[data-fk="amp-gain"] svg', 30);
  const gainEdited = await js('state.amp.gain');
  check('Discard appears once the preset is edited', gainEdited !== gainSaved && await js('!document.getElementById("discardBtn").hidden'), gainSaved + ' → ' + gainEdited);
  await shot('09b-discard');
  check('Discard is an outlined secondary button, not the accent', await js('(() => { const b = document.getElementById("discardBtn"); return b.classList.contains("outline") && !b.classList.contains("primary") && b.nextElementSibling.id === "saveBtn"; })()'));
  await rightClick(`.preset-row[data-n="${discardPreset}"]`);
  check('current preset menu offers Discard edits', await js('(() => { const b = [...document.querySelectorAll(".ctx-item")].find(x => x.textContent === "Discard edits"); return !!b && !b.disabled; })()'));
  await key('Escape');
  n0 = await mark();
  await click('#discardBtn');
  check('Discard asks first', await js('(document.querySelector(".modal h2") || {}).textContent') === 'Discard edits to ' + await js('document.querySelector(".preset-title .name").textContent') + '?');
  await key('Escape');
  await settle();
  check('Escape keeps the edits', await js('!document.querySelector(".modal")') && (await js('state.amp.gain')) === gainEdited && (await txSince(n0)).length === 0);
  await click('#discardBtn');
  await click('.modal .btn.primary');
  tx = await txWait(n0, tx => tx.some(t => /^TX Preset change \d+:/.test(t)));
  const discardTx = tx.filter(t => /^TX Preset change \d+:/.test(t));
  check('Discard reloads the current preset (one preset change)', discardTx.length === 1 && discardTx[0].startsWith('TX Preset change ' + discardPreset + ':'), JSON.stringify(tx));
  await checkSoon('Discard restores the saved values', async () => (await js('state.amp.gain')) === gainSaved && (await js('state.selectedPreset')) === discardPreset, async () => gainSaved + ' vs ' + await js('state.amp.gain'));
  await checkSoon('Discard clears dirty and hides itself', 'document.getElementById("dirtyMark").hidden && document.getElementById("discardBtn").hidden');
  await checkSoon('Discard confirms with toast', async () => (await js('document.getElementById("toast").textContent')) === 'Edits discarded; preset ' + discardPreset + ' reloaded');
  await rightClick(`.preset-row[data-n="${discardPreset}"]`);
  check('Discard edits is disabled in the menu when clean', await js('(() => { const b = [...document.querySelectorAll(".ctx-item")].find(x => x.textContent === "Discard edits"); return !!b && b.disabled; })()'));
  await key('Escape');

  // save flow
  await js('document.activeElement.blur()');
  await key('4');
  await drag('[data-fk="amp-gain"] svg', 30);
  n0 = await mark();
  await key('s', [MOD]);
  // the save waits for the pedal's state read-back (150 ms + reply)
  check('Ctrl/⌘S saves', (await txWait(n0, tx => tx.some(t => /save preset/.test(t)))).some(t => /save preset/.test(t)));
  await checkSoon('save clears dirty', 'document.getElementById("dirtyMark").hidden');
  await checkSoon('save confirms with toast', async () => (await js('document.getElementById("toast").textContent')).startsWith('Saved to preset'));
  const savedGain = await js('state.amp.gain');
  const savedPreset = await js('state.selectedPreset');
  await key('Down', [MOD]);
  check('no prompt after saving', await js('!document.querySelector(".modal")'));
  await waitFor(async () => (await js('state.selectedPreset')) === savedPreset + 1); await settle();
  await key('Up', [MOD]);
  await checkSoon('saved edits persist (demo)', async () => (await js('state.selectedPreset')) === savedPreset && (await js('state.amp.gain')) === savedGain);
  await settle();

  // save as (another slot): the chosen slot gets the write, the app switches to it, the source is untouched
  const fromPreset = await js('state.selectedPreset');
  await drag('[data-fk="amp-gain"] svg', 15);
  const liveGain = await js('state.amp.gain');
  n0 = await mark();
  await key('s', [MOD, 'shift']);
  check('⇧⌘S opens Save as', await js('!!document.querySelector(".modal .slots.presets")'));
  await shot('09b-save-as');
  check('Save as suggests an empty slot', await js('document.querySelector(".modal .slot.on .t").classList.contains("empty")'));
  await js('document.querySelector(".modal input").value = "Copy Test"');
  await click('[data-fk="saveas-30"]');
  check('picking a used slot is allowed, an empty one shows no warning', await js('document.querySelector(".modal p.warn").textContent') === '');
  await click('.modal .btn.primary');
  check('Save as writes the chosen slot', (await txWait(n0, tx => tx.some(t => /save preset 30/.test(t)))).some(t => /save preset 30/.test(t)));
  await checkSoon('Save as switches to the copy', async () => (await js('state.selectedPreset')) === 30);
  await checkSoon('Save as names the copy', async () => (await js('state.presetNames.get(30)')) === 'Copy Test');
  await checkSoon('the copy carries the live edit', async () => (await js('state.amp.gain')) === liveGain);
  await checkSoon('Save as leaves no dirty mark', 'document.getElementById("dirtyMark").hidden');
  await settle();
  await js(`document.querySelector('.preset-row[data-n="${fromPreset}"]').scrollIntoView({ block: 'center' })`); await frame();
  await click(`.preset-row[data-n="${fromPreset}"]`);
  await checkSoon('the source preset is back to its saved state', async () => (await js('state.selectedPreset')) === fromPreset && (await js('state.amp.gain')) === savedGain, async () => `preset ${await js('state.selectedPreset')} gain ${await js('state.amp.gain')} vs ${savedGain}`);
  await settle();

  // save-and-switch
  await drag('[data-fk="amp-mid"] svg', 20);
  const midBefore = await js('state.amp.mid');
  check('knob keeps focus after drag', await js('document.activeElement?.dataset.fk === "amp-mid"'));
  await key('Down', [MOD]);
  check('⌘↓ with a knob focused goes to the app, not the knob', await js('!!document.querySelector(".modal")') && (await js('state.amp.mid')) === midBefore);
  n0 = await txCount();
  await key('Return'); // primary = Save and switch
  await txWait(n0, tx => tx.some(t => /save preset/.test(t)));
  await checkSoon('Enter in modal = Save and switch', async () => (await txSince(n0)).some(t => /save preset/.test(t)) && (await js('state.selectedPreset')) === 3);
  await settle();

  // ---------------------------------------------------------------- context menus
  await rightClick('.preset-row[data-n="5"]');
  check('right-click on a preset row opens a menu', await js('!!document.querySelector(".ctx")'));
  check('preset menu has Load, Rename and Save here', await js('[...document.querySelectorAll(".ctx-item")].map(b => b.textContent).join("|")') === 'Load|Rename…|Save current sound over this preset…|Assign to footswitch IA|Assign to footswitch IB|Assign to footswitch IIA|Assign to footswitch IIB|Delete…');
  await key('Escape');
  check('Esc closes the menu', await js('!document.querySelector(".ctx")'));
  await rightClick('.preset-row[data-n="25"]');
  await js(ctxItem('Save current sound here') + '.click()');
  await checkSoon('"Save current sound here…" opens Save as on that slot', async () => (await js('document.querySelector(".modal .slot.on .n")?.textContent')) === '25');
  await key('Escape'); await waitFor('!document.querySelector(".modal")');
  await rightClick('[data-fk="node-pre1"]');
  const nodeMenuText = await js('[...document.querySelectorAll(".ctx-item")].map(b => b.textContent).join("|")');
  const wasOn = await js('state.blocks.pre1.on');
  check('node menu offers Bypass/Enable, Change effect, Clear slot', nodeMenuText === (wasOn ? 'Bypass' : 'Enable') + '|Change effect…|Clear slot', JSON.stringify(nodeMenuText));
  n0 = await mark();
  await js(ctxItem(wasOn ? 'Bypass' : 'Enable') + '.click()');
  tx = await txWait(n0, tx => tx.some(t => /Pre FX 1 (ON|OFF)/.test(t)));
  check('node menu toggles the block and sends the enable write', tx.length >= 1 && (await js('state.blocks.pre1.on')) === !wasOn, JSON.stringify(tx));
  await rightClick('[data-fk="node-pre1"]');
  n0 = await txCount();
  await js(ctxItem(wasOn ? 'Enable' : 'Bypass') + '.click()');
  await checkSoon('node menu toggles it back', async () => (await js('state.blocks.pre1.on')) === wasOn);
  await txWait(n0, tx => tx.some(t => /Pre FX 1 (ON|OFF)/.test(t)) && (!/Pre FX 1 ON/.test(tx.join()) || tx.some(t => /Pre FX 1 param refresh/.test(t))));
  await click('[data-fk="node-capture"]'); await waitFor('document.querySelector(".insp-head h1")?.textContent === "Capture"');
  await rightClick('[data-fk="capslot-7"]');
  const slotMenuText = await js('[...document.querySelectorAll(".ctx-item")].map(b => b.textContent).join("|")');
  check('slot menu offers Load, Put a library capture and Info', slotMenuText === 'Load into this preset|Put a library capture in slot 7…|Info…', JSON.stringify(slotMenuText) + ' slot7=' + await js('!!document.querySelector(\'[data-fk="capslot-7"]\')'));
  await js(ctxItem('Put a library capture') + '?.click()');
  await checkSoon('"Put a library capture in slot 7…" opens the library picker', '!!document.querySelector(".pop") && document.querySelectorAll(".pop-item").length > 0', async () => 'pop=' + await js('!!document.querySelector(".pop")') + ' items=' + await js('document.querySelectorAll(".pop-item").length'));
  const libPick = await js('(() => { const it = [...document.querySelectorAll(".pop-item")].find(x => !x.classList.contains("cur")); if (!it) return ""; const name = (it.querySelector(".name") || it).textContent.replace(/Current$/, "").trim(); it.click(); return name; })()');
  await checkSoon('the picked capture lands in slot 7 without the slot chooser', async () => libPick !== '' && (await js('state.captureNames.get(7)')) === libPick && await js('!document.querySelector(".modal")'), async () => 'picked=' + JSON.stringify(libPick) + ' slot7=' + await js('state.captureNames.get(7)') + ' modal=' + await js('!!document.querySelector(".modal")'));
  await settle();
  await js('__closePopover(); __ui.slotPreselect = 0'); await key('Escape');
  await key('s', [MOD]); await waitFor('!__ui.dirty'); await settle();   // the slot load marked the preset dirty; save so the list tests start clean
  // delete a preset (type 50 → 51), from the row menu, confirmed in a dialog
  await rightClick('.preset-row[data-n="24"]');
  await js(ctxItem('Delete') + '?.click()');
  await checkSoon('Delete… asks first', async () => (await js('document.querySelector(".modal h2")?.textContent') || '').startsWith('Delete preset 24'));
  n0 = await txCount();
  await click('.modal .btn.primary');
  tx = await txWait(n0, tx => tx.some(t => /^TX Delete preset 24:/.test(t)));
  check('delete sends type 50 for that slot', tx.some(t => /^TX Delete preset 24: 08 C0 08 02 18 17 32 00 00 00$/.test(t)), JSON.stringify(tx));
  await checkSoon('the slot reads Empty afterwards', async () => (await js('state.presetNames.get(24)')) === 'Empty' && await js('document.querySelector(\'.preset-row[data-n="24"]\').classList.contains("empty")'));
  await rightClick('.preset-row[data-n="24"]');
  check('Delete… is disabled on an empty slot', await js(ctxItem('Delete') + '?.disabled === true'));
  await key('Escape');
  check('no overlay left behind by the menus', await js('!document.querySelector(".ctx-bg, .pop, .modal-bg")'), 'left: ' + await js('[...document.querySelectorAll(".ctx-bg, .pop, .modal-bg")].map(e => e.className).join(",")') + ' top@row10: ' + await js('(() => { const r = document.querySelector(\'.preset-row[data-n="10"]\').getBoundingClientRect(); const e = document.elementFromPoint(r.x + 5, r.y + 5); return e ? e.className + "/" + e.tagName : "none"; })()'));

  // ---------------------------------------------------------------- footswitches (4-Preset mode slots IA IB IIA IIB)
  // Assigning = type 29 with field 4 = -1, the slot's field (5-8) = preset index, the rest -1, field 9 = 0
  // (docs/INVESTIGATION.md §8). The expected bytes are built from that pattern; IA = 14 is the trace's frame verbatim.
  const NEG1 = 'FF FF FF FF FF FF FF FF FF 01';
  const fsHex = (slotField, idx) => ['36 C0 18 00 20', NEG1, ...[5, 6, 7, 8].map(f => (f * 8).toString(16).toUpperCase() + ' ' + (f === slotField ? idx.toString(16).toUpperCase().padStart(2, '0') : NEG1)), '48 00 1D 00 00 00'].join(' ');
  check('assignment frame for IA = preset index 14 equals the phone app\'s bytes', (await js('hex(__footswitchFrame("a1", 14))')) === '36 C0 18 00 20 ' + NEG1 + ' 28 0E 30 ' + NEG1 + ' 38 ' + NEG1 + ' 40 ' + NEG1 + ' 48 00 1D 00 00 00' && (await js('hex(__footswitchFrame("b1", 0))')) === fsHex(6, 0), await js('hex(__footswitchFrame("a1", 14))'));
  await js('__ui.dirty = false; state.presetDirty = false; render()'); await frame();
  const fsCells = () => js('[...document.querySelectorAll(".fs-cell")].map(c => [...c.children].map(x => x.textContent).join(" ")).join("|")');
  const pn = async (n) => js('state.presetNames.get(' + n + ')');
  check('footswitch strip shows IA, IB, IIA, IIB with the demo presets', (await fsCells()) === ['IA 1 ' + await pn(1), 'IB 3 ' + await pn(3), 'IIA 7 ' + await pn(7), 'IIB 15 ' + await pn(15)].join('|'), await fsCells());
  check('footswitch cells sit in a 2 × 2 grid (I on top, II below, 6 px / 8 px gaps, ~44 px tall)', await js(`(() => { const r = [...document.querySelectorAll('.fs-cell')].map(c => c.getBoundingClientRect()); return r.length === 4 && r[0].top === r[1].top && r[2].top === r[3].top && r[2].top > r[0].bottom - 1 && r[1].left > r[0].right - 1 && r[2].top - r[0].bottom === 8 && r[1].left - r[0].right === 6 && r.every(b => b.height >= 42 && b.height <= 46); })()`));
  check('footswitch cells are two lines (label and number, then the name) and names like "Princeton Clean" fit untruncated', await js(`[...document.querySelectorAll('.fs-cell')].every(c => { const k = c.querySelector('.k').getBoundingClientRect(), n = c.querySelector('.n').getBoundingClientRect(), t = c.querySelector('.t'); return Math.abs(k.top - n.top) < 2 && n.left >= k.right - 0.5 && t.getBoundingClientRect().top >= k.bottom - 1 && (c.dataset.fk === 'fs-b2' || t.scrollWidth <= t.clientWidth); })`), await js(`[...document.querySelectorAll('.fs-cell .t')].map(t => t.textContent + ':' + t.scrollWidth + '/' + t.clientWidth).join(' ')`));
  n0 = await mark();
  await click('[data-fk="fs-a2"]');
  tx = (await txWait(n0, tx => tx.some(t => /^TX Preset change \d+:/.test(t)))).filter(t => /^TX Preset change \d+:/.test(t));
  await waitFor(async () => (await js('state.selectedPreset')) === 7);
  check('clicking footswitch IIA loads preset 7 (one preset change, slot byte 9:2)', tx.length === 1 && /^TX Preset change 7: .* 48 02 1D 00 00 00$/.test(tx[0]) && (await js('state.selectedPreset')) === 7, JSON.stringify(tx));
  await checkSoon('the current preset\'s footswitch cell is highlighted', async () => (await js('[...document.querySelectorAll(".fs-cell.active")].map(c => c.dataset.fk).join()')) === 'fs-a2');
  await rightClick('[data-fk="fs-b2"]');
  check('footswitch menu offers Assign current preset and Assign…', (await js('[...document.querySelectorAll(".ctx-item")].map(b => b.textContent).join("|")')) === 'Assign current preset|Assign…');
  n0 = await mark();
  await js(ctxItem('Assign current preset') + '.click()');
  tx = (await txWait(n0, tx => tx.some(t => /^TX Assign/.test(t)))).filter(t => /^TX Assign/.test(t));   // the core follows the type-31 notice with a state read, like the app
  check('"Assign current preset" on IIB sends exactly the assignment frame', tx.length === 1 && tx[0] === 'TX Assign preset 7 to footswitch IIB: ' + fsHex(8, 6), JSON.stringify(tx));
  await checkSoon('IIB then shows preset 7, highlighted with IIA', async () => (await js('[...document.querySelector(\'[data-fk="fs-b2"]\').children].map(x => x.textContent).join(" ")')) === 'IIB 7 ' + await pn(7) && (await js('document.querySelectorAll(".fs-cell.active").length')) === 2 && (await js('document.getElementById("toast").textContent')) === 'Preset 7 on footswitch IIB' && await js('__ui.logs.some(l => l.text === "Assigned preset 7 to footswitch IIB")'));
  check('(demo) the next state dump reports IIB = preset index 6', (await js('(() => { const f = parseProtoFields(Array.from(__demo.stateDump()).slice(2, -4)); return f[39] && f[39][0].value; })()')) === 6);
  await shot('xx-footswitches');
  await rightClick('.preset-row[data-n="7"]');
  check('preset-row menu: "Assign to footswitch" is disabled for slots already holding the preset', await js(ctxItem('Assign to footswitch IIA') + '.disabled && ' + ctxItem('Assign to footswitch IIB') + '.disabled && !' + ctxItem('Assign to footswitch IA') + '.disabled'));
  await key('Escape');
  await rightClick('[data-fk="fs-a1"]');
  await js(ctxItem('Assign…') + '.click()'); await waitFor('document.querySelectorAll(".pop .pop-item").length > 0');
  check('"Assign…" opens a preset picker, non-empty presets first', await js('(() => { const g = [...document.querySelectorAll(".pop .pop-group")].map(x => x.textContent); return document.querySelectorAll(".pop .pop-item").length === 64 && g[0] === "Presets" && g[1] === "Empty slots"; })()'), await js('[...document.querySelectorAll(".pop .pop-group")].map(x => x.textContent).join()'));
  n0 = await mark();
  await js('[...document.querySelectorAll(".pop .pop-item")].find(x => x.textContent.startsWith("15 ")).click()');
  tx = (await txWait(n0, tx => tx.some(t => /^TX Assign/.test(t)))).filter(t => /^TX Assign/.test(t));
  await waitFor(async () => (await js('state.presetSlots.a1')) === 14);
  check('picking preset 15 for IA sends the phone app\'s frame byte for byte', tx.length === 1 && tx[0] === 'TX Assign preset 15 to footswitch IA: 36 C0 18 00 20 ' + NEG1 + ' 28 0E 30 ' + NEG1 + ' 38 ' + NEG1 + ' 40 ' + NEG1 + ' 48 00 1D 00 00 00' && (await js('state.presetSlots.a1')) === 14, JSON.stringify(tx));
  await js('state.presetSlots = { ...state.presetSlots, b2: 20 }; render()'); await frame();   // stale on purpose
  n0 = await mark();
  await click('[data-fk="fs-a1"]');
  tx = (await txWait(n0, tx => tx.some(t => /^TX Preset change \d+:/.test(t)))).filter(t => /^TX Preset change \d+:/.test(t));
  await waitFor(async () => (await js('state.selectedPreset')) === 15 && (await js('state.presetSlots.b2')) === 6 && (await js('[...document.querySelectorAll(".fs-cell.active")].map(c => c.dataset.fk).join()')) === 'fs-a1');
  check('a preset switch re-reads the slots from the (demo) state dump', (await js('state.selectedPreset')) === 15 && tx.length === 1 && / 48 00 1D 00 00 00$/.test(tx[0]) && (await js('state.presetSlots.b2')) === 6 && (await js('[...document.querySelectorAll(".fs-cell.active")].map(c => c.dataset.fk).join()')) === 'fs-a1', JSON.stringify(tx) + ' ' + JSON.stringify(await js('state.presetSlots')));

  // an assignment drops unsaved edits on the pedal, so it asks first like a preset switch
  await js('__ui.dirty = true; render()'); await frame();
  await rightClick('[data-fk="fs-b1"]');
  await js(ctxItem('Assign current preset') + '.click()'); await waitFor('!!document.querySelector(".modal h2")');
  check('assigning with unsaved edits asks first (Save changes to …?)', (await js('document.querySelector(".modal h2")?.textContent') || '').startsWith('Save changes to ') && (await js('[...document.querySelectorAll(".modal button")].map(b => b.textContent).join("|")')) === 'Cancel|Don’t save|Save and assign', await js('[...document.querySelectorAll(".modal button")].map(b => b.textContent).join("|")'));
  n0 = await mark();
  await key('Escape'); await settle();
  check('Escape cancels: nothing sent, edits kept', (await txSince(n0)).length === 0 && await js('!document.querySelector(".modal") && __ui.dirty === true') && (await js('state.presetSlots.b1')) === 2, JSON.stringify(await txSince(n0)));
  await rightClick('[data-fk="fs-b1"]');
  await js(ctxItem('Assign current preset') + '.click()'); await waitFor('!!document.querySelector(".modal button")');
  n0 = await mark();
  await js('[...document.querySelectorAll(".modal button")].find(b => b.textContent === "Don’t save").click()');
  tx = (await txWait(n0, tx => tx.some(t => /^TX Assign/.test(t)))).filter(t => /^TX /.test(t) && !/state request|Expression assignments request/.test(t));
  await waitFor(async () => (await js('__ui.dirty')) === false && (await js('state.presetSlots.b1')) === 14);
  check('"Don’t save" sends just the assignment and clears the edits', tx.length === 1 && tx[0] === 'TX Assign preset 15 to footswitch IB: ' + fsHex(6, 14) && (await js('__ui.dirty')) === false && (await js('state.presetSlots.b1')) === 14, JSON.stringify(tx));

  // ---------------------------------------------------------------- preset list
  await click('.preset-row[data-n="7"]');
  await checkSoon('click preset row loads it', async () => (await js('state.selectedPreset')) === 7);
  await settle();
  await key('f', [MOD]);
  check('Ctrl/⌘F focuses filter', await js('document.activeElement.id === "presetFilter"'));
  await type('surf');
  check('filter narrows list', (await js('document.querySelectorAll(".preset-row").length')) >= 1 && (await js('[...document.querySelectorAll(".preset-row .t")].every(x => /surf/i.test(x.textContent))')));
  await js('{ const f=document.getElementById("presetFilter"); f.value=""; f.dispatchEvent(new Event("input")); }');
  await type('qqq');
  check('no-match message', await js('!!document.querySelector(".side-empty")'));
  await js('{ const f=document.getElementById("presetFilter"); f.value=""; f.dispatchEvent(new Event("input")); }');
  // keyboard in list
  await click('.preset-row[data-n="10"]'); await waitFor(async () => (await js('state.selectedPreset')) === 10); await settle();
  await key('Down'); await key('Down');
  await checkSoon('arrow keys in list step through presets (debounced)', async () => (await js('state.selectedPreset')) === 12, () => js('String(state.selectedPreset)'));
  await settle();
  const writesForPresets = (await js('__ui.logs.filter(l=>/external preset change ack|Current preset state request/.test(l.text)).length'));
  check('preset list keeps focus', await js('document.activeElement.id === "presetList"'));

  // ---------------------------------------------------------------- preset switching over Bluetooth
  n0 = await mark();
  await click('.preset-row[data-n="5"]');
  await checkSoon('preset click switches over Bluetooth', async () => (await js('state.selectedPreset')) === 5);
  tx = await txWait(n0, tx => tx.some(t => /^TX Preset change 5:/.test(t)));
  check('preset change packet sent (SetPresetSlotsRequest, type 29)', tx.some(t => /^TX Preset change 5: .*1D 00 00 00$/.test(t)), JSON.stringify(tx));
  check('status bar names the pedal and firmware, nothing redundant', (await js('document.getElementById("bleText").textContent')) === 'Demo data, nothing is sent' && await js('document.getElementById("pcText").parentElement.hidden'));
  check('one connection indicator: none in the header, the status bar LED is on', await js('!document.querySelector(".head .led, #conn, #status, #dot") && document.getElementById("bleLed").className === "led on"'));
  await js('state.presetDirty = true; render()'); await frame();
  check('pedal-reported unsaved changes show in the status bar', await js('!document.getElementById("pcText").parentElement.hidden && /unsaved/.test(document.getElementById("pcText").textContent)'));
  await js('state.presetDirty = false; render()'); await frame();
  await checkSoon('(demo) pedal confirms the preset change', '__ui.logs.some(l => /Preset change confirmed/.test(l.text))');

  // ---------------------------------------------------------------- rename
  const oldName = await js('state.presetNames.get(state.selectedPreset)');
  await click('#renameBtn');
  check('Rename opens a dialog with the current name', (await js('document.querySelector(".modal input")?.value')) === oldName, String(await js('document.querySelector(".modal input")?.value')));
  n0 = await txCount();
  await type('Big Lead 5'); await key('Return');
  tx = await txWait(n0, tx => tx.some(t => /^TX Rename preset/.test(t)));
  check('rename sends RenamePresetRequest (type 111)', tx.some(t => /^TX Rename preset 5 to "Big Lead 5": .*6F 00 00 00$/.test(t)), JSON.stringify(tx));
  await checkSoon('header shows the new name', async () => (await js('document.querySelector(".preset-title .name").textContent')) === 'Big Lead 5');
  await checkSoon('preset list shows the new name', async () => (await js('document.querySelector(".preset-row.active .t").textContent')) === 'Big Lead 5');
  await click('#renameBtn'); await type('abc'); await key('Return');
  await checkSoon('too-short name is refused', async () => (await js('document.getElementById("toast").textContent')).includes('4 characters') && (await js('state.presetNames.get(5)')) === 'Big Lead 5');

  // ---------------------------------------------------------------- tuner
  await js('document.activeElement.blur()');
  n0 = await mark();
  await key('t');
  await checkSoon('T opens the tuner', '!document.getElementById("tunerOverlay").hidden && state.tuner.open');
  tx = await txWait(n0, tx => tx.some(t => /^TX Tuner on/.test(t)));
  check('tuner on packet sent (type 127)', tx.some(t => /^TX Tuner on \(440 Hz\): .*7F 00 00 00$/.test(t)), JSON.stringify(tx));
  await checkSoon('tuner shows a reading (demo)', async () => (await js('document.getElementById("tunerNote").textContent')) === 'E');
  await click('#tunerMute');
  check('mute resends the tuner settings', (await txWait(n0, tx => tx.some(t => /^TX Tuner settings \(440 Hz, muted\)/.test(t)))).some(t => /^TX Tuner settings \(440 Hz, muted\)/.test(t)));
  await key('5'); await frame();
  check('stage shortcuts are off while the tuner is up', (await js('__ui.selected')) !== 'cab');
  n0 = await txCount();
  await key('Escape');
  await checkSoon('Escape closes the tuner', 'document.getElementById("tunerOverlay").hidden && !state.tuner.open');
  check('tuner off packet sent', (await txWait(n0, tx => tx.some(t => /^TX Tuner off: /.test(t)))).some(t => /^TX Tuner off: /.test(t)));
  await click('#tunerBtn');
  await checkSoon('Tuner button opens the tuner and lights up', 'state.tuner.open && document.getElementById("tunerBtn").classList.contains("on")');
  await click('#tunerClose');
  await checkSoon('Close button ends the tuner and the Tuner button un-lights', '!state.tuner.open && !document.getElementById("tunerBtn").classList.contains("on")');
  await settle();

  // ---------------------------------------------------------------- metronome
  await js('document.activeElement.blur()');
  await key('n');
  await checkSoon('N opens the metronome', '!document.getElementById("metroOverlay").hidden && __metro.state.open');
  await js('__metro.setBpm(240)');
  await key(' '); await sleep(1600);
  const beats = await js('__metro.state.count');
  check('Space starts it and beats advance (240 BPM, ~1.6 s, audio start-up tolerated)', (await js('__metro.state.running')) && beats >= 3 && beats <= 8, String(beats));
  check('beat indicator follows the count', await js('document.querySelectorAll("#metroBeats span").length === 4 && !!document.querySelector("#metroBeats span.on")'));
  await key(' ');
  await checkSoon('Space stops it', '!__metro.state.running');
  await js('__metro.state.taps = [2000, 1500, 1000, 500].map(d => performance.now() - d); __metro.tap()'); await frame(); // 5 taps, 500 ms apart
  check('tap tempo averages the gaps', Math.abs((await js('__metro.state.bpm')) - 120) <= 3, String(await js('__metro.state.bpm')));
  await key('Escape');
  await checkSoon('Escape closes the metronome', 'document.getElementById("metroOverlay").hidden && !__metro.state.open');
  check('BPM is remembered', (await js('JSON.parse(localStorage.getItem("metronome")).bpm')) === 120);
  check('output selector offers the system default', await js('document.querySelector("#metroOut option").value === "" && document.querySelector("#metroOut option").textContent === "System default"'));

  // ---------------------------------------------------------------- advanced metronome
  const M = (code) => js('(() => { const m = __metro, s = m.state; return ' + code + '; })()');
  const advShown = () => js('!document.getElementById("metroAdv").hidden && getComputedStyle(document.getElementById("metroAdv")).display !== "none"');
  const evs = (setup, bar = 0) => js(`__ui.metroBarEvents(${JSON.stringify(setup)}, ${bar}).map(e => [e.offsetBeats, e.role])`);
  const near = (a, b) => a.length === b.length && a.every((e, i) => Math.abs(e[0] - b[i][0]) < 1e-4 && e[1] === b[i][1]);
  check('a fresh install: Simple mode, levels at 100 %, no stored advanced setup needed', await M('s.mode === "simple" && s.opensIn === "simple" && s.levels.accent === 1 && s.levels.main === 1 && s.levels.sub === 1'));
  await js('document.activeElement.blur()');
  await key('n'); await waitFor('!document.getElementById("metroOverlay").hidden');
  check('the overlay header has a Simple / Advanced switch, Simple selected', (await js('[...document.querySelectorAll("#metroMode button")].map(b => b.textContent + (b.classList.contains("on") ? "*" : "")).join(",")')) === 'Simple*,Advanced');
  check('Simple hides the advanced controls (no sections, Levels, bar counter)', !(await advShown()) && await js('document.getElementById("metroLevels").hidden && document.getElementById("metroStatus").hidden && !document.getElementById("metroBeatsLbl").hidden'));
  await shot('19-metro-simple');
  const hOf = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? Math.round(e.getBoundingClientRect().height) : -1; })()`);
  check('metronome header: "Metronome" label left, Simple / Advanced right, one line', await js('(() => { const l = document.querySelector("#metroOverlay .metro-title").getBoundingClientRect(), m = document.getElementById("metroMode").getBoundingClientRect(), c = document.querySelector("#metroOverlay .tuner-card").getBoundingClientRect(); return document.querySelector("#metroOverlay .metro-title").textContent === "Metronome" && l.left - c.left < 30 && c.right - m.right < 30 && Math.abs((l.top + l.bottom) / 2 - (m.top + m.bottom) / 2) < 2; })()'));
  check('Simple: Beats / Volume / Output share one row, controls 30 px tall', await js('(() => { const b = ["metroBeatsLbl", "metroVol", "metroOut"].map(id => document.getElementById(id).closest(".metro-field").getBoundingClientRect()); return b.every(r => Math.abs(r.bottom - b[0].bottom) < 2); })()') && (await hOf('#metroBeatsLbl .stepper')) === 30 && (await hOf('#metroOut')) === 30 && (await hOf('#metroDown')) === 30 && (await hOf('#metroTap')) === 30);
  check('the Volume label carries its value as a faint note', /^Volume\s*60\u202f%$/.test(await js('document.querySelector(".metro-vol h4").textContent')), await js('document.querySelector(".metro-vol h4").textContent'));
  await click('#metroBeatsLbl button[data-d="1"]');
  check('the Beats stepper + adds a beat (5 dots), − takes it back', await js('__metro.state.beats === 5 && document.querySelectorAll("#metroBeats span").length === 5'));
  await click('#metroBeatsLbl button[data-d="-1"]');
  check('… and back to 4', await js('__metro.state.beats === 4 && document.getElementById("metroBeatsSel").value === "4"'));
  await js('{ const r = document.getElementById("metroTempo"); r.value = "150"; r.dispatchEvent(new Event("input")); }');
  check('the tempo slider sets the BPM', await js('__metro.state.bpm === 150 && document.getElementById("metroBpm").value === "150"'));
  await js('__metro.setBpm(120)');
  await click('[data-fk="metro-mode-advanced"]'); await waitFor(advShown);
  check('the Advanced switch shows the controls', await advShown() && (await js('[...document.querySelectorAll("#metroAdv h4")].map(h => h.firstChild.textContent).join("|")')) === 'Beats|Note value|Pattern|Accents|Subdivision|Swing|Count-in' && (await js('[...document.querySelectorAll("#metroAdv .metro-trow .switch")].map(b => b.textContent).join("|")')) === 'Tempo trainer|Gap trainer' && await js('!!document.querySelector(\'[data-fk="metro-countin-0"]\')'));
  check('the Accents label has the hint beside it', (await js('document.querySelector("#metroAdv .metro-hint").textContent')) === 'Click a beat to cycle accent, normal, soft, mute' && await js('(() => { const h = document.querySelector("#metroAdv .metro-hint").getBoundingClientRect(), l = document.querySelector("#metroAdv .metro-hint").parentElement.getBoundingClientRect(); return Math.abs(h.bottom - l.bottom) < 3; })()'));
  check('Beats / Note value / Pattern and Subdivision / Swing / Count-in share three columns', await js('(() => { const x = (fk) => Math.round(document.querySelector(`[data-fk="${fk}"]`).closest(".metro-field").getBoundingClientRect().left); return x("metro-adv-beats") === x("metro-sub-1") && x("metro-note") === x("metro-swing") && x("metro-pattern") === x("metro-countin-0") && x("metro-note") - x("metro-adv-beats") > 100; })()'));
  const advH = await js('["[data-fk=\\"metro-adv-beats\\"]", "[data-fk=\\"metro-note\\"]", "[data-fk=\\"metro-pattern\\"]", "[data-fk=\\"metro-cell-0\\"]", "[data-fk=\\"metro-sub-1\\"]", "[data-fk=\\"metro-countin-0\\"]", "[data-fk=\\"metro-ramp-target\\"]", "#metroLevels", "#metroOut"].map(q => { const e = document.querySelector(q); const t = e.closest(".stepper") || (e.tagName === "BUTTON" && e.parentElement.classList.contains("seg") ? e.parentElement : e); return Math.round(t.getBoundingClientRect().height); }).join()');
  check('Advanced: one 30 px control height (stepper, pills, drop-downs, cells, Levels…)', advH === '30,30,30,30,30,30,30,30,30', advH);
  check('the trainer sentences share columns (to / play, steppers line up)', await js('(() => { const l = (fk) => Math.round(document.querySelector(`[data-fk="${fk}"]`).closest(".stepper").getBoundingClientRect().left); return l("metro-ramp-target") === l("metro-gap-play") && l("metro-ramp-step") === l("metro-gap-mute"); })()'));
  check('bar counter left and signature right on one baseline', await js('(() => { const a = document.getElementById("metroStatus").getBoundingClientRect(), b = document.getElementById("metroSig").getBoundingClientRect(); return Math.abs(a.bottom - b.bottom) < 1 && b.left > a.right + 200; })()') && (await js('document.getElementById("metroSig").textContent')) === '4/4');
  check('Volume / Output / Levels… share one bottom line', await js('(() => { const b = ["metroVol", "metroOut", "metroLevels"].map(id => document.getElementById(id).getBoundingClientRect().bottom); return Math.max(...b) - Math.min(...b) < 2; })()'));
  check('Advanced shows Levels… and the bar counter, hides the Simple beats select', await js('!document.getElementById("metroLevels").hidden && !document.getElementById("metroStatus").hidden && document.getElementById("metroBeatsLbl").hidden'));
  const cardW = await js('document.querySelector("#metroOverlay .tuner-card").getBoundingClientRect().width');
  check('the advanced card grows to ~640 px', cardW > 600 && cardW <= 642, String(cardW));
  check('advanced defaults: 4/4, beat 1 accented', (await js('document.querySelector(\'[data-fk="metro-pattern"]\').value')) === '4/4' && (await js('[...document.querySelectorAll(".metro-cell")].map(c => c.classList[1]).join()')) === 'accent,normal,normal,normal');
  check('beats per bar goes 1–16 and the note value offers 4 / 8 / 16', (await js('(() => { const i = document.querySelector(\'[data-fk="metro-adv-beats"]\'); return i.min + "-" + i.max; })()')) === '1-16' && (await js('[...document.querySelectorAll(\'[data-fk="metro-note"] button\')].map(o => o.dataset.v).join()')) === '4,8,16');
  check('the Pattern select offers 4/4, 3/4, 6/8, 5/4, 7/8, 12/8', (await js('[...document.querySelectorAll(\'[data-fk="metro-pattern"] option:not(:disabled)\')].map(o => o.textContent).join("|")')) === '4/4|3/4|6/8 (3+3)|5/4 (3+2)|7/8 (2+2+3)|12/8 (4×3)');
  const setSel = (fk, v) => js(`{ const s = document.querySelector('[data-fk="${fk}"]'); s.value = ${JSON.stringify(String(v))}; s.dispatchEvent(new Event("change")); }`);
  const cells = () => js('[...document.querySelectorAll(".metro-cell")].map(c => c.classList[1]).join()');
  await setSel('metro-pattern', '5/4'); await frame();
  check('the 5/4 (3+2) preset sets the cells (accent soft soft normal soft)', (await cells()) === 'accent,soft,soft,normal,soft' && await M('s.adv.beats === 5 && s.adv.note === 4'));
  await setSel('metro-pattern', '7/8'); await frame();
  check('the 7/8 (2+2+3) preset sets the cells and the note value 8', (await cells()) === 'accent,soft,normal,soft,normal,soft,soft' && await M('s.adv.note === 8') && (await js('document.querySelector(\'[data-fk="metro-note"] button.on\')?.dataset.v')) === '8' && (await js('document.getElementById("metroSig").textContent')) === '7/8');
  await setSel('metro-pattern', '12/8'); await frame();
  check('the 12/8 (4×3) preset makes twelve cells in four groups of three', (await cells()) === 'accent,soft,soft,normal,soft,soft,normal,soft,soft,normal,soft,soft');
  await setSel('metro-pattern', '4/4'); await frame();
  const roles = [];
  for (let i = 0; i < 4; i++) { await click('[data-fk="metro-cell-1"]'); roles.push(await js('__metro.state.adv.pattern[1]')); }
  check('clicking a cell cycles its role: Normal → Soft → Mute → Accent → Normal', roles.join() === 'soft,mute,accent,normal', roles.join());
  await click('[data-fk="metro-cell-2"]'); await frame();
  check('an edited pattern shows as Custom', (await js('document.querySelector(\'[data-fk="metro-pattern"]\').value')) === 'custom' && (await js('document.querySelector(\'[data-fk="metro-cell-2"] .r\').textContent')) === 'Soft');
  await setSel('metro-adv-beats', 16); await frame();
  check('beats per bar goes up to 16 (new cells are Normal, edits kept)', (await js('document.querySelectorAll(".metro-cell").length')) === 16 && await M('s.adv.pattern[2] === "soft" && s.adv.pattern[15] === "normal"'));
  await setSel('metro-pattern', '4/4'); await frame();

  // the pure event generator
  const T = 1 / 3;
  check('metroBarEvents: 5/4 (3+2) with triplets', near(await evs({ beats: 5, pattern: ['accent', 'soft', 'soft', 'normal', 'soft'], sub: 3 }),
    [0, 1, 2, 3, 4].flatMap((b) => [[b, ['accent', 'soft', 'soft', 'normal', 'soft'][b]], [b + T, 'sub'], [b + 2 * T, 'sub']])), JSON.stringify(await evs({ beats: 5, pattern: ['accent', 'soft', 'soft', 'normal', 'soft'], sub: 3 })));
  const sw = async (swing) => (await evs({ beats: 2, sub: 2, swing })).map(e => e[0]);
  check('swing for 2: off-beat at 0.5 (0 %), 0.583 (50 %), 2/3 (100 %)', near((await sw(0)).map(x => [x, '']), [0, 0.5, 1, 1.5].map(x => [x, ''])) && Math.abs((await sw(50))[1] - 7 / 12) < 1e-4 && Math.abs((await sw(100))[1] - 2 / 3) < 1e-4 && Math.abs((await sw(100))[3] - 5 / 3) < 1e-4, JSON.stringify([await sw(0), await sw(50), await sw(100)]));
  check('swing for 4: 16ths pair up inside each half beat (100 % → 0, 1/3, 1/2, 5/6)', near(await evs({ beats: 1, sub: 4, swing: 100 }), [[0, 'accent'], [1 / 3, 'sub'], [0.5, 'sub'], [5 / 6, 'sub']]), JSON.stringify(await evs({ beats: 1, sub: 4, swing: 100 })));
  check('swing does nothing for triplets', near(await evs({ beats: 1, sub: 3, swing: 100 }), [[0, 'accent'], [T, 'sub'], [2 * T, 'sub']]));
  check('a muted cell stays in the list as mute (the indicator still lights)', near(await evs({ beats: 3, pattern: ['accent', 'mute', 'normal'] }), [[0, 'accent'], [1, 'mute'], [2, 'normal']]));
  const ciSetup = { beats: 3, pattern: ['accent', 'soft', 'soft'], sub: 2, countIn: 2 };
  check('count-in bars are plain clicks without subdivisions, then the pattern', near(await evs(ciSetup, 0), [[0, 'accent'], [1, 'normal'], [2, 'normal']]) && near(await evs(ciSetup, 1), [[0, 'accent'], [1, 'normal'], [2, 'normal']]) && (await evs(ciSetup, 2)).length === 6 && (await evs(ciSetup, 2))[1][1] === 'sub');
  const gapSetup = { beats: 2, sub: 2, countIn: 1, gap: { on: true, play: 2, mute: 1 } };
  const gapBars = [];
  for (let b = 0; b < 8; b++) gapBars.push([...new Set((await evs(gapSetup, b)).map(e => e[1] === 'mute' ? 'mute' : 'play'))].join('/'));
  check('gap trainer mutes the right bars (1-bar count-in, play 2, rest 1)', gapBars.join() === 'play,play,play,mute,play,play,mute,play', gapBars.join());
  check('a rest bar keeps every event (beats and subs) as mute', near(await evs(gapSetup, 3), [[0, 'mute'], [0.5, 'mute'], [1, 'mute'], [1.5, 'mute']]));
  check('tempo trainer rule: +5 every 2 bars from 96, stopping at 110', (await js('[0,1,2,3,4,5,6,7,8].map(m => __metro.rampBpm({ ramp: { on: true, target: 110, step: 5, every: 2 } }, 96, m)).join()')) === '96,96,101,101,106,106,110,110,110');
  check('the generator is exposed on window.__ui', await js('typeof __ui.metroBarEvents === "function"'));

  // subdivision / swing / count-in controls
  await click('[data-fk="metro-sub-3"]');
  check('subdivision 3 disables swing', await js('document.querySelector(\'[data-fk="metro-swing"]\').disabled') && await M('s.adv.sub === 3'));
  await click('[data-fk="metro-sub-2"]');
  await js('{ const r = document.querySelector(\'[data-fk="metro-swing"]\'); r.value = "60"; r.dispatchEvent(new Event("input")); }');
  check('subdivision 2 enables swing and the slider sets it', await js('!document.querySelector(\'[data-fk="metro-swing"]\').disabled') && await M('s.adv.sub === 2 && s.adv.swing === 60'));
  await click('[data-fk="metro-countin-1"]');
  check('count-in buttons set 0 / 1 / 2 bars', await M('s.adv.countIn === 1') && await js('document.querySelector(\'[data-fk="metro-countin-1"]\').classList.contains("on")'));

  // a real run: count-in, pattern with sub pips, then the gap trainer through the scheduler
  await js('__metro.setBpm(300)');
  await js('document.activeElement.blur()');
  // 300 BPM: one 4-beat bar takes 0.8 s, so the count-in shows first and bar 1 follows; wait for each state.
  await key(' ');
  await checkSoon('advanced run: the count-in shows in the bar counter', async () => /^Count-in 1 \/ 1$/.test(await js('document.getElementById("metroStatus").textContent')), () => js('document.getElementById("metroStatus").textContent'));
  await waitFor(() => M('s.scheduled.filter(e => e.bar === 1).length === 8 && s.scheduled.some(e => e.bar >= 2)'));
  await checkSoon('advanced run: beat pips with smaller sub pips, the bar counter counts', async () => await js('document.querySelectorAll("#metroBeats .pip").length === 4 && document.querySelectorAll("#metroBeats .subpip").length === 4') && /^Bar \d+/.test(await js('document.getElementById("metroStatus").textContent')), () => js('document.getElementById("metroStatus").textContent'));
  check('advanced run: the scheduler played count-in clicks, then the pattern with swung subs', await M(`(() => { const ev = s.scheduled; const ci = ev.filter(e => e.bar === 0), b1 = ev.filter(e => e.bar === 1); return ci.length === 4 && ci.every(e => e.role !== "sub") && b1.length === 8 && Math.abs(b1[1].offsetBeats - 0.6) < 1e-4 && b1[1].role === "sub"; })()`), await M('JSON.stringify(s.scheduled.slice(0, 12).map(e => [e.bar, e.offsetBeats, e.role]))'));
  await key(' '); await waitFor('!__metro.state.running');
  await js('(() => { const m = __metro.state; m.adv = __metro.normSetup({ beats: 1, sub: 1, countIn: 0, gap: { on: true, play: 1, mute: 2 } }); })()');
  await key(' ');
  await waitFor(() => M('s.scheduled.some(e => e.bar >= 6) && s.count >= 7'));
  const gapRun = await M('s.scheduled.map(e => e.bar + ":" + e.role).join()');
  check('gap trainer through the scheduler: bars 0, 3, 6 play, the rest are muted', /^0:accent,1:mute,2:mute,3:accent,4:mute,5:mute,6:accent/.test(gapRun), gapRun);
  check('the beat indicator keeps running through the rests', await M('s.count >= 7'), String(await M('s.count')));
  await key(' '); await waitFor('!__metro.state.running');
  // the tempo trainer
  await js('(() => { const m = __metro.state; m.adv = __metro.normSetup({ beats: 1, sub: 1, ramp: { on: true, target: 250, step: 5, every: 1 } }); })()');
  await js('__metro.setBpm(240)'); await frame();
  check('the trainer shows its range before starting', (await js('document.getElementById("metroRamp").textContent')) === 'ramps 240 → 250');
  await key(' ');
  await checkSoon('while running it shows "ramping 240 → 250"', async () => (await js('document.getElementById("metroRamp").textContent')) === 'ramping 240 → 250');
  // 1-beat bars at ~245 BPM: the ramp reaches 250 after two bars; wait until a few bars ran at the target.
  await waitFor(() => M('s.scheduled.filter(e => e.bpm === 250).length >= 3'));
  const bpms = await M('[...new Set(s.scheduled.map(e => e.bpm))].join()');
  check('the tempo ramp steps the BPM a bar at a time and stops at the target', bpms === '240,245,250', bpms);
  check('the ramped tempo is the stored BPM', await M('s.bpm === 250') && (await js('JSON.parse(localStorage.getItem("metronome")).bpm')) === 250);
  await key(' '); await waitFor('!__metro.state.running');
  check('the tempo has one source the scheduler reads (preset tempo ready for later)', await M('s.tempoFollowsPreset === false && m.effectiveBpm() === 250 && (s.presetTempo = 99, s.tempoFollowsPreset = true, m.effectiveBpm() === 99) && (s.tempoFollowsPreset = false, s.presetTempo = null, m.effectiveBpm() === 250)'));
  const hookSeen = await M('(() => { const seen = [], app = s.onTempoChange; s.onTempoChange = (b, src) => seen.push(b + src); m.setBpm(121); s.onTempoChange = app; return seen.join(); })()');
  check('a user tempo change calls the onTempoChange hook', hookSeen === '121user', hookSeen);
  check('every role has a sound source (muted has none)', await M('["accent","normal","soft","sub"].every(r => typeof m.soundFor(r).play === "function") && m.soundFor("mute") === null'));

  // Levels
  await js('(() => { const m = __metro.state; m.adv = __metro.normSetup({}); })()'); await js('__metro.setBpm(120)');
  await click('[data-fk="metro-levels"]'); await waitFor('!!document.querySelector(".levels-pop")');
  check('Levels… opens a popover with Accent, Main ticks and Subdivisions', (await js('[...document.querySelectorAll(".levels-pop .lvl-row span:first-child")].map(s => s.textContent).join("|")')) === 'Accent|Main ticks|Subdivisions');
  check('the Levels popover sits above the overlay', await js('(() => { const p = document.querySelector(".levels-pop"); const b = p.getBoundingClientRect(); return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest(".levels-pop") === p; })()'));
  await js('{ const r = document.querySelector(\'[data-fk="lvl-accent"]\'); r.value = "0.5"; r.dispatchEvent(new Event("input", { bubbles: true })); const q = document.querySelector(\'[data-fk="lvl-sub"]\'); q.value = "0.25"; q.dispatchEvent(new Event("input", { bubbles: true })); }');
  await shot('21-metro-levels');
  check('level sliders persist in the metronome key', await js('(() => { const l = JSON.parse(localStorage.getItem("metronome")).levels; return l.accent === 0.5 && l.main === 1 && l.sub === 0.25; })()'));
  check('levels multiply the click gains per role', await M('Math.abs(m.roleGain("accent") - s.volume * 0.5) < 1e-9 && Math.abs(m.roleGain("normal") - s.volume) < 1e-9 && Math.abs(m.roleGain("sub") - s.volume * 0.25 * 0.5) < 1e-9 && m.roleGain("mute") === 0'));
  await key('Escape'); await waitFor('!document.querySelector(".levels-pop")');
  check('Escape closes the Levels popover first, the overlay stays', !(await js('!!document.querySelector(".levels-pop")')) && await M('s.open'));
  await click('[data-fk="metro-sub-2"]'); await setSel('metro-pattern', '6/8'); await frame();
  await shot('20-metro-advanced');
  check('the signature line names the subdivision', (await js('document.getElementById("metroSig").textContent')) === '6/8 · eighths');
  await click('[data-fk="metro-ramp"]'); await click('[data-fk="metro-gap"]'); await click('[data-fk="metro-sub-3"]'); await setSel('metro-pattern', '5/4');
  await click('[data-fk="metro-cell-3"]'); await click('[data-fk="metro-cell-3"]'); await click('[data-fk="metro-countin-1"]');
  check('accent cells show the level by fill strength (accent brighter than soft, mute dashed)', await js(`(() => { const lum = (fk) => { const c = getComputedStyle(document.querySelector('[data-fk="' + fk + '"]')).backgroundColor; const m = c.match(/[\\d.]+/g).map(Number); const k = c.startsWith('color(') ? 255 : 1; return (m[0] + m[1] + m[2]) * k; }; const cs = getComputedStyle(document.querySelector('[data-fk="metro-cell-3"]')); return lum('metro-cell-0') > lum('metro-cell-1') + 60 && cs.borderTopStyle === 'dashed' && document.querySelector('[data-fk="metro-cell-3"]').classList.contains('mute'); })()`));
  check('the trainers turn on: sentences at full strength, the ramp status sits beside BPM', await js('!document.querySelector(".metro-trow.off") && !document.getElementById("metroRamp").hidden') && await js('(() => { const a = document.getElementById("metroRamp").getBoundingClientRect(), b = document.querySelector(".metro-sub span").getBoundingClientRect(); return Math.abs(a.top - b.top) < 4; })()'));
  await shot('20b-metro-advanced-trainers');
  check('the advanced card with trainers on still fits a 900 px window', await js('(() => { const c = document.querySelector("#metroOverlay .tuner-card"); return c.scrollHeight <= c.clientHeight + 1 && c.getBoundingClientRect().bottom <= innerHeight; })()'));
  await click('[data-fk="metro-ramp"]'); await click('[data-fk="metro-gap"]'); await click('[data-fk="metro-countin-0"]'); await click('[data-fk="metro-sub-2"]'); await setSel('metro-pattern', '6/8'); await frame();
  check('the advanced card fits a 900 px tall window without scrolling', await js('(() => { const c = document.querySelector("#metroOverlay .tuner-card"); return c.scrollHeight <= c.clientHeight + 1 && c.getBoundingClientRect().bottom <= innerHeight; })()'), await js('(() => { const c = document.querySelector("#metroOverlay .tuner-card"); return c.scrollHeight + " vs " + c.clientHeight; })()'));
  await click('[data-fk="metro-mode-simple"]'); await waitFor(async () => !(await advShown()));
  check('switching back to Simple hides them again, 4 plain beat dots', !(await advShown()) && (await js('document.querySelectorAll("#metroBeats > span").length')) === 4 && (await js('document.querySelectorAll("#metroBeats .pip").length')) === 0);
  await key('Escape'); await waitFor('!__metro.state.open');
  await key('n'); await waitFor('__metro.state.open');
  check('without "Opens in: Advanced" the overlay reopens in Simple', await M('s.mode === "simple"'));
  await key('Escape'); await waitFor('!__metro.state.open');

  // ---------------------------------------------------------------- preset tempo (type 145, state-dump field 56)
  // Bodies from the phone-app trace (docs/INVESTIGATION.md §9): {3: scope, 4: 0, 5: bpm f32, 6: 0}.
  const tempoHex = (scope, bpm) => { const f = Buffer.alloc(4); f.writeFloatLE(bpm); return ['0F', 'C0', '18', '0' + scope, '20', '00', '2D', ...[...f].map(b => b.toString(16).toUpperCase().padStart(2, '0')), '30', '00', '91', '00', '00', '00'].join(' '); };
  check('tempo bodies equal the trace (live 120, preset 93)', tempoHex(1, 120) === '0F C0 18 01 20 00 2D 00 00 F0 42 30 00 91 00 00 00' && tempoHex(0, 93) === '0F C0 18 00 20 00 2D 00 00 BA 42 30 00 91 00 00 00'
    && (await js('Array.from(__tempo.frame(1, 120)).map(b => b.toString(16).toUpperCase().padStart(2, "0")).join(" ")')) === tempoHex(1, 120));
  const tempoTx = (list) => list.filter(t => /^TX (Live|Preset) tempo /.test(t)).map(t => t.split(': ')[1]);
  const tempoVal = () => js('document.querySelector(\'[data-fk="tempo-bpm"]\').value');
  const cleanSlate = () => js('__ui.dirty = false; state.presetDirty = false; render()');
  const tempoOrigin = await js('state.selectedPreset');
  await cleanSlate(); await frame();
  await click('.preset-row[data-n="1"]');
  await checkSoon('the Tempo field sits in the inspector\'s top row and shows the preset tempo (field 56, demo 120)', async () => (await tempoVal()) === '120' && await js('state.selectedPreset === 1 && state.presetTempo === 120 && !!document.querySelector(".insp-head .tempo-ctl")'), tempoVal);
  // The tempo commits into the preset 0.8 s after the last step (COMMIT_STEP); these waits don't settle,
  // so each check reads its packets before that timer fires.
  n0 = await mark();
  await click('[data-fk="tempo-down"]'); await click('[data-fk="tempo-up"]');
  let tt = tempoTx(await waitFor(async () => { const t = await txSince(n0); return tempoTx(t).includes(tempoHex(1, 120)) && t; }) || []);
  check('− / + send live tempo writes (3:1), the last one exactly the live 120 body', tt.length >= 1 && tt[tt.length - 1] === tempoHex(1, 120) && tt.every(h => h.startsWith('0F C0 18 01')), JSON.stringify(tt));
  check('live writes do not mark the preset dirty', !(await js('__ui.dirty || state.presetDirty')));
  await txWait(n0, tx => tempoTx(tx).includes(tempoHex(0, 120)));
  await waitFor('__ui.dirty');
  tt = tempoTx(await txSince(n0));
  check('the steps are committed (one 3:0 with 120) about 0.8 s after they settle', tt[tt.length - 1] === tempoHex(0, 120) && tt.filter(h => h.startsWith('0F C0 18 00')).length === 1 && await js('__ui.dirty'), JSON.stringify(tt));
  await cleanSlate(); await frame();
  // Scrub: drag sideways on the TEMPO label, 1 BPM per 4 px.
  n0 = await mark();
  {
    const b = await box('[data-fk="tempo-scrub"]');
    const x = Math.round(b.x), y = Math.round(b.y);
    wc.sendInputEvent({ type: 'mouseMove', x, y });
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 10; i++) { wc.sendInputEvent({ type: 'mouseMove', x: x + i * 4, y, button: 'left' }); await sleep(12); }
    wc.sendInputEvent({ type: 'mouseUp', x: x + 40, y, button: 'left', clickCount: 1 });
    await frame();
  }
  await waitFor(async () => (await tempoVal()) === '130' && tempoTx(await txSince(n0)).includes(tempoHex(1, 130)));
  tt = tempoTx(await txSince(n0));
  check('dragging the TEMPO label sideways scrubs it live (+40 px = 130)', (await tempoVal()) === '130' && tt.length >= 1 && tt.every(h => h.startsWith('0F C0 18 01')) && tt[tt.length - 1] === tempoHex(1, 130), (await tempoVal()) + ' ' + JSON.stringify(tt));
  await checkSoon('the pedal\'s echo (rx 145) is read without an error', () => js('__ui.logs.some(l => /^RX C305: 0D C0 08 01 18 01 2D 00 00 F0 42 91/.test(l.text))'));
  await click('[data-fk="tempo-bpm"]'); await js('document.querySelector(\'[data-fk="tempo-bpm"]\').select()');
  n0 = await txCount();
  await type('93'); await key('Return');
  tt = tempoTx(await txWait(n0, tx => tempoTx(tx).length >= 2));
  check('Enter sends exactly the preset 93 body (3:0) at once (cancelling the pending scrub commit), after a live 93', tt.length === 2 && tt[0] === tempoHex(1, 93) && tt[1] === tempoHex(0, 93), JSON.stringify(tt));
  await checkSoon('the commit marks the preset dirty (UI and the pedal\'s 115)', async () => await js('__ui.dirty && state.presetDirty && !document.getElementById("dirtyMark").hidden') && (await tempoVal()) === '93');
  await click('[data-fk="tempo-up"]'); await click('[data-fk="tempo-up"]'); await waitFor(async () => (await tempoVal()) === '95');
  await shot('xx-tempo');
  n0 = await txCount();
  await key('s', [MOD]);
  tx = await txWait(n0, tx => tx.some(t => /^TX save preset 1/.test(t)));
  tt = tempoTx(tx);
  check('Save right after a step commits the tempo first (one 3:0 with 95), then saves', tt.length === 1 && tt[0] === tempoHex(0, 95) && tx.some(t => /^TX save preset 1/.test(t)), JSON.stringify(tx));
  await checkSoon('after Save the preset is clean and the demo pedal stored 95', '!__ui.dirty && !state.presetDirty && __demo.tempo.buf === 95');
  await click('.preset-row[data-n="4"]');
  await checkSoon('switching presets updates the field (preset 4: 140)', async () => (await tempoVal()) === '140', tempoVal);
  await settle();
  await click('.preset-row[data-n="1"]');
  await checkSoon('… and back: preset 1 kept the saved 95', async () => (await tempoVal()) === '95', tempoVal);
  await settle();
  // Unsolicited rx 145 (tempo changed on the pedal: hold footswitch I and tap), with field 4 = 1.
  const rx145 = (bpm) => js(`(() => { const f = new Uint8Array(new Float32Array([${bpm}]).buffer); const d = new Uint8Array([0x0F, 0xC0, 0x08, 0x01, 0x18, 0x01, 0x20, 0x01, 0x2D, ...f, 0x91, 0, 0, 0]); window.onC305({ target: { value: { buffer: d.buffer } } }); })()`);
  await rx145(110); await frame();
  check('an unsolicited rx 145 (4:1 read like 4:0) updates the field', (await tempoVal()) === '110' && await js('__ui.logs.some(l => l.text === "Pedal tempo: 110 BPM")'), await tempoVal());
  await click('.preset-row[data-n="1"]'); await js('__demo.load(1)'); await settle();

  // Metronome follows the preset tempo (Settings → Metronome), off by default.
  check('"Follow the preset tempo" is off by default', !(await js('__metro.state.tempoFollowsPreset')));
  await key('n'); await waitFor('__metro.state.open');
  n0 = await mark();
  await click('#metroUp'); await js('{ const r = document.getElementById("metroTempo"); r.value = "150"; r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change")); }');
  await settle();
  check('with the sync off, the metronome sends nothing to the pedal and keeps its own BPM', tempoTx(await txSince(n0)).length === 0 && (await js('document.getElementById("metroBpm").value')) === '150' && await js('document.getElementById("metroFollow").hidden'));
  await key('Escape'); await waitFor('!__metro.state.open');
  await js('void __openSettings()'); await waitFor('!!document.querySelector(\'[data-fk="set-follow-tempo"]\')');
  check('Settings → Metronome has "Follow the preset tempo"', (await js('document.querySelector(\'[data-fk="set-follow-tempo"]\')?.textContent')) === 'Follow the preset tempo');
  await click('[data-fk="set-follow-tempo"]');
  await key('Escape'); await waitFor('!document.querySelector(".modal")');
  await checkSoon('the switch turns the sync on and is remembered', () => js('__metro.state.tempoFollowsPreset && JSON.parse(localStorage.getItem("settings.metroFollowsPreset")) === true'));
  await key('n'); await waitFor('__metro.state.open');
  await waitFor('document.getElementById("metroBpm").value === "95"');
  check('with the sync on, the metronome BPM is the preset tempo (95) and the overlay says so', (await js('document.getElementById("metroBpm").value')) === '95' && await js('__metro.effectiveBpm() === 95 && !document.getElementById("metroFollow").hidden && document.getElementById("metroFollow").textContent === "♩ follows preset"'), await js('document.getElementById("metroBpm").value'));
  await shot('xx-tempo-metro');
  // Each metronome change commits into the preset 1.5 s later (COMMIT_METRO): read before that, no settling.
  n0 = await mark();
  await click('#metroUp');
  await waitFor(async () => tempoTx(await txSince(n0)).length >= 1 && (await tempoVal()) === '96');
  tt = tempoTx(await txSince(n0));
  check('metronome + writes the tempo live to the pedal (96)', tt.length === 1 && tt[0] === tempoHex(1, 96) && (await tempoVal()) === '96', JSON.stringify(tt));
  n0 = await txCount();
  await js('{ const r = document.getElementById("metroTempo"); r.value = "100"; r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change")); }');
  await waitFor(async () => tempoTx(await txSince(n0)).length >= 1);
  tt = tempoTx(await txSince(n0));
  check('the metronome slider goes live at once (100), nothing into the preset yet', tt.length >= 1 && tt.every(h => h === tempoHex(1, 100)) && !(await js('__ui.dirty')), JSON.stringify(tt));
  await txWait(n0, tx => tempoTx(tx).includes(tempoHex(0, 100)));
  await waitFor('__ui.dirty');
  tt = tempoTx(await txSince(n0));
  check('… and commits 100 into the preset about 1.5 s later', tt[tt.length - 1] === tempoHex(0, 100) && tt.filter(h => h.startsWith('0F C0 18 00')).length === 1 && await js('__ui.dirty'), JSON.stringify(tt));
  n0 = await txCount();
  await js('__metro.setBpm(104, "trainer")');
  await sleep(1700);   // longer than COMMIT_METRO (1.5 s): proves no commit into the preset follows
  await settle();
  tt = tempoTx(await txSince(n0));
  check('a tempo-trainer step goes to the pedal live only', tt.length === 1 && tt[0] === tempoHex(1, 104) && await js('__metro.effectiveBpm() === 104'), JSON.stringify(tt));
  await rx145(132); await frame();
  await waitFor('document.getElementById("metroBpm").value === "132"');
  check('a tempo change on the pedal moves the metronome', (await js('document.getElementById("metroBpm").value')) === '132' && await js('__metro.effectiveBpm() === 132'));
  await key('Escape'); await waitFor('!__metro.state.open');
  await cleanSlate(); await frame(); await settle();
  await click('.preset-row[data-n="4"]');
  await checkSoon('a preset switch moves the metronome to the new preset\'s tempo (140)', '__metro.effectiveBpm() === 140');
  await js('__tempo.setFollow(false)');
  await key('n'); await waitFor('__metro.state.open');
  n0 = await mark();
  await click('#metroUp'); await settle();
  check('sync off again: the metronome is independent and sends nothing', tempoTx(await txSince(n0)).length === 0 && await js('__metro.effectiveBpm() === __metro.state.bpm && document.getElementById("metroFollow").hidden'));
  await key('Escape'); await waitFor('!__metro.state.open');
  await cleanSlate(); await frame();
  await click('.preset-row[data-n="' + tempoOrigin + '"]'); await waitFor(async () => (await js('state.selectedPreset')) === tempoOrigin); await settle();

  // ---------------------------------------------------------------- pedal library
  await key('4'); await frame();
  // A capture whose type word we don't know yet: no icon, but the raw word stays in the row's tooltip.
  await js('window.__kindDebug = []; window.__origDebug = console.debug; console.debug = (...a) => { __kindDebug.push(a.join(" ")); }; state.library.user.push({ index: 99, name: "Zz Mystery", type: "mystery_box", instrument: "guitar", author: "Tester" }); 1');
  await click('[data-fk="lib-capture"]');
  await checkSoon('library picker lists the pedal\'s captures', async () => (await js('document.querySelectorAll(".pop .pop-item").length')) >= 8, () => js('String(document.querySelectorAll(".pop .pop-item").length)'));
  const rowOf = (name) => `[...document.querySelectorAll(".pop .pop-item")].find(x => x.querySelector(".name")?.textContent === ${JSON.stringify(name)})`;
  const kinds = (name) => js(`(() => { const r = ${rowOf(name)}; return r ? [...r.querySelectorAll(".sub .kind")].map(k => k.title).join("|") + "/" + (r.querySelector(".sub .author")?.textContent || "") : "missing"; })()`);
  check('capture row shows type and instrument icons, then the author', (await kinds('Plexi 1959 SLP')) === 'Amp head|Guitar/Neural DSP', await kinds('Plexi 1959 SLP'));
  check('kind icons are inline 14 px line drawings', await js(`(() => { const s = ${rowOf('Plexi 1959 SLP')}.querySelector(".sub .kind svg"); const r = s.getBoundingClientRect(); return s.getAttribute("viewBox") === "0 0 16 16" && s.getAttribute("fill") === "none" && Math.round(r.width) === 14 && Math.round(r.height) === 14; })()`));
  check('combo, pedal, preamp and bass get their own icons', (await kinds('AC30 TB Normal')) === 'Combo|Guitar/Neural DSP' && (await kinds('King of Tone')) === 'Pedal|Guitar/Neural DSP' && (await kinds('Bedroom Clean')) === 'Preamp|Guitar/You' && (await kinds('SVT CL Bass')) === 'Amp head|Bass/Neural DSP', [await kinds('AC30 TB Normal'), await kinds('King of Tone'), await kinds('Bedroom Clean'), await kinds('SVT CL Bass')].join(', '));
  check('a default / instrument_not_set capture has no icons, just the author', (await kinds('My Plexi Lead')) === '/You', await kinds('My Plexi Lead'));
  check('an unknown type word: no icon, raw word in the row tooltip, logged once', (await kinds('Zz Mystery')) === 'Guitar/Tester' && /mystery_box/.test(await js(`${rowOf('Zz Mystery')}.title`)) && (await js('__kindDebug.filter(l => /unknown capture kind mystery_box/.test(l)).length')) === 1, await js(`${rowOf('Zz Mystery')}?.title`) + ' ' + await js('JSON.stringify(__kindDebug)'));
  check('every capture row has a subtitle line', await js('document.querySelectorAll(".pop .pop-item.two").length === document.querySelectorAll(".pop .pop-item").length'));
  await shot('xx-library-kinds');
  await type('combo'); await frame();
  check('searching a type word ("combo") finds the combo captures', (await js('[...document.querySelectorAll(".pop .pop-item .name")].map(x => x.textContent).join("|")')) === 'AC30 TB Normal|Deluxe Reverb Clean', await js('[...document.querySelectorAll(".pop .pop-item .name")].map(x => x.textContent).join("|")'));
  for (let i = 0; i < 5; i++) await key('Backspace');
  await js('console.debug = __origDebug; state.library.user.pop(); 1');
  await type('plexi'); await frame();
  const libName = await js('document.querySelector(".pop-item .name")?.textContent');
  check('library search filters', (await js('document.querySelectorAll(".pop-item").length')) === 2 && /plexi/i.test(libName || ''), String(libName));
  await key('Return');
  await checkSoon('slot chooser appears', '!!document.querySelector(".modal .slots")');
  await click('.modal [data-fk="pickslot-9"]');
  n0 = await txCount();
  await key('Return');
  tx = await txWait(n0, tx => tx.some(t => /^TX Load library capture/.test(t)));
  check('load-into-slot packet sent (SetCaptureSlotContentRequest, type 80)', tx.some(t => /^TX Load library capture "Plexi 1959 SLP" into slot 9: .*50 00 00 00$/.test(t)), JSON.stringify(tx));
  await checkSoon('slot 9 now holds the library capture', async () => (await js('state.captureNames.get(9)')) === libName, () => js('String(state.captureNames.get(9))'));
  await checkSoon('capture node shows it', async () => (await js('document.querySelector("[data-stage=capture] .model").textContent')) === libName);
  await checkSoon('no popover or dialog left open', '!document.querySelector(".pop") && !document.querySelector(".modal")');
  await key('5'); await frame();
  await click('[data-fk="lib-cab"]'); await waitFor('document.querySelectorAll(".pop .pop-item").length >= 5');
  check('cab rows in the library picker stay plain one-line names (no kind icons)', await js('document.querySelectorAll(".pop .pop-item").length >= 5 && !document.querySelector(".pop .pop-item.two, .pop .kind") && document.querySelector(".pop .pop-item").textContent === "412 V30"'), await js('document.querySelector(".pop .pop-item")?.outerHTML'));
  await key('Escape'); await frame();
  await key('4'); await frame();

  // ---------------------------------------------------------------- slot usage scan
  // Preset 5 is dirty now (slot 9 load above). The scan switches presets, so it must refuse.
  check('Usage… sits next to Load from library…', await js('document.querySelector(\'[data-fk="usage-capture"]\')?.nextElementSibling?.dataset.fk === "lib-capture"'));
  await click('[data-fk="usage-capture"]'); await waitFor('!!document.querySelector(".pop.usage-pop")');
  check('Usage… opens the slot usage menu', await js('!!document.querySelector(".pop.usage-pop") && document.querySelector(\'[data-fk="usage-scan"]\')?.textContent === "Scan slot usage…"'));
  check('scan is disabled while there are unsaved edits, and says why', await js('document.querySelector(\'[data-fk="usage-scan"]\').disabled && /discard/.test(document.querySelector(\'[data-fk="usage-why"]\')?.textContent || "")'));
  await shot('10a-usage-dirty');
  await key('Escape');
  check('Escape closes the usage menu', await js('!document.querySelector(".pop")'));
  await key('s', [MOD]); await waitFor('!__ui.dirty'); await settle();   // save: the scan may run now
  const origin = await js('state.selectedPreset');
  const saved = await js('[...Array(64).keys()].map(i => i + 1).filter(i => !/^empty$/i.test(state.presetNames.get(i))).length');
  // partial: stop it after a few presets
  await click('[data-fk="usage-capture"]'); await waitFor('!!document.querySelector(\'[data-fk="usage-scan"]\')');
  check('scan is enabled once the edits are saved', await js('!document.querySelector(\'[data-fk="usage-scan"]\').disabled && !document.querySelector(\'[data-fk="usage-why"]\')'));
  // Stop it from inside the page as soon as the third preset is being scanned: a round trip from this
  // process can take longer than scanning the rest on a slow VM, so polling from here could miss the window.
  const armStop = js(`new Promise(res => { const t0 = Date.now(); const iv = setInterval(() => {
    const m = /^Scanning presets (\\d+)\\//.exec(__ui.lastAction || '');
    if ((m && +m[1] >= 3) || Date.now() - t0 > ${TIMEOUT}) { clearInterval(iv); document.querySelector('[data-fk="usage-stop"]')?.click(); res(m ? +m[1] : -1); }
  }, 1); })`);
  await click('[data-fk="usage-scan"]');
  const stoppedAt = await armStop;
  await waitFor('!__ui.scanning', { timeout: 15000 });
  await checkSoon('Stop scan ends early and says it was partial', async () => await js('__ui.usage && !__ui.usage.complete') && /^Partial scan: stopped after \d+ of \d+ presets$/.test(await js('document.querySelector(\'[data-fk="usage-partial"]\')?.textContent || ""')), async () => 'stop at ' + stoppedAt + ': ' + await js('document.querySelector(".usage-pop")?.textContent'));
  await checkSoon('a stopped scan still returns to the origin preset', async () => (await js('state.selectedPreset')) === origin);
  await settle();
  // full scan
  n0 = await txCount();
  await js('document.querySelector(\'[data-fk="usage-scan"]\').click()');
  let progress = '';
  for (const t0 = Date.now(); Date.now() - t0 < 30000 && await js('__ui.scanning');) { const a = await js('document.getElementById("lastAction").textContent'); if (/^Scanning presets \d+\/\d+…$/.test(a)) progress = a; await sleep(15); }
  await waitFor('__ui.usage && __ui.usage.complete'); await settle();
  check('status bar shows scan progress ("Scanning presets 12/25…")', progress !== '', progress);
  const usage = await js('__ui.usage');
  check('scan covers every saved preset and completes', usage.complete && usage.scanned === saved && usage.total === saved, JSON.stringify({ scanned: usage.scanned, total: usage.total, saved }));
  tx = (await txSince(n0)).filter(t => /^TX Preset change \d+:/.test(t));
  check('scan switches through the presets over Bluetooth and ends on the origin', tx.length === saved && /^TX Preset change (\d+):/.exec(tx[tx.length - 1])[1] === String(origin), tx.length + ' switches: ' + tx.map(t => /change (\d+)/.exec(t)[1]).join(','));
  check('scan returns to the origin preset', (await js('state.selectedPreset')) === origin && (await js('document.querySelector(".preset-title .name").textContent')) === 'Big Lead 5');
  check('scan leaves no unsaved edits', await js('!__ui.dirty && document.getElementById("dirtyMark").hidden'));
  check('result says when the scan ran', new RegExp('^Scanned: \\d{1,2}:\\d{2}.*, ' + saved + ' presets$').test(await js('document.querySelector(\'[data-fk="usage-date"]\')?.textContent || ""')), await js('document.querySelector(\'[data-fk="usage-date"]\')?.textContent'));
  check('result lists the presets that use the current capture slot', (await js('document.querySelector(\'[data-fk="usage-feeds"]\')?.textContent')) === 'Slot 9 feeds: 5 Big Lead 5, 12 JP2C Lead 2, 20 Octave Down Riff 2', await js('document.querySelector(\'[data-fk="usage-feeds"]\')?.textContent'));
  // computed from the scan itself: the delete check earlier in the run empties preset 24, which frees its slot
  const expectedFree = 'Free capture slots: ' + Array.from({ length: 25 }, (_, i) => i + 1).filter(n => !(usage.captures[n] || []).length).join(', ');
  check('result lists the free capture slots', (await js('document.querySelector(\'[data-fk="usage-free"]\')?.textContent')) === expectedFree && expectedFree.includes('14'), await js('document.querySelector(\'[data-fk="usage-free"]\')?.textContent') + ' vs ' + expectedFree);
  check('result lists the free cab slots', (await js('document.querySelector(\'[data-fk="usage-free-cab"]\')?.textContent')) === 'Free cab slots: 5', await js('document.querySelector(\'[data-fk="usage-free-cab"]\')?.textContent'));
  check('presets playing a library capture (position 6) are listed apart', JSON.stringify(usage.library) === '[9,19]' && (await js('document.querySelector(\'[data-fk="usage-library"]\')?.textContent')) === 'Captures from the library: 9 Fuzz Wall, 19 Fuzz Wall 2', JSON.stringify(usage.library));
  check('presets playing a library cab (slot 6) are listed apart', JSON.stringify(usage.cabLibrary) === '[7,17]' && !Object.values(usage.cabs).flat().includes(7), JSON.stringify(usage.cabLibrary));
  check('library presets are not counted under any slot', !Object.values(usage.captures).flat().some(n => n === 9 || n === 19) && !usage.captures[26]);
  await shot('10b-usage-result');
  await key('Escape');
  check('capture slot buttons show how many presets use them, with the presets in the tooltip', (await js('document.querySelector(\'[data-fk="capslot-9"] .uses\')?.textContent')) === '3' && /^Used by 3 presets: 5 Big Lead 5, 12 JP2C Lead 2, 20 Octave Down Riff 2$/.test(await js('document.querySelector(\'[data-fk="capslot-9"] .uses\').title')), await js('document.querySelector(\'[data-fk="capslot-9"] .uses\')?.title'));
  check('unused capture slots are marked free', await js('document.querySelector(\'[data-fk="capslot-17"] .uses.free\')?.textContent === "free" && !document.querySelector(\'[data-fk="capslot-5"] .uses:not(.free)\')'));
  await key('5'); await frame();
  check('IR slot buttons show counts too', await js('/^\\d+$/.test(document.querySelector(\'[data-fk="irslot-1"] .uses\')?.textContent || "") && document.querySelector(\'[data-fk="irslot-5"] .uses\')?.textContent === "free"'), await js('[1,2,3,4,5].map(i => document.querySelector(`[data-fk="irslot-${i}"] .uses`)?.textContent).join(",")'));
  await key('4'); await frame();
  await click('[data-fk="lib-capture"]'); await waitFor('document.querySelectorAll(".pop .pop-item").length > 0');
  await type('king'); await key('Return'); await waitFor('!!document.querySelector(\'.modal [data-fk="pickslot-9"]\')');
  check('the slot chooser shows the usage counts', (await js('document.querySelector(\'.modal [data-fk="pickslot-9"] .uses\')?.textContent')) === '3' && await js('document.querySelector(\'.modal [data-fk="pickslot-20"] .uses\')?.textContent === "free"'));
  await shot('10c-usage-chooser');
  await key('Escape');
  await checkSoon('cancelling the chooser loads nothing', '!document.querySelector(".modal") && !__ui.dirty');
  // a preset that plays a capture straight from the library
  await click('.preset-row[data-n="9"]');
  await checkSoon('library capture: the node says "From the library", not a slot', async () => (await js('document.querySelector("[data-stage=capture] .sub").textContent')) === 'From the library: Fuzz Face Si', () => js('document.querySelector("[data-stage=capture] .sub").textContent'));
  check('library capture: the inspector says so and no slot is lit', /^From the library: Fuzz Face Si\./.test(await js('document.querySelector(\'[data-fk="cap-from-lib"]\')?.textContent || ""')) && await js('!document.querySelector(".inspector .slot.on")'));
  await settle();
  await click('.preset-row[data-n="7"]');
  await checkSoon('library cab: the node says "From the library"', async () => (await js('document.querySelector("[data-stage=cab] .sub").textContent')) === 'From the library: 112 Jensen', () => js('document.querySelector("[data-stage=cab] .sub").textContent'));
  await settle();
  await click(`.preset-row[data-n="${origin}"]`); await waitFor(async () => (await js('state.selectedPreset')) === origin); await settle();

  // ---------------------------------------------------------------- session recording
  await click('#recBtn'); await frame();
  check('Record arms the recorder', await js('__rec.on && document.getElementById("recBtn").classList.contains("on")'));
  await dblclick('[data-fk="amp-bass"] svg');
  await checkSoon('TX packets are recorded with their label', () => js('__rec.events.some(e => e.dir === "tx" && /Amp bass/.test(e.label) && /^[0-9A-F]{2}( [0-9A-F]{2})+$/.test(e.hex))'), JSON.stringify(await js('__rec.events.slice(-2)')));
  await js('handleTypedMessage(buildFrame([0x20, 0x01], MSG.SetPresetSlotsResponse))'); // a reply from the pedal
  await click('#recBtn');
  // the file arrives through a download; wait until it is complete JSON
  const recFile = await waitFor(async () => fs.readdirSync(OUT).find(f => { if (!/^nano-session-.*\.json$/.test(f)) return false; try { JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')); return true; } catch { return false; } }));
  const recData = recFile ? JSON.parse(fs.readFileSync(path.join(OUT, recFile), 'utf8')) : null;
  check('stopping saves a JSON session file', !!recData && Array.isArray(recData.events) && recData.events.length >= 1 && Array.isArray(recData.log), String(recFile));
  check('recorder is off again', await js('!__rec.on && document.getElementById("recBtn").textContent === "Record"'));

  // ---------------------------------------------------------------- state dump read-back
  // A pedal state dump with gate reduction 70% in field 53 (fixed32 (70+108)/255) and the gate enabled.
  await js('state.stateBytes = Array.from(bytesFromHex("08 01 18 7F 20 7F 28 7F 30 7F 38 7F 40 36 48 03 AD 03 B3 B2 32 3F")); parseBufferedCurrentState()');
  await frame();
  check('gate reduction is read from the state dump (field 53)', (await js('state.gate.params[0].value')) === 70, String(await js('state.gate.params[0].value')));
  check('gate on is read from the state dump (field 54 absent)', await js('state.gate.on === true'));
  await js('state.stateBytes = Array.from(bytesFromHex("08 01 18 7F 20 7F 28 7F 30 7F 38 7F 40 36 48 03 C2 01 05 32 2E 33 2E 30 AD 03 B3 B2 32 3F")); parseBufferedCurrentState()'); await frame();
  check('firmware is read from the state dump (field 24)', (await js('state.firmware')) === '2.3.0', String(await js('state.firmware')));
  await js('state.firmware = "2.2.1"; render()');
  // Capture position 6 in bank 5 and cab slot 6: both straight from the library (PROTOCOL-NOTES §8, native repo).
  // fields: 9 bank 5, 11 position 6, 12 cab 6, 13 current preset, 32 {2: capture name}, 33 {2: IR short name}
  n0 = await txCount();
  await js(`(() => {
    const enc = (s) => Array.from(new TextEncoder().encode(s));
    const sub = (s) => [0x12, enc(s).length, ...enc(s)];
    const cap = sub('Rodent+SV 3'), ir = sub('110 US PRN C10R');
    state.stateBytes = [0x48, 5, 0x58, 6, 0x60, 6, 0x68, state.selectedPreset - 1, 0x82, 0x02, cap.length, ...cap, 0x8A, 0x02, ir.length, ...ir];
    parseBufferedCurrentState();
  })()`);
  await frame();
  await waitFor(async () => (await js('document.querySelector("[data-stage=cab] .sub").textContent')) === 'From the library: 110 US PRN C10R'); await settle();
  check('state dump: capture position 6 means "from the library", not slot 26', await js('state.capture.fromLibrary && state.capture.on && state.capture.activeSlot === null') && (await js('document.querySelector("[data-stage=capture] .sub").textContent')) === 'From the library: Rodent+SV 3', await js('document.querySelector("[data-stage=capture] .sub").textContent'));
  check('state dump: cab slot 6 means "from the library"', await js('state.cabIR.fromLibrary') && (await js('document.querySelector("[data-stage=cab] .sub").textContent')) === 'From the library: 110 US PRN C10R', await js('document.querySelector("[data-stage=cab] .sub").textContent'));
  check('state dump: no cab settings request for a library cab', !(await txSince(n0)).some(t => /Cab\/IR param refresh/.test(t)) && await js('__ui.logs.some(l => /param refresh skipped: the cab comes straight from the library/.test(l.text))'), JSON.stringify(await txSince(n0)));
  await js('state.stateBytes = [0x48, 2, 0x58, 3, 0x60, 2, 0x68, state.selectedPreset - 1]; parseBufferedCurrentState()'); await frame();
  await checkSoon('state dump: bank 2 position 3 is capture slot 8 and clears the library flags', '!state.capture.fromLibrary && !state.cabIR.fromLibrary && state.capture.selectedSlot === 8', () => js('String(state.capture.selectedSlot)'));
  await settle();
  await js('__demo.load(state.selectedPreset)'); await frame(); await settle();

  // ---------------------------------------------------------------- capture upload (Cortex Cloud → pedal)
  // Framing: a message that fits in one write is the ordinary `len C0 … type` frame.
  check('single-write stream frame equals the classic frame', (await js('[...NanoTransfer.chunks([1, 2, 3], 13)[0]].join(",")')) === '7,192,1,2,3,13,0,0,0');
  const fr = await js('NanoTransfer.chunks(Array.from({ length: 1100 }, (_, i) => i & 255), 13).map(c => [c.length, c[0], c[1]])');
  check('1.1 KB message streams as 3 writes of 500 bytes, last one padded', JSON.stringify(fr) === JSON.stringify([[500, 242, 0x41], [500, 242, 0x01], [500, 108, 0x80]]), JSON.stringify(fr));
  const meta = { hash: 'ab'.repeat(32), name: 'Test Capture', cloudUUID: '00000000-0000-4000-8000-000000000001', authorId: 'x', authorName: 'Tester', deviceType: 'pedal', gainType: 3, instrumentType: 'guitar', version: '1', tags: ['#test'] };
  n0 = await mark();
  // Not returned: executeJavaScript would otherwise wait for the whole upload flow (which waits for our keypress).
  await js('window.__uploadDone = __uploadCapture({ cns: btoa(String.fromCharCode(...Array.from({ length: 1200 }, (_, i) => i & 255))), meta: ' + JSON.stringify(meta) + ' }); 0');
  await checkSoon('upload asks for confirmation first', '!!document.querySelector(".modal") && /Send Test Capture/.test(document.querySelector(".modal h2").textContent)');
  await key('Return');
  tx = (await txWait(n0, tx => tx.filter(t => /^TX Capture upload/.test(t)).length >= 3)).filter(t => /^TX Capture upload/.test(t));
  check('upload streams the capture in 500-byte writes (first 0x41, last 0x80)', tx.length === 3 && /^TX Capture upload "Test Capture" 1\/3: [0-9A-F]{2} 41 /.test(tx[0]) && /^TX Capture upload "Test Capture" 3\/3: [0-9A-F]{2} 8[01] /.test(tx[2]), JSON.stringify(tx.map(t => t.slice(0, 60))));
  await checkSoon('(demo) pedal accepts and the reply is parsed', '__ui.logs.some(l => /Capture upload accepted: "Test Capture" user index 2/.test(l.text))', async () => JSON.stringify(await js('__ui.logs.slice(-6).map(l => l.text.slice(0, 90))')));
  await checkSoon('library is refreshed and lists it under user captures with that index', '(state.library.user.find(x => x.name === "Test Capture") || {}).index === 2');
  await checkSoon('then offers to load it into a slot', '!!document.querySelector(".modal") && /Load Test Capture/.test(document.querySelector(".modal h2").textContent)');
  await key('Return');
  await checkSoon('slot chooser opens for the new capture', '!!document.querySelector(".modal .slots")');
  await click('.modal [data-fk="pickslot-3"]'); n0 = await txCount();
  await key('Return');
  tx = await txWait(n0, tx => tx.some(t => /^TX Load library capture "Test Capture"/.test(t)), { timeout: 10000 });
  await checkSoon('new capture loads into slot 3 (user id 2)', async () => tx.some(t => /^TX Load library capture "Test Capture" into slot 3: .* 2A .* 08 02 12 /.test(t)) && (await js('state.captureNames.get(3)')) === 'Test Capture', JSON.stringify(tx));
  await checkSoon('upload flow finished cleanly', '!document.querySelector(".modal") && !__ui.uploading');
  await settle();

  // ---------------------------------------------------------------- write coalescing
  // Deterministic: the first write leaves at once, the next five queue behind it under one key and merge.
  n0 = await mark();
  await js('(async () => { const w = []; for (let i = 0; i < 6; i++) w.push(setAmpKnob("gain", 100 + i)); await Promise.all(w); })()');
  const burst = await txWait(n0, tx => tx.length >= 2);
  check('6 rapid writes to one knob coalesce to first + latest', burst.length === 2 && /Amp gain = 100:/.test(burst[0]) && /Amp gain = 105:/.test(burst[1]), JSON.stringify(burst));
  await js('__ui.sideSig = ""; render()'); await frame();

  // ---------------------------------------------------------------- drawer, shortcuts
  await key('l', [MOD]);
  check('Ctrl/⌘L opens activity', await js('document.getElementById("drawer").classList.contains("open")'));
  await js('document.getElementById("toast").classList.add("show"); document.getElementById("toast").textContent = "Placement check"');
  await stable('JSON.stringify([document.getElementById("toast").getBoundingClientRect(), document.getElementById("drawer").getBoundingClientRect()])');   // both have finished sliding in
  check('toast sits above the open Activity drawer', await js('document.getElementById("toast").getBoundingClientRect().bottom <= document.getElementById("drawer").getBoundingClientRect().top'));
  await shot('10-activity');
  await js('document.getElementById("toast").classList.remove("show")');
  await key('l', [MOD]);
  await js('document.activeElement.blur()');
  await key('?');
  check('? opens shortcuts', await js('!!document.querySelector(".modal .keys")'));
  check('(dev tools on) the shortcuts sheet lists ⌘L', await js('[...document.querySelectorAll(".modal .keys kbd")].some(k => /^(⌘|Ctrl\\+)L$/.test(k.textContent) && k.nextElementSibling.textContent === "Show Bluetooth activity")'));
  check('(dev tools on) the shortcuts sheet lists Record', await js('[...document.querySelectorAll(".modal .keys kbd")].some(k => k.textContent === "Record" && k.nextElementSibling.textContent === "In the status bar: record every packet, then save it as JSON")'));
  check('the shortcuts sheet lists each shortcut once (Settings appears a single time)', await js('(() => { const k = [...document.querySelectorAll(".modal .keys kbd")].map(x => x.textContent + "|" + x.nextElementSibling.textContent); return new Set(k).size === k.length && k.filter(x => x.endsWith("|Settings")).length === 1; })()'));
  check('the shortcuts sheet ends with "Full manual…" pointing at the manual', (await js('(() => { const a = document.querySelector(\'[data-fk="keys-manual"]\'); return a ? a.textContent + "|" + a.href : ""; })()')) === 'Full manual\u2026|' + LINKS.manual);
  await shot('11-shortcuts');
  await key('Escape');

  // ---------------------------------------------------------------- settings
  const settingsOpen = () => js('!!document.querySelector(".modal.settings-modal")');
  await js('document.activeElement.blur()');
  await key(',', [MOD]);
  await checkSoon('Ctrl/⌘, opens Settings', settingsOpen);
  check('Settings has Appearance, Metronome, Connection and Advanced', (await js('[...document.querySelectorAll(".settings h3")].map(h => h.textContent).join("|")')) === 'Appearance|Metronome|Connection|Advanced');
  check('the accent offers the seven Cortex Control colours, Purple selected', (await js('[...document.querySelectorAll(".swatch")].map(b => b.getAttribute("aria-label")).join(",")')) === 'Purple,Teal,Green,Orange,Yellow,Red,Blue' && await js('document.querySelector(".swatch.on").getAttribute("aria-label") === "Purple"'));
  await shot('17-settings');
  await key('Escape');
  await checkSoon('Esc closes Settings', async () => !(await settingsOpen()));
  check('Settings sits in the status bar, left of Shortcuts', await js('document.getElementById("settingsBtn").nextElementSibling.id === "keysBtn" && !!document.getElementById("settingsBtn").closest(".status")'));
  await click('#settingsBtn');
  await checkSoon('the status-bar Settings button opens it', settingsOpen);

  // accent
  const purpleRow = await js('getComputedStyle(document.querySelector(".preset-row.active")).backgroundColor');
  check('active preset row is the old purple by default (#2a2456)', (() => { const c = rgbOf(purpleRow); return !!c && Math.abs(c[0] - 42) <= 6 && Math.abs(c[1] - 36) <= 6 && Math.abs(c[2] - 86) <= 8; })(), purpleRow);
  await click('[data-fk="accent-orange"]');
  await checkSoon('choosing Orange sets --accent on :root', async () => (await js('getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()')) === '#ff7000');
  check('--accent-hi and --focus follow it (lighter shades)', await js('(() => { const s = getComputedStyle(document.documentElement); const h = s.getPropertyValue("--accent-hi").trim(), f = s.getPropertyValue("--focus").trim(); return /^#ff[89a-f][0-9a-f][0-9a-f]{2}$/.test(h) && /^#ff[a-f][0-9a-f][0-9a-f]{2}$/.test(f) && h !== f; })()'), await js('getComputedStyle(document.documentElement).getPropertyValue("--accent-hi") + " " + getComputedStyle(document.documentElement).getPropertyValue("--focus")'));
  check('the choice is stored (settings.accent)', (await js('JSON.parse(localStorage.getItem("settings.accent"))')) === '#ff7000');
  check('Orange shows as selected', await js('document.querySelector(".swatch.on").getAttribute("aria-label") === "Orange"'));
  await key('Escape'); await waitFor(async () => !(await settingsOpen()));
  await js('__ui.dirty = true; render()'); await frame();
  check('the Save button\'s background follows the accent', (await js('getComputedStyle(document.getElementById("saveBtn")).backgroundColor')) === 'rgb(255, 112, 0)', await js('getComputedStyle(document.getElementById("saveBtn")).backgroundColor'));
  check('text on the light accent turns dark for contrast', (await js('getComputedStyle(document.getElementById("saveBtn")).color')) === 'rgb(18, 18, 18)', await js('getComputedStyle(document.getElementById("saveBtn")).color'));
  await shot('18-orange-accent');
  await js('__ui.dirty = false; render()'); await frame();
  const orangeRow = rgbOf(await js('getComputedStyle(document.querySelector(".preset-row.active")).backgroundColor'));
  check('the active preset row colour follows the accent', !!orangeRow && orangeRow[0] > orangeRow[1] && orangeRow[1] > orangeRow[2] && orangeRow[0] > 50, JSON.stringify(orangeRow));
  const orangeNum = rgbOf(await js('getComputedStyle(document.querySelector(".preset-row.active .n")).color'));
  check('the active row number follows it too', !!orangeNum && orangeNum[0] > 240 && orangeNum[2] < orangeNum[1], JSON.stringify(orangeNum));
  const led = rgbOf(await js('getComputedStyle(document.querySelector(".brand .brand-led")).stroke'));
  check('the header mark\'s LED arc follows the accent', !!led && led[0] === 255 && led[2] < 80, JSON.stringify(led));

  // metronome
  await click('#settingsBtn'); await waitFor(settingsOpen);
  check('Connection: reconnect at launch is shown disabled, with the reason, outside the desktop app', await js('document.querySelector(\'[data-fk="set-autoconnect"]\').disabled && /Web Bluetooth/.test(document.querySelector(\'[data-fk="set-pedal"]\').textContent)'));
  check('Metronome offers Click, Woodblock, Tick, Beep and Cowbell', (await js('[...document.querySelectorAll(\'[data-fk="set-sound"] option\')].map(o => o.textContent).join(",")')) === 'Click,Woodblock,Tick,Beep,Cowbell');
  await js('{ const s = document.querySelector(\'[data-fk="set-sound"]\'); s.value = "tick"; s.dispatchEvent(new Event("change")); }');
  await click('[data-fk="set-preview"]');
  await checkSoon('Preview plays the chosen sound', async () => (await js('__metro.state.lastVoice')) === 'tick');
  await js('{ const s = document.querySelector(\'[data-fk="set-sound"]\'); s.value = "woodblock"; s.dispatchEvent(new Event("change")); }');
  check('the sound choice is stored with the metronome settings', (await js('JSON.parse(localStorage.getItem("metronome")).sound')) === 'woodblock');
  await js('{ const b = document.querySelector(\'[data-fk="set-bpm"]\'); b.value = "200"; b.dispatchEvent(new Event("change")); const v = document.querySelector(\'[data-fk="set-volume"]\'); v.value = "0.4"; v.dispatchEvent(new Event("input")); }');
  check('default tempo and volume land in the overlay\'s stored keys', await js('(() => { const m = JSON.parse(localStorage.getItem("metronome")); return m.bpm === 200 && m.volume === 0.4; })()'));
  await click('[data-fk="set-drawer"]');
  check('"Show the Activity drawer at launch" is stored', (await js('JSON.parse(localStorage.getItem("settings.drawerAtLaunch"))')) === true);
  // advanced metronome defaults
  check('Settings → Metronome adds Opens in, Pattern, Subdivision, Count-in and the three levels', (await js('[...document.querySelectorAll(".settings section")].find(x => x.querySelector("h3").textContent === "Metronome").textContent')).match(/Opens in|Pattern|Subdivision|Count-in|Accent level|Main ticks level|Subdivisions level/g).length === 7);
  check('Settings shows the levels set in the popover', await js('document.querySelector(\'[data-fk="set-lvl-accent"]\').value === "0.5" && document.querySelector(\'[data-fk="set-lvl-sub"]\').value === "0.25"'));
  check('Opens in defaults to Simple', (await js('document.querySelector(\'[data-fk="set-opens"]\').value')) === 'simple');
  for (const [fk, v] of [['set-opens', 'advanced'], ['set-pattern', '7/8'], ['set-subdiv', '3'], ['set-countin', '2']]) await js(`{ const s = document.querySelector('[data-fk="${fk}"]'); s.value = "${v}"; s.dispatchEvent(new Event("change")); }`);
  await js('{ const r = document.querySelector(\'[data-fk="set-lvl-main"]\'); r.value = "0.8"; r.dispatchEvent(new Event("input")); }');
  check('Settings pattern, subdivision and count-in set the advanced setup', await js('(() => { const m = JSON.parse(localStorage.getItem("metronome")); return m.opensIn === "advanced" && m.adv.beats === 7 && m.adv.note === 8 && m.adv.sub === 3 && m.adv.countIn === 2; })()'));
  check('the Settings level sliders are the same levels (stored)', (await js('JSON.parse(localStorage.getItem("metronome")).levels.main')) === 0.8);
  await key('Escape'); await waitFor(async () => !(await settingsOpen()));
  await js('document.activeElement.blur()');
  await key('n'); await waitFor('__metro.state.open');
  check('the metronome overlay shows the settings (200 BPM, volume 0.4)', await js('document.getElementById("metroBpm").value === "200" && document.getElementById("metroVol").value === "0.4"'));
  check('Settings "Opens in: Advanced" is honoured', await js('__metro.state.mode === "advanced" && !document.getElementById("metroAdv").hidden && document.querySelectorAll(".metro-cell").length === 7'));
  await key(' ');
  await checkSoon('the metronome schedules the chosen sound and still runs', '__metro.state.running && __metro.state.count >= 1 && __metro.state.lastVoice === "woodblock"', () => js('JSON.stringify({ r: __metro.state.running, c: __metro.state.count, v: __metro.state.lastVoice })'));
  await key(' ');
  await checkSoon('and still stops', '!__metro.state.running');
  await key('Escape'); await waitFor('!__metro.state.open');

  // persistence across a reload
  await reloadPage();
  check('the accent survives a reload', (await js('getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()')) === '#ff7000' && (await js('getComputedStyle(document.querySelector(".preset-row.active")).boxShadow')).includes('rgb(255, 112, 0)'));
  check('the sound and tempo survive a reload', await js('__metro.state.sound === "woodblock" && __metro.state.bpm === 200'));
  check('the Activity drawer opens at launch when set', await js('document.getElementById("drawer").classList.contains("open")'));
  check('the advanced setup, levels and Opens in survive a reload', await js('(() => { const s = __metro.state; return s.opensIn === "advanced" && s.adv.pattern.join() === "accent,soft,normal,soft,normal,soft,soft" && s.adv.note === 8 && s.adv.sub === 3 && s.adv.countIn === 2 && s.levels.accent === 0.5 && s.levels.main === 0.8 && s.levels.sub === 0.25; })()'));
  await js('document.activeElement.blur()');
  await key('n'); await waitFor('__metro.state.open');
  await checkSoon('after a reload the overlay opens in Advanced with the remembered pattern', () => js('__metro.state.mode === "advanced" && document.querySelector(\'[data-fk="metro-pattern"]\').value === "7/8" && document.querySelector(\'[data-fk="metro-sub-3"]\').classList.contains("on")'));
  await key('Escape'); await waitFor('!__metro.state.open');
  // back to the defaults for the rest of the run (and the next one)
  await js('__accent.set("#6954ff"); localStorage.removeItem("settings.drawerAtLaunch"); __metro.state.sound = "click"; __metro.state.volume = 0.6; __metro.state.opensIn = "simple"; __metro.state.mode = "simple"; __metro.state.adv = __metro.normSetup({}); Object.assign(__metro.state.levels, { accent: 1, main: 1, sub: 1 }); __metro.setBpm(100)');
  await key('l', [MOD]);
  check('Purple restores the original colours', (await js('getComputedStyle(document.documentElement).getPropertyValue("--accent-hi").trim()')) === '#7b68ff' && (await js('getComputedStyle(document.documentElement).getPropertyValue("--on-accent").trim()')) === '#ffffff');

  // the Dock / window icon, rendered the way the shell does it
  const { renderAccentIcon } = require('../src/accent-icon');
  const iconDir = path.join(OUT, 'icons');
  fs.rmSync(iconDir, { recursive: true, force: true });
  const ringPixel = (file) => { const img = nativeImage.createFromPath(file); const { width } = img.getSize(); const b = img.toBitmap(); const x = Math.round(width / 2), y = Math.round(width * 212 / 1024); const i = (y * width + x) * 4; return { size: width, rgb: [b[i + 2], b[i + 1], b[i]] }; };
  const orangeIcon = await renderAccentIcon('#FF7000', iconDir);
  const op = ringPixel(orangeIcon);
  check('the accent icon renders the LED ring in the accent (orange)', op.size === 1024 && op.rgb[0] > 200 && op.rgb[1] > 60 && op.rgb[1] < 170 && op.rgb[2] < 80, JSON.stringify(op));
  const pp = ringPixel(await renderAccentIcon('#6954ff', iconDir));
  check('the purple icon keeps the purple ring', pp.rgb[2] > 200 && pp.rgb[0] < 150, JSON.stringify(pp));
  const t0 = Date.now(); const again = await renderAccentIcon('#ff7000', iconDir);
  check('icons are cached per colour', again === orangeIcon && Date.now() - t0 < 100 && fs.readdirSync(iconDir).length === 2, fs.readdirSync(iconDir).join(','));

  // ---------------------------------------------------------------- expression pedal assignments
  // Bodies are the phone app's, byte for byte (trace 2026-10-09, docs/INVESTIGATION.md §10): preset 62 = index 0x3D.
  const expTx = async (n) => (await txSince(n)).filter(t => /^TX Save expression assignments/.test(t)).map(t => t.split(': ').pop());
  const expReads = async (n) => (await txSince(n)).filter(t => /^TX Expression assignments request/.test(t)).map(t => t.split(': ').pop());
  await js('__ui.dirty = false; state.presetDirty = false; render()'); await frame();
  await click('.preset-row[data-n="2"]'); await waitFor('state.selectedPreset === 2'); await settle();
  check('the chain has an EXP pill ahead of In', await js('(() => { const p = document.getElementById("expBtn").getBoundingClientRect(), o = document.querySelector(".chain-row .io").getBoundingClientRect(); return p.right < o.left && Math.abs((p.top + p.bottom) / 2 - (o.top + o.bottom) / 2) < 4; })()'));
  await checkSoon('the EXP pill counts preset 2\'s demo assignment', async () => (await js('document.getElementById("expCount").textContent')) === '1');
  n0 = await mark();
  await click('#expBtn');
  await waitFor(async () => (await expReads(n0)).length > 0); await settle();
  check('opening the Expression panel reads the set (60 {1:3 3:1})', (await expReads(n0)).some(h => h === '08 C0 08 03 18 01 3C 00 00 00'), JSON.stringify(await expReads(n0)));
  await waitFor('!!document.querySelector(\'[data-fk="exp-row-range-gain"]\')');
  check('the Expression panel opens in the inspector', (await js('document.querySelector(".insp-head h1").textContent')) === 'Expression pedal' && await js('document.getElementById("expBtn").classList.contains("selected")'));
  check('the panel names the preset', (await js('document.querySelector(".exp-preset").textContent')) === 'Preset 2 \u00b7 JP2C Lead');
  check('the demo Gain sweep is listed with Heel 0% / Toe 100% and its capture', await js('(() => { const r = document.querySelector(\'[data-fk="exp-row-range-gain"]\'); return !!r && r.querySelector(".exp-name").textContent === "Gain" && r.querySelector(".exp-sub").textContent === state.currentCapture.name && document.querySelector(\'[data-fk="exp-heel-gain"] .val\').textContent === "0%" && document.querySelector(\'[data-fk="exp-toe-gain"] .val\').textContent === "100%"; })()'));
  await shot('17-expression');
  check('the Expression row fits the inspector', await js('(() => { const i = document.getElementById("inspector"); return i.scrollWidth <= i.clientWidth + 1; })()'));

  // switching presets re-reads (preset 62 is empty in the demo)
  n0 = await mark();
  await click('.preset-row[data-n="62"]');
  await waitFor(async () => (await expReads(n0)).includes('08 C0 08 03 18 3D 3C 00 00 00')); await settle();
  await waitFor('!!document.querySelector(\'[data-fk="exp-empty"]\')');
  check('switching presets re-reads the assignments (60 {1:3 3:61})', (await expReads(n0)).includes('08 C0 08 03 18 3D 3C 00 00 00'), JSON.stringify(await expReads(n0)));
  check('an empty set shows the empty state', (await js('document.querySelector(\'[data-fk="exp-empty"]\')?.textContent || ""')) === 'No expression assignments. Plug an expression pedal into EXP/MIDI and assign a knob here.');
  check('the panel stays open across the switch', (await js('document.querySelector(".insp-head h1").textContent')) === 'Expression pedal');
  check('the EXP pill count is gone on an empty preset', await js('document.getElementById("expCount").hidden'));
  check('nothing marked dirty yet', await js('document.getElementById("dirtyMark").hidden'));

  const addTarget = async (name) => {
    await click('[data-fk="exp-add"]');
    const i = await waitFor(async () => { const k = await js(`[...document.querySelectorAll('.pop-item')].findIndex(e => e.textContent.startsWith(${JSON.stringify(name)}))`); return k >= 0 ? k + 1 : 0; }) - 1;
    if (i < 0) throw new Error('no Expression target ' + name);
    await click(`.pop-item[data-i="${i}"]`);
  };
  // Every expression edit sends one 62 with the whole set; wait for it and for the writes to settle.
  const expWait = async (n) => { await waitFor(async () => (await expTx(n)).length > 0); await settle(); return expTx(n); };
  n0 = await mark();
  await addTarget('Gain');
  await expWait(n0);
  check('adding a Gain sweep sends exactly the app\'s 62 (gain 0–255)', JSON.stringify(await expTx(n0)) === JSON.stringify(['0F C0 18 3D 22 07 08 00 10 00 18 FF 01 3E 00 00 00']), JSON.stringify(await expTx(n0)));
  await checkSoon('an expression edit marks the preset dirty', '!document.getElementById("dirtyMark").hidden');
  await checkSoon('the demo pedal answers 115 dirty', 'state.presetDirty === true');
  n0 = await mark();
  await addTarget('Bass');
  await expWait(n0);
  check('adding Bass sends the whole set again (gain + bass)', JSON.stringify(await expTx(n0)) === JSON.stringify(['18 C0 18 3D 22 07 08 00 10 00 18 FF 01 2A 07 08 00 10 00 18 FF 01 3E 00 00 00']), JSON.stringify(await expTx(n0)));
  n0 = await mark();
  await drag('[data-fk="exp-toe-bass"] svg', -40);
  const dragTx = await expWait(n0);
  check('dragging a range knob sends one 62 when released', dragTx.length === 1 && /2A 07 08 00 10 00 18 [0-9A-F]{2} /.test(dragTx[0]) && !/2A 07 08 00 10 00 18 FF 01/.test(dragTx[0]), JSON.stringify(dragTx));
  check('the Toe value follows the drag', (await js('state.exp.ranges.bass.max')) < 100, String(await js('state.exp.ranges.bass.max')));
  n0 = await mark();
  await click('[data-fk="exp-invert-range-bass"]');
  await expWait(n0);
  check('Invert sets field 1 of the range', /2A 07 08 01 10 00 18 /.test((await expTx(n0)).pop() || ''), JSON.stringify(await expTx(n0)));
  n0 = await mark();
  await click('[data-fk="exp-target-range-bass"]'); await waitFor('[...document.querySelectorAll(".pop-item")].some(e => e.textContent === "Mid")');
  { const i = await js('[...document.querySelectorAll(".pop-item")].findIndex(e => e.textContent === "Mid")'); await click(`.pop-item[data-i="${i}"]`); }
  await expWait(n0);
  check('the target menu moves the row to Mid, keeping its settings', /^.. C0 18 3D 22 07 08 00 10 00 18 FF 01 32 07 08 01 10 00 18 /.test((await expTx(n0)).pop() || '') && JSON.stringify(await js('__exp.assigned()')) === JSON.stringify(['range-gain', 'range-mid']), JSON.stringify(await expTx(n0)));
  n0 = await mark();
  await addTarget('Capture volume');
  await expWait(n0);
  check('Capture volume shows dB (heel −24.0 dB, toe +12.0 dB)', (await js('document.querySelector(\'[data-fk="exp-heel-level"] .val\').textContent')) === '-24.0 dB' && (await js('document.querySelector(\'[data-fk="exp-toe-level"] .val\').textContent')) === '+12.0 dB');
  check('Capture volume is field 13', /6A 07 08 00 10 00 18 FF 01 3E 00 00 00$/.test((await expTx(n0)).pop() || ''), JSON.stringify(await expTx(n0)));
  await click('[data-fk="exp-remove-range-level"]');
  await click('[data-fk="exp-remove-range-mid"]');
  await addTarget('Bass');
  n0 = await mark();
  await click('[data-fk="exp-remove-range-bass"]');
  await expWait(n0);
  check('Remove sends the set without it', JSON.stringify(await expTx(n0)) === JSON.stringify(['0F C0 18 3D 22 07 08 00 10 00 18 FF 01 3E 00 00 00']), JSON.stringify(await expTx(n0)));
  n0 = await mark();
  await click('[data-fk="exp-clear"]');
  await expWait(n0);
  check('Clear all sends the bare preset index (62 {3:61})', JSON.stringify(await expTx(n0)) === JSON.stringify(['06 C0 18 3D 3E 00 00 00']), JSON.stringify(await expTx(n0)));
  await checkSoon('after Clear all the empty state is back', '!!document.querySelector(\'[data-fk="exp-empty"]\')');
  await checkSoon('a cleared set reports the preset clean again (115)', 'state.presetDirty === false');

  n0 = await mark();
  await addTarget('Capture on/off');
  await expWait(n0);
  check('a Capture bypass defaults to heel-toe 600 ms, as the app sends it', JSON.stringify(await expTx(n0)) === JSON.stringify(['0F C0 18 3D 72 07 0A 05 08 00 10 D8 04 3E 00 00 00']), JSON.stringify(await expTx(n0)));
  await click('[data-fk="exp-remove-bypass-capture"]');
  n0 = await mark();
  await addTarget('Pre FX 2 on/off');
  await click('[data-fk="exp-mode-pre2-switch"]');
  await waitFor(async () => (await expTx(n0)).pop() === '0F C0 18 3D 8A 01 06 12 04 08 00 10 00 3E 00 00 00'); await settle();
  check('Pre FX 2 bypass as a switch sends latch off', (await expTx(n0)).pop() === '0F C0 18 3D 8A 01 06 12 04 08 00 10 00 3E 00 00 00', JSON.stringify(await expTx(n0)));
  n0 = await mark();
  await click('[data-fk="exp-latch-pre2"]');
  await expWait(n0);
  check('the Latch toggle sends the app\'s latch-on body', JSON.stringify(await expTx(n0)) === JSON.stringify(['0F C0 18 3D 8A 01 06 12 04 08 00 10 01 3E 00 00 00']), JSON.stringify(await expTx(n0)));
  await checkSoon('the Latch switch shows On', async () => (await js('document.querySelector(\'[data-fk="exp-latch-pre2"]\').getAttribute("aria-checked")')) === 'true');
  await shot('18-expression-switch');
  await key('b');
  check('B on the Expression panel does nothing (no stage to bypass)', (await js('document.querySelector(".insp-head h1").textContent')) === 'Expression pedal');

  // the demo pedal keeps the set per preset until a reload drops unsaved edits
  await js('__ui.dirty = false; render()'); await frame(); await settle();
  await click('.preset-row[data-n="2"]');
  await checkSoon('preset 2 still has its own Gain sweep', async () => JSON.stringify(await js('__exp.assigned()')) === JSON.stringify(['range-gain']), async () => JSON.stringify(await js('__exp.assigned()')));
  await settle();
  await key('1');
  check('1 leaves the Expression panel for the Gate', (await js('document.querySelector(".insp-head h1").textContent')) === 'Gate');
  n0 = await mark();
  await key('e');
  await waitFor(async () => (await expReads(n0)).length > 0); await settle();
  check('E opens the Expression panel and reads the set', (await js('document.querySelector(".insp-head h1").textContent')) === 'Expression pedal' && (await expReads(n0)).length === 1, JSON.stringify(await expReads(n0)));
  await key('4');
  // ---------------------------------------------------------------- Settings → Device, capture info
  // Bodies from the phone-app trace 2026-10-09 (docs/INVESTIGATION.md §11).
  const BRIGHT_153 = '0E C0 08 01 20 99 01 75 00 00 C0 C0 43 00 00 00';   // 67 {1:1 4:153 14:-6.0}
  const val = (fk) => js(`document.querySelector('[data-fk="${fk}"]')?.textContent || ''`);
  await js('document.activeElement.blur()');
  n0 = await mark();
  await click('#settingsBtn'); await waitFor(settingsOpen);
  check('Settings has General, Device and About tabs, General first', (await js('[...document.querySelectorAll(".settings-tabs [role=tab]")].map(b => b.textContent + (b.classList.contains("on") ? "*" : "")).join("|")')) === 'General*|Device|About');
  await settle();
  check('nothing is read from the pedal before the Device tab opens', (await txSince(n0)).length === 0);
  await click('[data-fk="set-tab-device"]');
  let sent = await txWait(n0, tx => tx.some(t => /^TX Read device settings/.test(t)) && tx.some(t => /^TX Read device info/.test(t)));
  check('opening the Device tab reads the settings (65) and the device info (46 with the clock)', sent.some(t => /^TX Read device settings: 06 C0 08 03 41 00 00 00$/.test(t)) && sent.some(t => /^TX Read device info: 0C C0 08 03 18( [0-9A-F]{2}){5} 2E 00 00 00$/.test(t)), JSON.stringify(sent));
  check('the General sections are hidden on the Device tab', await js('document.querySelector(".settings").hidden && !document.querySelector(".dev-page").hidden'));
  await checkSoon('Device: About shows the name, firmware (from the keep-alive 92) and serial', async () => (await val('dev-name')) === 'Neural DSP Nano Cortex' && (await val('dev-firmware')) === '2.2.1+demo' && (await val('dev-serial')) === 'NP00XXXXXX', async () => [await val('dev-name'), await val('dev-firmware'), await val('dev-serial')].join(' / '));
  check('Device: the hash is shortened, the full one in the tooltip', /^[0-9a-f]{8}…[0-9a-f]{6}$/.test(await val('dev-hash')) && (await js('document.querySelector(\'[data-fk="dev-hash"]\').title.length')) === 40);
  await checkSoon('Device: LED brightness reads 153 = 60 %, USB playback −6.0 dB', () => js('document.querySelector(\'[data-fk="dev-brightness"]\').value === "153" && document.querySelector(\'[data-fk="dev-brightness"]\').nextElementSibling.textContent === "60%" && document.querySelector(\'[data-fk="dev-usb-num"]\').value === "-6.0"'));
  check('Device: Raw settings is collapsed and lists the 66 fields', await js('(() => { const d = document.querySelector(\'[data-fk="dev-raw"]\'); return !d.open && /6=153/.test(d.textContent) && /17=-6(?![\\d.])/.test(d.textContent) && /13=129/.test(d.textContent); })()'), await js('document.querySelector(\'[data-fk="dev-raw"]\').textContent'));
  check('Device: no stray text above About', (await js('document.querySelector(".dev-page").firstChild.tagName')) === 'SECTION');
  check('Device: only brightness and USB volume are editable', (await js('document.querySelectorAll(".dev-page input").length')) === 3);
  await shot('xx-device');
  // brightness by keyboard: one step up and back to 153
  await js('document.querySelector(\'[data-fk="dev-brightness"]\').focus()');
  n0 = await mark();
  await key('Right'); await waitFor(async () => (await txSince(n0)).length >= 1);
  await key('Left');
  sent = await txWait(n0, tx => /LED brightness 153/.test(tx[tx.length - 1] || ''));
  check('LED brightness 154 is sent with the USB volume (67 {4:154 14:-6.0})', /: 0E C0 08 01 20 9A 01 75 00 00 C0 C0 43 00 00 00$/.test(sent[0] || ''), JSON.stringify(sent));
  check('moving LED brightness to 153 sends exactly 08 01 20 99 01 75 00 00 C0 C0', (sent[sent.length - 1] || '').endsWith(': ' + BRIGHT_153) && /LED brightness 153/.test(sent[sent.length - 1]), JSON.stringify(sent));
  check('the % follows the slider', (await js('document.querySelector(\'[data-fk="dev-brightness"]\').nextElementSibling.textContent')) === '60%');
  // USB volume: typed
  n0 = await mark();
  await click('[data-fk="dev-usb-num"]');
  await key('a', [MOD]); await type('-8.2'); await key('Return');
  sent = await txWait(n0);
  await waitFor('document.querySelector(\'[data-fk="dev-usb-num"]\').value === "-8.0"');
  check('typing −8.2 dB rounds to the 0.5 dB step and sends −8.0 (f32 00 00 00 C1)', sent.length === 1 && sent[0].endsWith(': 0E C0 08 01 20 99 01 75 00 00 00 C1 43 00 00 00') && (await js('document.querySelector(\'[data-fk="dev-usb-num"]\').value')) === '-8.0', JSON.stringify(sent));
  check('Enter in the dB field doesn\'t close Settings', await settingsOpen());
  n0 = await mark();
  await key('a', [MOD]); await type('-6'); await key('Return');
  sent = await txWait(n0);
  check('USB playback −6.0 dB sends exactly 08 01 20 99 01 75 00 00 C0 C0', sent.length === 1 && sent[0].endsWith(': ' + BRIGHT_153), JSON.stringify(sent));
  await checkSoon('the slider follows the typed value', async () => (await js('document.querySelector(\'[data-fk="dev-usb"]\').value')) === '-6');
  n0 = await mark();
  await js('{ const r = document.querySelector(\'[data-fk="dev-usb"]\'); for (let i = 1; i <= 10; i++) { r.value = String(-6 - i * 0.5); r.dispatchEvent(new Event("input")); } }');
  sent = await txWait(n0, tx => tx.some(t => t.includes('USB playback -11.0 dB')));
  check('dragging the USB slider coalesces the writes, the last value wins', sent.length >= 1 && sent.length <= 3 && sent[sent.length - 1].includes('USB playback -11.0 dB'), JSON.stringify(sent));
  await checkSoon('the pedal acknowledged every write (68)', async () => (await js('__ui.logs.filter(l => /Device settings confirmed/.test(l.text)).length')) >= 4);
  // read again: the (demo) pedal reports what was written
  n0 = await mark();
  await click('[data-fk="dev-read"]');
  sent = await txWait(n0, tx => tx.length >= 3);
  check('Read again re-sends 65, 46 and the keep-alive 91', sent.length === 3 && /Read device settings/.test(sent[0]) && /Read device info/.test(sent[1]) && /Keep-alive: 06 C0 08 03 5B 00 00 00$/.test(sent[2]), JSON.stringify(sent));
  await checkSoon('the read-back shows the stored values (153, −11.0 dB)', () => js('document.querySelector(\'[data-fk="dev-brightness"]\').value === "153" && document.querySelector(\'[data-fk="dev-usb-num"]\').value === "-11.0"'));
  await click('[data-fk="dev-usb-num"]');
  n0 = await txCount();
  await key('a', [MOD]); await type('-6'); await key('Return'); await txWait(n0);
  await key('Escape');
  await checkSoon('Esc closes Settings from the Device tab', async () => !(await settingsOpen()));
  await js('__openSettings("device"); 0');
  await checkSoon('Settings can open straight on the Device tab', () => js('document.querySelector(\'[data-fk="set-tab-device"]\').classList.contains("on") && !!document.querySelector(".dev-page:not([hidden])")'));
  await key('Escape'); await waitFor(async () => !(await settingsOpen())); await settle();

  // ---------------------------------------------------------------- outside links: support, About, manual
  // Every one opens in the default browser: no shell bridge here, so the page calls window.open, which the
  // handler in this file records and denies (the app's handler gives it to shell.openExternal).
  check('the links file matches package.json\'s version', LINKS.version === require('../package.json').version, LINKS.version);
  check('"♥ Support" sits at the right end of the status bar, after Activity', await js('(() => { const b = document.getElementById("supportBtn"); return !!b && b.textContent === "\u2665 Support" && b.previousElementSibling.id === "drawerBtn" && !b.nextElementSibling && b.title === "Support the project on Buy Me a Coffee (opens your browser)"; })()'));
  check('"♥ Support" is styled like the other status-bar buttons (no accent, no fill)', await js(`(() => {
    const s = getComputedStyle(document.getElementById("supportBtn")), k = getComputedStyle(document.getElementById("keysBtn"));
    const acc = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    return s.color === k.color && s.backgroundColor === k.backgroundColor && s.fontWeight === k.fontWeight && s.fontSize === k.fontSize && !s.color.includes(acc) && s.backgroundColor === "rgba(0, 0, 0, 0)"; })()`), await js('JSON.stringify([getComputedStyle(document.getElementById("supportBtn")).color, getComputedStyle(document.getElementById("supportBtn")).backgroundColor])'));
  opened.length = 0;
  n0 = await mark();
  await click('#supportBtn');
  await checkSoon('clicking "♥ Support" opens exactly the Buy Me a Coffee link, outside the app', () => opened.length === 1 && opened[0] === LINKS.support, () => JSON.stringify(opened));
  check('Support sends nothing to the pedal and changes nothing on screen', (await txSince(n0)).length === 0 && await js('!document.querySelector(".modal-bg") && !document.querySelector(".pop")') && BrowserWindow.getAllWindows().length === 1);
  await js('__openSettings("about"); 0');
  await waitFor('!!document.querySelector(\'[data-fk="about-page"]:not([hidden])\')');
  check('Settings → About shows the name and version', (await js('document.querySelector(".about-name")?.textContent')) === 'Nano Cortex Editor ' + LINKS.version && (await js('document.querySelector(\'[data-fk="about-version"]\').textContent')) === LINKS.version);
  check('Settings → About says who made it and carries the trademark note and licence', /Made by AJs Creations/.test(await js('document.querySelector(".about-page").textContent')) && /not affiliated with or endorsed by Neural DSP/.test(await val('about-trademark')) && /MIT/.test(await val('about-license')));
  const aboutLinks = await js('[...document.querySelectorAll(".about-links a")].map(a => a.textContent + "|" + a.href)');
  check('Settings → About links: repository, manual, native edition, Buy me a coffee', JSON.stringify(aboutLinks) === JSON.stringify(['GitHub repository|' + LINKS.repo, 'Manual|' + LINKS.manual, 'Native macOS edition|' + LINKS.mac, 'Buy me a coffee|' + LINKS.support]), JSON.stringify(aboutLinks));
  await shot('xx-settings-about');
  opened.length = 0;
  await click('[data-fk="about-support"]');
  await checkSoon('About → Buy me a coffee opens the link outside the app (Settings stays open)', async () => opened.length === 1 && opened[0] === LINKS.support && await settingsOpen(), () => JSON.stringify(opened));
  opened.length = 0;
  await click('[data-fk="about-manual"]');
  await checkSoon('About → Manual opens the manual', () => opened[0] === LINKS.manual, () => JSON.stringify(opened));
  await key('Escape'); await waitFor(async () => !(await settingsOpen())); await settle();

  // capture info from the slot grid and the chain node
  await click('[data-fk="node-capture"]');
  await rightClick('[data-fk="capslot-1"]');
  check('the capture slot menu offers Info…', await js(ctxItem('Info') + ' && !' + ctxItem('Info') + '.disabled'));
  n0 = await mark();
  await js(ctxItem('Info') + '.click()');
  sent = await txWait(n0);
  check('Info… on slot 1 sends 17 {3:0 5:1} (08 C0 18 00 28 01 11 00 00 00)', sent.length === 1 && sent[0].endsWith(': 08 C0 18 00 28 01 11 00 00 00'), JSON.stringify(sent));
  await waitFor('!!document.querySelector(\'[data-fk="cap-author"]\') && !!document.querySelector(\'[data-fk="cap-tags"] .chip\')');
  await stable('JSON.stringify(document.querySelector(".pop.cap-info")?.getBoundingClientRect())');
  check('capture info is a popover by the slot: Capture 1A, name, author and kind icons', await js('(() => { const p = document.querySelector(".pop.cap-info"), a = document.querySelector(\'[data-fk="capslot-1"]\').getBoundingClientRect(), r = p && p.getBoundingClientRect(); return !!p && p.querySelector(".cap-eyebrow").textContent === "Capture 1A" && p.querySelector(".cap-name").textContent === "Silver Jubilee Ch1" && Math.abs(r.top - a.bottom - 6) < 2; })()') && (await val('cap-author')) === 'by Neural DSP' && await js('!!document.querySelector(\'[data-fk="cap-type"] .kind\') && !!document.querySelector(\'[data-fk="cap-instrument"] .kind\')'), (await val('cap-author')) + ' / ' + (await js('document.querySelector(".cap-kinds")?.textContent')));
  check('capture info shows the tags as chips', (await js('[...document.querySelectorAll(\'[data-fk="cap-tags"] .chip\')].map(c => c.textContent).join(",")')) === 'Marshall,Jubilee,Crunch');
  check('capture info shows the description and the full hash', /slot 1/.test(await val('cap-desc')) && /^[0-9a-f]{8}…[0-9a-f]{6}$/.test(await val('cap-hash')) && (await js('document.querySelector(\'[data-fk="cap-hash"]\').title.length')) === 64 && await js('!!document.querySelector(\'[data-fk="cap-copy"]\')'));
  await shot('xx-capture-info');
  await key('Escape');
  await checkSoon('Esc closes capture info', '!document.querySelector(".cap-info")');
  const curSlot = await js('state.capture.selectedSlot');
  await rightClick('[data-fk="node-capture"]');
  n0 = await mark();
  await js(ctxItem('Info') + '?.click()');
  sent = await txWait(n0);
  await waitFor('!!document.querySelector(".cap-info")');
  check('Info… on the capture node asks for the active slot', sent.length === 1 && sent[0].endsWith(': 08 C0 18 ' + (curSlot - 1).toString(16).toUpperCase().padStart(2, '0') + ' 28 01 11 00 00 00') && await js('!!document.querySelector(".cap-info")'), curSlot + ' ' + JSON.stringify(sent));
  await key('Escape'); await waitFor('!document.querySelector(".cap-info")');
  await js('state.capture.fromLibrary = true; render()'); await frame();
  await rightClick('[data-fk="node-capture"]');
  check('Info… is greyed out when the capture comes straight from the library', await js(ctxItem('Info') + '?.disabled === true'));
  await key('Escape'); await js('state.capture.fromLibrary = false; render()'); await frame();
  // the real pedal's long reply (flags C1: the length's ninth bit), copied from a recorded phone-app session
  // (factory capture "CA John's Ch1 1"; the 64-hex capture hash replaced by a synthetic one of the same length)
  const reply18 = { hex: '2E C1 08 06 18 01 3A 16 0A 09 4E 65 75 72 61 6C 44 53 50 12 09 4E 65 75 72 61 6C 44 53 50 42 00 4A 40 30 31 32 33 34 35 36 37 38 39 61 62 63 64 65 66 30 31 32 33 34 35 36 37 38 39 61 62 63 64 65 66 30 31 32 33 34 35 36 37 38 39 61 62 63 64 65 66 30 31 32 33 34 35 36 37 38 39 61 62 63 64 65 66 52 0F 43 41 20 4A 6F 68 6E 27 73 20 43 68 31 20 31 5A B6 01 0A 40 30 31 32 33 34 35 36 37 38 39 61 62 63 64 65 66 30 31 32 33 34 35 36 37 38 39 61 62 63 64 65 66 30 31 32 33 34 35 36 37 38 39 61 62 63 64 65 66 30 31 32 33 34 35 36 37 38 39 61 62 63 64 65 66 12 0F 43 41 20 4A 6F 68 6E 27 73 20 43 68 31 20 31 22 16 0A 09 4E 65 75 72 61 6C 44 53 50 12 09 4E 65 75 72 61 6C 44 53 50 32 08 61 6D 70 5F 68 65 61 64 3A 0A 4D 65 73 61 62 6F 6F 67 69 65 3A 04 4A 50 32 43 3A 04 4D 65 73 61 3A 06 42 6F 6F 67 69 65 3A 04 4A 6F 68 6E 3A 08 50 65 74 72 75 63 63 69 40 04 52 06 67 75 69 74 61 72 58 01 62 01 31 68 00 12 00 00 00' };
  const parsed = await js(`(() => { let got = null; __dev.capWait = (i) => { got = i; }; const b = Uint8Array.from(${JSON.stringify(reply18.hex)}.split(' ').map(h => parseInt(h, 16))); onC305({ target: { value: { buffer: b.buffer } } }); return got; })()`);
  check('the traced 18 reply parses: name, author, amp_head, guitar, tags', !!parsed && parsed.name === "CA John's Ch1 1" && parsed.author === 'NeuralDSP' && parsed.type === 'amp_head' && parsed.instrument === 'guitar' && parsed.tags.join(',') === 'Mesaboogie,JP2C,Mesa,Boogie,John,Petrucci' && parsed.hash === '0123456789abcdef'.repeat(4), JSON.stringify(parsed));
  // a type-66 settings reply from the same session (device name, LED brightness 153, USB −6 dB)
  const reply66 = { hex: '36 C0 08 01 18 01 2A 16 4E 65 75 72 61 6C 20 44 53 50 20 4E 61 6E 6F 20 43 6F 72 74 65 78 30 99 01 38 01 40 01 58 00 60 01 68 81 01 70 01 8D 01 00 00 C0 C0 42 00 00 00' };
  const devBefore = await js('JSON.stringify(__dev.settings)');
  await js(`(() => { const b = Uint8Array.from(${JSON.stringify(reply66.hex)}.split(' ').map(h => parseInt(h, 16))); onC305({ target: { value: { buffer: b.buffer } } }); })()`);
  check('the traced 66 reply parses: name, brightness 153, USB −6.0 dB', await js('__dev.settings.name === "Neural DSP Nano Cortex" && __dev.settings.brightness === 153 && __dev.settings.usbDb === -6'), await js('JSON.stringify(__dev.settings)'));
  await js(`__dev.settings = ${devBefore}`);

  // ---------------------------------------------------------------- developer tools: off again, live
  for (const f of fs.readdirSync(OUT)) if (/^nano-session-.*\.json$/.test(f)) fs.unlinkSync(path.join(OUT, f));
  await js('document.activeElement.blur()');
  await click('#recBtn');
  await key('l', [MOD]);
  check('(dev tools on) recording and the Activity drawer are running', await js('__rec.on && __ui.drawerOpen'));
  await key(',', [MOD]); await waitFor(settingsOpen);
  await click('[data-fk="set-devtools"]');
  check('turning Developer tools off stops the recording and closes the drawer', await js('!__rec.on && !__ui.drawerOpen && !document.getElementById("drawer").classList.contains("open")'));
  check('turning it off hides the Activity-at-launch row live', !(await shown('[data-fk="set-drawer"]')) && (await js('localStorage.getItem("settings.devTools")')) === 'false');
  await key('Escape'); await waitFor(async () => !(await settingsOpen()));
  check('turning it off hides Record, Activity and "Sent: …" at once', !(await shown('#recBtn')) && !(await shown('#drawerBtn')) && !/^Sent: /.test(await js('document.getElementById("lastAction").textContent')));
  const stopped = await waitFor(async () => fs.readdirSync(OUT).find(f => { if (!/^nano-session-.*\.json$/.test(f)) return false; try { JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')); return true; } catch { return false; } }));
  check('the stopped recording is saved, as clicking Record would', !!stopped, String(stopped));
  await js('document.activeElement.blur()');
  await key('l', [MOD]);
  check('⌘L does nothing again', await js('!__ui.drawerOpen'));
  await settle();

  // ---------------------------------------------------------------- disconnected / demo exit
  await click('#connectBtn');
  await checkSoon('Exit demo shows connect screen', '!document.getElementById("veil").hidden');
  check('connect screen offers Connect + demo', (await js('[...document.querySelectorAll(".veil-card .btn")].map(b=>b.textContent).join("|")')).includes('Explore with demo data'));
  check('connect screen: "New here? Read the manual" points at the manual', (await js('(() => { const a = document.querySelector(\'[data-fk="veil-manual"]\'); return a ? a.parentElement.textContent + "|" + a.href : ""; })()')) === 'New here? Read the manual|' + LINKS.manual);
  check('connect screen: no Troubleshooting link without an error', await js('!document.querySelector(\'[data-fk="veil-troubleshoot"]\')'));
  for (const [raw, what] of [['NotFoundError: User cancelled the requestDevice() chooser.', null], ['NotFoundError: Bluetooth adapter not available.', 'Bluetooth unavailable']]) {
    await js(`log(${JSON.stringify('Connect failed: ' + raw)}); render()`); await frame();
    const t = await js('(() => { const a = document.querySelector(\'[data-fk="veil-troubleshoot"]\'); return a ? a.textContent + "|" + a.href : ""; })()');
    if (what) check('connect error (' + what + ') links Troubleshooting in the manual', t === 'Troubleshooting|' + LINKS.troubleshooting, t);
    else check('a cancelled chooser has no Troubleshooting link', t === '', t);
  }
  await js('window.__bleHint = "none-found"; log("Connect failed: NotFoundError: x"); render()'); await frame();
  check('connect error (pedal not found) links Troubleshooting in the manual', (await js('document.querySelector(\'[data-fk="veil-troubleshoot"]\')?.href')) === LINKS.troubleshooting && /No Nano Cortex showed up/.test(await js('document.querySelector(".veil-card .err").textContent')));
  await shot('xx-connect-error');
  await js('__ui.connectError = ""; render()'); await frame();
  await shot('12-disconnected');
  check('disconnected sidebar explains instead of listing fake presets', (await js('document.querySelectorAll(".preset-row").length')) === 0 && (await js('document.querySelector(".side-empty")?.textContent || ""')).includes('once the pedal is connected'));
  check('status bar cleared on disconnect', (await js('document.getElementById("lastAction").textContent')) === '');
  check('status bar says No pedal when disconnected', (await js('document.getElementById("bleText").textContent')) === 'No pedal' && (await js('document.getElementById("bleLed").className')) === 'led');
  await js('__ui.connecting = true; render()'); await frame();
  check('status bar says Connecting… with a busy LED', (await js('document.getElementById("bleText").textContent')) === 'Connecting…' && (await js('document.getElementById("bleLed").className')) === 'led busy');
  await js('__ui.connecting = false; render()'); await frame();
  await js('__openSettings("device"); 0');
  await checkSoon('Settings → Device without a pedal: explains, controls disabled, nothing sent', () => js('!!document.querySelector(\'[data-fk="dev-offline"]\') && [...document.querySelectorAll(".dev-page input, .dev-page button")].every(x => x.disabled) && document.querySelector(\'[data-fk="dev-serial"]\').textContent === "\u2014"'));
  await key('Escape'); await waitFor(async () => !(await settingsOpen()));
  check('Save disabled while disconnected', await js('document.getElementById("saveBtn").disabled'));
  await key('s', [MOD]);
  check('⌘S while disconnected explains', (await js('document.getElementById("toast").textContent')).includes('Connect'));
  await click('.veil-card .btn:last-child');
  await checkSoon('demo restarts from connect screen', 'state.connected && __ui.demo');
  await settle();

  // ---------------------------------------------------------------- narrow window
  win.setContentSize(820, 700);
  await waitFor('innerWidth === 820'); await stable('JSON.stringify([innerWidth, innerHeight, document.documentElement.scrollWidth, document.querySelector(".chain-wrap")?.scrollWidth])');
  await shot('13-narrow');
  check('narrow: chain scrolls instead of squashing', await js('document.querySelector(".chain-wrap").scrollWidth > document.querySelector(".chain-wrap").clientWidth'));
  check('narrow: no page-level horizontal scroll', await js('document.documentElement.scrollWidth <= window.innerWidth'), await js('JSON.stringify([...document.querySelectorAll("body *")].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest(".chain-wrap")).slice(0,6).map(e => e.tagName + "." + e.className + ":" + Math.round(e.getBoundingClientRect().right)))'));
  await click('#sideToggle');
  check('narrow: Presets button reveals sidebar', await js('getComputedStyle(document.querySelector(".side")).display !== "none"'));
  await shot('14-narrow-side');
  await click('.preset-row[data-n="4"]');
  check('narrow: picking a preset closes sidebar', await js('getComputedStyle(document.querySelector(".side")).display === "none"'));
  // phone width
  win.setContentSize(420, 860);
  await waitFor('innerWidth === 420'); await stable('JSON.stringify([innerWidth, innerHeight, document.documentElement.scrollWidth, document.querySelector(".chain-wrap")?.scrollWidth])');
  await shot('15-phone');
  check('phone: no page-level horizontal scroll', await js('document.documentElement.scrollWidth <= window.innerWidth'));
  check('phone: header fits on one row', await js('(() => { const h = document.querySelector(".head"); return h.scrollWidth <= h.clientWidth + 1; })()'));
  check('phone: status bar fits', await js('(() => { const h = document.querySelector(".status"); return h.scrollWidth <= h.clientWidth + 1; })()'));
  check('phone: inspector content fits its width', await js('(() => { const i = document.getElementById("inspector"); return i.scrollWidth <= i.clientWidth + 1; })()'), String(await js('document.getElementById("inspector").scrollWidth + " vs " + document.getElementById("inspector").clientWidth')));
  await key('5');
  await shot('16-phone-cab');
  check('phone: cab controls fit', await js('(() => { const i = document.getElementById("inspector"); return i.scrollWidth <= i.clientWidth + 1; })()'), String(await js('document.getElementById("inspector").scrollWidth + " vs " + document.getElementById("inspector").clientWidth')));
  await key('4');
  win.setContentSize(1400, 900);
  await waitFor('innerWidth === 1400'); await stable('JSON.stringify([innerWidth, innerHeight, document.documentElement.scrollWidth, document.querySelector(".chain-wrap")?.scrollWidth])');

  // ---------------------------------------------------------------- render cost sanity
  const t = await js(`(() => { const t0 = performance.now(); for (let i=0;i<20;i++){ __ui.sideSig=''; render(); } return new Promise(r => requestAnimationFrame(() => r(performance.now()-t0))); })()`);
  check('full render is fast', t < 120, t.toFixed(1) + ' ms');

  // ---------------------------------------------------------------- the Activity drawer never opens at launch while dev tools are off
  await js('localStorage.setItem("settings.drawerAtLaunch", "true"); localStorage.setItem("settings.devTools", "false")');
  await reloadPage();
  check('with Developer tools off, "Activity at launch" does not open the drawer', await js('!__ui.drawerOpen && !__devTools.on && !document.body.classList.contains("dev-tools")'));
  await js('localStorage.removeItem("settings.drawerAtLaunch"); localStorage.removeItem("settings.devTools")');

  // ---------------------------------------------------------------- shortcut labels per platform
  // ⌘ on macOS, Ctrl on Windows and Linux. The page's own platform first, then the others via ?platform=… (labels only;
  // the key handlers keep following the real platform).
  const labelsFor = async (plat) => {
    const loaded = new Promise(r => wc.once('did-finish-load', r));
    await win.loadURL('file://' + PAGE + '?demo' + (plat ? '&platform=' + plat : ''));
    await loaded; await waitFor('typeof __ui !== "undefined" && __ui.demo && state.connected'); await settle(); await frame();
    await js('document.activeElement.blur()');
    await key('?'); await waitFor('!!document.querySelector(".modal .keys")');
    const r = await js(`({ kbd: document.querySelector("#saveBtn kbd").textContent, saveTitle: document.getElementById("saveBtn").title,
      saveAsTitle: document.getElementById("saveAsBtn").title, settingsTitle: document.getElementById("settingsBtn").title,
      sheet: [...document.querySelectorAll(".modal .keys kbd")].map(k => k.textContent) })`);
    await key('Escape'); await waitFor('!document.querySelector(".modal")');
    return r;
  };
  const expectLabels = (name, r, mac) => {
    const S = mac ? '\u2318S' : 'Ctrl+S', SS = mac ? '\u21e7\u2318S' : 'Ctrl+Shift+S', C = mac ? '\u2318,' : 'Ctrl+,';
    check(name + ': the Save button shows ' + S, r.kbd === S && r.saveTitle.endsWith('(' + S + ')'), r.kbd + ' | ' + r.saveTitle);
    check(name + ': tooltips use ' + (mac ? '\u2318 and \u21e7' : 'Ctrl and Shift'), r.saveAsTitle.endsWith('(' + SS + ')') && r.settingsTitle === 'Settings (' + C + ')', r.saveAsTitle + ' | ' + r.settingsTitle);
    check(name + ': the shortcuts sheet lists ' + S + ' and ' + SS, r.sheet.includes(S) && r.sheet.includes(SS) && r.sheet.includes(C), r.sheet.join(' , '));
    check(name + ': no ' + (mac ? 'Ctrl' : '\u2318, \u21e7 or \u2325') + ' left in the labels', mac ? !/Ctrl/.test(r.sheet.join() + r.kbd + r.saveTitle) : !/[\u2318\u21e7\u2325]/.test(r.sheet.join() + r.kbd + r.saveTitle + r.saveAsTitle + r.settingsTitle));
  };
  const hostMac = process.platform === 'darwin';
  expectLabels('labels on this platform (' + process.platform + ')', await labelsFor(''), hostMac);
  for (const plat of hostMac ? ['win', 'linux'] : ['mac']) expectLabels('labels with ?platform=' + plat, await labelsFor(plat), plat === 'mac');
  if (!hostMac) await labelsFor('linux');   // the page is on mac labels after the loop above
  check('keyLabel off-Mac: \u2325\u2318I → Ctrl+Alt+I, \u2318\u2191 → Ctrl+\u2191', (await js('__keyLabel("\u2325\u2318I / \u2318\u2191")')) === 'Ctrl+Alt+I / Ctrl+\u2191');
  await labelsFor('');

  // ---------------------------------------------------------------- newer firmware, unknown effects
  // Version comparison: numeric per component, suffixes ignored, anything else is "not newer".
  const fwCases = { '2.2.1': false, '2.2.2': true, '2.3.0': true, '3.0': true, '2.2.1+abc': false, '2.10.0': true, '2.2': false, '2.1.9': false, garbage: false, '': false };
  for (const [v, want] of Object.entries(fwCases)) check('firmware ' + JSON.stringify(v) + (want ? ' is' : ' is not') + ' newer than 2.2.1', (await js(`__firmware.isNewer(${JSON.stringify(v)})`)) === want);
  check('firmware compare: 2.10.0 > 2.9.9, 3.0 = 3.0.0, garbage → null', (await js('[__firmware.compare("2.10.0", "2.9.9"), __firmware.compare("3.0", "3.0.0"), __firmware.compare("x", "2.2.1")].join()')) === '1,0,');
  check('the tested firmware is 2.2.1', (await js('__firmware.tested')) === '2.2.1');
  check('firmware 2.2.1 (plain demo): no newer-firmware notice', await js('document.getElementById("fwNotice").hidden'));
  await js('localStorage.removeItem("settings.firmwareWarned")');
  const loadDemo = async (query) => {
    const loaded = new Promise(r => wc.once('did-finish-load', r));
    await win.loadURL('file://' + PAGE + '?demo' + query);
    await loaded; await waitFor('typeof __ui !== "undefined" && __ui.demo && state.connected'); await settle(); await frame();
  };
  await loadDemo('&demoFirmware=2.2.1');
  check('firmware 2.2.1 reported: no notice, nothing remembered', await js('document.getElementById("fwNotice").hidden && localStorage.getItem("settings.firmwareWarned") === null'));
  await loadDemo('&demoFirmware=2.3.0&demoUnknown=post2:7E');
  const NOTICE = 'This firmware is newer than the editor has been tested with. Some new effects may not be editable until this app is updated.';
  await checkSoon('firmware 2.3.0: the notice shows under the header', 'document.getElementById("fwNotice").hidden === false');
  check('the notice has the agreed text and no modal', (await js('document.querySelector("#fwNotice .txt").textContent')) === NOTICE && !(await js('!!document.querySelector(".modal")')));
  check('the notice remembers firmware 2.3.0', (await js('localStorage.getItem("settings.firmwareWarned")')) === '"2.3.0"');
  const unknownLog = () => js('__ui.logs.filter(l => l.text === "Unknown effect id 0x7E in Post FX 2 (firmware 2.3.0)").length');
  check('one log line for the unknown id', (await unknownLog()) === 1, String(await unknownLog()));
  check('unknown effect: node title and subtitle', (await js('document.querySelector("[data-stage=post2] .model").textContent + " | " + document.querySelector("[data-stage=post2] .sub").textContent')) === 'Unknown effect | Newer firmware?');
  check('unknown effect: the subtitle is not clipped', await js('(() => { const e = document.querySelector("[data-stage=post2] .sub"); return e.scrollWidth <= e.clientWidth + 1; })()'), await js('(() => { const e = document.querySelector("[data-stage=post2] .sub"); return e.scrollWidth + " > " + e.clientWidth; })()'));
  check('unknown effect: no parameter or refresh packet for Post FX 2 since connecting', (await js('__ui.logs.filter(l => l.cls === "tx" && /^TX Post FX 2/.test(l.text)).length')) === 0);
  await shot('newer-firmware');
  await click('[data-fk="fw-notice-close"]');
  check('Dismiss hides the notice', await js('document.getElementById("fwNotice").hidden'));
  let m0 = await mark();
  await click('[data-stage=post2]');
  check('unknown effect: inspector note', (await js('document.querySelector("[data-fk=unknown-note-post2]")?.textContent')) === "This effect isn't in the editor's list yet, so its settings can't be edited here. It still plays as saved on the pedal. Update the editor to edit it.");
  check('unknown effect: no knobs, picker says Unknown effect', await js('!document.querySelector(".inspector .knob") && document.querySelector("[data-fk=picker-post2]").textContent.startsWith("Unknown effect")'));
  await shot('unknown-effect');
  await settle();
  check('selecting the unknown block sends nothing', (await txSince(m0)).length === 0, (await txSince(m0)).join(' | '));
  m0 = await mark();
  await click('[data-fk="switch-post2"]');
  await txWait(m0);
  const off = await txSince(m0);
  check('unknown effect: the switch sends the enable write (off)', off.length === 1 && off[0] === 'TX Post FX 2 OFF: 0A C0 08 01 18 07 20 01 1F 00 00 00', off.join(' | '));
  m0 = await mark();
  await click('[data-fk="switch-post2"]');
  await txWait(m0); await settle({ quiet: 600 });
  const on = await txSince(m0);
  check('unknown effect: on sends the enable write and no parameter refresh', on.length === 1 && on[0] === 'TX Post FX 2 ON: 0A C0 08 01 18 07 20 00 1F 00 00 00', on.join(' | '));
  m0 = await mark();
  await js('setFXParam("post2", { index: 0, value: 1, meta: { kind: "range", min: 0, max: 10, step: 0.1 } }); state.paramRefreshQueue = ["post2"]; requestNextFXParamRefresh();');
  await settle();
  check('unknown effect: parameter writes and refresh requests are refused', (await txSince(m0)).length === 0, (await txSince(m0)).join(' | '));
  await click('[data-fk="exp-pill"]');
  await waitFor('!!document.querySelector(\'[data-fk="exp-add"]:not([disabled])\')');
  await click('[data-fk="exp-add"]');
  await waitFor('!!document.querySelector(".pop")');
  check('expression targets: Post FX 2 shows as Unknown effect', await js('[...document.querySelectorAll(".pop-item")].some(x => x.textContent.startsWith("Post FX 2") && x.title === "Unknown effect")'));
  await key('Escape'); await waitFor('!document.querySelector(".pop")');
  await click('[data-stage=post2]');
  m0 = await mark();
  await click('[data-fk="picker-post2"]');
  await waitFor('!!document.querySelector(".pop")');
  check('picker: nothing is marked current for the unknown effect', await js('!document.querySelector(".pop-item.cur")'));
  await type('Tape Delay'); await key('Return');
  await txWait(m0, (tx) => tx.some(t => /model select/.test(t)));
  check('picking a known effect replaces the unknown one', (await js('document.querySelector("[data-stage=post2] .model").textContent')) === 'Tape Delay' && (await txSince(m0)).some(t => t.startsWith('TX Post FX 2 model select Tape Delay')), (await txSince(m0)).join(' | '));
  check('a known effect shows its knobs again', await js('!!document.querySelector(".inspector .knob") && !document.querySelector("[data-fk=unknown-note-post2]")'));
  await loadDemo('&demoFirmware=2.3.0&demoUnknown=post2:7E');
  check('reconnecting on 2.3.0: the notice does not come back', await js('document.getElementById("fwNotice").hidden'));
  check('reconnecting: the unknown effect is reported again', (await js('document.querySelector("[data-stage=post2] .model").textContent')) === 'Unknown effect');
  await js('localStorage.removeItem("settings.firmwareWarned")');
  await loadDemo('');

  // ---------------------------------------------------------------- Bluetooth chooser (issue #15)
  // The shell's picker (src/bt-picker.js) with fake devices, its chooser drawn by this page and answered with real
  // clicks. The test carries the messages between them, as the shell's IPC does: views to __bleChooser.show(),
  // the page's choices (__ble.choices) and connect results (__ble.results) back to the picker.
  {
    const { createBluetoothPicker, sortDevices, realName } = require('../src/bt-picker');
    const dev = (deviceId, deviceName = '') => ({ deviceId, deviceName });
    const OTHERS = [dev('AA:01', 'JBL Flip 5'), dev('AA:02', 'Razer Nomv2X LE'), dev('AA:03', 'Bose QC45'), dev('AA:04'),
      dev('AA:05', 'Logitech MX Keys'), dev('AA:06', 'Nanoleaf Shapes'), dev('AA:07', 'Unknown or Unsupported Device (AA:07)'),
      dev('AA:08', 'Galaxy Buds2'), dev('AA:09', 'Sonos Roam'), dev('AA:0A', 'Cortex Speaker'), dev('AA:0B', 'Apple Watch'), dev('AA:0C')];
    const NANO = dev('NN:01', 'Neural DSP Nano Cortex');
    let saved = null;
    let pageQueue = Promise.resolve();
    const makePicker = () => {
      const p = { again: [], hints: [], picked: [] };
      p.picker = createBluetoothPicker({
        store: { get: () => saved, set: (v) => { saved = v; } },
        show: (view) => { pageQueue = pageQueue.then(() => js('__bleChooser.show(' + JSON.stringify(view) + ')')); },
        hint: async (h) => { p.hints.push(h); }, connectAgain: (o) => p.again.push(o), chooserMs: 40, autoMs: 150,
      });
      p.cb = (id) => p.picked.push(id);
      return p;
    };
    const synced = async () => { await pageQueue; await frame(); };
    const toShell = async (p) => {   // the page's answers, as the preload bridge would carry them
      for (const c of await js('__ble.choices.splice(0)')) p.picker.choose(c);
      for (const k of await js('__ble.results.splice(0)')) p.picker.result(k);
    };
    const chooserUp = () => js('!!document.querySelector(".bt-chooser")');
    const rowsText = () => js('[...document.querySelectorAll(".bt-row")].map(r => r.querySelector(".name").textContent + (r.querySelector(".tag") ? " [" + r.querySelector(".tag").textContent + "]" : "") + (r.textContent === r.querySelector(".name").textContent + (r.querySelector(".tag")?.textContent || "") ? "" : " <stray text>"))');
    // The core's log lines when the picked device has no A002/A003 (from the issue's log).
    const failNoService = () => js(`(() => { for (const u of ['0000a002', '0000a003']) log('Service unavailable ' + u + '-0000-1000-8000-00805f9b34fb: No Services matching UUID ' + u + '-0000-1000-8000-00805f9b34fb found in Device.');
      log('Connect failed: C304/C305 not found under A002/A003'); })()`);
    await js('__ble.choices.length = 0; __ble.results.length = 0');

    // Order and names
    const order = sortDevices(OTHERS.map(d => ({ id: d.deviceId, name: realName(d.deviceName, d.deviceId) })), { notNano: new Set(['AA:02']) }).map(d => d.id);
    check('chooser order: Nano-like names, then unnamed devices, then the rest, then devices that failed the service check',
      order.join() === 'AA:06,AA:0A,AA:04,AA:07,AA:0C,AA:01,AA:03,AA:05,AA:08,AA:09,AA:0B,AA:02', order.join());
    check('a name made from the address ("Unknown or Unsupported Device (…)") counts as unnamed', realName('Unknown or Unsupported Device (AA:07)', 'AA:07') === '' && realName('Neural DSP Nano Cortex', 'NN:01') === 'Neural DSP Nano Cortex');

    // A fresh install scans for the Nano's service; a pedal found that way is taken at once, even without a name.
    let p = makePicker();
    check('with nothing remembered, Connect scans for the Nano Cortex service only ("nano" scan)', p.picker.beginRequest({}) === 'nano');
    p.picker.onSelect([dev('NN:02')], p.cb);
    check('"nano" scan: the first device offering the service is picked without a chooser, even unnamed', p.picked.join() === 'NN:02' && !(await chooserUp()));
    check('picking it does not remember it yet', saved === null);
    await js('__ui.demo = false; setStatus("Connected", true); __ui.demo = true'); await toShell(p);
    check('remembered once the editor found C304/C305 on it (the page reports "ok")', saved && saved.id === 'NN:02' && saved.via === 'nano' && saved.name === 'Nano Cortex', JSON.stringify(saved));
    saved = null;

    // Nothing found yet: the chooser waits, with the pairing hint and the way to every device.
    p = makePicker();
    p.picker.beginRequest({});
    p.picker.onSelect([], p.cb);
    await waitFor(chooserUp); await synced();
    check('"nano" scan, nothing yet: "Looking for your Nano Cortex" with the pairing hint',
      (await js('document.querySelector("[data-fk=bt-title]").textContent')) === 'Looking for your Nano Cortex'
      && /^Put the Nano Cortex in pairing mode: hold EXIT \+ CAPTURE for about a second, until the Gain ring lights up\./.test(await js('document.querySelector("[data-fk=bt-hint]").textContent')),
      await js('document.querySelector("[data-fk=bt-hint]").textContent'));
    check('"nano" scan: an empty list explains itself and offers Show all Bluetooth devices', await js('!!document.querySelector("[data-fk=bt-empty]") && !document.querySelector("[data-fk=bt-all]").hidden'));
    await shot('bt-chooser-waiting');
    await click('[data-fk="bt-all"]');
    check('Show all Bluetooth devices closes the chooser and asks for an "all" scan', !(await chooserUp()) && JSON.stringify(await js('__ble.choices')) === '["all"]');
    await toShell(p);
    check('… which cancels the filtered request (the page starts the next one)', p.picked.join() === '' && p.picked.length === 1);

    // Every device nearby: all listed, sorted, live, nothing remembered by picking.
    p = makePicker();
    check('the fallback list is an "all" scan', p.picker.beginRequest({ want: 'all' }) === 'all');
    p.picker.onSelect(OTHERS.slice(0, 3), p.cb);
    await waitFor(chooserUp); await synced();
    check('"all" scan: no Nano-like name, so the chooser opens', (await js('document.querySelector("[data-fk=bt-title]").textContent')) === 'Choose your Nano Cortex' && (await js('document.querySelector("[data-fk=bt-all]").hidden')));
    p.picker.onSelect(OTHERS, p.cb);
    await synced();
    const listed = await rowsText();
    check('more than 8 devices: all 12 are listed (no cap)', listed.length === 12, listed.length + ': ' + listed.join(' | '));
    check('the list updates while the chooser stays open', await chooserUp() && /Scanning… 12 devices nearby\./.test(await js('document.querySelector("[data-fk=bt-status]").textContent')));
    check('in the chooser: Nano-like names first, then unnamed devices, then the rest',
      listed.slice(0, 5).join(' | ') === 'Nanoleaf Shapes [Looks like a Nano Cortex] | Cortex Speaker [Looks like a Nano Cortex] | Unnamed device · …AA04 | Unnamed device · …AA07 | Unnamed device · …AA0C'
      && listed[5] === 'JBL Flip 5', listed.join(' | '));
    check('the list scrolls instead of growing past the window', await js('(() => { const l = document.querySelector(".bt-list"); return l.scrollHeight > l.clientHeight + 20 && document.querySelector(".bt-chooser").getBoundingClientRect().bottom <= innerHeight; })()'));
    await shot('bt-chooser-all');
    const razer = await js('[...document.querySelectorAll(".bt-row")].findIndex(r => r.dataset.id === "AA:02")');
    await click('[data-fk="bt-dev-' + razer + '"]');   // scrolled into view, then a real click
    await toShell(p);
    check('clicking a row picks that device', p.picked.join() === 'AA:02' && !(await chooserUp()));
    await failNoService(); await toShell(p);
    check('a non-Nano pick is not remembered (its services were not found)', saved === null && p.picker.notNano.has('AA:02'));
    check('… and the chooser is asked for again, with a notice', JSON.stringify(p.again) === '[{"want":"all","choose":true,"notice":"not-nano"}]', JSON.stringify(p.again));
    p.picker.beginRequest(p.again[0]);
    p.picker.onSelect(OTHERS, p.cb);
    await waitFor(chooserUp); await synced();
    const again = await rowsText();
    check('the device that failed sorts last, marked "Not a Nano Cortex", and the notice says why',
      again[again.length - 1] === 'Razer Nomv2X LE [Not a Nano Cortex]' && /isn’t a Nano Cortex/.test(await js('document.querySelector("[data-fk=bt-notice]").textContent')), again.join(' | '));
    p.picker.onSelect([...OTHERS, NANO], p.cb);
    await synced();
    check('the Nano Cortex turning up while the chooser is open is picked by its name, and the chooser closes', p.picked.join() === 'AA:02,NN:01' && !(await chooserUp()));
    await js('__ui.demo = false; setStatus("Connected", true); __ui.demo = true'); await toShell(p);
    check('found via the full list: remembered with via "all", so the next scan starts there', saved && saved.id === 'NN:01' && saved.name === 'Neural DSP Nano Cortex' && saved.via === 'all' && p.picker.beginRequest({}) === 'all', JSON.stringify(saved));
    p.picker.onSelect([NANO], p.cb);
    check('the remembered pedal is picked at once', p.picked.slice(-1)[0] === 'NN:01');
    await js('__ui.connectError = ""; render()');

    // 1.0.0 remembered a Razer headset: the service failure forgets it and the chooser opens again.
    saved = { id: 'AA:02', name: 'Razer Nomv2X LE', at: '2026-10-17T13:47:35.739Z' };
    p = makePicker();
    p.picker.beginRequest({ want: 'all' });
    p.picker.onSelect(OTHERS, p.cb);
    check('a remembered device is picked without asking', p.picked.join() === 'AA:02');
    await failNoService(); await toShell(p);
    check('a service failure (No Services matching A002/A003) clears the remembered device', saved === null);
    check('… and asks for the chooser again', p.again.length === 1 && p.again[0].choose === true);
    p.picker.beginRequest(p.again[0]);
    p.picker.onSelect(OTHERS, p.cb);
    await waitFor(chooserUp); await synced();
    check('the forgotten device is not picked again; the chooser opens at once', p.picked.join() === 'AA:02' && await chooserUp());
    await key('Escape'); await toShell(p);
    check('Esc cancels the chooser', !(await chooserUp()) && p.picked.join() === 'AA:02,');
    await js('__ui.connectError = ""; render()');

    // A dropped link while looking for the services proves nothing: the remembered pedal stays.
    saved = { id: 'NN:01', name: 'Neural DSP Nano Cortex', at: '2026-10-20T10:00:00.000Z', via: 'nano' };
    p = makePicker();
    p.picker.beginRequest({});
    p.picker.onSelect([NANO], p.cb);
    await js(`(() => { log('Requesting Nano Cortex...'); log('Service unavailable 0000a002-0000-1000-8000-00805f9b34fb: GATT Server is disconnected. Cannot retrieve services.'); log('Connect failed: C304/C305 not found under A002/A003'); })()`);
    await toShell(p);
    check('a dropped link during service discovery keeps the remembered pedal', saved && saved.id === 'NN:01' && p.again.length === 0);
    await js('__ui.connectError = ""; render()');

    // Scan again, and reconnect at launch.
    p = makePicker();
    p.picker.beginRequest({ want: 'all' });
    p.picker.onSelect([dev('AA:01', 'JBL Flip 5')], p.cb);
    await waitFor(chooserUp); await synced();
    await click('[data-fk="bt-rescan"]');
    check('Scan again closes the chooser and asks for a new scan', !(await chooserUp()) && (await js('__ble.choices.slice(-1)[0]')) === 'rescan');
    await toShell(p);
    check('… cancelling the running request first', p.picked.join() === '');
    p = makePicker();
    p.picker.beginRequest({ auto: true });
    p.picker.onSelect([dev('NN:03', 'Neural DSP Nano Cortex'), ...OTHERS], p.cb);
    await waitFor(() => p.picked.length > 0, { timeout: 2000 });
    check('reconnect at launch takes only the remembered pedal: another Nano is not picked, no chooser', p.picked.join() === '' && p.hints.join() === 'auto-none' && !(await chooserUp()));
    saved = null;
    await js('__ble.choices.length = 0; __ble.results.length = 0; __ui.connectError = ""; render()');
  }

  // ---------------------------------------------------------------- update notifications
  // src/updates.js (the shell's side) with a fake electron-updater and fake timers; its events drive the page's modal
  // (__updates.event, as the preload bridge does) and the modal's answers (__updates.actions) go back to it.
  {
    const { createUpdates, installMode, notesExcerpt, FIRST_MS, DAY_MS } = require('../src/updates');
    const { EventEmitter } = require('events');
    check('updates: the macOS zip, the NSIS installer and the AppImage install themselves; the portable exe and the deb only link to the release',
      installMode('darwin', {}) === 'install' && installMode('win32', {}) === 'install' && installMode('win32', { PORTABLE_EXECUTABLE_FILE: 'C:\\x\\nce.exe' }) === 'notify'
      && installMode('linux', { APPIMAGE: '/home/x/nce.AppImage' }) === 'install' && installMode('linux', {}) === 'notify');
    const HTML = '<h3>Fixed</h3>\n<ul>\n<li>Connecting on a computer with many Bluetooth devices (<a href="https://github.com/x">#15</a>).</li>\n<li>Only a real Nano Cortex is remembered &amp; reused.</li>\n</ul>\n<hr>\n<p>macOS builds are signed with a Developer ID.</p>';
    check('release notes become plain text: headings, bullets, entities; the footer after the rule is left out',
      notesExcerpt(HTML) === 'Fixed\n• Connecting on a computer with many Bluetooth devices (#15).\n• Only a real Nano Cortex is remembered & reused.', JSON.stringify(notesExcerpt(HTML)));
    const long = notesExcerpt('word '.repeat(200), 100);
    check('long release notes are cut at a word with an ellipsis', long.length <= 100 && long.endsWith('…') && !/wor…$/.test(long), JSON.stringify(long));

    let settings = { auto: true, skipped: null };
    let pageQueue = Promise.resolve();
    const make = (mode) => {
      const u = new EventEmitter();
      u.calls = []; u.onCheck = null;
      u.checkForUpdates = async () => { u.calls.push('check'); if (u.onCheck) return u.onCheck(); return {}; };
      u.downloadUpdate = async () => { u.calls.push('download'); };
      u.quitAndInstall = (...a) => u.calls.push('quitAndInstall ' + a.join(','));
      const t = { timers: [], setTimeout: (fn, ms) => t.timers.push({ fn, ms, every: false, on: true }), setInterval: (fn, ms) => t.timers.push({ fn, ms, every: true, on: true }) };
      t.clearTimeout = t.clearInterval = (id) => { if (t.timers[id - 1]) t.timers[id - 1].on = false; };
      const r = { u, t, opened: [], events: [] };
      r.up = createUpdates({
        updater: u, store: { get: () => settings, set: (patch) => Object.assign(settings, patch) },
        send: (ev) => { r.events.push(ev); pageQueue = pageQueue.then(() => js('__updates.event(' + JSON.stringify(ev) + ')')); },
        openExternal: (url) => r.opened.push(url), currentVersion: '1.0.1', mode, releaseUrl: (v) => LINKS.releases + '/tag/v' + v, timers: t,
      });
      return r;
    };
    const synced = async () => { await pageQueue; await frame(); };
    const answer = async (r) => { for (const a of await js('__updates.actions.splice(0)')) r.up.action(a); };   // the page's answers, as the bridge carries them
    const modalUp = () => js('!!document.querySelector(".upd-modal")');
    const buttons = () => js('[...document.querySelectorAll(".upd-modal .row button")].map(b => b.textContent).join("|")');
    const toastText = () => js('document.getElementById("toast").classList.contains("show") ? document.getElementById("toast").textContent : ""');
    const offer = async (r, version, notes = HTML) => { r.u.emit('update-available', { version, releaseNotes: notes }); await synced(); };

    let r = make('install');
    check('updates: nothing downloads by itself; a download the user started installs on quit', r.u.autoDownload === false && r.u.autoInstallOnAppQuit === true);
    r.up.start();
    check('updates: the first check ' + FIRST_MS / 1000 + ' s after launch, then every 24 hours', r.t.timers.length === 2 && r.t.timers[0].ms === FIRST_MS && !r.t.timers[0].every && r.t.timers[1].ms === DAY_MS && r.t.timers[1].every && DAY_MS === 86400000);
    r.t.timers[0].fn();
    check('the scheduled check asks the updater', r.u.calls.join() === 'check');

    await offer(r, '1.0.2');
    check('an update opens the modal: the new version, a notes excerpt and a link to the full notes',
      await modalUp() && (await js('document.querySelector("[data-fk=upd-title]").textContent')) === 'Version 1.0.2 is available'
      && (await js('document.querySelector("[data-fk=upd-notes]").textContent')).startsWith('Fixed\n• Connecting on a computer')
      && (await js('document.querySelector("[data-fk=upd-notes-link]").href')) === LINKS.releases + '/tag/v1.0.2');
    check('the three choices: Skip this version, Remind me later, Download and install', (await buttons()) === 'Skip this version|Remind me later|Download and install', await buttons());
    await shot('update-available');
    await click('[data-fk="upd-later"]'); await answer(r);
    check('Remind me later closes the modal and stores nothing', !(await modalUp()) && settings.skipped === null);
    r.t.timers[1].fn(); await offer(r, '1.0.2');
    check('… and the next scheduled check offers it again', await modalUp());
    await click('[data-fk="upd-skip"]'); await answer(r);
    check('Skip this version closes the modal and stores the version', !(await modalUp()) && settings.skipped === '1.0.2');
    const n0 = r.events.length;
    r.t.timers[1].fn(); await offer(r, '1.0.2');
    check('a skipped version is never offered by the automatic checks', r.events.length === n0 && !(await modalUp()));
    await offer(r, '1.0.3');
    check('a newer version is offered again', await modalUp() && (await js('document.querySelector("[data-fk=upd-title]").textContent')) === 'Version 1.0.3 is available');
    await key('Escape'); await answer(r);
    check('Esc means Remind me later', !(await modalUp()) && settings.skipped === '1.0.2');

    // Download and install: progress, then Restart to update / Later.
    await offer(r, '1.0.3');
    await click('[data-fk="upd-download"]'); await answer(r);
    check('Download and install starts the download and shows progress', r.u.calls.includes('download') && await js('!document.querySelector("[data-fk=upd-progress]").hidden') && (await buttons()) === '');
    r.u.emit('download-progress', { percent: 42.4 }); await synced();
    check('the progress bar follows the download', (await js('document.querySelector("[data-fk=upd-pct]").textContent')) === 'Downloading… 42\u202f%' && (await js('document.querySelector(".upd-bar > span").style.width')) === '42%');
    await key('Escape');
    check('Esc does nothing while downloading', await modalUp());
    await shot('update-downloading');
    r.u.emit('update-downloaded', { version: '1.0.3' }); await synced();
    check('downloaded: "Version 1.0.3 is ready" with Later and Restart to update', (await js('document.querySelector("[data-fk=upd-title]").textContent')) === 'Version 1.0.3 is ready' && (await buttons()) === 'Later|Restart to update', await buttons());
    await click('[data-fk="upd-later"]'); await answer(r);
    check('Later closes it and says the update installs on quit', !(await modalUp()) && (await toastText()) === 'The update installs when you quit.' && !r.u.calls.some(c => c.startsWith('quitAndInstall')));
    const c0 = r.u.calls.length;
    await r.up.check(true); await synced();
    check('Check for Updates… after a download offers the restart again, without checking', (await buttons()) === 'Later|Restart to update' && r.u.calls.length === c0, (await buttons()) + ' ' + r.u.calls.join());
    await click('[data-fk="upd-restart"]'); await answer(r);
    check('Restart to update quits and installs (and relaunches)', r.u.calls.includes('quitAndInstall false,true'));
    await js('__updates.close()');

    // Manual checks answer; automatic ones stay quiet unless there is something to offer.
    r = make('install');
    r.u.onCheck = () => { r.u.emit('update-not-available', { version: '1.0.1' }); return {}; };
    await r.up.check(true); await synced();
    check('Check for Updates…: "You’re up to date."', (await toastText()) === 'You’re up to date.' && r.events.map(e => e.type).join() === 'checking,none');
    r.u.onCheck = () => { r.u.emit('error', new Error('Cannot find latest-mac.yml in the latest release artifacts\nstack…')); throw new Error('x'); };
    await r.up.check(true); await synced();
    check('Check for Updates…: an error shows as a toast', (await toastText()) === 'Couldn’t check for updates: Cannot find latest-mac.yml in the latest release artifacts', await toastText());
    const e0 = r.events.length;
    await r.up.check(false); await synced();
    check('an automatic check that fails says nothing', r.events.length === e0);
    r.u.onCheck = () => { r.u.emit('update-available', { version: '1.0.2', releaseNotes: HTML }); return {}; };   // the updater emits during the check
    await r.up.check(true); await synced();
    r.u.onCheck = null;
    check('Check for Updates… offers a skipped version (it was asked for)', await modalUp() && (await js('document.querySelector("[data-fk=upd-title]").textContent')) === 'Version 1.0.2 is available');
    await click('[data-fk="upd-download"]'); await answer(r);
    r.u.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED')); await synced();
    check('a failed download closes the modal with a toast', !(await modalUp()) && (await toastText()) === 'The update couldn’t be downloaded: net::ERR_INTERNET_DISCONNECTED', await toastText());
    // macOS: the zip is in ('update-downloaded'), then Squirrel.Mac refuses its signature (seen with ad-hoc builds).
    r.u.onCheck = () => { r.u.emit('update-available', { version: '1.0.3', releaseNotes: '' }); return {}; };
    await r.up.check(true); await synced(); r.u.onCheck = null;
    await click('[data-fk="upd-download"]'); await answer(r);
    r.u.emit('update-downloaded', { version: '1.0.3' }); await synced();
    r.u.emit('error', new Error('Error: Code signature at URL file:///x/Nano%20Cortex%20Editor.app/ did not pass validation: code failed to satisfy specified code requirement(s)')); await synced();
    check('an install refused after the download (Squirrel.Mac) closes the modal: nothing to restart', !(await modalUp()) && /^The update couldn’t be installed: Error: Code signature/.test(await toastText()) && r.up.state.downloaded === null, await toastText());
    await r.up.check(true); await synced();
    check('… and the next Check for Updates… checks again', r.u.calls.filter(c => c === 'check').length >= 3);

    // Notify only (the portable exe, the deb): Download opens the release page.
    r = make('notify');
    check('notify-only builds never install on quit', r.u.autoInstallOnAppQuit === false);
    await offer(r, '1.0.3');
    check('notify-only: Skip this version, Remind me later, Download', (await buttons()) === 'Skip this version|Remind me later|Download', await buttons());
    await click('[data-fk="upd-download"]'); await answer(r);
    check('notify-only: Download opens the release page and downloads nothing', !(await modalUp()) && r.opened.join() === LINKS.releases + '/tag/v1.0.3' && !r.u.calls.includes('download'));

    // The setting: off stops the schedule, on starts it again.
    r = make('install');
    r.up.start();
    r.up.setAuto(false);
    check('turning automatic checks off stores it and cancels the schedule', settings.auto === false && r.t.timers.every(x => !x.on));
    const r2 = make('install'); r2.up.start();
    check('with automatic checks off, nothing is scheduled at launch', r2.t.timers.length === 0);
    r2.up.setAuto(true);
    check('turning them on schedules them again', settings.auto === true && r2.t.timers.filter(x => x.on).length === 2);
    settings = { auto: true, skipped: null };

    // Settings → General → Advanced, and the Help menu.
    await key(',', [MOD]);
    await waitFor('!!document.querySelector(\'[data-fk="set-autoupdate"]\')');
    check('Settings → Advanced: "Check for updates automatically", disabled outside the desktop app',
      (await js('document.querySelector(\'[data-fk="set-autoupdate"]\').textContent')) === 'Check for updates automatically' && await js('document.querySelector(\'[data-fk="set-autoupdate"]\').disabled')
      && (await js('document.querySelector(\'[data-fk="set-autoupdate-note"]\').textContent')) === 'Only in the desktop app.');
    await key('Escape'); await waitFor('!document.querySelector(".modal")');
    const help = menuFor(false).join(',');
    check('Help → Check for Updates…', /Show Log File,-,Check for Updates…,Support the Project…/.test(help), help);
  }

  check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
}

app.whenReady().then(async () => {
  // backgroundThrottling off: on macOS an occluded window gets almost no animation
  // frames, and every step here waits for one.
  // enableLargerThanScreen: CI runners (macOS) have a small display, and the layout checks need the full 1400×900.
  win = new BrowserWindow({ width: 1400, height: 900, useContentSize: true, show: true, enableLargerThanScreen: true, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => { opened.push(url); return { action: 'deny' }; });
  wc.on('console-message', (e) => {
    const level = e.level ?? e.params?.level;
    const msg = e.message ?? e.params?.message;
    if (level === 'error' || level === 3) consoleErrors.push(String(msg));
  });
  wc.on('preload-error', (_e, p, err) => consoleErrors.push('preload ' + err));
  for (const f of fs.readdirSync(OUT)) if (/^nano-session-.*\.json$/.test(f)) fs.unlinkSync(path.join(OUT, f));
  wc.session.on('will-download', (_e, item) => item.setSavePath(path.join(OUT, item.getFilename())));
  console.log('window content size: ' + win.getContentSize().join('×') + ', screen work area: ' + JSON.stringify(require('electron').screen.getPrimaryDisplay().workAreaSize));
  await win.loadURL('file://' + PAGE + '?demo');
  try { await run(); }
  catch (err) { check('harness crashed', false, err.stack); }
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  app.exit(failed.length ? 1 : 0);
});
