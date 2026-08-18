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
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const { firstUsefulDeadlineMs } = await import(path.join(root, 'dist-electron/electron/llm/liveDeadlines.js'));

function serverBudget() {
  const server = fs.readFileSync(path.join(root, 'natively-api/server.js'), 'utf8');
  const m = server.match(/AI_TTFT_BUDGET_MS\s*=\s*Number\(process\.env\.AI_TTFT_BUDGET_MS\)\s*\|\|\s*([0-9_]+)/);
  assert.ok(m, 'could not read AI_TTFT_BUDGET_MS from natively-api/server.js');
  return Number(m[1].replace(/_/g, ''));
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
