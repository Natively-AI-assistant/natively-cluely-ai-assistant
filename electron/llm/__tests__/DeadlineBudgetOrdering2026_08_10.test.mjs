// electron/llm/__tests__/DeadlineBudgetOrdering2026_08_10.test.mjs
//
// The Electron client and natively-api each enforce their own first-token
// deadline, and they were INVERTED:
//
//   client  LIVE_TOTAL_HARD_TIMEOUT_MS   8_000ms
//   server  AI_TTFT_BUDGET_MS           10_000ms   (natively-api/server.js)
//
// A Natively-key user's chat goes to `${NATIVELY_API_URL}/v1/chat`
// (LLMHelper.ts:3462), where the server runs a sequential provider cascade —
// Gemini Flash -> MiniMax-M3 -> Gemini Pro — cutting over at AI_TTFT_BUDGET_MS
// when a provider is slow to first token. That cutover is the mechanism that is
// SUPPOSED to rescue a slow turn.
//
// With the client ceiling BELOW the server cutover, the client always gave up
// first: it abandoned the turn at 8s, 2s before the server would have rotated to
// a healthy provider. The user got the local fallback (or, for coding, the
// fabricated scaffold — see DeadlineTruncatedCodingNoScaffold2026_08_10) instead
// of the answer the server was about to produce.
//
// Correct ordering: the layer that can actually RECOVER (the server, which has
// another provider to try) must be allowed to act before the layer that can only
// GIVE UP (the client). This test pins that invariant so the two budgets cannot
// silently drift back out of order.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LIVE_TOTAL_HARD_TIMEOUT_MS,
  LIVE_PROVIDER_FIRST_USEFUL_HARD_TIMEOUT_MS,
  LIVE_INTER_TOKEN_STALL_MS,
} from '../../../dist-electron/electron/llm/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '../../../natively-api/server.js');

/** Read the server's default TTFT budget straight from its source. */
function serverTtftBudgetMs() {
  const src = fs.readFileSync(SERVER, 'utf8');
  const m = /const AI_TTFT_BUDGET_MS = Number\(process\.env\.AI_TTFT_BUDGET_MS\) \|\| ([0-9_]+)/.exec(src);
  assert.ok(m, 'could not read AI_TTFT_BUDGET_MS from natively-api/server.js');
  return Number(m[1].replace(/_/g, ''));
}

describe('client and server first-token deadlines are correctly ordered', () => {
  test('the client ceiling sits ABOVE the server TTFT cutover', () => {
    const server = serverTtftBudgetMs();
    assert.ok(
      LIVE_TOTAL_HARD_TIMEOUT_MS > server,
      `client ceiling ${LIVE_TOTAL_HARD_TIMEOUT_MS}ms must exceed server cutover ${server}ms — `
      + 'otherwise the client abandons the turn before the server can rotate providers',
    );
  });

  test('the margin is large enough to cover the cutover plus a rotation', () => {
    // The server needs headroom AFTER the cutover to actually start the next
    // provider and get a first token out. A margin under ~2s means the client
    // still wins the race in practice even though the ordering looks right.
    const server = serverTtftBudgetMs();
    assert.ok(
      LIVE_TOTAL_HARD_TIMEOUT_MS - server >= 2000,
      `margin is only ${LIVE_TOTAL_HARD_TIMEOUT_MS - server}ms; need >= 2000ms for the server's next leg to deliver`,
    );
  });

  test('the per-provider first-useful cap stays below the absolute ceiling', () => {
    // Pre-existing invariant: the soft per-provider cap must not exceed the hard
    // ceiling, or the ceiling would fire first and the soft cap become dead code.
    assert.ok(
      LIVE_PROVIDER_FIRST_USEFUL_HARD_TIMEOUT_MS < LIVE_TOTAL_HARD_TIMEOUT_MS,
      `first-useful cap ${LIVE_PROVIDER_FIRST_USEFUL_HARD_TIMEOUT_MS}ms must stay under ceiling ${LIVE_TOTAL_HARD_TIMEOUT_MS}ms`,
    );
  });

  test('the inter-token stall guard is unchanged by the ceiling move', () => {
    // Raising the FIRST-token ceiling must not lengthen how long a mid-stream
    // hang is tolerated — those are different failure modes.
    assert.equal(LIVE_INTER_TOKEN_STALL_MS, 8000);
  });
});
