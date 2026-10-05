/**
 * Does CODING_VERIFICATION_INSTRUCTION damage a real answer?
 *
 * It is appended to EVERY coding/DSA turn (when code verification is on), so a
 * regression here is broad. Four risks, all measured on two live models:
 *   R1 answer damage   — does the six-section answer survive intact?
 *   R2 leakage         — after the REAL strip regex, is any spec text still visible?
 *   R3 malformed JSON  — is the emitted spec parseable (else the runner gets junk)?
 *   R4 truncation      — if the stream is cut mid-spec, does a dangling tag leak?
 *
 * The contract, the instruction and the strip regex are all lifted from source.
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = '/tmp/natively-land-wt';
const CC = fs.readFileSync(path.join(REPO, 'electron/llm/codingContract.ts'), 'utf8');
const env = fs.readFileSync(path.join(REPO, '.env'), 'utf8');
const k = (n) => env.split('\n').find((l) => l.startsWith(n + '=')).split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
const DS = k('DEEPSEEK_API_KEY'), GM = k('GEMINI_API_KEY');

// Lift the three shipped artefacts verbatim.
const lit = (name) => {
  const i = CC.indexOf(`export const ${name} = \``);
  const s = CC.indexOf('`', CC.indexOf('=', i)) + 1;
  let e = s; while (true) { e = CC.indexOf('`', e); if (CC[e - 1] !== '\\') break; e++; }
  return CC.slice(s, e).replace(/\\`/g, '`').replace(/\\\\/g, '\\');
};
const CONTRACT = lit('CODING_CONTRACT');
const VERIF = lit('CODING_VERIFICATION_INSTRUCTION');
const reLine = CC.split('\n').find((l) => l.includes('export const VERIFICATION_SPEC_RE'));
// eslint-disable-next-line no-eval
const STRIP_RE = eval(reLine.slice(reLine.indexOf('=') + 1).replace(/;$/, '').trim());
console.log(`contract ${CONTRACT.length} chars | verification instruction ${VERIF.length} chars`);
console.log(`strip regex: ${STRIP_RE}\n`);

const SPEC_RE = /<verification_spec>([\s\S]*?)<\/verification_spec>/i;
const FENCE = /```[a-zA-Z0-9_+\-]*\n([\s\S]*?)```/;
const HEADINGS = ['## Approach', '## Technique', '## Code', '## Dry Run', '## Complexity', '## Interviewer Follow-up'];

async function ds(sys, u, max) {
  const r = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DS}` },
    body: JSON.stringify({ model: 'deepseek-v4-flash', temperature: 0, max_tokens: max,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: u }] }) });
  const c = (await r.json()).choices[0];
  return { text: c.message.content ?? '', truncated: c.finish_reason === 'length' };
}
async function gm(sys, u, max) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GM}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] },
        contents: [{ role: 'user', parts: [{ text: u }] }],
        generationConfig: { temperature: 0, maxOutputTokens: max } }) });
  const c = (await r.json()).candidates?.[0];
  if (!c) return { text: '', truncated: false };
  return { text: (c.content?.parts ?? []).map((p) => p.text ?? '').join(''), truncated: c.finishReason === 'MAX_TOKENS' };
}

// Deliberately SMALL/trivial problems — the user's concern — plus one normal one.
const QUESTIONS = [
  ['tiny: reverse a string',   'Reverse a string.'],
  ['tiny: sum two numbers',    'Write a function that adds two numbers.'],
  ['tiny: is even',            'Write a function that returns whether a number is even.'],
  ['normal: two sum',          'Given nums and target, return indices of the two numbers adding to target.'],
];

for (const [mname, fn] of [['deepseek-v4-flash', ds], ['gemini-3.1-flash-lite', gm]]) {
  console.log(`\n=== ${mname} ===`);
  console.log('case                     | headings | code | specJSON | leak after strip | answer chars (no spec)');
  console.log('-------------------------|----------|------|----------|------------------|----------------------');
  for (const [label, q] of QUESTIONS) {
    const { text } = await fn(`${CONTRACT}\n\n${VERIF}`, q, 3000);
    const stripped = text.replace(STRIP_RE, '').trim();
    const heads = HEADINGS.filter((h) => text.includes(h)).length;
    const code = (text.match(FENCE)?.[1] ?? '').trim().length;
    const specM = text.match(SPEC_RE);
    let specOk = 'none';
    if (specM) { try { JSON.parse(specM[1].trim()); specOk = 'valid'; } catch { specOk = 'INVALID'; } }
    const leak = /verification_spec/i.test(stripped);
    console.log(`${label.padEnd(24)} | ${String(heads + '/6').padEnd(8)} | ${String(code).padEnd(4)} | ${specOk.padEnd(8)} | ${String(leak).padEnd(16)} | ${stripped.length}`);
  }
}

// R4 — truncation mid-spec. Squeeze tokens so the stream dies inside the spec.
console.log('\n=== R4: stream truncated mid-spec (does a dangling tag reach the user?) ===');
for (const [mname, fn] of [['deepseek-v4-flash', ds], ['gemini-3.1-flash-lite', gm]]) {
  for (const max of [420, 600, 800]) {
    const { text, truncated } = await fn(`${CONTRACT}\n\n${VERIF}`, 'Reverse a string.', max);
    const stripped = text.replace(STRIP_RE, '').trim();
    const opened = /<verification_spec>/i.test(text);
    const closed = /<\/verification_spec>/i.test(text);
    if (!opened) { console.log(`  ${mname} max=${max}: truncated=${truncated} spec not reached`); continue; }
    console.log(`  ${mname} max=${max}: truncated=${truncated} specOpened=${opened} specClosed=${closed} LEAK_AFTER_STRIP=${/verification_spec/i.test(stripped)}`);
  }
}
