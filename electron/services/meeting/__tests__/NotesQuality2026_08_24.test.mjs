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
const MUST_STAY_DISTINCT = [
  ['Security review is required', 'Security review is required before the pilot can start, and legal must sign the DPA'],
  ['Pricing was discussed', 'Pricing was discussed and they pushed back hard on the per-seat model above 200 seats'],
  ['Ari will send the packet', 'Ari will send the SOC2 packet to procurement on Friday'],
  ['Team is blocked', 'Team is blocked on the vendor API keys until Thursday'],
  ['Candidate has React experience', 'Candidate has five years of React experience at a fintech scale-up'],
];

// Chunk overlap genuinely restates the same point; those must still collapse or the notes
// read duplicated. These are rewordings of equal weight, not a vague/specific pair.
const MUST_MERGE = [
  ['Use PostHog for analytics', 'Use PostHog for analytics.'],
  ['Ari will send the SOC2 packet by Friday', 'Ari sends the SOC2 packet on Friday'],
  ['Pilot scope moves forward with security review', 'Pilot scope moves forward with a security review'],
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
