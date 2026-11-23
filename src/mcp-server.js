'use strict';

// The editor side of the AI assistants link (mcp/PROTOCOL.md §1–§2): a private local socket that the MCP helper
// (mcp/helper.js, or the native edition's helper) connects to. No Electron in here, so the UX test drives it with the
// real demo page: src/mcp-shell.js wires it to the window, the page answers the calls (pro/agent.js).
//
//   const server = createMcpServer({ env, editor, onCall, onStatus, onConnect });
//   server.start(); server.status(); server.stop();
//
// onCall(tool, args, client) → Promise<{ ok: true, result } | { ok: false, error }>; client is the assistant's display
// name (clientLabel) or null. Calls run one at a time across every connection, in arrival order. onStatus(status) on
// every change; onConnect(label) when a helper completed its hello.

const fs = require('fs');
const net = require('net');
const path = require('path');
const { endpoint, checkPrivateDir, writeToken, sameToken, lineReader } = require('../mcp/endpoint');

const CONTRACT = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'mcp', 'tools.json'), 'utf8'));
const RETRY_MS = 5000;
// The words come from the contract (tools.json → messages, clients), shared word for word with the native edition.
const MESSAGES = CONTRACT.messages;
const ANOTHER_EDITOR = MESSAGES.anotherEditor;
const CONTRACT_MISMATCH = MESSAGES.contractMismatch;
const CLIENT_NAMES = Object.fromEntries(Object.entries(CONTRACT.clients.names).map(([k, v]) => [k.toLowerCase(), v]));
// A display name for a hello's client.name (tools.json → clients), or null when there is none worth showing (the
// caller then uses clients.fallback).
function clientLabel(name) {
  const n = String(name || '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 60);
  if (!n || /^unknown$/i.test(n)) return null;
  return CLIENT_NAMES[n.toLowerCase()] || n;
}

function createMcpServer({ env = process.env, editor = {}, onCall, onStatus = () => {}, onConnect = () => {}, retryMs = RETRY_MS, log = () => {} } = {}) {
  const hello = { name: 'Nano Cortex Editor', edition: 'electron', version: '0.0.0', ...editor, contract: CONTRACT.contractVersion };
  let phase = 'off';      // off | starting | listening | blocked | error
  let reason = '';        // why it cannot listen (blocked / error)
  let server = null;
  let token = null;
  let ep = null;
  let retryTimer = null;
  let generation = 0;     // a stop() or a new start() makes older async steps give up
  const conns = new Set();
  let chain = Promise.resolve();

  const clients = () => [...conns].filter((c) => c.greeted).map((c) => c.label || CONTRACT.clients.fallback);
  function status() {
    return { phase, on: phase !== 'off', error: reason, clients: [...new Set(clients())], socket: ep ? ep.socket : null, dir: ep ? ep.dir : null };
  }
  const changed = () => { try { onStatus(status()); } catch (err) { log('status listener: ' + err.message); } };
  const set = (p, why = '') => { phase = p; reason = why; changed(); };

  function start() {
    if (phase !== 'off') return status();
    generation++;
    set('starting');
    attempt(generation);
    return status();
  }

  function retryLater(gen) {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { retryTimer = null; if (gen === generation) attempt(gen); }, retryMs);
  }

  function attempt(gen) {
    ep = endpoint(env);
    const bad = checkPrivateDir(ep.dir, { create: true });
    if (bad) { set('error', bad); return; }
    // One editor at a time: if something answers on the socket, another editor (either edition) is serving.
    const probe = net.createConnection(ep.socket);
    let done = false;
    const finish = (answered) => {
      if (done) return;
      done = true;
      probe.destroy();
      if (gen !== generation) return;
      if (answered) { set('blocked', ANOTHER_EDITOR); retryLater(gen); return; }
      if (process.platform !== 'win32') { try { fs.unlinkSync(ep.socket); } catch { /* none */ } }
      listen(gen);
    };
    probe.on('connect', () => finish(true));
    probe.on('error', () => finish(false));
    probe.setTimeout(1500, () => finish(false));
  }

  function listen(gen) {
    const srv = net.createServer(onConnection);
    srv.on('error', (err) => {
      if (gen !== generation) return;
      srv.close();
      if (err.code === 'EADDRINUSE') { set('blocked', ANOTHER_EDITOR); retryLater(gen); }
      else set('error', 'cannot listen on ' + ep.socket + ': ' + err.message);
    });
    srv.listen(ep.socket, () => {
      if (gen !== generation) { srv.close(); return; }
      // The token is written only once this editor owns the socket: a second editor that lost the race never
      // replaces the serving editor's token.
      let tok;
      try { tok = writeToken(ep.token); } catch (err) { srv.close(); set('error', 'cannot write ' + ep.token + ': ' + err.message); return; }
      if (process.platform !== 'win32') { try { fs.chmodSync(ep.socket, 0o600); } catch { /* the folder is private anyway */ } }
      server = srv;
      token = tok;
      set('listening');
      log('listening on ' + ep.socket);
    });
  }

  function send(c, msg) { if (!c.socket.destroyed) c.socket.write(JSON.stringify(msg) + '\n'); }

  function onConnection(socket) {
    const c = { socket, greeted: false, label: null, client: null };
    conns.add(c);
    socket.on('error', () => {});
    socket.on('close', () => { conns.delete(c); if (c.call) c.call.abort(); if (c.greeted) changed(); });
    // A malformed or over-long line closes the connection; nothing after it is read (lineReader stops on false).
    socket.on('data', lineReader((msg) => onMessage(c, msg), () => { c.closing = true; socket.destroy(); return false; }));
  }

  function refuse(c, error) { send(c, { type: 'hello', ok: false, error }); c.socket.end(); c.closing = true; }

  function onMessage(c, msg) {
    if (c.closing) return;
    if (!c.greeted) {
      if (!msg || msg.type !== 'hello') return refuse(c, 'The first message must be a hello.');
      if (!token || !sameToken(msg.token, token)) return refuse(c, 'The token is wrong. Turn AI assistants off and on again in Settings → AI assistants, then try again.');
      if (msg.contract !== CONTRACT.contractVersion) return refuse(c, CONTRACT_MISMATCH);
      const client = msg.client && typeof msg.client === 'object' ? msg.client : {};
      c.client = { name: String(client.name || '').slice(0, 80), version: String(client.version || '').slice(0, 40) };
      c.label = clientLabel(c.client.name);
      c.greeted = true;
      send(c, { type: 'hello', ok: true, editor: hello });
      changed();
      try { onConnect(c.label || CONTRACT.clients.fallback, c.client); } catch (err) { log('connect listener: ' + err.message); }
      return;
    }
    if (!msg || msg.type !== 'call' || !Number.isInteger(msg.id) || typeof msg.tool !== 'string') return;
    const args = msg.args && typeof msg.args === 'object' && !Array.isArray(msg.args) ? msg.args : {};
    // One call at a time, across every connection, in arrival order (a confirmation dialog holds the queue).
    chain = chain.then(async () => {
      if (c.socket.destroyed || phase !== 'listening') return;
      // The call can be given up (the helper went away, or AI assistants were turned off): onCall hears it through
      // call.onAbort and stops waiting, so the queue does not stay blocked behind an open dialog.
      const call = { aborted: false, listeners: [], onAbort(fn) { if (this.aborted) fn(); else this.listeners.push(fn); },
        abort() { if (this.aborted) return; this.aborted = true; for (const fn of this.listeners) { try { fn(); } catch { /* next */ } } } };
      c.call = call;
      let r;
      try { r = await onCall(msg.tool, args, c.label, call); } catch (err) { r = { ok: false, error: String((err && err.message) || err) }; }
      if (c.call === call) c.call = null;
      if (!r || typeof r !== 'object') r = { ok: false, error: 'The editor gave no answer.' };
      send(c, r.ok ? { type: 'result', id: msg.id, ok: true, result: r.result === undefined ? {} : r.result } : { type: 'result', id: msg.id, ok: false, error: String(r.error || 'The editor reported an error.') });
      if (c.endAfterAnswer) c.socket.end();
    });
  }

  function stop() {
    generation++;
    clearTimeout(retryTimer); retryTimer = null;
    const had = phase !== 'off';
    // A connection with a call open gets that call's answer (cancelled) before it closes; the others close now.
    for (const c of conns) {
      if (!c.call) { c.socket.destroy(); continue; }
      c.endAfterAnswer = true;
      setTimeout(() => c.socket.destroy(), 1000).unref();
      c.call.abort();
    }
    conns.clear();
    if (server) {
      server.close();
      server = null;
      if (ep) {
        if (process.platform !== 'win32') { try { fs.unlinkSync(ep.socket); } catch { /* gone */ } }
        try { if (sameToken(fs.readFileSync(ep.token, 'utf8').trim(), token)) fs.unlinkSync(ep.token); } catch { /* gone */ }
      }
    }
    token = null;
    phase = 'off'; reason = '';
    if (had) changed();
    return status();
  }

  return { start, stop, status };
}

module.exports = { createMcpServer, clientLabel, CONTRACT, MESSAGES, ANOTHER_EDITOR, CONTRACT_MISMATCH, RETRY_MS };
