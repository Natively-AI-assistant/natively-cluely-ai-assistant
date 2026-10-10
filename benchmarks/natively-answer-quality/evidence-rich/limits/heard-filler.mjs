// Spoken questions keep the STT filler cleaning (companion to typed-filler.mjs).
import fs from 'node:fs';
import { connectApp } from '../../lib/cdp.mjs';
import * as app from '../../lib/app.mjs';
const envText = fs.readFileSync('/Users/evin/natively-cluely-ai-assistant/.env', 'utf8');
const envKey = (n) => (envText.match(new RegExp(`^${n}=(.*)$`, 'm'))?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
const c = await connectApp(); await app.setupProfile(c, { agentrouterKey: envKey('AGENTROUTER_API_KEY') }); await app.resetSession(c); await app.clearRecorder(c);
const q = 'So um what is arh the the travel policy for basically long trips?';
await app.timedAsk(c, { surface: 'hotkey', question: q, timeoutMs: 90000 });
const w = await app.collectWire(c); const user = (w.main?.messages ?? []).map((x) => x.text ?? '').join('\n');
console.log('spoken  :', q); console.log('question:', (user.match(/# Question\n([^\n]*)/) ?? [])[1] ?? null);
process.exit(0);
