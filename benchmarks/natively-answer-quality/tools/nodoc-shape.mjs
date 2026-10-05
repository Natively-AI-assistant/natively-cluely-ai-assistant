#!/usr/bin/env node
// Objective shape counts for the no-document Call Center / Sales replies, on the rows a variant touches (rows that
// carry base's answer are left out) — the patterns the 2026-10-01 measurements used, kept in one place so the
// all-turns and heard-only sets are counted with the same instrument.
//   node tools/nodoc-shape.mjs <cc|sales> <base replay> <variant replay>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [kind, base, variant] = process.argv.slice(2);
const s = (x) => String(x || '').replace(/\n*\s*\[\[GIST\]\][\s\S]*$/, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
const load = (n) => fs.readFileSync(path.join(ROOT, 'results', 'replay', `${n}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const PATTERNS = {
  cc: {
    'asks for a verification detail': /\b(account number|date of birth|verify (you|the account|your)|billing zip|zip code|email (address )?on the account|phone number (on|we have)|confirm (your|the account holder'?s?) (name|identity)|pull (that|it|the account) up|identifier)\b/i,
    'states the limit plainly': /\b(can'?t|cannot|can not) (yet )?(confirm|promise|guarantee)|not (yet )?(able to|something I can) confirm\b/i,
    'names what will be checked': /\b(I'?ll|let me) (check|find out|look into|verify whether|confirm whether)\b/i,
  },
  sales: {
    'preamble about not answering': /\b(I don'?t want to (guess|quote)|I can'?t (quote|go to|give)|let me be straight|I'?d rather (not|earn|be straight)|before I put a number)\b/i,
    '"depends on"': /\bit depends on|depends on (how|what|your|the)\b/i,
    'a later date': /\b(next call|later this week|tomorrow|by (end of|close of) (day|week))\b/i,
    'says what it will confirm': /\b(let me|I'?ll) confirm\b/i,
  },
}[kind];
if (!PATTERNS || !base || !variant) { console.error('usage: node tools/nodoc-shape.mjs <cc|sales> <base replay> <variant replay>'); process.exit(2); }
const B = Object.fromEntries(load(base).map((r) => [`${r.id}#${r.k ?? 0}`, r]));
const V = load(variant).filter((r) => !r.carried && B[`${r.id}#${r.k ?? 0}`]);
const A = V.map((r) => B[`${r.id}#${r.k ?? 0}`]);
const words = (x) => s(x).split(' ').length; const med = (a) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
const questions = (x) => (s(x).match(/\?/g) || []).length;
console.log(`${variant} vs ${base}: ${V.length} touched rows`);
for (const [label, re] of Object.entries(PATTERNS)) console.log(`  ${label}: ${A.filter((r) => re.test(s(r.answer))).length} → ${V.filter((r) => re.test(s(r.answer))).length}`);
console.log(`  more than one question: ${A.filter((r) => questions(r.answer) > 1).length} → ${V.filter((r) => questions(r.answer) > 1).length}`);
console.log(`  median words: ${med(A.map((r) => words(r.answer)))} → ${med(V.map((r) => words(r.answer)))}`);
console.log(`  edited by the claim pass: ${A.filter((r) => r.outcome === 'edited').length} → ${V.filter((r) => r.outcome === 'edited').length}`);
