// electron/llm/__tests__/InterimInjectionGuard2026_08_21.test.mjs
//
// RC-1 regression suite from live shadow session C (2026-08-21, NativelyProSTT).
//
// Measured defect: the STT relay sent CUMULATIVE interim results — one interim
// grew monotonically 21 -> 10,126 chars over 56 minutes, never resetting per
// utterance. Both injection sites (IntelligenceEngine WTA path and
// SessionTracker.getContextWithInterim) guarded only with exact-equality or a
// 1-second timestamp window, so the whole-session blob was appended as the
// newest interviewer turn on every press. extractLatestQuestion returned it
// byte-for-byte as "the question" (86/86 injected presses; 0/66 non-injected
// presses had a blob question), freezing 20/85 answers on the interviewer's
// opening monologue and routing 17 of them into ethical_usage_answer via a
// cross-sentence stealth-classifier false positive.
//
// The fix is a shared pure resolver: containment (cut everything already
// covered by finals, keep only the novel tail), a length cap backstop, and a
// staleness window.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/', p)).href;
const {
  resolveInterimInjection,
  MAX_INTERIM_INJECTION_CHARS,
  INTERIM_STALE_MS,
} = await import(dist('interimInjectionGuard.js'));

const NOW = 1_787_255_000_000;
const finals = (...texts) => texts.map((text, i) => ({
  role: 'interviewer',
  text,
  timestamp: NOW - (texts.length - i) * 5_000,
}));

const resolve = (interimText, opts = {}) => resolveInterimInjection({
  interim: { text: interimText, timestamp: opts.timestamp ?? NOW - 500 },
  recentInterviewerFinals: opts.finals ?? [],
  lastContextItem: opts.lastContextItem ?? (opts.finals?.length ? opts.finals[opts.finals.length - 1] : null),
  now: NOW,
});

describe('RC-1: cumulative superset interims are cut to their novel tail', () => {
  test('interim repeating two prior finals injects only the unseen question', () => {
    const priorFinals = finals(
      'Tell me about Natively, the meeting copilot.',
      'And what part of the system did you personally build?',
    );
    const r = resolve(
      'Tell me about Natively, the meeting copilot. And what part of the system did you personally build? '
      + 'Okay. If I were to clone this repository today, where would you start?',
      { finals: priorFinals },
    );
    assert.equal(r.action, 'inject');
    assert.equal(r.reason, 'novel_tail');
    assert.match(r.text, /clone this repository today, where would you start\?/);
    assert.doesNotMatch(r.text, /meeting copilot/);
    assert.doesNotMatch(r.text, /personally build/);
  });

  test('punctuation and casing differences between final and interim still anchor', () => {
    const priorFinals = finals("Okay. So what's a semaphore?");
    const r = resolve(
      "okay so whats a semaphore can you give me a solution where semaphore is more appropriate than mutex",
      { finals: priorFinals },
    );
    assert.equal(r.action, 'inject');
    assert.equal(r.reason, 'novel_tail');
    assert.match(r.text, /more appropriate than mutex/);
    assert.doesNotMatch(r.text, /whats a semaphore/);
  });

  test('a session-long blob with the newest final mid-way injects only what follows it', () => {
    const opener = "Hey Evin. Good to meet you. How's your day going? Alright, great. So I'll give you a quick "
      + "overview of how I'd like to structure this. We'll spend some time talking about your background, and "
      + 'one of your projects you worked on, then we will do a coding problem. ';
    const middle = 'Take me through what happens from the moment the audio comes into the application until the '
      + 'user gets an answer from the LLM. You mentioned Electron and React, but you also have a Rust involved. Why Rust? ';
    const newestFinal = 'Have you run into any concurrency or lifecycle problem because of that?';
    const liveQuestion = ' Okay. And how do you manage communication between these pieces?';
    const blob = opener + middle + newestFinal + liveQuestion;
    const r = resolve(blob, {
      finals: [...finals('Why Rust?'), { role: 'interviewer', text: newestFinal, timestamp: NOW - 2_000 }],
    });
    assert.equal(r.action, 'inject');
    assert.equal(r.reason, 'novel_tail');
    assert.match(r.text, /communication between these pieces\?/);
    assert.doesNotMatch(r.text, /Good to meet you/);
    assert.doesNotMatch(r.text, /Why Rust/);
    assert.ok(r.text.length < 120, `tail should be just the live question, got ${r.text.length} chars`);
  });

  test('an interim entirely covered by finals is skipped (no novel content)', () => {
    const priorFinals = finals('And what part of the system did you personally build?');
    const r = resolve('And what part of the system did you personally build?  ', { finals: priorFinals });
    assert.equal(r.action, 'skip');
    assert.ok(['duplicate', 'no_novel_content'].includes(r.reason), r.reason);
  });

  test('a repeated sentence inside the blob anchors on its LAST occurrence', () => {
    const repeated = 'Take me through what happens from the moment the audio comes into the application.';
    const blob = `${repeated} Okay. ${repeated} And where does the answer get rendered?`;
    const r = resolve(blob, { finals: finals(repeated) });
    assert.equal(r.action, 'inject');
    assert.match(r.text, /where does the answer get rendered\?/);
    assert.doesNotMatch(r.text, /moment the audio/);
  });
});

describe('RC-1: guards that must not over-fire', () => {
  test('a fresh short interim with no overlap injects in full', () => {
    const r = resolve('What metrics would you want before changing anything?', {
      finals: finals('Why would you assume that is a memory leak?'),
    });
    assert.equal(r.action, 'inject');
    assert.equal(r.reason, 'fresh');
    assert.equal(r.text, 'What metrics would you want before changing anything?');
  });

  test('a one-word final ("Okay.") is too weak an anchor to chop a fresh interim', () => {
    const r = resolve('Okay so suppose the database grows to 500 million rows, what do you do?', {
      finals: finals('Okay.'),
    });
    assert.equal(r.action, 'inject');
    assert.equal(r.reason, 'fresh');
    assert.match(r.text, /^Okay so suppose/);
  });

  test('empty interim skips', () => {
    const r = resolve('   ');
    assert.equal(r.action, 'skip');
    assert.equal(r.reason, 'empty');
  });

  test('a stale interim (older than the staleness window) skips', () => {
    const r = resolve('What about consistency guarantees?', { timestamp: NOW - INTERIM_STALE_MS - 5_000 });
    assert.equal(r.action, 'skip');
    assert.equal(r.reason, 'stale');
  });

  test('legacy duplicate guard preserved: exact text match with last context item skips', () => {
    const item = { role: 'interviewer', text: 'Why Rust?', timestamp: NOW - 400 };
    const r = resolve('Why Rust?', { finals: [item], lastContextItem: item });
    assert.equal(r.action, 'skip');
    assert.equal(r.reason, 'duplicate');
  });

  test('legacy duplicate guard preserved: timestamp within 1s of last interviewer item skips', () => {
    const item = { role: 'interviewer', text: 'Why Rust exactly?', timestamp: NOW - 700 };
    const r = resolve('Why Rust', { timestamp: NOW - 300, finals: [item], lastContextItem: item });
    assert.equal(r.action, 'skip');
    assert.equal(r.reason, 'duplicate');
  });
});

describe('RC-1: length-cap backstop when no anchor matches', () => {
  test('an oversized interim with no matching final is capped to a word-boundary tail', () => {
    const filler = Array.from({ length: 400 }, (_, i) => `segment${i} of a very long unmatched monologue`).join(' ');
    const blob = `${filler} so if the state is in the memory and we lost it, what would you do about that?`;
    const r = resolve(blob, { finals: finals('Totally different final that never appears in the interim.') });
    assert.equal(r.action, 'inject');
    assert.equal(r.reason, 'length_capped_tail');
    assert.ok(r.text.length <= MAX_INTERIM_INJECTION_CHARS, `${r.text.length} > ${MAX_INTERIM_INJECTION_CHARS}`);
    assert.match(r.text, /what would you do about that\?$/);
    assert.doesNotMatch(r.text, /^\S*segment\d+ of a very/, 'cap must cut at a word boundary, not mid-word');
  });

  test('a novel tail that is itself oversized is also capped', () => {
    const anchor = 'Walk me through the RedisMart architecture end to end.';
    const hugeTail = Array.from({ length: 300 }, (_, i) => `detail${i} about the request path`).join(' ')
      + ' so which part would you keep relational?';
    const r = resolve(`${anchor} ${hugeTail}`, { finals: finals(anchor) });
    assert.equal(r.action, 'inject');
    assert.ok(r.text.length <= MAX_INTERIM_INJECTION_CHARS);
    assert.match(r.text, /keep relational\?$/);
  });
});
