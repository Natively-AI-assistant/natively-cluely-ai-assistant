// node --experimental-strip-types tests/live-answer/report.mjs tests/live-answer/results/<label>.jsonl [--full]
import fs from 'node:fs';
import { evaluate } from './evaluate.mjs';
const file = process.argv[2]; const full = process.argv.includes('--full');
const recs = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const pct = (a, f) => a.length ? Math.round(100 * a.filter(f).length / a.length) + '%' : '-';
const avg = (a, f) => a.length ? (a.reduce((s, x) => s + f(x), 0) / a.length).toFixed(1) : '-';
const groups = {};
for (const r of recs) {
  r.ev = evaluate(r.final, { kind: r.kind });
  (groups[`${r.surface} | ${r.model} | ${r.mode}`] ||= []).push(r);
}
console.log(`file=${file} records=${recs.length} errors=${recs.filter(r => !r.ok).length}`);
console.log('group'.padEnd(46), 'n   words  sec   >80w  >150w coach follow meta head/bul labels quote discl claim* invent commit stall dup  speakable');
for (const [g, a] of Object.entries(groups)) {
  const ok = a.filter(r => r.ok);
  console.log(g.padEnd(46), String(ok.length).padEnd(3), avg(ok, r => r.ev.words).padStart(5), avg(ok, r => r.ev.seconds).padStart(5),
    pct(ok, r => r.ev.words > 80).padStart(5), pct(ok, r => r.ev.words > 150).padStart(5), pct(ok, r => r.ev.coaching).padStart(5), pct(ok, r => r.ev.followup).padStart(6),
    pct(ok, r => r.ev.meta).padStart(5), pct(ok, r => r.ev.headings || r.ev.bullets).padStart(8), pct(ok, r => r.ev.labels).padStart(6),
    pct(ok, r => r.ev.quoteWrapped || r.ev.quotedScript).padStart(5), pct(ok, r => r.ev.disclaimerOpen).padStart(5), pct(ok, r => r.ev.personalClaim).padStart(6), pct(ok, r => r.ev.inventedContext).padStart(6), pct(ok, r => r.ev.commitment).padStart(6), pct(ok, r => r.ev.stall).padStart(5),
    pct(ok, r => r.ev.duplicate).padStart(4), pct(ok, r => r.ev.speakable).padStart(9));
}
if (full) for (const r of recs) {
  const e = r.ev;
  const flags = ['coaching', 'followup', 'meta', 'headings', 'bullets', 'labels', 'quoteWrapped', 'quotedScript', 'disclaimerOpen', 'personalClaim', 'inventedContext', 'commitment', 'stall', 'duplicate', 'code'].filter(k => e[k]);
  console.log(`\n### ${r.id} [${r.surface} ${r.model} #${r.sample}] ${r.q}\n${e.words}w ~${e.seconds}s ${e.sentences}sent ${e.paragraphs}para ${r.ms}ms flags=[${flags.join(',')}] ${e.speakable ? 'SPEAKABLE' : 'NOT-SPEAKABLE'}${e.gist ? ` gist="${e.gist}"` : ''}\n${r.ok ? r.final : 'ERROR ' + r.err}`);
}
