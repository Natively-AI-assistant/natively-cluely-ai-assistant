/**
 * The untested assumption: I claimed a real stream can still be OPEN at the 7s
 * first-useful deadline after already delivering a short answer. That is the
 * second of the two conditions required to discard a real answer, and I had
 * asserted it without measuring. This measures it, on real streaming calls.
 *
 * Per call: time to first token, time of last token, time the stream CLOSES,
 * the linger gap between them, and the answer length. Then it evaluates the
 * actual live-path condition:
 *     discard  <=>  chars < 160  AND  stream still open at 7000ms
 */
import fs from 'node:fs';
const env = fs.readFileSync('/tmp/natively-land-wt/.env', 'utf8');
const k = (n) => env.split('\n').find((l) => l.startsWith(n + '=')).split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
const DS = k('DEEPSEEK_API_KEY'), GM = k('GEMINI_API_KEY');
const GATE = 160, FIRST_USEFUL_MS = 7000;

// Push for genuinely SHORT answers — the exposed shape.
const SYS = 'You are helping a candidate answer live in an interview. Answer in ONE short sentence, under 20 words. Lead with the point and stop.';

async function streamDS(u) {
  const t0 = Date.now();
  const r = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DS}` },
    body: JSON.stringify({ model: 'deepseek-v4-flash', temperature: 0, max_tokens: 2000, stream: true,
      messages: [{ role: 'system', content: SYS }, { role: 'user', content: u }] }) });
  return readSSE(r, t0, (j) => j.choices?.[0]?.delta?.content ?? '');
}
async function streamGM(u) {
  const t0 = Date.now();
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:streamGenerateContent?alt=sse&key=${GM}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: SYS }] },
        contents: [{ role: 'user', parts: [{ text: u }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 2000 } }) });
  return readSSE(r, t0, (j) => ((j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')));
}

async function readSSE(r, t0, extract) {
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '', tFirst = null, tLast = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;                                  // stream CLOSED here
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let j; try { j = JSON.parse(payload); } catch { continue; }
      const piece = extract(j);
      if (piece) { if (tFirst === null) tFirst = Date.now() - t0; tLast = Date.now() - t0; text += piece; }
    }
  }
  return { tFirst, tLast, tClose: Date.now() - t0, text: text.trim() };
}

const QS = [
  'Do you have experience with Kubernetes?',
  'Did you lead that migration yourself?',
  'Which database did you use?',
  'How many engineers were on your team?',
  'Should I mention the AWS migration here?',
];

for (const [mname, fn] of [['deepseek-v4-flash', streamDS], ['gemini-3.1-flash-lite', streamGM]]) {
  console.log(`\n=== ${mname} (real streaming) ===`);
  console.log('question                        | chars | 1st tok | last tok | closed | linger | <160 | open@7s | DISCARD');
  console.log('--------------------------------|-------|---------|----------|--------|--------|------|---------|--------');
  let discards = 0, shorts = 0, maxLinger = 0;
  for (const q of QS) {
    let r; try { r = await fn(q); } catch (e) { console.log(`${q.slice(0,31).padEnd(31)} | ERROR ${e.message.slice(0,40)}`); continue; }
    const linger = r.tLast === null ? 0 : r.tClose - r.tLast;
    maxLinger = Math.max(maxLinger, linger);
    const short = r.text.length < GATE;
    const openAt7 = r.tClose > FIRST_USEFUL_MS;
    const discard = short && openAt7;
    if (short) shorts++;
    if (discard) discards++;
    console.log(`${q.slice(0,31).padEnd(31)} | ${String(r.text.length).padEnd(5)} | ${String(r.tFirst ?? '-').padEnd(7)} | ${String(r.tLast ?? '-').padEnd(8)} | ${String(r.tClose).padEnd(6)} | ${String(linger).padEnd(6)} | ${String(short).padEnd(4)} | ${String(openAt7).padEnd(7)} | ${discard ? 'YES' : 'no'}`);
  }
  console.log(`  short answers (<160): ${shorts}/${QS.length} | max linger after last token: ${maxLinger}ms | would DISCARD: ${discards}/${QS.length}`);
}
console.log(`\nDiscard needs BOTH: answer <${GATE} chars AND stream still open at ${FIRST_USEFUL_MS}ms.`);
