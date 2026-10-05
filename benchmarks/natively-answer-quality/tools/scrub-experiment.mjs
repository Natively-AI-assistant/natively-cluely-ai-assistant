#!/usr/bin/env node
// Offline experiment: a second "personal-claim verifier" pass over recorded answers. For each row, the evidence the
// app actually put in the prompt (user message) + the answer go to deepseek-flash with an editing instruction; the
// edited answer is written as a replay-format record so astra/judge-replay.mjs can score it.
//   node tools/scrub-experiment.mjs --run aq2-dev-fix2 --mode looking-for-work --name lfw-scrub1
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const run = opt('run'); const mode = opt('mode'); const name = opt('name');
const env = fs.readFileSync('/Users/evin/natively-cluely-ai-assistant/.env', 'utf8');
const KEY = (env.match(/^DEEPSEEK_API_KEY=(.*)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
const ids = opt('ids') ? new Set(opt('ids').split(',')) : null;
const rows = fs.readFileSync(path.join(ROOT, 'results', run, 'natively_benchmark_full.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).filter((r) => (!mode || mode.split(',').includes(r.mode)) && (!ids || ids.has(r.benchmark_id)));
const wires = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'results', run, 'natively_benchmark_wire.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { const w = JSON.parse(l); return [w.benchmark_id, w]; }));
const PERSONA = { 'looking-for-work': 'a job candidate is about to say aloud in an interview', 'technical-interview': 'a job candidate is about to say aloud in a technical interview',
  general: 'the user is about to say aloud in a conversation', sales: 'a seller is about to say aloud to a prospect', 'call-center': 'a support agent is about to say aloud to a customer' };
const SUBJECT = { sales: 'the seller, their product or their company', 'call-center': 'the agent, their product, their company or its policies' };
export const scrubSystem = (mode) => `You edit a reply that ${PERSONA[mode] ?? 'the user is about to say aloud'}. You receive the material the assistant had (documents, profile, conversation) and the draft reply.
Remove or neutralise every statement about ${SUBJECT[mode] ?? 'the speaker themselves'} that the material does not state: preferences and stances ("I'm open to", "that works for me", "I'm taking it seriously"), willingness, motives and reasons, strengths and weaknesses, habits or practices presented as their own history, feelings, events, numbers, prices, capabilities, integrations, customers, results, guarantees and commitments not in the material. A denial ("I haven't", "we don't") is a statement too.
Keep everything the material supports, everything the other person stated, and general reasoning. Keep the same voice, natural and speakable. Never say you cannot speak to something, do not have it, or that it is not available; never mention the material, a résumé, notes or what is missing. Do not add facts.
If removing a claim leaves the question unanswered, answer with what stays true and hand it back with one practical question (for example "I'd want to talk that through properly. What does the timeline look like?").
Output only the revised reply. If nothing needs changing, output it unchanged.`;
const lim = (n) => { let a = 0; const q = []; const nx = () => { if (a >= n || !q.length) return; a++; const { f, r, j } = q.shift(); f().then(r, j).finally(() => { a--; nx(); }); }; return (f) => new Promise((r, j) => { q.push({ f, r, j }); nx(); }); };
const L = lim(8); const outFile = path.join(ROOT, 'results', 'replay', `${name}.jsonl`); fs.writeFileSync(outFile, '');
await Promise.all(rows.map((r) => L(async () => {
  const w = wires[r.benchmark_id]; const material = (w?.messages ?? []).filter((m) => m.role === 'user').map((m) => m.text).join('\n\n');
  const draft = (r.rendered_answer ?? r.raw_answer ?? '').replace(/\n*\[\[GIST\]\][\s\S]*$/, '').trim();
  const t0 = Date.now();
  const res = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-flash', temperature: 0.2, max_tokens: 600, thinking: { type: 'disabled' }, stream: false,
      messages: [{ role: 'system', content: scrubSystem(r.mode) }, { role: 'user', content: `MATERIAL:\n${material.slice(0, 12000)}\n\nDRAFT REPLY:\n${draft}` }] }) });
  const j = await res.json(); const edited = (j.choices?.[0]?.message?.content ?? draft).trim();
  fs.appendFileSync(outFile, JSON.stringify({ id: r.benchmark_id, mode: r.mode, surface: r.surface_path, variant: 'scrub', k: 0, answer: edited, original: draft, ms: Date.now() - t0, changed: edited !== draft }) + '\n');
})));
const R = fs.readFileSync(outFile, 'utf8').trim().split('\n').map(JSON.parse);
const ms = R.map((r) => r.ms).sort((a, b) => a - b);
console.log(`${name}: ${R.length} rows, changed ${R.filter((r) => r.changed).length}, scrub latency p50 ${ms[Math.floor(ms.length / 2)]} ms p90 ${ms[Math.floor(ms.length * 0.9)]} ms`);
