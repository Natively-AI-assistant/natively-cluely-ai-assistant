/**
 * finalize-results.mjs — recompute full summary/meta + CSVs from a (possibly
 * partial) results file. Used when a run is stopped early because the free-tier
 * Groq TPM budget is exhausted and the tail is pure empties (no new model signal).
 *
 *   node tests/intelligence/e2e/finalize-results.mjs --in=phase-1-1000 --phase=phase_1_1000
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', '..', '..', 'test-results', 'intelligence-e2e');
const args = process.argv.slice(2);
const getArg = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const IN = getArg('in', 'phase-1-1000');
const PHASE = getArg('phase', 'phase_1_1000');

const data = JSON.parse(fs.readFileSync(path.join(OUT_DIR, `${IN}-results.json`), 'utf8'));
const results = data.results.filter(Boolean);

const pctl = (s, q) => (s.length ? Math.round(s[Math.min(s.length - 1, Math.ceil((q / 100) * s.length) - 1)]) : 0);
const avg = (s) => (s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : 0);
const meanScore = (arr, k) => (arr.length ? +(arr.reduce((a, r) => a + (r[k] || 0), 0) / arr.length).toFixed(4) : 0);

const providerEmpty = results.filter((r) => r.provider_empty || r.error);
const clean = results.filter((r) => !r.provider_empty && !r.error);
const passed = clean.filter((r) => r.pass).length;
const cnt = (k) => clean.filter((r) => (r.failure_reason || '').split('; ').some((f) => f.startsWith(k))).length;
const llm = clean.filter((r) => !r.deterministic_fast_path_used);
const fu = llm.map((r) => r.first_useful_token_ms).filter((x) => x != null).sort((a, b) => a - b);
const ttft = llm.map((r) => r.tfft_ms).filter((x) => x != null).sort((a, b) => a - b);
const total = clean.map((r) => r.total_time_ms).filter((x) => x != null).sort((a, b) => a - b);
// uncontended latency = rows that did NOT hit the TPM pacer wait (total < 4s proxy)
const uncontended = llm.filter((r) => (r.total_time_ms || 0) < 4000).map((r) => r.first_useful_token_ms).filter((x) => x != null).sort((a, b) => a - b);

const band = (b) => { const set = clean.filter((r) => r.difficulty === b); return { count: set.length, pass: set.filter((r) => r.pass).length, passRate: set.length ? ((100 * set.filter((r) => r.pass).length) / set.length).toFixed(1) + '%' : 'n/a' }; };

const meta = {
  phase: PHASE, model: results.find((r) => r.model)?.model || 'meta-llama/llama-4-scout-17b-16e-instruct', provider: 'groq',
  note: data.meta?.partial ? 'Run stopped early after free-tier Groq TPM exhaustion saturated the tail with deadline-empties (no new model signal). Scored on captured clean rows.' : 'complete',
  totalRowsAttempted: results.length, clean: clean.length,
  providerUnavailable: providerEmpty.length, providerUnavailableRate: ((100 * providerEmpty.length) / results.length).toFixed(1) + '%',
  distinctQuestions: new Set(results.map((r) => r.question)).size,
  passRate: ((100 * passed) / Math.max(1, clean.length)).toFixed(1) + '%',
  passCount: passed,
  byDifficulty: { easy: band('easy'), medium: band('medium'), difficult: band('difficult') },
  scores: { accuracy: meanScore(clean, 'accuracy_score'), humanLikeness: meanScore(clean, 'human_likeness_score'), modeCorrectness: meanScore(clean, 'mode_correctness_score'), contextCorrectness: meanScore(clean, 'context_correctness_score'), formatCorrectness: meanScore(clean, 'format_correctness_score') },
  leaks: { identity: cnt('natively_identity'), falseRefusal: cnt('false_refusal'), stealth: cnt('stealth_evasion'), codingProfile: cnt('coding_profile'), forbiddenSubstring: cnt('forbidden_substring'), contextLeak: cnt('context_leak'), invented: cnt('invented_link'), hallucinated: cnt('hallucinated_source'), safetyNotRouted: cnt('safety_not_routed') },
  latency: {
    firstUseful: { avg: avg(fu), p50: pctl(fu, 50), p75: pctl(fu, 75), p90: pctl(fu, 90), p95: pctl(fu, 95), p99: pctl(fu, 99), max: fu[fu.length - 1] || 0 },
    firstUsefulUncontended: { count: uncontended.length, avg: avg(uncontended), p50: pctl(uncontended, 50), p95: pctl(uncontended, 95) },
    ttft: { avg: avg(ttft), p50: pctl(ttft, 50), p95: pctl(ttft, 95), p99: pctl(ttft, 99) },
    total: { avg: avg(total), p95: pctl(total, 95), p99: pctl(total, 99), max: total[total.length - 1] || 0 },
  },
  fastPath: clean.filter((r) => r.deterministic_fast_path_used).length,
  tenSecPlus: clean.filter((r) => (r.total_time_ms || 0) >= 10000).length,
  deadlineEvents: results.filter((r) => r.deadline_event).length,
};

fs.writeFileSync(path.join(OUT_DIR, `${IN}-results.json`), JSON.stringify({ meta, results }, null, 2));
const latCsv = ['id,mode,surface,difficulty,answerType,fastPath,ttft_ms,first_useful_ms,total_ms,chars,pass'];
for (const r of results) latCsv.push(`${r.id},${r.mode},${r.surface},${r.difficulty},${r.answer_type},${r.deterministic_fast_path_used},${Math.round(r.tfft_ms || 0)},${Math.round(r.first_useful_token_ms || 0)},${Math.round(r.total_time_ms || 0)},${r.chars || 0},${r.pass}`);
fs.writeFileSync(path.join(OUT_DIR, 'latency-report.csv'), latCsv.join('\n') + '\n');
fs.writeFileSync(path.join(OUT_DIR, 'tfft-report.csv'), ['id,mode,tfft_ms,first_useful_ms'].concat(results.map((r) => `${r.id},${r.mode},${Math.round(r.tfft_ms || 0)},${Math.round(r.first_useful_token_ms || 0)}`)).join('\n') + '\n');

// summary md
const L = []; const W = (s = '') => L.push(s);
W(`# ${PHASE} — Real-Backend Eval (Groq scout) — FINAL`); W();
W(`- Model: **${meta.model}** · provider: groq`);
W(`- ${meta.note}`); W();
W(`- Rows attempted ${meta.totalRowsAttempted} · clean (scored) ${meta.clean} · provider-unavailable ${meta.providerUnavailable} (${meta.providerUnavailableRate})`);
W(`- **Pass ${meta.passRate}** (${meta.passCount}/${meta.clean} clean) · ${meta.distinctQuestions} distinct prompts`); W();
W('## Difficulty bands'); W('| band | count | pass | pass% |'); W('|---|---:|---:|---:|');
for (const b of ['easy', 'medium', 'difficult']) W(`| ${b} | ${meta.byDifficulty[b].count} | ${meta.byDifficulty[b].pass} | ${meta.byDifficulty[b].passRate} |`); W();
W('## Scores (mean, clean rows)'); W('| metric | mean |'); W('|---|---:|');
for (const [k, v] of Object.entries(meta.scores)) W(`| ${k} | ${v} |`); W();
W('## Critical leak/safety counts (clean rows)'); W('| check | count |'); W('|---|---:|');
for (const [k, v] of Object.entries(meta.leaks)) W(`| ${k} | ${v} |`); W();
W('## Latency (ms)'); W('| metric | TTFT | first-useful | total |'); W('|---|---:|---:|---:|');
W(`| avg | ${meta.latency.ttft.avg} | ${meta.latency.firstUseful.avg} | ${meta.latency.total.avg} |`);
W(`| p50 | ${meta.latency.ttft.p50} | ${meta.latency.firstUseful.p50} | - |`);
W(`| p95 | ${meta.latency.ttft.p95} | ${meta.latency.firstUseful.p95} | ${meta.latency.total.p95} |`);
W(`| p99 | ${meta.latency.ttft.p99} | ${meta.latency.firstUseful.p99} | ${meta.latency.total.p99} |`); W();
W(`- **Uncontended first-useful** (rows under 4s, i.e. not TPM-paced): n=${meta.latency.firstUsefulUncontended.count}, avg ${meta.latency.firstUsefulUncontended.avg}ms, p50 ${meta.latency.firstUsefulUncontended.p50}ms, p95 ${meta.latency.firstUsefulUncontended.p95}ms`);
W(`- fast-path (no LLM): ${meta.fastPath} · 10s+ answers: ${meta.tenSecPlus} · deadline events: ${meta.deadlineEvents}`); W();
const byMode = {};
for (const r of clean) { byMode[r.mode] = byMode[r.mode] || { t: 0, p: 0 }; byMode[r.mode].t++; if (r.pass) byMode[r.mode].p++; }
W('## By mode (clean)'); W('| mode | pass | total | pass% |'); W('|---|---:|---:|---:|');
for (const [m, v] of Object.entries(byMode)) W(`| ${m} | ${v.p} | ${v.t} | ${((100 * v.p) / v.t).toFixed(0)}% |`); W();
const bySurface = {};
for (const r of clean) { bySurface[r.surface] = bySurface[r.surface] || { t: 0, p: 0 }; bySurface[r.surface].t++; if (r.pass) bySurface[r.surface].p++; }
W('## By surface (clean)'); W('| surface | pass | total | pass% |'); W('|---|---:|---:|---:|');
for (const [s, v] of Object.entries(bySurface)) W(`| ${s} | ${v.p} | ${v.t} | ${((100 * v.p) / v.t).toFixed(0)}% |`); W();
fs.writeFileSync(path.join(OUT_DIR, `${IN}-summary.md`), L.join('\n') + '\n');

console.log(`[finalize] clean ${meta.clean}/${meta.totalRowsAttempted} · pass ${meta.passRate} · empties ${meta.providerUnavailable} (${meta.providerUnavailableRate})`);
console.log(`[finalize] difficulty easy ${meta.byDifficulty.easy.passRate} med ${meta.byDifficulty.medium.passRate} hard ${meta.byDifficulty.difficult.passRate}`);
console.log(`[finalize] scores acc ${meta.scores.accuracy} human ${meta.scores.humanLikeness} mode ${meta.scores.modeCorrectness} ctx ${meta.scores.contextCorrectness}`);
console.log(`[finalize] leaks identity ${meta.leaks.identity} codingProfile ${meta.leaks.codingProfile} forbidden ${meta.leaks.forbiddenSubstring} refusal ${meta.leaks.falseRefusal} ctx ${meta.leaks.contextLeak} safety ${meta.leaks.safetyNotRouted}`);
console.log(`[finalize] latency uncontended first-useful p50 ${meta.latency.firstUsefulUncontended.p50}ms p95 ${meta.latency.firstUsefulUncontended.p95}ms (n=${meta.latency.firstUsefulUncontended.count})`);
