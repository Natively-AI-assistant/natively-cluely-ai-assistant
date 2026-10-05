// Auto Answer's operational-telemetry rows survive the REAL server allowlist.
//
// A row natively-api refuses is not merely lost: its id comes back in
// `rejected_ids` and the outbox drops it permanently as a poison row. So the
// rows AutoAnswerUsageTelemetry builds go through the real UsageOutbox (the
// exact wire payload) and then through natively-api's validateAuditBatch — the
// real module, not a copy of what it was believed to do.
//
// SEPARATE FILE for the same reason as UsageTelemetryEmission.test.mjs: the
// outbox bundle inlines its own DatabaseManager singleton, and node:test
// isolates files, not describes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const DIST = path.join(REPO, 'dist-electron/electron');
const DBM_PATH = path.join(DIST, 'db/DatabaseManager.js');
const HAVE_BUILD = fs.existsSync(DBM_PATH);

/**
 * natively-api is a submodule. A linked worktree usually has it empty, so fall
 * back to the main checkout beside the shared git dir.
 */
function schemaPath() {
  const candidates = [path.join(REPO, 'natively-api/lib/usageAuditSchema.js')];
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: REPO, encoding: 'utf8' }).trim();
    candidates.push(path.join(path.dirname(common), 'natively-api/lib/usageAuditSchema.js'));
  } catch { /* not a git checkout */ }
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

let TDIR; let TDB;
before(() => {
  if (!HAVE_BUILD) return;
  TDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-aa-usage-test-'));
  process.env.NATIVELY_TEST_USERDATA = TDIR;
  delete process.env.NATIVELY_USAGE_OUTBOX_ENABLED;
  const { DatabaseManager } = require(DBM_PATH);
  DatabaseManager.instance = null;
  TDB = DatabaseManager.getInstance();
});
after(() => {
  try { TDB?.close?.(); } catch { /* ignore */ }
  try { fs.rmSync(TDIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

function emitted() {
  const rows = TDB.claimUsageOutboxBatch(1000, Date.now() + 10 ** 12);
  if (rows.length) TDB.dropUsageEvents(rows.map((r) => r.event_id));
  return rows.map((r) => r.payload);
}

test('every Auto Answer row is accepted by the server, on the telemetry layer', { skip: HAVE_BUILD ? false : 'run `npm run build:electron` first' }, async (t) => {
  const schema = schemaPath();
  // t.skip, not a bare return: a bare return is a pass that asserted nothing.
  if (!schema) return t.skip('natively-api is not checked out');
  const { validateAuditBatch } = await import(pathToFileURL(schema).href);
  const { usageOutbox } = require(path.join(DIST, 'services/UsageOutbox.js'));
  const { AutoAnswerUsageTelemetry } = require(path.join(DIST, 'intelligence/autoAnswer/AutoAnswerUsageTelemetry.js'));
  emitted();

  let clock = 1_000_000;
  const models = [
    { provider: 'natively', model: 'natively' },
    { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' },
    { provider: 'ollama', model: 'qwen3:8b' },
    { provider: 'custom' },
    // Hostile: prose where identifiers belong.
    { provider: 'a provider with spaces', model: 'x'.repeat(300) },
  ];
  const modes = ['looking-for-work', 'custom:team-meet', null, 'a mode name with spaces', 'lecture'];
  let i = 0;
  const usage = new AutoAnswerUsageTelemetry({
    sink: (row) => usageOutbox.recordTelemetry(row),
    mode: () => modes[i % modes.length],
    answerModel: () => models[i % models.length],
    now: () => clock,
  });

  const ev = (name, over = {}) => usage.observe({ name, meetingGeneration: 1, ...over });
  usage.meetingStarted();
  for (i = 0; i < models.length; i++) {
    const id = `1-q${i}`;
    ev('auto_answer_candidate', { questionId: id, candidateWordCount: 9, endpointSource: 'quiet_window' });
    clock += 700;
    ev('auto_answer_judged', { questionId: id, judgeOutcome: 'verdict', judgeMs: 700, judgeIsAsk: true, judgeDirectedAtUser: true, dialogueAct: 'technical_question', answerability: 0.873 });
    ev('auto_answer_decision', { questionId: id, action: 'auto', answerability: 0.873 });
    clock += 1300;
    if (i % 2 === 0) usage.answerShown();
    if (i === 1) ev('auto_answer_feedback', { questionId: id, feedback: 'superseded', feedbackMs: 4200 });
    if (i === 2) ev('auto_answer_feedback', { questionId: id, feedback: 'kept' });
  }
  ev('auto_answer_candidate', { questionId: '1-q9' });
  ev('auto_answer_judged', { questionId: '1-q9', judgeOutcome: 'timeout', judgeMs: 2500 });
  ev('auto_answer_ignored', { questionId: '1-q9', skipReason: 'low_answerability' });
  ev('auto_answer_candidate', { questionId: '1-q10' });
  ev('auto_answer_judged', { questionId: '1-q10', judgeOutcome: 'unparseable', judgeMs: 900 });
  // A meeting left open for more than a day: the duration is omitted, never refused.
  clock += 90_000_000;
  usage.meetingEnded();

  const payloads = emitted();
  assert.equal(payloads.length, models.length + 1, `one row per answer plus the meeting row, got ${payloads.length}`);
  const result = validateAuditBatch({ events: payloads });
  assert.equal(result.ok, true, `the batch itself was refused: ${result.error}`);
  assert.deepEqual(
    result.rejected.map((r) => ({ id: r.event_id, why: r.errors ?? r.error })),
    [],
    'the server refused a row this client sends; the outbox would drop it as poison',
  );
  assert.equal(result.accepted.length, payloads.length);
  assert.ok(result.accepted.every((e) => e.layer === 'telemetry'), 'the 45-day diagnostics table, never the 8-year ledger');
  assert.ok(result.accepted.every((e) => e.feature === 'meeting_copilot'));

  const meetingRow = result.accepted.find((e) => e.metadata?.op === 'auto_answer_meeting');
  assert.equal(meetingRow.reported_count, models.length + 2);
  assert.equal(meetingRow.reported_duration_ms, null, 'over 24 h: omitted');
  assert.deepEqual(
    { answered: meetingRow.metadata.answered, silent: meetingRow.metadata.silent, timeouts: meetingRow.metadata.judge_timeouts, errors: meetingRow.metadata.judge_errors, kept: meetingRow.metadata.kept, superseded: meetingRow.metadata.superseded },
    { answered: 5, silent: 1, timeouts: 1, errors: 1, kept: 1, superseded: 1 },
  );
  const answerRows = result.accepted.filter((e) => e.metadata?.op === 'auto_answer');
  const noProvider = answerRows.filter((e) => e.provider === null);
  assert.equal(noProvider.length, 1, 'the prose provider was dropped, and its row still went');
  assert.equal(noProvider[0].model, null, 'and so was the 300-char model');
  assert.equal(answerRows.filter((e) => e.metadata.mode === 'none').length, 2, 'no mode, and a mode label with spaces, both read none');
  assert.equal(answerRows.find((e) => e.provider === 'custom').model, null, "a custom provider's config id is never sent");
});
