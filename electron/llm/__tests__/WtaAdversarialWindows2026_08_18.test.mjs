// electron/llm/__tests__/WtaAdversarialWindows2026_08_18.test.mjs
//
// WTA audit Part 2 — adversarial transcript windows, run against BOTH
// question systems side by side:
//   • extractLatestQuestion — the LIVE selector. These tests PIN its actual
//     contract (latest eligible interviewer turn wins; earlier unanswered
//     questions are invisible to it) so any behavioral change is loud.
//   • QuestionLedger — the shadow state model. The same windows must yield
//     correct multi-ask state (open/answered tracking, bounds).
//   • prepareTranscriptForWhatToAnswer — the 12-turn prompt window. These
//     tests DOCUMENT the sparsification loss: with enough interviewer turns,
//     earlier still-unanswered questions leave the prompt entirely.
//
// This file is the executable form of .audit/wta-audit.md §B — if any of
// these pins break, the audit document is stale and must be updated.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/', p)).href;
const { extractLatestQuestion } = await import(dist('transcriptQuestionExtractor.js'));
const { prepareTranscriptForWhatToAnswer } = await import(dist('transcriptCleaner.js'));
const { QuestionLedger } = await import(dist('questionLedger.js'));

const T0 = 1_000_000;
let seq = 0;
const turn = (role, text) => ({ role, text, timestamp: T0 + (++seq) * 1000 });
const questionsAsked = (n) =>
  Array.from({ length: n }, (_, i) => turn('interviewer', `Question ${i + 1}: how would you design feature number ${i + 1}?`));

function feedLedger(turns) {
  const l = new QuestionLedger();
  for (const t of turns) {
    if (t.role === 'interviewer') l.ingestInterviewerTurn({ text: t.text, timestamp: t.timestamp });
    else l.ingestCandidateTurn({ text: t.text, timestamp: t.timestamp });
  }
  return l;
}

describe('N unanswered questions in one window', () => {
  for (const n of [2, 5, 10]) {
    test(`${n} questions, no answers: extractor sees ONLY the latest; ledger holds all ${n} open`, () => {
      seq = 0;
      const turns = questionsAsked(n);
      const ex = extractLatestQuestion(turns);
      assert.match(ex.latestQuestion, new RegExp(`Question ${n}:`), 'PIN: latest-wins');
      const l = feedLedger(turns);
      assert.equal(l.getOpenAsks().length, n, 'the ledger is what remembers the earlier asks');
    });
  }

  test('15 questions: ledger bounds to 12 open (oldest 3 abandoned) — the documented cap', () => {
    seq = 0;
    const l = feedLedger(questionsAsked(15));
    assert.equal(l.getOpenAsks().length, 12);
    assert.equal(l.getAsks().filter(a => a.status === 'abandoned').length, 3);
  });
});

describe('sparsification loss (documents .audit/wta-audit.md §B)', () => {
  test('interviewer-heavy window: an early unanswered question LEAVES the 12-turn prompt', () => {
    seq = 0;
    const turns = [
      turn('interviewer', 'First things first: what salary range are you expecting for this role?'),
      ...questionsAsked(14),
    ];
    const prompt = prepareTranscriptForWhatToAnswer(turns, 12);
    assert.ok(!/salary range/.test(prompt),
      'DOCUMENTED LOSS: the earliest unanswered question is sparsified out of the prompt');
    const l = feedLedger(turns);
    assert.ok(
      l.getAsks().some(a => /salary range/.test(a.standaloneText)),
      'the ledger retains it (possibly abandoned by the open-cap, but never silently forgotten)');
  });
});

describe('question → answer → question', () => {
  test('extractor picks Q2; ledger marks Q1 answered and Q2 open', () => {
    seq = 0;
    const turns = [
      turn('interviewer', 'Why did you choose Kafka for the pipeline?'),
      turn('user', 'We chose Kafka because the pipeline needed replayable ordered delivery and the team already operated Kafka in production for other services.'),
      turn('interviewer', 'How did you monitor consumer lag in production?'),
    ];
    const ex = extractLatestQuestion(turns);
    assert.match(ex.latestQuestion, /consumer lag/);
    const l = feedLedger(turns);
    const asks = l.getAsks();
    assert.equal(asks.find(a => /kafka/i.test(a.standaloneText) && /pipeline/i.test(a.standaloneText))?.status, 'answered');
    assert.equal(l.getOpenAsks().length, 1);
    assert.match(l.getOpenAsks()[0].standaloneText, /consumer lag/);
  });
});

describe('question → question before any answer', () => {
  test('extractor sees only the second; ledger keeps both open, ranked with recency as a feature', () => {
    seq = 0;
    const turns = [
      turn('interviewer', 'Tell me about your notification system.'),
      turn('interviewer', 'Why did you choose Kafka?'),
    ];
    const ex = extractLatestQuestion(turns);
    assert.match(ex.latestQuestion, /Kafka/, 'PIN: latest-wins hides the earlier open ask');
    const l = feedLedger(turns);
    const ranked = l.rankActiveAsks(turns[1].timestamp + 1000);
    assert.equal(ranked.length, 2);
    assert.match(ranked[0].standaloneText, /Kafka/, 'newest ranks first');
    assert.match(ranked[1].standaloneText, /notification/i, 'earlier ask is still active, not gone');
  });
});

describe('interruption mid-answer', () => {
  test('candidate interrupted: first ask not marked answered by a truncated reply', () => {
    seq = 0;
    const turns = [
      turn('interviewer', 'Walk me through the architecture of your billing service.'),
      turn('user', 'Sure, so at a high level'),
      turn('interviewer', 'Actually, hold on — what database does it use?'),
    ];
    const ex = extractLatestQuestion(turns);
    assert.match(ex.latestQuestion, /database/);
    const l = feedLedger(turns);
    const billing = l.getAsks().find(a => /billing/i.test(a.standaloneText));
    assert.ok(billing && billing.status !== 'answered',
      'a 5-word interrupted reply must not count as a full answer');
    // 2026-08-18 refinement: an interrupted lead-in marks the ask
    // partially_answered (honest state) — still active/rankable, but a fresh
    // ask outranks it.
    assert.ok(['open', 'partially_answered'].includes(billing.status), billing.status);
    const active = l.rankActiveAsks(turns[2].timestamp + 1000);
    assert.equal(active.length, 2, 'both the interrupted ask and the new one stay active');
    assert.match(active[0].standaloneText, /database/i, 'the fresh ask ranks first');
  });
});

describe('candidate-heavy window', () => {
  test('long candidate monologue does not displace the interviewer question for the extractor', () => {
    seq = 0;
    const turns = [
      turn('interviewer', 'What was the hardest bug you fixed last year?'),
      ...Array.from({ length: 10 }, (_, i) =>
        turn('user', `Part ${i + 1} of my answer about the deadlock investigation and the fix we shipped.`)),
    ];
    const ex = extractLatestQuestion(turns);
    assert.match(ex.latestQuestion, /hardest bug/);
  });
});
