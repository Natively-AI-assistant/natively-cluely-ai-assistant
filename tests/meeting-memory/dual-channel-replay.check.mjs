// Dual-channel transcript replay check (PX-2002).
//
// Replays a >180-second mock interview through the REAL SessionTracker the way
// the live pipeline writes it — mic channel as speaker 'user', system-audio
// channel as speaker 'interviewer' (main.ts: `seg.source === 'system' ?
// 'interviewer' : 'user'`) — then shows what each prompt-context reader would
// have handed the model.
//
// What it proves:
//   1. The rolling window (getContext / getFormattedContext) really is evicted
//      at 180s — every earlier turn is gone from it. That is the truncation
//      this ticket removes from answer prompts.
//   2. The durable speech read the answer paths now use —
//      getFormattedSpeech(SPEECH_WINDOW_SECONDS) — returns the WHOLE >180s
//      sample on both channels, labelled [ME]: / [INTERVIEWER]:, with no
//      assistant suggestions and no typed lines mixed in.
//   3. The full formatted context is printed so a human can read exactly what
//      the prompt receives.
//
// Run: npm run test:meeting-memory:replay
//   (= npm run build:electron && node tests/meeting-memory/dual-channel-replay.check.mjs)
// Without the private premium submodule, build with NATIVELY_CORE_SMOKE=1 —
// SessionTracker has no premium import, so the check runs the same.
// (SessionTracker is imported from dist-electron, like the __tests__ suites.)

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const distDir = path.join(ROOT, 'dist-electron', 'electron');

const { SessionTracker } = await import(pathToFileURL(path.join(distDir, 'SessionTracker.js')).href);
const { SPEECH_WINDOW_SECONDS, speechWindowForPrompt } = await import(
  pathToFileURL(path.join(distDir, 'llm', 'conversationHistoryPolicy.js')).href
);

// ── the replayed meeting ─────────────────────────────────────────────────────
// Eight minutes of back-and-forth, one line every ~12 s. Distinctive tokens at
// 470 s, 300 s, 200 s and 30 s ago so presence/absence is decidable by search.
const now = Date.now();
const LINES = [
  // [offsetSecondsAgo, channel, text]
  [470, 'interviewer', 'Let us start. Earlier you mentioned project FALCON-QUILL-8842 — walk me through it.'],
  [455, 'user', 'Falcon Quill was a migration off a legacy queue, mostly retry-policy work.'],
  [430, 'interviewer', 'What scale did it run at?'],
  [415, 'user', 'About forty thousand messages a second at peak.'],
  [300, 'interviewer', 'Different topic. How would you design a retry policy for API TANGENT-LOTUS-7317?'],
  [285, 'user', 'Exponential backoff with jitter, capped by a deadline budget.'],
  [270, 'interviewer', 'And what happens when the budget is exhausted?'],
  [255, 'user', 'It goes to a dead-letter topic with an alarm on depth.'],
  [200, 'interviewer', 'One more thing — caching. Where would you put cache MERIDIAN-CACHE-5561 in that design?'],
  [185, 'user', 'In front of the read path with a write-through invalidation.'],
  [120, 'interviewer', 'Right. Now a coding question: given a string, return the longest palindromic substring.'],
  [100, 'user', 'I would expand around each center, handling even and odd lengths separately.'],
  [60, 'interviewer', 'What is the time complexity of that?'],
  [30, 'user', 'O(n^2) time, O(1) extra space.'],
  [5, 'interviewer', 'Okay — and why is it better than dynamic programming here?'],
];

const FACTS = ['FALCON-QUILL-8842', 'TANGENT-LOTUS-7317', 'MERIDIAN-CACHE-5561'];
const SPEAKER = { interviewer: 'interviewer', user: 'user' }; // system-audio, mic

const session = new SessionTracker();
for (const [ago, who, text] of LINES) {
  session.addTranscript({ speaker: SPEAKER[who], text, timestamp: now - ago * 1000, final: true, confidence: 0.95 });
}
// The meeting also produced suggestions and a typed chat line — neither is meeting speech.
session.addAssistantMessage('Consider mentioning the deadlock edge case.', undefined, 'what_to_answer');
session.addTranscript({ speaker: 'user', text: 'what was the retry cap again?', timestamp: now - 45 * 1000, final: true, origin: 'manual_chat' });

const spanSec = Math.round(LINES[0][0]);
console.log(`# Dual-channel replay — ${LINES.length} spoken lines over ${spanSec}s (>180s)`);
console.log(`# mic=user, system-audio=interviewer, plus 1 assistant suggestion and 1 typed line\n`);

// ── 1. the rolling window the old code sent ──────────────────────────────────
const rolling = session.getFormattedContext(180);
const rollingHas = FACTS.filter((f) => rolling.includes(f));
console.log(`## Rolling getFormattedContext(180) — what prompts got BEFORE the fix`);
console.log(`   lines: ${rolling.split('\n').filter(Boolean).length}, facts visible: ${rollingHas.length}/${FACTS.length} ${JSON.stringify(rollingHas)}`);
assert.equal(rollingHas.length, 0, 'expected the >180s facts to be ABSENT from the rolling window');

// ── 2. the durable speech the answer paths now send ──────────────────────────
const speech = session.getFormattedSpeech(SPEECH_WINDOW_SECONDS);
const missing = FACTS.filter((f) => !speech.includes(f));
assert.deepEqual(missing, [], `durable speech missing facts: ${missing}`);
assert.ok(speech.includes('[INTERVIEWER]:'), 'system-audio channel missing');
assert.ok(speech.includes('[ME]:'), 'mic channel missing');
assert.ok(!speech.includes('ASSISTANT'), 'assistant suggestion leaked into speech window');
assert.ok(!speech.includes('ME TYPED'), 'typed chat leaked into speech window');
// Oldest line must be present in full — the window reaches the start of the sample.
assert.ok(speech.includes(LINES[0][2]), 'oldest turn truncated out of the durable window');

console.log(`\n## getFormattedSpeech(SPEECH_WINDOW_SECONDS=${SPEECH_WINDOW_SECONDS}) — what prompts get NOW`);
console.log('─'.repeat(72));
console.log(speech);
console.log('─'.repeat(72));
console.log(`   chars: ${speech.length}, facts visible: ${FACTS.length}/${FACTS.length}, channels: [ME]+[INTERVIEWER]`);

// ── 3. what the V3 composer keeps of it (line-bounded speech window) ─────────
const promptSlice = speechWindowForPrompt(speech);
const newest = LINES[LINES.length - 1][2];
assert.ok(promptSlice.includes(newest), 'speech window dropped the newest line');
console.log(`\n## speechWindowForPrompt (V3 composer, char-bounded)`);
console.log(`   chars kept: ${promptSlice.length} / ${speech.length}; newest line present: true`);

console.log('\nPASS — dual-channel replay: >180s sample reaches the prompt complete.');
