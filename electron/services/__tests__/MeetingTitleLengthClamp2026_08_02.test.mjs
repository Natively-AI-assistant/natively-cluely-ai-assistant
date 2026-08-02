// MeetingTitleLengthClamp2026_08_02
//
// The meeting title is the only summary field with no downstream validator and
// the most UI surface (history rows, email subjects). Prompt-side length rules
// are advisory: a model that answers the transcript instead of naming it lands
// verbatim in the DB. Two real rows observed on 2026-08-02:
//
//   197 chars  "I'm Natively, an AI assistant developed by Evin John. I help you ..."
//    60 chars  "A third-party GraphQL client is a separate tool, service, or"
//
// cleanMeetingTitle is the deterministic shape guard. It is prompt-agnostic on
// purpose — it must hold whichever prompt system produced the text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = path.resolve(__dirname, '../../../dist-electron/electron/services/meeting');
const load = (name) => import(pathToFileURL(path.join(base, name)).href);

const { cleanMeetingTitle, MEETING_TITLE_MAX_WORDS, MEETING_TITLE_MAX_CHARS } = await load('MeetingSummaryV3.js');

const wordsOf = (s) => s.split(' ').filter(Boolean).length;

// ── Good titles pass through untouched ───────────────────────────────────────

test('a well-formed title is returned unchanged', () => {
  for (const t of [
    'Q3 Roadmap Planning',
    'Natively Demo & Guide',
    'Billing Migration Kickoff',
    'Weekly Sync: Growth and Platform',
    'Sync with Dr. Patel',              // an abbreviation period must not cut it
    '1:1 with Priya',
  ]) {
    assert.equal(cleanMeetingTitle(t), t, `changed: ${t}`);
  }
});

test('a title at exactly the word cap is not clamped', () => {
  const t = 'One Two Three Four Five Six Seven Eight';
  assert.equal(wordsOf(t), MEETING_TITLE_MAX_WORDS);
  assert.equal(cleanMeetingTitle(t), t);
});

// ── The two observed production failures ─────────────────────────────────────

test('clamps the assistant self-introduction that shipped as a title', () => {
  const out = cleanMeetingTitle(
    "I'm Natively, an AI assistant developed by Evin John. I help you understand conversations, " +
    'respond in your own voice, and answer questions across a range of topics. What would you like to focus on?'
  );
  assert.ok(wordsOf(out) <= MEETING_TITLE_MAX_WORDS, `too many words: ${out}`);
  assert.ok(out.length <= MEETING_TITLE_MAX_CHARS, `too long: ${out.length}`);
  assert.ok(!out.includes('respond in your own voice'), 'kept a later sentence');
});

test('clamps a truncated prose answer and drops the dangling connective', () => {
  const out = cleanMeetingTitle('A third-party GraphQL client is a separate tool, service, or');
  assert.ok(wordsOf(out) <= MEETING_TITLE_MAX_WORDS, `too many words: ${out}`);
  assert.ok(!/[,;:]$/.test(out), `trailing punctuation: ${out}`);
  assert.ok(!/\bor$/i.test(out), `dangling connective: ${out}`);
});

// ── Spoken-answer furniture must never reach the title ───────────────────────

test('drops a [[GIST]] chip line', () => {
  assert.equal(cleanMeetingTitle('Billing Migration Kickoff\n[[GIST]] team agreed to defer'), 'Billing Migration Kickoff');
  assert.equal(cleanMeetingTitle('Billing Migration Kickoff [[GIST]] deferred again'), 'Billing Migration Kickoff');
});

test('strips markdown emphasis, fences, headings and wrapping quotes', () => {
  assert.equal(cleanMeetingTitle('**Billing Migration Kickoff**'), 'Billing Migration Kickoff');
  // Single-asterisk italics too — the old call-site strip was /["*]/g and must
  // not lose coverage here.
  assert.equal(cleanMeetingTitle('*Billing Migration Kickoff*'), 'Billing Migration Kickoff');
  assert.equal(cleanMeetingTitle('Billing *Migration* Kickoff'), 'Billing Migration Kickoff');
  assert.equal(cleanMeetingTitle('"Billing Migration Kickoff"'), 'Billing Migration Kickoff');
  assert.equal(cleanMeetingTitle('“Billing Migration Kickoff”'), 'Billing Migration Kickoff');
  assert.equal(cleanMeetingTitle('## Billing Migration Kickoff'), 'Billing Migration Kickoff');
  assert.equal(cleanMeetingTitle('```\nBilling Migration Kickoff\n```'), 'Billing Migration Kickoff');
});

test('strips a conversational preamble label', () => {
  for (const t of [
    'Title: Billing Migration Kickoff',
    'Meeting title: Billing Migration Kickoff',
    "Here's the title: Billing Migration Kickoff",
    'Here is a title - Billing Migration Kickoff',
    'Suggested title: Billing Migration Kickoff',
  ]) {
    assert.equal(cleanMeetingTitle(t), 'Billing Migration Kickoff', `failed: ${t}`);
  }
});

test('keeps only the first line when the model explains itself below', () => {
  const out = cleanMeetingTitle('Billing Migration Kickoff\n\nThis title captures the main decision of the call.');
  assert.equal(out, 'Billing Migration Kickoff');
});

test('a leading blank line does not produce an empty title', () => {
  assert.equal(cleanMeetingTitle('\n\n  Billing Migration Kickoff\n'), 'Billing Migration Kickoff');
});

// ── Invariants that must hold for arbitrary model output ─────────────────────

test('output never exceeds either cap, for any input', () => {
  const inputs = [
    'word '.repeat(400),
    'A'.repeat(500),
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.',
    'The team met to review the Q3 roadmap, agreed to defer the billing migration until October, and assigned follow-ups to Priya and Sam.',
  ];
  for (const input of inputs) {
    const out = cleanMeetingTitle(input);
    assert.ok(wordsOf(out) <= MEETING_TITLE_MAX_WORDS, `words: ${out}`);
    assert.ok(out.length <= MEETING_TITLE_MAX_CHARS, `chars ${out.length}: ${out}`);
    assert.ok(!/\s$/.test(out), 'trailing whitespace');
  }
});

test('a single unbroken over-long token is still cut to the char cap', () => {
  const out = cleanMeetingTitle('A'.repeat(300));
  assert.ok(out.length <= MEETING_TITLE_MAX_CHARS, `chars: ${out.length}`);
  assert.ok(out.length > 0, 'must not empty out');
});

test('empty and non-string input yield an empty string, never a crash', () => {
  for (const v of ['', '   ', '\n', null, undefined, 0, {}, [], NaN]) {
    assert.equal(typeof cleanMeetingTitle(v), 'string');
  }
  assert.equal(cleanMeetingTitle(''), '');
  assert.equal(cleanMeetingTitle('   '), '');
  assert.equal(cleanMeetingTitle(null), '');
  assert.equal(cleanMeetingTitle('[[GIST]] only a chip'), '');
});

test('is idempotent', () => {
  for (const t of [
    "I'm Natively, an AI assistant developed by Evin John. I help you understand conversations.",
    '**Title: Billing Migration Kickoff**',
    'Q3 Roadmap Planning',
  ]) {
    const once = cleanMeetingTitle(t);
    assert.equal(cleanMeetingTitle(once), once, `not idempotent: ${t}`);
  }
});

// ── Parity with the call-site strip this replaced (/["*]/g) ──────────────────

test('removes interior double quotes rather than leaving an unbalanced pair', () => {
  assert.equal(cleanMeetingTitle('Review of "Project Falcon"'), 'Review of Project Falcon');
  assert.equal(cleanMeetingTitle('"Project Falcon" Kickoff'), 'Project Falcon Kickoff');
  assert.equal(cleanMeetingTitle('Retro on “Project Falcon” Launch'), 'Retro on Project Falcon Launch');
  for (const t of ['Review of "Project Falcon"', '"Project Falcon" Kickoff']) {
    assert.ok(!cleanMeetingTitle(t).includes('"'), `left a quote: ${t}`);
  }
});

test('an apostrophe inside a word survives', () => {
  assert.equal(cleanMeetingTitle("Sam's 1:1"), "Sam's 1:1");
  assert.equal(cleanMeetingTitle("Q3 Planning — Priya's Team"), "Q3 Planning — Priya's Team");
});

// ── The dangling-word trim must never touch text we did not truncate ─────────

test('a short title that genuinely ends in a preposition is left alone', () => {
  for (const t of ['Sync On', 'Standup: Catch Up', 'Handover To QA', 'What We Ship In']) {
    assert.equal(cleanMeetingTitle(t), t, `trimmed a real word from: ${t}`);
  }
});

test('caps are exported as numbers so callers cannot drift from them', () => {
  assert.equal(typeof MEETING_TITLE_MAX_WORDS, 'number');
  assert.equal(typeof MEETING_TITLE_MAX_CHARS, 'number');
  assert.ok(MEETING_TITLE_MAX_WORDS >= 6, 'must leave headroom over the 3-6 word prompt contract');
});
