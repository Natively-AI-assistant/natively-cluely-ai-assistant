import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const base = path.resolve(process.cwd(), 'dist-electron/electron');
const { generateTitleFromSummary } = await import(pathToFileURL(path.join(base, 'MeetingPersistence.js')).href);

const SUMMARY = {
  title: 'Untitled Session',
  tldr: ['The team agreed to pilot the new onboarding flow across two regions after a security review.'],
  topics: ['onboarding', 'pilot', 'security review'],
};

// V2-shaped: tldr is empty (legacy path never populates it), keyPoints/overview are.
const V2_SUMMARY = {
  title: 'Untitled Session',
  tldr: [],
  keyPoints: ['Rebuilt the Wordle game board using React state', 'Discussed time complexity of the guess-check function'],
  overview: 'The candidate rebuilt Wordle in React, covering state management and algorithmic tradeoffs.',
};

const fakeLLM = (reply, sink) => ({
  generateMeetingSummary: async (systemPrompt, context) => { sink?.push({ systemPrompt, context }); return reply; },
});

test('a grounded summary yields a cleaned title', async () => {
  const title = await generateTitleFromSummary(fakeLLM('Onboarding Pilot Rollout'), SUMMARY);
  assert.equal(title, 'Onboarding Pilot Rollout');
});

// RC-7: the model answering the notes instead of naming them must still be rejected
// outright, not salvaged — the meeting keeps its default title.
test('an answer-shaped generation is rejected', async () => {
  for (const reply of ["Here's the C++ implementation", 'cpp', 'the team agreed to pilot the onboarding flow']) {
    assert.equal(await generateTitleFromSummary(fakeLLM(reply), SUMMARY), null,
      `answer fragment was accepted as a title: "${reply}"`);
  }
});

// Regression guard for the tldr -> keyPoints -> overview fallback chain: the legacy V2
// pipeline (still the fallback when V3 returns null) never populates tldr. If the title
// function only reads tldr, it silently produces nothing on that path.
test('a V2-shaped summary (empty tldr, populated keyPoints) still produces a title', async () => {
  const sink = [];
  const title = await generateTitleFromSummary(fakeLLM('Wordle Rebuild Walkthrough', sink), V2_SUMMARY);
  assert.equal(title, 'Wordle Rebuild Walkthrough');
  assert.equal(sink.length, 1, 'the keyPoints fallback should still call the model');
});

test('an empty summary makes no LLM call at all', async () => {
  const sink = [];
  const title = await generateTitleFromSummary(fakeLLM('Something', sink), { title: '', tldr: [], keyPoints: [], overview: '', topics: [] });
  assert.equal(title, null);
  assert.equal(sink.length, 0, 'no grounded content means there is nothing to name — do not call the model');
});

// The whole point of the move: the title no longer sees raw transcript. The context is
// allowed one structured label line ("Topics: ..."), but never the raw-transcript
// `speaker: text` shape — which shows up either as a run of many "word: text" lines (one
// per turn) or the literal "speaker:" fallback the old transcript formatter used for an
// unnamed segment.
test('the prompt carries note content only, never transcript-shaped lines', async () => {
  const sink = [];
  await generateTitleFromSummary(fakeLLM('Onboarding Pilot Rollout', sink), SUMMARY);
  const sent = `${sink[0].systemPrompt}\n${sink[0].context}`;
  assert.match(sent, /onboarding/i);
  const labelLines = sink[0].context.match(/^\w+:\s/gm) || [];
  assert.ok(labelLines.length <= 1, `context looks like multi-turn transcript lines: ${JSON.stringify(labelLines)}`);
  assert.equal(/^speaker:\s/im.test(sink[0].context), false, 'context must not contain the raw-transcript speaker fallback label');
});
