// F-301 regression test (audit/autopilot-2026-08-18).
//
// natively-api runs a SEQUENTIAL provider cascade and cuts over to the next
// provider at AI_TTFT_BUDGET_MS (10s). The manual-chat handler used
// firstUsefulDeadlineMs() = 7000 and aborted the HTTP request at 7s, so the
// server's rotation — the only thing that can actually RESCUE a slow turn —
// had nothing left to deliver into, and the user saw "The model did not
// produce an answer in time" on a recoverable turn.
//
// LIVE_TOTAL_HARD_TIMEOUT_MS (13000) documents this exact ordering invariant
// and its rationale is written in terms of manual chat, but it had only ever
// been applied to the WTA path. DeadlineBudgetOrdering2026_08_10 pins the
// constant; this pins the DEADLINE THE MANUAL-CHAT HANDLER ACTUALLY USES.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const { firstUsefulDeadlineMs } = await import(pathToFileURL(path.join(root, 'dist-electron/electron/llm/liveDeadlines.js')).href);

// The server's rotation budget, read from natively-api/server.js when that tree
// is available so real drift is caught, and falling back to the DOCUMENTED value
// when it is not.
//
// `natively-api` is an UNDESCRIBED gitlink — .gitmodules only describes
// `premium` — so CI never checks it out and readFileSync threw there. That made
// this test fail on a machine where the invariant was perfectly fine, while
// passing locally where the directory is present. The fallback keeps the real
// assertion (`deadline > budget`) running everywhere rather than skipping it,
// so this cannot degrade into a vacuous pass.
const DOCUMENTED_AI_TTFT_BUDGET_MS = 10_000;

function serverBudget() {
  const serverPath = path.join(root, 'natively-api/server.js');
  let server;
  try {
    server = fs.readFileSync(serverPath, 'utf8');
  } catch {
    return DOCUMENTED_AI_TTFT_BUDGET_MS;
  }
  const m = server.match(/AI_TTFT_BUDGET_MS\s*=\s*Number\(process\.env\.AI_TTFT_BUDGET_MS\)\s*\|\|\s*([0-9_]+)/);
  assert.ok(m, 'could not read AI_TTFT_BUDGET_MS from natively-api/server.js');
  const parsed = Number(m[1].replace(/_/g, ''));
  // If the server tree IS present, its value is authoritative — and a drift from
  // the documented constant is exactly what this test should surface.
  assert.equal(parsed, DOCUMENTED_AI_TTFT_BUDGET_MS,
    `natively-api's AI_TTFT_BUDGET_MS is ${parsed}ms but this test documents ${DOCUMENTED_AI_TTFT_BUDGET_MS}ms — `
    + 'update the constant here (and re-check the client deadline) rather than letting the two drift');
  return parsed;
}

test('manual chat outlives the server provider rotation on the cascade route', () => {
  const budget = serverBudget();
  for (const answerType of ['general_meeting_answer', 'coding_answer', 'lecture_answer']) {
    const deadline = firstUsefulDeadlineMs(answerType, false, true);
    assert.ok(deadline > budget,
      `${answerType}: client deadline ${deadline}ms must exceed the server's ${budget}ms rotation, or the client kills a turn the server would have rescued (F-301)`);
  }
});

test('routes with no server cascade keep their original budgets', () => {
  // Stretching these would only make users wait longer for a failure that has
  // no rescue path behind it.
  assert.equal(firstUsefulDeadlineMs('general_meeting_answer', false, false), 7000);
  assert.equal(firstUsefulDeadlineMs('coding_answer', false, false), 7000);
  assert.equal(firstUsefulDeadlineMs('general_meeting_answer', true, false), 30000);
});

test('the manual-chat call site passes the server-cascade flag', () => {
  const src = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
  assert.ok(/firstUsefulDeadlineMs\(answerPlan\.answerType,\s*usingLocalLlm,\s*viaServerCascade\)/.test(src),
    'the manual-chat handler must pass viaServerCascade into firstUsefulDeadlineMs (F-301)');
  assert.ok(/isUsingNativelyServerCascade\?\.\(\)/.test(src),
    'viaServerCascade must be derived from the LLMHelper route predicate');
});

// ── CR-05 (code-review, 2026-08-21) ──────────────────────────────────────────
// F-301 fixed ONE of the two firstUsefulDeadlineMs call sites. The phone-mirror
// chat path passed NEITHER route flag, so it always took the 7s cloud cap —
// aborting 3s before the server's rotation on the cascade route, and giving a
// cold-loading local model 7s instead of 30s. F-301's rationale is
// surface-agnostic; the phone is a live streaming surface with the same server
// behind it.
//
// Verified end-to-end with REAL DeepSeek streams in
// scripts/audit/CR-05-phone-deadline-live.mjs: with the first token withheld to
// the 10s cutover, the 7s deadline aborts at 7001ms with NO answer while the
// 13s cascade deadline delivers 252 real characters at 10002ms.
test('the phone-mirror call site passes BOTH route flags', () => {
  const src = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
  // Strip comments before matching: a previous fix in this campaign moved a
  // source-anchored test's target by writing the searched-for text INTO a
  // comment. Anchor on real code only.
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  assert.ok(
    /firstUsefulDeadlineMs\(\s*'general_meeting_answer'\s*,\s*phoneUsingLocalLlm\s*,\s*phoneViaServerCascade\s*\)/.test(codeOnly),
    'the phone-mirror handler must pass isLocal AND viaServerCascade into firstUsefulDeadlineMs (CR-05)',
  );
  assert.ok(
    /phoneViaServerCascade\s*=\s*llmHelper\.isUsingNativelyServerCascade\?\.\(\)\s*===\s*true/.test(codeOnly),
    'phone viaServerCascade must come from the same LLMHelper route predicate as manual chat',
  );
  assert.ok(
    /phoneUsingLocalLlm\s*=\s*llmHelper\.isUsingOllama\(\)\s*\|\|\s*llmHelper\.isUsingCodexCli\(\)/.test(codeOnly),
    'phone isLocal must be derived the same way as manual chat, or a cold local load aborts at 7s',
  );

  // The defect itself: a flagless call on the phone path.
  assert.ok(
    !/firstUsefulDeadlineMs\(\s*'general_meeting_answer'\s*\)/.test(codeOnly),
    'no call site may take the flagless 7s default for a live streaming surface (CR-05)',
  );
});

test('the phone deadline actually exceeds the server rotation budget', () => {
  const budget = serverBudget();
  // What the phone path resolves to on each route, post-fix.
  assert.ok(firstUsefulDeadlineMs('general_meeting_answer', false, true) > budget,
    'cascade route: the phone must outlive the rotation that would rescue the turn');
  assert.equal(firstUsefulDeadlineMs('general_meeting_answer', true, false), 30000,
    'local route: a cold-loading model needs the long budget on the phone path too');
  // And the pre-fix value is on the wrong side of the cutover — this is the bug.
  assert.ok(firstUsefulDeadlineMs('general_meeting_answer') < budget,
    'the flagless default aborts BEFORE the cutover, which is why it lost the turn');
});
