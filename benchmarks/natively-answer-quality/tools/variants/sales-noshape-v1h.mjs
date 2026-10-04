// sales-noshape-v1 on HEARD turns only (the hotkey: the prospect just spoke and the reply is said to them). A typed
// turn is the seller asking the assistant ("give me 3 discovery questions", "summarize their situation in one
// line"); the notice describes a reply to the prospect. It also keeps a typed "shorter" on the refinement notice alone.
import { transform as all } from './sales-noshape-v1.mjs';
export { SALES_SHAPE_NOTICE } from './sales-noshape-v1.mjs';
export function transform(x) { return x.item?.surface === 'hotkey' ? all(x) : { system: x.system, user: x.user }; }
