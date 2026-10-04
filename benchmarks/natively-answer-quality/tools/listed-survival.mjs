#!/usr/bin/env node
// For verifier replays that record the scratch: how often a phrase the verifier LISTED is still verbatim in its reply,
// and how often a CONFLICT it named left the reply unedited.   node tools/listed-survival.mjs <replay name> [...]
import fs from 'node:fs';
const norm = (s) => String(s ?? '').toLowerCase().replace(/\*\*/g, '').replace(/[“”"‘’`]/g, '').replace(/\s+/g, ' ').trim();
export function parseScratch(scratch) {
  const u = (String(scratch).match(/UNSUPPORTED\s*:\s*([^\n]*)/i) ?? [, ''])[1];
  const c = (String(scratch).match(/CONFLICT\s*:\s*([^\n]*)/i) ?? [, 'none'])[1].trim();
  const items = u.split('|').map((x) => x.trim()).filter((x) => x && !/^none\b/i.test(x))
    .map((x) => ({ kind: ((x.match(/\[(past|self|promise)\]/i) ?? [])[1] ?? '?').toLowerCase(), text: norm(x.replace(/\[[a-z]+\]/gi, '').replace(/[.…]+$/, '')) }));
  return { items, conflict: !/^none\b/i.test(c) && c.length > 3 };
}
for (const n of process.argv.slice(2)) {
  const R = fs.readFileSync(`results/replay/${n}.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.outcome !== 'not_gated');
  let listed = 0, items = 0, surv = 0, rows = 0, conf = 0, confKept = 0; const out = {};
  for (const r of R) {
    out[r.outcome] = (out[r.outcome] ?? 0) + 1;
    const p = parseScratch(r.scratch); const fin = norm(String(r.answer).replace(/\n*\s*\[\[GIST\]\][\s\S]*$/, ''));
    if (p.conflict) { conf++; if (r.outcome !== 'edited') confKept++; }
    if (!p.items.length) continue; listed++;
    let s = 0; for (const it of p.items) { items++; if (it.text.split(' ').length >= 4 && fin.includes(it.text)) { s++; surv++; } }
    if (s) rows++;
  }
  console.log(`${n}: gated ${R.length} ${JSON.stringify(out)} | rows with a list ${listed} | items ${items}, still verbatim in the reply ${surv} (${rows} rows) | conflicts named ${conf}, reply not edited ${confKept}`);
}
