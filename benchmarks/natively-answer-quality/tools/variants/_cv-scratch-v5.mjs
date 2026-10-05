// I18 replay v5: v4 + Sales with no document: pricing drivers, terms and promises are unsupported too; a one-question
// edit is accepted (the ratio rail kept DSALES-001's capability claims).
import * as base from './_claimVerifier-bundle.mjs';
import * as v4 from './_cv-scratch-v4.mjs';
export * from './_cv-scratch-v4.mjs';
const ANCHOR = '("Walk me through what your dispatchers do today, so I can show you the part that matters").';
const SALES = ' The same holds for what the price depends on, which terms, discounts or contract lengths exist, and what the seller can quote, promise or deliver by when: say you will confirm it, and ask the one thing you need from them.';
export function claimVerifierSystemPrompt(modeId, surface = 'spoken', opts = {}) {
  const p = v4.claimVerifierSystemPrompt(modeId, surface, opts);
  return modeId === 'sales' && opts.noDocuments && p.includes(ANCHOR) ? p.replace(ANCHOR, ANCHOR + SALES) : p;
}
export function acceptVerifiedAnswer({ original, edited, material }) {
  const reply = v4.splitScratch(edited).reply;
  const r = base.acceptVerifiedAnswer({ original, edited: reply, material });
  if (r.reason !== 'too_short') return r;
  const t = reply.trim();
  if (t.length < 20 || t.split(/\s+/).length < 6) return r;
  // Re-run the remaining rails on a padded original so only the ratio rail is lifted.
  const r2 = base.acceptVerifiedAnswer({ original: t + ' x', edited: t, material });
  return r2.reason === 'unchanged' || r2.reason === 'edited' ? { accepted: true, changed: true, reason: 'edited', text: t } : r;
}
