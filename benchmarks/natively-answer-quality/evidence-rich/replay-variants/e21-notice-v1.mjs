// E21a arm n1: the calculation notice exactly as on main (prompt-composer.ts CALCULATION_NOTICE, 73b18d97), placed
// where the composer puts it (after the "# Today" section), on a recorded prompt that did not carry it.
export const NOTICE = '# Calculation\n'
  + 'If answering needs arithmetic (a total, a split, a per-unit cost, a percentage, a count, or whether an amount is consistent with what was said), '
  + 'work it out first inside [[CALC]] and [[/CALC]], one step per line as `name = expression = result`: first each figure the answer depends on, '
  + 'including any the other person just stated (`nights_stayed = 5`), then each step, the name saying whose quantity it is '
  + '(`each_share = (90 + 30) / 2 = 60`, `jo_owes_sam = 60 - 30 = 30`). Use only numbers stated above. When an amount is asked about or disputed, '
  + 'also work out what the stated facts allow (the most those days, units or people could come to) and compare the two. The last line must answer exactly '
  + 'what was asked. Then answer from those results, and if the numbers do not reconcile, say so plainly. The block is removed before anyone sees it. '
  + 'Skip it for a direct lookup of one stated figure.';
export function insertNotice(user, notice) {
  if (/# Calculation\n/.test(user)) return user;
  const m = user.match(/# Today\n[^\n]*\n\n/);
  if (m) { const at = m.index + m[0].length; return `${user.slice(0, at)}${notice}\n\n${user.slice(at)}`; }
  const p = user.indexOf('<presentation_instruction');
  return p >= 0 ? `${user.slice(0, p)}${notice}\n\n${user.slice(p)}` : `${user}\n\n${notice}`;
}
export function transform({ system, user }) { return { system, user: insertNotice(user, NOTICE) }; }
