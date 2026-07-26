// scripts/benchmark-sd-grounding.js
//
// Real-API quality harness for system-design lesson grounding.
// Boots a real Electron app against a throwaway userData dir, ingests the
// hellointerview LESSON corpus (or committed fixtures), activates Technical
// Interview mode, and runs canonical SD questions against the Natively API
// (server model = gemini-3.1-flash-lite via BENCHMARK_MODEL).
//
// Preferred path (Gemini direct — same key for embeddings + chat):
//   RUN_SD_GROUNDING_E2E=1  (or RUN_NATIVELY_API_E2E=1 / RUN_SD_REQUIREMENTS_GATE_E2E=1)
//   GEMINI_API_KEY=<key>
//
// Fallback path (Natively gateway):
//   RUN_NATIVELY_API_E2E=1
//   NATIVELY_API_KEY=<key>
//
// Run:
//   npm run build:electron
//   RUN_SD_GROUNDING_E2E=1 GEMINI_API_KEY=<key> \
//     [BENCHMARK_MODEL=gemini-3.1-flash-lite] \
//     [SD_BENCHMARK_SPLIT=development|full] \
//     [SD_LESSONS_DIR=/path/to/lessons] \
//     [SD_CHECKPOINT=/path/to/checkpoint.json] \
//     ./node_modules/.bin/electron scripts/benchmark-sd-grounding.js
//
// The API key is never logged.

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
} catch { /* optional */ }

const { app } = require('electron');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
const {
  shouldRunRealApi,
  resolveGeminiApiKey,
  resolveBenchmarkModel,
  resolveSplit,
  selectQuestions,
  assertAnswer,
  defaultCheckpointPath,
  loadCheckpoint,
  markQuestionComplete,
  filterPendingQuestions,
  summarizeResults,
  DEFAULT_QUESTION_TIMEOUT_MS,
  DEFAULT_MAX_ATTEMPTS,
} = require('./lib/sd-grounding-harness.js');

// Ensure BENCHMARK_MODEL is set before any intelligence-flag reads (same pattern
// as package.json benchmark:* scripts).
process.env.BENCHMARK_MODEL = resolveBenchmarkModel(process.env);

const GEMINI_KEY = resolveGeminiApiKey(process.env);
const NATIVELY_KEY = (process.env.NATIVELY_API_KEY || '').trim();
if (!shouldRunRealApi(process.env)) {
  console.log(
    '[sd-bench] SKIP — set RUN_SD_GROUNDING_E2E=1 (or RUN_NATIVELY_API_E2E=1) ' +
    '+ GEMINI_API_KEY (preferred) or NATIVELY_API_KEY',
  );
  process.exit(0);
}

// E2E boot: ingest-lessons + main.ts expect this for scripted runs.
process.env.NATIVELY_E2E = process.env.NATIVELY_E2E || '1';

const MODEL = process.env.BENCHMARK_MODEL;
const SPLIT = resolveSplit(process.env);
const TIMEOUT_MS = Number(process.env.SD_QUESTION_TIMEOUT_MS) || DEFAULT_QUESTION_TIMEOUT_MS;
const MAX_ATTEMPTS = Number(process.env.SD_MAX_ATTEMPTS) || DEFAULT_MAX_ATTEMPTS;
const CHECKPOINT_PATH = process.env.SD_CHECKPOINT || defaultCheckpointPath(repoRoot);

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-sd-bench-'));
app.setPath('userData', tmpUserData);

function resolveLessonsDir() {
  const envDir = process.env.SD_LESSONS_DIR;
  if (envDir && fs.existsSync(envDir)) return envDir;
  const repoLessons = path.join(repoRoot, 'lessons', 'hellointerview-system-design');
  if (fs.existsSync(repoLessons)) return repoLessons;
  const fixtures = path.join(repoRoot, 'scripts', 'fixtures', 'sd-grounding-lessons');
  if (fs.existsSync(fixtures)) return fixtures;
  return null;
}

function walkLessonFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkLessonFiles(full));
    else if (/\.(md|txt)$/i.test(entry.name) && entry.name !== 'README.md') results.push(full);
  }
  return results;
}

async function collect(gen) {
  let out = '';
  for await (const t of gen) out += t;
  return out;
}

async function waitForOrchestrator(appState, attempts = 40, delayMs = 500) {
  for (let i = 0; i < attempts; i++) {
    const orch = appState.getKnowledgeOrchestrator?.();
    if (orch?.ingestDocument && orch?.queryRelevantChunks) return orch;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

async function ingestLessons(orchestrator, lessonDir) {
  const { DocType } = require(path.join(distRoot, 'knowledge', 'types.js'));
  const files = walkLessonFiles(lessonDir);
  console.log(`[sd-bench] ingesting ${files.length} lesson file(s) from ${lessonDir}`);
  let ok = 0;
  let fail = 0;
  for (const f of files) {
    const result = await orchestrator.ingestDocument(f, DocType.LESSON);
    if (result?.success) ok++;
    else {
      fail++;
      console.warn(`[sd-bench] ingest FAIL ${path.basename(f)}: ${result?.error || 'unknown'}`);
    }
  }
  console.log(`[sd-bench] ingest done: ${ok} ok, ${fail} failed`);
  if (ok === 0) throw new Error('no lesson files ingested — embeddings/orchestrator unavailable?');
  if (typeof orchestrator.setKnowledgeMode === 'function') orchestrator.setKnowledgeMode(true);
}

async function askOnce(llm, systemPrompt, question, signal) {
  return collect(
    llm.streamChat(
      question.q,
      undefined,
      undefined,
      systemPrompt,
      false,
      false,
      [],
      signal,
      undefined,
      { answerType: 'system_design_answer' },
    ),
  );
}

async function runQuestion(llm, systemPrompt, question) {
  let lastMisses = [];
  let lastAnswer = '';
  let latencyMs = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    const start = Date.now();
    let ans = '';
    try {
      ans = await askOnce(llm, systemPrompt, question, ctl.signal);
    } catch (err) {
      ans = '';
      lastMisses = [`ERROR:${err?.message || String(err)}`];
    } finally {
      clearTimeout(to);
      latencyMs = Date.now() - start;
    }
    lastAnswer = ans;
    const scored = assertAnswer(question, ans);
    if (scored.ok) {
      return { ok: true, latencyMs, attempt, misses: [], answer: ans, matchedTech: scored.matchedTech };
    }
    lastMisses = scored.misses;
    console.log(`[sd-bench] retry ${attempt}/${MAX_ATTEMPTS} ${question.id} :: ${lastMisses.join(';')}`);
  }
  return { ok: false, latencyMs, attempt: MAX_ATTEMPTS, misses: lastMisses, answer: lastAnswer, matchedTech: [] };
}

async function main() {
  await app.whenReady();

  const lessonDir = resolveLessonsDir();
  if (!lessonDir) {
    throw new Error('no lessons dir (set SD_LESSONS_DIR, or add lessons/hellointerview-system-design, or scripts/fixtures/sd-grounding-lessons)');
  }
  if (SPLIT === 'full' && lessonDir.includes(`${path.sep}fixtures${path.sep}`)) {
    throw new Error('SD_BENCHMARK_SPLIT=full requires the full lesson corpus, not fixtures');
  }

  // Boot the real app (DB + RAG + KnowledgeOrchestrator wiring) inside throwaway userData.
  const mainMod = require(path.join(distRoot, 'main.js'));
  const { AppState } = mainMod;
  if (!AppState) {
    throw new Error('AppState not exported from main.js — run npm run build:electron');
  }

  console.log('[sd-bench] waiting for AppState / KnowledgeOrchestrator…');
  await new Promise((r) => setTimeout(r, 4000));
  const appState = AppState.getInstance();
  const orchestrator = await waitForOrchestrator(appState);
  if (!orchestrator) {
    throw new Error('KnowledgeOrchestrator not initialized');
  }

  await ingestLessons(orchestrator, lessonDir);

  const { ModesManager } = require(path.join(distRoot, 'services/ModesManager.js'));
  const { MODE_TECHNICAL_INTERVIEW_PROMPT } = require(path.join(distRoot, 'llm/prompts.js'));
  const mm = ModesManager.getInstance();
  for (const m of mm.getModes()) {
    if (/sd.?bench|technical.?interview/i.test(m.name) && m.templateType === 'technical-interview') {
      try { mm.deleteMode(m.id); } catch { /* ignore */ }
    }
  }
  const mode = mm.createMode({ name: 'SD Bench Technical Interview', templateType: 'technical-interview' });
  mm.setActiveMode(mode.id);

  const llm = appState.processingHelper.getLLMHelper();
  // Prefer Gemini direct (embeddings + chat share GEMINI_API_KEY). Fall back to
  // Natively gateway when only NATIVELY_API_KEY is present.
  if (GEMINI_KEY) {
    llm.setApiKey(GEMINI_KEY);
    llm.setModel(MODEL);
    console.log(`[sd-bench] BENCHMARK_MODEL=${MODEL} clientModel=gemini (direct)`);
  } else {
    llm.setNativelyKey(NATIVELY_KEY);
    llm.setModel('natively');
    console.log(`[sd-bench] BENCHMARK_MODEL=${MODEL} clientModel=natively`);
  }

  const allQuestions = selectQuestions(SPLIT);
  const checkpoint = loadCheckpoint(CHECKPOINT_PATH);
  const pending = filterPendingQuestions(allQuestions, checkpoint);
  console.log(
    `[sd-bench] split=${SPLIT} model=${MODEL} questions=${allQuestions.length} ` +
    `pending=${pending.length} resumed=${allQuestions.length - pending.length} ` +
    `checkpoint=${CHECKPOINT_PATH}`,
  );

  const results = [];
  // Already-completed IDs count as passes for the summary (resume semantics).
  for (const q of allQuestions) {
    if (!pending.some((p) => p.id === q.id)) {
      results.push({ id: q.id, ok: true, latencyMs: 0, resumed: true });
    }
  }

  let hardFail = false;
  for (const q of pending) {
    const r = await runQuestion(llm, MODE_TECHNICAL_INTERVIEW_PROMPT, q);
    results.push({ id: q.id, ok: r.ok, latencyMs: r.latencyMs, resumed: false, misses: r.misses });
    const sm = llm.getLastProviderModel?.() || '?';
    if (r.ok) {
      markQuestionComplete(CHECKPOINT_PATH, q.id);
      console.log(`PASS  ${q.id}  [${sm}]  ${r.latencyMs}ms  tech=${(r.matchedTech || []).join(',') || '-'}`);
    } else {
      hardFail = true;
      console.log(`FAIL  ${q.id}  [${sm}]  ${r.latencyMs}ms  :: ${(r.misses || []).join(';')}`);
      console.log(`      → ${(r.answer || '').slice(0, 220).replace(/\n/g, ' ')}`);
    }
  }

  const summary = summarizeResults(results.filter((r) => !r.resumed || r.ok));
  const live = results.filter((r) => !r.resumed);
  const liveSummary = summarizeResults(live.length ? live : results);
  console.log(
    `\n[sd-bench] ${summary.pass}/${summary.total} pass ` +
    `(live ${liveSummary.pass}/${liveSummary.total}, ` +
    `median=${liveSummary.medianMs ?? '-'}ms p95=${liveSummary.p95Ms ?? '-'}ms)`,
  );

  process.exitCode = hardFail ? 1 : 0;
}

function cleanup() {
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* best effort */ }
}

main()
  .catch((e) => {
    console.error('[sd-bench] FATAL', e?.message || e);
    process.exitCode = 2;
  })
  .finally(() => {
    cleanup();
    // Prefer app.exit so Electron shuts down cleanly after main.js boot.
    try {
      const code = typeof process.exitCode === 'number' ? process.exitCode : 0;
      app.exit(code);
    } catch {
      process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0);
    }
  });
