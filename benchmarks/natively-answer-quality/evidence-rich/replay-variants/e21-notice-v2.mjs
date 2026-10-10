// E21a arm n2: the calculation notice with dates, lengths of time and weighted scores named, and one sentence on how
// to count them. Everything else is main's wording. The examples use figures that are in no benchmark document.
import { insertNotice } from './e21-notice-v1.mjs';
export const NOTICE = '# Calculation\n'
  + 'If answering needs arithmetic (a total, a split, a per-unit cost, a percentage, a weighted score, a count, a date or deadline counted from another date, '
  + 'a length of time, or whether an amount is consistent with what was said), '
  + 'work it out first inside [[CALC]] and [[/CALC]], one step per line as `name = expression = result`: first each figure the answer depends on, '
  + 'including any the other person just stated (`nights_stayed = 5`), then each step, the name saying whose quantity it is '
  + '(`each_share = (90 + 30) / 2 = 60`, `jo_owes_sam = 60 - 30 = 30`). Count days across a month end in steps '
  + '(`days_left_in_may = 31 - 20 = 11`, `day_in_june = 30 - 11 = 19`), business days one weekday per line, and a length of time in months '
  + '(`months = (2025 * 12 + 6) - (2021 * 12 + 9) = 45`). Use only numbers stated above. When an amount is asked about or disputed, '
  + 'also work out what the stated facts allow (the most those days, units or people could come to) and compare the two. The last line must answer exactly '
  + 'what was asked. Then answer from those results, and if the numbers do not reconcile, say so plainly. The block is removed before anyone sees it. '
  + 'Skip it for a direct lookup of one stated figure.';
export function transform({ system, user }) { return { system, user: insertNotice(user, NOTICE) }; }
