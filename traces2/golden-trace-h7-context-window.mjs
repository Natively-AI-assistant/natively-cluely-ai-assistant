// traces2/golden-trace-h7-context-window.mjs
//
// Live-path proof for H7 (traces2/forensic-report.md §4, item 4 / §"Not yet
// tested" item 6): SessionTracker.getContext(180) — the window every live
// caller (IntelligenceEngine.runWhatShouldISay, planSuggestionTrigger,
// LiveTranscriptBrain.DEFAULT_ANSWER_WINDOW_SECONDS, main.ts's comp-evidence
// provider) actually requests — was silently capped at 120s by
// evictOldEntries()'s hard-coded contextWindowDuration, regardless of the
// caller's argument. This script drives the REAL compiled SessionTracker
// (dist-electron), not a fake/fixture, and prints the before/after behavior.
//
// Usage: node traces2/golden-trace-h7-context-window.mjs
// (run `npm run build:electron` first so dist-electron reflects the current source)

import os from 'node:os';
process.env.NATIVELY_TEST_USERDATA = os.tmpdir();
const { SessionTracker } = await import('../dist-electron/electron/SessionTracker.js');

const st = new SessionTracker();

// 10 segments spaced 20s apart, spanning a 180s window (t+0 .. t+180).
const baseTime = Date.now() - 180_000;
for (let i = 0; i < 10; i++) {
  const ts = baseTime + i * 20_000;
  st.handleTranscript({
    speaker: i % 2 === 0 ? 'interviewer' : 'user',
    text: `Segment ${i} at t+${Math.round((ts - baseTime) / 1000)}s`,
    final: true,
    timestamp: ts,
  });
}

const ctx180 = st.getContext(180);
const ctx120 = st.getContext(120);

console.log('[TRACE:H7] getContext(180) returned', ctx180.length, 'items');
console.log('[TRACE:H7] getContext(120) returned', ctx120.length, 'items');
console.log('[TRACE:H7] items(180):', ctx180.map((c) => c.text));

const bugPresent = ctx180.length === ctx120.length;
console.log(bugPresent
  ? '[TRACE:H7] BUG STILL PRESENT — getContext(180) === getContext(120), the 180s window is being silently clamped to 120s.'
  : '[TRACE:H7] FIX VERIFIED — getContext(180) returns more items than getContext(120); the requested 180s window is genuinely honored.');
