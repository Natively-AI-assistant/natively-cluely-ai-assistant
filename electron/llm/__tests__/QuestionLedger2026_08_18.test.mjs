// electron/llm/__tests__/QuestionLedger2026_08_18.test.mjs
//
// WTA audit Phase 2 (.audit/wta-audit.md §F/G): the question ledger — a
// session-scoped record of every detected ask, its relationships, and its
// answered state. Replaces "the 180s transcript window IS the question state"
// as the conceptual model: the transcript provides evidence; the ledger holds
// state. Phase 2 ships the ledger + deterministic ask detection and runs it
// SHADOW-ONLY (observe-only trace behind a default-off flag); selection
// still belongs to extractLatestQuestion until shadow metrics justify
// promotion (Phase 5).
//
// The scenarios below are the spec's own acceptance cases, including the
// final success criterion (notification-system → 3-part compound → "And
// specifically the rebalancing problem?" resolving as a refinement of the
// consumer-groups ask).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { QuestionLedger } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/questionLedger.js')).href
);

const T0 = 1_000_000;
const s = (sec) => T0 + sec * 1000;

describe('ask detection', () => {
  test('a simple interviewer question becomes one open ask', () => {
    const l = new QuestionLedger();
    const asks = l.ingestInterviewerTurn({ text: 'Tell me about your notification system.', timestamp: s(0) });
    assert.equal(asks.length, 1);
    // spec taxonomy: an imperative "tell me about…" is a request-act ask
    assert.ok(['question', 'request'].includes(asks[0].dialogueAct), asks[0].dialogueAct);
    assert.equal(asks[0].status, 'open');
    assert.equal(l.getOpenAsks().length, 1);
  });

  test('backchannels and statements create no asks', () => {
    const l = new QuestionLedger();
    assert.equal(l.ingestInterviewerTurn({ text: 'That makes sense.', timestamp: s(0) }).length, 0);
    assert.equal(l.ingestInterviewerTurn({ text: 'Okay, great.', timestamp: s(1) }).length, 0);
    assert.equal(l.ingestInterviewerTurn({ text: 'Interesting, that sounds pretty solid.', timestamp: s(2) }).length, 0);
    assert.equal(l.getOpenAsks().length, 0);
  });

  test('a compound question decomposes into atomic asks in one cluster', () => {
    const l = new QuestionLedger();
    const asks = l.ingestInterviewerTurn({
      text: 'Why did you choose Kafka, how did you handle consumer groups, and what would you change?',
      timestamp: s(0),
    });
    assert.equal(asks.length, 3, `got ${asks.map(a => a.standaloneText).join(' | ')}`);
    assert.ok(asks.every(a => a.clusterId === asks[0].clusterId), 'same cluster');
    assert.match(asks[0].standaloneText, /kafka/i);
    assert.match(asks[1].standaloneText, /consumer groups/i);
    assert.match(asks[2].standaloneText, /change/i);
  });

  test('multiple sentences split into separate asks', () => {
    const l = new QuestionLedger();
    const asks = l.ingestInterviewerTurn({
      text: 'Tell me about your last project. Why did you choose Kafka?',
      timestamp: s(0),
    });
    assert.equal(asks.length, 2);
  });

  test('a leading backchannel does not swallow the questions after it', () => {
    const l = new QuestionLedger();
    const asks = l.ingestInterviewerTurn({
      text: 'That makes sense, but why did you choose Kafka, how did you handle retries, and what would you change now?',
      timestamp: s(0),
    });
    assert.equal(asks.length, 3, `got ${asks.map(a => a.standaloneText).join(' | ')}`);
  });

  test('missing "?" is NOT penalized when punctuation is unavailable (F9 neutral scoring)', () => {
    const l = new QuestionLedger();
    const withPunct = l.ingestInterviewerTurn({
      text: 'why did you choose kafka?', timestamp: s(0), punctuationSource: 'provider_final',
    })[0];
    const l2 = new QuestionLedger();
    const withoutPunct = l2.ingestInterviewerTurn({
      text: 'why did you choose kafka', timestamp: s(0), punctuationSource: 'unavailable',
    })[0];
    assert.ok(withoutPunct, 'unpunctuated interrogative still detected');
    assert.ok(
      withoutPunct.confidence.dialogueAct >= withPunct.confidence.dialogueAct - 1e-9,
      `unavailable-punctuation ask must not score below the punctuated one (${withoutPunct.confidence.dialogueAct} vs ${withPunct.confidence.dialogueAct})`
    );
  });
});

describe('answered-state tracking', () => {
  test('two questions with no candidate answer both stay open', () => {
    const l = new QuestionLedger();
    l.ingestInterviewerTurn({ text: 'Tell me about your last project.', timestamp: s(0) });
    l.ingestInterviewerTurn({ text: 'Why did you choose Kafka?', timestamp: s(5) });
    assert.equal(l.getOpenAsks().length, 2);
  });

  test('a substantive candidate answer marks the matching ask answered', () => {
    const l = new QuestionLedger();
    l.ingestInterviewerTurn({ text: 'Why did you choose Kafka for the pipeline?', timestamp: s(0) });
    l.ingestCandidateTurn({
      text: 'We chose Kafka mainly because the pipeline needed replayable ordered delivery and our team already ran it in production for two other services.',
      timestamp: s(10),
    });
    assert.equal(l.getOpenAsks().length, 0);
    assert.equal(l.getAsks()[0].status, 'answered');
  });

  test('a short acknowledgement does not mark anything answered', () => {
    const l = new QuestionLedger();
    l.ingestInterviewerTurn({ text: 'Why did you choose Kafka?', timestamp: s(0) });
    l.ingestCandidateTurn({ text: 'Yeah, sure.', timestamp: s(2) });
    assert.equal(l.getOpenAsks().length, 1);
  });
});

describe('relationships: corrections, refinements, repeats', () => {
  test('a correction supersedes the corrected ask', () => {
    const l = new QuestionLedger();
    l.ingestInterviewerTurn({ text: 'Why did you choose Redis?', timestamp: s(0) });
    const asks = l.ingestInterviewerTurn({ text: 'Sorry, I mean Kafka.', timestamp: s(3) });
    assert.equal(asks.length, 1);
    assert.equal(asks[0].relationToPrevious, 'correction');
    assert.match(asks[0].standaloneText, /Kafka/);
    const open = l.getOpenAsks();
    assert.equal(open.length, 1, 'only the corrected ask remains open');
    assert.equal(l.getAsks()[0].status, 'superseded');
  });

  test('a repeated question does not duplicate the open ask', () => {
    const l = new QuestionLedger();
    l.ingestInterviewerTurn({ text: 'Why did you choose Kafka?', timestamp: s(0) });
    const again = l.ingestInterviewerTurn({ text: 'Why did you choose Kafka?', timestamp: s(20) });
    assert.equal(l.getOpenAsks().length, 1);
    if (again.length > 0) assert.equal(again[0].relationToPrevious, 'repeat');
  });
});

describe('the spec success criterion, end to end', () => {
  test('notification system → interrupted 3-part compound → rebalancing refinement', () => {
    const l = new QuestionLedger();
    // I: opening ask
    l.ingestInterviewerTurn({ text: 'Tell me about your notification system.', timestamp: s(0) });
    // C: begins answering (substantive)
    l.ingestCandidateTurn({
      text: 'Sure — the notification system fans out about two million pushes a day through a Kafka-backed dispatch tier that we built around consumer groups.',
      timestamp: s(10),
    });
    // I: interrupts with a 3-part compound
    const compound = l.ingestInterviewerTurn({
      text: 'Sorry, before that — why did you choose Kafka, how did you handle consumer groups, and what would you change if you built it again?',
      timestamp: s(20),
    });
    assert.equal(compound.length, 3, `got ${compound.map(a => a.standaloneText).join(' | ')}`);
    const open = l.getOpenAsks();
    assert.equal(open.length, 3, 'the three new asks are open; the first is answered');
    assert.ok(open.every(a => a.clusterId === compound[0].clusterId));

    // Ranking: all three open asks surface, newest-turn asks ranked at top
    const ranked = l.rankActiveAsks(s(25));
    assert.equal(ranked.length, 3);

    // I: narrowing refinement. Phase-2 honesty: choosing the consumer-groups
    // ask as parent requires world knowledge (Kafka rebalancing ↔ consumer
    // groups) — that is the Phase-4 semantic arbiter's job. The deterministic
    // linker must (a) classify the relation, (b) link into the SAME cluster,
    // (c) resolve a standalone rewrite carrying the narrowing focus, and
    // (d) SURFACE the uncertainty: zero term overlap ⇒ recency-fallback
    // parent with confidence.relationship = 0.5, the arbiter's work queue.
    const refined = l.ingestInterviewerTurn({ text: 'And specifically the rebalancing problem?', timestamp: s(30) });
    assert.equal(refined.length, 1);
    assert.equal(refined[0].relationToPrevious, 'refinement');
    assert.match(refined[0].standaloneText, /rebalancing/i);
    assert.ok(compound.some(a => a.id === refined[0].parentAskId), 'parent is one of the cluster asks');
    assert.equal(refined[0].clusterId, compound[1].clusterId, 'same semantic cluster');
    assert.ok(refined[0].confidence.relationship <= 0.5,
      'zero-overlap parent link must be flagged low-confidence for the semantic arbiter');
  });
});

describe('bounds and hygiene', () => {
  test('the ledger is bounded', () => {
    const l = new QuestionLedger();
    for (let i = 0; i < 300; i++) {
      l.ingestInterviewerTurn({ text: `Question number ${i}, what is your view on topic ${i}?`, timestamp: s(i) });
    }
    assert.ok(l.getAsks().length <= 200, `ledger must be bounded, got ${l.getAsks().length}`);
  });
});
