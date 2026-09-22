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
// outright, never salvaged into the title. Since 2026-08-26 a rejection no longer leaves
// the meeting unnamed — it falls back to the note-derived title (see the fallback block
// at the bottom of this file) — so the assertion is "the generation was not used".
test('an answer-shaped generation is rejected', async () => {
  for (const reply of ["Here's the C++ implementation", 'cpp', 'the team agreed to pilot the onboarding flow']) {
    const title = await generateTitleFromSummary(fakeLLM(reply), SUMMARY);
    assert.notEqual(title, reply, `answer fragment was accepted as a title: "${reply}"`);
    assert.match(title, /^Onboarding, Pilot, Security review$/,
      `a rejected generation must fall back to the note-derived title, got: "${title}"`);
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
// RC-9 (real production failure): a well-formed, Title Case, non-answer-shaped title
// with ZERO overlap with the notes it was generated from must be rejected. The notes are
// about an OOD interview for a cloud reading app; the model returned a title about
// penetration testing — a topic the transcript never mentions. Every existing guard
// (cleanMeetingTitle, isAnswerFragmentTitle, isAnswerShapedGeneration) passes this title;
// only a grounding check catches it. Proves RED against pre-fix code (no grounding gate).
test('an ungrounded title sharing no meaningful word with the notes is rejected', async () => {
  const CLOUD_READING_APP_SUMMARY = {
    title: 'Untitled Session',
    tldr: [
      'Discussed object-oriented design for a cloud-based reading app, focusing on class structure for books, shelves, and readers.',
    ],
    keyPoints: [
      'Modeled Book, Shelf, and Reader classes with clear responsibilities.',
      'Discussed how syncing reading progress across devices should work.',
    ],
    topics: ['object-oriented design', 'cloud reading app', 'class structure', 'interview'],
  };
  const title = await generateTitleFromSummary(
    fakeLLM('Penetration testing of the user-facing input surface'),
    CLOUD_READING_APP_SUMMARY
  );
  // Rejected, not saved — and since 2026-08-26 replaced by the note-derived fallback
  // rather than left as null (which meant the meeting kept no title at all).
  assert.notEqual(title, 'Penetration testing of the user-facing input surface',
    'ungrounded title (zero word overlap with notes) must be rejected, not saved');
  assert.notEqual(title, null, 'a rejected title must not leave the meeting unnamed');
  assert.match(title, /object-oriented design/i, 'the fallback must be derived from the notes');
});

// Guard against over-rejection: a title that DOES share a meaningful word with the notes
// must still be accepted.
test('a grounded title sharing a meaningful word with the notes is accepted', async () => {
  const title = await generateTitleFromSummary(fakeLLM('Onboarding Pilot Rollout'), SUMMARY);
  assert.equal(title, 'Onboarding Pilot Rollout');
});

// Matches FollowUpDraftGenerator's validatedSubject behaviour: when there is no usable
// corpus (sparse summary), accept the title rather than drop it — there is nothing better
// to fall back to either.
test('a title is accepted when there is no usable corpus to check grounding against', async () => {
  const SPARSE = { title: '', tldr: [], keyPoints: [], overview: '', topics: ['ok'] };
  const title = await generateTitleFromSummary(fakeLLM('Quarterly Kickoff Review'), SPARSE);
  assert.equal(title, 'Quarterly Kickoff Review');
});

test('the prompt carries note content only, never transcript-shaped lines', async () => {
  const sink = [];
  await generateTitleFromSummary(fakeLLM('Onboarding Pilot Rollout', sink), SUMMARY);
  const sent = `${sink[0].systemPrompt}\n${sink[0].context}`;
  assert.match(sent, /onboarding/i);
  const labelLines = sink[0].context.match(/^\w+:\s/gm) || [];
  assert.ok(labelLines.length <= 1, `context looks like multi-turn transcript lines: ${JSON.stringify(labelLines)}`);
  assert.equal(/^speaker:\s/im.test(sink[0].context), false, 'context must not contain the raw-transcript speaker fallback label');
});

// ── Deterministic fallback (2026-08-26, real production failure) ──────────────
// A live meeting was saved with NO title: the model answered the naming call with the
// no-action sentinel ("[[NO_ACTION]]"), the grounding guard rejected it, the function
// returned null, and the caller left the title at its default. `null` must mean "there
// is nothing to name", never "generation misbehaved" — every rejection path now falls
// back to a title DERIVED FROM THE NOTES with no second LLM call.
const NO_ACTION = '[[NO_ACTION]]';

test('a no-action sentinel reply yields a deterministic title derived from the notes', async () => {
  const title = await generateTitleFromSummary(fakeLLM(NO_ACTION), SUMMARY);
  assert.notEqual(title, null, 'the sentinel must not leave the meeting unnamed');
  assert.equal(/NO_ACTION/.test(title), false, `the sentinel leaked into the title: ${title}`);
  // Derived from `topics` (first tier of the fallback chain).
  assert.match(title, /onboarding/i);
  assert.ok(title.length <= 64, `fallback title is not title-length: ${title}`);
});

test('a sentinel wrapped in quotes/punctuation is still treated as a refusal', async () => {
  for (const reply of ['"[[NO_ACTION]]"', '[[NO_ACTION]].', '  [[NO_ACTION]]  ']) {
    const title = await generateTitleFromSummary(fakeLLM(reply), SUMMARY);
    assert.notEqual(title, null, `sentinel variant left the meeting unnamed: ${reply}`);
    assert.equal(/NO_ACTION/.test(title), false, `the sentinel leaked into the title: ${title}`);
  }
});

test('generation throwing yields the deterministic fallback rather than null', async () => {
  const throwingLLM = { generateMeetingSummary: async () => { throw new Error('deadline exceeded'); } };
  const title = await generateTitleFromSummary(throwingLLM, SUMMARY);
  assert.notEqual(title, null, 'a failed title call must not leave the meeting unnamed');
  assert.match(title, /onboarding/i);
});

test('the deterministic fallback uses tldr when there are no topics', async () => {
  const NO_TOPICS = { title: 'Untitled Session', tldr: SUMMARY.tldr, topics: [] };
  const title = await generateTitleFromSummary(fakeLLM(NO_ACTION), NO_TOPICS);
  assert.notEqual(title, null);
  assert.ok(title.length <= 64, `fallback title is not title-length: ${title}`);
  assert.match(title, /team agreed/i);
});

test('the deterministic fallback uses overview when tldr and topics are empty', async () => {
  const OVERVIEW_ONLY = { title: '', tldr: [], keyPoints: [], topics: [], overview: 'Reviewed the migration plan for the billing service.' };
  const title = await generateTitleFromSummary(fakeLLM(NO_ACTION), OVERVIEW_ONLY);
  assert.notEqual(title, null);
  assert.match(title, /migration plan/i);
});

// Guard against the fallback shadowing a real title: a good generation still wins.
test('a good generated title still beats the deterministic fallback', async () => {
  const title = await generateTitleFromSummary(fakeLLM('Onboarding Pilot Rollout'), SUMMARY);
  assert.equal(title, 'Onboarding Pilot Rollout');
});

// The only remaining null: genuinely nothing to name. No LLM call, no fallback.
test('genuinely empty note content still returns null', async () => {
  const sink = [];
  const title = await generateTitleFromSummary(fakeLLM(NO_ACTION, sink), { title: '', tldr: [], keyPoints: [], overview: '', topics: [] });
  assert.equal(title, null, 'no note content means there is nothing to derive a title from');
  assert.equal(sink.length, 0);
});

// ── Regeneration must not downgrade a good title (2026-08-26) ────────────────
// The deterministic fallback above is right for the FIRST save — a meeting must have a
// name. On REGENERATION it is a downgrade: a refusal/timeout would silently replace a
// perfectly good model-generated title with the mechanical note-derived one, which the
// old `null` return could never do. generateTitleFromSummaryWithSource reports where the
// title came from; shouldReplaceTitleOnRegenerate is the policy over that signal.
const { generateTitleFromSummaryWithSource, shouldReplaceTitleOnRegenerate } =
  await import(pathToFileURL(path.join(base, 'MeetingPersistence.js')).href);

test('a model-generated title reports source "model"', async () => {
  const out = await generateTitleFromSummaryWithSource(fakeLLM('Onboarding Pilot Rollout'), SUMMARY);
  assert.deepEqual(out, { title: 'Onboarding Pilot Rollout', source: 'model' });
});

test('a refusal reports source "fallback" alongside the note-derived title', async () => {
  const out = await generateTitleFromSummaryWithSource(fakeLLM(NO_ACTION), SUMMARY);
  assert.equal(out.source, 'fallback');
  assert.match(out.title, /onboarding/i);
});

test('a throwing call reports source "fallback"', async () => {
  const out = await generateTitleFromSummaryWithSource(
    { generateMeetingSummary: async () => { throw new Error('deadline exceeded'); } }, SUMMARY);
  assert.equal(out.source, 'fallback');
});

test('nothing groundable to name reports source "none"', async () => {
  const out = await generateTitleFromSummaryWithSource(fakeLLM('Something'), { title: '', tldr: [], keyPoints: [], overview: '', topics: [] });
  assert.deepEqual(out, { title: null, source: 'none' });
});

test('the plain wrapper still returns just the title string (existing call site unchanged)', async () => {
  assert.equal(await generateTitleFromSummary(fakeLLM('Onboarding Pilot Rollout'), SUMMARY), 'Onboarding Pilot Rollout');
  assert.equal(await generateTitleFromSummary(fakeLLM(NO_ACTION), SUMMARY), 'Onboarding, Pilot, Security review');
});

test('regeneration with a refusing model preserves the existing good title', async () => {
  const candidate = await generateTitleFromSummaryWithSource(fakeLLM(NO_ACTION), SUMMARY);
  assert.equal(candidate.source, 'fallback');
  assert.equal(shouldReplaceTitleOnRegenerate('Onboarding Pilot Rollout', candidate), false,
    'a fallback-derived title must not overwrite an existing non-default title');
});

test('regeneration with a succeeding model still replaces the existing title', async () => {
  const candidate = await generateTitleFromSummaryWithSource(fakeLLM('Onboarding Pilot Rollout'), SUMMARY);
  assert.equal(candidate.source, 'model');
  assert.equal(shouldReplaceTitleOnRegenerate('Stale Generated Name', candidate), true);
});

test('the fallback still fills an empty or placeholder title (first-generation path)', async () => {
  const candidate = await generateTitleFromSummaryWithSource(fakeLLM(NO_ACTION), SUMMARY);
  assert.equal(candidate.source, 'fallback');
  // 'Meeting Notes' is MeetingSummaryReducer's own placeholder (`params.title ||
  // 'Meeting Notes'`), so on regeneration the fresh v3.title carries it whenever the
  // meeting has no real name — it must not be mistaken for a title worth protecting.
  for (const existing of ['', '   ', 'Untitled Session', 'Meeting Notes', undefined, null]) {
    assert.equal(shouldReplaceTitleOnRegenerate(existing, candidate), true,
      `a meeting with no real name must take the fallback (existing: ${JSON.stringify(existing)})`);
  }
});

test('nothing to name never replaces anything', () => {
  assert.equal(shouldReplaceTitleOnRegenerate('Onboarding Pilot Rollout', { title: null, source: 'none' }), false);
  assert.equal(shouldReplaceTitleOnRegenerate('', { title: null, source: 'none' }), false);
});

// Drift pin: the regenerate call site is not unit-testable (DatabaseManager +
// MeetingContextAssembler + BrowserWindow), so pin that it routes through the predicate
// rather than assigning the regenerated title unconditionally.
test('the regenerate call site applies the predicate (drift pin)', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(path.resolve(process.cwd(), 'electron/MeetingPersistence.ts'), 'utf8');
  assert.match(src, /shouldReplaceTitleOnRegenerate\(existingTitle, regenerated\)/);
});

// The reducer's placeholder must be recognised on BOTH title sources the regenerate call
// site reads (fresh v3.title, then the DB row) — otherwise a placeholder in the fresh
// summary shadows a good stored title and the fallback overwrites it.
test('isDefaultMeetingTitle knows every placeholder a meeting can be carrying', async () => {
  const { isDefaultMeetingTitle } = await import(pathToFileURL(path.join(base, 'MeetingPersistence.js')).href);
  for (const t of ['', '   ', 'Untitled Session', 'untitled session', 'Meeting Notes', 'meeting notes', undefined, null]) {
    assert.equal(isDefaultMeetingTitle(t), true, `expected placeholder: ${JSON.stringify(t)}`);
  }
  for (const t of ['Onboarding Pilot Rollout', 'Meeting Notes for the Q3 Kickoff', 'Untitledly Named Sync']) {
    assert.equal(isDefaultMeetingTitle(t), false, `expected a real title: ${t}`);
  }
});
