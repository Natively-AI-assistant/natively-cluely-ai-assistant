#!/usr/bin/env node
// External judge (gpt-6-astra via AgentRouter) — absolute scoring of one or more runs.
//   node astra/judge.mjs --set <name> --runs results/<run>[,results/<run2>] [--ids A,B] [--mode m1,m2]
//                        [--repeat 3] [--concurrency 3] [--dry]
// Output: astra/out/<set>/<run_id>.jsonl — one line per (item, repeat) with the parsed judgment, the official
// score (astra/score.mjs), validator result, and model-integrity metadata. The judge never sees run ids.
// Cache: astra/cache/<sha>.json keyed by charter version + model + mode + question + envelope + answer + repeat.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chat, limiter, JUDGE_MODEL, assertProbeOk, scrub } from './client.mjs';
import { buildEnvelope, answerOf } from './envelope.mjs';
import { officialScore, DIMENSIONS, FLAGS } from './score.mjs';
import { validate } from '../validators/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
export const CHARTER = fs.readFileSync(path.join(HERE, 'CHARTER.md'), 'utf8');
export const CHARTER_VERSION = crypto.createHash('sha256').update(CHARTER).digest('hex').slice(0, 12);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const VERDICTS = new Set(['excellent', 'good', 'mixed', 'poor', 'hard_fail']);
export function stripFence(t) {
  const s = String(t ?? '').trim();
  const m = s.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  return m ? m[1].trim() : s;
}
/** Validate against the local schema. Returns { ok, value, problems }. */
export function checkJudgment(obj) {
  const p = [];
  if (!obj || typeof obj !== 'object') return { ok: false, problems: ['not an object'] };
  if (typeof obj.expected_behavior !== 'string' || !obj.expected_behavior.trim()) p.push('expected_behavior missing');
  if (!obj.scores || typeof obj.scores !== 'object') p.push('scores missing');
  else for (const d of DIMENSIONS) { const v = Number(obj.scores[d]); if (!Number.isFinite(v) || v < 0 || v > 10) p.push(`scores.${d} invalid`); }
  if (!Array.isArray(obj.hard_flags)) p.push('hard_flags not an array');
  if (!VERDICTS.has(obj.verdict)) p.push('verdict invalid');
  if (!Number.isFinite(Number(obj.overall))) p.push('overall invalid');
  const unknownFlags = Array.isArray(obj.hard_flags) ? obj.hard_flags.filter((f) => !FLAGS.includes(f)) : [];
  return { ok: p.length === 0, value: obj, problems: p, unknownFlags };
}
export const SCHEMA_TEXT = '{"expected_behavior": string, "scores": {' + DIMENSIONS.map((d) => `"${d}": number 0-10`).join(', ') + '}, "hard_flags": string[] (from the allowed list), "overall": number 0-10, "verdict": "excellent|good|mixed|poor|hard_fail", "specific_issue": string, "minimal_improvement": string, "evidence_used": string[]}';

export async function judgeOnce(system, user, { maxTokens = 4000 } = {}) {
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  const r1 = await chat(messages, { maxTokens });
  if (!r1.ok) return { ok: false, error: r1.error ?? 'no content', calls: [meta(r1)] };
  let parsed = null; try { parsed = JSON.parse(stripFence(r1.content)); } catch { /* repair below */ }
  let chk = checkJudgment(parsed);
  if (chk.ok) return { ok: true, judgment: parsed, unknownFlags: chk.unknownFlags, calls: [meta(r1)], repaired: false };
  const r2 = await chat([...messages, { role: 'assistant', content: r1.content }, { role: 'user', content: `Return the same judgment as valid JSON matching this schema. Do not change the judgment.\nSchema: ${SCHEMA_TEXT}\nProblems found: ${chk.problems.join('; ') || 'not parseable JSON'}` }], { maxTokens });
  if (!r2.ok) return { ok: false, error: 'repair call failed: ' + (r2.error ?? ''), calls: [meta(r1), meta(r2)], raw: scrub(r1.content).slice(0, 2000) };
  try { parsed = JSON.parse(stripFence(r2.content)); } catch { parsed = null; }
  chk = checkJudgment(parsed);
  if (chk.ok) return { ok: true, judgment: parsed, unknownFlags: chk.unknownFlags, calls: [meta(r1), meta(r2)], repaired: true };
  return { ok: false, error: 'judge output invalid after one repair: ' + chk.problems.join('; '), calls: [meta(r1), meta(r2)], raw: scrub(r2.content).slice(0, 2000) };
}
const meta = (r) => ({ requested_model: r.requested_model, returned_model: r.returned_model ?? null, model_mismatch: r.model_mismatch ?? null, response_id: r.response_id ?? null, request_id: r.request_id ?? null, latency_ms: r.latency_ms ?? null, usage: r.usage ?? null, finish_reason: r.finish_reason ?? null, attempts: r.attempts, at: r.at, status: r.ok ? 200 : r.status ?? null });

export function loadRun(dir) {
  const header = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
  const ds = JSON.parse(fs.readFileSync(path.resolve(ROOT, header.dataset_file), 'utf8'));
  const rows = readJsonl(path.join(dir, 'natively_benchmark_full.jsonl'));
  return { header, ds, rows, rowsById: Object.fromEntries(rows.map((r) => [r.benchmark_id, r])), items: Object.fromEntries(ds.items.map((i) => [i.id, i])) };
}

export async function judgeRow({ run, row, repeat = 0, cacheDir }) {
  const item = run.items[row.benchmark_id];
  const answer = answerOf(row);
  const validator = validate(item, answer, run.ds);
  const env = buildEnvelope({ item, ds: run.ds, answer, rowsById: run.rowsById, validator: validator.verdict === 'n/a' ? null : validator });
  const key = sha([CHARTER_VERSION, JUDGE_MODEL, item.mode, item.question, env.text, answer, repeat].join('\u0000'));
  const cf = path.join(cacheDir, key + '.json');
  if (fs.existsSync(cf)) return { ...JSON.parse(fs.readFileSync(cf, 'utf8')), cached: true };
  const res = await judgeOnce(CHARTER, env.text);
  const out = { key, charter_version: CHARTER_VERSION, benchmark_id: row.benchmark_id, mode: item.mode, repeat, validator, ...res };
  if (res.ok) out.official = officialScore(res.judgment, item.mode, validator);
  if (res.ok) fs.writeFileSync(cf, JSON.stringify(out)); // failures are never cached
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d; };
  const set = opt('set'); if (!set) { console.error('--set required'); process.exit(2); }
  const runs = String(opt('runs', '')).split(',').filter(Boolean).map((r) => path.resolve(ROOT, r));
  const ids = opt('ids') ? new Set(String(opt('ids')).split(',')) : null;
  const modes = opt('mode') ? new Set(String(opt('mode')).split(',')) : null;
  const repeats = Number(opt('repeat', 1));
  const conc = Number(opt('concurrency', 3));
  if (!opt('dry')) { try { assertProbeOk(); } catch (e) { console.error(String(e.message)); process.exit(2); } }
  const cacheDir = path.join(HERE, 'cache'); fs.mkdirSync(cacheDir, { recursive: true });
  const outDir = path.join(HERE, 'out', set); fs.mkdirSync(outDir, { recursive: true });
  const lim = limiter(conc);
  for (const dir of runs) {
    const run = loadRun(dir);
    const outFile = path.join(outDir, `${run.header.run_id}.jsonl`);
    const done = new Set(readJsonl(outFile).filter((j) => j.ok).map((j) => `${j.benchmark_id}#${j.repeat}`));
    const todo = [];
    for (const row of run.rows) {
      const it = run.items[row.benchmark_id];
      if (!it || (ids && !ids.has(row.benchmark_id)) || (modes && !modes.has(it.mode))) continue;
      for (let k = 0; k < repeats; k++) if (!done.has(`${row.benchmark_id}#${k}`)) todo.push([row, k]);
    }
    console.log(`${run.header.run_id}: ${todo.length} judgments to do (charter ${CHARTER_VERSION})`);
    if (opt('dry')) { const [row] = todo[0] ?? []; if (row) { const it = run.items[row.benchmark_id]; const v = validate(it, answerOf(row), run.ds); console.log(buildEnvelope({ item: it, ds: run.ds, answer: answerOf(row), rowsById: run.rowsById, validator: v.verdict === 'n/a' ? null : v }).text); } continue; }
    let n = 0, fail = 0, mismatch = 0;
    await Promise.all(todo.map(([row, k]) => lim(async () => {
      const j = await judgeRow({ run, row, repeat: k, cacheDir });
      fs.appendFileSync(outFile, JSON.stringify(j) + '\n');
      n++; if (!j.ok) fail++; if (j.calls?.some((c) => c.model_mismatch)) mismatch++;
      if (n % 20 === 0 || !j.ok) console.log(`  ${n}/${todo.length} ${j.ok ? '' : 'FAIL ' + row.benchmark_id + ' ' + j.error}`);
    })));
    console.log(`  done ${n}, failures ${fail}, model-id mismatches ${mismatch}`);
  }
}
