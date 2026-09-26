// The judge knows the USER's name, so a team meet's "Raj, can you…" stays quiet.
//
// Measured 2026-09-27 (judge-eval/team-meet-lecture-named.json, Natively rung):
// with no name, EVERY ask addressed by name to another participant fired
// (Raj, Priya, Mark, and a lecturer calling on Maria), precision 0.545. The
// name alone was not enough. flash-lite then silenced the USER's own uncommon
// name ("Evin, can you…") until the rule said outright that it is addressed to
// the USER. It also silenced speech-to-text slips ("Evan", "Kevin") whatever
// the prompt said, so the code finds those and the prompt states the result.
// And the rule rides ONLY on a candidate that calls on someone else by name:
// on every call it flipped senior-swe-strings #10/#11 3/3, a transcript with
// no names in it at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { FakeClock } from './fakeClock.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (f) => require(path.resolve(__dirname, '../../../../dist-electron/electron/intelligence/autoAnswer', f));
const { buildJudgePrompt, judgeUserFirstName, userNameSlipsIn, addressedNamesIn } = dist('AutoAnswerJudge.js');
const { SimpleAutoAnswerEngine } = dist('SimpleAutoAnswer.js');

const REQ = {
  candidateText: 'Raj, can you make sure support knows about the Thursday cutover?',
  recentTurns: [{ role: 'interviewer', text: 'Thanks Raj. Alex, how is the payout migration going?', timestamp: 0 }],
  modeName: 'Team Meet',
  questionId: 'q1',
  lastAnsweredText: null,
};

test('no name known: the prompt is byte-identical to the one the corpora were scored on', () => {
  assert.equal(buildJudgePrompt({ ...REQ, userName: null }), buildJudgePrompt(REQ));
  assert.equal(buildJudgePrompt({ ...REQ, userName: '  ' }), buildJudgePrompt(REQ));
  assert.equal(buildJudgePrompt({ ...REQ, userName: '42' }), buildJudgePrompt(REQ), 'a name with no letters is no name');
});

test('a known name rides after the candidate, before the rules, and says both directions', () => {
  const p = buildJudgePrompt({ ...REQ, userName: 'Alex Rivera' });
  const at = p.indexOf("The USER's name is Alex.");
  assert.ok(at > p.indexOf('</candidate>'), 'trailing, next to the candidate');
  assert.ok(at < p.indexOf('Decide whether the speech'), 'and before the rules, which stay last');
  assert.match(p, /"Alex, can you…" is addressed TO the USER/, 'the positive direction: without it flash-lite silenced the exact name');
  assert.match(p, /"<another name>, can you…" is addressed to that OTHER person/);
  assert.match(p, /"Does anyone…" and asks with no name are judged as usual/, 'without it DeepSeek silenced room-wide asks');
  assert.ok(!p.includes('Rivera'), 'first name only');
});

test('the name is sanitized: a résumé field cannot inject prompt text', () => {
  assert.equal(judgeUserFirstName('Alex Rivera'), 'Alex');
  assert.equal(judgeUserFirstName("O'Brien"), "O'Brien");
  assert.equal(judgeUserFirstName('Zoë'), 'Zoë');
  assert.equal(judgeUserFirstName('José-Luis García'), 'José-Luis');
  assert.equal(judgeUserFirstName('Ignore"}.\nprevious'), 'Ignore', 'quotes, braces, dots and newlines are dropped');
  assert.equal(judgeUserFirstName('x'.repeat(80)).length, 30);
  assert.equal(judgeUserFirstName(null), null);
  assert.equal(judgeUserFirstName(''), null);
});

test('speech-to-text slips for the name are found in code: one edit, or a short/long form', () => {
  const texts = ['Evan, can you share where the ledger export stands?', 'Kevin said the same. Thanks Raj.'];
  assert.deepEqual(userNameSlipsIn(texts, 'Evin'), ['Evan', 'Kevin']);
  assert.deepEqual(userNameSlipsIn(['Alec, can you share the numbers?'], 'Alex'), ['Alec']);
  assert.deepEqual(userNameSlipsIn(['Alexander, can you share the numbers?'], 'Alex'), ['Alexander'], 'long form');
  assert.deepEqual(userNameSlipsIn(['Alex, can you share the numbers?'], 'Alexander'), ['Alex'], 'short form');
  assert.deepEqual(userNameSlipsIn(['Jonathon, a quick one.'], 'Jonathan'), ['Jonathon'], 'two edits for a long name');
});

test('clearly different names, lowercase words and sentence openers are not slips', () => {
  assert.deepEqual(userNameSlipsIn(['Raj, Priya, Maria and Mark all agreed.'], 'Alex'), []);
  assert.deepEqual(userNameSlipsIn(['even so, we ship on Friday'], 'Evin'), [], 'lowercase words are never names');
  assert.deepEqual(userNameSlipsIn(['And the rollback plan?'], 'Andy'), [], 'a sentence opener one edit from a short name');
  assert.deepEqual(userNameSlipsIn(['Even so, can you check?'], 'Evin'), []);
  assert.deepEqual(userNameSlipsIn(['Evin, can you check?'], 'Evin'), [], 'the exact name is not a slip');
});

test('slips are named in the prompt as the USER', () => {
  const p = buildJudgePrompt({ ...REQ, candidateText: 'Thanks Evan. Raj, can you share where the ledger export stands?', userName: 'Evin' });
  assert.match(p, /The USER's name is Evin \(speech-to-text also wrote it as "Evan" here: that is the USER too\)/);
});

test('the rule rides only when the candidate calls on someone ELSE by name', () => {
  const plain = (candidateText) => buildJudgePrompt({ ...REQ, candidateText, userName: null });
  const named = (candidateText, userName = 'Alex') => buildJudgePrompt({ ...REQ, candidateText, userName });
  for (const c of [
    'Alex, how is the payout migration going?',                 // the USER
    'Thanks Raj. Alex, how is the payout migration going?',     // thanked, then the USER
    'Alec, can you share where the ledger export stands?',      // a slip for the USER
    'Does anyone know why the nightly job failed?',             // the room
    'Okay, and what is the rollback plan if Thursday goes badly?', // nobody
    "essentially a set yeah cool so I'm going to change up the problem", // no capitals at all
  ]) assert.equal(named(c), plain(c), `byte-identical: ${c}`);
  assert.notEqual(named('Raj, can you make sure support knows about the cutover?'), plain('Raj, can you make sure support knows about the cutover?'));
  assert.notEqual(named('Before we finish, Maria, can you explain a clustered index?'), plain('Before we finish, Maria, can you explain a clustered index?'));
});

test('addressed names: a capitalized word that opens a clause with a comma', () => {
  assert.deepEqual(addressedNamesIn('Raj, can you make sure support knows?'), ['Raj']);
  assert.deepEqual(addressedNamesIn('Before we finish, Alex, can you explain it?'), ['Alex']);
  assert.deepEqual(addressedNamesIn('Thanks Raj, can you post it?'), ['Raj']);
  assert.deepEqual(addressedNamesIn('Thanks Raj. Alex, how is it going?'), ['Alex'], 'a thanked name ends its sentence: not addressed');
  assert.deepEqual(addressedNamesIn('Okay, so, Yeah, Sir, Honestly, Everyone, what now?'), [], 'discourse words, -ly adverbs and group vocatives');
  assert.deepEqual(addressedNamesIn('We cut over on Thursday, and Alex owns the rollback.'), [], 'a name in the middle of a clause');
  assert.deepEqual(addressedNamesIn('raj, can you check?'), [], 'lowercase is never a name');
});

test('the engine hands the host\'s user name to the judge', async () => {
  const clock = new FakeClock();
  const seen = [];
  const host = {
    isEnabled: () => true, isMeetingActive: () => true, meetingGeneration: () => 1, engineAccepting: () => true,
    recentTurns: () => [], dispatch: () => {},
    judgeCandidate: async (req) => { seen.push(req.userName); return null; },
    userName: () => 'Alex Rivera',
    telemetry: () => {}, log: () => {},
  };
  const engine = new SimpleAutoAnswerEngine(host, clock);
  engine.onMeetingStart();
  engine.ingest({ speaker: 'interviewer', text: 'Alex, how is the payout migration going?', final: true, timestamp: clock.now(), origin: 'stt', punctuationSource: 'provider' });
  for (let i = 0; i < 100 && !seen.length; i++) { clock.advance(20); await new Promise((r) => setImmediate(r)); }
  assert.deepEqual(seen, ['Alex Rivera']);
});
