// I11 replay: the TODAY line after the evidence, only when the material mentions a date (mirrors todayNotice).
const DATE_MENTION_RE = /\b(?:19|20)\d{2}\b|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.? \d{1,2}(?:st|nd|rd|th)?\b|\b\d{1,2}(?:st|nd|rd|th)? (?:of )?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/i;
const LINE = '# Today\nIt is Wednesday 30 September 2026 where the user is. Read validity dates, deadlines, ages and which version is current against it.';
export function transform({ system, user }) {
  if (!DATE_MENTION_RE.test(user)) return { system, user };
  const i = user.lastIndexOf('</evidence>');
  if (i < 0) return { system, user: `${user}\n\n${LINE}` };
  const j = i + '</evidence>'.length;
  return { system, user: `${user.slice(0, j)}\n\n${LINE}${user.slice(j)}` };
}
