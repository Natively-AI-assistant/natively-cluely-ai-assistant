#!/usr/bin/env node
// Objective check of an EXPLICIT shape the request states: a count ("3 questions", "two lines", "one sentence"),
// a word limit ("under 40 words"), a spoken duration ("thirty second"), "one-liner". Measured on the shown reply.
//   node tools/shape-check.mjs results/<run> [...] [--aggregate]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); const agg = args.includes('--aggregate');
const NUM = { a: 1, an: 1, one: 1, single: 1, two: 2, couple: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, sixty: 60, ninety: 90 };
const num = (t) => (/^\d+$/.test(t) ? Number(t) : NUM[String(t).toLowerCase()]);
const N = '(\\d+|a|an|one|single|two|couple|three|four|five|six|seven|eight|ten|fifteen|twenty|thirty|forty|forty-five|sixty|ninety)';
const strip = (s) => String(s ?? '').replace(/\n*\s*\[\[GIST\]\][\s\S]*$/, '').trim();
const words = (s) => strip(s).replace(/\*\*/g, '').split(/\s+/).filter(Boolean).length;
const sentences = (s) => strip(s).replace(/\*\*/g, '').split(/(?<=[.!?])\s+(?=[A-Z"“'(\[])/).filter((x) => x.trim()).length;
const lines = (s) => strip(s).split('\n').filter((x) => x.trim()).length;
const listItems = (s) => strip(s).split('\n').filter((x) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(x)).length;
const questions = (s) => (strip(s).match(/\?/g) ?? []).length;
export function constraintsOf(q) {
  const out = []; const t = String(q ?? '');
  let m;
  if ((m = t.match(new RegExp(`\\b${N}[- ]+(?:quick |short |good |sharp |key |main |open |discovery |follow-?up |clarifying |concrete |more )*(questions?)\\b`, 'i'))) && num(m[1])) out.push({ kind: 'questions', n: num(m[1]) });
  if ((m = t.match(new RegExp(`\\b${N}[- ]+(?:short |quick |clean |tight |crisp )*(lines?)\\b`, 'i'))) && num(m[1])) out.push({ kind: 'lines', n: num(m[1]) });
  if ((m = t.match(new RegExp(`\\b${N}[- ]+(?:short |quick |clean |tight |crisp |simple )*(sentences?)\\b`, 'i'))) && num(m[1])) out.push({ kind: 'sentences', n: num(m[1]) });
  if ((m = t.match(new RegExp(`\\b${N}[- ]+(?:short |quick |key |main |concrete |good |talking )*(bullets?|bullet points?|points?|options?|ideas?|reasons?|examples?|topics?|steps?|things|takeaways?|action items?)\\b`, 'i'))) && num(m[1])) out.push({ kind: 'items', n: num(m[1]) });
  if ((m = t.match(new RegExp(`\\b(?:under|within|at most|max(?:imum)?|no more than|less than|in)\\s+${N}\\s+words\\b`, 'i'))) && num(m[1])) out.push({ kind: 'words', n: num(m[1]) });
  if ((m = t.match(new RegExp(`\\b${N}[- ]+(seconds?|sec|minutes?|min)\\b`, 'i'))) && num(m[1])) out.push({ kind: 'seconds', n: num(m[1]) * (/^min/i.test(m[2]) ? 60 : 1) });
  if (/\bone[- ]liner\b/i.test(t)) out.push({ kind: 'sentences', n: 1 });
  return out;
}
export function measure(c, answer) {
  if (c.kind === 'questions') { const got = questions(answer); return { got, ok: got === c.n }; }
  if (c.kind === 'lines') { const got = lines(answer); const s = sentences(answer); return { got: `${got} lines / ${s} sentences`, ok: got === c.n || s === c.n }; }
  if (c.kind === 'sentences') { const got = sentences(answer); return { got, ok: got <= c.n }; }
  if (c.kind === 'items') { const got = listItems(answer); return { got: got || `no list (${sentences(answer)} sentences)`, ok: got === c.n || (got === 0 && sentences(answer) === c.n) }; }
  if (c.kind === 'words') { const got = words(answer); return { got, ok: got <= c.n * 1.1 }; }
  if (c.kind === 'seconds') { const got = words(answer); const lo = c.n * 1.6, hi = c.n * 3.2; return { got: `${got} words (${Math.round(got / 2.5)} s)`, ok: got >= lo && got <= hi }; }
  return { got: null, ok: true };
}
if (import.meta.url === `file://${process.argv[1]}`) for (const dir of args.filter((a) => !a.startsWith('--'))) {
  const d = path.resolve(ROOT, dir);
  const header = JSON.parse(fs.readFileSync(path.join(d, 'run.json'), 'utf8'));
  const items = Object.fromEntries(JSON.parse(fs.readFileSync(path.resolve(ROOT, header.dataset_file), 'utf8')).items.map((i) => [i.id, i]));
  const rows = fs.readFileSync(path.join(d, 'natively_benchmark_full.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const out = [];
  for (const r of rows) { const it = items[r.benchmark_id]; if (!it) continue; for (const c of constraintsOf(it.question)) { const m = measure(c, r.rendered_answer ?? r.raw_answer); out.push({ id: r.benchmark_id, surface: it.surface, c, ...m, q: String(it.question).replace(/\s+/g, ' ') }); } }
  const by = {}; for (const o of out) { const k = (by[o.c.kind] ??= [0, 0]); k[0]++; if (o.ok) k[1]++; }
  console.log(`\n${path.basename(d)} — explicit shape constraints: ${out.length}, met ${out.filter((o) => o.ok).length} | ${Object.entries(by).map(([k, v]) => `${k} ${v[1]}/${v[0]}`).join(', ')}`);
  if (!agg) for (const o of out) console.log(`  ${o.ok ? 'ok ' : 'NOT'} ${o.id.padEnd(11)} ${o.surface.padEnd(6)} ${o.c.kind} ${o.c.n} → ${o.got} | ${o.q.slice(0, 110)}`);
}
