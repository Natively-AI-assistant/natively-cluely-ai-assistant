// Auto Answer reaches Pro operational telemetry.
//
// 2026-09-27: every Auto Answer decision was already a structured event, but
// the only sink that ran was TelemetryService's local JSONL file (its remote
// sinks need build-time keys a packaged app lacks). Whether Auto Answer fires,
// whether the user keeps the answer and how long the first word takes existed
// on users' disks and nowhere else. AutoAnswerUsageTelemetry turns the same
// events into one row per automatic answer and one per meeting for the usage
// outbox. These tests drive the REAL engine through a scripted meeting.
//
// The server-allowlist half is AutoAnswerUsageAllowlist2026_09_27.test.mjs
// (electron/services/__tests__): it needs the outbox's SQLite singleton.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { FakeClock } from './fakeClock.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REPO = path.resolve(__dirname, '../../../..');
const DIST = path.join(REPO, 'dist-electron/electron/intelligence/autoAnswer');
const { SimpleAutoAnswerEngine, FEEDBACK_WINDOW_MS } = require(path.join(DIST, 'SimpleAutoAnswer.js'));
const { AutoAnswerUsageTelemetry } = require(path.join(DIST, 'AutoAnswerUsageTelemetry.js'));

const flush = () => new Promise((r) => setImmediate(r));
const verdict = (over) => JSON.stringify({ is_ask: true, directed_at_user: true, complete: true, act: 'question', action: 'answer', answerability: 0.9, question_text: null, ...over });
const SILENT = verdict({ is_ask: false, directed_at_user: false, act: 'statement', action: 'silent', answerability: 0.1 });
const NEVER = () => new Promise(() => {});

/** The real engine, its telemetry hook piped into the usage aggregator the way main.ts pipes it. */
function meeting(replies, { mode = 'team-meet', model = { provider: 'natively', model: 'natively' } } = {}) {
  const clock = new FakeClock();
  const rows = [];
  let n = 0;
  let ids = 0;
  const usage = new AutoAnswerUsageTelemetry({
    sink: (row) => rows.push(row),
    mode: () => mode,
    answerModel: () => model,
    now: () => clock.now(),
    newId: () => `meeting-${++ids}`,
  });
  const host = {
    isEnabled: () => true, isMeetingActive: () => true, meetingGeneration: () => 1, engineAccepting: () => true,
    recentTurns: () => [], dispatch: () => {},
    judgeCandidate: async (req, signal) => {
      const r = replies[n++] ?? SILENT;
      return typeof r === 'function' ? r(req, signal) : r;
    },
    telemetry: (e) => usage.observe(e),
    log: () => {},
  };
  const engine = new SimpleAutoAnswerEngine(host, clock);
  usage.meetingStarted();
  engine.onMeetingStart();
  const wait = async (ms) => { for (let t = 0; t < ms; t += 20) { clock.advance(20); await flush(); } };
  const say = async (text, ms = 4000) => {
    engine.ingest({ speaker: 'interviewer', text, final: true, timestamp: clock.now(), origin: 'stt', punctuationSource: 'provider' });
    await wait(ms);
  };
  return { rows, usage, engine, clock, say, wait };
}

const answers = (rows) => rows.filter((r) => r.metadata.op === 'auto_answer');
const meetings = (rows) => rows.filter((r) => r.metadata.op === 'auto_answer_meeting');

test('an answer the user keeps: one row with judge time, first-word time and "kept"', async () => {
  const m = meeting([verdict()]);
  await m.say('How would you shard the orders table once it outgrows one node?', 0);
  await m.wait(3000);
  m.usage.answerShown();              // the first word reaches the overlay
  m.usage.answerShown();              // later tokens change nothing
  await m.wait(FEEDBACK_WINDOW_MS + 100);

  const [row, ...rest] = answers(m.rows);
  assert.equal(rest.length, 0);
  assert.equal(row.event_type, 'feature_completed');
  assert.equal(row.event_status, 'completed', 'a word showed');
  assert.equal(row.feature, 'meeting_copilot', 'Auto Answer is the live meeting feature in every mode');
  assert.equal(row.feature_session_id, 'meeting-1');
  assert.equal(row.provider, 'natively');
  assert.equal(row.metadata.feedback, 'kept');
  assert.equal(row.metadata.mode, 'team-meet');
  assert.equal(row.metadata.act, 'general_question', "the judge's act, as the engine normalised it");
  assert.equal(row.metadata.answerability, 0.9);
  assert.equal(typeof row.metadata.judge_ms, 'number');
  // From the candidate forming (after the quiet window) to the first word.
  assert.ok(row.metadata.first_token_ms > 0 && row.metadata.first_token_ms <= 3000, `first word measured from the candidate, got ${row.metadata.first_token_ms}`);
  assert.equal(row.metadata.feedback_ms, undefined, 'only an override has a feedback time');
  assert.ok(Object.keys(row.metadata).length <= 8, 'a 9th key makes the server drop the event');
});

test('an answer the user overrides: "superseded", and the manual answer\'s words are not its first word', async () => {
  const m = meeting([verdict()]);
  await m.say('Walk me through how you would debug a memory leak in production.', 0);
  await m.wait(900);
  m.usage.stopAwaitingAnswer();       // main.onManualWhatToAnswer, before the engine hears it
  m.engine.onManualAnswerStarted();
  m.usage.answerShown();              // the MANUAL answer's first token

  const [row] = answers(m.rows);
  assert.equal(row.metadata.feedback, 'superseded');
  assert.equal(typeof row.metadata.feedback_ms, 'number');
  assert.equal(row.metadata.first_token_ms, undefined, 'no measured first word: the key is absent, never 0');
  assert.equal(row.event_status, 'interrupted', 'nothing of the automatic answer showed');
});

test('the meeting row counts candidates, answers, silences and judge failures', async () => {
  const m = meeting([verdict(), SILENT, NEVER, 'not json at all']);
  await m.say('What is the difference between a process and a thread?');
  m.usage.answerShown();
  await m.say('Great, that makes sense, thanks for walking through it.');
  await m.say('Let me pull up the roadmap document for everyone here', 8000);   // judge never answers
  await m.say('Okay so the next item on the agenda is the launch plan');        // unparseable verdict
  m.engine.onMeetingStop();
  m.usage.meetingEnded();

  const [row] = meetings(m.rows);
  assert.ok(row, 'one meeting row');
  assert.equal(row.feature_session_id, 'meeting-1', 'joins the meeting\'s answer rows');
  // 5, not 4: after an unparseable verdict the engine re-judges at the next
  // stoppage (lastJudgedKey is cleared), and that retry is a candidate too.
  assert.equal(row.reported_count, 5, 'candidates judged');
  assert.equal(typeof row.reported_duration_ms, 'number');
  assert.equal(row.metadata.answered, 1);
  assert.equal(row.metadata.silent, 2, 'the thanks, and the retried agenda remark');
  assert.equal(row.metadata.judge_timeouts, 1);
  assert.equal(row.metadata.judge_errors, 1);
  assert.ok(Object.keys(row.metadata).length <= 8);
  // The answer never got feedback before the meeting ended: sent unresolved, not lost.
  const [answer] = answers(m.rows);
  assert.equal(answer.metadata.feedback, 'unresolved');
  assert.equal(answer.event_status, 'completed');
});

test('a second answer inside the feedback window does not lose the first', async () => {
  const m = meeting([verdict(), verdict()]);
  await m.say('How do you decide between SQL and NoSQL for a new service?');
  m.usage.answerShown();
  await m.say('And how would you migrate if you picked wrong?');
  m.usage.answerShown();
  m.usage.meetingEnded();
  const rows = answers(m.rows);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.metadata.feedback), ['unresolved', 'unresolved']);
});

test('a meeting with no candidates sends nothing; the next meeting gets a new id', async () => {
  const m = meeting([verdict()]);
  m.usage.meetingEnded();
  assert.deepEqual(m.rows, []);
  m.usage.meetingStarted();
  await m.say('What would you change about your last project?');
  m.usage.meetingEnded();
  assert.ok(m.rows.every((r) => r.feature_session_id === 'meeting-2'));
});

test('nothing that is not an identifier leaves: a mode or model with spaces is dropped, not sent', async () => {
  const m = meeting([verdict()], { mode: 'My interview mode', model: { provider: 'natively', model: 'a model with spaces' } });
  await m.say('Why do you want to leave your current role?');
  m.usage.meetingEnded();
  const [row] = answers(m.rows);
  assert.equal(row.metadata.mode, 'none');
  assert.equal(row.model, undefined);
  assert.equal(row.provider, 'natively');
});

test('main.ts wires it: engine events, first word, discard, manual answer, meeting bounds, the opt-out', () => {
  const main = fs.readFileSync(path.join(REPO, 'electron/main.ts'), 'utf8');
  assert.match(main, /this\.autoAnswerUsage\.observe\(event\)/, 'every engine telemetry event is observed');
  assert.match(main, /queueBatch\('suggested_answer', \{ token, question, confidence, generationId \}\);\s*this\.autoAnswerUsage\.answerShown\(\);/, 'the first streamed token');
  assert.match(main, /flushBatchesBeforeFinal\(\);\s*this\.autoAnswerUsage\.answerShown\(\);/, 'an answer that arrives whole');
  assert.match(main, /'suggested_answer_discard'[\s\S]{0,80}this\.autoAnswerUsage\.stopAwaitingAnswer\(\)/);
  assert.match(main, /onManualWhatToAnswer\(\): void \{[\s\S]{0,160}this\.autoAnswerUsage\.stopAwaitingAnswer\(\);\s*this\.simpleAutoAnswer\.onManualAnswerStarted\(\);/,
    'stop waiting BEFORE the engine emits the override');
  assert.match(main, /this\.isMeetingActive = true;\s*this\.autoAnswerUsage\.meetingStarted\(\);/);
  assert.match(main, /this\.cancelAutoAnswer\(\);\s*this\.autoAnswerUsage\.meetingEnded\(\);/);
  assert.match(main, /get\('telemetryEnabled'\) === false\) return;\s*const \{ usageOutbox \}[^\n]*\n\s*usageOutbox\.recordTelemetry\(row\)/,
    'the telemetry opt-out is honoured, and rows go to the telemetry layer, never the ledger');
  assert.doesNotMatch(main, /mode: \(\) => [\s\S]{0,200}\.name\b/, "the user's mode NAME never becomes a label");
});
