/**
 * CR-05 live verification with REAL DeepSeek API calls.
 *
 * F-301 raised the first-useful deadline on the natively-api route because the
 * SERVER runs a sequential cascade and only cuts over to the next provider at
 * AI_TTFT_BUDGET_MS (10s) — aborting at the 7s provider cap tears the HTTP
 * request down BEFORE that rescue. F-301 fixed one of two call sites; the
 * phone-mirror path still passed NEITHER route flag, so it kept the 7s cap.
 *
 * What is real here: the tokens are streamed live from deepseek-v4-flash, and
 * the deadline machinery under test is the app's real raceStreamWithDeadline.
 * What is modelled: the ~10s silence before the first token, which is what a
 * server-side cascade cutover looks like to this client. That gap is the
 * variable CR-05 is about, so it is set explicitly rather than hoping a
 * provider happens to stall for exactly that long.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = '/tmp/natively-land-wt';
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
const KEY = env.DEEPSEEK_API_KEY;
if (!KEY) { console.error('DEEPSEEK_API_KEY missing from .env — stopping (campaign rule: do not substitute a provider).'); process.exit(2); }

const dl = await import(pathToFileURL(path.join(root, 'dist-electron/electron/llm/liveDeadlines.js')).href);
const { raceStreamWithDeadline, firstUsefulDeadlineMs,
        LIVE_TOTAL_HARD_TIMEOUT_MS, LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS,
        LIVE_PROVIDER_FIRST_USEFUL_HARD_TIMEOUT_MS } = dl;

const CASCADE_CUTOVER_MS = 10_000;   // natively-api AI_TTFT_BUDGET_MS

/** Real streaming call to DeepSeek; yields only assistant CONTENT tokens. */
async function* deepseekStream(prompt) {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-v4-flash', stream: true, max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`);
  const reader = res.body.getReader(); const dec = new TextDecoder();
  let buf = '', finish = null, sawContent = false;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const d = line.slice(5).trim(); if (d === '[DONE]') continue;
      const ch = JSON.parse(d)?.choices?.[0];
      if (ch?.finish_reason) finish = ch.finish_reason;
      const c = ch?.delta?.content;
      if (c) { sawContent = true; yield c; }
    }
  }
  // Guard against the vacuous-green trap hit earlier in this campaign: this
  // model emits reasoning_content first, and a small max_tokens budget can be
  // consumed entirely by reasoning, yielding ZERO content and a false "the
  // deadline aborted it" reading.
  if (!sawContent) throw new Error(`DeepSeek produced NO content tokens (finish_reason=${finish}) — the probe would be vacuous`);
}

/** Withhold the real stream's first token until `delayMs`, modelling the cascade cutover. */
async function* delayedFirstToken(inner, delayMs) {
  const started = Date.now();
  let first = true;
  for await (const tok of inner) {
    if (first) {
      const wait = delayMs - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      first = false;
    }
    yield tok;
  }
}

const PROMPT = 'In two sentences, explain why randomized quicksort is expected O(n log n).';

async function runAt(deadlineMs, label) {
  let full = '';
  const t0 = Date.now();
  const outcome = await raceStreamWithDeadline({
    stream: delayedFirstToken(deepseekStream(PROMPT), CASCADE_CUTOVER_MS),
    firstUsefulDeadlineMs: deadlineMs,
    isUsefulYet: () => full.trim().length >= 5,   // same predicate as the phone handler
    onToken: (t) => { full += t; },
  });
  const ms = Date.now() - t0;
  const delivered = full.trim().length > 0;
  console.log(`  ${label.padEnd(34)} deadline=${String(deadlineMs).padStart(5)}ms  ${String(ms).padStart(6)}ms  ${delivered ? `DELIVERED (${full.trim().length} chars)` : 'NO ANSWER'}  outcome=${outcome}`);
  return { delivered, full, ms };
}

console.log('deadlines the phone path resolves to:');
const preFix  = firstUsefulDeadlineMs('general_meeting_answer');                 // both flags defaulted — the bug
const cascade = firstUsefulDeadlineMs('general_meeting_answer', false, true);
const local   = firstUsefulDeadlineMs('general_meeting_answer', true, false);
console.log(`  no flags (pre-fix): ${preFix}   cascade: ${cascade}   local: ${local}\n`);

console.log(`real DeepSeek stream, first token withheld to ${CASCADE_CUTOVER_MS}ms (cascade cutover):`);
const a = await runAt(preFix,  'pre-fix phone (no flags)');
const b = await runAt(cascade, 'post-fix, viaServerCascade');
const c = await runAt(local,   'post-fix, local model');

const checks = [
  ['pre-fix 7s deadline LOSES the turn',            a.delivered === false],
  ['cascade deadline DELIVERS the real answer',     b.delivered === true],
  ['local deadline DELIVERS the real answer',       c.delivered === true],
  ['cascade budget outlasts the 10s cutover',       cascade > CASCADE_CUTOVER_MS],
  ['pre-fix budget aborts BEFORE the cutover',      preFix < CASCADE_CUTOVER_MS],
  ['the delivered text is genuinely from DeepSeek', /quick|pivot|partition|log/i.test(b.full)],
];
let bad = 0;
console.log('');
for (const [l, ok] of checks) { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}`); }
console.log(bad === 0
  ? '\nCR-05 verified with real DeepSeek calls: the phone path now outlives the cascade cutover.'
  : `\n${bad} check(s) failed`);
process.exit(bad === 0 ? 0 : 1);
