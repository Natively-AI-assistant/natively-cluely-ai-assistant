// Safe, progressive check of DeepSeek's accepted input size, with provider-reported token counts. Keys never printed.
import fs from 'node:fs';
const env = fs.readFileSync('/Users/evin/natively-cluely-ai-assistant/.env', 'utf8');
const key = (n) => (env.match(new RegExp(`^${n}=(.*)$`, 'm'))?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
const DS = key('DEEPSEEK_API_KEY');
const models = await (await fetch('https://api.deepseek.com/models', { headers: { Authorization: `Bearer ${DS}` } })).json().catch((e) => ({ error: String(e) }));
console.log('GET /models:', JSON.stringify(models).slice(0, 400));
const para = 'The quarterly review covered staffing, tooling, the support rota and the release calendar in the usual detail. ';
for (const chars of [40_000, 400_000, 1_200_000]) {
  const filler = para.repeat(Math.ceil(chars / para.length)).slice(0, chars);
  const t0 = Date.now();
  const res = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${DS}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-flash', max_tokens: 5, temperature: 0, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: `${filler}\n\nReply with the single word OK.` }] }) });
  const j = await res.json().catch(() => ({}));
  console.log(`chars ${chars} (chars/4 = ${Math.ceil(chars / 4)}): HTTP ${res.status} in ${Date.now() - t0} ms; usage ${JSON.stringify(j.usage ?? null)}; error ${JSON.stringify(j.error ?? null).slice(0, 220)}`);
  if (!res.ok) break;
}
