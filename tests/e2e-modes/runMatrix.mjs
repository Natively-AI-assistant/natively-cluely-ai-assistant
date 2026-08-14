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

  let app = await electron.launch({
    args: ['dist-electron/electron/main.js'],
    env: launchEnv,
    timeout: 60000,
  });
  await app.firstWindow({ timeout: 30000 });
  await app.windows()[0].waitForLoadState('domcontentloaded').catch(() => {});
  const w = () => app.windows()[0];
  // Resilient invoke: heavy grounded indexing can crash the Electron renderer
  // ("Target crashed"). Rather than abort the whole run, relaunch the app (the DB
  // persists in the same userData, so ingested modes survive) and retry.
  let relaunches = 0;
  const R = async (ch, ...a) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const win = w();
        if (!win) throw new Error('no window');
        return await win.evaluate(async ({ ch, a }) => (window.electronAPI || window.api).e2eInvoke(ch, ...a), { ch, a });
      } catch (e) {
        if (attempt === 3) throw e;
        const dead = /Target (page|crashed)|crashed|context was destroyed|no window|reading 'evaluate'|evaluate/.test(String(e?.message || e));
        if (dead && relaunches < 6) {
          relaunches++;
          try { await app.close(); } catch { /* ignore */ }
          // Remove a stale Electron singleton lock left by the crashed process —
          // otherwise the relaunch below can ALSO fail to acquire a window (the
          // new instance blocks on the dead process's lock), and that failure was
          // uncaught here, escaping the retry loop as a mode-ending "matrix fatal".
          try {
            const os = await import('node:os');
            const fsp = await import('node:fs/promises');
            const lockDir = `${os.homedir()}/Library/Application Support/Electron`;
            await Promise.all(['SingletonLock', 'SingletonCookie', 'SingletonSocket']
              .map((f) => fsp.unlink(`${lockDir}/${f}`).catch(() => {})));
          } catch { /* best-effort, non-fatal */ }
          // A crashed instance can leave orphaned Helper (network/GPU utility)
          // processes bound to this run's --user-data-dir; those alone were
          // enough to make the relaunch's fresh Electron.launch() itself fail
          // ("Process failed to launch!"), which then exhausted all 6 relaunch
          // attempts. Kill any Electron Helper still holding a natively-e2e
          // temp profile before retrying.
          try {
            const { execSync } = await import('node:child_process');
            execSync("pkill -9 -f 'natively-e2e-udd' 2>/dev/null || true");
          } catch { /* best-effort, non-fatal */ }
          await new Promise((r) => setTimeout(r, 2500));
          try {
            const { _electron: e2 } = await import('@playwright/test');
            app = await e2.launch({ args: ['dist-electron/electron/main.js'], env: launchEnv, timeout: 60000 });
            await app.firstWindow({ timeout: 30000 });
            await app.windows()[0].waitForLoadState('domcontentloaded').catch(() => {});
            await app.windows()[0].evaluate(async () => (window.electronAPI || window.api).e2eInvoke('__e2e__:enable-pro')).catch(() => {});
          } catch (relaunchErr) {
            // Relaunch itself failed — don't let it escape uncaught; fall through
            // to the retry loop (attempt+1) which will try again up to attempt===3.
            log(`  relaunch attempt ${relaunches} failed: ${relaunchErr.message}`);
            await new Promise((r) => setTimeout(r, 1500));
          }
        } else {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
  };

  await R('__e2e__:enable-pro');

  const allResults = [];
  const modeSummaries = [];
  let crashCount = 0;

  // Optional focus filter (comma-separated brief keys) so a subset of modes can run
  // in a fresh process — the long full run accumulates memory across 10 modes and
  // the heavy 200-chunk-thesis legal mode can crash the renderer; running subsets
  // isolates that. e.g. MODE_FILTER=legal-compliance,support-escalation
  const modeFilter = (process.env.MODE_FILTER || '').split(',').map((s) => s.trim()).filter(Boolean);
  const plans = modeFilter.length ? MODE_PLAN.filter((p) => modeFilter.includes(p.key)) : MODE_PLAN;

  for (const plan of plans) {
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

    // 2. ingest mapped documents. Ingest + index files ONE AT A TIME with a short
    // settle for 3+-doc modes: adding several large PDFs at once makes their
    // indexing (embedding hundreds of chunks) overlap and spike renderer memory to
    // an OOM ("no window") — the conference-talk 3-paper mode. Serial ingest keeps
    // peak memory bounded to one file's index at a time.
    const ingested = [];
    // 2-doc heavy modes (a 14k-row CSV, or an RFC + 66-page thesis) hit the same
    // renderer OOM as 3-doc modes — lower the threshold to 2+ rather than 3+.
    const serialIngest = plan.documents.length >= 2;
    for (const rel of plan.documents) {
      try {
        const { text, pages } = await extractText(rel);
        const ing = await R('__e2e__:add-reference-file', { modeId, fileName: path.basename(rel), content: text, pageCount: pages });
        ingested.push({ rel, ok: ing?.success, chars: text.length });
        if (serialIngest) {
          // let this file's index settle before adding the next
          for (let i = 0; i < 15; i++) {
            const st = await R('__e2e__:index-status', modeId);
            const done = (st?.statuses || []).filter((s) => s.status === 'ready' || s.status === 'lexical_only').length;
            if (done >= ingested.length) break;
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
      } catch (e) { ingested.push({ rel, ok: false, error: e.message }); }
    }
    if (plan.documents.length) {
      // Wait for VECTOR-ready ('ready'), not merely 'lexical_only'. Grounded answers
      // need vector retrieval; asking while a file is lexical_only makes the model
      // miss facts and false-refuse. Re-fire reindex-embeddings (which retries
      // lexical_only files, rotating Gemini keys + honoring 429 cooldown) until every
      // file is 'ready' or the 90s budget is spent.
      const allReady = (sts) => sts.length >= plan.documents.length && sts.every((s) => s.status === 'ready');
      let statuses = [];
      const DEADLINE = Date.now() + 90_000;
      let lastReindex = 0;
      while (Date.now() < DEADLINE) {
        const st = await R('__e2e__:index-status', modeId);
        statuses = st?.statuses || [];
        if (allReady(statuses)) break;
        if (Date.now() - lastReindex > 8000) {
          const reidx = await R('__e2e__:reindex-embeddings', modeId).catch(() => null);
          if (reidx?.statuses) statuses = reidx.statuses;
          lastReindex = Date.now();
          if (allReady(statuses)) break;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      await R('__e2e__:prewarm-mode', modeId).catch(() => {});
      await new Promise((r) => setTimeout(r, 1000));
      const vectorReady = allReady(statuses);
      modeRec.indexReady = vectorReady;
      modeRec.ingested = ingested;
      modeRec.indexStatuses = statuses;
      log(`  ingested ${ingested.filter((x) => x.ok).length}/${plan.documents.length}, vectorReady=${vectorReady}, statuses=${JSON.stringify(statuses.map((s)=>s.status))}`);
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

    // Quota-settle: indexing a large doc consumes the shared Gemini embed window;
    // give it a moment to recover so the per-question QUERY embed isn't throttled
    // (a throttled query-embed exceeds the retrieval race → weak lexical fallback →
    // false-refuse). Only when we actually indexed vectors.
    if (plan.documents.length && plan.grounded) {
      await new Promise((r) => setTimeout(r, 4000));
    }

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
          // Align verdicts to criteria BY CONTENT, not index: the judge can return
          // verdicts out of order or drop one, and index-mapping then applies verdict
          // B to criterion A (a passing answer scored as fail with a positive reason).
          // Match each criterion to the verdict whose `criterion` text is the closest
          // (exact, substring, or highest token overlap); fall back to index only if
          // no content match, and never reuse a verdict for two criteria.
          const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
          const used = new Set();
          const findVerdict = (critText) => {
            const cn = norm(critText);
            const cw = new Set(cn.split(' ').filter((w) => w.length > 3));
            let best = -1; let bestScore = 0;
            jr.verdicts.forEach((v, vi) => {
              if (used.has(vi) || !v) return;
              const vn = norm(v.criterion);
              let score = 0;
              if (vn === cn) score = 1000;
              else if (vn && (cn.includes(vn) || vn.includes(cn))) score = 500;
              else { const vw = vn.split(' ').filter((w) => w.length > 3); score = vw.filter((w) => cw.has(w)).length; }
              if (score > bestScore) { bestScore = score; best = vi; }
            });
            if (best >= 0 && bestScore > 0) { used.add(best); return jr.verdicts[best]; }
            return null;
          };
          verdicts = det.semanticCriteria.map((c, i) => {
            const byContent = findVerdict(c.text);
            if (byContent) return byContent;
            // index fallback only if that slot isn't already claimed by content match
            return used.has(i) ? null : (jr.verdicts[i] || null);
          });
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
