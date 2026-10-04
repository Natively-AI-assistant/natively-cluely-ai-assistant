// Provider token count vs the app's chars/4 estimate, per kind of text. Direct DeepSeek, max_tokens 1. Keys never printed.
import fs from 'node:fs';
const env = fs.readFileSync('/Users/evin/natively-cluely-ai-assistant/.env', 'utf8');
const DS = (env.match(/^DEEPSEEK_API_KEY=(.*)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
const call = async (content) => { const r = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + DS, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'deepseek-flash', max_tokens: 1, temperature: 0, thinking: { type: 'disabled' }, messages: [{ role: 'user', content }] }) }); const j = await r.json(); return j.usage?.prompt_tokens ?? null; };
const base = await call('x');
const zh = '本季度运营评审涵盖了人员配置、工具迁移、支持轮值和发布日历。团队确认仓库闸门代码已更新，供应商预算需要在十一月前重新审批。';
const ja = '今四半期の運用レビューでは、人員配置、ツール移行、サポート当番、リリース日程について確認しました。倉庫のゲートコードは更新済みです。';
const ru = 'В квартальном обзоре обсудили штатное расписание, перенос инструментов, график дежурств и календарь релизов. Код ворот склада обновлён.';
const es = 'La revisión trimestral cubrió la plantilla, la migración de herramientas, la rota de soporte y el calendario de lanzamientos. El código de la puerta se actualizó.';
const json = JSON.stringify(Array.from({ length: 60 }, (_, i) => ({ id: 'ITM-' + (1000 + i), owner: 'Jordan Ashcombe', status: i % 3 ? 'open' : 'closed', due: '2026-11-' + String(1 + (i % 28)).padStart(2, '0'), note: 'Gate code \"HX-' + i + '\" & vendor sign-off' })), null, 2);
const files = { 'csv (risk register)': '/Users/evin/natively-cluely-ai-assistant/.claude/worktrees/aq-fix/benchmarks/natively-answer-quality/evidence-rich/evidence/files/TEAM-REF-RISK-REGISTER/Mossgauge_3.0_risk_register.csv', 'csv (budget)': '/Users/evin/natively-cluely-ai-assistant/.claude/worktrees/aq-fix/benchmarks/natively-answer-quality/evidence-rich/evidence/files/GEN-REF-BUDGET-OCT/household_budget_oct2026.csv', 'md (lecture notes)': '/Users/evin/natively-cluely-ai-assistant/.claude/worktrees/aq-fix/benchmarks/natively-answer-quality/evidence-rich/evidence/files/LEC-REF-ECN-NOTES-L3-5/ECN1620_Kessandru_Notes_L3-L5.md' };
const texts = { 'zh prose': zh.repeat(60), 'ja prose': ja.repeat(60), 'ru prose': ru.repeat(40), 'es prose': es.repeat(40), 'json (quote-heavy)': json };
for (const [k, p] of Object.entries(files)) texts[k] = fs.readFileSync(p, 'utf8').slice(0, 20000);
console.log('baseline prompt tokens for one char:', base);
for (const [k, t] of Object.entries(texts)) { const n = (await call(t)) - base; const est = Math.ceil(t.length / 4); console.log(k.padEnd(22), 'chars', String(t.length).padStart(6), '| chars/4', String(est).padStart(5), '| provider', String(n).padStart(5), '| provider/estimate', (n / est).toFixed(2), '| chars per token', (t.length / n).toFixed(2)); }
