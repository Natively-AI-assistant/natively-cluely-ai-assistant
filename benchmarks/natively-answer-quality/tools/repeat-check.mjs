#!/usr/bin/env node
// How much of a follow-up reply repeats the assistant's previous reply in the same conversation. Objective:
// the share of the reply's word 4-grams that already occur in the previous reply (0 = all new, 1 = a copy).
//   node tools/repeat-check.mjs results/<run> [--judged astra/out/<set>/<run>.jsonl] [--threshold 0.4] [--aggregate]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const TH = Number(opt('threshold', 0.4));
const strip = (s) => String(s ?? '').replace(/\n*\s*\[\[GIST\]\][\s\S]*$/, '').replace(/\*\*/g, '').toLowerCase().replace(/[^a-z0-9$%.' ]+/g, ' ').replace(/\s+/g, ' ').trim();
export function repeatShare(reply, previous, n = 4) {
  const grams = (s) => { const w = strip(s).split(' ').filter(Boolean); const g = []; for (let i = 0; i + n <= w.length; i++) g.push(w.slice(i, i + n).join(' ')); return g; };
  const a = grams(reply); if (!a.length) return 0; const b = new Set(grams(previous));
  return a.filter((g) => b.has(g)).length / a.length;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = path.resolve(ROOT, args[0]);
  const rows = fs.readFileSync(path.join(dir, 'natively_benchmark_full.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const shown = (r) => r.rendered_answer ?? r.raw_answer ?? '';
  const judged = opt('judged') ? Object.fromEntries(fs.readFileSync(path.resolve(ROOT, opt('judged')), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((j) => j.ok && j.official).map((j) => [j.benchmark_id, j.official.overall])) : null;
  const byConv = {}; for (const r of rows) if (r.conversation_id) (byConv[r.conversation_id] ??= []).push(r);
  const out = [];
  for (const turns of Object.values(byConv)) { turns.sort((a, b) => a.turn_index - b.turn_index); for (let i = 1; i < turns.length; i++) out.push({ id: turns[i].benchmark_id, mode: turns[i].mode, surface: turns[i].surface_path, share: repeatShare(shown(turns[i]), shown(turns[i - 1])), q: turns[i].question }); }
  const mean = (x) => (x.length ? (x.reduce((p, q) => p + q, 0) / x.length).toFixed(2) : '-');
  const rep = out.filter((o) => o.share >= TH); const fresh = out.filter((o) => o.share < TH);
  console.log(`${path.basename(dir)}: ${out.length} follow-up turns; ${rep.length} repeat at least ${Math.round(TH * 100)}% of the previous reply${judged ? ` (judge mean ${mean(rep.map((o) => judged[o.id]).filter((v) => v != null))} vs ${mean(fresh.map((o) => judged[o.id]).filter((v) => v != null))} for the rest)` : ''}`);
  const by = {}; for (const o of out) { const m = (by[o.mode] ??= { n: 0, r: 0 }); m.n++; if (o.share >= TH) m.r++; }
  console.log(Object.entries(by).sort().map(([m, v]) => `${m} ${v.r}/${v.n}`).join(', '));
  if (!args.includes('--aggregate')) for (const o of rep.sort((a, b) => b.share - a.share)) console.log(`  ${o.id.padEnd(11)} ${o.surface.padEnd(6)} ${Math.round(o.share * 100)}%  ${judged ? (judged[o.id] ?? NaN).toFixed(1) : ''}  ${String(o.q).slice(0, 90).replace(/\n/g, ' ')}`);
}
