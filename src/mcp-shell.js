'use strict';

// The shell's half of AI assistants (mcp/PROTOCOL.md): owns the socket server (src/mcp-server.js) while Settings →
// AI assistants is on, forwards every call to the editor page and its answer back, and answers the page's requests
// (status, switch, Cortex Cloud, Claude Desktop, install links). src/main.js creates it with Electron's objects; the
// UX test creates it with its own window and fakes, so the same IPC is tested.
//
// IPC (page side: window.nanoAgent in src/editor-preload.js; every request checks that it came from the editor page):
//   agent-contract  → mcp/tools.json             agent-status → the status below      agent-set(on) → the status
//   agent-call      ← { id, tool, args, client } (to the page)   agent-reply(id, { ok, result | error }) (from the page)
//   agent-status    ← status (pushed on change)  agent-connected ← label (a new assistant)
//   agent-front     the page opened an assistant confirmation: bring the window to the front
//   agent-cloud(op, args)  op: search | bundle | open | signed-in       agent-desktop → add to Claude Desktop
//   agent-install(kind)    kind: cursor | vscode (the shell builds the link; the page never names a URL)
// No call is ever evaluated as code: the page receives data and answers with data.

const { createMcpServer, CONTRACT, MESSAGES } = require('./mcp-server');
const { addToClaudeDesktop } = require('./mcp-setup');

const KIND = new Map(CONTRACT.tools.map((t) => [t.name, t.kind]));
const pageTimeout = (tool, args) => (KIND.get(tool) === 'confirm' ? 11 * 60 * 1000
  : tool === 'get_slot_usage' && args && args.scan ? 6 * 60 * 1000 : tool === 'cloud_preview' ? 4 * 60 * 1000 : 3 * 60 * 1000);

// The status line, in the contract's words (tools.json → messages).
function statusText(on, st) {
  if (!on || st.phase === 'off') return MESSAGES.statusOff;
  if (st.phase === 'blocked') return MESSAGES.anotherEditor;
  if (st.phase === 'error') return 'Cannot listen: ' + st.error + '.';
  if (st.clients.length) return MESSAGES.statusConnected.replace('{clients}', st.clients.join(', '));
  return MESSAGES.statusWaiting;
}

function createAgentShell({ ipcMain, getPage, store, env = process.env, version = '0.0.0', setup, cloud = {}, focusWindow = () => {}, openExternal = () => false, log = () => {} }) {
  const pending = new Map();   // call id → { resolve, timer }
  let nextId = 1;

  const server = createMcpServer({
    env, editor: { name: 'Nano Cortex Editor', edition: 'electron', version },
    onCall: forward,
    onStatus: () => push('agent-status', status()),
    onConnect: (label) => { log('[assistants] ' + label + ' connected'); push('agent-connected', label); },
    log: (m) => log('[assistants] ' + m),
  });

  function page() { const p = getPage(); return p && !p.isDestroyed() ? p : null; }
  function push(channel, payload) { const p = page(); if (p) p.send(channel, payload); }
  const fromPage = (e) => { const p = page(); return !!p && e.sender === p; };

  function status() {
    const st = server.status();
    const on = !!store.get();
    return {
      on, phase: st.phase, clients: st.clients, error: st.error, text: statusText(on, st),
      setup: setup ? {
        claudeCode: setup.claudeCode, codex: setup.codex, json: setup.json,
        claudeDesktop: setup.claudeDesktop, desktopEntry: JSON.stringify({ 'nano-cortex': setup.entry }, null, 2),
        exe: setup.exe, helper: setup.helper,
      } : null,
    };
  }

  function forward(tool, args, client, call) {
    const p = page();
    if (!p) return Promise.resolve({ ok: false, error: 'The editor window is not ready (or shows the Classic Editor). Open the editor, then try again.' });
    const id = nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: 'The editor page did not answer.' }); }, pageTimeout(tool, args));
      pending.set(id, { resolve: (r) => { clearTimeout(timer); resolve(r); }, timer });
      p.send('agent-call', { id, tool, args, client: client || null });
      // The helper went away or AI assistants were turned off: the page cancels that call's open dialog (as the
      // user's Cancel would), and the queue does not wait for its answer.
      if (call) call.onAbort(() => {
        const w = pending.get(id);
        if (!w) return;
        pending.delete(id);
        push('agent-cancel', id);
        w.resolve({ ok: false, error: CONTRACT.errors.cancelled });
      });
    });
  }
  // The page reloaded, navigated or crashed: its open calls are lost.
  function pageGone() {
    for (const [id, w] of pending) { pending.delete(id); w.resolve({ ok: false, error: 'The editor page reloaded before answering. Try again.' }); }
  }

  ipcMain.handle('agent-contract', (e) => (fromPage(e) ? CONTRACT : null));
  ipcMain.handle('agent-status', (e) => (fromPage(e) ? status() : null));
  ipcMain.handle('agent-set', (e, on) => {
    if (!fromPage(e)) return null;
    on = !!on;
    store.set(on);
    log('[assistants] AI assistants ' + (on ? 'on' : 'off'));
    if (on) server.start(); else server.stop();
    return status();
  });
  ipcMain.on('agent-reply', (e, id, answer) => {
    if (!fromPage(e)) return;
    const w = pending.get(Number(id));
    if (!w) return;
    pending.delete(Number(id));
    const a = answer && typeof answer === 'object' ? answer : {};
    w.resolve(a.ok ? { ok: true, result: a.result === undefined ? {} : a.result } : { ok: false, error: String(a.error || 'The editor reported an error.').slice(0, 4000) });
  });
  ipcMain.on('agent-front', (e) => { if (fromPage(e)) focusWindow(); });
  ipcMain.handle('agent-cloud', async (e, op, args) => {
    if (!fromPage(e)) return { ok: false, error: 'Not allowed.' };
    const a = args && typeof args === 'object' ? args : {};
    try {
      if (op === 'search' && cloud.search) return await cloud.search(String(a.query || ''), Number(a.page) || 1);
      if (op === 'bundle' && cloud.bundle) return await cloud.bundle(String(a.id || ''));
      if (op === 'open' && cloud.open) return { ok: !!(await cloud.open(String(a.id || ''))) };
      if (op === 'signed-in') return { ok: true, signedIn: cloud.signedIn ? cloud.signedIn() : null };
    } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
    return { ok: false, error: 'Cortex Cloud is not available here.' };
  });
  ipcMain.handle('agent-desktop', (e) => {
    if (!fromPage(e)) return { ok: false, error: 'Not allowed.' };
    if (!setup || !setup.claudeDesktop) return { ok: false, error: 'Claude Desktop is not available on this system.' };
    try {
      const r = addToClaudeDesktop(setup.claudeDesktop, setup.entry);
      log('[assistants] added nano-cortex to ' + r.file + (r.backup ? ' (backup: ' + r.backup + ')' : ''));
      return { ok: true, ...r };
    } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
  });
  ipcMain.handle('agent-install', (e, kind) => {
    if (!fromPage(e) || !setup) return false;
    const link = kind === 'cursor' ? setup.cursor : kind === 'vscode' ? setup.vscode : null;
    return link ? !!openExternal(link) : false;
  });

  return {
    status,
    pageGone,
    // At launch: listen when the setting is on.
    start() { if (store.get()) server.start(); return status(); },
    stop() { server.stop(); pageGone(); },
    server,
  };
}

module.exports = { createAgentShell, statusText };
