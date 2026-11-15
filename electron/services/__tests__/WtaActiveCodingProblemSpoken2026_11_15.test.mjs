// electron/services/__tests__/WtaActiveCodingProblemSpoken2026_11_15.test.mjs
//
// Follow-ups to #539 (issues #737, #738, #739). The 2026-09-23 fix keeps the
// active coding problem for "show the solution in python", but:
//   #737  a problem stated in plain speech was never stored (the detector wanted
//         keywords: "Implement a function…"), so the follow-up routed non-coding;
//   #738  an older, detected warm-up stayed "active" after "let us move on to the
//         main problem", and the follow-up was rewritten onto the warm-up;
//   #739  the stored problem absorbed every interviewer line of the next five
//         minutes, so "Have you used … before?" made the follow-up an experience
//         answer.
//
// Real SessionTracker + real IntelligenceEngine.runWhatShouldISay; only the
// provider call is stubbed, capturing the prompt that would leave the process.
// Timestamps are recent (inside the 5-minute statement window) on purpose: the
// 2026-09-23 fixture used 320-330 s old lines, which hid #739.

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
  process.env.NATIVELY_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'wta-active-coding-spoken-'));
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

// [secondsAgo, speaker, text]
function feed(segments) {
  const now = Date.now();
  const session = new SessionTracker();
  for (const [agoSec, speaker, text] of segments) {
    session.handleTranscript({ speaker, text, timestamp: now - agoSec * 1000, final: true });
  }
  return session;
}

async function press(segments) {
  const session = feed(segments);
  const captured = [];
  const engine = new IntelligenceEngine(makeHelper(captured), session);
  await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });
  return { session, prompt: captured.join('\n') };
}

const questionLine = (prompt) => (prompt.match(/# Question\n([^\n]*)/) || [])[1] || '';
const interviewer = (startAgo, lines, step = 9) => lines.map((t, i) => [startAgo - i * step, 'interviewer', t]);

const ISSUE_BULLETS = [
  'Service A encrypts and Service B decrypts.',
  'Rotate the active key at the top of every hour.',
  'Retain at least five key versions so in-flight/older messages remain decryptable.',
];
const KEYWORD_PROBLEM = 'Implement a function to rotate the active encryption key at the top of every hour, and return the key version used.';
const STAIRS = 'Let us start with a quick warm-up. Given an integer n, write a function that returns the number of distinct ways to climb a staircase taking one or two steps at a time.';

describe('#737 a coding problem stated in plain speech is stored', () => {
  const wordings = {
    issue_steps_to_reproduce: ISSUE_BULLETS,
    spoken_build_that: [
      'Okay so for this next part we have two microservices. Service A encrypts messages and service B decrypts them.',
      'The active encryption key should rotate at the top of every hour.',
      'And we need to keep at least five old key versions so that messages that are still in flight can still be decrypted.',
      'So how would you go about building that?',
    ],
    design_service: ['Design a service that encrypts messages with a key that rotates every hour and keeps the last five keys around for decryption.'],
    walk_me_through: ["Let's say service A encrypts and service B decrypts.", 'Keys rotate every hour and we keep five old versions.', "Walk me through how you'd build it."],
    lru_ask: ['Implement an LRU cache with get and put.'],
    lru_ask_plus_constraint: ['Implement an LRU cache with get and put.', 'You can assume capacity is positive.'],
    shipped_test_wording: [KEYWORD_PROBLEM],
  };
  for (const [name, lines] of Object.entries(wordings)) {
    test(`${name} is stored as the active problem`, () => {
      const s = feed(interviewer(60, lines));
      const stored = s.getDetectedCodingQuestion().question;
      assert.ok(stored, `${name}: nothing stored`);
      assert.ok(stored.includes(lines[0]), `${name}: the statement's first line is missing: ${stored}`);
    });
  }

  // 6f82d9ff kept the 2-group threshold because #591's version fired on this.
  for (const line of [
    'Do you write Python at work?',
    'Have you used the cryptography library in Python before?',
    'How long have you been using Python?',
    'Tell me about a time you had to design a service under pressure.',
    'How was your weekend, did you do anything fun?',
    'Sounds good, keep going.',
    'Have you built a service that encrypts data at rest before?',
  ]) {
    test(`"${line}" is not a coding problem`, () => {
      const s = feed([[30, 'interviewer', line]]);
      assert.equal(s.getDetectedCodingQuestion().question, null);
    });
  }

  test('"show the solution in python" after the issue wording goes out as a coding answer about that problem', async () => {
    const { prompt } = await press([
      ...interviewer(120, ISSUE_BULLETS),
      [80, 'user', 'Okay, let me think about how the key versions are tracked.'],
      [3, 'interviewer', 'show the solution in python'],
    ]);
    assert.ok(prompt, 'the provider was called');
    assert.match(prompt, /<coding_contract>/, 'no coding contract');
    const q = questionLine(prompt);
    assert.match(q, /^show the solution in python \(follow-up to the coding problem: "Service A encrypts/, q);
    assert.match(q, /Retain at least five key versions/);
  });
});

describe('#739 the stored problem is the statement, not every interviewer line after it', () => {
  const timeline = (probe) => [
    [220, 'interviewer', KEYWORD_PROBLEM],
    [180, 'user', 'Okay, I would keep a map from key version to key and stamp each message with its version.'],
    [120, 'interviewer', probe],
    [90, 'user', 'Yes, I used it on a payments project for envelope encryption.'],
    [3, 'interviewer', 'show the solution in python'],
  ];

  for (const probe of ['Have you used the cryptography library in Python before?', 'Have you used Kafka before?', 'How long have you been using Python?', 'Tell me about yourself.']) {
    test(`"${probe}" is not absorbed, and the follow-up stays a coding answer`, async () => {
      const { session, prompt } = await press(timeline(probe));
      assert.equal(session.getDetectedCodingQuestion().question, KEYWORD_PROBLEM);
      assert.match(prompt, /<coding_contract>/, 'no coding contract');
      const q = questionLine(prompt);
      assert.match(q, /follow-up to the coding problem: "Implement a function to rotate/, q);
      assert.ok(!q.includes(probe), `the probe was quoted as part of the problem: ${q}`);
    });
  }

  test('the follow-up itself is not absorbed into the problem', () => {
    const s = feed([[30, 'interviewer', KEYWORD_PROBLEM], [10, 'interviewer', 'show the solution in python']]);
    assert.equal(s.getDetectedCodingQuestion().question, KEYWORD_PROBLEM);
  });

  test('a later constraint in the same statement still extends the problem', () => {
    const s = feed([[30, 'interviewer', 'Implement an LRU cache with get and put.'], [24, 'interviewer', 'Both operations should run in constant time.']]);
    assert.equal(s.getDetectedCodingQuestion().question, 'Implement an LRU cache with get and put. Both operations should run in constant time.');
  });

  test('a problem completed by its ask is still detected', () => {
    const s = feed([[30, 'interviewer', 'Given an array of integers nums.'], [24, 'interviewer', 'Can you solve it in O(n)?']]);
    assert.match(s.getDetectedCodingQuestion().question ?? '', /Given an array of integers nums\. Can you solve it in O\(n\)\?/);
  });
});

describe('#738 a newer problem replaces the warm-up', () => {
  const warmUp = [
    [290, 'interviewer', STAIRS],
    [270, 'user', 'Sure, that is the Fibonacci recurrence, ways of n equals ways of n minus one plus ways of n minus two.'],
    [250, 'interviewer', 'Great, that works.'],
    [240, 'user', 'And the base case is one way for zero or one steps.'],
  ];

  test('the issue wording after "let us move on to the main problem" is the problem the follow-up names', async () => {
    const { session, prompt } = await press([
      ...warmUp,
      ...interviewer(200, ['Great, let us move on to the main problem.', ...ISSUE_BULLETS]),
      [140, 'user', 'Okay, so each message needs to carry the key version it was encrypted with.'],
      [100, 'interviewer', 'Right. And how is your week going so far?'],
      [80, 'user', 'Pretty good, busy but good, thanks for asking.'],
      [3, 'interviewer', 'show the solution in python'],
    ]);
    const stored = session.getDetectedCodingQuestion().question ?? '';
    assert.match(stored, /Service A encrypts/);
    assert.doesNotMatch(stored, /staircase/);
    const q = questionLine(prompt);
    assert.match(q, /follow-up to the coding problem: "[^"]*Service A encrypts/, q);
    assert.doesNotMatch(q, /staircase/);
  });

  test('moving on clears the warm-up even when the new problem is not recognised', async () => {
    const { session, prompt } = await press([
      ...warmUp,
      [200, 'interviewer', "Okay, let's move on to the next problem."],
      [190, 'interviewer', 'Think about how messages in a group chat get their order.'],
      [140, 'user', 'Okay, so I would give every message a sequence number per group.'],
      [3, 'interviewer', 'show the solution in python'],
    ]);
    assert.equal(session.getDetectedCodingQuestion().question, null);
    assert.doesNotMatch(prompt, /follow-up to the coding problem/);
    assert.doesNotMatch(questionLine(prompt), /staircase/);
  });

  test('"the main problem with that approach" is a critique and keeps the problem', async () => {
    const { session, prompt } = await press([
      [60, 'interviewer', KEYWORD_PROBLEM],
      [40, 'user', 'I would just regenerate the key on every message.'],
      [20, 'interviewer', 'The main problem with that approach is that service B cannot decrypt older messages.'],
      [10, 'user', 'Right, so I need to keep the old key versions around.'],
      [3, 'interviewer', 'show the solution in python'],
    ]);
    assert.equal(session.getDetectedCodingQuestion().question, KEYWORD_PROBLEM);
    assert.match(questionLine(prompt), /follow-up to the coding problem: "Implement a function to rotate/);
  });

  // The residual case: a newer problem the detector does not recognise, and no
  // "let's move on". The app does not guess which problem is current: the
  // follow-up quotes what the interviewer said after the stored problem, and tells
  // the model to answer that if it is a different problem.
  for (const [name, lines] of [
    ['with some coding words', ['Next up, think about a chat service.', 'Messages need to arrive in the order they were sent.']],
    ['with no coding words at all', ['Okay, next picture two people typing into one shared document at once.', 'Both of their changes should survive.']],
  ]) {
    test(`a newer, unrecognised problem ${name} and no move-on cue reaches the model as the newer one`, async () => {
      const { prompt } = await press([
        ...warmUp,
        ...interviewer(200, lines),
        [150, 'user', 'Okay, so I would give every change a position and a counter.'],
        [3, 'interviewer', 'show the solution in python'],
      ]);
      assert.match(prompt, /<coding_contract>/, 'no coding contract');
      const q = questionLine(prompt);
      const said = q.match(/; the interviewer said after it: "([^"]*)" — if that states a different problem, this is about that one\)$/);
      assert.ok(said, `the newer statement is not quoted after the stored problem: ${q}`);
      assert.equal(said[1], lines.join(' '));
    });
  }

  test('with nothing said after the problem, the follow-up names only the problem', async () => {
    const { prompt } = await press([
      [60, 'interviewer', KEYWORD_PROBLEM],
      [40, 'user', 'Okay, I would keep a map from version to key.'],
      [3, 'interviewer', 'show the solution in python'],
    ]);
    assert.equal(questionLine(prompt), `show the solution in python (follow-up to the coding problem: "${KEYWORD_PROBLEM}")`);
  });

  test('more talk about the same problem keeps it', async () => {
    const { prompt } = await press([
      [120, 'interviewer', 'Implement an LRU cache with get and put.'],
      [100, 'user', 'I would use a hash map plus a doubly linked list.'],
      [80, 'interviewer', 'The cache must evict the least recently used entry once it is full.'],
      [60, 'user', 'Right, the tail of the list is the eviction candidate.'],
      [3, 'interviewer', 'show the solution in python'],
    ]);
    assert.match(questionLine(prompt), /follow-up to the coding problem: "Implement an LRU cache with get and put\."/);
  });

  test('what is said after a screenshot problem is quoted, and the screenshot stays the problem', () => {
    const s = feed([]);
    s.setCodingQuestion('Given an array of integers, return the indices of the two numbers that add up to target.', 'screenshot');
    s.handleTranscript({ speaker: 'interviewer', text: 'Next up, think about a chat service.', timestamp: Date.now(), final: true });
    const active = s.getActiveCodingProblem(30 * 60 * 1000);
    assert.equal(active.source, 'screenshot');
    assert.deepEqual(active.saidAfter, ['Next up, think about a chat service.']);
  });

  test('questions about the candidate and asks are not quoted as said after', () => {
    const s = feed([
      [90, 'interviewer', KEYWORD_PROBLEM],
      [70, 'user', 'Sure, let me think about the storage first.'],
      [50, 'interviewer', 'Have you used Kafka before?'],
      [30, 'user', 'Yes, at my last job for event sourcing.'],
      [10, 'interviewer', 'show it in python'],
    ]);
    assert.deepEqual(s.getActiveCodingProblem(30 * 60 * 1000).saidAfter, []);
  });
});
