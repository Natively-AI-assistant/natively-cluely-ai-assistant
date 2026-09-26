// Context Intelligence V3 — question resolution (§12.1/§12.2).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { resolveQuestion, cleanUtterance, looksLikeQuestion } = await import(pathToFileURL(path.resolve(
  process.cwd(), 'dist-electron/electron/context-intelligence/question/question-resolver.js')).href);

const turn = (role, text, timestamp = 1000) => ({ role, text, timestamp });

describe('priority — manual input wins outright', () => {
  test('manual beats a transcript question', () => {
    const r = resolveQuestion({
      manualQuestion: 'What is a mutex?',
      transcript: [turn('interviewer', 'Tell me about your WebRTC project?')],
    });
    assert.equal(r.resolvedQuestion, 'What is a mutex?');
    assert.equal(r.source, 'manual');
    assert.equal(r.confidence, 1);
  });

  test('manual text is NOT cleaned — the user typed what they meant', () => {
    const r = resolveQuestion({ manualQuestion: 'Basically, what is a mutex, you know?' });
    assert.equal(r.resolvedQuestion, 'Basically, what is a mutex, you know?',
      'filler removal on deliberate text is corruption, not cleanup');
  });

  test('a selection beats the transcript but is cleaned', () => {
    const r = resolveQuestion({
      selectedText: 'um so why did you choose WebRTC?',
      transcript: [turn('interviewer', 'What is your name?')],
    });
    assert.equal(r.source, 'selection');
    assert.match(r.resolvedQuestion, /why did you choose WebRTC\?/);
    assert.ok(!/um/.test(r.resolvedQuestion));
  });
});

describe('STT noise', () => {
  test('collapses repeated fragments', () => {
    assert.equal(cleanUtterance('why did you why did you choose webrtc'), 'why did you choose webrtc');
    assert.equal(cleanUtterance('the the the ledger'), 'the ledger');
  });

  test('strips filler without mangling the question', () => {
    assert.equal(cleanUtterance('so um, like, why did you actually choose WebRTC?'), 'so, why did you choose WebRTC?');
  });

  test('recognises questions with and without a question mark', () => {
    assert.ok(looksLikeQuestion('Tell me about your project'));
    assert.ok(looksLikeQuestion('is that scalable?'));
    assert.ok(!looksLikeQuestion('The system uses Postgres.'));
  });
});

describe('the assistant can never become the question', () => {
  test('an assistant turn is ignored even when it is the most recent', () => {
    const r = resolveQuestion({
      transcript: [
        turn('interviewer', 'Why did you choose WebRTC?', 1000),
        turn('assistant', 'What would you like me to explain about WebRTC?', 2000),
      ],
      now: 2000,
    });
    assert.equal(r.resolvedQuestion, 'Why did you choose WebRTC?',
      'the model\'s own output re-entering as the question is how a fabrication self-reinforces');
  });

  test('a user turn is not treated as the interviewer\'s question', () => {
    const r = resolveQuestion({
      transcript: [turn('user', 'What should I say here?', 1000)], now: 1000,
    });
    assert.equal(r.source, 'none');
  });
});

describe('abandoned and unstable utterances', () => {
  test('skips a trailed-off fragment and takes the last real question', () => {
    const r = resolveQuestion({
      transcript: [
        turn('interviewer', 'Why did you choose WebRTC?', 1000),
        turn('interviewer', 'and what about the—', 2000),
      ],
      now: 2000,
    });
    assert.equal(r.resolvedQuestion, 'Why did you choose WebRTC?');
  });

  test('a non-question statement does not become the question', () => {
    const r = resolveQuestion({
      transcript: [turn('interviewer', 'Great, thanks for that.', 1000)], now: 1000,
    });
    assert.equal(r.source, 'none');
    assert.equal(r.requiresClarification, true);
  });
});

describe('window', () => {
  test('a stale question outside the window is not resurrected', () => {
    const r = resolveQuestion({
      transcript: [turn('interviewer', 'Why did you choose WebRTC?', 1000)],
      now: 500_000, windowMs: 60_000,
    });
    assert.equal(r.source, 'none');
    assert.match(r.clarificationReason, /current window/);
  });

  test('the most recent in-window question wins', () => {
    const r = resolveQuestion({
      transcript: [
        turn('interviewer', 'What is your name?', 1000),
        turn('interviewer', 'Why did you choose WebRTC?', 2000),
      ],
      now: 2000,
    });
    assert.equal(r.resolvedQuestion, 'Why did you choose WebRTC?');
  });
});

describe('follow-ups are flagged, not silently answered', () => {
  test('a bare "why?" is a follow-up needing a referent', () => {
    const r = resolveQuestion({ transcript: [turn('interviewer', 'Why?', 1000)], now: 1000 });
    assert.equal(r.isFollowUp, true);
    assert.equal(r.source, 'follow-up');
    assert.ok(r.confidence < 0.8, 'a subject-less question cannot be high confidence');
    assert.equal(r.requiresClarification, true);
  });

  test('a self-contained question is not a follow-up', () => {
    const r = resolveQuestion({ transcript: [turn('interviewer', 'Why did you choose WebRTC?', 1000)], now: 1000 });
    assert.equal(r.isFollowUp, false);
    assert.equal(r.source, 'transcript');
  });
});

describe('entities', () => {
  test('surfaces proper nouns for downstream reference resolution', () => {
    const r = resolveQuestion({ manualQuestion: 'Why did you choose WebRTC over Cassandra?' });
    assert.ok(r.activeEntities.includes('WebRTC'));
    assert.ok(r.activeEntities.includes('Cassandra'));
  });
});

describe('empty input', () => {
  test('resolves to none and asks for clarification', () => {
    const r = resolveQuestion({});
    assert.equal(r.source, 'none');
    assert.equal(r.requiresClarification, true);
  });
});
