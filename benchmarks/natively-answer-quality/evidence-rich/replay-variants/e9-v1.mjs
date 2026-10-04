// E9 v1: the claim pass's list step also names two shapes of invention seen when the asked fact is absent.
export const OLD_PAST = '[past] something that already happened or is already true and that only a record can establish: what they did, led, built, measured or agreed, a number, a price, a policy, a procedure, a capability, a customer, a result;';
export const NEW_PAST = OLD_PAST.replace(/;$/, '') + '; also a yes or a no about whether something was covered, included, mentioned, allowed or offered when the material never names that thing, and a value, date, rule or result the material gives for a DIFFERENT item (another course, plan, product, policy, person or occasion) presented as the one asked about;';
export function systemPrompt(recorded) {
  if (!recorded.includes(OLD_PAST)) throw new Error('the [past] line is not in the recorded system prompt');
  return recorded.replace(OLD_PAST, NEW_PAST);
}
