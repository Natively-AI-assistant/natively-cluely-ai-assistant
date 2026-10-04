// Progressive input size through AgentRouter -> DeepSeek (/v1/messages, the app's route). Keys never printed.
import fs from 'node:fs';
const env = fs.readFileSync('/Users/evin/natively-cluely-ai-assistant/.env', 'utf8');
const key = (n) => (env.match(new RegExp(`^${n}=(.*)$`, 'm'))?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
const AR = key('AGENTROUTER_API_KEY');
const para = 'The quarterly review covered staffing, tooling, the support rota and the release calendar in the usual detail. ';
for (const chars of [400_000, 1_200_000]) {
  const filler = para.repeat(Math.ceil(chars / para.length)).slice(0, chars); const t0 = Date.now();
  const res = await fetch('https://agentrouter.org/v1/messages', { method: 'POST', headers: { 'x-api-key': AR, Authorization: 'Bearer ' + AR, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', originator: 'codex_cli_rs' },
    body: JSON.stringify({ model: 'deepseek-v4-flash', max_tokens: 5, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: `${filler}\n\nReply with the single word OK.` }] }) });
  const j = await res.json().catch(() => ({}));
  console.log(`chars ${chars}: HTTP ${res.status} in ${Date.now() - t0} ms; usage ${JSON.stringify(j.usage ?? null)}; error ${JSON.stringify(j.error ?? null).slice(0, 220)}`);
  if (!res.ok) break;
}
