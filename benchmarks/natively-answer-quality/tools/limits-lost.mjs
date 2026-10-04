#!/usr/bin/env node
// An honest LIMIT the draft states ("I can't confirm a credit on this call", "we didn't measure colonies", "I don't
// have the reporting line in front of me") and the verifier's edit removed, per mode. Not every loss is bad (a hedge
// before "I'll confirm and follow up" is noise); the ones that matter leave the question unanswered.
//   node tools/limits-lost.mjs results/<run> [...] [--list]         (in-app run: raw_answer → rendered_answer)
//   node tools/limits-lost.mjs --replay results/replay/<name>.jsonl [...] [--list]
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const replay = args.includes('--replay'); const list = args.includes('--list');
const files = args.filter((a) => !a.startsWith('--'));
const strip = (s) => String(s ?? '').replace(/\n*\s*\[\[GIST\]\][\s\S]*$/, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
export const LIMIT_RE = /\b(?:(?:I|we) (?:can'?t|cannot|won'?t|am not able to|are not able to|'m not able to|'re not able to) (?:confirm|promise|guarantee|give you|say|speak to|tell you|quote|commit|authori[sz]e|send|share|give out|see|access|log into|action)|(?:did not|didn'?t|haven'?t|have not) (?:measure|measured|test|tested|collect|collected|look at|looked at|study|studied|include|included|run|track|tracked)|(?:don'?t|do not) have [^.?!]{0,60}(?:in front of me|to hand|on hand|yet)|not (?:something|a number|a date) I can|(?:wasn'?t|was not|isn'?t|is not|weren'?t) (?:measured|tested|collected|part of (?:the|this) study|in (?:the|this) (?:study|paper|data)))\b/i;
for (const f of files) {
  const rows = fs.readFileSync(replay ? f : path.join(f, 'natively_benchmark_full.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .map((r) => (replay ? { id: r.id, mode: r.mode, draft: r.original, final: r.answer, q: r.question } : { id: r.benchmark_id, mode: r.mode, draft: r.raw_answer, final: r.rendered_answer ?? r.raw_answer, q: r.question }));
  const by = {}; const lost = [];
  for (const r of rows) {
    const d = strip(r.draft), x = strip(r.final);
    for (const k of [r.mode, 'ALL']) {
      const m = (by[k] ??= { n: 0, limit: 0, edited: 0, lost: 0 });
      m.n++; if (!LIMIT_RE.test(d)) continue; m.limit++;
      if (d !== x) m.edited++;
      if (d !== x && !LIMIT_RE.test(x)) { m.lost++; if (k !== 'ALL') lost.push(r); }
    }
  }
  console.log(`\n${path.basename(f)}`);
  console.log('| mode | n | drafts with a limit | of those edited | limit gone |');
  console.log('|---|---:|---:|---:|---:|');
  for (const [k, m] of Object.entries(by).sort((a, b) => (a[0] === 'ALL') - (b[0] === 'ALL'))) if (m.limit) console.log(`| ${k} | ${m.n} | ${m.limit} | ${m.edited} | ${m.lost} |`);
  if (list) for (const r of lost) console.log(`\n=== ${r.id} [${r.mode}] Q: ${strip(r.q).slice(0, 160)}\nDRAFT: ${strip(r.draft).slice(0, 420)}\nFINAL: ${strip(r.final).slice(0, 420)}`);
}
