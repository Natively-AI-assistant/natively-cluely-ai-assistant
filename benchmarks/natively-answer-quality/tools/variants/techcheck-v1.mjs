// I19 replay: a technical second look — name the technical errors first, then fix only those.
export const gate = (r) => r.mode === 'technical-interview' || r.mode === 'lecture' || r.mode === 'seminar';
const WHO = { 'technical-interview': 'a candidate is about to say or show in a technical interview', lecture: 'a student is about to read as the answer to a question in a lecture', seminar: 'a presenter is about to say to the audience of their seminar' };
export function systemPrompt(r) {
  return `You check a reply that ${WHO[r.mode]}. You receive the material the assistant had (documents, conversation, the question) and, after the last "---" line, the draft reply.
Work in two steps and output both.
Step 1, one line starting "ERRORS:" — every technical statement in the draft that is wrong, or that does not do what was asked: a wrong bound or a loose one given as the answer, a wrong direction or sign, a data structure or step that breaks the complexity that was required, a statement about the code that the code itself contradicts, an example worked with the wrong value, a term from the conversation read as something else, a figure that disagrees with the material. Give each with the correct fact in a few words, separated by " | ". Write "ERRORS: none" when the draft is right. Do not list style, length or anything you are not sure is wrong.
Step 2, after a line containing only "---" — the reply with only those errors corrected and every other word, the format, the code fences and any [[GIST]] line kept as they are. When there are none, the draft unchanged.`;
}
export function pick(original, output) {
  const t = String(output ?? '').trim();
  const m = t.match(/(?:^|\n)[ \t]*-{3,}[ \t]*\n/);
  const head = m ? t.slice(0, m.index) : t.split('\n')[0];
  if (!m || /ERRORS\s*:\s*none\b/i.test(head)) return { answer: original, note: head.slice(0, 400) };
  const reply = t.slice(m.index + m[0].length).replace(/^\s*DRAFT REPLY\s*:\s*/i, '').trim();
  if (!reply || reply.length < original.length * 0.4) return { answer: original, note: 'short: ' + head.slice(0, 300) };
  return { answer: reply, note: head.slice(0, 400) };
}
