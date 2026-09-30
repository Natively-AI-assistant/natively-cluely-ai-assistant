// "Use the specifics": when evidence is attached, the figure / date / limit / window / step the answer turns on is said
// exactly, not paraphrased. Judge (I5 dev, uncapped sub-9.5 answers): "include ±0.3", "the 92.0% accuracy", "the
// 48-hour wait", "3–5 business days", "update to 6.3 then clear the cache", "up to 10 business days" — 47 of 131
// suggestions ADD a specific the material held; 15 cut.
export const SECTION = '# Use the specifics\nWhere the evidence gives the figure, date, limit, window, version or step that the answer turns on, say it exactly (the number itself, the named step), not a paraphrase such as "a few days" or "some checks". Only the one or two specifics that answer this question; do not recite the document.';
export function transform({ system, user }) {
  if (!/<evidence\b/.test(user)) return { system, user };
  const i = user.lastIndexOf('</evidence>');
  const j = i + '</evidence>'.length;
  return { system, user: `${user.slice(0, j)}\n\n${SECTION}${user.slice(j)}` };
}
