// The follow-up draft is written ON DEMAND (2026-09-26). It used to be written with
// every meeting's notes — one LLM call per meeting whether or not anyone wanted a
// follow-up. Now the notes save without one and offer Generate
// (MeetingPersistence.regenerateFollowUpDraft); a notes Regenerate re-drafts only a
// draft the user already asked for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = path.resolve(__dirname, '../../../dist-electron/electron/services/meeting');
const { FollowUpDraftGenerator, followUpRedraftPlan } = await import(pathToFileURL(path.join(base, 'FollowUpDraftGenerator.js')).href);

const SUMMARY = {
  title: 'Acme renewal',
  overview: 'We aligned on the renewal terms.',
  decisions: [{ id: 'd1', text: 'Renew for two years', confidence: 'high' }],
  actionItems: [],
  openQuestions: [],
  tldr: ['Renewal agreed'],
  whatChanged: [],
};

test('notes Regenerate re-drafts only when the meeting already has a draft', () => {
  assert.deepEqual(followUpRedraftPlan(undefined), { redraft: false });
  assert.deepEqual(followUpRedraftPlan(null), { redraft: false });
  assert.deepEqual(followUpRedraftPlan(''), { redraft: false });
  assert.deepEqual(followUpRedraftPlan('   \n'), { redraft: false });
  assert.deepEqual(followUpRedraftPlan({ type: 'email', body: '  ' }), { redraft: false });
  assert.deepEqual(followUpRedraftPlan({ type: 'email', subject: 'Hi' }), { redraft: false });
});

test('a re-draft keeps the tone the user last chose', () => {
  assert.deepEqual(followUpRedraftPlan({ type: 'email', body: 'Thanks all.', tone: 'warm' }), { redraft: true, tone: 'warm' });
  assert.deepEqual(followUpRedraftPlan({ type: 'email', body: 'Thanks all.', tone: 'concise' }), { redraft: true, tone: 'concise' });
});

test('a draft with no usable tone re-drafts in the mode default (tone left unset)', () => {
  // Legacy V2 rows stored the draft as a plain string: no tone at all.
  assert.deepEqual(followUpRedraftPlan('Thanks all, recap below.'), { redraft: true });
  assert.deepEqual(followUpRedraftPlan({ type: 'email', body: 'Thanks all.' }), { redraft: true });
  assert.deepEqual(followUpRedraftPlan({ type: 'email', body: 'Thanks all.', tone: 'sarcastic' }), { redraft: true });
});

test('deterministicOnly (the followUpDraftV2 kill switch) writes the template draft without an LLM call', async () => {
  let calls = 0;
  const llm = { generateMeetingSummary: async () => { calls++; return '{"subject":"x","body":"an LLM wrote this body"}'; } };
  const draft = await new FollowUpDraftGenerator(llm).generate({ summary: SUMMARY, mode: 'sales', tone: 'warm', deterministicOnly: true });
  assert.equal(calls, 0, 'the kill switch must not reach the LLM');
  assert.equal(draft.type, 'email');
  assert.equal(draft.tone, 'warm');
  assert.match(draft.body, /Renew for two years/);
  assert.doesNotMatch(draft.body, /an LLM wrote this/);
});

test('without deterministicOnly the Generate click still reaches the LLM', async () => {
  let calls = 0;
  const llm = { generateMeetingSummary: async () => { calls++; return '{"subject":"Acme renewal recap","body":"Thanks for today. We agreed to renew Acme for two years."}'; } };
  const draft = await new FollowUpDraftGenerator(llm).generate({ summary: SUMMARY, mode: 'sales' });
  assert.equal(calls, 1);
  assert.match(draft.body, /renew Acme for two years/);
});

// Drift pin: processAndSaveMeeting and regenerateSavedMeeting need a database, the
// assembler and BrowserWindow, so they are not unit-testable here. Pin the two call
// sites: the after-meeting assembler call must not ask for a draft (nor save the
// PostCallWorkflow template draft on V3 notes), and the Regenerate call asks only
// through followUpRedraftPlan.
test('meetings save without a follow-up draft; only Regenerate of a drafted meeting re-drafts (drift pin)', () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), 'electron/MeetingPersistence.ts'), 'utf8');
  const asks = src.match(/generateFollowUpDraft\s*:/g) || [];
  assert.equal(asks.length, 1, `expected exactly one generateFollowUpDraft: call-site argument, found ${asks.length}`);
  assert.match(src, /generateFollowUpDraft:\s*followUpPlan\.redraft\s*&&/);
  assert.match(src, /followUpRedraftPlan\(\(details\.detailedSummary as any\)\?\.followUpDraft\)/);
  assert.doesNotMatch(src, /followUpDraft:\s*summaryData\.followUpDraft\s*\|\|\s*postCallEnhancements\.followUpDraft/);
});
