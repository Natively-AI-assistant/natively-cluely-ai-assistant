// E28b: as E28 (the "# Evidence" section first, so the pack is a cacheable prefix), and the question section is
// repeated, word for word, as the last thing in the request. Nothing else changes.
import { oneMeeting } from './e28-one-meeting.mjs';
import { evidenceFirst } from './e28-evidence-first.mjs';
export function questionBlock(user) {
  const i = user.indexOf('# Question\n'); if (i < 0) return null;
  const rest = user.slice(i + '# Question\n'.length); const j = rest.search(/\n\n# /);
  return (j < 0 ? rest : rest.slice(0, j)).trim();
}
export function transform({ system, user }) {
  const u = oneMeeting(user); const q = questionBlock(u); const first = evidenceFirst(u);
  return { system, user: q && first !== u ? `${first.trimEnd()}\n\n# The question again (answer this)\n${q}` : first };
}
