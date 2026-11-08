// Stepped notepad recipes (2026-10-31): "List my todos", "Write tldr" and
// "Write follow up email" on the fast model. The model lists commitments with
// the transcript words they rest on; code checks each line's ME/THEM label to
// decide whose task it is and writes the fixed shape. These tests drive the
// real compiled module with a fake chat function.
//
// Run (after `npm run build:electron`):
//   node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=natively-test-userdata \
//     --set ELECTRON_RUN_AS_NODE=1 -- electron --test <this file>
//
// Pure logic; no platform branch (the module has no OS or Electron code).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const P = await import(pathToFileURL(path.join(root, 'dist-electron/electron/llm/recipePipeline.js')).href);
const read = (p) => readFileSync(path.join(root, p), 'utf8');

// Saturday, October 31, 2026 (months are 0-based).
const SAT = new Date(2026, 9, 31);

const SALES = `NOTES (written from this meeting):
Renewal call.
Action items:
- Owen: Send weekly reports every Monday
- Kemal: Reconnect the feed

FULL TRANSCRIPT (ME is the user; THEM is everyone else):
ME: Hi. Ifeoma, thanks for making time. I've brought Kemal from our solutions team.
THEM: Thanks Owen. The resolution rate dropped and I'll need Lars to approve any price change.
ME: Understood. I'll send the extension paperwork by Wednesday.
THEM: Okay. Kemal, can you reconnect the order feed by Friday?
THEM: Yes, I'll reconnect the feed by Friday and I'll send you a report every Monday.
ME: Great. I want you to share the 200 failed conversations, Ifeoma, when you can.
THEM: Sure, I can do that.
ME: Thanks, Ifeoma. Speak soon.`;

const SALES_JSON = {
  commitments: [
    { task: 'Send the extension paperwork', owner: 'me', due: 'by Wednesday', quote: "I'll send the extension paperwork by Wednesday" },
    { task: 'Send a report every Monday', owner: 'me', due: 'every Monday', quote: "I'll send you a report every Monday" },
    { task: 'Reconnect the order feed', owner: 'Kemal', due: 'by Friday', quote: "I'll reconnect the feed by Friday" },
    { task: 'Share the 200 failed conversations', owner: 'me', due: null, quote: 'I want you to share the 200 failed conversations' },
    { task: 'Send the extension paperwork', owner: 'me', due: null, quote: "I'll send the extension paperwork" },
  ],
  followups: ['Confirm Kemal reconnects the feed by Friday', 'Send the extension paperwork to Ifeoma'],
  people: [{ name: 'Ifeoma', side: 'theirs' }, { name: 'Kemal', side: 'theirs' }, { name: 'Lars', side: 'theirs' }],
  user_names: ['Owen'],
  kind: 'meeting',
};

test('only the stepped recipes take the new path', () => {
  assert.deepEqual([...P.STEPPED_RECIPE_IDS].sort(), ['follow-up-email', 'tldr', 'todos']);
  assert.equal(P.isSteppedRecipe('todos'), true);
  assert.equal(P.isSteppedRecipe('affirm'), false);
});

test('no transcript lines means no commitments prompt (the caller falls back)', () => {
  assert.equal(P.commitmentsPrompt('NOTES:\nJust notes.'), null);
  const p = P.commitmentsPrompt(SALES);
  assert.match(p.user, /^NOTES \(for wording[^)]*take owners and quotes from the transcript only\):\nRenewal call\./, 'the notes go along for wording only');
  assert.match(p.user, /\n\nTRANSCRIPT:\nME: Hi\./);
  assert.match(p.user, /MY LINES THAT MAY HOLD A PROMISE[^\n]*\n- Understood\. I'll send the extension paperwork by Wednesday\./, 'my promise-like lines are listed for a second look');
  assert.ok(!/MY LINES[\s\S]*THEM:/.test(p.user));
});

test('a THEM line\'s own promise is never mine, even when the model says "me"', () => {
  const lines = P.transcriptLines(SALES);
  const d = P.decideOwner(lines, { task: 'Send a report every Monday', owner: 'me', due: 'every Monday', quote: "I'll send you a report every Monday" });
  assert.equal(d.mine, false);
  assert.equal(d.at.who, 'THEM');
});

test('a ME line telling someone else to do it is theirs; my own promise is mine', () => {
  const lines = P.transcriptLines(SALES);
  assert.equal(P.decideOwner(lines, { task: 'Share', owner: 'me', due: null, quote: 'I want you to share the 200 failed conversations' }).mine, false);
  assert.equal(P.decideOwner(lines, { task: 'Send', owner: 'me', due: null, quote: "I'll send the extension paperwork by Wednesday" }).mine, true);
});

test('a THEM line about the speaker\'s own work is not mine, even with no "I\'ll" in it', () => {
  const ctx = 'TRANSCRIPT SO FAR:\nME: Mei, where is Paylane?\nTHEM: About 60% there. Code complete by November 20.\nTHEM: Owen, the paperwork by Wednesday please.';
  const lines = P.transcriptLines(ctx);
  assert.equal(P.decideOwner(lines, { task: 'Finish the migration', owner: 'me', due: 'by November 20', quote: 'Code complete by November 20.' }).mine, false);
  assert.equal(P.decideOwner(lines, { task: 'Send the paperwork', owner: 'me', due: 'by Wednesday', quote: 'Owen, the paperwork by Wednesday please.' }, new Set(['owen'])).mine, true, 'spoken to by a name the others use for me');
});

test('work set for a class, said as a fact, is mine in a class only', () => {
  const ctx = 'TRANSCRIPT SO FAR:\nTHEM: Problem set 4 is due Mond ay, November 9, at the start of class.\nME: Okay.';
  const c = { task: 'Hand in problem set 4', owner: 'me', due: 'by Monday, November 9', quote: 'Problem set 4 is due Mond ay, November 9' };
  assert.equal(P.decideOwner(P.transcriptLines(ctx), c, new Set(), 'class').mine, true);
  assert.equal(P.decideOwner(P.transcriptLines(ctx), c, new Set(), 'meeting').mine, false);
});

test('a follow-up that is really my own promise moves to the to-do list', () => {
  const ctx = 'TRANSCRIPT SO FAR:\nTHEM: The sandbox is down on Sunday, November 15.\nME: Good to know. I\'ll put it in the team calendar.';
  const out = P.renderTodos({ commitments: [], followups: [{ task: 'Add the sandbox outage to the team calendar', quote: "I'll put it in the team calendar." }, { task: 'Check the sandbox is back on Monday', quote: 'The sandbox is down on Sunday' }, 'Plain string follow-up'] }, ctx, SAT);
  assert.match(out, /\*\*To do:\*\*\n\n- Add the sandbox outage to the team calendar\. No deadline was promised\./);
  assert.match(out, /\*\*Inferred:\*\*\n\n- Check the sandbox is back on Monday\.\n- Plain string follow-up\./);
});

test('work a lecturer sets for the class is mine', () => {
  const ctx = 'TRANSCRIPT SO FAR:\nTHEM: I will see you all Monday. For next Monday, read chapter six.\nME: Okay.';
  const d = P.decideOwner(P.transcriptLines(ctx), { task: 'Read chapter six', owner: 'me', due: 'next Monday', quote: 'For next Monday, read chapter six' });
  assert.equal(d.mine, true);
});

test('quotes are found through speech-recognition word splits', () => {
  const lines = P.transcriptLines('ME: I will del ete the old build tonight.');
  assert.equal(P.locateQuote(lines, 'I will delete the old build tonight').who, 'ME');
});

test('weekdays and "today" get the date counted from the meeting', () => {
  assert.equal(P.withDate('Wednesday', SAT), 'Wednesday, November 4');
  assert.equal(P.withDate('Saturday', SAT), 'Saturday, November 7', 'the same weekday means next week');
  assert.equal(P.withDate('today', SAT), 'today, October 31');
  assert.equal(P.withDate('tomorrow', SAT), 'tomorrow, November 1');
  assert.equal(P.withDate('Wednesday', null), 'Wednesday');
  assert.deepEqual(P.dueParts('next Monday', SAT), { prep: 'by', what: 'next Monday' }, '"next Monday" is ambiguous and kept as said');
  assert.equal(P.dueParts('null', SAT), null);
});

test('the due date is not said twice', () => {
  assert.equal(P.stripDueTail('Put the model in by Friday', 'by Friday'), 'Put the model in');
  assert.equal(P.todoLine({ task: 'Read chapter 6, sections 1 through 3, for next Monday', due: 'next Monday' }, false, SAT), 'Read chapter 6, sections 1 through 3 by **next Monday**.');
  assert.equal(P.todoLine({ task: 'Send the brief by Wednesday', due: 'by Wednesday' }, false, SAT), 'Send the brief by **Wednesday, November 4**.');
  assert.equal(P.todoLine({ task: 'Book the room', due: null }, false, SAT), 'Book the room. No deadline was promised.');
  assert.equal(P.todoLine({ task: 'Send the report', due: 'by Friday', owner: 'Kemal' }, true, SAT), '**Kemal:** Send the report by **Friday, November 6**.');
});

test('broken model JSON (a stray "]") is salvaged', () => {
  const broken = '```json\n{"commitments":[{"task":"Send the brief","owner":"me","due":null,"quote":"I\'ll send the brief"}]],"followups":["Check in"],"people":[{"name":"Ayesha","side":"theirs"}],"user_names":["Hugo"],"kind":"meeting"}\n```';
  const j = P.asCommitments(P.parseModelJson(broken));
  assert.equal(j.commitments.length, 1);
  assert.deepEqual(j.followups, ['Check in']);
  assert.equal(j.people[0].name, 'Ayesha');
  assert.equal(P.parseModelJson('no json here'), null);
  const tldr = P.parseModelJson('{"topic":"the renewal","bullets":["One.","Two."]]}');
  assert.equal(tldr.topic, 'the renewal');
  assert.deepEqual(tldr.bullets, ['One.', 'Two.']);
});

test('List my todos: only my tasks, dated, deduplicated, with follow-ups that add something', () => {
  const out = P.renderTodos(SALES_JSON, SALES, SAT);
  assert.match(out, /^\*\*To do:\*\*\n\n- Send the extension paperwork by \*\*Wednesday, November 4\*\*\./);
  assert.ok(!/report every Monday/.test(out), 'Kemal\'s promise is not on my list');
  assert.ok(!/200 failed/.test(out), 'the task I gave Ifeoma is not on my list');
  assert.equal(out.match(/extension paperwork/g).length, 1, 'the undated duplicate and the follow-up restating it are dropped');
  assert.match(out, /\*\*Inferred:\*\*\n\n- Confirm Kemal reconnects the feed by Friday\./);
});

test('List my todos with nothing of mine lists the others by name, or says nothing was committed', () => {
  const json = { commitments: [{ task: 'Reconnect the feed', owner: 'Kemal', due: null, quote: "I'll reconnect the feed by Friday" }] };
  assert.match(P.renderTodos(json, SALES, SAT), /- \*\*Kemal:\*\* Reconnect the feed\. No deadline was promised\./);
  assert.match(P.renderTodos({ commitments: [] }, SALES, SAT), /- Nothing has been committed to yet\./);
});

test('the facts block is checked: the user is never someone else, the notes\' owner lines are removed', () => {
  const a = P.analyseMeeting(SALES_JSON, SALES);
  assert.deepEqual([...a.userNames], ['owen']);
  assert.deepEqual(a.ours, ['Kemal'], '"Kemal from our solutions team" is my colleague whatever the model said');
  const facts = P.factsBlock(a, SAT);
  assert.match(facts, /MY OWN TASKS \(only these are mine[^)]*\): Send the extension paperwork by Wednesday, November 4\./);
  assert.match(facts, /NAMES THE OTHERS USE FOR ME: Owen/);
  const ctx = P.withoutOwnerLines(SALES);
  assert.ok(!ctx.includes('- Owen: Send weekly reports'));
  assert.ok(ctx.includes('THEM: Yes, I\'ll reconnect'), 'the transcript is kept whole');
});

test('the email greets the person I met, never my colleague or someone only talked about', () => {
  const a = P.analyseMeeting(SALES_JSON, SALES);
  assert.equal(P.emailRecipient('Lars', a, SALES), 'Ifeoma');
  assert.equal(P.emailRecipient('Kemal', a, SALES), 'Ifeoma');
  // Only my colleague is named (the customer's name was misheard): no name at all.
  const misheard = SALES.replace(/Ifeoma/g, 'Field');
  const a2 = P.analyseMeeting({ ...SALES_JSON, people: [{ name: 'Kemal', side: 'mine' }] }, misheard);
  assert.equal(P.emailRecipient('Kemal', a2, misheard), 'there');
  // Only someone talked about on their side (Lars), and my colleague spoken to: still not the colleague.
  const a4 = P.analyseMeeting({ ...SALES_JSON, people: [{ name: 'Kemal', side: 'mine' }, { name: 'Lars', side: 'theirs' }] }, misheard);
  assert.equal(P.emailRecipient(null, a4, misheard), 'there');
  // The email is told who "you" is before it is written.
  assert.match(P.emailPrompt(SALES, 'FACTS', 'there').user, /THE EMAIL GOES TO: the person I met, whose name was not caught/);
  assert.match(P.emailPrompt(SALES, 'FACTS', 'Ifeoma').user, /THE EMAIL GOES TO: Ifeoma\. "You" in the email means Ifeoma only/);
  // A one-on-one: the person I speak to gets the email, though the model listed a customer I only mention.
  const one = 'TRANSCRIPT SO FAR:\nME: Hi, Diego. Thanks for making time.\nTHEM: Sure.\nME: First, the Hendrix escalation last week. You handled it well.';
  const a5 = P.analyseMeeting({ commitments: [], people: [{ name: 'Diego', side: 'mine' }, { name: 'Hendrix', side: 'theirs' }] }, one);
  assert.equal(P.emailRecipient(null, a5, one), 'Diego');
  // A team meeting where I speak to several of my own people.
  const team = 'TRANSCRIPT SO FAR:\nME: Chris, start us off.\nTHEM: Sure.\nME: Thanks. May, you next.\nTHEM: Okay.';
  const a3 = P.analyseMeeting({ commitments: [], people: [{ name: 'Chris', side: 'mine' }, { name: 'May', side: 'mine' }] }, team);
  assert.equal(P.emailRecipient('Chris', a3, team), 'all');
});

test('the email: greeting, paragraphs, sign-off with my first name, trimmed when long', () => {
  const a = P.analyseMeeting(SALES_JSON, SALES);
  const out = P.renderEmail({ to: 'Ifeoma', subject: 'Next steps', paragraphs: ['I will send the paperwork by Wednesday.', 'Kemal will reconnect the feed.'] }, a, SALES, 'Evin John Ignatious');
  assert.equal(out, '**Subject:** Next steps\n\nHi Ifeoma,\n\nI will send the paperwork by Wednesday.\n\nKemal will reconnect the feed.\n\nThanks,\nEvin');
  const long = Array.from({ length: 6 }, (_, i) => `Sentence number ${i} has quite a few words in it to make it long enough.`).join(' ');
  const trimmed = P.renderEmail({ subject: 's', paragraphs: [long, long] }, a, SALES, null);
  assert.equal(trimmed.match(/Sentence number/g).length, 6, 'three sentences per paragraph');
  assert.match(trimmed, /\n\[Your name\]$/);
  assert.equal(P.renderEmail({ subject: 's', paragraphs: [] }, a, SALES, 'Evin'), null);
  assert.match(P.renderEmail({ to: 'Kemal', subject: 's', paragraphs: ['x.'] }, a, SALES, 'Evin', 'there'), /\nHi there,\n/, 'the recipient decided before writing wins');
});

test('the tldr names who I met, never a colleague I brought or someone only talked about', () => {
  const a = P.analyseMeeting(SALES_JSON, SALES);
  const out = P.renderTldr({ topic: 'to discuss the renewal price with Ifeoma', bullets: ['- the rate dropped.', 'We extend 90 days.', 'Extra.'] }, a, SALES);
  assert.equal(out, 'Met with Ifeoma to discuss the renewal price.\n\n- The rate dropped.\n- We extend 90 days.');
  const cls = P.analyseMeeting({ commitments: [], kind: 'class' }, SALES);
  assert.match(P.renderTldr({ topic: 'price elasticity', bullets: ['A.'] }, cls, SALES), /^Attended a class on price elasticity\./);
  assert.equal(P.renderTldr({ bullets: ['A.'] }, a, SALES), null, 'no topic: the caller falls back');
});

test('a long tldr gets one shortening call; the shorter answer is kept only when it is whole', () => {
  const long = { topic: 't', bullets: [Array.from({ length: 40 }, (_, i) => `w${i}`).join(' '), 'Short one.'] };
  const p = P.shortenTldrPrompt(long);
  assert.ok(p && /at most 26 words/.test(p.user) && /every condition or hedge/.test(p.user));
  assert.equal(P.shortenTldrPrompt({ topic: 't', bullets: ['Short.', 'Also short.'] }), null, 'no extra call when already short');
  assert.deepEqual(P.withShortBullets(long, { bullets: ['Cut.', 'Short one.'] }).bullets, ['Cut.', 'Short one.']);
  assert.equal(P.withShortBullets(long, { bullets: ['Only one.'] }), long, 'a bullet went missing: keep the original');
  assert.equal(P.withShortBullets(long, null), long);
});

test('the writing prompts keep THEM\'s "I" as theirs, ranges in words, and unclear owners unnamed', () => {
  const e = P.emailPrompt(SALES, 'FACTS', 'Ifeoma');
  const t = P.tldrPrompt(SALES, 'FACTS');
  for (const p of [e, t]) {
    assert.match(p.system, /"I" on a THEM line is that other person/);
    assert.match(p.system, /Write ranges with "to"/, 'reduceDashes turns "£60–70k" into "£60, 70k"');
  }
  assert.match(e.user, /"Someone else \(name unclear\)" is written without a name/);
});

test('the fixed English shape is only written for English answers with no added instructions', () => {
  assert.equal(P.canWriteEnglishShape('', 'auto', SALES), true);
  assert.equal(P.canWriteEnglishShape('', 'English', SALES), true);
  assert.equal(P.canWriteEnglishShape('in Spanish', 'auto', SALES), false);
  assert.equal(P.canWriteEnglishShape('', 'Spanish', SALES), false);
  const es = 'TRANSCRIPT SO FAR:\n' + Array.from({ length: 8 }, () => 'ME: Hola, vamos a revisar el contrato y luego enviamos la propuesta mañana por la tarde.').join('\n');
  assert.equal(P.canWriteEnglishShape('', 'auto', es), false);
});

const fakeChat = (answers) => {
  const calls = [];
  return { calls, chat: async (system, user) => { calls.push({ system, user }); return answers[calls.length - 1]; } };
};

test('runSteppedRecipe: todos is one call, tldr two, and a cached step 1 saves a call', async () => {
  const todo = fakeChat([JSON.stringify(SALES_JSON)]);
  const r1 = await P.runSteppedRecipe({ recipeId: 'todos', context: SALES, meetingDate: SAT, userName: 'Evin', shape: true, chat: todo.chat });
  assert.equal(todo.calls.length, 1);
  assert.match(r1.text, /^\*\*To do:\*\*/);
  const tl = fakeChat([JSON.stringify({ topic: 'the renewal', bullets: ['One.', 'Two.'] })]);
  const r2 = await P.runSteppedRecipe({ recipeId: 'tldr', context: SALES, meetingDate: SAT, userName: 'Evin', shape: true, chat: tl.chat, commitments: r1.commitments });
  assert.equal(tl.calls.length, 1, 'step 1 came from the cache');
  assert.match(tl.calls[0].user, /WHO DOES WHAT/);
  assert.match(r2.text, /^Met with Ifeoma to discuss the renewal\./);
});

test('runSteppedRecipe falls back cleanly: bad step 1, bad step 2, or a non-English shape', async () => {
  const bad = fakeChat(['not json']);
  assert.deepEqual(await P.runSteppedRecipe({ recipeId: 'todos', context: SALES, meetingDate: SAT, userName: null, shape: true, chat: bad.chat }), { text: null, facts: null, commitments: null });
  const half = fakeChat([JSON.stringify(SALES_JSON), 'still not json']);
  const r = await P.runSteppedRecipe({ recipeId: 'follow-up-email', context: SALES, meetingDate: SAT, userName: null, shape: true, chat: half.chat });
  assert.equal(r.text, null);
  assert.match(r.facts, /WHO DOES WHAT/, 'the one-prompt fallback still gets the checked list');
  const es = fakeChat([JSON.stringify(SALES_JSON)]);
  const r3 = await P.runSteppedRecipe({ recipeId: 'tldr', context: SALES, meetingDate: SAT, userName: null, shape: false, chat: es.chat });
  assert.equal(es.calls.length, 1);
  assert.equal(r3.text, null);
  assert.ok(r3.facts);
  const none = fakeChat([]);
  assert.equal((await P.runSteppedRecipe({ recipeId: 'todos', context: 'NOTES:\nonly notes', meetingDate: SAT, userName: null, shape: true, chat: none.chat })).text, null);
  assert.equal(none.calls.length, 0);
});

// ---- Round 3: voices, open points, borrowed "I", untrusted dates, email length ----

const PLAIN = `NOTES (written from this meeting):
Pitch.

FULL TRANSCRIPT (ME is the user; THEM is everyone else):
ME: placeholder`;

test('voice rows rebuild the transcript as THEM (Name) / THEM (Speaker N); no voices leaves it alone', () => {
  const rows = [
    { speaker: 'user', text: 'Thanks for the time.' },
    { speaker: 'interviewer', text: "I'll want the failure data.", speakerId: 'speaker_2' },
    { speaker: 'interviewer', text: "I'll put it in the data room.", speakerId: 'speaker_3' },
    { speaker: 'interviewer', text: 'Sounds good.' },
  ];
  const out = P.withVoiceTranscript(PLAIN, rows, { speaker_2: 'Samuel' });
  assert.match(out, /^NOTES/);
  assert.match(out, /"THEM \(Name\)" names who spoke/);
  assert.match(out, /^ME: Thanks for the time\.$/m);
  assert.match(out, /^THEM \(Samuel\): I'll want the failure data\.$/m);
  assert.match(out, /^THEM \(Speaker 3\): I'll put it in the data room\.$/m);
  assert.match(out, /^THEM: Sounds good\.$/m);
  assert.ok(!out.includes('placeholder'));
  // No voice on any row, or no transcript header (a cut context): unchanged.
  assert.equal(P.withVoiceTranscript(PLAIN, rows.map(({ speakerId, ...r }) => r), {}), PLAIN);
  assert.equal(P.withVoiceTranscript('NOTES:\nonly notes', rows, {}), 'NOTES:\nonly notes');
  assert.equal(P.withVoiceTranscript(PLAIN, null, null), PLAIN);
  // A label cannot break the line format.
  assert.match(P.withVoiceTranscript(PLAIN, rows, { speaker_2: 'Sam (VC): x' }), /^THEM \(Sam  VC   x\): /m);
});

test('the voices transcript keeps only what was said: Natively\'s answers and typed chat are left out (2026-11-01)', () => {
  const rows = [
    { speaker: 'user', text: 'Can you send the deck?', origin: 'stt' },
    { speaker: 'interviewer', text: 'Sure, by Friday.', speakerId: 'speaker_2', origin: 'stt' },
    { speaker: 'assistant', text: "You could say: I'll send the deck Friday.", origin: 'assistant' },
    { speaker: 'user', text: 'what did they ask', origin: 'manual_chat' },
    { speaker: 'natively', text: 'An old answer with no origin.' },
  ];
  const out = P.withVoiceTranscript(PLAIN, rows, { speaker_2: 'Samuel' });
  assert.match(out, /^ME: Can you send the deck\?$/m);
  assert.match(out, /^THEM \(Samuel\): Sure, by Friday\.$/m);
  assert.doesNotMatch(out, /You could say|what did they ask|old answer/);
});

test('a promise on a named voice is that voice\'s; an unnamed voice only rules out another voice\'s name', () => {
  const lines = [
    { who: 'THEM', voice: 'Samuel', text: 'What is the failure rate?' },
    { who: 'THEM', voice: 'Noah', text: "I'll put the breakdown in the data room by Friday." },
    { who: 'THEM', voice: 'Speaker 4', text: "I'll send the contract tonight." },
  ];
  const named = P.decideOwner(lines, { task: 'Breakdown', owner: 'Samuel', due: null, quote: "I'll put the breakdown in the data room" });
  assert.deepEqual([named.mine, named.owner], [false, 'Noah']);
  const ruledOut = P.decideOwner(lines, { task: 'Contract', owner: 'Noah', due: null, quote: "I'll send the contract tonight" });
  assert.deepEqual([ruledOut.mine, ruledOut.owner], [false, '']);
  const kept = P.decideOwner(lines, { task: 'Contract', owner: 'Priya', due: null, quote: "I'll send the contract tonight" });
  assert.equal(kept.owner, 'Priya');
  assert.equal(P.transcriptLines('THEM (Noah): hello there\nME: hi').at(0).voice, 'Noah');
});

test('unnamed voices are named from turn-taking only when the evidence is clear', () => {
  const lines = [
    { who: 'THEM', voice: 'Speaker 2', text: 'Noah, what is the failure rate?' },
    { who: 'THEM', voice: 'Speaker 3', text: 'About 1.4% a year.' },
    { who: 'THEM', voice: 'Speaker 2', text: 'Okay. Noah, and the chip supplier?' },
    { who: 'THEM', voice: 'Speaker 3', text: 'Single source for now.' },
  ];
  const out = P.nameVoices(lines, ['Noah Price', 'Samuel']);
  assert.deepEqual(out.map((l) => l.voice), ['Speaker 2', 'Noah', 'Speaker 2', 'Noah']);
  // One addressed turn is not enough.
  assert.deepEqual(P.nameVoices(lines.slice(0, 2), ['Noah']).map((l) => l.voice), ['Speaker 2', 'Speaker 3']);
});

test('voices are named from real speech: one clear address, never a sentence-start word, a group greeting or a sign-off', () => {
  const lines = [
    { who: 'THEM', voice: 'Speaker 1', text: 'Imogen, Noah, good to finally meet.' },
    { who: 'THEM', voice: 'Speaker 2', text: 'If that is all right.' },
    { who: 'ME', text: 'Vaccines, insulin, biologics: we watch them all.' },
    { who: 'THEM', voice: 'Speaker 1', text: 'Please do. Noah, a technical one. What if the internet goes down?' },
    { who: 'THEM', voice: 'Speaker 2', text: 'The sensors use a cellular gateway.' },
    { who: 'THEM', voice: 'Speaker 2', text: 'Battery life is three years.' },
    { who: 'ME', text: 'Thanks, Samuel. Speak soon.' },
    { who: 'THEM', voice: 'Speaker 2', text: 'Thanks for the questions.' },
  ];
  const { named } = P.nameVoicesWithMap(lines, []);
  assert.deepEqual([...named], [['Speaker 2', 'Noah']], 'one clear address names Noah; the greeting, "Vaccines" and the sign-off do not vote');
  // A name written lowercase by speech recognition still counts when the model listed the person.
  const lower = [
    { who: 'ME', text: "I'm sorry, chemo—how fast can we fix it?" },
    { who: 'THEM', voice: 'Speaker 2', text: 'About two weeks.' },
    { who: 'ME', text: 'And the policy? Chemo, does the bot have it?' },
    { who: 'THEM', voice: 'Speaker 2', text: 'A version from spring.' },
  ];
  assert.deepEqual([...P.nameVoicesWithMap(lower, ['Chemo']).named], [['Speaker 2', 'Chemo']]);
});

test('an owner the model wrote as a voice takes that voice\'s name; "Speaker 2" is never a person', () => {
  const ctx = `FULL TRANSCRIPT (ME is the user; THEM is everyone else; "THEM (Name)" names who spoke):
THEM (Speaker 1): Good to meet you and Noah at last.
ME: Likewise.
THEM (Speaker 1): Please do. Noah, a technical one.
THEM (Speaker 2): Field failure is 1.4% a year. I'll put the full breakdown in the data room by Friday.
THEM (Speaker 2): Battery life is three years.
THEM (Speaker 2): The gateway is cellular.
ME: Great, thanks.`;
  const json = { commitments: [{ task: 'Put the breakdown in the data room', owner: 'Speaker 2', due: 'by Friday', quote: "I'll put the full breakdown in the data room by Friday" }], people: [{ name: 'Speaker 2', side: 'theirs' }], kind: 'meeting' };
  const a = P.analyseMeeting(P.asCommitments(json), ctx);
  assert.equal(a.decided[0].d.mine, false);
  assert.equal(a.decided[0].d.owner, 'Noah');
  assert.match(P.commitmentsPrompt(ctx).system, /never list "Speaker 2" as a person/);
});

test('my own promise is mine whatever name the model gave it; an instruction opening my line is not', () => {
  const lines = [
    { who: 'THEM', text: 'So what happens next?' },
    { who: 'ME', text: "I'll send you a short brief by Wednesday." },
    { who: 'ME', text: "Ben, I'll need the usage numbers from you." },
    { who: 'ME', text: 'Noted. Make the deletion endpoint has a runbook before then.' },
  ];
  const mine = P.decideOwner(lines, { task: 'Brief', owner: 'Hugo', due: 'by Wednesday', quote: "I'll send you a short brief by Wednesday" });
  assert.equal(mine.mine, true);
  const handed = P.decideOwner(lines, { task: 'Usage numbers', owner: 'Ben', due: null, quote: "Ben, I'll need the usage numbers from you" });
  assert.equal(handed.mine, false);
  const instruction = P.decideOwner(lines, { task: 'Runbook', owner: 'me', due: null, quote: 'Make the deletion endpoint has a runbook before then' });
  assert.equal(instruction.mine, false);
});

test('computed dates are dropped when the transcript contradicts the meeting date', () => {
  const ctx = (line) => `FULL TRANSCRIPT (ME is the user; THEM is everyone else):\nTHEM: ${line}\nME: Thanks.`;
  // Saturday, October 31: "tomorrow, Tuesday" means a replayed or misdated recording.
  assert.equal(P.trustedMeetingDate(ctx('Oscar runs a review session tom orrow, Tuesday, at 6 PM.'), SAT), null);
  assert.equal(P.trustedMeetingDate(ctx('See you tomorrow, Sunday.'), SAT), SAT);
  assert.equal(P.trustedMeetingDate(ctx('Today is Saturday, so a short one.'), SAT), SAT);
  assert.equal(P.trustedMeetingDate(ctx('Nothing about days here.'), SAT), SAT);
  assert.equal(P.trustedMeetingDate(ctx('tomorrow, Tuesday'), null), null);
});

const ONE_ON_ONE = `FULL TRANSCRIPT (ME is the user; THEM is everyone else):
THEM: Honestly, not I worked 5 8 hours last week, including most of Saturday.
ME: 58 hours? That's the first thing we're fixing today.
ME: I'll sign the order today.`;

test('"I" statements that repeat someone else\'s words about themselves are flagged with their line', () => {
  const flagged = P.borrowedFirstPerson(['I worked 58 hours last week; backlog 340.', 'I sign the order today.'], ONE_ON_ONE);
  assert.equal(flagged.length, 1);
  assert.match(flagged[0].clause, /^I worked 58 hours/);
  assert.match(flagged[0].line, /^THEM: Honestly/);
  assert.deepEqual(P.borrowedFirstPerson(['Diego worked 58 hours.', "I'll sign the order today."], ONE_ON_ONE), []);
});

test('an open money point stated without a hedge is flagged; hedged or other figures are not', () => {
  const open = ['the $40M pre-money valuation: Samuel wants to see how it was reached first'];
  assert.deepEqual(P.openPointsStatedAsAgreed(['Ironbark wants $5M at $40M pre-money plus a board seat.'], open), open);
  assert.deepEqual(P.openPointsStatedAsAgreed(['$40M pre-money (still open); $5M if Diane checks out.'], open), []);
  assert.deepEqual(P.openPointsStatedAsAgreed(['Ironbark would want $5M of the $8M.'], open), []);
  assert.deepEqual(P.openPointsStatedAsAgreed(['Resolution fell from 61% to 48%.'], ['whether resolution recovers to 61%']), []);
});

test('the tldr fix call runs only when needed and may not rewrite the bullets', () => {
  const clean = { bullets: ['Diego worked 58 hours.', 'Two contractors approved.'] };
  assert.equal(P.fixTldrPrompt(clean, ONE_ON_ONE, []), null);
  const borrowed = { bullets: ['I worked 58 hours last week.', 'Two contractors approved.'] };
  const fix = P.fixTldrPrompt(borrowed, ONE_ON_ONE, []);
  assert.match(fix.user, /"I worked 58 hours last week\.?" comes from THEM: Honestly/);
  const fixed = P.withFixedBullets(borrowed, { bullets: ['Diego worked 58 hours last week.', 'Two contractors approved.'] });
  assert.equal(fixed.bullets[0], 'Diego worked 58 hours last week.');
  assert.equal(P.withFixedBullets(borrowed, { bullets: ['Short.', 'Two contractors approved and much more besides, written again from the start with many words.'] }), borrowed);
  assert.equal(P.withFixedBullets(borrowed, { bullets: ['One bullet only.'] }), borrowed);
});

test('open points reach step 1, the salvage and the facts block', () => {
  assert.match(P.commitmentsPrompt(SALES).system, /"open": up to four things raised but not agreed/);
  const a = P.analyseMeeting(P.asCommitments({ ...SALES_JSON, open: ['the $2,750 annual rate: Lars must approve', 7, ''] }), SALES);
  assert.deepEqual(a.open, ['the $2,750 annual rate: Lars must approve']);
  assert.match(P.factsBlock(a, SAT), /^STILL OPEN \(raised but not agreed; never write any of these as agreed or accepted, and they are not the subject[^)]*\): the \$2,750 annual rate: Lars must approve$/m);
  const salvaged = P.parseModelJson('{"commitments":[{"task":"x","owner":"me","due":null,"quote":"I\'ll do x"}]],"open":["the price"],"kind":"meeting"}');
  assert.deepEqual(salvaged.open, ['the price']);
});

test('a list closed early in model JSON is repaired', () => {
  assert.deepEqual(P.parseModelJson('{"bullets":["One."]","Two."]}'), { bullets: ['One.', 'Two.'] });
});

test('a long email body gets one shortening call, kept only when every date and figure survives', () => {
  const long = { to: 'Diego', subject: 'Next steps', paragraphs: [Array(50).fill('word').join(' ') + ' $21,760 from November 16.', Array(50).fill('word').join(' ') + ' by December 4.'] };
  const prompt = P.shortenEmailPrompt(long);
  assert.match(prompt.user, /at most 80 words together/);
  assert.equal(P.shortenEmailPrompt({ paragraphs: ['Short one.', 'Short two.'] }), null);
  const kept = P.withShortEmail(long, { paragraphs: ['Contractors at $21,760 from November 16.', 'Targets by December 4.'] });
  assert.deepEqual(kept.paragraphs, ['Contractors at $21,760 from November 16.', 'Targets by December 4.']);
  assert.equal(kept.to, 'Diego');
  assert.equal(P.withShortEmail(long, { paragraphs: ['Contractors from November 16.', 'Targets by December 4.'] }), long, 'a dropped figure keeps the original');
  assert.equal(P.withShortEmail(long, { paragraphs: ['Only one paragraph, $21,760, November 16, December 4.'] }), long);
});

test('runSteppedRecipe: a tldr stating an open point as agreed gets one fix call', async () => {
  const step1 = JSON.stringify({ ...SALES_JSON, open: ['the $2,750 annual rate: Lars must approve'] });
  const tldr = JSON.stringify({ topic: 'renewal terms', bullets: ['Resolution dropped; Kemal reconnects the feed by Friday.', 'The annual rate is $2,750 from December.'] });
  const fixed = JSON.stringify({ bullets: ['Resolution dropped; Kemal reconnects the feed by Friday.', 'The annual rate of $2,750 (still open) from December.'] });
  const c = fakeChat([step1, tldr, fixed]);
  const r = await P.runSteppedRecipe({ recipeId: 'tldr', context: SALES, meetingDate: SAT, userName: 'Owen Hart', shape: true, chat: c.chat });
  assert.equal(c.calls.length, 3);
  assert.match(c.calls[2].user, /raised but NOT agreed/);
  assert.match(r.text, /\$2,750 \(still open\)/);
});

test('note-recipe:run uses the stepped path with the meeting\'s own date and keeps the one-prompt fallback', () => {
  const src = read('electron/ipcHandlers.ts');
  const at = src.indexOf("safeHandle('note-recipe:run'");
  const body = src.slice(at, src.indexOf('safeHandle(', at + 10));
  assert.match(body, /pipeline\.isSteppedRecipe\(recipe\.id\)/);
  assert.match(body, /getMeetingTimes\(meetingId\)/);
  assert.match(body, /canWriteEnglishShape\(extraText, llmHelper\.getAiResponseLanguage/);
  assert.match(body, /recipeUserPrompt\(\{ recipe, extra: extraText, context: recipeContext \}\)/);
  assert.ok(!src.includes('note-recipe:lab'), 'the dev-only prompt lab is not shipped');
  assert.ok(!read('electron/preload.ts').includes('labNoteRecipe'));
});
