// Capture upload to the pedal over C304.
//
// Decoded from a PacketLogger trace of the official phone app sending two
// captures to a Nano Cortex (docs/INVESTIGATION.md §6; the recording itself is
// not published). The app sends one protobuf message of type 13:
//
//   { 1: 6, 3: { 1: <.cns bytes> }, 4: CaptureRecord }
//   CaptureRecord { 1: hash, 2: name, 3: cloudUUID, 4: { 1: authorId, 2: authorName },
//                   5: description, 6: deviceType, 7: tags[], 8: gainType,
//                   10: instrumentType, 12: version }
//
// Big messages are streamed: body + u32 type, cut into 500-byte writes with a
// 2-byte header [len & 0xFF, flags], flags = 0x40 first | 0x80 last | bit 0 =
// bit 8 of len. (A single-chunk message is the familiar `len C0 … type` frame.)
// The last write is padded to 500 bytes like the official app does.
// The pedal answers with type 14: { 1: 6, 3: status, 4: { 1: userIndex, 2: name, 3: hash } }.
//
// Loaded after core.js (needs writeC304, frameType, parseProtoFields, onC305)
// and before ui.js.
(() => {
  'use strict';

  const MSG_UPLOAD_CAPTURE = 13;
  const MSG_UPLOAD_CAPTURE_REPLY = 14;
  const WRITE_SIZE = 500;           // bytes per BLE write, as the official app
  const CHUNK = WRITE_SIZE - 2;     // data bytes per write

  const enc = new TextEncoder();
  const varint = (n) => { const o = []; n = Math.max(0, Math.floor(Number(n) || 0)); while (n > 0x7f) { o.push((n % 128) | 0x80); n = Math.floor(n / 128); } o.push(n); return o; };
  const tag = (num, wire) => varint(num * 8 + wire);
  const str = (num, s) => { if (s === undefined || s === null) return []; const b = enc.encode(String(s)); return [...tag(num, 2), ...varint(b.length), ...b]; };
  const bytes = (num, b) => [...tag(num, 2), ...varint(b.length), ...b];
  const int = (num, v) => (v === undefined || v === null || v === '' ? [] : [...tag(num, 0), ...varint(v)]);

  function captureRecord(m) {
    return [
      ...str(1, m.hash), ...str(2, m.name), ...str(3, m.cloudUUID),
      ...bytes(4, [...str(1, m.authorId), ...str(2, m.authorName)]),
      ...str(5, m.description || ''),
      ...str(6, m.deviceType || 'default'),
      ...(m.tags || []).flatMap(t => str(7, t)),
      ...int(8, m.gainType),
      ...str(10, m.instrumentType || 'instrument_not_set'),
      ...str(12, String(m.version || '1')),
    ];
  }

  function uploadMessage(cns, meta) {
    return [...int(1, 6), ...bytes(3, bytes(1, Array.from(cns))), ...bytes(4, captureRecord(meta))];
  }

  // body (array of bytes) + message type → list of Uint8Array writes.
  function chunks(body, type, pad = true) {
    const all = [...body, type & 0xff, (type >> 8) & 0xff, (type >> 16) & 0xff, (type >>> 24) & 0xff];
    const out = [];
    for (let i = 0; i < all.length; i += CHUNK) {
      const part = all.slice(i, i + CHUNK);
      const last = i + CHUNK >= all.length;
      const flags = (i === 0 ? 0x40 : 0) | (last ? 0x80 : 0) | ((part.length >> 8) & 1);
      const frame = [part.length & 0xff, flags, ...part];
      if (pad && out.length > 0 && last) while (frame.length < WRITE_SIZE) frame.push(0);
      out.push(Uint8Array.from(frame));
    }
    return out;
  }

  // Reassembles streamed writes/notifications: feed each packet, get the full
  // message (body + type) back when the last one arrives, else null.
  function makeReassembler() {
    let buf = null;
    return (packet) => {
      if (packet.length < 2) return null;
      const flags = packet[1];
      const len = packet[0] | ((flags & 1) << 8);
      if (flags & 0x40) buf = [];
      if (!buf) return null;
      buf.push(...packet.slice(2, 2 + len));
      if (flags & 0x80) { const done = Uint8Array.from(buf); buf = null; return done; }
      return null;
    };
  }

  function parseUploadReply(data) {
    const f = parseProtoFields(data.slice(2, data.length - 4));
    const first = (fields, n) => fields[n] && fields[n][0];
    const text = (fields, n) => { const x = first(fields, n); return x && x.wire === 2 ? new TextDecoder().decode(Uint8Array.from(x.raw)) : ''; };
    const status = first(f, 3) ? first(f, 3).value : 0;
    const rec = first(f, 4) && first(f, 4).wire === 2 ? parseProtoFields(first(f, 4).raw) : {};
    return {
      ok: status === 1,
      index: first(rec, 1) ? first(rec, 1).value : 0,
      name: text(rec, 2), hash: text(rec, 3),
      message: text(f, 5) || text(rec, 4) || '',
    };
  }

  // Catch the pedal's reply before the core's dispatch sees it.
  let waiting = null;
  const coreOnC305 = window.onC305;
  window.onC305 = function (event) {
    const data = new Uint8Array(event.target.value.buffer.slice(0));
    if (waiting && frameType(data) === MSG_UPLOAD_CAPTURE_REPLY) {
      log('RX capture upload reply: ' + hex(data));
      const w = waiting; waiting = null;
      w(parseUploadReply(data));
      return;
    }
    return coreOnC305.call(this, event);
  };

  // Sends one capture. cns: Uint8Array; meta: see captureRecord. Resolves with
  // the parsed reply; rejects on a failed write or no reply.
  async function uploadCapture({ cns, meta }, onProgress) {
    if (!state.connected) throw new Error('Not connected');
    const parts = chunks(uploadMessage(cns, meta), MSG_UPLOAD_CAPTURE);
    const reply = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (waiting === resolve) { waiting = null; reject(new Error('The pedal did not answer within 20 s')); } }, 20000);
      waiting = (r) => { clearTimeout(timer); resolve(r); };
    });
    for (let i = 0; i < parts.length; i++) {
      const ok = await writeC304('Capture upload "' + meta.name + '" ' + (i + 1) + '/' + parts.length, parts[i]);
      if (!ok) { waiting = null; throw new Error('Bluetooth write failed at part ' + (i + 1) + ' of ' + parts.length); }
      if (onProgress) onProgress(i + 1, parts.length);
    }
    const r = await reply;
    log('Capture upload ' + (r.ok ? 'accepted' : 'REFUSED') + ': "' + r.name + '" user index ' + r.index + (r.message ? ' (' + r.message + ')' : ''));
    return r;
  }

  window.NanoTransfer = { MSG_UPLOAD_CAPTURE, MSG_UPLOAD_CAPTURE_REPLY, WRITE_SIZE, uploadMessage, captureRecord, chunks, makeReassembler, parseUploadReply, uploadCapture };
})();
