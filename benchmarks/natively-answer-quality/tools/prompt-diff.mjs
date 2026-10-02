#!/usr/bin/env node
// Is the prompt SENT the same in two app runs of the same rows? Compares the system prompt and every message from
// the wire capture, after replacing the ids that are minted per run (file, session, mode and request uuids) — the
// instrument for "a speed change must not alter the prompt". Counts only; prints no prompt text unless --show N
// (dev runs only).
// A later turn of a conversation carries the app's own earlier replies, which differ by sampling alone; the
// EVIDENCE column compares only the retrieved passages (<evidence …> blocks, in order), which is what a retrieval
// change can alter.
//   node tools/prompt-diff.mjs <run A> <run B> [--show 2]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [a, b] = process.argv.slice(2);
const show = (() => { const i = process.argv.indexOf('--show'); return i >= 0 ? Number(process.argv[i + 1]) : 0; })();
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const norm = (s) => String(s ?? '').replace(UUID, '<id>');
const load = (run) => {
  const dir = path.join(ROOT, 'results', run);
  const sys = JSON.parse(fs.readFileSync(path.join(dir, 'systems.json'), 'utf8'));
  const jl = (f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return {
    header: JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')),
    rows: Object.fromEntries(jl('natively_benchmark_full.jsonl').map((r) => [r.benchmark_id, r])),
    wire: Object.fromEntries(jl('natively_benchmark_wire.jsonl').map((w) => [w.benchmark_id, { system: sys[w.wire?.system_sha] ?? null, messages: (w.messages ?? []).map((m) => `${m.role}: ${m.text ?? ''}`).join('\n<<message>>\n') }])),
  };
};
const A = load(a); const B = load(b);
// Retrieved passages only: a MEETING_TRANSCRIPT block quotes the conversation, earlier replies included.
const evidence = (s) => (norm(s).match(/<evidence\b[\s\S]*?<\/evidence>/g) ?? []).filter((e) => !/source_type="MEETING_TRANSCRIPT"/.test(e)).join('\n');
const cell = (r) => `${r.surface_path !== 'hotkey' ? 'typed' : 'heard'} | ${r.pi_state?.ref ? 'profile' : 'no profile'} | ${r.reference_attached ? 'reference file' : 'no reference file'}`;
const g = {}; const differing = []; const evDiff = [];
for (const id of Object.keys(A.rows)) {
  const x = A.wire[id]; const y = B.wire[id];
  const c = (g[cell(A.rows[id])] ??= { n: 0, missing: 0, same: 0, system: 0, messages: 0, evidence: 0, evidenceSet: 0, withEvidence: 0 });
  c.n++;
  if (!x || !y || x.system == null || y.system == null) { c.missing++; continue; }
  const s = norm(x.system) === norm(y.system); const m = norm(x.messages) === norm(y.messages);
  if (s && m) c.same++; else differing.push(id);
  if (!s) c.system++; if (!m) c.messages++;
  const ex = evidence(x.messages); const ey = evidence(y.messages);
  if (ex || ey) c.withEvidence++;
  if (ex !== ey) { c.evidence++; evDiff.push(id); const set = (e) => (e.match(/<evidence\b[\s\S]*?<\/evidence>/g) ?? []).map((b) => b.replace(/evidence_id="[^"]*"/, '')).sort().join('\n'); if (set(ex) !== set(ey)) c.evidenceSet++; }
}
console.log(`${a} (${String(A.header.git_commit).slice(0, 8)}) against ${b} (${String(B.header.git_commit).slice(0, 8)}), per-run ids replaced`);
console.log('| turn | rows | prompt identical | system prompt differs | messages differ | rows with retrieved passages | passages differ | of those, a different SET of passages (not only the order) | no capture |'); console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const [k, c] of Object.entries(g).sort()) console.log(`| ${k} | ${c.n} | ${c.same} | ${c.system} | ${c.messages} | ${c.withEvidence} | ${c.evidence} | ${c.evidenceSet} | ${c.missing} |`);
const t = Object.values(g).reduce((p, c) => ({ n: p.n + c.n, same: p.same + c.same, we: p.we + c.withEvidence, e: p.e + c.evidence, es: p.es + c.evidenceSet }), { n: 0, same: 0, we: 0, e: 0, es: 0 });
console.log(`| **all** | ${t.n} | ${t.same} | | | ${t.we} | ${t.e} | ${t.es} | |`);
if (show && A.header.partition === 'dev') for (const id of evDiff.slice(0, show)) {
  const x = evidence(A.wire[id].messages); const y = evidence(B.wire[id].messages); let i = 0; while (i < x.length && i < y.length && x[i] === y[i]) i++;
  console.log(`\n${id}: lengths ${x.length} / ${y.length}, first difference at ${i}\n  A: ${JSON.stringify(x.slice(Math.max(0, i - 80), i + 200))}\n  B: ${JSON.stringify(y.slice(Math.max(0, i - 80), i + 200))}`);
}
