// Where does a long typed message differ from what reached the request? (after whitespace collapse)
import { connectApp } from '../../lib/cdp.mjs';
import * as app from '../../lib/app.mjs';
import { filler } from './filler.mjs';
const c = await connectApp();
await app.resetSession(c); await app.clearRecorder(c);
const msg = `Here is a long note I pasted from my files. ${filler(10000, 777)}\nLast line: reference PELLWORTH-DIFF.`;
const a = await app.timedAsk(c, { surface: 'typed', question: msg, timeoutMs: 120000 });
const w = await app.collectWire(c); const user = (w.main?.messages ?? []).map((x) => x.text ?? '').join('\n');
const sq = (t) => String(t).replace(/\s+/g, ' ').trim(); const U = sq(user), M = sq(msg);
const start = U.indexOf(M.slice(0, 60)); let i = 0; while (i < M.length && U[start + i] === M[i]) i++;
console.log('found head at', start, '| matching chars', i, 'of', M.length);
console.log('sent    :', JSON.stringify(M.slice(Math.max(0, i - 80), i + 120)));
console.log('request :', JSON.stringify(U.slice(start + Math.max(0, i - 80), start + i + 200)));
process.exit(0);
