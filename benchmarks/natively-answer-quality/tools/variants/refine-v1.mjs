// A typed refinement of the previous reply ("shorter", "simpler please", "another one, less pushy") comes back as a
// near-copy: the composer marks it "(rephrasing request: how to phrase the answer to …)" and the model answers the
// earlier question again at the same length (DSALES-033 "shorter": 50 → 49 words; DSEM-040 94 → 94). The judge reads
// it as the request not met (6.5–7.9). The notice names the previous reply as the thing to revise and gives a word
// budget computed from it.
const words = (s) => String(s ?? '').replace(/\*\*/g, '').split(/\s+/).filter(Boolean).length;
export const KIND = [
  ['shorter', /\b(?:shorter|short version|shorten|tighter|more concise|briefer|trim it|cut it down|one[- ]liner)\b/i],
  ['simpler', /\b(?:simpler|simple words|plain(?:er)? (?:english|words)|easier|eli5|dumb it down|less technical)\b/i],
  ['another', /\b(?:another one|a different one|one more|try again|give me another|something else)\b/i],
];
export function refineNotice(request, previousReply) {
  const kind = KIND.find(([, re]) => re.test(request))?.[0];
  const n = words(previousReply);
  if (!kind || n < 8) return null;
  const head = `# Revise your previous reply\nThe user's message "${String(request).trim()}" is about your LAST reply above (${n} words), not a new question. Do not answer the earlier question afresh.`;
  if (kind === 'shorter') return `${head}\nGive the same reply in at most ${Math.max(8, Math.ceil(n / 2))} words: keep what it says, cut the lead-in, the hedges and anything said twice. Output only the shorter reply.`;
  if (kind === 'simpler') return `${head}\nSay the same thing in plainer words and shorter sentences, in at most ${Math.max(12, Math.ceil(n * 0.7))} words: no jargon the listener would have to look up, no step-by-step detail they did not ask for. Output only the simpler reply.`;
  return `${head}\nGive a DIFFERENT one that applies the change they asked for: do not reuse the sentences or the angle of the last reply. Output only the new reply.`;
}
export function previousReplyOf(user) {
  const convo = String(user).split(/\n# Evidence\b/)[0];
  const m = [...convo.matchAll(/(?:^|\n)(?:Assistant|\[ASSISTANT \(PREVIOUS SUGGESTION\)\]): ([\s\S]*?)(?=\n(?:User|Assistant|Question heard in the meeting|\[[A-Z ()]+\]):|\n# |$)/g)].pop();
  return m ? m[1].replace(/\n*\s*\[\[GIST\]\][\s\S]*$/, '').trim() : '';
}
export function transform({ system, user, item }) {
  if (!/\(rephrasing request: /.test(user)) return { system, user }; // the app adds it only on resolver-marked turns
  const q = String(user).match(/# Question\n([^\n]*)/)?.[1] ?? '';
  const request = q.replace(/\s*\((?:rephrasing request|referring to|follow-up to)[\s\S]*$/, '');
  const notice = refineNotice(request, previousReplyOf(user));
  if (!notice) return { system, user };
  // Where the app would put it: with the other per-turn notices, after the evidence and before the length default.
  const i = user.lastIndexOf('\n\n<presentation_instruction');
  return i < 0 ? { system, user: `${user}\n\n${notice}` } : { system, user: `${user.slice(0, i)}\n\n${notice}${user.slice(i)}` };
}
