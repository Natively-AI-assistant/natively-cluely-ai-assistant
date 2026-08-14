/**
 * preflight-routing.mjs — runs the REAL planAnswer classifier over the whole
 * dataset (NO API) and reports how often the routed answerType matches the row's
 * expectedAnswerType / acceptedAnswerTypes (via routeAccepted). This catches
 * dataset-label artifacts cheaply BEFORE the multi-hour live run, so route_mismatch
 * failures in the real run reflect model/answer behavior, not my labels.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REPO = path.resolve(__dirname, '..', '..', '..');
const BENCH = path.join(REPO, 'benchmarks', 'profile-intelligence');
const OUT = path.join(REPO, 'test-results', 'intelligence-e2e-7000-minimax');
const H = require(path.join(BENCH, 'harness.cjs'));
const { routeAccepted } = require(path.join(BENCH, 'routeAliases.cjs'));

const ds = JSON.parse(fs.readFileSync(path.join(OUT, 'dataset-7000.json'), 'utf8'));
const cases = ds.cases;
const h = H.createHarness({ provider: 'auto' });

let ok = 0, bad = 0;
const mismatchPairs = {};
const byMode = {};
const badExamples = [];
for (const c of cases) {
  const isWTA = c.surface === 'what_to_answer';
  const source = isWTA ? 'what_to_answer' : 'manual_input';
  const speakerPerspective = isWTA ? 'interviewer' : 'user';
  // mirror runOne's WTA question extraction so routing matches the real run
  let q = c.question;
  if (isWTA && (c.transcriptWindow || []).length) {
    const turns = c.transcriptWindow.map((t, i) => ({ role: /interviewer|speaker|professor|customer/i.test(t.speaker) ? 'interviewer' : 'candidate', text: t.text, timestamp: i * 1000 }));
    try { const ex = h.extractLatestQuestion(turns); if (ex?.latestQuestion) q = ex.latestQuestion; } catch {}
  }
  const plan = h.planAnswer({ question: q, source, speakerPerspective });
  const accepted = routeAccepted(c.expectedAnswerType, plan.answerType) || (c.acceptedAnswerTypes || []).includes(plan.answerType);
  byMode[c.mode] = byMode[c.mode] || { ok: 0, bad: 0 };
  if (accepted) { ok++; byMode[c.mode].ok++; }
  else {
    bad++; byMode[c.mode].bad++;
    const k = `${c.expectedAnswerType} -> ${plan.answerType}`;
    mismatchPairs[k] = (mismatchPairs[k] || 0) + 1;
    if (badExamples.length < 40) badExamples.push({ id: c.id, mode: c.mode, surface: c.surface, q: c.question, exp: c.expectedAnswerType, got: plan.answerType });
  }
}
h.cleanup();

console.log(`\n=== ROUTING PRE-FLIGHT (no API) ===`);
console.log(`total ${cases.length} · route-accepted ${ok} (${(100 * ok / cases.length).toFixed(1)}%) · mismatch ${bad} (${(100 * bad / cases.length).toFixed(1)}%)`);
console.log('\nby mode:');
for (const [m, v] of Object.entries(byMode)) console.log(`  ${m.padEnd(20)} ok ${v.ok} bad ${v.bad} (${(100 * v.ok / (v.ok + v.bad)).toFixed(1)}%)`);
console.log('\ntop mismatch pairs (expected -> routed):');
for (const [k, v] of Object.entries(mismatchPairs).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(v).padStart(4)}  ${k}`);
console.log('\nexamples:');
for (const e of badExamples.slice(0, 30)) console.log(`  [${e.mode}/${e.surface}] "${e.q.slice(0, 50)}" exp ${e.exp} got ${e.got}`);
