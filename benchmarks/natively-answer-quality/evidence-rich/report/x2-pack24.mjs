#!/usr/bin/env node
// X2: two arms of one build on the pack24 set (realistic packs of about 21,000 tokens), read without a judge.
//   ER_BENCH_DIR=evidence-rich/pack24 node evidence-rich/report/x2-pack24.mjs <run A (12,000)> <run B (24,000)> [--small er6-dev-main,er6-dev2-main,er7-chal-main] [--list]
// --small: runs of the SAME questions on the small frozen pack (results of the main benchmark folder), matched through
//          `derived_from`; reported, no line.
// Definitions fixed before any run (ITERATIONS-ER.md, X2):
//   right            every required string, no forbidden string, and the calculation result where there is one (obj-3)
//   late settle      settled answer at least 3,500 ms after the last streamed token. NOT the pass's own time (the spoken
//                    repair runs first): for the pass read the app log's [ClaimVerifier] lines. Line 6 was first read
//                    from this figure and corrected on 2026-10-09 (ITERATIONS-ER.md).
//   lost by the pass right as drafted (raw answer), not right as shown
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRun, objective, funnel, answerOf, OBJECTIVE_VERSION, readJson, readJsonl } from '../objective.mjs';
const ER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BENCH = process.env.ER_BENCH_DIR ? path.resolve(process.env.ER_BENCH_DIR) : ER;
const args = process.argv.slice(2); const pos = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--small'); const list = args.includes('--list');
const small = args.includes('--small') ? args[args.indexOf('--small') + 1].split(',') : [];
const CAP = 96000, BUDGET = 3500;

function verdict(item, row, text) {
  const r = text == null ? row : { ...row, rendered_answer: text, raw_answer: text };
  const o = objective(item, r); const c = item.oracle ?? {};
  const forb = (c.forbidden_claims ?? []).filter((f) => (f.answer_needles ?? []).length); const t = String(answerOf(r)).toLowerCase().replace(/[*`]/g, '');
  const forbHit = forb.some((f) => f.answer_needles.some((n) => t.includes(String(n).toLowerCase())));
  const calc = !!(c.requires_calculation && c.calculation_oracle); const calcOk = calc ? o.checks.some((x) => x.label === 'calculation result stated' && x.ok) : null;
  const hasReq = o.required_strings.total > 0; const reqOk = hasReq ? o.required_strings.found === o.required_strings.total : null;
  return { hasReq, reqOk, forbHit, calc, calcOk, right: (reqOk !== false) && !forbHit && (calcOk !== false) };
}
function read(runName) {
  const run = loadRun(path.join(BENCH, 'results', runName)); const out = new Map();
  for (const row of run.rows) {
    const it = run.ds.byId[row.benchmark_id]; if (!it) continue;
    const shown = verdict(it, row, null); const draft = row.raw_answer != null ? verdict(it, row, String(row.raw_answer)) : shown;
    const f = funnel(it, row, run); const docFacts = (f.required ?? []).filter((r) => !r.is_pi);
    const w = run.wire[row.benchmark_id]; const user = (w?.messages ?? []).filter((m) => m.role !== 'system').map((m) => m.text ?? '').join('\n');
    const pass = (w?.other_requests ?? []).find((o) => /DRAFT REPLY:/.test((o.messages ?? []).map((m) => m.text ?? '').join('\n')));
    const files = new Set([...user.matchAll(/<evidence\b[^>]*source_name="([^"]*)"/g)].map((m) => m[1]));
    out.set(row.benchmark_id, { id: row.benchmark_id, item: it, row, shown, draft, answered: !!row.success && !!String(answerOf(row)).trim(), error: row.error_type ?? null, timeout: !!row.timeout,
      factsWanted: docFacts.length, factsInPrompt: docFacts.filter((r) => r.reached_prompt_any).length, promptChars: user.length, filesInPrompt: files.size,
      ttft: row.ttft_ms, settled: row.final_event_ms ?? row.total_latency_ms, lastToken: row.last_token_ms, inTok: row.input_tokens, cached: row.cached_input_tokens,
      passRan: !!pass, passChanged: !!pass && String(row.raw_answer ?? '').trim() !== String(row.rendered_answer ?? '').trim() && !!row.answer_differs_raw_vs_rendered,
      passCut: !!pass && user.length > CAP, passOver: !!pass && row.final_event_ms != null && row.last_token_ms != null && row.final_event_ms - row.last_token_ms >= BUDGET,
      kind: /-N-\d+$/.test(row.benchmark_id) ? 'new' : 'derived' });
  }
  return out;
}
const q = (xs, p) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.floor(v.length * p))] : null; };
const pct = (n, d) => (d ? (100 * n / d).toFixed(1) : '-');
const boot = (d) => { if (!d.length) return [0, 0]; const out = []; let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648; for (let i = 0; i < 4000; i++) { let t = 0; for (let j = 0; j < d.length; j++) t += d[Math.floor(rnd() * d.length)]; out.push(t / d.length); } out.sort((x, y) => x - y); return [out[100], out[3899]]; };

const A = read(pos[0]), B = read(pos[1]);
const ids = [...A.keys()].filter((id) => B.has(id));
console.log(`checks ${OBJECTIVE_VERSION}; arm A ${pos[0]} (${A.size} rows), arm B ${pos[1]} (${B.size} rows), ${ids.length} rows in both`);
const a = ids.map((id) => A.get(id)), b = ids.map((id) => B.get(id));
const summary = (name, x) => {
  const req = x.filter((r) => r.shown.hasReq); const calc = x.filter((r) => r.shown.calc); const sp = x.filter((r) => r.row.surface !== 'typed'), ty = x.filter((r) => r.row.surface === 'typed');
  const fw = x.reduce((n, r) => n + r.factsWanted, 0), fp = x.reduce((n, r) => n + r.factsInPrompt, 0); const passes = x.filter((r) => r.passRan);
  console.log(`\n## ${name}`);
  console.log(`answered ${x.filter((r) => r.answered).length}/${x.length}; errors ${x.filter((r) => r.error).length}; timeouts ${x.filter((r) => r.timeout).length}; turns over 5 s to the first word ${x.filter((r) => r.ttft > 5000).length}`);
  console.log(`right ${x.filter((r) => r.shown.right).length}/${x.length} (${pct(x.filter((r) => r.shown.right).length, x.length)} %); every required string ${req.filter((r) => r.shown.reqOk).length}/${req.length} (${pct(req.filter((r) => r.shown.reqOk).length, req.length)} %); forbidden-string rows ${x.filter((r) => r.shown.forbHit).length}; calculation right ${calc.filter((r) => r.shown.calcOk).length}/${calc.length} (${pct(calc.filter((r) => r.shown.calcOk).length, calc.length)} %)`);
  console.log(`required document facts whose string is in the request ${fp}/${fw} (${pct(fp, fw)} %); files in the request, median ${q(x.map((r) => r.filesInPrompt), 0.5)}; request characters median ${q(x.map((r) => r.promptChars), 0.5)}; prompt tokens median ${q(x.map((r) => r.inTok), 0.5)} (cached median ${q(x.map((r) => r.cached), 0.5)})`);
  console.log(`first word: spoken median ${q(sp.map((r) => r.ttft), 0.5)} / p90 ${q(sp.map((r) => r.ttft), 0.9)} ms (${sp.length}); typed median ${q(ty.map((r) => r.ttft), 0.5)} / p90 ${q(ty.map((r) => r.ttft), 0.9)} ms (${ty.length}); settled answer median ${q(x.map((r) => r.settled), 0.5)} / p90 ${q(x.map((r) => r.settled), 0.9)} ms`);
  console.log(`fix-up pass: ran on ${passes.length}; changed the text on ${passes.filter((r) => r.passChanged).length}; material over ${CAP} characters on ${passes.filter((r) => r.passCut).length}; settled 3.5 s or more after the last token ${passes.filter((r) => r.passOver).length} (${pct(passes.filter((r) => r.passOver).length, passes.length)} %); right as drafted and not as shown ${x.filter((r) => r.draft.right && !r.shown.right).length}; not right as drafted and right as shown ${x.filter((r) => !r.draft.right && r.shown.right).length}`);
};
summary('arm A (12,000: main)', a); summary('arm B (24,000)', b);
for (const [name, f] of [['derived rows', (r) => r.kind === 'derived'], ['new rows', (r) => r.kind === 'new']]) {
  const xa = a.filter(f), xb = b.filter(f);
  console.log(`\n${name}: right A ${xa.filter((r) => r.shown.right).length}/${xa.length} (${pct(xa.filter((r) => r.shown.right).length, xa.length)} %) · B ${xb.filter((r) => r.shown.right).length}/${xb.length} (${pct(xb.filter((r) => r.shown.right).length, xb.length)} %)`);
}
console.log('\n| mode | rows | right A | right B | facts in request A | B |\n|---|---|---|---|---|---|');
for (const m of [...new Set(a.map((r) => r.item.mode))]) { const xa = a.filter((r) => r.item.mode === m), xb = b.filter((r) => r.item.mode === m);
  console.log(`| ${m} | ${xa.length} | ${pct(xa.filter((r) => r.shown.right).length, xa.length)} % | ${pct(xb.filter((r) => r.shown.right).length, xb.length)} % | ${xa.reduce((n, r) => n + r.factsInPrompt, 0)}/${xa.reduce((n, r) => n + r.factsWanted, 0)} | ${xb.reduce((n, r) => n + r.factsInPrompt, 0)}/${xb.reduce((n, r) => n + r.factsWanted, 0)} |`); }
console.log('\n| condition | rows | right A | right B |\n|---|---|---|---|');
for (const c of [...new Set(a.map((r) => r.item.condition))]) { const xa = a.filter((r) => r.item.condition === c), xb = b.filter((r) => r.item.condition === c); console.log(`| ${c} | ${xa.length} | ${pct(xa.filter((r) => r.shown.right).length, xa.length)} % | ${pct(xb.filter((r) => r.shown.right).length, xb.length)} % |`); }
const newKinds = {}; for (const r of a.filter((x) => x.kind === 'new')) { const k = r.item.oracle?.requires_calculation ? 'calculation across old and new' : r.item.condition === 'conflict_stale' ? 'version conflict' : r.item.condition === 'missing_evidence' ? 'absent' : r.item.condition === 'multi_source' ? 'needs the whole pack' : 'single fact (deep in the long document, or which value)'; (newKinds[k] ??= []).push(r.id); }
console.log('\n| new rows by kind | rows | right A | right B |\n|---|---|---|---|');
for (const [k, list2] of Object.entries(newKinds)) console.log(`| ${k} | ${list2.length} | ${list2.filter((id) => A.get(id).shown.right).length} | ${list2.filter((id) => B.get(id).shown.right).length} |`);

// ---- the lines
const wreq = ids.filter((id) => A.get(id).shown.hasReq); const d = wreq.map((id) => (B.get(id).shown.reqOk ? 1 : 0) - (A.get(id).shown.reqOk ? 1 : 0)); const ci = boot(d); const mean = d.reduce((x, y) => x + y, 0) / Math.max(1, d.length);
const forbA = a.filter((r) => r.shown.forbHit).length, forbB = b.filter((r) => r.shown.forbHit).length;
const calcIds = ids.filter((id) => A.get(id).shown.calc); const cA = calcIds.filter((id) => A.get(id).shown.calcOk).length, cB = calcIds.filter((id) => B.get(id).shown.calcOk).length;
const whole = (newKinds['needs the whole pack'] ?? []); const wA = whole.filter((id) => A.get(id).shown.right).length, wB = whole.filter((id) => B.get(id).shown.right).length;
const sp = (x) => x.filter((r) => r.row.surface !== 'typed'), ty = (x) => x.filter((r) => r.row.surface === 'typed');
const dSpMed = q(sp(b).map((r) => r.ttft), 0.5) - q(sp(a).map((r) => r.ttft), 0.5), dSp90 = q(sp(b).map((r) => r.ttft), 0.9) - q(sp(a).map((r) => r.ttft), 0.9), dTyMed = q(ty(b).map((r) => r.ttft), 0.5) - q(ty(a).map((r) => r.ttft), 0.5);
const over5 = sp(b).filter((r) => r.ttft > 5000).length;
const lostA = a.filter((r) => r.draft.right && !r.shown.right).length, lostB = b.filter((r) => r.draft.right && !r.shown.right).length;
const ovA = a.filter((r) => r.passRan), ovB = b.filter((r) => r.passRan); const rA = ovA.length ? 100 * ovA.filter((r) => r.passOver).length / ovA.length : 0, rB = ovB.length ? 100 * ovB.filter((r) => r.passOver).length / ovB.length : 0;
const errB = b.filter((r) => r.error || r.timeout || !r.answered).length;
const L = (n, ok, text) => console.log(`${n}. ${ok ? 'holds' : 'FAILS'}: ${text}`);
console.log('\n### lines (arm B against arm A)');
L(1, mean * 100 >= 3 && ci[0] > 0, `rows with every required string ${pct(wreq.filter((id) => A.get(id).shown.reqOk).length, wreq.length)} % -> ${pct(wreq.filter((id) => B.get(id).shown.reqOk).length, wreq.length)} % (${wreq.length} rows); paired ${(mean * 100).toFixed(1)} points, 95 % ${(ci[0] * 100).toFixed(1)} to ${(ci[1] * 100).toFixed(1)}`);
L(2, forbB <= forbA + 2, `rows with a forbidden string ${forbA} -> ${forbB}`);
L(3, calcIds.length ? (100 * cB / calcIds.length) >= (100 * cA / calcIds.length) - 2 : true, `calculation results right ${cA}/${calcIds.length} -> ${cB}/${calcIds.length}`);
L(4, wB >= wA, `whole-pack rows right ${wA}/${whole.length} -> ${wB}/${whole.length}`);
L(5, dSpMed <= 400 && dSp90 <= 700 && over5 === 0 && dTyMed <= 400, `first word: spoken median ${dSpMed >= 0 ? '+' : ''}${dSpMed} ms, p90 ${dSp90 >= 0 ? '+' : ''}${dSp90} ms, spoken turns over 5 s ${over5}; typed median ${dTyMed >= 0 ? '+' : ''}${dTyMed} ms`);
L(6, lostB <= lostA + 2 && rB <= rA + 2, `right as drafted and not as shown ${lostA} -> ${lostB}; settled 3.5 s or more after the last token ${rA.toFixed(1)} % -> ${rB.toFixed(1)} % (the pass's own budget: read the app log)`);
L(7, errB === 0, `rows of arm B with an error, a timeout or no answer: ${errB}`);

if (small.length) {
  const S = new Map(); for (const r of small) { const dir = path.join(ER, 'results', r); const ds = readJson(path.join(ER, 'datasets', `${readJson(path.join(dir, 'run.json')).partition}.json`)); const byId = Object.fromEntries(ds.items.map((i) => [i.id, i])); for (const row of readJsonl(path.join(dir, 'rows.jsonl'))) if (byId[row.benchmark_id]) S.set(row.benchmark_id, row); }
  const both = ids.filter((id) => A.get(id).item.derived_from && S.has(A.get(id).item.derived_from));
  const sv = both.map((id) => verdict(A.get(id).item, S.get(A.get(id).item.derived_from), null));
  const n = both.length; const reqN = both.filter((id) => A.get(id).shown.hasReq).length;
  console.log(`\n### the same ${n} questions on the small frozen pack (main, whole pack; ${small.join(', ')}), no line`);
  console.log(`right: small pack ${pct(sv.filter((v) => v.right).length, n)} % · large pack arm A ${pct(both.filter((id) => A.get(id).shown.right).length, n)} % · arm B ${pct(both.filter((id) => B.get(id).shown.right).length, n)} %`);
  console.log(`every required string (${reqN} rows): small ${pct(sv.filter((v) => v.hasReq && v.reqOk).length, reqN)} % · A ${pct(both.filter((id) => A.get(id).shown.hasReq && A.get(id).shown.reqOk).length, reqN)} % · B ${pct(both.filter((id) => B.get(id).shown.hasReq && B.get(id).shown.reqOk).length, reqN)} %`);
  console.log(`forbidden-string rows: small ${sv.filter((v) => v.forbHit).length} · A ${both.filter((id) => A.get(id).shown.forbHit).length} · B ${both.filter((id) => B.get(id).shown.forbHit).length}`);
}
if (list) for (const id of ids) { const x = A.get(id), y = B.get(id); if (x.shown.right === y.shown.right) continue; console.log(`\n${id} [${x.item.condition}/${x.row.surface}] A ${x.shown.right ? 'right' : 'wrong'} -> B ${y.shown.right ? 'right' : 'wrong'}  facts in request ${x.factsInPrompt}/${x.factsWanted} -> ${y.factsInPrompt}/${y.factsWanted}\n  Q: ${String(x.item.question).slice(0, 160)}\n  A: ${String(answerOf(x.row)).replace(/\n+/g, ' ').slice(0, 260)}\n  B: ${String(answerOf(y.row)).replace(/\n+/g, ' ').slice(0, 260)}`); }
