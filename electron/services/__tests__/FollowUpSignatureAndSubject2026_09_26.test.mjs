// Follow-up draft: the sender's name under the sign-off, and subjects a person would
// write (2026-09-26). The name is the Google account connected for Calendar sync;
// the old subject prompt's own example ("Follow-up: Acme Q3 renewal kickoff") taught
// the model to label every subject and pile nouns after the colon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = path.resolve(__dirname, '../../../dist-electron/electron/services/meeting');
const { FollowUpDraftGenerator, cleanSenderName, signatureName, tidySubject, finishSignature } = await import(pathToFileURL(path.join(base, 'FollowUpDraftGenerator.js')).href);

const SUMMARY = {
  title: 'David Sun case handover',
  overview: 'Walked through the David Sun case before the handover to the new team.',
  tldr: ['The David Sun case moves to the new team next week'],
  decisions: [{ id: 'd1', text: 'Hand the David Sun case to the new team on Monday', confidence: 'high' }],
  actionItems: [],
  openQuestions: [],
  whatChanged: [],
};

/** A fake LLM that records every system prompt it is sent (generateStructured's 1st arg). */
function recordingLLM(reply) {
  const prompts = [];
  return {
    prompts,
    generateMeetingSummary: async (system) => { prompts.push(system); return reply; },
  };
}
const OK_REPLY = '{"subject":"Handing over the David Sun case","body":"Hi there,\\n\\nThanks for going through the David Sun case today.\\n\\nBest regards,\\nEvin John"}';

test('cleanSenderName keeps real names and drops anything that is not one', () => {
  assert.equal(cleanSenderName('Evin John'), 'Evin John');
  assert.equal(cleanSenderName('  Evin \n  John  '), 'Evin John');
  assert.equal(cleanSenderName("Siobhán O'Brien"), "Siobhán O'Brien");
  assert.equal(cleanSenderName('王小明'), '王小明');
  assert.equal(cleanSenderName('"Evin" <evin@example.com>'), undefined, 'an email address is never signed');
  assert.equal(cleanSenderName('x'.repeat(81)), undefined);
  assert.equal(cleanSenderName('12345'), undefined);
  assert.equal(cleanSenderName(''), undefined);
  assert.equal(cleanSenderName(undefined), undefined);
  assert.equal(cleanSenderName({ name: 'Evin' }), undefined);
});

test('signatureName: full name outward, first name to colleagues, none on a study recap', () => {
  assert.equal(signatureName('Evin John', 'sales'), 'Evin John');
  assert.equal(signatureName('Evin John', 'recruiting'), 'Evin John');
  assert.equal(signatureName('Evin John', 'looking-for-work'), 'Evin John');
  assert.equal(signatureName('Evin John', 'general'), 'Evin');
  assert.equal(signatureName('Evin John', 'team-meet'), 'Evin');
  assert.equal(signatureName('Evin John', 'technical-interview'), 'Evin');
  assert.equal(signatureName('Evin John', 'lecture'), undefined);
  assert.equal(signatureName('Evin John', 'some-custom-mode'), 'Evin', 'unknown modes use the general voice');
  assert.equal(signatureName(undefined, 'sales'), undefined);
});

test('the prompt carries the signature name only when there is one, per mode', async () => {
  const cases = [
    ['sales', 'Evin John', 'Sender: Evin John.'],
    ['general', 'Evin John', 'Sender: Evin.'],
    ['lecture', 'Evin John', null],
    ['sales', undefined, null],
  ];
  for (const [mode, senderName, expected] of cases) {
    const llm = recordingLLM(OK_REPLY);
    await new FollowUpDraftGenerator(llm).generate({ summary: SUMMARY, mode, senderName });
    const prompt = llm.prompts[0];
    assert.ok(prompt, `${mode}: no prompt captured`);
    if (expected) assert.ok(prompt.includes(expected), `${mode}/${senderName}: missing "${expected}"`);
    else assert.equal(/\bSender:/.test(prompt), false, `${mode}/${senderName}: should not carry a Sender line`);
  }
});

test('the subject prompt no longer teaches the "Follow-up: <noun pile>" shape', async () => {
  const llm = recordingLLM(OK_REPLY);
  await new FollowUpDraftGenerator(llm).generate({ summary: SUMMARY, mode: 'sales' });
  const prompt = llm.prompts[0];
  assert.equal(prompt.includes('Follow-up: Acme Q3 renewal kickoff'), false, 'the old example is gone');
  assert.match(prompt, /SUBJECT LINE/);
  assert.match(prompt, /never start with "Follow-up:"/);
  assert.match(prompt, /Not a pile of nouns/);
});

// Every mode's draft is an email-shaped message shown in the same mail card with a
// Subject header, so every mode gets a subject. Only email-type drafts used to: the
// user's own DB had 7/7 team-meeting, 16/16 interview-debrief and 1/1 lecture drafts
// with no subject, and "Regenerate notes as Team meeting" made a mail lose it.
test('every mode writes a subject, not just the email-type ones', async () => {
  for (const mode of ['team-meet', 'technical-interview', 'lecture', 'general', 'sales']) {
    const llm = recordingLLM('{"subject":"Handing over the David Sun case","body":"Hi team,\\n\\nThe David Sun case moves on Monday.\\n\\nThanks,"}');
    const draft = await new FollowUpDraftGenerator(llm).generate({ summary: SUMMARY, mode });
    assert.match(llm.prompts[0], /SUBJECT LINE/, `${mode}: prompt asks for a subject`);
    assert.equal(draft.subject, 'Handing over the David Sun case', `${mode}: model subject kept`);
    // The model leaving it out, or no LLM at all, still yields one.
    const bare = await new FollowUpDraftGenerator(recordingLLM('{"body":"Hi team,\\n\\nThe David Sun case moves on Monday."}')).generate({ summary: SUMMARY, mode });
    assert.equal(bare.subject, 'David Sun case handover', `${mode}: fallback subject when the model gave none`);
    const offline = await new FollowUpDraftGenerator(recordingLLM('')).generate({ summary: SUMMARY, mode, deterministicOnly: true });
    assert.equal(offline.subject, 'David Sun case handover', `${mode}: template draft has a subject`);
  }
});

test('tidySubject strips a label before a separator and nothing else', () => {
  assert.equal(tidySubject('Follow-up: David Sun case handover'), 'David Sun case handover');
  assert.equal(tidySubject('Re: Follow-up – pricing for the pilot'), 'Pricing for the pilot');
  assert.equal(tidySubject('Meeting recap | Q3 roadmap'), 'Q3 roadmap');
  assert.equal(tidySubject('"Where we landed on pricing."'), 'Where we landed on pricing');
  // A subject that only STARTS with the word keeps it.
  assert.equal(tidySubject('Follow-up on the Acme renewal'), 'Follow-up on the Acme renewal');
  assert.equal(tidySubject('Recap of the pilot'), 'Recap of the pilot');
  // Casing the model chose is left alone when nothing was cut…
  assert.equal(tidySubject('iPhone launch plan'), 'iPhone launch plan');
  // …except an all-lower-case first word, which gets sentence case (seen live from
  // gpt-4.1-mini: "thanks for sharing your billing rebuild experience").
  assert.equal(tidySubject('thanks for sharing your billing rebuild experience'), 'Thanks for sharing your billing rebuild experience');
});

test('finishSignature always signs a known name, and clears placeholder lines', () => {
  // Under the sign-off the model wrote.
  assert.equal(finishSignature('Hi Dana,\n\nThanks for today.\n\nBest regards,', 'Evin John', 'looking-for-work'), 'Hi Dana,\n\nThanks for today.\n\nBest regards,\nEvin John');
  // A placeholder the model wrote (seen live on the old prompt) becomes the name.
  assert.equal(finishSignature('Hi Maya,\n\nThanks.\n\nBest,\n[Interviewer Name]\n', 'Evin John', 'recruiting'), 'Hi Maya,\n\nThanks.\n\nBest,\nEvin John');
  // No sign-off at all (seen live from gemini-2.5-flash): the mode's own is added.
  assert.equal(finishSignature('Thank you, Dana, for the conversation today.', 'Evin John', 'looking-for-work'), 'Thank you, Dana, for the conversation today.\n\nBest regards,\nEvin John');
  assert.equal(finishSignature('Hi team,\n\nWe keep the starter price.', 'Evin', 'general'), 'Hi team,\n\nWe keep the starter price.\n\nBest,\nEvin');
  // Already signed: untouched.
  assert.equal(finishSignature('Thanks.\n\nBest,\nEvin', 'Evin', 'general'), 'Thanks.\n\nBest,\nEvin');
  // A study recap is never signed; placeholders still go.
  assert.equal(finishSignature('Quick recap:\nEntropy rises.\n[Your Name]', 'Evin John', 'lecture'), 'Quick recap:\nEntropy rises.');
  // No name known: nothing added, placeholder still removed.
  assert.equal(finishSignature('Thanks.\n\nBest regards,\n[Your Name]', undefined, 'sales'), 'Thanks.\n\nBest regards,');
  // A sentence that happens to end in a comma is not mistaken for a sign-off.
  assert.equal(finishSignature('We covered pricing, the SAP connector, and the rollout timeline, which all look good to go,', 'Evin John', 'sales'),
    'We covered pricing, the SAP connector, and the rollout timeline, which all look good to go,\n\nBest regards,\nEvin John');
});

test('an LLM subject with a label comes back without it', async () => {
  const llm = recordingLLM('{"subject":"Follow-up: David Sun case handover questions","body":"Hi there,\\n\\nThanks for the time on the David Sun case.\\n\\nBest regards,"}');
  const draft = await new FollowUpDraftGenerator(llm).generate({ summary: SUMMARY, mode: 'sales' });
  assert.equal(draft.subject, 'David Sun case handover questions');
});

test('the template draft is signed under its sign-off, and never on a study recap', async () => {
  const none = recordingLLM('');
  const sales = await new FollowUpDraftGenerator(none).generate({ summary: SUMMARY, mode: 'sales', senderName: 'Evin John', deterministicOnly: true });
  assert.match(sales.body, /Best regards,\nEvin John$/);
  const general = await new FollowUpDraftGenerator(none).generate({ summary: SUMMARY, mode: 'general', senderName: 'Evin John', deterministicOnly: true });
  assert.match(general.body, /Best,\nEvin$/);
  const lecture = await new FollowUpDraftGenerator(none).generate({ summary: SUMMARY, mode: 'lecture', senderName: 'Evin John', deterministicOnly: true });
  assert.equal(/Evin/.test(lecture.body), false);
  const anon = await new FollowUpDraftGenerator(none).generate({ summary: SUMMARY, mode: 'sales', deterministicOnly: true });
  assert.match(anon.body, /Best regards,$/);
  assert.equal(none.prompts.length, 0, 'deterministicOnly never reaches the LLM');
});

test('the fallback subject is the meeting name, with no "Follow-up:" label', async () => {
  const draft = await new FollowUpDraftGenerator(recordingLLM('')).generate({ summary: SUMMARY, mode: 'sales', deterministicOnly: true });
  assert.equal(draft.subject, 'David Sun case handover');
  const untitled = await new FollowUpDraftGenerator(recordingLLM('')).generate({
    summary: { title: 'Meeting Notes', overview: '', tldr: [], whatChanged: [], decisions: [], actionItems: [], openQuestions: [] },
    mode: 'general', deterministicOnly: true,
  });
  assert.equal(/^Follow-up:/.test(untitled.subject || ''), false);
});

// Drift pin: the two MeetingPersistence call sites need Electron + the DB, so pin that
// both read the sender name, and that the reader uses the account NAME, never the email.
test('both draft paths sign with the Calendar account name, never its email (drift pin)', () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), 'electron/MeetingPersistence.ts'), 'utf8');
  assert.match(src, /senderName:\s*followUpSenderName\(\)/, 'Generate / Regenerate path');
  assert.match(src, /followUpSenderName:\s*followUpPlan\.redraft \? followUpSenderName\(\) : undefined/, 'notes-Regenerate path');
  const fn = src.slice(src.indexOf('function followUpSenderName()'), src.indexOf('function buildV3DetailedSummary('));
  assert.match(fn, /getConnectionStatus\(\)/);
  assert.match(fn, /status\.name/);
  assert.doesNotMatch(fn, /status\??\.email/);
});
