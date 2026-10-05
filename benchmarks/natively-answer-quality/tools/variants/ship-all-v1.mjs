// Replay transform: every shipped prompt-level change at once (own-life rule, recruiting hotkey words, calculation note).
import { transform as ownLife } from './own-life-v2.mjs';
import { transform as recWords } from './rec-words-v1.mjs';
import { transform as calc } from './calc-v1.mjs';
export function transform(x) { const a = { ...ownLife(x), item: x.item }; const b = { ...recWords(a), item: x.item }; return calc(b); }
