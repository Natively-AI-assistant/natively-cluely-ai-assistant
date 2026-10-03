#!/usr/bin/env node
// Judge for evidence-rich-v1 (charter CHARTER-ER.md). One judgment per answer, against the exact evidence state.
//
//   [AQ_JUDGE=opus] node evidence-rich/judge/judge-er.mjs --set <name> --runs evidence-rich/results/<run>[,<run2>]
//        [--ids A,B] [--mode m1,m2] [--condition c1,c2] [--limit N] [--evidence focused|full] [--concurrency 3]
//        [--dry] [--blind]
//
// Which judge (never mixed in one file, never pooled):
//   default        gpt-6-astra over AgentRouter         → judge_status "canonical"
//   AQ_JUDGE=opus  Claude Opus 5.5 through the headless Claude Code CLI (Evin, 2026-10-03: "use claude codes opus 5.5
//                  not agent routers"; AgentRouter lists no Opus 5.5)   → judge_status "provisional"
// Output: evidence-rich/judge/out/<set>/<run>.<astra|opus>.jsonl. Cache: evidence-rich/judge/cache/.
// --blind: print nothing that identifies a row (holdout).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chat, limiter, JUDGE, JUDGE_KEY, JUDGE_MODEL, VIA_CLI, assertProbeOk, scrub, stopNewCalls } from '../../astra/client.mjs';
import { readJsonl, readJsonOrNull, writeAtomic, appendLine } from '../../astra/store.mjs';
import { loadRun, objective, answerOf } from '../objective.mjs';
import { buildEnvelope } from './envelope-er.mjs';
import { officialScore, DIMENSIONS, FLAGS } from './score-er.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ER = path.join(HERE, '..');
// ER_BENCH_DIR: judgments and cache of a rig smoke test stay out of the real series.
const JOUT = process.env.ER_BENCH_DIR ? path.join(path.resolve(process.env.ER_BENCH_DIR), 'judge') : HERE;
export const CHARTER = fs.readFileSync(path.join(HERE, 'CHARTER-ER.md'), 'utf8');
export const CHARTER_VERSION = 'er1-' + crypto.createHash('sha256').update(CHARTER).digest('hex').slice(0, 12);
export const JUDGE_META = Object.freeze(VIA_CLI
  ? { judge_provider: 'claude-code-cli', judge_model: JUDGE_MODEL, judge_family: 'claude-opus-5.5', judge_status: 'provisional' }
  : { judge_provider: 'agentrouter', judge_model: JUDGE_MODEL, judge_family: 'gpt-6-astra', judge_status: 'canonical' });
export const JUDGE_TAG = VIA_CLI ? JUDGE : 'astra';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const saved = (write) => { try { write(); return true; } catch (e) { stopNewCalls(`disk nearly full (a judgment could not be saved: ${e.code ?? 'write failed'})`); return false; } };

const VERDICTS = new Set(['excellent', 'good', 'mixed', 'poor', 'hard_fail']);
export function stripFence(t) { const s = String(t ?? '').trim(); const m = s.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/); return m ? m[1].trim() : s; }
export function checkJudgment(obj) {
  const p = [];
  if (!obj || typeof obj !== 'object') return { ok: false, problems: ['not an object'] };
  if (typeof obj.expected_behavior !== 'string' || !obj.expected_behavior.trim()) p.push('expected_behavior missing');
  if (!obj.scores || typeof obj.scores !== 'object') p.push('scores missing');
  else for (const d of DIMENSIONS) { const v = Number(obj.scores[d]); if (!Number.isFinite(v) || v < 0 || v > 10) p.push(`scores.${d} invalid`); }
  if (!Array.isArray(obj.hard_flags)) p.push('hard_flags not an array');
  if (!VERDICTS.has(obj.verdict)) p.push('verdict invalid');
  return { ok: p.length === 0, problems: p, unknownFlags: Array.isArray(obj.hard_flags) ? obj.hard_flags.filter((f) => !FLAGS.includes(f)) : [] };
}
export const SCHEMA_TEXT = '{"expected_behavior": string, "scores": {' + DIMENSIONS.map((d) => `"${d}": number 0-10`).join(', ') + '}, "hard_flags": string[] (from the allowed list), "required_facts_conveyed": "all|some|none|not_applicable", "overall": number 0-10, "verdict": "excellent|good|mixed|poor|hard_fail", "specific_issue": string, "minimal_improvement": string, "evidence_used": string[]}';
const meta = (r) => ({ requested_model: r.requested_model, key_var: r.key_var ?? null, returned_model: r.returned_model ?? null, model_mismatch: r.model_mismatch ?? null, response_id: r.response_id ?? null, request_id: r.request_id ?? null, latency_ms: r.latency_ms ?? null, usage: r.usage ?? null, finish_reason: r.finish_reason ?? null, attempts: r.attempts, at: r.at, status: r.ok ? 200 : r.status ?? null });

export async function judgeOnce(system, user, { maxTokens = 4000, check = checkJudgment, schema = SCHEMA_TEXT } = {}) {
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  const r1 = await chat(messages, { maxTokens });
  if (!r1.ok) return { ok: false, error: r1.error ?? 'no content', rationed: !!r1.rationed, calls: [meta(r1)] };
  let parsed = null; try { parsed = JSON.parse(stripFence(r1.content)); } catch { /* repair below */ }
  let chk = check(parsed);
  if (chk.ok) return { ok: true, judgment: parsed, unknownFlags: chk.unknownFlags ?? [], calls: [meta(r1)], repaired: false };
  const r2 = await chat([...messages, { role: 'assistant', content: r1.content }, { role: 'user', content: `Return the same judgment as valid JSON matching this schema. Do not change the judgment.\nSchema: ${schema}\nProblems found: ${chk.problems.join('; ') || 'not parseable JSON'}` }], { maxTokens });
  if (!r2.ok) return { ok: false, error: 'repair call failed: ' + (r2.error ?? ''), calls: [meta(r1), meta(r2)], raw: scrub(r1.content).slice(0, 2000) };
  try { parsed = JSON.parse(stripFence(r2.content)); } catch { parsed = null; }
  chk = check(parsed);
  if (chk.ok) return { ok: true, judgment: parsed, unknownFlags: chk.unknownFlags ?? [], calls: [meta(r1), meta(r2)], repaired: true };
  return { ok: false, error: 'judge output invalid after one repair: ' + chk.problems.join('; '), calls: [meta(r1), meta(r2)], raw: scrub(r2.content).slice(0, 2000) };
}

export async function judgeRow({ run, row, cacheDir, evidence }) {
  const item = run.ds.byId[row.benchmark_id];
  const obj = objective(item, row);
  const env = buildEnvelope({ item, ds: run.ds, row, rowsById: run.rowsById, objective: obj, evidence });
  const key = sha([CHARTER_VERSION, JUDGE_KEY, env.text].join('\u0000'));
  const cf = path.join(cacheDir, key + '.json');
  const hit = readJsonOrNull(cf);
  if (hit) return { ...hit, cached: true };
  const res = await judgeOnce(CHARTER, env.text);
  const out = { key, charter_version: CHARTER_VERSION, envelope_evidence: evidence, envelope_chars: env.text.length, benchmark_id: row.benchmark_id, mode: item.mode, ...JUDGE_META, objective: obj, ...res };
  if (res.ok) out.official = officialScore(res.judgment, item.mode, obj);
  if (res.ok) saved(() => writeAtomic(cf, JSON.stringify(out)));
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d; };
  const csv = (k) => (opt(k) && opt(k) !== true ? new Set(String(opt(k)).split(',')) : null);
  const set = opt('set'); if (!set || set === true) { console.error('--set required'); process.exit(2); }
  const runs = String(opt('runs', '')).split(',').filter(Boolean).map((r) => path.resolve(ER, '..', r));
  const ids = csv('ids'), modes = csv('mode'), conds = csv('condition');
  const limit = opt('limit') ? Number(opt('limit')) : null;
  const evidence = opt('evidence', 'focused');
  const blind = !!opt('blind');
  const conc = Number(opt('concurrency', VIA_CLI ? 4 : 3));
  if (!opt('dry')) { try { assertProbeOk(); } catch (e) { console.error(String(e.message)); process.exit(2); } }
  const cacheDir = path.join(JOUT, 'cache'); fs.mkdirSync(cacheDir, { recursive: true });
  const outDir = path.join(JOUT, 'out', set); fs.mkdirSync(outDir, { recursive: true });
  const lim = limiter(conc);
  for (const dir of runs) {
    const run = loadRun(dir);
    const outFile = path.join(outDir, `${path.basename(dir)}.${JUDGE_TAG}.jsonl`);
    const done = opt('force') ? new Set() : new Set(readJsonl(outFile).filter((j) => j.ok).map((j) => j.benchmark_id));
    let todo = run.rows.filter((row) => {
      const it = run.ds.byId[row.benchmark_id];
      // A row that was not asked (state unverified) or that got no real answer is not judged as answer quality.
      return it && row.success !== false && !(ids && !ids.has(row.benchmark_id)) && !(modes && !modes.has(it.mode)) && !(conds && !conds.has(it.condition)) && !done.has(row.benchmark_id);
    });
    if (limit) todo = todo.slice(0, limit);
    console.log(`${path.basename(dir)}: ${todo.length} judgments to do (charter ${CHARTER_VERSION}, judge ${JUDGE_META.judge_family} [${JUDGE_META.judge_status}], evidence ${evidence})`);
    if (opt('dry')) {
      const sizes = todo.map((row) => buildEnvelope({ item: run.ds.byId[row.benchmark_id], ds: run.ds, row, rowsById: run.rowsById, objective: objective(run.ds.byId[row.benchmark_id], row), evidence }).text.length);
      const s = [...sizes].sort((a, b) => a - b);
      console.log(`  envelope chars: mean ${Math.round(sizes.reduce((a, b) => a + b, 0) / Math.max(1, sizes.length))}, median ${s[Math.floor(s.length / 2)] ?? 0}, max ${s.at(-1) ?? 0}; charter ${CHARTER.length} chars; ~tokens per call ${(Math.round((sizes.reduce((a, b) => a + b, 0) / Math.max(1, sizes.length) + CHARTER.length) / 4))}`);
      if (!blind && todo[0]) console.log(buildEnvelope({ item: run.ds.byId[todo[0].benchmark_id], ds: run.ds, row: todo[0], rowsById: run.rowsById, objective: objective(run.ds.byId[todo[0].benchmark_id], todo[0]), evidence }).text);
      continue;
    }
    let n = 0, fail = 0, mismatch = 0;
    await Promise.all(todo.map((row) => lim(async () => {
      const j = await judgeRow({ run, row, cacheDir, evidence });
      if (j.ok || !j.rationed) saved(() => appendLine(outFile, j));
      n++; if (!j.ok) fail++; if (j.calls?.some((c) => c.model_mismatch)) mismatch++;
      if (n % 20 === 0 || !j.ok) console.log(`  ${n}/${todo.length} ${j.ok ? '' : `FAIL ${blind ? '(row)' : row.benchmark_id} ${String(j.error).slice(0, 160)}`}`);
    })));
    console.log(`  done ${n}, failures ${fail}, model-id mismatches ${mismatch}`);
  }
}
