import fs from 'node:fs';
const env=fs.readFileSync('/tmp/natively-land-wt/.env','utf8');
const k=n=>env.split('\n').find(l=>l.startsWith(n+'=')).split('=').slice(1).join('=').trim().replace(/^["']|["']$/g,'');
const DS=k('DEEPSEEK_API_KEY'), GM=k('GEMINI_API_KEY');
const FENCE=/```[a-zA-Z0-9_+\-]*\n([\s\S]*?)```/;
const body=t=>{const m=(t||'').match(FENCE);return m?m[1].trim().length:0;};
async function ds(sys,u){const r=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${DS}`},body:JSON.stringify({model:'deepseek-v4-flash',temperature:0,max_tokens:3000,messages:[{role:'system',content:sys},{role:'user',content:u}]})});const c=(await r.json()).choices[0];return c.finish_reason==='length'?null:c.message.content;}
async function gm(sys,u){const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GM}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({systemInstruction:{parts:[{text:sys}]},contents:[{role:'user',parts:[{text:u}]}],generationConfig:{temperature:0,maxOutputTokens:3000}})});const c=(await r.json()).candidates?.[0];if(!c||c.finishReason==='MAX_TOKENS')return null;return (c.content?.parts??[]).map(p=>p.text??'').join('');}

// A COMPLETE, unambiguous question. Nothing is missing.
const Q='Given an array of integers nums and an integer target, return the indices of the two numbers that add up to target. Exactly one solution exists. Implement it.';

// Increasingly contract-heavy framings — the shape that made M3 talk ABOUT the
// request instead of answering it.
const FRAMINGS = {
 'plain contract': `You are a coding assistant.
<answer_contract>Produce ## Approach, a fenced code block, ## Complexity, ## Edge cases.</answer_contract>`,
 'spec + self-check': `You are a coding assistant.
<verification_spec>Before answering, verify the request satisfies every clause of <answer_contract>. If any clause cannot be satisfied, report which and stop.</verification_spec>
<answer_contract>
1. The request MUST include a complete problem statement.
2. The request MUST specify the target language.
3. The request MUST state input and output types explicitly.
4. Produce ## Approach, a fenced code block, ## Complexity, ## Edge cases.
</answer_contract>`,
 'strict gate': `You are a coding assistant operating under a strict contract.
<verification_spec>
STEP 1: Enumerate each clause of <answer_contract> and mark it SATISFIED or UNSATISFIED for this request.
STEP 2: If ANY clause is UNSATISFIED you MUST NOT write code. Instead state which clause failed and request the missing input.
</verification_spec>
<answer_contract>
C1. Problem statement present.
C2. Target programming language explicitly named by the user.
C3. Function signature explicitly provided by the user.
C4. Time and space bounds explicitly requested.
</answer_contract>`,
};

for (const [name, sys] of Object.entries(FRAMINGS)) {
  console.log(`\n### framing: ${name}`);
  for (const [m,fn] of [['deepseek-v4-flash',ds],['gemini-3.1-flash-lite',gm]]) {
    const t = await fn(sys, Q);
    if (t===null){console.log(`  ${m.padEnd(22)} TRUNC`);continue;}
    const c = body(t);
    const defect = c < 40;   // complete question, yet no code => the real bug
    console.log(`  ${m.padEnd(22)} code=${String(c).padEnd(5)} DEFECT=${defect}`);
    if (defect) console.log(`      "${t.replace(/\n+/g,' ').slice(0,190)}…"`);
  }
}
