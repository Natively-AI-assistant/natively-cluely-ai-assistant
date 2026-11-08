// The 2026-10-15 re-check of "the answer is replaced after it streams" (Looking for work and Technical Interview,
// 140 benchmark questions on the Natively API, claim pass off). Nothing was rewritten by a model any more, but four
// shown answers still differed from what streamed, all from deterministic edits of the FINAL text only:
//
//   * the perspective repair flipped a "you" that was the interviewer or the user being coached:
//       "understand the range you've set"   → "the range I've set"
//       "how you're persisting the state"    → "how I'm persisting"
//       "describe what you're actually doing" → "what I'm actually doing"
//   * the meta-preamble strip cut a real opening sentence: "This is Problem 2, merging overlapping bookings."
//
// And with every drafted Cue Card accepted unread, the drafts beat the user's own notes on why they are leaving and on
// their weakness (3 of 30 Looking for work questions), because a draft was served as "the user's own answer".
//
// Run under plain Node the store block skips (the SQLite binding is built for Electron); run it for real with
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/llm/__tests__/AnswerChangedAfterStream2026_10_15.test.mjs

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = (p) => path.join(root, 'dist-electron/electron', p);

const { sanitizeCandidateAnswer } = require(dist('llm/ProfileOutputValidator.js'));
const { stripMetaPreamble, cleanAnswerArtifacts } = require(dist('llm/answerPolish.js'));
const own = require(dist('services/knowledge/ownAnswers.js'));
const port = require(dist('context-intelligence/retrieval/profile-retrieval-port.js'));
const composer = require(dist('context-intelligence/generation/prompt-composer.js'));

describe('the perspective repair flips only a sentence about the candidate', () => {
  for (const keep of [
    "For me the main thing at this point is to understand the range you've set for the role, so I can see where I land.",
    'I would ask how the presence layer handles awareness and how you\'re persisting the document state between sessions.',
    "The evidence doesn't state your current role, so I can't describe what you're actually doing day to day.",
    // Agreeing with the interviewer, seen in the offline re-check of 420 recorded answers.
    "You're right, that was my mistake on the spot. It should be the width of the tier, not its upper bound.",
  ]) {
    test(`left as streamed: "${keep.slice(0, 50)}…"`, () => {
      const r = sanitizeCandidateAnswer(keep);
      assert.equal(r.text, keep);
    });
  }
  for (const [input, want] of [
    ['You have roughly 0.4 years of experience.', /^I have roughly 0\.4 years/],
    ["You're a strong fit: you have the SQL and dashboarding the role needs.", /^I'm a strong fit: I have the SQL/],
    ['Your experience includes backend work at Acme.', /^My experience includes/],
    ['"You\'ve built a search engine and you led the team."', /I've built .* I led the team/],
  ]) {
    test(`still flipped: "${input.slice(0, 40)}…"`, () => {
      assert.match(sanitizeCandidateAnswer(input).text, want);
    });
  }
});

describe('the final cleanup keeps an opening sentence that is part of the answer', () => {
  const BODY = 'Sort by start, then sweep and extend the current interval whenever the next start is less than or equal to the running end.';
  for (const opener of [
    'This is Problem 2, merging overlapping bookings.',
    'This is a classic sliding-window problem.',
    'The question is a good one, and the short answer is no.',
    'The question is whether we shard or scale up.',
  ]) {
    test(`kept: "${opener}"`, () => {
      const text = `${opener} ${BODY}`;
      assert.equal(stripMetaPreamble(text), text);
      assert.ok(cleanAnswerArtifacts(text).startsWith(opener));
    });
  }
  for (const meta of [
    'The question is asking whether I have run this at scale.',
    'This question asks how I would merge the bookings.',
    'The interviewer is asking about merging intervals.',
    'No question was actually asked.',
  ]) {
    test(`still removed: "${meta}"`, () => {
      assert.equal(stripMetaPreamble(`${meta} ${BODY}`), BODY);
    });
  }
});

describe('an accepted draft is marked, and gives way to the user\'s own notes', () => {
  const rows = [
    { key: 'weakness', text: 'I hold on to the critical path.', status: 'saved', origin: 'user' },
    { key: 'why_leaving', text: 'I want a different scale of systems.', status: 'saved', origin: 'drafted' },
    { key: 'strength', text: 'Not approved yet.', status: 'draft', origin: 'drafted' },
    { key: 'conflict', text: 'Saved before the origin column existed.', status: 'saved' },
  ];
  test('served answers carry where they came from; a draft not yet accepted is still never served', () => {
    const served = own.servedOwnAnswers(rows);
    assert.deepEqual(served.map((a) => [a.key, a.origin]), [['weakness', 'user'], ['why_leaving', 'drafted'], ['conflict', 'user']]);
  });
  test('the evidence says which entry is an accepted draft', () => {
    const structured = { ownAnswers: own.servedOwnAnswers(rows) };
    const sections = port.renderProfileSections('fact', structured);
    const by = Object.fromEntries(sections.map((s) => [s.section, s.text]));
    assert.match(by['Own answer: Biggest weakness'], /The user's own answer, in their words: I hold on/);
    assert.match(by['Own answer: Why you left, or are leaving, your last job'], /suggested answer drafted from the résumé, which the user accepted without changing it: I want/);
    assert.doesNotMatch(by['Own answer: Why you left, or are leaving, your last job'], /in their words/);
    const whole = port.ownAnswersWholeText(structured);
    assert.match(whole, /Why you left[^\n]*\[A suggested answer drafted from the résumé, which the user accepted without changing it\]:\nI want/);
    assert.doesNotMatch(whole, /Biggest weakness[^\n]*\[A suggested/);
  });
  test('the notice adds the rule only when an accepted draft is in the evidence', () => {
    const fact = (text) => `<evidence source_type="PROFILE_FACT">${text}</evidence>`;
    const drafted = composer.ownAnswersNotice(fact('Why you left. A suggested answer drafted from the résumé, which the user accepted without changing it: …'));
    assert.match(drafted, /When anything else the user wrote covers the same question \(their notes or files, source_type="REFERENCE_FILE"\), answer from that and leave the suggestion out entirely/);
    assert.match(drafted, /what ONE entry in the user's own words is headed for, that entry is the answer/);
    const typed = composer.ownAnswersNotice(fact("Biggest weakness. The user's own answer, in their words: …"));
    assert.ok(typed.length > 0);
    assert.doesNotMatch(typed, /suggested answer drafted/);
    // With no accepted draft the notice is word for word what it was (the 2026-10-14 measurements stand).
    assert.match(typed, /When the question asks about what ONE entry is headed for, that entry is the answer/);
    assert.equal(composer.ownAnswersNotice('<evidence source_type="RESUME">…</evidence>'), '');
  });
});

describe('the store records whether the words are the user\'s (needs the Electron SQLite binding)', () => {
  const DB_PATH = dist('db/DatabaseManager.js');
  let dbMgr; let store; let tmp;
  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'own-answers-origin-'));
    process.env.NATIVELY_TEST_USERDATA = tmp;
    try { delete require.cache[DB_PATH]; } catch {}
    dbMgr = require(DB_PATH).DatabaseManager.getInstance();
    store = require(dist('services/knowledge/OwnAnswersStore.js'));
  });
  after(() => {
    try { dbMgr?.close?.(); } catch {}
    delete process.env.NATIVELY_TEST_USERDATA;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  });
  beforeEach(() => { if (dbMgr.isAvailable()) store.wipeOwnAnswers(); });
  const origins = () => Object.fromEntries(store.listOwnAnswers().map((r) => [r.key, `${r.status}/${r.origin}`]));

  test('the migration added the column', (t) => {
    if (!dbMgr.isAvailable()) return t.skip('SQLite binding is built for Electron');
    assert.ok(dbMgr.getDb().pragma('user_version', { simple: true }) >= 33);
    const cols = dbMgr.getDb().prepare("PRAGMA table_info('profile_own_answers')").all().map((c) => c.name);
    assert.ok(cols.includes('origin'));
  });
  test('Use, or saving the draft unchanged, keeps it a draft the user accepted; any edit makes it theirs', (t) => {
    if (!dbMgr.isAvailable()) return t.skip('SQLite binding is built for Electron');
    store.storeOwnAnswerDrafts({ weakness: 'Drafted weakness.', strength: 'Drafted strength.', why_field: 'Drafted field.' });
    assert.deepEqual(origins(), { weakness: 'draft/drafted', strength: 'draft/drafted', why_field: 'draft/drafted' });
    store.useOwnAnswerDrafts(['weakness']);
    store.saveOwnAnswer('strength', '  Drafted strength.  ');
    store.saveOwnAnswer('why_field', 'Drafted field, and my own reason.');
    store.saveOwnAnswer('conflict', 'Typed from nothing.');
    assert.deepEqual(origins(), { weakness: 'saved/drafted', strength: 'saved/drafted', why_field: 'saved/user', conflict: 'saved/user' });
  });
  test('a new draft run never touches what the user saved, and its drafts are drafts', (t) => {
    if (!dbMgr.isAvailable()) return t.skip('SQLite binding is built for Electron');
    store.saveOwnAnswer('weakness', 'Mine.');
    store.storeOwnAnswerDrafts({ weakness: 'Another draft.', strength: 'A draft.' });
    assert.deepEqual(origins(), { weakness: 'saved/user', strength: 'draft/drafted' });
  });
});
