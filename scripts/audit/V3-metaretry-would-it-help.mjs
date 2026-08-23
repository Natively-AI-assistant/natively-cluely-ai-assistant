/**
 * Would the proposed V3 coding meta-retry actually HELP? Live, two models.
 *
 * The earlier probes established that a code-free reply is detectable. This one
 * asks the question that actually decides whether to build it: when the models
 * DO reply without code, is that a DEFECT or CORRECT behaviour?
 *
 * Measured answer: correct behaviour. Given a complete question both models
 * produce real code (no defect to fix). The only turns that yield a code-free
 * reply are ones where information is genuinely missing — where asking is right.
 * Forcing a retry there makes the model INVENT a different problem, which this
 * script prints verbatim.
 */
import fs from 'node:fs';
const env=fs.readFileSync('/tmp/natively-land-wt/.env','utf8');
const k=n=>env.split('\n').find(l=>l.startsWith(n+'=')).split('=').slice(1).join('=').trim().replace(/^["']|["']$/g,'');
const DS=k('DEEPSEEK_API_KEY'), GM=k('GEMINI_API_KEY');
const CONTRACT=`You are a coding assistant. Follow <answer_contract> exactly.
<answer_contract>
Produce: ## Approach, a fenced code block, ## Complexity, ## Edge cases.
If the user's request is incomplete, say so and ask for the full problem.
</answer_contract>`;
// This is the legacy regen instruction's intent: "stop talking about it, answer it".
const REGEN='Do not ask for clarification. Assume a reasonable interpretation and output the full solution now, including a fenced code block.';
async function ds(msgs){const r=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${DS}`},body:JSON.stringify({model:'deepseek-v4-flash',temperature:0,max_tokens:3000,messages:msgs})});const c=(await r.json()).choices[0];return c.finish_reason==='length'?null:c.message.content;}
async function gm(msgs){const sys=msgs[0].content;const rest=msgs.slice(1).map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]}));const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GM}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({systemInstruction:{parts:[{text:sys}]},contents:rest,generationConfig:{temperature:0,maxOutputTokens:3000}})});const c=(await r.json()).candidates?.[0];if(!c||c.finishReason==='MAX_TOKENS')return null;return (c.content?.parts??[]).map(p=>p.text??'').join('');}

const Q='Fix the bug in the code I pasted earlier.';
for (const [m, fn] of [['deepseek-v4-flash', ds], ['gemini-3.1-flash-lite', gm]]) {
  const first = await fn([{role:'system',content:CONTRACT},{role:'user',content:Q}]);
  const regen = await fn([{role:'system',content:CONTRACT},{role:'user',content:Q},{role:'assistant',content:first},{role:'user',content:REGEN}]);
  console.log(`\n########## ${m} ##########`);
  console.log('WITHOUT the guard (what you see today):');
  console.log('   ' + (first||'').replace(/\n+/g,' ').slice(0,170) + '…');
  console.log('\nWITH the guard I proposed (forced retry):');
  console.log('   ' + (regen||'').replace(/\n+/g,' ').slice(0,320) + '…');
}
