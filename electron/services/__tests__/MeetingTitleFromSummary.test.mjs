import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// 2026-10-18: the title is written by the notes call itself (the overview reply, the
// short-session reply or the V2 fallback reply), never by a call of its own.
// vetProposedTitle only vets what that call proposed, so these tests hand it the
// proposal directly.
const base = path.resolve(process.cwd(), 'dist-electron/electron');
const { vetProposedTitle, shouldReplaceTitleOnRegenerate, isDefaultMeetingTitle } =
  await import(pathToFileURL(path.join(base, 'MeetingPersistence.js')).href);
const titleOf = (proposed, summary) => vetProposedTitle(proposed, summary).title;

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

const EMPTY = { title: '', tldr: [], keyPoints: [], overview: '', topics: [] };
const NO_ACTION = '[[NO_ACTION]]';

test('a grounded proposal is kept, cleaned', () => {
  assert.equal(titleOf('Onboarding Pilot Rollout', SUMMARY), 'Onboarding Pilot Rollout');
  assert.equal(titleOf('"Onboarding Pilot Rollout."', SUMMARY), 'Onboarding Pilot Rollout');
});

test('a proposal over 50 characters is cut to 50 on a word boundary', () => {
  const t = titleOf('Onboarding pilot rollout across two regions after the security review', SUMMARY);
  assert.ok(t.length <= 50, `too long (${t.length}): ${t}`);
  assert.match(t, /^Onboarding pilot rollout/);
  assert.equal(/\n/.test(t), false);
});

// RC-7: the model answering the notes instead of naming them must still be rejected
// outright, never salvaged into the title; the note-derived title takes its place.
test('an answer-shaped proposal is rejected for the note-derived title', () => {
  for (const reply of ["Here's the C++ implementation", 'cpp', 'the team agreed to pilot the onboarding flow']) {
    const t = titleOf(reply, SUMMARY);
    assert.notEqual(t, reply, `answer fragment was accepted as a title: "${reply}"`);
    assert.equal(t, 'Onboarding, pilot and security review');
  }
});

// The legacy V2 notes never populate tldr; vetting and the fallback both read keyPoints.
test('a V2-shaped summary (empty tldr, populated keyPoints) keeps a grounded proposal', () => {
  assert.equal(titleOf('Wordle Rebuild Walkthrough', V2_SUMMARY), 'Wordle Rebuild Walkthrough');
});

// RC-9 (real production failure): a well-formed title with ZERO overlap with the notes
// (penetration testing, for an interview about a cloud reading app) must be rejected.
test('an ungrounded proposal sharing no meaningful word with the notes is rejected', () => {
  const CLOUD_READING_APP_SUMMARY = {
    title: 'Untitled Session',
    tldr: ['Discussed object-oriented design for a cloud-based reading app, focusing on class structure for books, shelves, and readers.'],
    keyPoints: ['Modeled Book, Shelf, and Reader classes with clear responsibilities.'],
    topics: ['object-oriented design', 'cloud reading app', 'class structure', 'interview'],
  };
  const t = titleOf('Penetration testing of the user-facing input surface', CLOUD_READING_APP_SUMMARY);
  assert.notEqual(t, 'Penetration testing of the user-facing input surface');
  assert.match(t, /object-oriented design/i, 'the fallback must be derived from the notes');
});

// Matches FollowUpDraftGenerator's validatedSubject: no usable corpus, accept the title.
test('a proposal is accepted when there is no usable corpus to check grounding against', () => {
  assert.equal(titleOf('Quarterly Kickoff Review', { ...EMPTY, topics: ['ok'] }), 'Quarterly Kickoff Review');
});

// ── Deterministic fallback (2026-08-26, real production failure) ──────────────
// A live meeting was saved with NO title after the model answered with the no-action
// sentinel. `null` must mean "there is nothing to name", never "generation misbehaved".

test('a no-action sentinel yields a title derived from the notes', () => {
  for (const reply of [NO_ACTION, '"[[NO_ACTION]]"', '[[NO_ACTION]].', '  [[NO_ACTION]]  ']) {
    const t = titleOf(reply, SUMMARY);
    assert.ok(t, `sentinel variant left the meeting unnamed: ${reply}`);
    assert.equal(/NO_ACTION/.test(t), false, `the sentinel leaked into the title: ${t}`);
    assert.match(t, /onboarding/i);
  }
});

test('no proposal at all (overview call off or failed) yields the note-derived title', () => {
  for (const proposed of [undefined, null, '', '   ']) {
    assert.deepEqual(vetProposedTitle(proposed, SUMMARY), { title: 'Onboarding, pilot and security review', source: 'fallback' });
  }
});

test('the fallback uses tldr when there are no topics, within 50 characters', () => {
  const t = titleOf(undefined, { title: 'Untitled Session', tldr: SUMMARY.tldr, topics: [] });
  assert.ok(t.length <= 50, `fallback title is not title-length (${t.length}): ${t}`);
  assert.match(t, /team agreed/i);
});

test('the fallback uses overview when tldr and topics are empty', () => {
  const t = titleOf(NO_ACTION, { ...EMPTY, overview: 'Reviewed the migration plan for the billing service.' });
  assert.match(t, /migration plan/i);
});

test('genuinely empty note content returns null, whatever was proposed', () => {
  assert.deepEqual(vetProposedTitle('Something', EMPTY), { title: null, source: 'none' });
  assert.deepEqual(vetProposedTitle(undefined, EMPTY), { title: null, source: 'none' });
});

// ── Source, and regeneration must not downgrade a good title (2026-08-26) ────
test('an accepted proposal reports source "model", a rejected one "fallback"', () => {
  assert.deepEqual(vetProposedTitle('Onboarding Pilot Rollout', SUMMARY), { title: 'Onboarding Pilot Rollout', source: 'model' });
  assert.equal(vetProposedTitle(NO_ACTION, SUMMARY).source, 'fallback');
});

test('regeneration with no usable proposal preserves the existing good title', () => {
  const candidate = vetProposedTitle(NO_ACTION, SUMMARY);
  assert.equal(shouldReplaceTitleOnRegenerate('Onboarding Pilot Rollout', candidate), false,
    'a fallback-derived title must not overwrite an existing non-default title');
});

test('regeneration with an accepted proposal replaces the existing title', () => {
  assert.equal(shouldReplaceTitleOnRegenerate('Stale Generated Name', vetProposedTitle('Onboarding Pilot Rollout', SUMMARY)), true);
});

test('the fallback still fills an empty or placeholder title', () => {
  const candidate = vetProposedTitle(undefined, SUMMARY);
  // 'Meeting Notes' is MeetingSummaryReducer's own placeholder.
  for (const existing of ['', '   ', 'Untitled Session', 'Meeting Notes', undefined, null]) {
    assert.equal(shouldReplaceTitleOnRegenerate(existing, candidate), true,
      `a meeting with no real name must take the fallback (existing: ${JSON.stringify(existing)})`);
  }
});

test('nothing to name never replaces anything', () => {
  assert.equal(shouldReplaceTitleOnRegenerate('Onboarding Pilot Rollout', { title: null, source: 'none' }), false);
  assert.equal(shouldReplaceTitleOnRegenerate('', { title: null, source: 'none' }), false);
});

test('isDefaultMeetingTitle knows every placeholder a meeting can be carrying', () => {
  for (const t of ['', '   ', 'Untitled Session', 'untitled session', 'Meeting Notes', 'meeting notes', undefined, null]) {
    assert.equal(isDefaultMeetingTitle(t), true, `expected placeholder: ${JSON.stringify(t)}`);
  }
  for (const t of ['Onboarding Pilot Rollout', 'Meeting Notes for the Q3 Kickoff', 'Untitledly Named Sync']) {
    assert.equal(isDefaultMeetingTitle(t), false, `expected a real title: ${t}`);
  }
});

// ── Wiring (drift pins): the call sites are not unit-testable (DatabaseManager +
// MeetingContextAssembler + BrowserWindow). Naming must never be a request of its own.
test('meeting save and regenerate name the meeting from the notes call, with no title call', () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), 'electron/MeetingPersistence.ts'), 'utf8');
  assert.match(src, /const generatedTitle = vetProposedTitle\(proposedTitle, summaryData\)\.title;/);
  assert.match(src, /proposedTitle = assembled\.proposedTitle;/);
  assert.match(src, /proposedTitle = notes\.title;/);
  assert.match(src, /proposedTitle = v2Title;/);
  assert.match(src, /const regenerated = vetProposedTitle\(assembled\.proposedTitle, v3\);/);
  assert.match(src, /shouldReplaceTitleOnRegenerate\(existingTitle, regenerated\)/);
  assert.doesNotMatch(src, /action: 'title'/, 'no separate title prompt may be resolved');
  assert.doesNotMatch(src, /generateTitleFromSummary/);
});
