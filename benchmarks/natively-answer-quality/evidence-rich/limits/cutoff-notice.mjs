// Does the overlay say an answer was cut off? Needs the app started with NATIVELY_TEST_STREAM_OUTPUT_CHARS low.
import fs from 'node:fs';
import { connectApp } from '../../lib/cdp.mjs';
import * as app from '../../lib/app.mjs';
const envText = fs.readFileSync('/Users/evin/natively-cluely-ai-assistant/.env', 'utf8');
const envKey = (n) => (envText.match(new RegExp(`^${n}=(.*)$`, 'm'))?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
const c = await connectApp(); await app.setupProfile(c, { agentrouterKey: envKey('AGENTROUTER_API_KEY') });
const ask = 'Write out the numbers from 1 to 300 in English words, one per line, nothing skipped, no commentary.';
for (const surface of ['typed', 'hotkey']) {
  await app.resetSession(c);
  const a = await app.timedAsk(c, { surface, question: ask, timeoutMs: 90000 });
  await new Promise((r) => setTimeout(r, 2500));
  const txt = await c.overlay.evaluate('document.body.innerText');
  console.log(surface.padEnd(7), '| answer chars', String(a.final ?? a.raw ?? '').length, '| "Answer cut off" on screen', txt.includes('Answer cut off'), '| reason line', txt.includes('It reached the length limit'));
}
process.exit(0);
