// Nano Cortex Editor — AI assistants (MCP), the editor page's side. mcp/PROTOCOL.md §4 is the spec.
//
// The shell (src/mcp-shell.js) forwards each assistant call here as data (window.nanoAgent.onCall) and sends the
// answer back. Every tool runs on the same functions the UI's own controls call (ui.js exposes them through
// window.__nanoAgentUI), so every write goes through the real packet builders and demo mode answers them. Tools that
// store anything on the pedal open the editor's own dialog and run exactly the path the user's click would.
// No tool runs code, sends raw packets, touches files or reaches the dev remote.
//
// Also here: Settings → AI assistants, the status bar pill "Assistant", the toast when an assistant connects.
// Loaded after ui.js. Without the bridge (the browser preview) it does nothing.

(() => {
  'use strict';
  const U = window.__nanoAgentUI;
  const bridge = window.nanoAgent || null;
  if (!U) return;

  // ------------------------------------------------------------------ library hashes
  // The capture library's records carry the capture's hash (field 1), which Cortex Cloud search results carry too:
  // cloud_search marks a result onPedal by it. Upstream's parse drops it; read it back from the same reply.
  const coreParseLib = window.parseLibraryContent;
  if (typeof coreParseLib === 'function') {
    window.parseLibraryContent = function (bytes) {
      const out = coreParseLib.apply(this, arguments);
      try {
        let body = bytes;
        const n = body.length;
        if (n >= 4 && body[n - 4] === MSG.RetrieveLibraryContentResponse && body[n - 3] === 0 && body[n - 2] === 0 && body[n - 1] === 0) body = body.slice(0, n - 4);
        const fields = parseProtoFields(body);
        for (const [list, f] of [[state.library.factory, 3], [state.library.user, 5]]) {
          const entries = (fields[f] || []).filter((e) => e.wire === 2);
          for (const item of list || []) {
            const e = entries[item.index];
            const rec = e ? parseProtoFields(e.raw) : {};
            const h = rec[1] && rec[1][0];
            if (h && h.wire === 2) item.hash = new TextDecoder().decode(Uint8Array.from(h.raw)).trim();
          }
        }
      } catch { /* no hashes: onPedal falls back to names */ }
      return out;
    };
  }

  // ------------------------------------------------------------------ the contract
  const C = { tools: new Map(), defs: {}, errors: {}, safety: {}, loaded: null };
  function useContract(contract) {
    if (!contract || !Array.isArray(contract.tools)) return false;
    C.tools = new Map(contract.tools.map((t) => [t.name, t]));
    C.defs = contract.$defs || {};
    C.errors = contract.errors || {};
    C.safety = contract.safety || {};
    C.levelRe = new RegExp(C.safety.effectLevelParams || '^(level|volume|output|out level|vol)$', 'i');
    return true;
  }
  const contractReady = () => C.loaded || (C.loaded = (bridge ? bridge.contract() : Promise.resolve(null)).then(useContract).catch(() => false));

  // ------------------------------------------------------------------ helpers
  const SLOTS = ['pre1', 'pre2', 'post1', 'post2', 'post3'];
  const AMP = [['gain', 'Gain'], ['bass', 'Bass'], ['mid', 'Mid'], ['treble', 'Treble'], ['level', 'Level']];
  const EPS = 1e-9;
  const round1 = (v) => Math.round(Number(v) * 10) / 10;
  const ampOf = (raw) => round1(Number(raw) / 25.5);
  const rawOfAmp = (v) => clamp(Math.round(Number(v) * 25.5), 0, 255);
  const fmtDb = (v) => (v > 0 ? '+' : '') + Number(v).toFixed(1) + ' dB';
  const fmtNum = (v) => String(Math.round(Number(v) * 100) / 100);
  const ci = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const quote = (s) => '“' + s + '”';
  const say = (line) => window.log('Assistant: ' + line);
  const blockTitle = (key) => (state.blocks[key] ? state.blocks[key].title : key);
  const fill = (text, vars) => String(text).replace(/\{(\w+)\}/g, (_m, k) => (vars[k] !== undefined ? vars[k] : ''));
  const stepRefusal = (what, step) => fill(C.safety.stepRefusal, { what, step });
  const maxRefusal = (what, max) => fill(C.safety.maxRefusal, { what, max });
  class Refusal extends Error {}
  const refuseWith = (msg) => { throw new Refusal(msg); };

  // ------------------------------------------------------------------ validation (the tools' input schemas)
  function resolve(schema) {
    if (!schema || typeof schema.$ref !== 'string') return schema || {};
    const m = /^#\/\$defs\/(.+)$/.exec(schema.$ref);
    const { $ref, ...rest } = schema;
    return { ...(m && C.defs[m[1]] ? C.defs[m[1]] : {}), ...rest };
  }
  const TYPE_WORDS = { number: 'a number', integer: 'a whole number', string: 'text', boolean: 'true or false', object: 'an object', array: 'a list' };
  function typeOk(v, t) {
    if (t === 'number') return typeof v === 'number' && Number.isFinite(v);
    if (t === 'integer') return Number.isInteger(v);
    if (t === 'string') return typeof v === 'string';
    if (t === 'boolean') return typeof v === 'boolean';
    if (t === 'array') return Array.isArray(v);
    if (t === 'object') return !!v && typeof v === 'object' && !Array.isArray(v);
    return true;
  }
  // null, or a sentence naming the field ("slot must be one of pre1, pre2, post1, post2, post3.").
  function validate(schemaIn, v, where, tool) {
    const s = resolve(schemaIn);
    const name = where || 'The input';
    if (s.type) {
      const types = [].concat(s.type);
      if (!types.some((t) => typeOk(v, t))) return name + ' must be ' + types.map((t) => TYPE_WORDS[t] || t).join(' or ') + '.';
    }
    if (s.enum && !s.enum.includes(v)) return name + ' must be one of ' + s.enum.join(', ') + '.';
    if (typeof v === 'number') {
      if (s.minimum !== undefined && s.maximum !== undefined && (v < s.minimum || v > s.maximum)) return name + ' must be between ' + s.minimum + ' and ' + s.maximum + '.';
      if (s.minimum !== undefined && v < s.minimum) return name + ' must be at least ' + s.minimum + '.';
      if (s.maximum !== undefined && v > s.maximum) return name + ' must be at most ' + s.maximum + '.';
    }
    if (typeof v === 'string') {
      if (s.minLength !== undefined && v.length < s.minLength) return name + ' must have at least ' + s.minLength + ' characters.';
      if (s.maxLength !== undefined && v.length > s.maxLength) return name + ' must have at most ' + s.maxLength + ' characters.';
      if (s.pattern && !new RegExp(s.pattern).test(v)) return name + (/product/i.test(where) ? ' is not a Cortex Cloud product id (a UUID from cloud_search).' : ' has the wrong format.');
    }
    if (Array.isArray(v)) {
      if (s.maxItems !== undefined && v.length > s.maxItems) return name + ' may have at most ' + s.maxItems + ' items.';
      for (let i = 0; i < v.length; i++) { const e = validate(s.items, v[i], name + '[' + i + ']', tool); if (e) return e; }
    }
    if (typeOk(v, 'object') && (s.properties || s.additionalProperties !== undefined || s.required)) {
      const props = s.properties || {};
      const pre = where ? where + '.' : '';
      for (const k of s.required || []) if (v[k] === undefined) return pre + k + ' is required.';
      for (const [k, val] of Object.entries(v)) {
        if (props[k]) { const e = validate(props[k], val, pre + k, tool); if (e) return e; }
        else if (s.additionalProperties === false) return pre + k + ' is not an input of ' + tool + (where ? ' (' + where + ')' : '') + '.';
        else if (s.additionalProperties && typeof s.additionalProperties === 'object') { const e = validate(s.additionalProperties, val, pre + k, tool); if (e) return e; }
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ busy
  const settingsOpen = () => !!document.querySelector('.settings-modal');
  // A dialog of the user's own (Settings, a sheet in which every change applies at once, does not count).
  const userDialogOpen = () => [...document.querySelectorAll('.modal-bg')].some((bg) => !bg.querySelector('.settings-modal'));
  function busyNow() {
    const u = U.ui;
    return Boolean(u.uploading || (window.NanoTransfer && NanoTransfer.busy) || u.scanning || u.cabIRLoadActive || u.previewBusy
      || U.irAudition.busy || userDialogOpen());
  }
  async function closeSettings() {
    const done = document.querySelector('.settings-modal .row .btn.primary');
    if (!done) return;
    done.click();
    await waitUntil(() => !settingsOpen(), 1000);
  }
  // The editor's own confirmation: window to the front, Settings closed, "Asked by …" first. → true when confirmed.
  async function confirmDialog(ctx, { title, body, ok }) {
    if (bridge) bridge.front();
    await closeSettings();
    const choice = await U.modal({ title, body, asked: ctx.asked, buttons: [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: ok, primary: true }] });
    U.render();
    return choice === 'ok';
  }
  async function opensDialog() { if (bridge) bridge.front(); await closeSettings(); }

  // ------------------------------------------------------------------ reading the pedal
  function paramOut(p) {
    const m = p.meta || { kind: 'range', min: 0, max: 10, step: 0.1, unit: '' };
    if (m.kind === 'enum') return { name: p.name, value: m.options[p.value] !== undefined ? m.options[p.value] : (m.options[0] || ''), options: [...m.options] };
    return { name: p.name, value: Number(p.value), display: paramDisplayValue(p), unit: m.unit || '', min: m.min, max: m.max, step: m.step || 0.1 };
  }
  function paramSpec(p) {
    const m = p.meta || { kind: 'range', min: 0, max: 10, step: 0.1, unit: '' };
    return m.kind === 'enum' ? { name: p.name, options: [...m.options] } : { name: p.name, unit: m.unit || '', min: m.min, max: m.max, step: m.step || 0.1 };
  }
  const shownParams = (b, def) => (def && def.displayOrder ? def.displayOrder.map((i) => b.params[i]).filter(Boolean) : b.params);
  function effectOut(key) {
    const b = state.blocks[key];
    const def = b.models.find((m) => m.name === b.model);
    const none = b.model === 'None' && !b.unknownId;
    return {
      slot: key, title: b.title, on: U.stageEnabled(key),
      model: b.unknownId ? 'Unknown effect' : b.model, category: b.unknownId || none || !def ? null : def.category,
      known: !b.unknownId,
      params: b.unknownId || none ? [] : shownParams(b, def).map(paramOut),
      valuesKnown: none || Boolean(b.paramsLoaded || b.paramsFromCache || U.ui.demo),
    };
  }
  const cabMics = () => {
    const name = String(state.currentIR.shortName || '').trim().toLowerCase();
    const listed = state.cabIR.micsByCab && state.cabIR.micsByCab[name];
    return U.selectedIRIsFactory() ? [...(Array.isArray(listed) && listed.length ? listed : U.CAB_MICS)] : [];
  };
  function currentPreset() {
    const n = state.selectedPreset;
    const capSlot = U.activeCaptureSlot(), cabSlot = U.activeIRSlot();
    const factory = U.selectedIRIsFactory();
    return {
      number: n, name: U.presetName(n), unsaved: Boolean(U.isDirtyNow()),
      amp: { ...Object.fromEntries(AMP.map(([k]) => [k, ampOf(state.amp[k])])), volume_db: round1(state.captureVolumeDb || 0) },
      capture: {
        on: U.stageEnabled('capture'), slot: state.capture.fromLibrary ? null : (capSlot || null),
        name: state.currentCapture.name || (capSlot ? state.captureNames.get(capSlot) : '') || '', fromLibrary: Boolean(state.capture.fromLibrary),
      },
      cab: {
        on: U.stageEnabled('cab'), slot: state.cabIR.fromLibrary ? null : (cabSlot || null), name: state.currentIR.shortName || '',
        factory, mic: factory ? state.cabIR.mic : null, position: factory ? Number(state.cabIR.position) : null, mics: cabMics(),
        level_db: round1(state.cabIR.levelDb), high_pass_hz: Math.round(state.cabIR.highPassHz), low_pass_hz: Math.round(state.cabIR.lowPassHz),
        fromLibrary: Boolean(state.cabIR.fromLibrary),
      },
      gate: { on: U.stageEnabled('gate'), reduction: Math.round(Number(state.gate.params[0].value)) },
      effects: SLOTS.map(effectOut),
      tempo: { bpm: Number(state.presetTempo) > 0 ? Number(state.presetTempo) : null },
    };
  }
  const fsPreset = (key) => { const v = state.presetSlots && state.presetSlots[key]; return Number.isInteger(v) && v >= 0 && v < 64 ? v + 1 : null; };

  // ------------------------------------------------------------------ planning edits (validate first, then apply)
  // Each planner checks one part against the state before the call and returns { lines, ops }; ops run in order.
  function planAmp(a) {
    const lines = [], ops = [];
    const before = { level: ampOf(state.amp.level), volume_db: round1(state.captureVolumeDb || 0) };
    if (a.level !== undefined && a.level > before.level + C.safety.ampLevelStep + EPS) refuseWith(stepRefusal('Level', fmtNum(C.safety.ampLevelStep)));
    if (a.volume_db !== undefined) {
      if (a.volume_db > before.volume_db + C.safety.captureVolumeDbStep + EPS) refuseWith(stepRefusal('volume_db', fmtNum(C.safety.captureVolumeDbStep) + ' dB'));
      if (a.volume_db > C.safety.captureVolumeDbMax + EPS && a.volume_db > before.volume_db + EPS) refuseWith(maxRefusal('volume_db', '+' + fmtNum(C.safety.captureVolumeDbMax) + ' dB'));
    }
    const parts = [];
    for (const [k, label] of AMP) {
      if (a[k] === undefined) continue;
      const raw = rawOfAmp(a[k]);
      parts.push(label + ' ' + round1(a[k]).toFixed(1));
      ops.push(() => { state.amp[k] = raw; U.noteExpressionLocalOverride(k, 'range', raw); setAmpKnob(k, raw); });
    }
    if (a.volume_db !== undefined) {
      const v = round1(a.volume_db);
      parts.push('volume ' + fmtDb(v));
      ops.push(() => { state.captureVolumeDb = v; U.noteExpressionLocalOverride('level', 'range', v); setCaptureVolumeDb(v); });
    }
    if (parts.length) lines.push('amp ' + parts.join(', '));
    return { lines, ops };
  }
  function planGate(g) {
    const parts = [], ops = [];
    if (g.on !== undefined) { parts.push(g.on ? 'on' : 'off'); ops.push(() => U.setStageOn('gate', g.on)); }
    if (g.reduction !== undefined) {
      const r = Math.round(g.reduction);
      parts.push('reduction ' + r + ' %');
      ops.push(() => { const p = state.gate.params[0]; p.value = r; U.noteExpressionLocalOverride('gate', 'range', r); setGateReduction(r); });
    }
    return { lines: parts.length ? ['gate ' + parts.join(', ')] : [], ops };
  }
  function planCabTone(t) {
    const parts = [], ops = [];
    const before = round1(state.cabIR.levelDb);
    if (t.level_db !== undefined) {
      if (t.level_db > before + C.safety.cabLevelDbStep + EPS) refuseWith(stepRefusal('cab level_db', fmtNum(C.safety.cabLevelDbStep) + ' dB'));
      if (t.level_db > C.safety.cabLevelDbMax + EPS && t.level_db > before + EPS) refuseWith(maxRefusal('cab level_db', '+' + fmtNum(C.safety.cabLevelDbMax) + ' dB'));
      const v = round1(t.level_db);
      parts.push('level ' + fmtDb(v));
      ops.push(() => setCabIRLevelDb(v));
    }
    if (t.high_pass_hz !== undefined) { const v = Math.round(t.high_pass_hz); parts.push('high pass ' + v + ' Hz'); ops.push(() => setCabIRHighPassHz(v)); }
    if (t.low_pass_hz !== undefined) { const v = Math.round(t.low_pass_hz); parts.push('low pass ' + v + ' Hz'); ops.push(() => setCabIRLowPassHz(v)); }
    return { lines: parts.length ? ['cab ' + parts.join(', ')] : [], ops };
  }
  function planCaptureSlot(slot, field = 'capture_slot') {
    const count = U.captureSlotCount();
    if (slot > count) refuseWith(field + ' must be between 1 and ' + count + ' (the capture slots on this pedal).');
    return { lines: ['capture slot ' + slot + ' ' + quote(state.captureNames.get(slot) || 'Capture ' + slot)], ops: [() => U.pickCaptureSlot(slot)] };
  }
  function planCabSlot(slot, field = 'cab_slot') {
    const count = U.irSlotCount();
    if (slot > count) refuseWith(field + ' must be between 1 and ' + count + ' (the cab/IR slots on this pedal).');
    return { lines: ['cab slot ' + slot + ' ' + quote(state.irNames.get(slot) || 'IR ' + slot)], ops: [() => U.pickCabSlot(slot)] };
  }
  // A value for one effect parameter, checked against its range or options and the loudness step.
  function paramValue(title, p, value) {
    const m = p.meta || { kind: 'range', min: 0, max: 10, step: 0.1, unit: '' };
    if (m.kind === 'enum') {
      let idx = -1;
      if (typeof value === 'number') idx = Number.isInteger(value) && value >= 0 && value < m.options.length ? value : -1;
      else idx = m.options.findIndex((o) => ci(o, value));
      if (idx < 0) refuseWith(title + ' ' + p.name + ' must be one of ' + m.options.join(', ') + ' (or its index, 0 to ' + (m.options.length - 1) + ').');
      return idx;
    }
    const v = typeof value === 'number' ? value : (String(value).trim() !== '' ? Number(value) : NaN);
    if (!Number.isFinite(v)) refuseWith(title + ' ' + p.name + ' takes a number (' + m.min + ' to ' + m.max + (m.unit ? ' ' + m.unit : '') + ').');
    if (v < m.min - EPS || v > m.max + EPS) refuseWith(title + ' ' + p.name + ' must be between ' + m.min + ' and ' + m.max + (m.unit ? ' ' + m.unit : '') + '.');
    if (C.levelRe.test(String(p.name).trim()) && Number.isFinite(m.min) && Number.isFinite(m.max) && m.max > m.min) {
      const share = C.safety.effectLevelStepShare;
      if (v > Number(p.value) + share * (m.max - m.min) + EPS) refuseWith(stepRefusal(title + ' ' + p.name, Math.round(share * 100) + ' % of its range'));
    }
    return roundToStep(clamp(v, m.min, m.max), m.step || 0.1);
  }
  function planEffect(e) {
    const key = e.slot;
    const b = state.blocks[key];
    const title = b.title;
    const lines = [], ops = [];
    let model = null;
    if (e.model !== undefined) {
      model = b.models.find((m) => ci(m.name, e.model));
      if (!model) refuseWith(title + ' has no effect ' + quote(String(e.model)) + '. list_effects lists the models for ' + key + '.');
    }
    const changing = Boolean(model && (model.name !== b.model || b.unknownId));
    const target = model ? model.name : b.model;
    const unknown = !model && Boolean(b.unknownId);
    const params = changing ? model.params : b.params;
    if (changing) { lines.push(title + ' → ' + (model.name === 'None' ? 'empty' : model.name)); ops.push(() => U.chooseModel(key, model.name)); }
    const entries = Object.entries(e.params || {});
    if (entries.length) {
      if (unknown) refuseWith(title + ' holds an effect the editor does not know, so its parameters cannot be set.');
      if (target === 'None') refuseWith(title + ' is empty: choose a model first.');
      for (const [name, value] of entries) {
        const p = params.find((q) => ci(q.name, name));
        if (!p) refuseWith(title + ' ' + target + ' has no parameter ' + quote(name) + '. Its parameters: ' + params.map((q) => q.name).join(', ') + '.');
        const v = paramValue(title, p, value);
        lines.push(title + ' ' + p.name + ' → ' + paramDisplayValue({ ...p, value: v }));
        ops.push(() => {
          const q = state.blocks[key].params.find((x) => x.name === p.name);
          if (!q) return;
          q.value = coerceParamValue(q, v);
          U.noteExpressionLocalOverride(key, 'param', q);
          setFXParam(key, q);
        });
      }
    }
    if (e.on !== undefined) {
      if (e.on && target === 'None' && !unknown) refuseWith(title + ' is empty: choose a model before switching it on.');
      lines.push(title + ' ' + (e.on ? 'on' : 'off'));
      ops.push(() => U.setStageOn(key, e.on));
    }
    return { lines, ops };
  }
  async function runOps(ops) { for (const op of ops) { op(); await Promise.resolve(); } U.render(); }
  // After a batch of edits: the writes have left, then the pedal reports its state back (≤ ~3 s).
  async function readBack() {
    await waitUntil(() => gattWriteQueue.length === 0 && !gattWritePumpRunning, 3000);
    await Promise.race([U.ui.bypassWriteChain, new Promise((r) => setTimeout(r, 2000))]);
    if (state.connected && window.NanoLive && NanoLive.readCurrentState) await NanoLive.readCurrentState(3000);
    U.render();
  }
  const merge = (...plans) => ({ lines: plans.flatMap((p) => p.lines), ops: plans.flatMap((p) => p.ops) });
  const live = (lines, extra) => ({ summary: lines.join('; '), ...extra });

  // ------------------------------------------------------------------ Cortex Cloud (demo: three made-up captures)
  const DEMO_CLOUD = [
    { product_id: '0d3f6c2a-1b4e-4c8d-9a7f-5e2b8c1d0a01', name: 'Glass Clean Combo', author: 'demo-player', tags: ['Clean', 'Combo'], instrument: 'guitar', device: 'amp_combo', gain: 'clean', downloads: 1240, likes: 87, description: 'A bright, glassy clean combo with a touch of compression. Made-up demo data.' },
    { product_id: '7a1e9b44-2c3d-4f5a-8b6c-9d0e1f2a3b02', name: 'Velvet Crunch Head', author: 'demo-player', tags: ['Crunch', 'Head'], instrument: 'guitar', device: 'amp_head', gain: 'crunch', downloads: 860, likes: 52, description: 'A warm crunch head that cleans up with the guitar volume. Made-up demo data.' },
    { product_id: 'c4b2a190-5e6f-4a7b-9c8d-0e1f2a3b4c03', name: 'Thunder Bass Rig', author: 'demo-bassist', tags: ['Bass', 'Full rig'], instrument: 'bass', device: 'full_rig', gain: 'crunch', downloads: 410, likes: 33, description: 'A round, punchy bass rig with a grinding top end. Made-up demo data.' },
  ];
  const demoHash = (id) => Array.from({ length: 64 }, (_, i) => '0123456789abcdef'[(id.charCodeAt(i % id.length) + i * 7) % 16]).join('');
  function demoSearch(query, page) {
    const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    const hits = DEMO_CLOUD.filter((d) => words.some((w) => [d.name, d.description, ...d.tags].join(' ').toLowerCase().includes(w)));
    return { query, page, pages: hits.length ? 1 : 0, total: hits.length, results: (page === 1 ? hits : []).map((d) => ({ ...d, hash: demoHash(d.product_id) })) };
  }
  function demoBundle(id) {
    const d = DEMO_CLOUD.find((x) => ci(x.product_id, id));
    if (!d) return null;
    const bytes = Array.from({ length: 1500 }, (_, i) => (i * 37 + 11) & 255);
    return {
      cns: btoa(String.fromCharCode(...bytes)),
      meta: { hash: demoHash(d.product_id), name: d.name, cloudUUID: d.product_id, authorId: 'demo', authorName: d.author, description: '', deviceType: d.device, tags: d.tags, gainType: d.gain, instrumentType: d.instrument, version: '1' },
    };
  }
  async function cloudBundle(id) {
    if (U.ui.demo) return demoBundle(id) || refuseWith('There is no demo capture with that product id. In demo mode cloud_search returns three made-up captures.');
    if (!bridge) refuseWith('Cortex Cloud is only available in the desktop app.');
    const r = await bridge.cloud('bundle', { id });
    if (!r || !r.ok) refuseWith((r && r.error) || 'Could not fetch the capture from Cortex Cloud.');
    return r.bundle;
  }
  function onPedalOf(r) {
    if (!state.connected || !state.library.loaded) return null;
    const items = [...(state.library.user || []), ...(state.library.factory || [])];
    return items.some((it) => (it.hash && r.hash && ci(it.hash, r.hash)) || ci(it.name, r.name));
  }

  // ------------------------------------------------------------------ the tools
  // Each returns { result, line } (line: the Activity summary) or throws a Refusal. CANCELLED: the user said no.
  const CANCELLED = Symbol('cancelled');
  const cancelled = () => { throw CANCELLED; };
  const libItem = (list, name) => (list || []).find((it) => ci(it.name, name));
  async function needLibrary() { if (!(await U.ensureLibrary())) refuseWith('The pedal did not send its library. Try again in a moment.'); }
  const usersOf = (kind, slot) => (U.ui.usage ? ((kind === 'capture' ? U.ui.usage.captures : U.ui.usage.cabs)[slot] || []) : null);

  const TOOLS = {
    async get_status() {
      const connected = Boolean(state.connected);
      let signedIn = null;
      if (U.ui.demo) signedIn = true;
      else if (bridge) { try { const r = await bridge.cloud('signed-in', {}); signedIn = r && r.ok ? (r.signedIn === undefined ? null : r.signedIn) : null; } catch { signedIn = null; } }
      const audition = U.ui.previewing ? { kind: 'capture', name: U.ui.previewName || '' }
        : U.irAudition.active ? { kind: 'cab', name: U.irAudition.active.name } : null;
      return {
        line: 'read the status',
        result: {
          editor: { edition: 'electron', version: (window.NANO_LINKS && window.NANO_LINKS.version) || '' },
          connected,
          pedal: connected ? { name: (state.device && state.device.name) || 'Nano Cortex', firmware: state.firmware || null } : null,
          preset: connected ? { number: state.selectedPreset, name: U.presetName(state.selectedPreset), unsaved: Boolean(U.isDirtyNow()) } : null,
          audition, cloud: { signedIn }, assistants: { clients: [...(lastStatus.clients || [])] },
        },
      };
    },
    async get_current_preset() { return { line: 'read the current preset', result: currentPreset() }; },
    async list_presets() {
      return {
        line: 'listed the presets',
        result: {
          current: state.selectedPreset,
          presets: Array.from({ length: 64 }, (_, i) => ({ number: i + 1, name: U.presetName(i + 1), empty: /^empty$/i.test(U.presetName(i + 1)) })),
          footswitches: Object.fromEntries(U.FOOTSWITCHES.map((f) => [f.label, fsPreset(f.key)])),
        },
      };
    },
    async list_library(a) {
      await needLibrary();
      const q = String(a.query || '').trim().toLowerCase();
      const matches = (it) => !q || [it.name, NanoText.captureDescription(it.description)].join(' ').toLowerCase().includes(q);
      if (a.kind === 'capture') {
        const out = [...state.library.factory.map((it) => ['factory', it]), ...state.library.user.map((it) => ['user', it])]
          .filter(([, it]) => (!a.instrument || ci(it.instrument, a.instrument)) && (!a.type || ci(it.type, a.type)) && matches(it))
          .map(([source, it]) => {
            const d = NanoText.captureDescription(it.description);
            return { source, name: it.name, type: it.type || null, instrument: it.instrument || null, ...(d ? { description: d } : {}) };
          });
        const slots = Array.from({ length: U.captureSlotCount() }, (_, i) => ({ slot: i + 1, name: state.captureNames.get(i + 1) || '' }));
        return { line: 'listed the capture library', result: { kind: 'capture', slots, library: out } };
      }
      const out = [...state.library.irFactory.map((it) => ['factory', it]), ...state.library.irUser.map((it) => ['user', it])]
        .filter(([, it]) => matches(it)).map(([source, it]) => ({ source, name: it.name }));
      const slots = Array.from({ length: U.irSlotCount() }, (_, i) => ({ slot: i + 1, name: state.irNames.get(i + 1) || '' }));
      return { line: 'listed the cab library', result: { kind: 'cab', slots, library: out } };
    },
    async list_effects(a) {
      const keys = a.slot ? [a.slot] : SLOTS;
      return {
        line: 'listed the effects',
        result: { slots: keys.map((k) => ({ slot: k, title: blockTitle(k), models: state.blocks[k].models.filter((m) => m.name !== 'None').map((m) => ({ name: m.name, category: m.category, params: (m.params || []).map(paramSpec) })) })) },
      };
    },
    async get_slot_usage(a) {
      if (a.scan) {
        if (U.isDirtyNow()) refuseWith(C.errors.unsavedEdits);
        if (busyNow()) refuseWith(C.errors.busy);
        await U.scanUsage();
      }
      const u = U.ui.usage;
      return {
        line: a.scan ? 'scanned the slot usage (' + (u ? u.scanned : 0) + ' presets)' : 'read the slot usage',
        result: u ? { scanned: true, capture: { ...u.captures }, cab: { ...u.cabs } } : { scanned: false, capture: null, cab: null },
      };
    },

    async apply_tone(a) {
      const plans = [];
      if (a.capture_slot !== undefined) plans.push(planCaptureSlot(a.capture_slot));
      if (a.cab_slot !== undefined) plans.push(planCabSlot(a.cab_slot));
      if (a.amp) plans.push(planAmp(a.amp));
      if (a.gate) plans.push(planGate(a.gate));
      if (a.cab_tone) plans.push(planCabTone(a.cab_tone));
      const seen = new Set();
      for (const e of a.effects || []) {
        if (seen.has(e.slot)) refuseWith('effects lists ' + e.slot + ' twice.');
        seen.add(e.slot);
        plans.push(planEffect(e));
      }
      const plan = merge(...plans);
      if (!plan.ops.length) refuseWith('apply_tone got nothing to change.');
      await runOps(plan.ops);
      await readBack();
      return { line: 'applied a tone: ' + plan.lines.join('; '), result: { changes: plan.lines, preset: currentPreset() } };
    },
    async set_amp(a) {
      const plan = planAmp(a);
      if (!plan.ops.length) refuseWith('Give at least one of gain, bass, mid, treble, level or volume_db.');
      await runOps(plan.ops);
      const amp = { ...Object.fromEntries(AMP.map(([k]) => [k, ampOf(state.amp[k])])), volume_db: round1(state.captureVolumeDb || 0) };
      return { line: plan.lines.join('; '), result: live(plan.lines, { amp }) };
    },
    async set_effect(a) {
      if (a.model === undefined && a.on === undefined) refuseWith('Give model, on, or both.');
      const plan = planEffect(a);
      await runOps(plan.ops);
      const b = state.blocks[a.slot];
      const lines = plan.lines.length ? plan.lines : [b.title + ' unchanged'];
      return { line: lines.join('; '), result: live(lines, { slot: a.slot, model: b.model, on: U.stageEnabled(a.slot) }) };
    },
    async set_effect_param(a) {
      const b = state.blocks[a.slot];
      const p = b.params.find((q) => ci(q.name, a.param));
      if (p && !b.unknownId && isParamDisabled(b, p)) refuseWith(b.title + ' ' + p.name + ' is set by the Sync setting; change Sync first.');
      const plan = planEffect({ slot: a.slot, params: { [a.param]: a.value } });
      await runOps(plan.ops);
      const q = state.blocks[a.slot].params.find((x) => ci(x.name, a.param));
      const out = paramOut(q);
      return { line: plan.lines.join('; '), result: live(plan.lines, { slot: a.slot, param: out.name, value: out.value, ...(out.display ? { display: out.display } : {}) }) };
    },
    async set_gate(a) {
      const plan = planGate(a);
      if (!plan.ops.length) refuseWith('Give on, reduction, or both.');
      await runOps(plan.ops);
      return { line: plan.lines.join('; '), result: live(plan.lines, { gate: { on: U.stageEnabled('gate'), reduction: Math.round(Number(state.gate.params[0].value)) } }) };
    },
    async set_cab_tone(a) {
      const plan = planCabTone(a);
      if (!plan.ops.length) refuseWith('Give at least one of level_db, high_pass_hz or low_pass_hz.');
      await runOps(plan.ops);
      return { line: plan.lines.join('; '), result: live(plan.lines, { cab: { level_db: round1(state.cabIR.levelDb), high_pass_hz: Math.round(state.cabIR.highPassHz), low_pass_hz: Math.round(state.cabIR.lowPassHz) } }) };
    },
    async use_capture_slot(a) { return useSlot('capture', a); },
    async use_cab_slot(a) { return useSlot('cab', a); },
    async set_tempo(a) {
      const bpm = U.clampTempo(a.bpm);
      U.setTempo(a.bpm);
      const shown = Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(1);
      const lines = ['tempo ' + shown + ' BPM'];
      return { line: lines[0], result: live(lines, { bpm }) };
    },
    async select_preset(a) {
      const n = a.number;
      if (n === state.selectedPreset && !U.ui.presetUnknown) return { line: 'preset ' + n + ' is already loaded', result: live(['preset ' + n + ' ' + quote(U.presetName(n)) + ' is already loaded'], { number: n, name: U.presetName(n) }) };
      if (U.isDirtyNow()) {
        U.toast('An assistant asked to load preset ' + n + ': save or discard your edits first.');
        refuseWith(C.errors.unsavedEdits);
      }
      await U.goToPreset(n);
      if (state.selectedPreset !== n) refuseWith('The pedal did not switch to preset ' + n + '.');
      const lines = ['loaded preset ' + n + ' ' + quote(U.presetName(n))];
      return { line: lines[0], result: live(lines, { number: n, name: U.presetName(n) }) };
    },
    async discard_edits() {
      const n = state.selectedPreset;
      if (!(await U.discardNow())) refuseWith('The pedal did not confirm stopping the preview, so the edits were kept.');
      const lines = ['discarded the edits of preset ' + n + ' ' + quote(U.presetName(n))];
      return { line: lines[0], result: live(lines, { preset: { number: n, name: U.presetName(n) } }) };
    },
    async preview_cab(a) {
      await needLibrary();
      const kind = a.source === 'factory' ? 'irFactory' : 'irUser';
      const it = libItem(state.library[kind], a.name);
      if (!it) refuseWith('No ' + (a.source === 'factory' ? 'factory cab' : 'user IR') + ' named ' + quote(a.name) + ' in the pedal’s library. list_library kind=cab lists them.');
      if (!(await U.startIRPreview({ kind, index: it.index, name: it.name }))) refuseWith('The pedal did not accept the preview of ' + it.name + '.');
      const lines = ['previewing ' + (a.source === 'factory' ? 'cab ' : 'IR ') + quote(it.name)];
      return { line: lines[0], result: live(lines, { audition: { kind: 'cab', name: it.name } }) };
    },
    async stop_preview() {
      const stopped = [];
      if (U.ui.previewing || U.ui.previewBusy) {
        const name = U.ui.previewName;
        if (!(await U.stopCapturePreview())) refuseWith('The pedal did not confirm stopping the Live Preview; it may still be playing.');
        stopped.push('Live Preview ' + quote(name || 'capture'));
      }
      if (U.irAudition.active) {
        const name = U.irAudition.active.name;
        if (!(await U.stopIRPreview())) refuseWith('The pedal did not confirm stopping the cab preview; it may still be playing.');
        stopped.push('cab preview ' + quote(name));
      }
      const lines = [stopped.length ? 'stopped the ' + stopped.join(' and the ') : 'nothing was auditioned'];
      return { line: lines[0], result: live(lines, { stopped: stopped.length > 0 }) };
    },

    async save(_a, ctx) {
      const n = state.selectedPreset;
      if (!U.isDirtyNow()) refuseWith('Preset ' + n + ' has no unsaved edits, so there is nothing to save.');
      const name = U.presetName(n);
      if (!(await confirmDialog(ctx, { title: 'Save changes to preset ' + n + ' ' + quote(name) + '?', body: 'The preset on the pedal is overwritten with the current sound.', ok: 'Save' }))) cancelled();
      const t0 = Date.now();
      await U.doSave();
      const r = U.ui.lastSave;
      if (!r || r.at < t0 || r.kind !== 'ok') refuseWith(r && r.at >= t0 && r.kind === 'error' ? r.text : 'The pedal did not confirm the save.');
      return { line: 'saved preset ' + n + ' ' + quote(U.presetName(n)), result: { saved: true, number: n, name: U.presetName(n) } };
    },
    async save_as(a, ctx) {
      if (new TextEncoder().encode(a.name.trim()).length > 64) refuseWith('name is too long for the pedal (at most 64 bytes).');
      if (a.name.trim().length < 4) refuseWith('name must have at least 4 characters.');
      await opensDialog();
      const r = await U.doSaveAs(a.number, { name: a.name, asked: ctx.asked });
      if (r && r.cancelled) cancelled();
      if (!r || r.error) refuseWith((r && r.error) || 'The preset was not saved.');
      return { line: 'saved as preset ' + r.number + ' ' + quote(r.name), result: { saved: true, number: r.number, name: r.name } };
    },
    async rename(a, ctx) {
      await opensDialog();
      const r = await U.doRename({ name: a.name, asked: ctx.asked });
      if (r && r.cancelled) cancelled();
      if (!r || r.error) refuseWith((r && r.error) || 'The preset was not renamed.');
      return { line: 'renamed preset ' + r.number + ' to ' + quote(r.name), result: { renamed: true, number: r.number, name: r.name } };
    },
    async load_capture_into_slot(a, ctx) { return loadIntoSlot('capture', a, ctx); },
    async load_cab_into_slot(a, ctx) { return loadIntoSlot('cab', a, ctx); },
    async set_cab_mic(a, ctx) {
      if (a.mic === undefined && a.position === undefined) refuseWith('Give mic, position, or both.');
      if (!U.stageEnabled('cab')) refuseWith('The cab is bypassed: switch it on first (use_cab_slot on=true).');
      if (!U.selectedIRIsFactory()) refuseWith('The preset plays a user IR, which has no mic. Mics are for the factory cabs.');
      if (U.irAuditioning()) refuseWith('Stop the cab preview first (stop_preview).');
      const mics = cabMics();
      let mic = state.cabIR.mic;
      if (a.mic !== undefined) {
        mic = mics.find((m) => ci(m, a.mic));
        if (!mic) refuseWith('mic must be one of ' + mics.join(', ') + '.');
      }
      const position = a.position !== undefined ? a.position : Number(state.cabIR.position);
      const oldMic = state.cabIR.mic, oldPos = Number(state.cabIR.position);
      if (ci(mic, oldMic) && position === oldPos) return { line: 'the cab mic is already ' + mic + ', position ' + position, result: { mic: oldMic, position: oldPos } };
      const slot = U.activeIRSlot();
      const ok = await confirmDialog(ctx, {
        title: slot ? 'Change the mic of cab slot ' + slot + '?' : 'Change the mic of the cab?',
        body: oldMic + ', position ' + oldPos + ' → ' + mic + ', position ' + position + '. The mic is stored in the cab slot, so it changes for every preset that uses ' + (slot ? 'slot ' + slot : 'this cab') + '.',
        ok: 'Change',
      });
      if (!ok) cancelled();
      await setCabIRMicPosition(mic, position);
      U.render();
      return { line: 'cab mic ' + state.cabIR.mic + ', position ' + state.cabIR.position, result: { mic: state.cabIR.mic, position: Number(state.cabIR.position) } };
    },
    async assign_footswitch(a, ctx) {
      const f = U.FOOTSWITCHES.find((x) => x.label === a.footswitch);
      const n = a.preset;
      const now = fsPreset(f.key);
      if (now === n) return { line: 'footswitch ' + f.label + ' already loads preset ' + n, result: { assigned: true, footswitch: f.label, preset: n } };
      const ok = await confirmDialog(ctx, {
        title: 'Assign preset ' + n + ' ' + quote(U.presetName(n)) + ' to footswitch ' + f.label + '?',
        body: now ? 'Footswitch ' + f.label + ' loads preset ' + now + ' ' + quote(U.presetName(now)) + ' now.' : 'Footswitch ' + f.label + ' has no preset now.',
        ok: 'Assign',
      });
      if (!ok) cancelled();
      let saidNo = false;
      const done = await U.assignFootswitch(f.key, n - 1, { onCancel: () => { saidNo = true; } });
      if (saidNo) cancelled();
      if (!done) refuseWith('The pedal did not confirm the footswitch assignment.');
      return { line: 'assigned preset ' + n + ' to footswitch ' + f.label, result: { assigned: true, footswitch: f.label, preset: n } };
    },

    async cloud_search(a) {
      const page = a.page || 1;
      let r;
      if (U.ui.demo) r = demoSearch(a.query, page);
      else {
        if (!bridge) refuseWith('Cortex Cloud is only available in the desktop app.');
        const got = await bridge.cloud('search', { query: a.query, page });
        if (!got || !got.ok) refuseWith((got && got.error) || 'The Cortex Cloud search did not answer.');
        r = got.result;
      }
      if (state.connected && !state.library.loaded) { try { await U.ensureLibrary(); } catch { /* onPedal stays unknown */ } }
      const results = (r.results || []).map((x) => { const { hash, ...rest } = x; return { ...rest, onPedal: onPedalOf(x) }; });
      return { line: 'searched Cortex Cloud for ' + quote(a.query) + ' (' + results.length + (results.length === 1 ? ' result)' : ' results)'), result: { query: a.query, page, pages: r.pages, total: r.total, results } };
    },
    async cloud_open(a) {
      if (!bridge) refuseWith('Cortex Cloud is only available in the desktop app.');
      const r = await bridge.cloud('open', { id: a.product_id });
      if (!r || !r.ok) refuseWith('The editor could not open that capture in the Cortex Cloud tab.');
      return { line: 'opened a Cortex Cloud capture page', result: { opened: true, product_id: a.product_id.toLowerCase() } };
    },
    async cloud_preview(a) {
      if (!state.connected) refuseWith(C.errors.notConnected);
      const bundle = await cloudBundle(a.product_id);
      const name = (bundle.meta && bundle.meta.name) || 'capture';
      if (!(await U.receivePreview(bundle))) refuseWith(U.ui.lastPreviewError || 'The pedal refused the Live Preview.');
      const lines = ['Live Preview of ' + quote(name)];
      return { line: lines[0], result: live(lines, { audition: { kind: 'capture', name } }) };
    },
    async cloud_send(a, ctx) {
      if (!state.connected) refuseWith(C.errors.notConnected);
      const bundle = await cloudBundle(a.product_id);
      await opensDialog();
      const outcome = await new Promise((resolve) => { U.receiveCapture(bundle, { asked: ctx.asked, done: resolve }); });
      if (outcome.cancelled) cancelled();
      if (!outcome.sent) refuseWith(outcome.error || 'The capture was not sent.');
      return { line: 'sent ' + quote(outcome.name) + ' to the pedal’s library', result: { sent: true, name: outcome.name } };
    },
  };

  async function useSlot(kind, a) {
    const key = kind === 'capture' ? 'capture' : 'cab';
    if (a.slot === undefined && a.on === undefined) refuseWith('Give slot, on, or both.');
    if (a.slot !== undefined && a.on === false) refuseWith('Choosing a slot switches the ' + key + ' on; leave out on=false.');
    const plan = a.slot !== undefined ? (kind === 'capture' ? planCaptureSlot(a.slot, 'slot') : planCabSlot(a.slot, 'slot'))
      : { lines: [(kind === 'capture' ? 'capture ' : 'cab ') + (a.on ? 'on' : 'off')], ops: [() => U.setStageOn(key, a.on)] };
    await runOps(plan.ops);
    const slot = kind === 'capture' ? U.activeCaptureSlot() : U.activeIRSlot();
    const name = kind === 'capture' ? (state.currentCapture.name || '') : (state.currentIR.shortName || '');
    return { line: plan.lines.join('; '), result: live(plan.lines, { [key]: { on: U.stageEnabled(key), slot: slot || null, name } }) };
  }

  async function loadIntoSlot(kind, a, ctx) {
    await needLibrary();
    const isCap = kind === 'capture';
    const libKind = isCap ? (a.source === 'factory' ? 'factory' : 'user') : (a.source === 'factory' ? 'irFactory' : 'irUser');
    const it = libItem(state.library[libKind], a.name);
    if (!it) refuseWith('No ' + a.source + ' ' + (isCap ? 'capture' : 'cab or IR') + ' named ' + quote(a.name) + ' in the pedal’s library. list_library kind=' + (isCap ? 'capture' : 'cab') + ' lists them.');
    const count = isCap ? U.captureSlotCount() : U.irSlotCount();
    if (a.slot > count) refuseWith('slot must be between 1 and ' + count + ' (the ' + (isCap ? 'capture' : 'cab/IR') + ' slots on this pedal).');
    const holds = (isCap ? state.captureNames : state.irNames).get(a.slot) || '';
    const users = usersOf(isCap ? 'capture' : 'cab', a.slot);
    const word = isCap ? 'capture slot ' : 'cab slot ';
    const ok = await confirmDialog(ctx, {
      title: 'Load ' + quote(it.name) + ' into ' + word + a.slot + '?',
      body: (holds ? 'Slot ' + a.slot + ' holds ' + quote(holds) + ' now. ' : '')
        + (users === null ? '' : users.length ? 'At the last slot usage scan it was used by preset' + (users.length === 1 ? ' ' : 's ') + users.join(', ') + '. ' : 'No preset used it at the last slot usage scan. ')
        + 'Every preset that uses this slot plays the new ' + (isCap ? 'capture' : 'cab') + '.',
      ok: 'Load',
    });
    if (!ok) cancelled();
    const got = await U.loadFromLibrary(kind, { kind: libKind, index: it.index, name: it.name }, a.slot);
    if (got !== a.slot) refuseWith('The pedal did not confirm loading ' + it.name + ' into slot ' + a.slot + '.');
    return { line: 'loaded ' + quote(it.name) + ' into ' + word + a.slot, result: { loaded: true, slot: a.slot, name: it.name } };
  }

  // ------------------------------------------------------------------ running a call
  // One at a time (the shell already sends them one by one; this keeps it so if a reply is late).
  let chain = Promise.resolve();
  function run(tool, args, client) {
    const job = chain.then(() => runOne(tool, args, client));
    chain = job.catch(() => {});
    return job;
  }
  async function runOne(tool, argsIn, client) {
    await contractReady();
    const args = argsIn && typeof argsIn === 'object' && !Array.isArray(argsIn) ? argsIn : {};
    const refuse = (msg) => { say('refused ' + tool + ': ' + msg); return { ok: false, error: msg }; };
    const def = C.tools.get(tool);
    if (!def) return refuse('Unknown tool: ' + tool + '.');
    const bad = validate(def.inputSchema, args, '', tool);
    if (bad) return refuse(bad);
    if (tool !== 'get_status' && !tool.startsWith('cloud_') && !state.connected) return refuse(C.errors.notConnected);
    if ((def.kind === 'live' || def.kind === 'confirm') && busyNow()) return refuse(C.errors.busy);
    const ctx = { client, asked: 'Asked by ' + (client || 'your AI assistant') + '.' };
    try {
      const r = await TOOLS[tool](args, ctx);
      say(r.line);
      return { ok: true, result: r.result };
    } catch (err) {
      if (err === CANCELLED) { say(tool + ' cancelled in the editor'); return { ok: false, error: C.errors.cancelled }; }
      if (err instanceof Refusal) return refuse(err.message);
      return refuse('The editor hit an error: ' + ((err && err.message) || err));
    }
  }
  if (bridge) bridge.onCall((call) => {
    const c = call && typeof call === 'object' ? call : {};
    run(String(c.tool || ''), c.args, c.client ? String(c.client) : null).then((answer) => bridge.reply(c.id, answer));
  });

  // ------------------------------------------------------------------ what the user sees
  let lastStatus = { on: false, phase: 'off', clients: [], text: 'Off', setup: null };
  const pill = document.getElementById('agentPill');
  let page = null;   // the open Settings page's live parts
  function applyStatus(st) {
    if (!st || typeof st !== 'object') return;
    lastStatus = st;
    const clients = st.clients || [];
    if (pill) {
      pill.hidden = !clients.length;
      pill.title = clients.length ? 'Connected: ' + clients.join(', ') + '. Click for Settings → AI assistants.' : '';
    }
    if (page) page.update();
  }
  if (pill) pill.addEventListener('click', () => U.openSettings('ai'));
  if (bridge) {
    bridge.onStatus(applyStatus);
    bridge.onConnected((label) => U.toast((label || 'An AI assistant') + ' connected'));
    bridge.status().then(applyStatus).catch(() => {});
    contractReady();
  }

  const LEARN = {
    claudeCode: 'https://code.claude.com/docs/en/mcp',
    codex: 'https://developers.openai.com/codex/mcp',
    claudeDesktop: 'https://modelcontextprotocol.io/docs/develop/connect-local-servers',
    cursor: 'https://cursor.com/docs/context/mcp',
    vscode: 'https://code.visualstudio.com/docs/copilot/customization/mcp-servers',
  };
  const copied = { last: '' };
  async function copyText(text, btn) {
    copied.last = text;
    try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; } catch { btn.textContent = 'Copy failed'; }
    setTimeout(() => { if (btn.isConnected) btn.textContent = 'Copy'; }, 1500);
  }
  function buildPage() {
    const el = U.el;
    const status = el('span', { class: 'set-unit ai-status', dataset: { fk: 'ai-status' } });
    const sw = U.toggleSwitch('set-ai', 'Allow AI assistants to control the editor', !!lastStatus.on, async (v) => {
      sw.disabled = true;
      try { applyStatus(await bridge.setEnabled(v)); } finally { sw.disabled = false; if (page) page.update(); }
    });
    const learn = (k, fk) => U.linkEl(LEARN[k], 'Learn more', fk);
    const codeRow = (fk, label, textOf, learnKey) => {
      const code = el('code', { class: 'ai-code', dataset: { fk: fk + '-text' } });
      const btn = el('button', { class: 'btn small', dataset: { fk: fk + '-copy' }, onclick: () => copyText(textOf(), btn) }, 'Copy');
      const row = el('div', { class: 'ai-setup', dataset: { fk } },
        el('div', { class: 'ai-setup-head' }, el('span', { class: 'ai-setup-name', text: label }), el('div', { class: 'grow' }), btn, learnKey ? learn(learnKey, fk + '-learn') : null),
        code);
      return { row, update: () => { code.textContent = textOf(); } };
    };
    const S = () => lastStatus.setup || {};
    const cc = codeRow('ai-claude-code', 'Claude Code', () => S().claudeCode || '', 'claudeCode');
    const cx = codeRow('ai-codex', 'Codex and the ChatGPT desktop app', () => S().codex || '', 'codex');
    const js = codeRow('ai-json', 'Other assistants', () => S().json || '', null);
    // Claude Desktop: shows the entry it will write and asks first (inline, since Settings is already a dialog).
    const deskNote = el('p', { class: 'set-note', dataset: { fk: 'ai-desktop-note' }, hidden: true });
    const deskConfirm = el('div', { class: 'ai-confirm', dataset: { fk: 'ai-desktop-confirm' }, hidden: true });
    const deskBtn = el('button', { class: 'btn small', dataset: { fk: 'ai-desktop-add' }, onclick: () => {
      deskConfirm.replaceChildren(
        el('p', { class: 'set-note', text: 'This adds the entry below to ' + S().claudeDesktop + '. Every other entry stays, and the old file is kept as claude_desktop_config.json.bak. Restart Claude Desktop afterwards.' }),
        el('pre', { class: 'ai-code', dataset: { fk: 'ai-desktop-entry' }, text: S().desktopEntry || '' }),
        el('div', { class: 'ai-confirm-row' },
          el('button', { class: 'btn small', dataset: { fk: 'ai-desktop-cancel' }, onclick: () => { deskConfirm.hidden = true; deskBtn.disabled = false; } }, 'Cancel'),
          el('button', { class: 'btn small primary', dataset: { fk: 'ai-desktop-confirm-add' }, onclick: async () => {
            const r = await bridge.addToClaudeDesktop().catch((err) => ({ ok: false, error: err.message }));
            deskConfirm.hidden = true; deskBtn.disabled = false;
            deskNote.hidden = false;
            deskNote.textContent = r && r.ok ? 'Added to Claude Desktop' + (r.backup ? ' (the old file is kept as ' + r.backup.split(/[\\/]/).pop() + ')' : '') + '. Restart Claude Desktop to use it.' : 'Not added: ' + ((r && r.error) || 'unknown error');
          } }, 'Add to Claude Desktop')));
      deskConfirm.hidden = false; deskBtn.disabled = true; deskNote.hidden = true;
    } }, 'Add to Claude Desktop…');
    const desk = el('div', { class: 'ai-setup', dataset: { fk: 'ai-desktop' } },
      el('div', { class: 'ai-setup-head' }, el('span', { class: 'ai-setup-name', text: 'Claude Desktop' }), el('div', { class: 'grow' }), deskBtn, learn('claudeDesktop', 'ai-desktop-learn')),
      deskConfirm, deskNote);
    const installRow = (kind, label) => el('div', { class: 'ai-setup', dataset: { fk: 'ai-' + kind } },
      el('div', { class: 'ai-setup-head' }, el('span', { class: 'ai-setup-name', text: label }), el('div', { class: 'grow' }),
        el('button', { class: 'btn small', dataset: { fk: 'ai-' + kind + '-install' }, title: 'Opens ' + label + ' to add Nano Cortex Editor', onclick: () => bridge.install(kind) }, 'Add to ' + label),
        learn(kind, 'ai-' + kind + '-learn')));
    const root = el('div', { class: 'ai-page', dataset: { fk: 'ai-page' } },
      el('section', {}, el('h3', { text: 'AI assistants' }),
        U.setRow('', sw),
        U.setNote('Assistants on this computer, such as Claude, ChatGPT or Codex, can read the pedal and make live edits. Saving and anything stored on the pedal still needs your click in the editor.', 'ai-explain'),
        U.setRow('Status', status)),
      el('section', {}, el('h3', { text: 'Set up' }),
        U.setNote('Copy the line for your assistant (it holds this installation’s paths), or use the button. The editor has to be open, with the switch above on, while the assistant works.', 'ai-setup-note'),
        cc.row, cx.row, desk, installRow('cursor', 'Cursor'), installRow('vscode', 'VS Code'), js.row));
    page = {
      update() {
        status.textContent = lastStatus.text || 'Off';
        sw.classList.toggle('on', !!lastStatus.on); sw.setAttribute('aria-checked', String(!!lastStatus.on));
        cc.update(); cx.update(); js.update();
        desk.hidden = !S().claudeDesktop;
      },
    };
    page.update();
    return root;
  }
  U.addSettingsPage({
    id: 'ai', label: 'AI assistants',
    available: () => !!bridge,
    build: () => { if (bridge) bridge.status().then(applyStatus).catch(() => {}); return buildPage(); },
    closed: () => { page = null; },
  });

  // For the UX test: the dispatcher (what the shell's calls run), the last copied setup text, the status.
  window.__agent = {
    run, get copied() { return copied.last; }, get status() { return lastStatus; }, demoCloud: DEMO_CLOUD,
    validate: (tool, args) => { const d = C.tools.get(tool); return d ? validate(d.inputSchema, args, '', tool) : 'unknown'; },
  };
})();
