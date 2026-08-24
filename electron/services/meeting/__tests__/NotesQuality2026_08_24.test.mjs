import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = path.resolve(__dirname, '../../../../dist-electron/electron/services/meeting');
const { similar, MeetingSummaryReducer } = await import(pathToFileURL(path.join(base, 'MeetingSummaryReducer.js')).href);
const { TranscriptNormalizer } = await import(pathToFileURL(path.join(base, 'TranscriptNormalizer.js')).href);
const { newSignificantTokens } = await import(pathToFileURL(path.join(base, 'SummaryPolisher.js')).href);
const { buildChunkPrompt } = await import(pathToFileURL(path.join(base, 'ChunkSummaryGenerator.js')).href);

// The old rule was `shared / min(wordCount) >= 0.8` — pure subset containment — so a short
// vague bullet always matched a longer specific one, and mergeSimilar kept the FIRST-seen
// text. Every pair below was reproduced collapsing on 2026-08-24.
//
// The early/middle/late row below is NOT a vague/specific pair — it is three chunk-scoped
// decisions that differ by a single distinguishing word. It was added on fix round 1 because
// Dice 0.7 scored this pair 0.750 and merged them, destroying chunk coverage (regression
// caught by MeetingSummaryPipeline.test.mjs "long transcript chunker preserves early middle
// and late coverage"). It is the reason SIMILARITY_DICE_THRESHOLD must stay above 0.75 — see
// MeetingSummaryReducer.ts.
const MUST_STAY_DISTINCT = [
  ['Security review is required', 'Security review is required before the pilot can start, and legal must sign the DPA'],
  ['Pricing was discussed', 'Pricing was discussed and they pushed back hard on the per-seat model above 200 seats'],
  ['Ari will send the packet', 'Ari will send the SOC2 packet to procurement on Friday'],
  ['Team is blocked', 'Team is blocked on the vendor API keys until Thursday'],
  ['Candidate has React experience', 'Candidate has five years of React experience at a fintech scale-up'],
  ['Decision from early meeting segment', 'Decision from middle meeting segment'],
];

// Chunk overlap genuinely restates the same point; those must still collapse or the notes
// read duplicated. These are rewordings of equal weight, not a vague/specific pair.
//
// Deliberately NOT covered here: paraphrase-level restatements (e.g. "Ari will send the SOC2
// packet by Friday" vs "Ari sends the SOC2 packet on Friday", Dice 0.727) are NOT guaranteed
// to merge at threshold 0.8. That row was removed on fix round 1 — it conflicted with the
// early/middle/late constraint above (no single scalar threshold can keep 0.750 distinct and
// merge 0.727). Between under-merging a paraphrase (one extra near-duplicate bullet) and
// over-merging chunk-scoped decisions (destroyed coverage), under-merging is the correct
// failure direction for a fix whose purpose is "notes are too thin".
//
// IMPORTANT — the first two rows below are VACUOUS with respect to the Dice/length-ratio
// code this task changed: both pairs normalize to IDENTICAL strings (stopword/punctuation
// stripping erases the only difference), so both hit the `na === nb` fast path in similar()
// and never reach the Dice computation at all. They would still pass if the entire Dice
// branch were deleted, inverted, or set to an unreachable threshold. The third row is the
// table's ONLY real assertion about the Dice merge path: it is a genuine reworded
// restatement (differs by one non-stopword, "finish" vs "complete"), so normalize() leaves
// it non-identical and it must clear the Dice threshold (0.857 >= 0.8) to merge. Do not
// remove it when "simplifying" this table — that would silently restore the vacuum.
const MUST_MERGE = [
  ['Use PostHog for analytics', 'Use PostHog for analytics.'],
  ['Pilot scope moves forward with security review', 'Pilot scope moves forward with a security review'],
  ['Security review must finish before the pilot starts', 'Security review must complete before the pilot starts'],
];

test('similar() does not collapse a specific bullet into a vague one', () => {
  for (const [vague, specific] of MUST_STAY_DISTINCT) {
    assert.equal(similar(vague, specific), false,
      `these are different points and must both survive:\n  "${vague}"\n  "${specific}"`);
  }
});

test('similar() still collapses genuine restatements', () => {
  for (const [a, b] of MUST_MERGE) {
    assert.equal(similar(a, b), true, `these are the same point and must merge:\n  "${a}"\n  "${b}"`);
  }
});

test('when two items merge, the richer text wins', () => {
  const normalized = new TranscriptNormalizer().normalize([
    { speaker: 'Ari', text: 'We will send the packet.', timestamp: 0, final: true },
    { speaker: 'Bo', text: 'Agreed.', timestamp: 1000, final: true },
    { speaker: 'Ari', text: 'By Friday.', timestamp: 2000, final: true },
  ]);
  const evidence = [{ speaker: 'Ari', timestamp: 0, quote: 'we will send the packet' }];
  const atom = (chunkIndex, text) => ({
    chunkIndex,
    timeRange: { start: chunkIndex * 1000, end: chunkIndex * 1000 + 999 },
    brief: 'packet discussion',
    topics: ['packet'], decisions: [], openQuestions: [], risks: [], deadlines: [],
    people: [], importantQuotes: [], modeSpecificFindings: {},
    actionItems: [{ text, owner: 'Ari', explicitness: 'explicit', evidence, confidence: 'high' }],
  });

  // The terse phrasing arrives FIRST; the richer one must still be what survives.
  const summary = new MeetingSummaryReducer().reduce({
    title: 'packet',
    atoms: [atom(0, 'Ari will send the SOC2 packet'), atom(1, 'Ari will send the SOC2 packet by Friday')],
    normalizedTranscript: normalized,
    modeTemplateType: 'general',
    modeNoteSections: [],
  });

  assert.equal(summary.actionItems.length, 1, 'the restatement should still merge');
  assert.match(summary.actionItems[0].text, /by Friday/,
    `the richer text must win, got: "${summary.actionItems[0].text}"`);
});

const GROUNDED = `Summary points:
- Ari: send the SOC2 packet by Friday
- Pilot scope moves forward with security review

Decisions:
- Pilot scope moves forward with security review

Section notes:
- Manual QA reporting takes two days each week
- Security review is required before pilot`;

// The gate exempted sentence-initial capitalisation only for the FIRST token of the whole
// output, so any sentence after the first that opened with a capitalised non-stopword was
// scored as an invented proper noun and killed the entire rewrite. The prompt asks for 3-5
// sentences, so this fired constantly. Reproduced 2026-08-24.
test('polish gate accepts sentence-initial connectives', () => {
  const accepted = [
    'Pilot scope moves forward with security review. However, security review is required before pilot.',
    'Pilot scope moves forward with security review. Additionally, manual QA reporting takes two days each week.',
    'Manual QA reporting takes two days each week. Overall, pilot scope moves forward with security review.',
    'Ari will send the SOC2 packet by Friday. Meanwhile, security review is required before pilot.',
  ];
  for (const text of accepted) {
    assert.deepEqual(newSignificantTokens(text, GROUNDED), [],
      `an ordinary sentence opener was scored as a hallucinated proper noun: "${text}"`);
  }
});

test('polish gate still rejects genuinely invented facts', () => {
  const rejected = [
    ['Pilot scope moves forward with security review at Acme.', 'Acme'],
    ['Ari will send the SOC2 packet by Friday to 47 reviewers.', '47'],
    ['Security review is required before pilot, per Deloitte.', 'Deloitte'],
  ];
  for (const [text, offender] of rejected) {
    const found = newSignificantTokens(text, GROUNDED);
    assert.ok(found.includes(offender),
      `"${offender}" is not in the notes and must be rejected; got ${JSON.stringify(found)}`);
  }
});

// KNOWN, ACCEPTED LIMITATION (ruled 2026-08-24): the position-plus-capitalisation heuristic
// exempts capitalisation at the start of EVERY sentence, not just the very first token of the
// whole output. That means a hallucinated proper noun that opens a non-first sentence is
// structurally invisible to the gate: `isFirstWord` forces `isProperNoun` false, and the token
// is then dropped by the `!isNumberLike && !isCalendar && !isProperNoun` continue before it
// ever reaches the grounded-set check. The alternative — a closed list of discourse
// connectives — was rejected: it would silently re-reject legitimate sentence openers outside
// the list ("Both sides agreed…", "Discussion focused…", "Participants raised…"), reintroducing
// the exact RC-3 bug intermittently. This test documents the gap; it does NOT assert that
// fabrication is caught here. If this test starts failing, the heuristic has been tightened —
// that is a deliberate behaviour change to think about, not a break to paper over.
test('KNOWN LIMITATION: a hallucinated proper noun opening a non-first sentence is not flagged', () => {
  const sentenceInitial = 'Pilot scope moves forward with security review. Acme said the deal closes Friday.';
  assert.deepEqual(newSignificantTokens(sentenceInitial, GROUNDED), [],
    'documents the accepted gap: sentence-initial hallucinations are invisible to this heuristic');

  // Contrast: the same fabricated token IS caught once it is not sentence-initial — this is
  // what makes the assertion above meaningful rather than vacuous.
  const midSentence = 'Pilot scope moves forward with security review at Acme.';
  assert.ok(newSignificantTokens(midSentence, GROUNDED).includes('Acme'),
    'sanity check: Acme must still be caught when not sentence-initial, or the test above is vacuous');
});

// FIX regression guard: `atSentenceStart` must advance BEFORE the stopword / punctuation-only /
// non-fact-shaped `continue`s inside the loop, or a skipped token leaves it stale for the next
// real token and silently reintroduces the RC-3 bug for the sentence that follows. Both a
// stopword-terminated sentence and a sentence separated by a standalone punctuation-only token
// are covered, so a future reordering of the checks inside the loop is caught here instead of
// in production.
test('sentence-boundary flag survives a trailing stopword and a trailing punctuation-only token', () => {
  const trailingStopword =
    'Pilot scope moves forward with it. However, security review is required before pilot.';
  assert.deepEqual(newSignificantTokens(trailingStopword, GROUNDED), [],
    'a legitimate opener after a stopword-terminated sentence must stay exempt');

  const trailingPunctuationOnlyToken =
    'Pilot scope moves forward with security review. ... Additionally, manual QA reporting takes two days each week.';
  assert.deepEqual(newSignificantTokens(trailingPunctuationOnlyToken, GROUNDED), [],
    'a legitimate opener after a standalone punctuation-only token must stay exempt');
});

test('chunk prompt states a density target and keeps evidence where it matters', () => {
  const { systemPrompt, jsonShapeHint } = buildChunkPrompt({
    chunk: { chunkIndex: 0, timeRange: { startMs: 0, endMs: 60000 }, text: 'x', charCount: 1 },
    totalChunks: 3,
    modeTemplateType: 'sales',
    modeNoteSections: [{ title: 'Pain points', description: 'customer pain' }],
  });

  // Density is the whole point: an unstated target plus heavy suppression pressure is why
  // sections came back with 1-3 terse bullets for an hour of conversation.
  assert.match(systemPrompt, /5-12 findings per section/i, 'no explicit density target');
  // Pin the SUBSTANCE of the precision clause, not just the phrase "PRECISION rule" — a
  // softened rewrite like "PRECISION rule, so when in doubt, omit" would reinstate recall
  // suppression while still matching a bare /PRECISION rule/i check.
  assert.match(
    systemPrompt,
    /PRECISION rule about fabrication[\s\S]*?NOT a licence to omit material that was genuinely discussed/i,
    'the empty-is-better rule is not scoped to precision, or has been softened back into a recall ceiling'
  );

  // Evidence stays mandatory where it powers jump-to-timestamp, optional where its cost
  // suppresses bullet count -- and that policy must agree everywhere the prompt mentions
  // evidence for a section finding, not only in the "ALSO extract" line. Two other spots in
  // this same prompt (the primary-task preamble and the findingShape JSON template) used to
  // state or imply evidence was unconditional, out-voting the new best-effort line 2-to-1.
  assert.match(systemPrompt, /evidence is REQUIRED for decisions and actionItems/i);
  assert.match(systemPrompt, /best-effort for section findings/i);
  assert.doesNotMatch(
    systemPrompt,
    /object with "text" and "evidence"/i,
    'the primary-task preamble still presents evidence as an unconditional part of a section finding'
  );
  assert.match(
    jsonShapeHint,
    /OPTIONAL[:\s].*omit the entire evidence key/i,
    'findingShape (in jsonShapeHint) does not mark evidence optional, contradicting the best-effort policy'
  );
});
