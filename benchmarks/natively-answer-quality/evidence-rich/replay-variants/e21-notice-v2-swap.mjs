// E21 stage two, part b: a recorded prompt that carries main's calculation notice gets the n2 wording instead.
import { NOTICE as N1 } from './e21-notice-v1.mjs';
import { NOTICE as N2 } from './e21-notice-v2.mjs';
export function transform({ system, user }) { if (!user.includes(N1)) throw new Error('recorded prompt does not carry main\'s notice verbatim'); return { system, user: user.replace(N1, N2) }; }
