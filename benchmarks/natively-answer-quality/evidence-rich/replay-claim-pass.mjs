#!/usr/bin/env node
// Offline replay of the app's claim pass over the drafts a run recorded.
//
// For every row whose turn ran the claim pass, the same request is rebuilt from the recorded prompt and draft and sent
// to the same model with the app's parameters; the app's own runClaimVerifier (budget, abort rule, rails) decides
// what is shown. Only the things an arm names differ, so two arms on the same drafts are a paired comparison.
// A replay is never compared with what the app itself produced: both arms of a comparison come from this harness.
//
//   node evidence-rich/replay-claim-pass.mjs --cv <bundle.mjs> --runs evidence-rich/results/er-dev-e1,… \
//        --name cut24 --cap 24000 [--k 2] [--concurrency 6] [--variant path/to/variant.mjs] [--limit N]
//
// --cv       the app's claimVerifier + cleanAnswerArtifacts, bundled:
//            (cd <app worktree> && printf "export * from './electron/llm/claimVerifier';\nexport { cleanAnswerArtifacts } from './electron/llm/answerPolish';\n" > .e.ts \
//              && node_modules/.bin/esbuild .e.ts --bundle --platform=node --format=esm --outfile=<bundle.mjs>; rm .e.ts)
// --cap      how many characters of the answer's prompt the pass may see (the app: 24,000 on both surfaces)
// --variant  optional module: systemPrompt(recorded, ctx) → string, and/or accept(verdict, ctx) → verdict
// Output: results/replay/<name>.jsonl, one line per row and repetition:
//   { run, id, k, surface, cap, outcome, changed, text, scratch, ms, in_chars, saw_whole, rebuilt_matches_recorded }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import { loadRun } from './objective.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const name = opt('name'); const cap = Number(opt('cap', 24000)); const recordedCap = Number(opt('recorded-cap', 24000)); // the cap the RECORDING app used, for the fidelity check const K = Number(opt('k', 1)); const limit = opt('limit') ? Number(opt('limit')) : null;
if (!name || !opt('cv') || !opt('runs')) { console.error('need --name, --cv and --runs'); process.exit(2); }
const cv = await import(pathToFileURL(path.resolve(opt('cv'))).href);
const variant = opt('variant') ? await import(pathToFileURL(path.resolve(opt('variant'))).href) : {};
const env = fs.readFileSync(process.env.NATIVELY_ENV_FILE || '/Users/evin/natively-cluely-ai-assistant/.env', 'utf8');
const KEY = (env.match(/^DEEPSEEK_API_KEY=(.*)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
if (!KEY) { console.error('no DeepSeek key in the env file'); process.exit(2); }

// The recorder kept only a hash of the pass's system prompt. It is rebuilt from the app's own function plus the
// language suffix the app appends to every system prompt (recovered once from a recorded answer prompt, --suffix),
// and each rebuilt prompt is checked against the recorded hash.
const SUFFIX = JSON.parse(fs.readFileSync(path.resolve(opt('suffix', path.join(HERE, 'results', '.cv', 'system-suffix.json'))), 'utf8')).suffix;
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);
const TRUNC = '\n\n[...answer context truncated for the repair pass...]';
/** The request as the app builds it: the heard pass inherits the answer's prompt, the typed pass wraps it as MATERIAL. */
export function buildMessage(surface, full, draftBody, capChars) {
  if (surface === 'typed') return `MATERIAL:\n${full.slice(0, capChars)}\n\n---\n${cv.claimVerifierDraftMessage(draftBody)}`;
  const inherited = full.length > capChars ? `${full.slice(0, capChars)}${TRUNC}` : full;
  return `${inherited}\n\n---\n${cv.claimVerifierDraftMessage(draftBody)}`;
}

async function* deepseekStream(model, system, user, signal) {
  const res = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST', signal,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: true, temperature: 0.2, seed: 7, max_tokens: 8192, thinking: { type: 'disabled' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
  if (!res.ok) throw new Error(`deepseek ${res.status}`);
  const dec = new TextDecoder(); let buf = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim(); if (data === '[DONE]') return;
      try { const tok = JSON.parse(data).choices?.[0]?.delta?.content; if (tok) yield tok; } catch { /* keep-alive */ }
    }
  }
}

const jobs = [];
for (const r of String(opt('runs')).split(',')) {
  const dir = path.resolve(HERE, '..', r); const run = loadRun(dir); const runName = path.basename(dir);
  for (const row of run.rows) {
    const w = run.wire[row.benchmark_id];
    const pass = (w?.other_requests ?? []).find((o) => /DRAFT REPLY:/.test((o.messages ?? []).map((m) => m.text ?? '').join('\n')));
    if (!pass) continue;
    const recorded = (pass.messages ?? []).map((m) => m.text ?? '').join('\n');
    const draftBody = recorded.slice(recorded.lastIndexOf('DRAFT REPLY:') + 'DRAFT REPLY:'.length).trim();
    const full = (w.messages ?? []).filter((m) => m.role !== 'system').map((m) => m.text ?? '').join('\n');
    const surface = row.surface === 'typed' ? 'typed' : 'hotkey';
    const item = run.ds.byId[row.benchmark_id];
    const system = cv.claimVerifierSystemPrompt(item.mode, surface === 'typed' ? 'typed' : 'spoken', { noDocuments: cv.materialHasNoDocuments(full) }) + SUFFIX;
    jobs.push({ run: runName, row, item, surface, full, draftBody, recorded, model: pass.model, system, systemOk: sha(system) === pass.systemSha });
  }
}
const todo = limit ? jobs.slice(0, limit) : jobs;
const outDir = path.join(HERE, 'results', 'replay'); fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${name}.jsonl`);
const done = new Set(fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); return `${j.run}|${j.id}|${j.k}`; }) : []);
const lim = (n) => { let a = 0; const q = []; const nx = () => { if (a >= n || !q.length) return; a++; const { f, r, j } = q.shift(); f().then(r, j).finally(() => { a--; nx(); }); }; return (f) => new Promise((r, j) => { q.push({ f, r, j }); nx(); }); };
const L = lim(Number(opt('concurrency', 6)));
const missingSystem = todo.filter((j) => !j.systemOk).length;
await Promise.all(todo.flatMap((j) => Array.from({ length: K }, (_, k) => L(async () => {
  if (done.has(`${j.run}|${j.row.benchmark_id}|${k}`)) return;
  const ctx = { ...j, cap };
  const system = variant.systemPrompt ? variant.systemPrompt(j.system, ctx) : j.system;
  let scratch = '';
  const run = await cv.runClaimVerifier({
    answer: j.row.raw_answer, material: j.full, budgetMs: cv.CLAIM_VERIFIER_BUDGET_MS,
    startStream: (body, signal) => (async function* () { let out = ''; for await (const t of deepseekStream(j.model, system, buildMessage(j.surface, j.full, body, cap), signal)) { out += t; yield t; } scratch = cv.splitVerifierScratch(out).scratch; })(),
    clean: cv.cleanAnswerArtifacts,
  });
  let verdict = { text: run.text, changed: run.changed, outcome: run.outcome };
  if (variant.accept) verdict = variant.accept(verdict, { ...ctx, scratch, cv }) ?? verdict;
  fs.appendFileSync(outFile, JSON.stringify({ run: j.run, id: j.row.benchmark_id, k, surface: j.surface, cap, outcome: verdict.outcome, changed: verdict.changed, text: verdict.text, scratch, ms: run.ms,
    in_chars: buildMessage(j.surface, j.full, j.draftBody, cap).length, saw_whole: j.full.length <= cap, rebuilt_matches_recorded: buildMessage(j.surface, j.full, j.draftBody, recordedCap) === j.recorded }) + '\n');
}))));
const R = fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const t = {}; for (const r of R) t[r.outcome.replace(/:.*/, '')] = (t[r.outcome.replace(/:.*/, '')] ?? 0) + 1;
const ms = R.map((r) => r.ms).sort((a, b) => a - b);
console.log(`${name}: ${R.length} replays of ${todo.length} rows (cap ${cap}, k ${K})`, t, `ms p50 ${ms[Math.floor(ms.length / 2)] ?? '-'} p90 ${ms[Math.floor(ms.length * 0.9)] ?? '-'}; rebuilt request equals the recorded one on ${R.filter((r) => r.rebuilt_matches_recorded).length}/${R.length}; rows whose rebuilt system prompt does not match the recorded hash ${missingSystem}`);
