// Call Center with NO policy or product document attached: the generator supplies a procedure anyway — "Before I do
// anything, I need to verify the account…", "Can I get your account number so I can pull that up?" — and the claim
// pass, a minimal-edit pass, leaves most of it in (9 of 29 no-document dev replies still ask for a verification
// detail). The judge's expected behaviour on these turns is one shape; this notice states it to the GENERATOR, at
// the end of the user message where the per-turn notices sit.
export const CC_NO_POLICY_NOTICE = '# No policy on file\n'
  + 'No document gives this company\'s policies, procedures or product details, so the reply has only these parts: '
  + 'one clause naming what the customer asked for or is upset about, in their terms (both demands if there are two; the amounts if they gave them); '
  + 'if they asked whether or when something will happen, a plain statement that it cannot be confirmed yet; '
  + 'then exactly what will be checked ("whether a refund or credit is available for today", "whether that can be done on this call"). '
  + 'Do not ask for an account number, a name, a date of birth or any other verification detail, do not name a team, a form or a step, '
  + 'do not promise a time or an outcome, and do not state what staff can or cannot see or do. '
  + 'A question that helps diagnose the fault itself ("which light is it showing?") is fine.';
export function transform({ system, user, item }) {
  if (item?.mode !== 'call-center' || item?.context_ref) return { system, user };
  if (/source_type="(?:REFERENCE|DOCUMENT|ATTACHED|FILE)/i.test(user)) return { system, user };
  const i = user.lastIndexOf('\n\n<presentation_instruction');
  return i < 0 ? { system, user: `${user}\n\n${CC_NO_POLICY_NOTICE}` } : { system, user: `${user.slice(0, i)}\n\n${CC_NO_POLICY_NOTICE}${user.slice(i)}` };
}
