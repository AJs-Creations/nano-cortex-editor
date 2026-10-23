// Capture metadata text, cleaned the same way wherever it is shown or sent: the editor page loads this as a script
// (window.NanoText) and the main process requires it for the Cortex Cloud bundle metadata.
(function (root) {
  // Empty, blank and the text "null" (any case) all mean "no description": nothing is shown, searched or sent. (The
  // "null" seen in the Info panel on a real pedal, 2026-10-23, came from the panel itself; this keeps a "null" from the
  // pedal or from Cortex Cloud metadata out as well.)
  function captureDescription(text) {
    const s = text === undefined || text === null ? '' : String(text);
    const t = s.trim();
    return t === '' || t.toLowerCase() === 'null' ? '' : s;
  }
  const NanoText = Object.freeze({ captureDescription });
  if (typeof module !== 'undefined' && module.exports) module.exports = NanoText;
  else root.NanoText = NanoText;
})(typeof window !== 'undefined' ? window : globalThis);
