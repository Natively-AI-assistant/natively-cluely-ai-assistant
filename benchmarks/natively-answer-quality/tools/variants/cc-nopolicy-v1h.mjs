// cc-nopolicy-v1 on HEARD turns only (the hotkey: the customer just spoke and the reply is said to them). A typed
// turn is the agent asking the assistant ("when am I supposed to escalate this to tier 2?", "can I offer her a
// discount to stay?"); the notice describes a reply to the customer and turned those into customer-facing lines.
import { transform as all } from './cc-nopolicy-v1.mjs';
export { CC_NO_POLICY_NOTICE } from './cc-nopolicy-v1.mjs';
export function transform(x) { return x.item?.surface === 'hotkey' ? all(x) : { system: x.system, user: x.user }; }
