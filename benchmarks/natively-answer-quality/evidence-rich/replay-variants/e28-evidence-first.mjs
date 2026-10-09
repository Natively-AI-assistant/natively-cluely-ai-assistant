// E28 arm: the same request with the "# Evidence" section moved to the top of the user message, before the question
// and the conversation. Nothing else changes: same sections, same text, same order otherwise. A whole reference pack
// is byte-identical from turn to turn inside a meeting, so placed first it is a prefix the provider can cache.
import { oneMeeting } from './e28-one-meeting.mjs';
export function evidenceFirst(user) {
  const i = user.indexOf('# Evidence');
  if (i <= 0 || user[i - 1] !== '\n') return user;
  // The section ends at its last </evidence> tag: a document's own text may hold lines that start with "# ".
  const end = user.lastIndexOf('</evidence>');
  if (end < i) return user;
  const stop = end + '</evidence>'.length;
  const block = user.slice(i, stop); const after = user.slice(stop);
  return `${block}\n\n${user.slice(0, i).trimEnd()}${after}`;
}
export function transform({ system, user }) { return { system, user: evidenceFirst(oneMeeting(user)) }; }
