/**
 * Same question, but against the ACTUAL Natively backend rather than raw
 * provider APIs: POST ${NATIVELY_API_URL}/v1/chat with x-natively-key, SSE.
 * Shape lifted from LLMHelper.streamWithNatively (endpoint :7185, body :3575).
 *
 * This is the production path a real user is on, and it is the one that could
 * plausibly exhibit the linger the raw providers did not: the server runs a
 * SEQUENTIAL provider cascade and rotates at AI_TTFT_BUDGET_MS (~10s), so a
 * rescued turn can keep the client stream open well past the first token.
 *
 * DELIBERATELY SMALL: 5 requests total. The standing rule for this repo is
 * never to load-test production; this is functional verification, not load.
 */
import fs from 'node:fs';
const env = fs.readFileSync('/tmp/natively-land-wt/.env', 'utf8');
const k = (n) => { const l = env.split('\n').find((x) => x.startsWith(n + '=')); return l ? l.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '') : ''; };
const KEY = k('NATIVELY_API_KEY');
const BASE = (process.env.NATIVELY_API_URL || 'https://api.natively.software').replace(/\/+$/, '');
const GATE = 160;
// F-301: the live path gives the natively cascade route 13s, not 7s.
const FIRST_USEFUL_MS = 13000;

const SYS = 'You are helping a candidate answer live in an interview. Answer in ONE short sentence, under 20 words. Lead with the point and stop.';

async function stream(userMessage) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/v1/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream', 'x-natively-key': KEY, 'X-Request-Id': `probe_${Date.now()}` },
    body: JSON.stringify({ messages: [{ role: 'user', content: userMessage }], system: SYS, stream: true }),
  });
  if (!res.ok) return { error: `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}` };
  const reader = res.body.getReader(); const dec = new TextDecoder();
  let buf = '', text = '', tFirst = null, tLast = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;                              // stream CLOSED
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const p = line.slice(5).trim();
      if (!p || p === '[DONE]') continue;
      let j; try { j = JSON.parse(p); } catch { continue; }
      // Accept the common SSE shapes the gateway may emit.
      const piece = j.choices?.[0]?.delta?.content ?? j.delta ?? j.text ?? j.content ?? '';
      if (typeof piece === 'string' && piece) { if (tFirst === null) tFirst = Date.now() - t0; tLast = Date.now() - t0; text += piece; }
    }
  }
  return { tFirst, tLast, tClose: Date.now() - t0, text: text.trim(), model: res.headers.get('x-provider-model') || res.headers.get('x-model') || '' };
}

const QS = [
  'Do you have experience with Kubernetes?',
  'Did you lead that migration yourself?',
  'Which database did you use?',
  'How many engineers were on your team?',
  'Should I mention the AWS migration here?',
];

console.log(`endpoint ${BASE}/v1/chat   first-useful budget on this route: ${FIRST_USEFUL_MS}ms (F-301, server cascade)\n`);
console.log('question                        | chars | 1st tok | last tok | closed | linger | <160 | open@13s | DISCARD');
console.log('--------------------------------|-------|---------|----------|--------|--------|------|----------|--------');
let shorts = 0, discards = 0, maxLinger = 0, ok = 0;
for (const q of QS) {
  let r; try { r = await stream(q); } catch (e) { console.log(`${q.slice(0,31).padEnd(31)} | ERROR ${e.message.slice(0,50)}`); continue; }
  if (r.error) { console.log(`${q.slice(0,31).padEnd(31)} | ${r.error}`); continue; }
  ok++;
  const linger = r.tLast === null ? 0 : r.tClose - r.tLast;
  maxLinger = Math.max(maxLinger, linger);
  const short = r.text.length < GATE, open = r.tClose > FIRST_USEFUL_MS, disc = short && open;
  if (short) shorts++; if (disc) discards++;
  console.log(`${q.slice(0,31).padEnd(31)} | ${String(r.text.length).padEnd(5)} | ${String(r.tFirst ?? '-').padEnd(7)} | ${String(r.tLast ?? '-').padEnd(8)} | ${String(r.tClose).padEnd(6)} | ${String(linger).padEnd(6)} | ${String(short).padEnd(4)} | ${String(open).padEnd(8)} | ${disc ? 'YES' : 'no'}`);
}
console.log(`\n  successful calls: ${ok}/${QS.length} | short(<160): ${shorts} | max linger: ${maxLinger}ms | would DISCARD: ${discards}`);
