// The Pro licences' seasonal sale, with the sale's name moving with the
// calendar. Lifetime (Evin, 2026-11-01): $79 struck, $60 paid. Yearly (Evin,
// 2026-11-06): $39 struck, $30 paid. Same windows as the website's
// src/lib/lifetimeSale.ts, so the app and /pricing never disagree.
//
//   Halloween           until 20 November 2026
//   Black Friday        20 November – 4 December
//   Christmas           5 – 31 December
//   New Year            1 – 31 January 2027
//
// Outside a named sale the lifetime card goes back to its BEST VALUE pill and
// shows $60 with no struck $79 (yearly: $30, no struck $39, no pill): the
// "was" price only appears while a sale runs, so it never becomes a standing
// reference price nobody paid. Fixed dates on
// purpose, so the calendar does not quietly relabel itself next year. Day
// boundaries are the user's local midnight.

export const LIFETIME_LIST = 79;
export const LIFETIME_SALE = 60;
// 24: (79 − 60) / 79, rounded. Quoted as is, not rounded up to 25.
export const LIFETIME_PCT_OFF = Math.round(((LIFETIME_LIST - LIFETIME_SALE) / LIFETIME_LIST) * 100);

// Yearly is 24% off $39 on Dodo (set 2026-11-05), which charges $29.64; the
// card rounds it up to $30 (Evin), so nobody pays more than it says. The
// percentage is Dodo's own, not recomputed from the rounded $30 (that gives 23).
export const YEARLY_LIST = 39;
export const YEARLY_SALE = 30;
export const YEARLY_PCT_OFF = 24;

const BLACK_FRIDAY_FROM = new Date(2026, 10, 20).getTime();
const CHRISTMAS_FROM = new Date(2026, 11, 5).getTime();
const NEW_YEAR_FROM = new Date(2027, 0, 1).getTime();
const SALE_ENDS = new Date(2027, 1, 1).getTime();

// Short on purpose: the pill shares one row with "Pro · Lifetime" in a
// half-width card (~231px at the settings panel's widest), and the card must
// not grow a line for the sale.
const LABELS = {
  halloween: 'Halloween',
  blackfriday: 'Black Friday',
  christmas: 'Christmas',
  newyear: 'New Year',
};

/** @param {Date} now */
export function lifetimeSaleOn(now) {
  const t = now.getTime();
  if (t < BLACK_FRIDAY_FROM) return 'halloween';
  if (t < CHRISTMAS_FROM) return 'blackfriday';
  if (t < NEW_YEAR_FROM) return 'christmas';
  if (t < SALE_ENDS) return 'newyear';
  return null;
}

function saleLabel(now, pct) {
  const sale = lifetimeSaleOn(now);
  return sale ? `${LABELS[sale]} −${pct}%` : null;
}

/** The pill on the lifetime card, e.g. "Halloween −24%", or null once the sale is over. */
export function lifetimeSaleLabel(now) {
  return saleLabel(now, LIFETIME_PCT_OFF);
}

/** The pill on the yearly card, e.g. "Halloween −24%", or null once the sale is over. */
export function yearlySaleLabel(now) {
  return saleLabel(now, YEARLY_PCT_OFF);
}
