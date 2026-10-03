import { transform as shipAll } from './ship-all-v1.mjs';
import { transform as past } from './past-reason-v1.mjs';
export function transform(x) { const a = shipAll(x); return past({ ...a, item: x.item }); }
