'use strict';

// What Settings → AI assistants shows and does for this installation (mcp/PROTOCOL.md "Setup lines"): the setup lines
// with the real paths, the Cursor / VS Code install links, and "Add to Claude Desktop…", which merges one entry into
// claude_desktop_config.json and keeps every other entry. No Electron in here; the UX test drives it with temp files.

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
    claudeCode: 'claude mcp add -s user -e ELECTRON_RUN_AS_NODE=1 ' + SERVER + ' -- "' + exe + '" "' + helper + '"',
    codex: 'codex mcp add ' + SERVER + ' --env ELECTRON_RUN_AS_NODE=1 -- "' + exe + '" "' + helper + '"',
    json: JSON.stringify({ mcpServers: { [SERVER]: entry } }),
    cursor: cursorLink(entry),
    vscode: vscodeLink(entry),
    claudeDesktop: claudeDesktopConfigPath(platform, env, home),
  };
}

// The base64 is URL-encoded so that "+", "/" and "=" survive the query string.
function cursorLink(entry) {
  return 'cursor://anysphere.cursor-deeplink/mcp/install?name=' + SERVER + '&config=' + encodeURIComponent(Buffer.from(JSON.stringify(entry), 'utf8').toString('base64'));
}
function vscodeLink(entry) {
  return 'vscode:mcp/install?' + encodeURIComponent(JSON.stringify({ name: SERVER, ...entry }));
}

// Claude Desktop's config file; null on Linux (there is no Linux build of Claude Desktop).
function claudeDesktopConfigPath(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  return null;
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

module.exports = { setupInfo, cursorLink, vscodeLink, claudeDesktopConfigPath, addToClaudeDesktop, SERVER };
