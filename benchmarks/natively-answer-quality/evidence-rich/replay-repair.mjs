#!/usr/bin/env node
// E10: replay the heard path's document-grounded "corrected answer" repair with its inherited prompt cut at 24,000
// (as recorded) and whole (≤ 96,000). Rule: docs/ITERATIONS-ER.md § E10, written before this ran.
//   node evidence-rich/replay-repair.mjs --runs er-dev-m1,er-dev-m1r,er-dev-m2,er-holdout-m1 --k 2 [--limit N]
// Output: results/replay/e10.jsonl — one line per (run, id, arm, k). Direct DeepSeek; the key is read in-process.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRun } from './objective.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2); const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const CV = path.join(HERE, 'results', '.cv', 'repair-efc126a9');
const P = await import(path.join(CV, 'promptSystemV2.mjs')); const D = await import(path.join(CV, 'documentGroundedPrompt.mjs')); const RC = await import(path.join(CV, 'repairCap.mjs'));
const SUFFIX = JSON.parse(fs.readFileSync(path.join(HERE, 'results', '.cv', 'system-suffix.json'), 'utf8')).suffix;
const SYSTEM = D.appendCustomModeSystemPromptLayer({ baseSystemPrompt: P.resolveV2SystemPrompt({ action: 'answer', surface: 'live', tier: P.v2TierForPromptTier(undefined) }) }) + SUFFIX;
const KEY = (fs.readFileSync('/Users/evin/natively-cluely-ai-assistant/.env', 'utf8').match(/^DEEPSEEK_API_KEY=(.*)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
const SEP = '\n\n---\n'; const MARK = '[...answer context truncated for the repair pass...]'; const WHOLE_CAP = 96000;
const OUT = path.join(HERE, 'results', 'replay', 'e10.jsonl'); fs.mkdirSync(path.dirname(OUT), { recursive: true });
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); return `${j.run}|${j.id}|${j.arm}|${j.k}`; }) : []);

const tasks = [];
for (const runName of String(opt('runs')).split(',')) {
  const run = loadRun(path.join(HERE, 'results', runName));
  for (const row of run.rows) {
    const w = run.wire[row.benchmark_id]; if (!w) continue;
    const rep = (w.other_requests ?? []).find((o) => /Output ONLY the corrected answer/.test((o.messages ?? []).map((m) => m.text ?? '').join('\n'))); if (!rep) continue;
    const recorded = (rep.messages ?? []).map((m) => m.text ?? '').join('\n');
    const gen = (w.messages ?? []).filter((m) => m.role !== 'system').map((m) => m.text ?? '').join('\n');
    const at = recorded.indexOf(`${SEP}<rewrite_instructions`); if (at < 0) { console.warn('no repair split', runName, row.benchmark_id); continue; }
    const repairMsg = recorded.slice(at + SEP.length);
    if (!recorded.slice(0, 2000).startsWith(gen.slice(0, 2000))) { console.warn('recorded repair does not start with the generator prompt', runName, row.benchmark_id); continue; }
    const inherited = gen.length > WHOLE_CAP ? `${gen.slice(0, WHOLE_CAP)}\n\n${MARK}` : gen;
    const arms = { cut: recorded, whole: `${inherited}${SEP}${repairMsg}` };
    for (let k = 0; k < Number(opt('k', 2)); k++) for (const [arm, user] of Object.entries(arms)) if (!done.has(`${runName}|${row.benchmark_id}|${arm}|${k}`)) tasks.push({ run: runName, id: row.benchmark_id, arm, k, user, recordedCut: recorded.includes(MARK), genChars: gen.length });
  }
}
const lim = Number(opt('limit', 0)); if (lim) tasks.splice(lim);
console.log(`tasks ${tasks.length} (system ${SYSTEM.length} chars)`);

async function one(t) {
  const ac = new AbortController(); const t0 = Date.now(); let text = ''; let first = null; let stop = 'done';
  const deadline = setTimeout(() => { if (text.trim().length < 5) { stop = 'deadline'; ac.abort(); } }, 7000);
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST', signal: ac.signal, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-flash', stream: true, temperature: 0.2, seed: 7, max_tokens: 8192, thinking: { type: 'disabled' }, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: t.user }] }) });
    if (!res.ok) throw new Error(`deepseek ${res.status}`);
    const dec = new TextDecoder(); let buf = '';
    outer: for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true }); let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line.startsWith('data:')) continue; const body = line.slice(5).trim(); if (body === '[DONE]') break outer;
        let j; try { j = JSON.parse(body); } catch { continue; } const d = j.choices?.[0]?.delta?.content ?? ''; if (d) { text += d; if (first === null && text.trim().length >= 5) first = Date.now() - t0; if (RC.repairCapReached(text, 1800)) { stop = 'cap'; ac.abort(); break outer; } } }
    }
  } catch (e) { if (stop === 'done') stop = `error:${String(e.message).slice(0, 60)}`; }
  clearTimeout(deadline);
  if (RC.endsInsideFence?.(text)) text = '';
  return { run: t.run, id: t.id, arm: t.arm, k: t.k, text: text.trim(), stop, ms_first: first, ms_total: Date.now() - t0, user_chars: t.user.length, gen_chars: t.genChars, recorded_cut: t.recordedCut };
}
let next = 0; let n = 0;
await Promise.all(Array.from({ length: Number(opt('concurrency', 4)) }, async () => { while (next < tasks.length) { const t = tasks[next++]; const r = await one(t); fs.appendFileSync(OUT, JSON.stringify(r) + '\n'); if (++n % 20 === 0) console.log(`${n}/${tasks.length}`); } }));
console.log('done', n);
