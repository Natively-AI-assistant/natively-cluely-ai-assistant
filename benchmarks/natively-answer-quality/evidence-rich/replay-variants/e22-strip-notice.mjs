// E22 arm "without": the recorded prompt with main's calculation notice taken out (the section and its blank line).
import { NOTICE as N1 } from './e21-notice-v1.mjs';
export function transform({ system, user }) { if (!user.includes(N1)) throw new Error('recorded prompt does not carry main\'s notice verbatim'); return { system, user: user.replace(`${N1}\n\n`, '').replace(N1, '') }; }
