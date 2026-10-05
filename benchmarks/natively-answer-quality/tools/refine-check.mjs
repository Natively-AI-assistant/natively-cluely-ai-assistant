#!/usr/bin/env node
// Objective check of a typed refinement follow-up ("shorter", "simpler", "another one"): the reply against the
// PREVIOUS reply of the same conversation in the same run — words, ratio, shared vocabulary.
//   node tools/refine-check.mjs results/<run> [...] [--aggregate]     (--aggregate: no per-item lines, for holdout)
// A "shorter" reply should be at most 75% of the previous reply's words, a "simpler" one at most 85%; "another one"
// should share clearly less than the whole vocabulary of the last one.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); const agg = args.includes('--aggregate');
const strip = (s) => String(s ?? '').replace(/\n*\s*\[\[GIST\]\][\s\S]*$/, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
const W = (s) => strip(s).split(' ').filter(Boolean);
const overlap = (a, b) => { const A = new Set(W(a).map((w) => w.toLowerCase())), B = new Set(W(b).map((w) => w.toLowerCase())); let i = 0; for (const w of A) if (B.has(w)) i++; return i / Math.max(1, Math.min(A.size, B.size)); };
const KIND = [['shorter', /\b(?:shorter|short version|shorten|tighter|more concise|briefer|trim it|cut it down|one[- ]liner)\b/i], ['simpler', /\b(?:simpler|simple words|plain(?:er)? (?:english|words)|easier|eli5|dumb it down|less technical)\b/i], ['another', /\b(?:another one|a different one|one more|try again|give me another|something else)\b/i]];
const LIMIT = { shorter: 0.75, simpler: 0.85 };
for (const dir of args.filter((a) => !a.startsWith('--'))) {
  const d = path.resolve(ROOT, dir);
  const header = JSON.parse(fs.readFileSync(path.join(d, 'run.json'), 'utf8'));
  const items = Object.fromEntries(JSON.parse(fs.readFileSync(path.resolve(ROOT, header.dataset_file), 'utf8')).items.map((i) => [i.id, i]));
  const rows = Object.fromEntries(fs.readFileSync(path.join(d, 'natively_benchmark_full.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.benchmark_id, r]));
  const wf = path.join(d, 'natively_benchmark_wire.jsonl');
  const noticed = new Set(fs.existsSync(wf) ? fs.readFileSync(wf, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((w) => (w.messages ?? []).some((m) => /# Revise your previous reply/.test(String(m.text ?? m.content ?? '')))).map((w) => w.benchmark_id) : []);
  const out = [];
  for (const r of Object.values(rows)) {
    const it = items[r.benchmark_id]; if (!it || it.surface !== 'typed' || !(it.turn_index > 1)) continue;
    const kind = KIND.find(([, re]) => re.test(it.question) && W(it.question).length <= 9)?.[0]; if (!kind) continue;
    const prev = Object.values(rows).find((p) => items[p.benchmark_id]?.conversation_id === it.conversation_id && items[p.benchmark_id]?.turn_index === it.turn_index - 1); if (!prev) continue;
    const a = prev.rendered_answer ?? prev.raw_answer, b = r.rendered_answer ?? r.raw_answer;
    const ratio = W(b).length / Math.max(1, W(a).length);
    out.push({ id: r.benchmark_id, kind, q: strip(it.question), prev: W(a).length, now: W(b).length, ratio, overlap: overlap(a, b), notice: noticed.has(r.benchmark_id), ok: r.success !== false, met: kind === 'another' ? overlap(a, b) < 0.75 : ratio <= LIMIT[kind] });
  }
  console.log(`\n${path.basename(d)} — typed refinement follow-ups: ${out.length}, request met: ${out.filter((o) => o.met).length}, notice in the prompt: ${out.filter((o) => o.notice).length}, failed rows: ${out.filter((o) => !o.ok).length}`);
  for (const k of ['shorter', 'simpler', 'another']) { const v = out.filter((o) => o.kind === k); if (v.length) console.log(`  ${k}: ${v.length}, met ${v.filter((o) => o.met).length}, median ratio ${[...v].sort((x, y) => x.ratio - y.ratio)[Math.floor(v.length / 2)].ratio.toFixed(2)}, median overlap ${[...v].sort((x, y) => x.overlap - y.overlap)[Math.floor(v.length / 2)].overlap.toFixed(2)}`); }
  if (!agg) for (const o of out) console.log(`  ${o.id.padEnd(11)} ${o.kind.padEnd(8)} "${o.q.slice(0, 26)}" ${o.prev} → ${o.now} words (${o.ratio.toFixed(2)}), overlap ${o.overlap.toFixed(2)}${o.notice ? ', notice' : ''} ${o.met ? 'MET' : 'not met'}`);
}
