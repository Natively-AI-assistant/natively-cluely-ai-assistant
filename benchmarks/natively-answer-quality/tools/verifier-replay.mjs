#!/usr/bin/env node
// Offline claim verifier: the app's own module (electron/llm/claimVerifier.ts, bundled with esbuild) applied to a
// run's recorded answers — same gate, same prompts, same rails — so a verifier change can be judged
// (astra/judge-replay.mjs) before it is built into the app. Material = the recorded V3 user message.
//   node tools/verifier-replay.mjs --run aq2-dev-fix2 --module <bundle.mjs> --name <out> [--mode m1,m2] [--concurrency 8]
//     [--draft raw]  verify the streamed draft (raw_answer) instead of the shown answer — for runs whose shown answer
//                    is already verified (fix4 and later)
// Bundle: npx esbuild <app>/electron/llm/claimVerifier.ts --bundle --platform=node --format=esm --outfile=tools/variants/_claimVerifier-bundle.mjs
// Output: results/replay/<name>.jsonl — {id, mode, surface, variant:'verifier', k:0, answer, original, kind, outcome, ms}
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const run = opt('run'); const name = opt('name'); const modes = opt('mode') ? new Set(opt('mode').split(',')) : null; const ids = opt('ids') ? new Set(opt('ids').split(',')) : null;
const cv = await import(pathToFileURL(path.resolve(opt('module'))).href);
const ANSWERS = opt('answers') ? Object.fromEntries(fs.readFileSync(path.resolve(opt('answers')), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => (x.k ?? 0) === 0).map((x) => [x.id, x.answer])) : null;
const env = fs.readFileSync(process.env.NATIVELY_ENV_FILE || '/Users/evin/natively-cluely-ai-assistant/.env', 'utf8');
const KEY = (env.match(/^DEEPSEEK_API_KEY=(.*)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
const rows = fs.readFileSync(path.join(ROOT, 'results', run, 'natively_benchmark_full.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
  .filter((r) => (!modes || modes.has(r.mode)) && (!ids || ids.has(r.benchmark_id)));
const wires = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'results', run, 'natively_benchmark_wire.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { const w = JSON.parse(l); return [w.benchmark_id, w]; }));
const lim = (n) => { let a = 0; const q = []; const nx = () => { if (a >= n || !q.length) return; a++; const { f, r, j } = q.shift(); f().then(r, j).finally(() => { a--; nx(); }); }; return (f) => new Promise((r, j) => { q.push({ f, r, j }); nx(); }); };
const L = lim(Number(opt('concurrency', 8)));
const outFile = path.join(ROOT, 'results', 'replay', `${name}.jsonl`); fs.writeFileSync(outFile, '');
await Promise.all(rows.map((r) => L(async () => {
  // --answers <replay.jsonl>: verify a generator REPLAY's answers (k = 0) instead of the run's own; rows the replay
  // does not hold are skipped. The material stays the recorded prompt (a notice a variant added is an instruction,
  // not evidence).
  if (ANSWERS && !(r.benchmark_id in ANSWERS)) return;
  const answer = (ANSWERS ? ANSWERS[r.benchmark_id] : opt('draft') === 'raw' ? r.raw_answer : (r.rendered_answer ?? r.raw_answer)) ?? '';
  const material = (wires[r.benchmark_id]?.messages ?? []).filter((m) => m.role === 'user').map((m) => m.text ?? m.content).join('\n\n');
  const kind = cv.claimVerifierKind({ modeId: r.mode, question: r.question, draft: answer, surface: r.surface_path === 'typed' ? 'typed' : 'spoken' });
  const rec = { id: r.benchmark_id, mode: r.mode, surface: r.surface_path, variant: 'verifier', k: 0, answer, original: answer, kind, outcome: 'not_gated', ms: 0 };
  if (kind && answer.trim()) {
    const system = cv.claimVerifierSystemPrompt(r.mode, r.surface_path === 'typed' ? 'typed' : 'spoken', { noDocuments: cv.materialHasNoDocuments(material) });
    const t0 = Date.now();
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'deepseek-flash', temperature: 0.2, max_tokens: 1200, thinking: { type: 'disabled' }, stream: false,
          messages: [{ role: 'system', content: system }, { role: 'user', content: cv.claimVerifierStandaloneMessage(material, cv.splitGistTrailer(answer).body) }] }) });
      const j = await res.json();
      const v = cv.acceptVerifiedAnswer({ original: answer, edited: j.choices?.[0]?.message?.content ?? '', material });
      Object.assign(rec, { answer: v.text, outcome: v.reason, ms: Date.now() - t0, out_tokens: j.usage?.completion_tokens ?? null, ...((cv.splitScratch ?? cv.splitVerifierScratch) ? { scratch: (cv.splitScratch ?? cv.splitVerifierScratch)(j.choices?.[0]?.message?.content ?? '').scratch.trim() } : {}) });
    } catch (e) { rec.outcome = `error`; }
  }
  fs.appendFileSync(outFile, JSON.stringify(rec) + '\n');
})));
const R = fs.readFileSync(outFile, 'utf8').trim().split('\n').map(JSON.parse);
const t = {}; for (const r of R) t[r.outcome] = (t[r.outcome] ?? 0) + 1;
console.log(`${name}: ${R.length} rows`, t);
