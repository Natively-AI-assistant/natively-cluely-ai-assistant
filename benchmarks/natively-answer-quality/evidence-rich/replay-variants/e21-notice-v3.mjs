// E21 stage three, arm n3: a lighter notice for turns that carry documents and that the word list does not reach.
// It keeps the working step and drops what the stage-two failures point at: main's sentences about a disputed
// amount, "use only numbers stated above" and "if the numbers do not reconcile, say so". Its last sentence says that
// a fact stated in the material needs no working and that the answer stays complete.
import { insertNotice } from './e21-notice-v1.mjs';
export const NOTICE = '# Calculation\n'
  + 'If answering needs arithmetic (a total, a split, a per-unit cost, a percentage, a weighted score, a count, a date or deadline counted from another date, '
  + 'or a length of time), work it out first inside [[CALC]] and [[/CALC]], one step per line as `name = expression = result`: each figure first, then each step, '
  + 'the name saying whose quantity it is (`each_share = (90 + 30) / 2 = 60`). Count days across a month end in steps '
  + '(`days_left_in_may = 31 - 20 = 11`, `day_in_june = 30 - 11 = 19`) and business days one weekday per line. The last line must answer exactly what was asked; '
  + 'then answer from it. The block is removed before anyone sees it. If the answer is a fact stated above, there is nothing to work out: '
  + 'answer as you otherwise would, with everything the question needs.';
export function transform({ system, user }) { return { system, user: insertNotice(user, NOTICE) }; }
