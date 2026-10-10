// E20: two dated versions of one document are not a conflict to put to the other person.
// No wording changes. A rail on the pass's own output: when its CONFLICT line labels every value with a version number
// or an effective date, those labels differ, and it listed nothing unsupported, the edit exists only to say "given two
// ways … needs confirming" about a value the newer version settles, so the draft stands.
// A conflict between two documents that are both current carries no such pair of labels and is left to the pass.
const VERSION = /\b(?:v|ver\.?|version)\s*(\d+(?:\.\d+)*)\b/gi;
const EFFECTIVE = /\beffective\s+(?:from\s+|on\s+)?(\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})/gi;
const labels = (re, t) => [...String(t).matchAll(re)].map((m) => m[1].toLowerCase().replace(/[.,]/g, (c) => (c === '.' ? '.' : '')).replace(/\s+/g, ' '));

/** The text after "CONFLICT:" in the pass's scratch, or null when it is "none" or absent. */
export function conflictText(scratch) {
  const m = String(scratch ?? '').replace(/\s+/g, ' ').match(/CONFLICT\s*:\s*(.*)$/i);
  const t = m ? m[1].trim() : '';
  return !t || /^none\b/i.test(t) ? null : t;
}
export const listedNothing = (scratch) => /UNSUPPORTED\s*:\s*none\b/i.test(String(scratch ?? ''));

/** True when every value the CONFLICT line names carries a version number or an effective date, and they differ. */
export function conflictIsBetweenVersions(scratch) {
  const t = conflictText(scratch);
  if (!t) return false;
  const sides = t.split(/\s+(?:vs\.?|versus)\s+|\s*\|\s*/i).map((s) => s.trim()).filter(Boolean);
  if (sides.length < 2) return false;
  for (const re of [VERSION, EFFECTIVE]) {
    const per = sides.map((s) => labels(re, s));
    if (per.every((l) => l.length > 0) && new Set(per.flat()).size >= 2) return true;
  }
  return false;
}

export function accept(verdict, ctx) {
  if (!verdict.changed) return verdict;
  if (!listedNothing(ctx.scratch) || !conflictIsBetweenVersions(ctx.scratch)) return verdict;
  return { text: ctx.row.raw_answer, changed: false, outcome: 'conflict_between_versions' };
}
