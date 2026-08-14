/**
 * dump-by-mode.mjs — emits human-readable Q&A markdown grouped by mode for manual
 * analysis. Writes one file per mode (results-<mode>.md) + a master index
 * (results-by-mode.md).
 *
 * NOTE ON ANSWER TEXT: the run persisted a 320-char REDACTED preview per row
 * (actual_answer_preview), not the full streamed answer (to keep the 7000-row JSONL
 * bounded). So the "Answer" below is that preview. Re-run with full-capture if you
 * need complete text.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', '..', '..', 'test-results', 'intelligence-e2e-7000-minimax');

const rows = fs.readFileSync(path.join(OUT, 'results-all.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

const MODES = ['looking-for-work', 'technical-interview', 'sales', 'team-meet', 'lecture', 'recruiting', 'general'];
const DIFF_ORDER = { easy: 0, medium: 1, difficult: 2 };

function statusOf(r) {
  if (!r.clean_scored || r.provider_empty || r.error) return r.provider_stall ? 'STALL' : (r.error ? 'ERROR' : 'UNAVAIL');
  return r.pass ? 'PASS' : 'FAIL';
}

const index = [];
index.push('# MiniMax-M2.7 7000-run — Questions & Responses by Mode');
index.push('');
index.push('> **Answer text is a 320-char redacted preview** (`actual_answer_preview`) — the run did');
index.push('> not persist full streamed answers (JSONL size). Profile PII is redacted in the preview.');
index.push('> STALL = WhatToAnswer graceful-retry (quarantined, not scored). UNAVAIL = rate-limited.');
index.push('');
index.push('| mode | rows | PASS | FAIL | STALL/UNAVAIL | file |');
index.push('|---|---:|---:|---:|---:|---|');

for (const mode of MODES) {
  const set = rows.filter((r) => r.mode === mode).sort((a, b) => (DIFF_ORDER[a.difficulty] - DIFF_ORDER[b.difficulty]) || String(a.id).localeCompare(b.id));
  const pass = set.filter((r) => statusOf(r) === 'PASS').length;
  const fail = set.filter((r) => statusOf(r) === 'FAIL').length;
  const other = set.length - pass - fail;
  const file = `results-${mode}.md`;
  index.push(`| ${mode} | ${set.length} | ${pass} | ${fail} | ${other} | [${file}](${file}) |`);

  const L = [];
  L.push(`# ${mode} — Questions & Responses (${set.length} rows)`);
  L.push('');
  L.push(`PASS ${pass} · FAIL ${fail} · STALL/UNAVAIL ${other}. Answer = 320-char redacted preview.`);
  L.push('');
  let curDiff = null;
  let n = 0;
  for (const r of set) {
    if (r.difficulty !== curDiff) { curDiff = r.difficulty; L.push(`\n## ${curDiff}\n`); }
    n++;
    const st = statusOf(r);
    L.push(`### ${n}. [${st}] ${r.id} — \`${r.answer_type}\`${r.surface === 'what_to_answer' ? ' · WTA' : ''}`);
    L.push(`**Q:** ${r.question}`);
    if (r.surface === 'what_to_answer' && Array.isArray(r.transcriptWindow)) { /* transcript not stored in results; skip */ }
    L.push('');
    L.push(`**A:** ${r.actual_answer_preview || '(empty)'}`);
    if (st === 'FAIL' && r.failure_reason) L.push(`\n> ⚠️ **fail:** ${r.failure_reason}`);
    L.push('');
  }
  fs.writeFileSync(path.join(OUT, file), L.join('\n') + '\n');
}

fs.writeFileSync(path.join(OUT, 'results-by-mode.md'), index.join('\n') + '\n');
console.log(`wrote results-by-mode.md (index) + ${MODES.length} per-mode files to ${OUT}`);
for (const mode of MODES) { const f = path.join(OUT, `results-${mode}.md`); console.log(`  results-${mode}.md  ${(fs.statSync(f).size / 1024).toFixed(0)} KB`); }
