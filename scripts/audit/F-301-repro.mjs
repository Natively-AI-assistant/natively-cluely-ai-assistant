// F-301 repro: the manual-chat first-useful deadline sat BELOW natively-api's
// provider-rotation budget, so the client tore down the HTTP request 3s before
// the server could rescue the turn.
//
// natively-api runs a SEQUENTIAL cascade and cuts over to the next provider at
// AI_TTFT_BUDGET_MS (10s, server.js). The client aborted at the 7s provider cap
// (firstUsefulDeadlineMs), killing the socket at t=7s — so at t=10s there was
// nothing left to rescue and the user saw "The model did not produce an answer
// in time". LIVE_TOTAL_HARD_TIMEOUT_MS (13000) documents exactly this ordering
// invariant, but had only ever been applied to the WTA path — never to manual
// chat, which is the path its own rationale describes.
//
// Reads AI_TTFT_BUDGET_MS out of natively-api/server.js so the two cannot drift.
//
// Expected (correct): manual-chat deadline on the server route > server budget.
// Bug (F-301): 7000 < 10000 → exit 1.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const { firstUsefulDeadlineMs } = await import(path.join(root, 'dist-electron/electron/llm/liveDeadlines.js'));

const server = fs.readFileSync(path.join(root, 'natively-api/server.js'), 'utf8');
const m = server.match(/AI_TTFT_BUDGET_MS\s*=\s*Number\(process\.env\.AI_TTFT_BUDGET_MS\)\s*\|\|\s*([0-9_]+)/);
if (!m) { console.error('[F-301] Inconclusive: could not read AI_TTFT_BUDGET_MS from server.js'); process.exit(2); }
const serverBudget = Number(m[1].replace(/_/g, ''));

const onServerRoute = firstUsefulDeadlineMs('general_meeting_answer', false, true);
const codingOnServerRoute = firstUsefulDeadlineMs('coding_answer', false, true);
const directProvider = firstUsefulDeadlineMs('general_meeting_answer', false, false);
const local = firstUsefulDeadlineMs('general_meeting_answer', true, false);

console.log('[F-301] server AI_TTFT_BUDGET_MS:', serverBudget);
console.log('[F-301] manual-chat deadline  — server route:', onServerRoute, '| direct provider:', directProvider, '| local:', local);

let bad = false;
if (!(onServerRoute > serverBudget)) {
  console.error(`[F-301] FAIL: manual chat abandons at ${onServerRoute}ms, at or before the server's ${serverBudget}ms rotation — the client gives up on a turn the server would have rescued (F-301 reproduced).`);
  bad = true;
}
if (!(codingOnServerRoute > serverBudget)) {
  console.error(`[F-301] FAIL: coding answers on the server route abandon at ${codingOnServerRoute}ms.`);
  bad = true;
}
// Guard the other routes: no server cascade exists there, so they must NOT be
// silently stretched (that would only make users wait longer for a failure).
if (directProvider !== 7000) { console.error(`[F-301] FAIL: direct-provider deadline changed to ${directProvider} (expected 7000).`); bad = true; }
if (local !== 30000) { console.error(`[F-301] FAIL: local deadline changed to ${local} (expected 30000).`); bad = true; }

if (bad) process.exit(1);
console.log('[F-301] PASS: the client outlives the server rotation on the cascade route, and the direct/local routes are unchanged.');
process.exit(0);
