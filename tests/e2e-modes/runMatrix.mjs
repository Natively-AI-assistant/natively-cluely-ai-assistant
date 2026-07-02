// tests/e2e-modes/runMatrix.mjs
//
// Phase 4 — the full E2E matrix: 10 modes × real questions × real backend.
// Launches the REAL Electron app once, and for each mode:
//   1. create the generated mode + activate it
//   2. ingest its mapped corpus documents (real ingestion), wait for index 'ready'
//   3. run a detection-precision sequence (statements must NOT fire; question must)
//   4. ask each mapped question (real WTA → MiniMax), capture answer + latencies
//   5. score every answer against the Phase-1 rubric (deterministic scorer)
//
// Writes everything to test-results/modes-autopilot/run-N/.
//
// Env: NATIVELY_API_BASE (default http://localhost:3000), RUN_N (default 1),
//      NATIVELY_E2E_LOCAL_TEST_TOKEN (default local-test), JUDGE=1 to enable
//      the semantic LLM-judge pass.
//
// Usage: node tests/e2e-modes/runMatrix.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

import { MODE_PLAN, loadQuestionBank, questionsForMode, extractText, loadGeminiKeysFromEnv } from './corpusLoader.mjs';
import { scoreAnswer, mergeSemantic, aggregate } from './scorer.mjs';
import { judge as llmJudge } from './llmJudge.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const GEN_DIR = path.join(REPO, 'test-results/modes-autopilot/generated-modes');
const RUN_N = process.env.RUN_N || '1';
const OUT_DIR = path.join(REPO, `test-results/modes-autopilot/run-${RUN_N}`);
const LOCAL_TOKEN = process.env.NATIVELY_LOCAL_TEST_TOKEN || 'local-test';
const ASK_TIMEOUT = Number(process.env.ASK_TIMEOUT_MS || 90000);

fs.mkdirSync(OUT_DIR, { recursive: true });

function log(...a) { console.log(`[matrix]`, ...a); }
function loadDraft(key) {
  return JSON.parse(fs.readFileSync(path.join(GEN_DIR, `${key}.json`), 'utf8')).draft;
}

// Statements that must NOT trigger detection + one question that must.
const DETECTION_FILLERS = [
  'Thanks for taking the time to meet with me today.',
  'I have been really looking forward to this conversation.',
  'Let me share a bit of background about the team first.',
];

async function main() {
  const bank = loadQuestionBank();
  const startedAt = new Date().toISOString();

  // Cloud Gemini embeddings for reference files (768d — the mission's intended
  // provider). Pass ALL .env Gemini keys into the launch env; the app's
  // GeminiEmbeddingProvider now rotates the pool with per-key 429 cooldown, so a
  // rate-limited key no longer forces the local fallback. Clear OPENAI and dead-route
  // Ollama so the cascade OpenAI→Gemini→Ollama→local lands on Gemini.
  const geminiKeys = loadGeminiKeysFromEnv();
  const launchEnv = {
    ...process.env,
    NATIVELY_E2E: '1',
    NATIVELY_API_URL: process.env.NATIVELY_API_BASE || 'http://localhost:3000',
    NODE_ENV: 'development',
    NATIVELY_DEV_BYPASS_SCREEN_TCC: '1',
    NATIVELY_E2E_LOCAL_TEST_TOKEN: LOCAL_TOKEN,
    OPENAI_API_KEY: '',
    OLLAMA_URL: 'http://127.0.0.1:1',  // dead — force Gemini to win over any local Ollama
    NATIVELY_GEMINI_EMBED_DIMS: '768',
  };
  // Inject the pool as GEMINI_API_KEY(_2.._N) so main.ts's pool-gatherer picks them all up.
  geminiKeys.forEach((k, i) => { launchEnv[i === 0 ? 'GEMINI_API_KEY' : `GEMINI_API_KEY_${i + 1}`] = k; });
  if (geminiKeys[0]) launchEnv.GOOGLE_API_KEY = geminiKeys[0];
  console.log(`[matrix] embeddings: Gemini cloud 768d, ${geminiKeys.length}-key pool (app rotates on 429)`);

  const app = await electron.launch({
    args: ['dist-electron/electron/main.js'],
    env: launchEnv,
    timeout: 60000,
  });
  const win = await app.firstWindow({ timeout: 30000 });
  await win.waitForLoadState('domcontentloaded').catch(() => {});
  const w = () => app.windows()[0];
  const R = async (ch, ...a) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await w().evaluate(async ({ ch, a }) => (window.electronAPI || window.api).e2eInvoke(ch, ...a), { ch, a });
      } catch (e) { if (attempt === 2) throw e; await new Promise((r) => setTimeout(r, 1000)); }
    }
  };

  await R('__e2e__:enable-pro');

  const allResults = [];
  const modeSummaries = [];
  let crashCount = 0;

  for (const plan of MODE_PLAN) {
    const draft = loadDraft(plan.key);
    log(`\n=== MODE ${plan.label} (${plan.key}) grounded=${plan.grounded} docs=${plan.documents.length} ===`);
    const modeRec = { key: plan.key, label: plan.label, grounded: plan.grounded, questions: [], detection: null };

    // 1. create + activate the generated mode (fresh)
    let modeId;
    try {
      modeId = await w().evaluate(async (d) => {
        const api = window.electronAPI || window.api;
        const c = await api.modesCreate({ name: `${d.name} [run]`, templateType: d.templateType });
        await api.modesUpdate(c.mode.id, { customContext: d.customContext });
        await api.modesSetActive(c.mode.id);
        return c.mode.id;
      }, draft);
    } catch (e) { crashCount++; modeRec.error = `create: ${e.message}`; modeSummaries.push(modeRec); continue; }

    // 2. ingest mapped documents, wait for index 'ready'
    const ingested = [];
    for (const rel of plan.documents) {
      try {
        const { text, pages } = await extractText(rel);
        const ing = await R('__e2e__:add-reference-file', { modeId, fileName: path.basename(rel), content: text, pageCount: pages });
        ingested.push({ rel, ok: ing?.success, chars: text.length });
      } catch (e) { ingested.push({ rel, ok: false, error: e.message }); }
    }
    if (plan.documents.length) {
      // wait for index ready (up to 20s)
      let ready = false;
      for (let i = 0; i < 20; i++) {
        const st = await R('__e2e__:index-status', modeId);
        const statuses = st?.statuses || [];
        if (statuses.length >= plan.documents.length && statuses.every((s) => s.status === 'ready' || s.status === 'lexical_only')) { ready = true; break; }
        await new Promise((r) => setTimeout(r, 1000));
      }
      // Force real vector embeddings (local MiniLM fallback) + retry lexical_only
      // files, then prewarm. This upgrades retrieval from lexical-only to hybrid.
      const reidx = await R('__e2e__:reindex-embeddings', modeId).catch(() => null);
      await R('__e2e__:prewarm-mode', modeId).catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
      modeRec.indexReady = ready;
      modeRec.ingested = ingested;
      modeRec.indexStatuses = reidx?.statuses || null;
      log(`  ingested ${ingested.filter((x) => x.ok).length}/${plan.documents.length}, indexReady=${ready}, reindexed=${JSON.stringify((reidx?.statuses||[]).map((s)=>s.status))}`);
    }

    // 3. detection precision: statements must not fire, a real question must
    const detQuestion = 'Can you walk me through how your approach actually works in practice?';
    const fillerFires = [];
    for (const f of DETECTION_FILLERS) {
      const d = await R('__e2e__:detect-question', { text: f, confidence: 0.9 });
      fillerFires.push({ text: f, wouldFire: d?.wouldFire });
    }
    const qDet = await R('__e2e__:detect-question', { text: detQuestion, confidence: 0.9 });
    const falseFires = fillerFires.filter((x) => x.wouldFire).length;
    modeRec.detection = {
      expectedQuestion: true,
      detected: qDet?.wouldFire === true,
      falseFires,
      fillerFires,
    };
    log(`  detection: question fired=${qDet?.wouldFire} falseFires=${falseFires}/${DETECTION_FILLERS.length}`);

    // 4+5. ask each mapped question, score
    const questions = questionsForMode(bank, plan.label);
    // Order so that follow-up questions run right after their parent.
    const ordered = [];
    for (const q of questions) { if (!q.followUpOf) ordered.push(q); }
    for (const q of questions) { if (q.followUpOf) ordered.push(q); }

    // Track answers by id so a follow-up gets ONLY its parent's turn as context.
    // Independent questions run with a CLEAN transcript — accumulating every prior
    // Q/A pollutes the retrieval query (the WTA path retrieves against the whole
    // transcript) and degrades later answers. Follow-ups still get their parent.
    const answersById = {};
    for (const q of ordered) {
      const started = Date.now();
      let priorTurns = [];
      if (q.followUpOf && answersById[q.followUpOf]) {
        const parent = answersById[q.followUpOf];
        priorTurns = [
          { speaker: 'interviewer', text: parent.question },
          { speaker: 'user', text: (parent.answer || '').slice(0, 500) },
        ];
      }
      let ans;
      try {
        ans = await R('__e2e__:ask', { question: q.question, priorTurns, timeoutMs: ASK_TIMEOUT });
      } catch (e) { crashCount++; ans = { success: false, error: e.message }; }
      const latencyMs = Date.now() - started;
      const answerText = ans?.answer || ans?.streamedTokens || '';

      // 5a. deterministic pass (anchors + forbidden + refusal, all strict)
      const det = scoreAnswer(q, answerText);

      // 5b. semantic pass: batch the paraphrasable/format criteria through the
      // LLM-judge. A judge outage must NOT fake a product failure -> lenient
      // fallback + judge_unavailable flag recorded as an artifact.
      let verdicts = null;
      let judgeUnavailable = false;
      let judgeMeta = null;
      if (det.semanticCriteria.length > 0) {
        try {
          const jr = await llmJudge(q.question, answerText, det.semanticCriteria.map((c) => c.text), { timeoutMs: 60000 });
          // align verdicts to criteria order; judge may return fewer/renamed — map by index, fall back to null
          verdicts = det.semanticCriteria.map((_, i) => jr.verdicts[i] || null);
          judgeMeta = { model: jr.model, verdicts: jr.verdicts };
        } catch (e) {
          judgeUnavailable = true;
          judgeMeta = { error: String(e.message || e) };
          log(`  ${q.id} judge unavailable: ${judgeMeta.error} (lenient semantic pass)`);
        }
      }
      const score = mergeSemantic(det, verdicts, { judgeUnavailable });
      score.semanticCriteria = det.semanticCriteria;
      if (judgeMeta) score.judge = judgeMeta;

      const qRec = {
        id: q.id, type: q.type, question: q.question,
        latencyMs, ok: ans?.success === true, timedOut: ans?.timedOut === true, discarded: ans?.discarded === true,
        answer: answerText, answerLen: answerText.length, score,
      };
      modeRec.questions.push(qRec);
      allResults.push({ mode: plan.key, ...qRec, score, detection: null });
      // Record for any follow-up that names this question as its parent.
      answersById[q.id] = { question: q.question, answer: answerText };
      log(`  ${q.id} [${q.type}] pass=${score.pass} hardFail=${score.hardFail} ${score.score}/${score.maxScore} ${latencyMs}ms len=${answerText.length}`);
    }

    modeSummaries.push(modeRec);
    // write per-mode artifact
    fs.writeFileSync(path.join(OUT_DIR, `mode-${plan.key}.json`), JSON.stringify(modeRec, null, 2));
  }

  await app.close().catch(() => {});

  // Judge-verdicts artifact: every semantic criterion + its verdict, for audit.
  const judgeArtifact = {
    run: RUN_N,
    generatedAt: new Date().toISOString(),
    entries: allResults
      .filter((r) => (r.score?.semanticCriteria?.length || 0) > 0)
      .map((r) => ({
        mode: r.mode, id: r.id,
        judgeUnavailable: r.score.judgeUnavailable === true,
        criteria: r.score.semanticCriteria.map((c) => c.text),
        verdicts: r.score.judge?.verdicts || null,
        judgeModel: r.score.judge?.model || null,
        judgeError: r.score.judge?.error || null,
      })),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'judge-verdicts.json'), JSON.stringify(judgeArtifact, null, 2));

  // Attach detection results to allResults for aggregation
  const detectionResults = modeSummaries.map((m) => ({ detection: m.detection }));
  const agg = aggregate([...allResults, ...detectionResults]);

  // Acceptance thresholds
  const acceptance = {
    detectionAllFired: modeSummaries.every((m) => m.detection?.detected),
    detectionZeroFalseFires: modeSummaries.every((m) => (m.detection?.falseFires || 0) === 0),
    zeroHardFails: agg.hardFails === 0,
    rubricPassRate: agg.rubricCriteriaPassRate,
    rubricPassRateOK: agg.rubricCriteriaPassRate >= 0.9,
    noModeBelow80: modeSummaries.every((m) => {
      const qs = m.questions || [];
      if (!qs.length) return true;
      let p = 0, t = 0;
      for (const q of qs) { p += q.score?.score || 0; t += q.score?.maxScore || 0; }
      return t === 0 || p / t >= 0.8;
    }),
    zeroCrashes: crashCount === 0,
  };
  const clean = acceptance.detectionAllFired && acceptance.detectionZeroFalseFires &&
    acceptance.zeroHardFails && acceptance.rubricPassRateOK && acceptance.noModeBelow80 && acceptance.zeroCrashes;

  const summary = {
    run: RUN_N, startedAt, finishedAt: new Date().toISOString(),
    modes: MODE_PLAN.length,
    totalQuestions: allResults.length,
    aggregate: agg,
    acceptance,
    clean,
    crashCount,
    perMode: modeSummaries.map((m) => ({
      key: m.key, label: m.label, grounded: m.grounded, indexReady: m.indexReady,
      detected: m.detection?.detected, falseFires: m.detection?.falseFires,
      questions: (m.questions || []).map((q) => ({ id: q.id, type: q.type, pass: q.score?.pass, hardFail: q.score?.hardFail, latencyMs: q.latencyMs })),
    })),
  };
  fs.writeFileSync(path.join(OUT_DIR, '_summary.json'), JSON.stringify(summary, null, 2));

  console.log('\n=== MATRIX SUMMARY (run ' + RUN_N + ') ===');
  console.log('questions:', allResults.length, '| passes:', agg.passes, '| hardFails:', agg.hardFails);
  console.log('rubric criteria pass rate:', (agg.rubricCriteriaPassRate * 100).toFixed(1) + '%');
  console.log('detection: all fired=' + acceptance.detectionAllFired, 'zero false fires=' + acceptance.detectionZeroFalseFires);
  console.log('crashes:', crashCount);
  console.log('CLEAN:', clean);
  console.log('artifacts:', OUT_DIR);

  process.exit(clean ? 0 : 1);
}

main().catch((e) => { console.error('matrix fatal:', e); process.exit(2); });
