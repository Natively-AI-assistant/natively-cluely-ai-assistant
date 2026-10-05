#!/usr/bin/env node
// Blind pairwise judging (spec §34): the same scenario, two answers, labels randomised per item; the
// A/B → run mapping is kept in astra/out/<set>/mapping.json, never sent to the judge.
//   node astra/ab.mjs --set <name> --a results/<runA> --b results/<runB> [--ids ..] [--mode ..] [--repeat 3]
// Chains: each side's own earlier answers are shown with that side (they legitimately differ).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chat, limiter, JUDGE_KEY, assertProbeOk, scrub } from './client.mjs';
import { buildEnvelope, answerOf, splitGist } from './envelope.mjs';
import { CHARTER, CHARTER_VERSION, loadRun, stripFence, checkJudgment, saved } from './judge.mjs';
import { readJsonl, readJsonOrNull, writeAtomic, appendLine } from './store.mjs';
import { officialScore, DIMENSIONS } from './score.mjs';
import { validate } from '../validators/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
export const PAIR_INSTRUCTIONS = `\n\n# PAIRWISE MODE\nYou will see ONE scenario and TWO candidate answers, labelled A and B in random order. Judge each answer independently with the full procedure, then say which you would rather the user receive at this moment.\nReturn ONLY one JSON object:\n{"expected_behavior": "...", "a": {"scores": {...all 11 dimensions...}, "hard_flags": [], "overall": 0, "verdict": "...", "specific_issue": "...", "minimal_improvement": "...", "evidence_used": []}, "b": {same shape}, "preferred": "A|B|tie", "preference_strength": "slight|clear|decisive", "reason": "..."}\nThe labels carry no meaning; neither answer is newer or preferred by anyone.`;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function pairText(env, a, b) {
  // env.text is a full single-answer envelope for side A's scenario; replace its answer tail with both answers.
  const head = env.text.split('\n\nOBJECTIVE VALIDATOR RESULTS:')[0];
  const side = (label, x) => [
    x.history?.length ? `EARLIER ANSWERS BY THIS SIDE (${label}):\n${x.history.join('\n')}` : null,
    `OBJECTIVE VALIDATOR RESULTS — ANSWER ${label}:\n${x.validator ? JSON.stringify(x.validator, null, 1) : '(no deterministic validator applies)'}`,
    `ANSWER ${label}:\n${x.body || '(empty response)'}${x.gist ? `\nGIST CHIP ${label} (UI summary, not spoken): ${x.gist}` : ''}`,
  ].filter(Boolean).join('\n\n');
  return [head, side('A', a), side('B', b)].join('\n\n');
}

export function checkPair(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, problems: ['not an object'] };
  const p = [];
  if (typeof obj.expected_behavior !== 'string') p.push('expected_behavior missing');
  for (const k of ['a', 'b']) { const c = checkJudgment({ expected_behavior: 'x', ...(obj[k] ?? {}) }); if (!c.ok) p.push(...c.problems.map((x) => `${k}.${x}`)); }
  if (!['A', 'B', 'tie'].includes(obj.preferred)) p.push('preferred invalid');
  if (!['slight', 'clear', 'decisive'].includes(obj.preference_strength) && obj.preferred !== 'tie') p.push('preference_strength invalid');
  return { ok: p.length === 0, problems: p };
}

export async function judgePair(userText, { maxTokens = 6000 } = {}) {
  const system = CHARTER + PAIR_INSTRUCTIONS;
  const messages = [{ role: 'system', content: system }, { role: 'user', content: userText }];
  const r1 = await chat(messages, { maxTokens });
  const meta = (r) => ({ requested_model: r.requested_model, returned_model: r.returned_model ?? null, model_mismatch: r.model_mismatch ?? null, request_id: r.request_id ?? null, response_id: r.response_id ?? null, latency_ms: r.latency_ms ?? null, usage: r.usage ?? null, temperature: r.temperature ?? null, temperature_dropped: r.temperature_dropped ?? null, at: r.at });
  if (!r1.ok) return { ok: false, error: r1.error, calls: [meta(r1)] };
  let obj = null; try { obj = JSON.parse(stripFence(r1.content)); } catch { /* repair */ }
  let c = checkPair(obj);
  if (c.ok) return { ok: true, judgment: obj, calls: [meta(r1)] };
  const r2 = await chat([...messages, { role: 'assistant', content: r1.content }, { role: 'user', content: `Return the same judgment as valid JSON matching the pairwise schema. Do not change the judgment. Problems: ${c.problems.join('; ') || 'not parseable JSON'}` }], { maxTokens });
  if (!r2.ok) return { ok: false, error: 'repair failed', calls: [meta(r1), meta(r2)] };
  try { obj = JSON.parse(stripFence(r2.content)); } catch { obj = null; }
  c = checkPair(obj);
  return c.ok ? { ok: true, judgment: obj, calls: [meta(r1), meta(r2)], repaired: true } : { ok: false, error: 'invalid after repair: ' + c.problems.join('; '), raw: scrub(r2.content).slice(0, 1500), calls: [meta(r1), meta(r2)] };
}

const chainHistory = (item, ds, rowsById) => !item.conversation_id ? [] : ds.items
  .filter((x) => x.conversation_id === item.conversation_id && x.turn_index < item.turn_index).sort((a, b) => a.turn_index - b.turn_index)
  .map((p) => `turn ${p.turn_index}: ${splitGist(answerOf(rowsById[p.id])).body || '(missing)'}`);

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const set = opt('set'); const A = loadRun(path.resolve(ROOT, opt('a'))); const B = loadRun(path.resolve(ROOT, opt('b')));
  const ids = opt('ids') ? new Set(opt('ids').split(',')) : null; const modes = opt('mode') ? new Set(opt('mode').split(',')) : null;
  const repeats = Number(opt('repeat', 1)); const lim = limiter(Number(opt('concurrency', 3)));
  try { assertProbeOk(); } catch (e) { console.error(String(e.message)); process.exit(2); }
  const outDir = path.join(HERE, 'out', set); fs.mkdirSync(outDir, { recursive: true });
  const mapFile = path.join(outDir, 'mapping.json');
  const mapping = fs.existsSync(mapFile) ? JSON.parse(fs.readFileSync(mapFile, 'utf8')) : { a_run: A.header.run_id, b_run: B.header.run_id, items: {} };
  const outFile = path.join(outDir, 'pairs.jsonl');
  const cacheDir = path.join(HERE, 'cache'); fs.mkdirSync(cacheDir, { recursive: true });
  const todo = [];
  for (const rowA of A.rows) {
    const rowB = B.rowsById[rowA.benchmark_id]; const item = A.items[rowA.benchmark_id];
    if (!rowB || !item || (ids && !ids.has(item.id)) || (modes && !modes.has(item.mode))) continue;
    for (let k = 0; k < repeats; k++) todo.push({ item, rowA, rowB, k });
  }
  const already = new Set(readJsonl(outFile).filter((r) => r.ok).map((r) => r.jid));
  for (let i = todo.length - 1; i >= 0; i--) if (already.has(`${todo[i].item.id}#${todo[i].k}`)) todo.splice(i, 1);
  console.log(`${todo.length} pairwise judgments to do (charter ${CHARTER_VERSION})`);
  await Promise.all(todo.map(({ item, rowA, rowB, k }) => lim(async () => {
    // Label order: a hash of (set, item, repeat) — unpredictable to the judge, reproducible across resumes (so a
    // resumed run hits the cache instead of re-judging with the labels flipped). Recorded privately in mapping.json.
    const swap = (crypto.createHash('sha256').update(`${set}|${item.id}|${k}`).digest()[0] & 1) === 1;
    const sides = [{ run: 'a', row: rowA, rowsById: A.rowsById }, { run: 'b', row: rowB, rowsById: B.rowsById }];
    const [L, R] = swap ? [sides[1], sides[0]] : sides;
    const mk = (s) => { const ans = answerOf(s.row); const g = splitGist(ans); const v = validate(item, ans, A.ds); return { body: g.body, gist: g.gist, validator: v.verdict === 'n/a' ? null : v, history: chainHistory(item, A.ds, s.rowsById), v }; };
    const la = mk(L), rb = mk(R);
    const env = buildEnvelope({ item, ds: A.ds, answer: answerOf(L.row), rowsById: null, validator: null });
    const text = pairText(env, la, rb);
    const key = sha(['pair', CHARTER_VERSION, JUDGE_KEY, text, k].join('\u0000'));
    const cf = path.join(cacheDir, key + '.json');
    let res = readJsonOrNull(cf);
    if (!res) { res = await judgePair(text); if (res.ok) saved(() => writeAtomic(cf, JSON.stringify(res))); }
    const jid = `${item.id}#${k}`;
    mapping.items[jid] = { A: L.run, B: R.run };
    let rec = { jid, benchmark_id: item.id, mode: item.mode, repeat: k, ok: res.ok, error: res.error ?? null, calls: res.calls };
    if (res.ok) {
      const j = res.judgment; const winner = j.preferred === 'tie' ? 'tie' : (j.preferred === 'A' ? L.run : R.run);
      const byRun = { [L.run]: j.a, [R.run]: j.b };
      rec = { ...rec, winner, strength: j.preference_strength, reason: j.reason, expected_behavior: j.expected_behavior,
        a_run: { judgment: byRun.a, official: officialScore({ ...byRun.a }, item.mode, (L.run === 'a' ? la : rb).v) },
        b_run: { judgment: byRun.b, official: officialScore({ ...byRun.b }, item.mode, (L.run === 'b' ? la : rb).v) } };
    }
    saved(() => { appendLine(outFile, rec); writeAtomic(mapFile, JSON.stringify(mapping)); });
  })));
  const recs = readJsonl(outFile).filter((r) => r.ok);
  const w = { a: 0, b: 0, tie: 0 }; for (const r of recs) w[r.winner]++;
  console.log(`preferences: ${A.header.run_id} ${w.a} | ${B.header.run_id} ${w.b} | tie ${w.tie}`);
}
