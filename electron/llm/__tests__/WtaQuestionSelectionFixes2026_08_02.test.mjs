// electron/llm/__tests__/WtaQuestionSelectionFixes2026_08_02.test.mjs
//
// Regression pins for the 2026-08-02 "what to answer" question-selection audit.
// Loads the REAL compiled modules from dist-electron.
//
// Run: npm run build:electron && \
//      ELECTRON_RUN_AS_NODE=1 npx electron --test electron/llm/__tests__/WtaQuestionSelectionFixes2026_08_02.test.mjs
//
// Each suite below corresponds to a defect that shipped. Every assertion is
// written so that REVERTING the fix fails it — the audit found two existing
// suites that could not detect the behaviour they claimed to protect, so these
// are deliberately written against observable output, not internals.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../../../dist-electron/electron/llm');
const { extractLatestQuestion } = await import(
  pathToFileURL(path.join(DIST, 'transcriptQuestionExtractor.js')).href
);
const mod = await import(pathToFileURL(path.join(DIST, 'transcriptCleaner.js')).href);
const { cleanTranscript } = mod;

let _t = 1_000_000;
const turn = (role, text, ts) => ({ role, text, timestamp: ts ?? (_t += 1000) });

describe('WTA selection — text fidelity (was: cleaned text emitted as the question)', () => {
  test('entity casing survives selection', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'Hello there'),
      turn('interviewer', 'How much PostgreSQL and Kafka have you used?'),
    ]);
    // The emitted question feeds both the résumé retrieval query and the model
    // prompt. Lowercasing it degraded both.
    assert.match(r.latestQuestion, /PostgreSQL/, 'entity casing must survive');
    assert.match(r.latestQuestion, /Kafka/, 'entity casing must survive');
  });

  test('terminal question mark survives an acknowledgement-word strip', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'Hi there'),
      turn('interviewer', 'So you were at Google for three years, right?'),
    ]);
    // "right" is in ACKNOWLEDGEMENTS; stripping it as a trailing discourse
    // marker took the '?' with it, dropping confidence 0.8 -> 0.4.
    assert.match(r.latestQuestion, /\?/, "terminal '?' must survive");
    assert.match(r.latestQuestion, /Google/, 'entity casing must survive');
    assert.ok(r.confidence >= 0.8, `expected >=0.8, got ${r.confidence}`);
  });

  test('scoring still runs on cleaned text — a leading filler must not cost the interrogative lead', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'Hi'),
      turn('interviewer', 'Um, so, what is your name?'),
    ]);
    // INTERROGATIVE_LEAD is anchored at ^. If shape scoring were moved onto the
    // raw text this would fall to 0.8 (mark only). Cleaning must remain a
    // FILTER for scoring while the emitted string stays raw.
    assert.equal(r.confidence, 0.95, 'lead+mark must still score 0.95');
    assert.match(r.latestQuestion, /what is your name\?/i);
  });
});

describe('WTA selection — bare one-word follow-ups are questions', () => {
  test('"Why?" is selected, not discarded in favour of a stale turn', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'Talk about your data project.'),
      turn('user', 'I built an analytics pipeline.'),
      turn('interviewer', 'Why?'),
    ]);
    // isMeaningfulTurn required >=5 chars for interviewer turns, so "Why?" (4)
    // was dropped entirely and selection fell back to turn 0 — a question the
    // candidate had ALREADY answered.
    assert.match(r.latestQuestion, /^why\??$/i, `expected "Why?", got ${JSON.stringify(r.latestQuestion)}`);
  });

  test('cleanTranscript keeps short interrogative interviewer turns', () => {
    const kept = cleanTranscript([turn('interviewer', 'Why?'), turn('interviewer', 'When?')]);
    assert.equal(kept.length, 2, 'both bare interrogatives must survive cleaning');
  });

  test('short NON-interrogative interviewer noise is still dropped', () => {
    // The exemption must be shape-gated, not a blanket removal of the floor.
    const kept = cleanTranscript([turn('interviewer', 'ok')]);
    assert.equal(kept.length, 0, 'bare acknowledgement must still be dropped');
  });
});

describe('WTA selection — answerability floor', () => {
  test('an evaluative statement does not clear the 0.6 grounding gate', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'Tell me about your distributed systems work.'),
      turn('user', 'Sure, I built a sharded event bus handling 40k events per second.'),
      turn('interviewer', 'Interesting, that sounds pretty solid.'),
    ]);
    // No '?', no interrogative lead, no imperative ask. The bare "that" matched
    // WEAK_FOLLOW_UP_MARKERS, which labelled it follow_up and floored
    // confidence at 0.7 — above the 0.6 gate in IntelligenceEngine.
    assert.ok(r.confidence < 0.6, `expected <0.6, got ${r.confidence}`);
    assert.equal(r.isFollowUp, false, 'a weak demonstrative alone is not a follow-up question');
    assert.equal(r.followUpTarget, '', 'must not emit a salient-token guess');
  });

  // These are the cases the floor EXISTS for. A statement that classifyType
  // labels non-'general' gets its confidence floored to 0.7 by the
  // `questionType !== 'general'` rule — i.e. ABOVE the 0.6 grounding gate — so
  // without the answerability floor an interviewer merely COMMENTING triggers a
  // full résumé-grounded generated answer as though they had asked something.
  //
  // (Written after mutation-probing an earlier version of this suite: the
  // "Interesting, that sounds pretty solid." case below passes with the floor
  // removed, because the isAnswerable guard on isFollowUp already covers it.
  // These inputs fail without the floor, so they are what actually pins it.)
  for (const [statement, type] of [
    ['Your Python experience is impressive.', 'profile_detail'],
    ['Your salary expectation seems high.', 'negotiation'],
    ['I see you studied computer science.', 'profile_detail'],
  ]) {
    test(`non-question statement typed '${type}' stays below the grounding gate: ${JSON.stringify(statement)}`, () => {
      const r = extractLatestQuestion([
        turn('interviewer', 'Tell me about your work.'),
        turn('user', 'I built a pipeline.'),
        turn('interviewer', statement),
      ]);
      assert.ok(
        r.confidence < 0.6,
        `expected <0.6 (grounding gate), got ${r.confidence} for type ${r.questionType}`,
      );
    });
  }

  test('a real imperative ask is unaffected (campaign2 fix#5 must not regress)', () => {
    // Recency-wins exists so imperative asks with no '?' still win over an
    // older question-shaped turn. The floor must not undo that.
    const r = extractLatestQuestion([
      turn('interviewer', 'What did you study?'),
      turn('user', 'Computer science.'),
      turn('interviewer', 'One more question — tell me about levee.'),
    ]);
    assert.match(r.latestQuestion, /levee/i, 'recency must still win for imperative asks');
    // 0.4 is this input's PRE-FIX baseline (verified against the build with the
    // extractor changes stashed: type 'general', conf 0.4 — no '?', no
    // sentence-initial lead). The invariant under test is that the
    // answerability floor does NOT fire here: firing would cap it to 0.3 and
    // silently disable grounding for every mid-sentence imperative ask.
    assert.ok(r.confidence > 0.3, `answerability floor must not cap an imperative ask, got ${r.confidence}`);
    assert.equal(r.confidence, 0.4, 'baseline confidence for this shape must be unchanged by the fix');
  });

  test('a genuine bare follow-up still grounds', () => {
    const r = extractLatestQuestion([
      turn('interviewer', 'Have you used FastAPI?'),
      turn('user', 'Yes, on the payments service.'),
      turn('interviewer', 'Where?'),
    ]);
    assert.ok(r.confidence >= 0.6, `real follow-up must clear the gate, got ${r.confidence}`);
  });
});

describe('WTA selection — timestamp collisions', () => {
  test('same-millisecond turns do not defeat the raw-text greeting guard', () => {
    // Streaming STT emits multiple turns inside one millisecond. The greeting
    // guard looked the raw turn up by TIMESTAMP ALONE, so it retrieved the
    // first turn sharing that millisecond instead of the one being examined.
    // "Nice to meet you" cleans to "to meet you" (no longer greeting-shaped),
    // so the raw-text fallback is what stops it becoming the question.
    const TS = 5_000_000;
    const r = extractLatestQuestion([
      { role: 'interviewer', text: 'What is your background?', timestamp: TS },
      { role: 'user', text: 'I am a backend engineer.', timestamp: TS },
      { role: 'interviewer', text: 'Nice to meet you', timestamp: TS },
    ]);
    assert.doesNotMatch(
      r.latestQuestion,
      /to meet you/i,
      `a greeting must not become the question, got ${JSON.stringify(r.latestQuestion)}`,
    );
  });
});

describe('WTA question derivations must not diverge (F-1)', () => {
  // Source-level assertion. The defect is that TWO plans are computed for one
  // turn from DIFFERENT question strings — _wtaQ drives the source-authority /
  // evidence gates, canonicalTurn drives the answer type and the prompt. No
  // unit test can observe the divergence without booting the whole engine, so
  // pin the expressions themselves. (Same technique as
  // StripPriorAssistantTurnsDedup2026_07_26.)
  const enginePath = path.resolve(__dirname, '../../IntelligenceEngine.ts');
  const src = readFileSync(enginePath, 'utf8');

  const DERIVATIONS = [
    ['_wtaQHoist', /const _wtaQHoist = ([^;]+);/],
    ['_wtaQ', /const _wtaQ = ([^;]+);/],
    ['wtaTurnQuestion', /const wtaTurnQuestion = ([^;]+);/],
  ];

  const found = DERIVATIONS.map(([name, re]) => {
    const m = src.match(re);
    assert.ok(m, `could not find the ${name} derivation — did it get renamed?`);
    return [name, m[1].trim()];
  });

  test('all three derive the question from the same expression', () => {
    const canonical = found.find(([n]) => n === 'wtaTurnQuestion')[1];
    for (const [name, expr] of found) {
      assert.equal(
        expr,
        canonical,
        `${name} must use the same expression as wtaTurnQuestion.\n`
        + `  ${name}: ${expr}\n  wtaTurnQuestion: ${canonical}\n`
        + 'Diverging here means the evidence/source gates and the answer route '
        + 'are planned for DIFFERENT questions on the same turn.',
      );
    }
  });

  test('every derivation consults the caller-supplied `question` first', () => {
    for (const [name, expr] of found) {
      assert.match(
        expr, /^question \|\|/,
        `${name} must prefer the typed question; dropping it was the original defect`,
      );
    }
  });
});

describe('sparsifyTranscript — the turn budget must be fully spent', () => {
  const { sparsifyTranscript, prepareTranscriptForWhatToAnswer } = mod;
  let ts = 2_000_000;
  const t = (role, text) => ({ role, text, timestamp: (ts += 1000) });

  test('an interviewer-only window uses the WHOLE budget, not half of it', () => {
    // The old allocation hard-capped interviewer speech at slice(-6) and gave
    // the remaining maxTurns-6 slots to otherTurns unconditionally. With no
    // candidate turns those slots were forfeited: 14 in, 6 out. An interviewer
    // asking several questions in a row is exactly when context matters most.
    const turns = [];
    for (let i = 1; i <= 14; i++) turns.push(t('interviewer', `Question number ${i}: what is your view on topic ${i}?`));
    const out = sparsifyTranscript(turns, 12);
    assert.equal(out.length, 12, `expected the full 12-turn budget, got ${out.length}`);
  });

  test('a mixed window still spends the full budget and keeps recency', () => {
    const turns = [];
    for (let i = 1; i <= 9; i++) {
      turns.push(t('interviewer', `Interviewer question number ${i} about your engineering work?`));
      if (i % 2 === 0) turns.push(t('user', `Candidate answer number ${i} with enough words to survive cleaning.`));
    }
    const out = sparsifyTranscript(turns, 12);
    assert.equal(out.length, 12, `expected 12, got ${out.length}`);
    // Recency: the newest interviewer turn must always survive — it is the one
    // extractLatestQuestion will have selected.
    assert.ok(
      out.some((x) => /number 9/.test(x.text)),
      'the most recent interviewer turn must never be evicted',
    );
  });

  test('both roles still represented when both are present', () => {
    const turns = [];
    for (let i = 1; i <= 10; i++) {
      turns.push(t('interviewer', `Interviewer question number ${i} about your engineering work?`));
      turns.push(t('user', `Candidate answer number ${i} with enough words to survive cleaning.`));
    }
    const out = sparsifyTranscript(turns, 12);
    assert.equal(out.length, 12);
    assert.ok(out.some((x) => x.role === 'interviewer'), 'interviewer turns must be present');
    assert.ok(out.some((x) => x.role !== 'interviewer'), 'candidate turns must be present');
  });

  test('bare interrogatives do not evict MORE questions than they add', () => {
    // Regression guard for the SHORT_INTERROGATIVE exemption added by this same
    // change set: keeping "Why?"/"When?" pushed interviewerTurns past the old
    // 6-turn cap, and slice(-6) evicted from the OLD end — so two short turns
    // cost three substantive questions. With the budget fully spent this is
    // bounded: adding N turns to an over-cap window may cost at most N.
    const base = [];
    for (let i = 1; i <= 7; i++) {
      base.push(t('interviewer', `Interviewer question number ${i} about your engineering work?`));
      base.push(t('user', `Candidate answer number ${i} with enough words to survive cleaning.`));
    }
    const withBare = [...base, t('interviewer', 'Why?'), t('interviewer', 'When?')];
    const a = prepareTranscriptForWhatToAnswer(base, 12).split('\n').length;
    const b = prepareTranscriptForWhatToAnswer(withBare, 12).split('\n').length;
    assert.ok(b >= a, `adding turns must not SHRINK the prompt: ${a} -> ${b}`);
    assert.equal(b, 12, `expected the full budget, got ${b}`);
  });
});
