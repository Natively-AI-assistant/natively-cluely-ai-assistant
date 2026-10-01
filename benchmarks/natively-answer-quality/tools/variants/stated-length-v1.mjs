// The QUESTION states its own length — "a 60 second version", "a thirty second thank-you", "a two-line text" — and
// the app still sends its default: "aim for about 22s spoken — roughly 40 to 60 words … Hard ceiling: never go past
// 75 words". DJOB-015 ("60 second version"): 78 words, about half the time asked for. User INSTRUCTIONS already
// outrank the app's length default (userInstructionsOverrideAppLength); a length stated in the message did not.
// The notice replaces the default block with the user's own target.
const NUM = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, sixty: 60, ninety: 90 };
const num = (t) => (/^\d+$/.test(t) ? Number(t) : NUM[String(t).toLowerCase()]);
const N = '(\\d+|a|one|two|three|four|five|ten|fifteen|twenty|thirty|forty|forty-five|sixty|ninety)';
const DELIVERABLE = '(?:version|pitch|intro(?:duction)?|summary|answer|thank[- ]you|overview|update|recap|explanation|opening|opener|closing|close|story|speech|toast|walkthrough|rundown)';
const DURATION_RE = new RegExp(`\\b${N}[- ]+(second|sec|minute|min)s?[- ]+(?:[a-z]+ ){0,2}?${DELIVERABLE}\\b|\\b${N}[- ]+(second|sec|minute|min)s? (?:on|about|of)\\b|\\bin ${N}[- ]+(second|sec|minute|min)s?\\b`, 'i');
const LINES_RE = new RegExp(`\\b${N}[- ]+lines?\\b(?! of code)`, 'i');
export function statedLength(question) {
  const q = String(question ?? '').replace(/\s*\((?:rephrasing request|referring to|follow-up to)[\s\S]*$/, '');
  let m = q.match(DURATION_RE);
  if (m) { const g = m.slice(1).filter(Boolean); const n = num(g[0]); const unit = g[1]; const s = n * (/^min/i.test(unit) ? 60 : 1); if (s >= 10 && s <= 180) return { kind: 'seconds', seconds: s }; }
  m = q.match(LINES_RE);
  if (m && num(m[1]) >= 1 && num(m[1]) <= 6) return { kind: 'lines', lines: num(m[1]) };
  return null;
}
export function statedLengthNotice(question) {
  const s = statedLength(question); if (!s) return '';
  const body = s.kind === 'seconds'
    ? `LENGTH: the user asked for about ${s.seconds} seconds spoken — roughly ${Math.round(s.seconds * 2)} to ${Math.round(s.seconds * 2.7)} words. Fill that time with substance and stop there: not a shorter answer, not a longer one.`
    : `FORM: the user asked for ${s.lines === 1 ? 'one line' : `${s.lines} lines`}. That part of the reply is exactly ${s.lines === 1 ? 'one short sentence on its own line' : `${s.lines} short sentences, each on its own line`}; anything else they asked for in the same message follows on its own lines.`;
  return `<presentation_instruction note="Length the user asked for in this message. It replaces the app default.">\n${body}\n</presentation_instruction>`;
}
const DEFAULT_BLOCK_RE = /\n*<presentation_instruction note="App default for length[^"]*">[\s\S]*?<\/presentation_instruction>/;
export function transform({ system, user }) {
  const q = String(user).match(/# Question\n([^\n]*)/)?.[1] ?? '';
  const notice = statedLengthNotice(q); if (!notice) return { system, user };
  return { system, user: `${String(user).replace(DEFAULT_BLOCK_RE, '')}\n\n${notice}` };
}
