// The files the judge writes while a batch runs, written and read so that a full disk cannot poison a later run.
// 2026-10-02 09:02Z: the data volume was at 0.8 GB free (100 %) two hours before a batch. A write cut short there
// leaves half a line in a .jsonl or half a cache file, and every later run would stop on JSON.parse.
import fs from 'node:fs';
import path from 'node:path';

/** Rows of a .jsonl file. A line that does not parse (a write cut short) is skipped and counted on stderr. */
export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const rows = [];
  let bad = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { bad++; }
  }
  if (bad) console.error(`[store] ${path.basename(file)}: ${bad} unreadable line${bad === 1 ? '' : 's'} skipped`);
  return rows;
}

/** A JSON file, or null when it is missing or does not parse (a cache file cut short counts as not cached). */
export function readJsonOrNull(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** Whole-file write through a temp file and a rename: the target holds the old content or the new, never half. */
export function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  try { fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
}

/** Append one row as one line. After an append that was cut short, start on a fresh line so this row stays readable. */
export function appendLine(file, row) {
  let lead = '';
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const { size } = fs.fstatSync(fd);
      const last = Buffer.alloc(1);
      if (size > 0 && fs.readSync(fd, last, 0, 1, size - 1) === 1 && last[0] !== 10) lead = '\n';
    } finally { fs.closeSync(fd); }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  fs.appendFileSync(file, `${lead}${JSON.stringify(row)}\n`);
}
