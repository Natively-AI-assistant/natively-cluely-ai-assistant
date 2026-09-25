// electron/services/__tests__/WtaActiveCodingProblem2026_09_23.test.mjs
//
// Issue #539: What to Answer lost the active coding problem. The hot window is
// 180s; the interviewer stated a key-rotation problem, the conversation moved on,
// and "show the solution in python" then routed general_meeting_answer with no
// problem attached — live, the model answered an unrelated count_ways(n).
//
// Real SessionTracker (real coding-question detection from transcript segments)
// + real IntelligenceEngine.runWhatShouldISay. Only the provider call is stubbed:
// it captures the exact prompt that would leave the process.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
if (!process.env.NATIVELY_TEST_USERDATA) {
  process.env.NATIVELY_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'wta-active-coding-'));
}
const { SessionTracker } = require(path.resolve(repoRoot, 'dist-electron/electron/SessionTracker.js'));
const { IntelligenceEngine } = require(path.resolve(repoRoot, 'dist-electron/electron/IntelligenceEngine.js'));

function makeHelper(captured) {
  const base = {
    setNegotiationCoachingHandler() {}, isUsingOllama() { return false; }, canUseLocalFallback() { return false; },
    getPromptTier() { return 'cloud'; }, getCapabilities() { return { contextWindow: 128000, supportsVision: true }; },
    fitContextForCurrentModel(x) { return x; }, rememberAnswerCall() {},
    async *streamChat(...a) {
      captured.push(`${String(a[3] ?? '')}\n${String(a[0] ?? '')}`);
      yield 'Here it is:\n```python\ndef rotate():\n    return 1\n```\n';
    },
  };
  return new Proxy(base, { get(t, k) { return k in t ? t[k] : undefined; }, has() { return true; } });
}

const PROBLEM = 'Implement a function to rotate the active encryption key at the top of every hour, and return the key version used.';

async function press(segments) {
  const now = Date.now();
  const session = new SessionTracker();
  for (const [agoSec, speaker, text] of segments) {
    session.handleTranscript({ speaker, text, timestamp: now - agoSec * 1000, final: true });
  }
  const captured = [];
  const engine = new IntelligenceEngine(makeHelper(captured), session);
  await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });
  return captured.join('\n');
}

// Problem stated >180s before the press, so it is outside the hot window.
const earlier = [
  [330, 'interviewer', 'So we have two microservices. Service A encrypts messages and service B decrypts them.'],
  [320, 'interviewer', PROBLEM],
  [150, 'user', 'Okay, so I would keep a map from key version to key.'],
  [120, 'interviewer', 'Sounds good, keep going.'],
  [60, 'user', 'And each message carries its version in a header.'],
];

describe('WTA keeps the active coding problem for a coding continuation (#539)', () => {
  for (const ask of ['show the solution in python', 'show in python', 'show me how you would implement in python']) {
    test(`"${ask}" reaches the model with the evicted problem`, async () => {
      const prompt = await press([...earlier, [3, 'interviewer', ask]]);
      assert.ok(prompt, 'the provider was called');
      assert.match(prompt, /rotate the active encryption key/, 'problem statement missing from the prompt');
      assert.match(prompt, /follow-up to the coding problem/, 'the ask was not resolved against the problem');
    });
  }

  test('a behavioural question after the coding problem does NOT inherit it', async () => {
    const prompt = await press([...earlier, [3, 'interviewer', 'Tell me about your experience with python']]);
    assert.ok(prompt, 'the provider was called');
    assert.doesNotMatch(prompt, /follow-up to the coding problem/);
    // 2026-09-24: in a live meeting a personal question also reads the
    // transcript (details the user said aloud), and this fixture's whole
    // meeting is one retrievable window — so the old problem may appear as
    // quoted MEETING_TRANSCRIPT evidence. It must appear NOWHERE else: not as
    // the question, not as the active coding problem.
    const outsideTranscriptEvidence = prompt.replace(
      /<evidence[^>]*source_type="MEETING_TRANSCRIPT"[^>]*>[\s\S]*?<\/evidence>/g, '');
    assert.doesNotMatch(outsideTranscriptEvidence, /rotate the active encryption key/);
  });

  // The old turns can still reach the prompt through the durable meeting-transcript
  // block (unchanged by this fix); what must not happen is the question being
  // rewritten as a follow-up to the OLD problem.
  test('a new, self-contained coding question is NOT rewritten onto the old problem', async () => {
    const prompt = await press([...earlier, [3, 'interviewer', 'Now write a function that reverses a linked list in place.']]);
    assert.ok(prompt, 'the provider was called');
    assert.doesNotMatch(prompt, /follow-up to the coding problem/);
    assert.match(prompt, /reverses a linked list/);
  });
});
