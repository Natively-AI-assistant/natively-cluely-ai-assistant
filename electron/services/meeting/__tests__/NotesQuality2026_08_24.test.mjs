import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = path.resolve(__dirname, '../../../../dist-electron/electron/services/meeting');
const { similar, MeetingSummaryReducer } = await import(pathToFileURL(path.join(base, 'MeetingSummaryReducer.js')).href);
const { TranscriptNormalizer } = await import(pathToFileURL(path.join(base, 'TranscriptNormalizer.js')).href);

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
