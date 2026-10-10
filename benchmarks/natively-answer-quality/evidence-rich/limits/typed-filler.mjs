// Does the typed question lose words the speech cleaner treats as filler?
import { connectApp } from '../../lib/cdp.mjs';
import * as app from '../../lib/app.mjs';
import fs from 'node:fs';
const envText = fs.readFileSync('/Users/evin/natively-cluely-ai-assistant/.env', 'utf8');
const envKey = (n) => (envText.match(new RegExp(`^${n}=(.*)$`, 'm'))?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
const c = await connectApp(); await app.setupProfile(c, { agentrouterKey: envKey('AGENTROUTER_API_KEY') }); await app.resetSession(c); await app.clearRecorder(c);
const q = 'I would like the right answer: is the policy basically kind of strict, or is it actually strict? I mean the the travel policy.';
await app.timedAsk(c, { surface: 'typed', question: q, timeoutMs: 90000 });
const w = await app.collectWire(c); const user = (w.main?.messages ?? []).map((x) => x.text ?? '').join('\n');
const qline = (user.match(/# Question\n([^\n]*)/) ?? [])[1] ?? null;
console.log('typed   :', q); console.log('question:', qline); console.log('original anywhere in request:', user.includes(q));
process.exit(0);
