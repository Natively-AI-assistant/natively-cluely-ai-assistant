// A question that names its own antecedent keeps its pronoun (2026-09-24).
//
// Measured live in a 118-question mock interview (tests/meeting-memory/
// live-audio): the interviewer asked "How big is your team, and what is your
// role on it?", and what-to-answer sent the model "…what is your role on
// MySQL?" — the long-range session memory recalled the candidate's MySQL→
// Postgres migration as the "project" on the table and substituted it for
// "it", although "it" is the team named earlier in the same question. The
// answer described the ledger work and never gave the team size.
//
// A demonstrative follow-up whose subject lives elsewhere ("What was your role
// in it?") must still resolve.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { resolveLiveFollowup } = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/index.js')).href);

// The run's opening, as the session memory saw it.
const turns = [
  { role: 'interviewer', text: "Hi, I'm Maya, I'm an engineering manager on the payments platform team at Northwind Pay.", t: 10 },
  { role: 'user', text: "Hi Maya, I'm Arjun. For the last three years I've worked on the ledger service at Tallyfin.", t: 40 },
  { role: 'interviewer', text: 'What was the most interesting project you worked on there?', t: 70 },
  { role: 'user', text: 'Migrating the ledger from MySQL to Postgres with zero downtime, at about twelve thousand transactions a second at peak.', t: 90 },
];
const resolve = (q) => resolveLiveFollowup({ turns, latestQuestion: q, now: 200, mode: 'interview', surface: 'what_to_answer' });

for (const q of [
  'How big is your team, and what is your role on it?',
  'Is your team and what is your role on it?', // the same question with its start clipped by STT
]) {
  test(`"${q}" keeps "it"`, () => {
    const r = resolve(q);
    assert.doesNotMatch(r.resolvedQuestion ?? q, /MySQL|Postgres/, r.resolvedQuestion);
  });
}

test('"What was your role in it?" still resolves to the project on the table', () => {
  const r = resolve('What was your role in it?');
  assert.notEqual(r.resolvedQuestion, undefined);
  assert.doesNotMatch(r.resolvedQuestion, /\bin it\?$/, r.resolvedQuestion);
});
