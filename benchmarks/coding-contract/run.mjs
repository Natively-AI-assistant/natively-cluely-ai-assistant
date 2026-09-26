// benchmarks/coding-contract/run.mjs
//
// LIVE coding-contract benchmark. Puts every scenario through the REAL
// pipeline — planAnswer → resolveCodingPromptSignals → buildSystemPromptV2 →
// buildTurnContentV2 → a real model → validateAnswerStructure repair — and
// grades the ACTUAL returned text.
//
// This is the instrument for the audit in
// .audit/coding-template-audit-2026-08-18.md. Prompt-level unit tests prove
// what REACHES the model; only this proves what the model DOES with it.
//
//   node benchmarks/coding-contract/run.mjs [--filter=<substr>] [--concurrency=4]
//                                           [--model=gemini-3.1-flash-lite] [--limit=N]
//
// Reads GEMINI_API_KEY from .env (or the environment). Writes
// benchmarks/coding-contract/results.json + report.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import scenarios from './scenarios.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

// ── env ─────────────────────────────────────────────────────────────────────
for (const file of ['.env.local', '.env']) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

const MODEL = argv.model || process.env.E2E_GEMINI_MODEL || 'gemini-3.1-flash-lite';
const API_KEY = process.env.GEMINI_API_KEY || process.env.E2E_GEMINI_API_KEY;
const CONCURRENCY = Number(argv.concurrency || 4);
if (!API_KEY) {
  console.error('No GEMINI_API_KEY in .env or the environment — cannot run a LIVE benchmark.');
  process.exit(1);
}

// ── the real pipeline ───────────────────────────────────────────────────────
const dist = (rel) => path.join(ROOT, 'dist-electron/electron/llm', rel);
const { planAnswer, validateAnswerStructure } = await import(dist('index.js'));
const { resolveCodingPromptSignals } = await import(dist('codingPromptSignals.js'));
const { buildSystemPromptV2, buildTurnContentV2, splitGistLine } = await import(dist('promptSystemV2.js'));

// ── model call ──────────────────────────────────────────────────────────────
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

async function ask(system, user, attempt = 0) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'x-goog-api-key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: 2048, temperature: 0.2 },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    // 429 / 5xx: back off and retry, up to 4 attempts.
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      return ask(system, user, attempt + 1);
    }
    throw new Error(`${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  const parts = json.candidates?.[0]?.content?.parts;
  return Array.isArray(parts) ? parts.map((p) => p.text || '').join('') : '';
}

// ── grading ─────────────────────────────────────────────────────────────────
const DSA_HEADINGS = ['## Approach', '## Technique', '## Code', '## Dry Run', '## Complexity', '## Interviewer Follow-up'];
const FENCE_RE = /```([a-zA-Z0-9_+#-]*)\n([\s\S]*?)```/g;

const codeBlocks = (text) => {
  const out = [];
  FENCE_RE.lastIndex = 0;
  let m;
  while ((m = FENCE_RE.exec(text))) out.push({ lang: (m[1] || '').toLowerCase(), code: m[2] });
  return out;
};

function grade(scenario, answer) {
  const e = scenario.expect || {};
  const blocks = codeBlocks(answer);
  const failures = [];

  if (e.code === true && blocks.length === 0) failures.push('no code block');
  if (e.code === false && blocks.length > 0) failures.push(`unexpected code block (${blocks[0].lang || 'untagged'})`);

  if (e.lang && blocks.length) {
    const got = blocks[0].lang;
    if (!e.lang.includes(got)) failures.push(`fence tag "${got || 'untagged'}" not in [${e.lang.join('|')}]`);
  }

  const headingsPresent = DSA_HEADINGS.filter((h) => answer.includes(h));
  if (e.dsa === 'all' && headingsPresent.length < DSA_HEADINGS.length) {
    failures.push(`missing DSA sections: ${DSA_HEADINGS.filter((h) => !answer.includes(h)).join(', ')}`);
  }
  if (e.dsa === 'none' && headingsPresent.length > 0) {
    failures.push(`unexpected DSA sections: ${headingsPresent.join(', ')}`);
  }

  for (const re of e.mustContain || []) {
    if (!re.test(answer)) failures.push(`missing required pattern ${re}`);
  }
  for (const re of e.mustNotContain || []) {
    if (re.test(answer)) failures.push(`matched forbidden pattern ${re}`);
  }

  return { pass: failures.length === 0, failures, blocks: blocks.length, headings: headingsPresent.length };
}

// ── one scenario ────────────────────────────────────────────────────────────
async function runOne(scenario) {
  const started = Date.now();
  const plan = planAnswer({
    question: scenario.question,
    source: 'manual_input',
    speakerPerspective: 'user',
    activeMode: { templateType: scenario.mode, isCustom: false },
  });
  const signals = resolveCodingPromptSignals({
    answerType: plan.answerType,
    question: scenario.question,
    surroundingText: scenario.screen,
    priorCodingTurnExists: scenario.priorCodingTurnExists,
  });
  const system = buildSystemPromptV2({
    mode: scenario.mode, action: 'answer', tier: scenario.tier || 'cloud', ...signals,
  });
  const evidence = [];
  if (scenario.screen) evidence.push({ kind: 'screen', content: scenario.screen });
  if (scenario.prior) {
    evidence.push({
      kind: 'meeting_memory',
      content: `Previous question: ${scenario.prior.question}\n\nPrevious answer:\n${scenario.prior.answer}`,
    });
  }
  const user = buildTurnContentV2({ evidence, currentTurn: scenario.question });

  let answer = '';
  let error = null;
  try {
    answer = await ask(system, user);
    // `[[GIST]]` is a product marker the renderer splits off and never displays
    // in the body — strip it the way the app does, or the harness grades a
    // string the user never sees.
    answer = splitGistLine(answer).body;
    // The real repair layer runs on the real output.
    const validation = validateAnswerStructure(plan.answerType, answer, signals.codingFormat ?? null);
    if (!validation.ok && validation.repaired) answer = validation.repaired;
  } catch (err) {
    error = err.message;
  }

  const result = error
    ? { pass: false, failures: [`API error: ${error}`], blocks: 0, headings: 0 }
    : grade(scenario, answer);

  return {
    group: scenario.group,
    id: scenario.id,
    mode: scenario.mode,
    tier: scenario.tier || 'cloud',
    question: scenario.question,
    answerType: plan.answerType,
    signals: {
      codingTask: signals.codingTask,
      kind: signals.codingTaskKind ?? null,
      format: signals.codingFormat ?? null,
      template: !!signals.suppliedTemplate,
    },
    ...result,
    ms: Date.now() - started,
    answer,
  };
}

// ── driver ──────────────────────────────────────────────────────────────────
let queue = scenarios;
if (argv.filter) queue = queue.filter((s) => (s.group + ' ' + s.id).toLowerCase().includes(String(argv.filter).toLowerCase()));
if (argv.limit) queue = queue.slice(0, Number(argv.limit));

console.log(`[coding-contract] ${queue.length} scenarios · model=${MODEL} · concurrency=${CONCURRENCY}\n`);

const results = [];
let cursor = 0;
let done = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (cursor < queue.length) {
    const scenario = queue[cursor++];
    const r = await runOne(scenario);
    results.push(r);
    done++;
    const mark = r.pass ? 'PASS' : 'FAIL';
    process.stdout.write(`  ${String(done).padStart(3)}/${queue.length}  ${mark}  ${r.group}/${r.id}${r.pass ? '' : '  → ' + r.failures.join('; ')}\n`);
  }
}));

results.sort((a, b) => (a.group + a.id).localeCompare(b.group + b.id));

// ── report ──────────────────────────────────────────────────────────────────
const byGroup = new Map();
for (const r of results) {
  if (!byGroup.has(r.group)) byGroup.set(r.group, []);
  byGroup.get(r.group).push(r);
}

const passed = results.filter((r) => r.pass).length;
const lines = [];
lines.push('# Coding-contract live benchmark');
lines.push('');
lines.push(`Model \`${MODEL}\` · ${results.length} scenarios · **${passed}/${results.length} pass** (${Math.round((passed / results.length) * 100)}%)`);
lines.push('');
lines.push('Real planner, real prompt composer, real model, real repair layer. Graded');
lines.push('deterministically on the returned text. See `.audit/coding-template-audit-2026-08-18.md`.');
lines.push('');
lines.push('| group | pass | of | notes |');
lines.push('| --- | --- | --- | --- |');
for (const [group, rs] of [...byGroup.entries()].sort()) {
  const p = rs.filter((r) => r.pass).length;
  lines.push(`| ${group} | ${p} | ${rs.length} | ${p === rs.length ? '—' : rs.filter((r) => !r.pass).map((r) => r.id).join(', ')} |`);
}
lines.push('');
const failures = results.filter((r) => !r.pass);
if (failures.length) {
  lines.push('## Failures');
  lines.push('');
  for (const f of failures) {
    lines.push(`### ${f.group} / ${f.id}`);
    lines.push('');
    lines.push(`- question: \`${f.question.replace(/\n/g, '\\n').slice(0, 160)}\``);
    lines.push(`- routed: \`${f.answerType}\` · kind=\`${f.signals.kind}\` · format=\`${f.signals.format}\` · template=\`${f.signals.template}\``);
    lines.push(`- why: ${f.failures.join('; ')}`);
    lines.push('');
    lines.push('```');
    lines.push(f.answer.slice(0, 900));
    lines.push('```');
    lines.push('');
  }
}

fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 2));
fs.writeFileSync(path.join(__dirname, 'report.md'), lines.join('\n'));

console.log(`\n[coding-contract] ${passed}/${results.length} pass`);
console.log(`[coding-contract] report → benchmarks/coding-contract/report.md`);
process.exit(failures.length ? 1 : 0);
