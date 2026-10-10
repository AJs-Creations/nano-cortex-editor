// The Activity log on disk, for everyone (Help → Show Log File): every line the editor page logs, written by the
// main process to app.getPath('logs')/nano-cortex-editor.log. Lines are buffered and appended about once a second, never one
// synchronous write per packet. The file is capped: past `max` bytes it becomes activity.1.log (replacing the old
// one), so the two together stay under about twice the cap. No Electron in here, so the UX test can unit-test it.
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 2 * 1024 * 1024;

// activity.log → activity.1.log
function rotatedName(file) {
  const ext = path.extname(file);
  return file.slice(0, file.length - ext.length) + '.1' + ext;
}

// Moves `file` to its .1 name when it is larger than `max`. Returns true when it rotated.
function rotateIfNeeded(file, max = MAX_BYTES) {
  let size;
  try { size = fs.statSync(file).size; } catch { return false; }
  if (size <= max) return false;
  try { fs.renameSync(file, rotatedName(file)); return true; } catch { return false; }
}

function createActivityLog(file, { max = MAX_BYTES, flushMs = 1000 } = {}) {
  let buf = [];
  let timer = null;
  let writing = null;   // the append in flight, so flushes never overlap
  const ensureDir = () => fs.mkdirSync(path.dirname(file), { recursive: true });

  async function flush() {
    clearTimeout(timer); timer = null;
    if (writing) await writing;
    if (!buf.length) return;
    const chunk = buf.join(''); buf = [];
    writing = (async () => {
      try { ensureDir(); await fs.promises.appendFile(file, chunk); rotateIfNeeded(file, max); }
      catch { /* a log must never take the app down */ }
    })();
    await writing; writing = null;
  }
  // On quit: whatever is still buffered, synchronously.
  function flushSync() {
    clearTimeout(timer); timer = null;
    if (!buf.length) return;
    const chunk = buf.join(''); buf = [];
    try { ensureDir(); fs.appendFileSync(file, chunk); rotateIfNeeded(file, max); } catch { /* fine */ }
  }
  function write(text, at = new Date()) {
    buf.push(at.toISOString() + ' ' + String(text).replace(/\r?\n/g, '\n    ') + '\n');
    if (!timer) timer = setTimeout(flush, flushMs);
  }
  // Show Log File: the file has to exist to be revealed.
  function ensureFile() {
    flushSync();
    try { ensureDir(); if (!fs.existsSync(file)) fs.writeFileSync(file, ''); } catch { /* fine */ }
    return file;
  }
  rotateIfNeeded(file, max);
  return { file, write, flush, flushSync, ensureFile };
}

module.exports = { createActivityLog, rotateIfNeeded, rotatedName, MAX_BYTES };
