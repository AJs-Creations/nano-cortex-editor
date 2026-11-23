'use strict';

// What Settings → General shows and does under the AI assistants switch (mcp/PROTOCOL.md "What the user sees"):
// "Add to Claude Desktop…", which merges one entry into claude_desktop_config.json and keeps every other entry, and
// "Add to ChatGPT…", which appends a [mcp_servers.nano-cortex] table to ~/.codex/config.toml (the ChatGPT desktop app
// shares its MCP servers with Codex there). No Electron in here; the UX test drives it with temp files.

const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = 'nano-cortex';

// exe: the app executable (from source: the Electron binary); helper: <resources>/app.asar.unpacked/mcp/helper.js
// (from source: <repo>/mcp/helper.js).
function setupInfo({ exe, helper, platform = process.platform, env = process.env, home = os.homedir() }) {
  const entry = { command: exe, args: [helper], env: { ELECTRON_RUN_AS_NODE: '1' } };
  return {
    edition: 'electron', exe, helper, entry,
    claudeDesktop: claudeDesktopConfigPath(platform, env, home),
    chatgpt: codexConfigPath(env, home),
    chatgptTable: codexTable(entry),
  };
}

// Claude Desktop's config file; null on Linux (there is no Linux build of Claude Desktop).
function claudeDesktopConfigPath(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  return null;
}

// The ChatGPT desktop app's (and Codex's) MCP settings: ~/.codex/config.toml (Windows: %USERPROFILE%\.codex), or
// $CODEX_HOME/config.toml when that is set, as Codex itself reads it.
function codexConfigPath(env = process.env, home = os.homedir()) {
  return path.join(env.CODEX_HOME || path.join(home, '.codex'), 'config.toml');
}

// A TOML basic string: backslash, quote and control characters escaped (a Windows path's backslashes included).
const TOML_ESC = { '\\': '\\\\', '"': '\\"', '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r' };
function tomlString(s) {
  return '"' + String(s).replace(/[\\"\x00-\x1f\x7f]/g, (c) => TOML_ESC[c] || '\\u' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')) + '"';
}
function codexTable(entry) {
  const envPairs = Object.entries(entry.env || {}).map(([k, v]) => k + ' = ' + tomlString(v)).join(', ');
  return '[mcp_servers.' + SERVER + ']\n'
    + 'command = ' + tomlString(entry.command) + '\n'
    + 'args = [' + entry.args.map(tomlString).join(', ') + ']\n'
    + 'env = { ' + envPairs + ' }\n';
}

// Is nano-cortex already among the file's MCP servers? A [mcp_servers.nano-cortex] table (or one of its subtables),
// a nano-cortex key inside [mcp_servers], or a dotted mcp_servers.nano-cortex key at the top level. An inline
// mcp_servers = { … } at the top level can't take a new table: throws, and the file is left alone.
function codexHasServer(text, file) {
  const name = '(?:' + SERVER + '|"' + SERVER + '"|\'' + SERVER + '\')';
  const inTable = new RegExp('^mcp_servers\\.' + name + '(\\.|$)');
  const key = new RegExp('^' + name + '\\s*[.=]');
  const dotted = new RegExp('^mcp_servers\\s*\\.\\s*' + name + '\\s*[.=]');
  let table = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const head = /^\[\[?\s*([^\]]*?)\s*\]\]?/.exec(line);
    if (head) {
      table = head[1].replace(/\s*\.\s*/g, '.');
      if (inTable.test(table)) return true;
      continue;
    }
    if (table === 'mcp_servers' && key.test(line)) return true;
    if (table === '' && dotted.test(line)) return true;
    if (table === '' && /^mcp_servers\s*=/.test(line)) throw new Error(file + ' sets mcp_servers inline, so it was left unchanged. Add the entry by hand (see the manual).');
  }
  return false;
}

// Appends the [mcp_servers.nano-cortex] table and keeps the file otherwise as it is; the old file is copied to
// <file>.bak first. Nothing changes when nano-cortex is there already. → { file, backup, exists }.
function addToChatGPT(file, entry) {
  let text = null;
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) { if (err.code !== 'ENOENT') throw new Error('Could not read ' + file + ': ' + err.message); }
  if (text !== null && codexHasServer(text, file)) return { file, backup: null, exists: true };
  let backup = null;
  if (text !== null) { backup = file + '.bak'; fs.writeFileSync(backup, text); }
  const before = !text ? '' : text.endsWith('\n') ? text + '\n' : text + '\n\n';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, before + codexTable(entry));
  fs.renameSync(tmp, file);
  return { file, backup, exists: false };
}

// Adds (or replaces) mcpServers["nano-cortex"] in the config file, keeping everything else. The old file is copied to
// <file>.bak first. A file that is not valid JSON is left alone. → { file, backup, replaced }.
function addToClaudeDesktop(file, entry) {
  let config = {};
  let backup = null;
  let text = null;
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) { if (err.code !== 'ENOENT') throw new Error('Could not read ' + file + ': ' + err.message); }
  if (text !== null && text.trim()) {
    try { config = JSON.parse(text); } catch { throw new Error(file + ' is not valid JSON, so it was left unchanged. Fix or remove it, then try again.'); }
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(file + ' does not hold a JSON object, so it was left unchanged.');
  }
  if (text !== null) {
    backup = file + '.bak';
    fs.writeFileSync(backup, text);
  }
  const servers = config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers) ? config.mcpServers : {};
  const replaced = Object.prototype.hasOwnProperty.call(servers, SERVER);
  config.mcpServers = { ...servers, [SERVER]: entry };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return { file, backup, replaced };
}

// The executable and helper the setup lines should name. A Linux AppImage mounts itself under a new /tmp/.mount_…
// folder at every launch and a Windows portable exe unpacks to a new temporary folder, so neither execPath nor the
// helper inside them lasts. Then: the AppImage / portable exe itself (APPIMAGE, PORTABLE_EXECUTABLE_FILE; both run
// the app's Node with ELECTRON_RUN_AS_NODE=1) and a copy of the helper in <userData>/mcp-helper, refreshed at every
// launch (its package.json carries the version the helper reports).
function stablePaths({ packaged, execPath, helper, env = process.env, userData, version, log = () => {} }) {
  const outer = env.APPIMAGE || env.PORTABLE_EXECUTABLE_FILE || '';
  if (!packaged || !outer) return { exe: execPath, helper };
  try {
    const dir = path.join(userData, 'mcp-helper');
    fs.mkdirSync(path.join(dir, 'mcp'), { recursive: true });
    for (const f of ['helper.js', 'endpoint.js', 'tools.json']) fs.copyFileSync(path.join(path.dirname(helper), f), path.join(dir, 'mcp', f));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'nano-cortex-mcp-helper', private: true, version }) + '\n');
    return { exe: outer, helper: path.join(dir, 'mcp', 'helper.js') };
  } catch (err) {
    log('could not copy the helper: ' + err.message);
    return { exe: execPath, helper };
  }
}

module.exports = { setupInfo, stablePaths, claudeDesktopConfigPath, addToClaudeDesktop, codexConfigPath, codexTable, tomlString, addToChatGPT, SERVER };
