import fs from 'node:fs';
const env=fs.readFileSync('/tmp/natively-land-wt/.env','utf8');
const k=n=>env.split('\n').find(l=>l.startsWith(n+'=')).split('=').slice(1).join('=').trim().replace(/^["']|["']$/g,'');
const DS=k('DEEPSEEK_API_KEY'), GM=k('GEMINI_API_KEY');
const FENCE=/```[a-zA-Z0-9_+\-]*\n([\s\S]*?)```/;
const body=t=>{const m=(t||'').match(FENCE);return m?m[1].trim().length:0;};
async function ds(msgs){const r=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${DS}`},body:JSON.stringify({model:'deepseek-v4-flash',temperature:0,max_tokens:3000,messages:msgs})});const c=(await r.json()).choices[0];return c.finish_reason==='length'?null:c.message.content;}
async function gm(msgs){const sys=msgs[0].content;const rest=msgs.slice(1).map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]}));const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GM}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({systemInstruction:{parts:[{text:sys}]},contents:rest,generationConfig:{temperature:0,maxOutputTokens:3000}})});const c=(await r.json()).candidates?.[0];if(!c||c.finishReason==='MAX_TOKENS')return null;return (c.content?.parts??[]).map(p=>p.text??'').join('');}

const SYS=`You are a coding assistant operating under a strict contract.
<verification_spec>
STEP 1: Enumerate each clause of <answer_contract> and mark it SATISFIED or UNSATISFIED for this request.
STEP 2: If ANY clause is UNSATISFIED you MUST NOT write code. Instead state which clause failed and request the missing input.
</verification_spec>
<answer_contract>
C1. Problem statement present.
C2. Target programming language explicitly named by the user.
C3. Function signature explicitly provided by the user.
C4. Time and space bounds explicitly requested.
</answer_contract>`;
const Q='Given an array of integers nums and an integer target, return the indices of the two numbers that add up to target. Exactly one solution exists. Implement it.';
const REGEN='Do not ask for clarification. Assume a reasonable interpretation and output the full solution now, including a fenced code block.';

for (const [m,fn] of [['deepseek-v4-flash',ds],['gemini-3.1-flash-lite',gm]]) {
  console.log(`\n############ ${m} ############`);
  const first = await fn([{role:'system',content:SYS},{role:'user',content:Q}]);
  console.log(`\n--- TODAY (V3 path: no guard) --- code=${body(first)}`);
  console.log((first||'').split('\n').filter(Boolean).slice(0,6).map(l=>'   '+l.slice(0,110)).join('\n'));
  const regen = await fn([{role:'system',content:SYS},{role:'user',content:Q},{role:'assistant',content:first},{role:'user',content:REGEN}]);
  console.log(`\n--- WITH the guard (retry fires) --- code=${body(regen)}`);
  console.log((regen||'').split('\n').filter(Boolean).slice(0,10).map(l=>'   '+l.slice(0,110)).join('\n'));
  // Did the retry answer the ACTUAL question, or invent one?
  const onTopic=/two ?sum|target|indices|nums/i.test(regen||'');
  console.log(`\n   retry answered the USER'S question (mentions nums/target/indices): ${onTopic}`);
}
