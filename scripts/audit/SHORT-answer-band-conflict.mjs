/**
 * Is the 160-char "useful" gate the WRONG METHOD?
 *
 * The app's OWN speakability policy defines a BRIEF band for yes/no, factual
 * and definition questions: 25-40 words, ~15s spoken (speakability.ts:214).
 * The live path then treats an answer under STREAMING_SAFE_PREFIX_CHARS=160 as
 * "not useful" and can DISCARD it (IntelligenceEngine.ts:2763/2843).
 *
 * If BRIEF-band answers land under 160 chars, the two policies contradict each
 * other: one asks the model for a short answer, the other refuses to count it.
 * Measured live on both models, using the app's own BRIEF guidance verbatim.
 */
import fs from 'node:fs';
const env = fs.readFileSync('/tmp/natively-land-wt/.env', 'utf8');
const k = (n) => env.split('\n').find((l) => l.startsWith(n + '=')).split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
const DS = k('DEEPSEEK_API_KEY'), GM = k('GEMINI_API_KEY');
const GATE = 160;

// The app's own BRIEF-band directive (speakability.ts SHORT_BAND_TARGETS.BRIEF).
const SYS = `You are helping a candidate answer live in an interview. Speak in first person.
Length: 25-40 words, about 15 seconds — a tight, direct answer: lead with the point and stop.`;

async function ds(u){const r=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${DS}`},body:JSON.stringify({model:'deepseek-v4-flash',temperature:0,max_tokens:2000,messages:[{role:'system',content:SYS},{role:'user',content:u}]})});const c=(await r.json()).choices[0];return c.finish_reason==='length'?null:(c.message.content??'').trim();}
async function gm(u){const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GM}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({systemInstruction:{parts:[{text:SYS}]},contents:[{role:'user',parts:[{text:u}]}],generationConfig:{temperature:0,maxOutputTokens:2000}})});const c=(await r.json()).candidates?.[0];if(!c||c.finishReason==='MAX_TOKENS')return null;return ((c.content?.parts??[]).map(p=>p.text??'').join('')).trim();}

// Question shapes the app itself routes to BRIEF: yes/no, factual lookup, definition.
const QS = [
  ['yes/no',      'Do you have experience with Kubernetes?'],
  ['yes/no',      'Did you lead that migration yourself?'],
  ['factual',     'How many engineers were on your team?'],
  ['factual',     'Which database did you use?'],
  ['definition',  'What is a hash map?'],
  ['definition',  'What is idempotency?'],
];

for (const [mname, fn] of [['deepseek-v4-flash', ds], ['gemini-3.1-flash-lite', gm]]) {
  console.log(`\n=== ${mname} — app's own BRIEF band (25-40 words) ===`);
  console.log('kind       | words | chars | under 160 gate? | answer');
  console.log('-----------|-------|-------|-----------------|-------');
  let under = 0, n = 0;
  for (const [kind, q] of QS) {
    const t = await fn(q);
    if (t === null) { console.log(`${kind.padEnd(10)} | TRUNC`); continue; }
    n++;
    const words = t.split(/\s+/).filter(Boolean).length;
    const at_risk = t.length < GATE;
    if (at_risk) under++;
    console.log(`${kind.padEnd(10)} | ${String(words).padEnd(5)} | ${String(t.length).padEnd(5)} | ${String(at_risk).padEnd(15)} | ${t.slice(0, 58)}${t.length > 58 ? '…' : ''}`);
  }
  console.log(`\n  BRIEF-band answers falling UNDER the 160-char gate: ${under}/${n}`);
}
console.log(`\nAny answer under ${GATE} chars can never mark the turn "useful", so the`);
console.log('first-useful deadline keeps running against an answer that already exists.');
