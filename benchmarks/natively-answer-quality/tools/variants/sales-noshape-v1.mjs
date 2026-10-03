// Sales with no product material. The "state none of it as fact" notice (I7) holds the facts back, but the reply
// that is left is long and indirect: a preamble about not wanting to guess, an invented pricing driver ("it depends
// on how many people would be using it"), a discovery detour, "on our next call". The judge's improvement on 14 of
// the 18 weak dev Sales answers is the same short shape: "Let me confirm the price so I can give you an accurate
// number." / "Let me confirm whether invoicing is built in so I can give you a clear yes or no." This notice states
// that shape to the generator on those turns only (the I7 marker is present).
export const SALES_SHAPE_NOTICE = '# How to say it when nothing can be stated\n'
  + 'Keep the reply to these parts. If they named a pressure or a comparison (a deadline, a competitor\'s price), acknowledge it in their terms in one clause. '
  + 'Then ONE short sentence that says exactly what you will confirm ("Let me confirm the price so I can give you an accurate number", "Let me confirm whether invoicing is built in so I can give you a clear yes or no"). '
  + 'No sentence about why you cannot answer, no "it depends on…", no next call or later date. '
  + 'Asked why they should choose you or what the return is, give one clearly conditional line instead ("it is only worth the premium if we can show it saves you more than it costs"). '
  + 'Asked about yourself, one warm line about your role on this call. '
  + 'End with at most one question, and only one you need answered in order to confirm it.';
export function transform({ system, user, item }) {
  // No reference file among the evidence (the same condition the verifier uses for its no-document clause).
  if (item?.mode !== 'sales' || /source_type="REFERENCE/.test(user)) return { system, user };
  const i = user.lastIndexOf('\n\n<presentation_instruction');
  return i < 0 ? { system, user: `${user}\n\n${SALES_SHAPE_NOTICE}` } : { system, user: `${user.slice(0, i)}\n\n${SALES_SHAPE_NOTICE}${user.slice(i)}` };
}
