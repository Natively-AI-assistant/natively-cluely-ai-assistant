#!/usr/bin/env node
// pack24: does an ADDED document repeat a string the frozen truth depends on?
//
//   node evidence-rich/pack24/check-noninterference.mjs <mode-key>
//
// Frozen needles are every doc_needle of a frozen file's facts and every required or forbidden answer_needle of an
// item in p24.json (the frozen development questions re-issued for the larger pack). A frozen needle with a digit
// that occurs in an added document is a collision: a string check on an old question could then be met, or tripped,
// by text that has nothing to do with it. A needle without a digit is listed for the author to look at.
// Also prints the size of the pack as the app will count it (characters / 4).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2];
if (!mode) { console.error('usage: check-noninterference.mjs <mode-key>'); process.exit(2); }
const dir = path.join(HERE, 'authoring', mode);
const frozenIds = new Set(JSON.parse(fs.readFileSync(path.join(HERE, '..', 'authoring', mode, 'manifest.json'), 'utf8')).files.map((f) => f.id));
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const norm = (s) => String(s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/ /g, ' ').replace(/\s+/g, ' ').toLowerCase();
const read = (f) => fs.readFileSync(path.join(dir, f.source ?? `src/${f.id}.md`), 'utf8');

const needles = new Map();
const add = (n, where) => { const k = norm(n).trim(); if (k.length < 2) return; if (!needles.has(k)) needles.set(k, new Set()); needles.get(k).add(where); };
for (const f of manifest.files) if (frozenIds.has(f.id)) for (const fact of f.facts ?? []) for (const n of fact.doc_needles ?? []) add(n, `${f.id}#${fact.id}`);
const p24 = JSON.parse(fs.readFileSync(path.join(dir, 'p24.json'), 'utf8')).items;
for (const it of p24) {
  for (const r of it.oracle?.required_facts ?? []) for (const n of r.answer_needles ?? []) add(n, `${it.id} required`);
  for (const r of it.oracle?.forbidden_claims ?? []) for (const n of r.answer_needles ?? []) add(n, `${it.id} forbidden`);
  for (const n of it.oracle?.calculation_oracle?.accepted_forms ?? []) add(n, `${it.id} result`);
  for (const n of it.oracle?.calculation_oracle?.wrong_results_common ?? []) add(String(n), `${it.id} wrong result`);
}
// A number is matched as a whole number: "49" is not found inside "1,490" or "0.49".
const occurs = (text, n) => {
  const dS = /^\d/.test(n), dE = /\d$/.test(n);
  for (let i = text.indexOf(n); i !== -1; i = text.indexOf(n, i + 1)) {
    const before = text.slice(Math.max(0, i - 2), i), after = text.slice(i + n.length, i + n.length + 2);
    if (dS && (/\d$/.test(before) || /\d[.,]$/.test(before))) continue;
    if (dE && (/^\d/.test(after) || /^[.,]\d/.test(after))) continue;
    return true;
  }
  return false;
};
let total = 0, added = 0, collisions = 0, looks = 0;
const out = [];
for (const f of manifest.files) {
  const text = read(f); total += text.length;
  if (frozenIds.has(f.id)) continue;
  added += text.length;
  const t = norm(text);
  for (const [n, where] of needles) {
    if (!occurs(t, n)) continue;
    const digit = /\d/.test(n);
    if (digit) collisions++; else looks++;
    out.push(`${digit ? 'COLLISION' : 'look     '} ${f.id}: ${JSON.stringify(n)}  (${[...where].slice(0, 3).join(', ')}${where.size > 3 ? `, +${where.size - 3}` : ''})`);
  }
}
for (const l of out.sort()) console.log(l);
const newFiles = manifest.files.filter((f) => !frozenIds.has(f.id));
console.log(`\n${mode}: ${manifest.files.length} files (${newFiles.length} added), ${total} source characters (${added} added), about ${Math.ceil(total / 4)} tokens as the app counts them`);
console.log(`needles with a digit found in added documents: ${collisions} (must be 0); without a digit: ${looks} (look at each)`);
if (total < 82000 || total > 90000) console.log(`SIZE: the pack must total 82,000 to 90,000 source characters; it is ${total}`);
process.exit(collisions || total > 90000 ? 1 : 0);
