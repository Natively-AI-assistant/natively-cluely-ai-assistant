#!/usr/bin/env node
/**
 * wta-read-session.mjs — turn a shadow-session log into a readable conversation.
 *
 *   node scripts/audit/wta-read-session.mjs                 # newest session
 *   node scripts/audit/wta-read-session.mjs <path/to.log>
 *   node scripts/audit/wta-read-session.mjs --full          # untruncated answers
 *   node scripts/audit/wta-read-session.mjs --md > out.md   # markdown export
 *
 * The session log carries every question and answer, but as single-line JSON
 * ([TRACE:ANSWER] wta_answer {...}) inside a multi-megabyte file — so scrolling
 * it shows nothing readable. This prints just the conversation: what was asked,
 * how the detector scored it, how it routed, and what was actually answered.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
const FULL = args.includes('--full');
const MD = args.includes('--md');
const target = args.find((a) => !a.startsWith('--'))
  || path.join(os.homedir(), 'wta-shadow-logs', 'latest.log');

if (!fs.existsSync(target)) {
  console.error(`No log at ${target}\nRun a session first, or pass a path.`);
  process.exit(1);
}

const text = fs.readFileSync(target, 'utf8');
const grab = (re) => [...text.matchAll(re)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean);

const answers = grab(/TRACE:ANSWER\] wta_answer (\{.*\})/g);
const ledger = grab(/TRACE:LEDGER\] ledger_parity_check (\{.*\})/g);

if (!answers.length) {
  console.error(`No [TRACE:ANSWER] entries in ${path.basename(target)}.`);
  console.error('The launcher sets NATIVELY_TRACE_ANSWERS=1; a session started before that flag existed will not have them.');
  process.exit(2);
}

const clip = (s, n) => (FULL || String(s).length <= n ? String(s) : `${String(s).slice(0, n)}…`);
const gate = (c) => (c >= 0.75 ? 'both gates' : c >= 0.6 ? 'grounding' : 'below gates');

if (MD) {
  console.log(`# WTA session — ${path.basename(target)}\n`);
  console.log(`${answers.length} presses\n`);
  answers.forEach((a, i) => {
    console.log(`## ${i + 1}. ${a.answerType} · conf ${a.questionConfidence} (${gate(a.questionConfidence)})\n`);
    console.log(`**Q:** ${a.question || '(none extracted)'}\n`);
    console.log(`**A:** ${clip(a.answer, 100000)}\n`);
  });
  process.exit(0);
}

const B = '\x1b[1m'; const D = '\x1b[2m'; const G = '\x1b[32m'; const Y = '\x1b[33m'; const R = '\x1b[31m'; const X = '\x1b[0m';
const colour = (c) => (c >= 0.75 ? G : c >= 0.6 ? Y : R);

console.log(`\n${B}${path.basename(target)}${X}  ${answers.length} presses\n`);
answers.forEach((a, i) => {
  const c = a.questionConfidence;
  console.log(`${B}── ${i + 1}.${X} ${colour(c)}conf ${c}${X} ${D}${gate(c)} · ${a.answerType} · profile:${a.profileContextPolicy} · ${a.answerChars} chars${X}`);
  console.log(`   ${B}Q:${X} ${clip(a.question || '(none extracted)', 160)}`);
  console.log(`   ${B}A:${X} ${clip(String(a.answer).replace(/\n+/g, ' ⏎ '), 320)}`);
  console.log('');
});

const cleared = answers.filter((a) => a.questionConfidence >= 0.6).length;
const grounded = answers.filter((a) => a.candidateProfileChars > 0).length;
console.log(`${B}summary${X}`);
console.log(`  clear the 0.6 grounding gate : ${cleared}/${answers.length} (${Math.round((100 * cleared) / answers.length)}%)`);
console.log(`  profile chars attached       : ${grounded}/${answers.length}`);
if (ledger.length) {
  const parity = ledger.filter((l) => l.reason === 'ledger_parity').length;
  const diverge = ledger.filter((l) => String(l.reason).startsWith('ledger_divergence')).length;
  console.log(`  ledger parity / divergence   : ${parity} / ${diverge}`);
}
const types = {};
for (const a of answers) types[a.answerType] = (types[a.answerType] || 0) + 1;
console.log(`  answer types                 : ${Object.entries(types).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}×${v}`).join(', ')}`);
console.log('');
