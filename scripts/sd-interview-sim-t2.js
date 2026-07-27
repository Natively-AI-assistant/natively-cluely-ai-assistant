#!/usr/bin/env node
// scripts/sd-interview-sim-t2.js
//
// T2 dual-agent overnight corpus runner.
// NEVER intended for pull_request CI (workflow_dispatch / schedule only).
//
// Stub / protocol ($0 — no Gemini):
//   SD_INTERVIEW_SIM_T2_STUB=1 npm run sd-interview-sim:t2
//
// Live interviewer + live Natively SUT (Electron AppState + runWhatShouldISay):
//   npm run build:electron
//   RUN_SD_INTERVIEW_SIM_T2=1 GEMINI_API_KEY=<key> npm run sd-interview-sim:t2
//
// Live interviewer + stub SUT only:
//   RUN_SD_INTERVIEW_SIM_T2=1 SD_INTERVIEW_SIM_T2_LIVE_SUT=0 GEMINI_API_KEY=<key> \
//     npm run sd-interview-sim:t2
//
// Optional knobs:
//   SD_INTERVIEW_SIM_T2_MAX_TURNS=32   (live quality default; use 4 only for smoke)
//   SD_INTERVIEW_SIM_T2_INGEST_LESSONS=0  (opt out of LESSON ingest on live SUT)
//   SD_INTERVIEW_SIM_T2_MAX_INTERVIEWS=5
//   SD_INTERVIEW_SIM_T2_MAX_USD=1.5
//   Full-loop cost guidance ~$1–3 / interview (non-SLA).
//   SD_INTERVIEW_SIM_T2_INTERVIEWER_MODEL=gemini-3.1-flash-lite
//   SD_INTERVIEW_SIM_T2_SUT_MODEL=gemini-3.5-flash
//   SD_INTERVIEW_SIM_T2_SUT_TIMEOUT_MS=90000
//   SD_INTERVIEW_SIM_CORPUS_DIR=traces/sd-interview-sim
//   SD_INTERVIEW_SIM_T2_PROMPT='Design a URL shortener'
//
// Corpus = offline workflow debug fuel — not Gemini fine-tune.
// Do NOT use ELECTRON_RUN_AS_NODE — real Electron binary required for live SUT.

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execSync, spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');

try {
  require('dotenv').config({ path: path.join(repoRoot, '.env') });
} catch {
  /* optional */
}

const {
  shouldRunT2DualAgent,
  t2SkipMessage,
  DEFAULT_INTERVIEWER_MODEL,
  DEFAULT_SUT_MODEL,
  DEFAULT_LIVE_MAX_TURNS,
  createLiveInterviewerAgent,
  createThinCandidateAgent,
  createStubInterviewerAgent,
  NightlyInterviewCap,
  runT2DualAgent,
  resolveCorpusDir,
  retainLastN,
} = require('./lib/sd-interview-sim');

const {
  createIntelligenceSessionAdapter,
  createLiveWhatToAnswerSut,
  liveSideChannelSnapshot,
} = require('./lib/sd-interview-sim/liveSut');

const {
  resolveLessonsDir,
  shouldIngestLessonsForT2,
  walkLessonFiles,
} = require('./lib/sd-interview-sim/lessonIngest');

function resolveGitSha() {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

function envInt(name, fallback) {
  const raw = (process.env[name] || '').trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envFloat(name, fallback) {
  const raw = (process.env[name] || '').trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function isElectronRuntime() {
  return Boolean(process.versions && process.versions.electron);
}

/**
 * Live SUT needs real Electron (AppState / DatabaseManager). Re-exec under
 * the electron binary when the user invoked plain `node`.
 */
function maybeReexecUnderElectron(forceStub, wantLiveSut) {
  if (forceStub || !wantLiveSut) return false;
  if (isElectronRuntime()) return false;

  const electronBin = path.join(repoRoot, 'node_modules', '.bin', 'electron');
  if (!fs.existsSync(electronBin)) {
    console.error(
      '[sd-interview-sim-t2] FATAL — live SUT needs Electron. Run: npm run build:electron && npm run sd-interview-sim:t2',
    );
    process.exit(2);
  }

  console.log('[sd-interview-sim-t2] re-exec under Electron for live SUT…');
  const result = spawnSync(
    electronBin,
    [path.join(__dirname, 'sd-interview-sim-t2.js')],
    {
      stdio: 'inherit',
      env: { ...process.env, NATIVELY_E2E: process.env.NATIVELY_E2E || '1' },
      cwd: repoRoot,
    },
  );
  process.exit(typeof result.status === 'number' ? result.status : 2);
}

function createEchoStubSut(models) {
  return async function headlessSut(ctx) {
    const q = ctx.interviewerTurn?.text || '';
    return {
      text: `[sut-stub] Acknowledged: ${String(q).slice(0, 120)}`,
      spend: { input_tokens: 0, output_tokens: 40, estimated_usd: 0.0001 },
      _models: models,
    };
  };
}

/**
 * Boot AppState + Technical Interview mode; return live SUT + session adapter.
 */
async function bootLiveSut(models) {
  if (!fs.existsSync(path.join(distRoot, 'main.js'))) {
    throw new Error(
      `dist-electron missing (${distRoot}). Run: npm run build:electron`,
    );
  }

  process.env.NATIVELY_E2E = process.env.NATIVELY_E2E || '1';

  const tmpUserData = fs.mkdtempSync(
    path.join(os.tmpdir(), 'natively-sd-interview-sim-t2-'),
  );
  const { app } = require('electron');
  app.setPath('userData', tmpUserData);
  await app.whenReady();

  // eslint-disable-next-line import/no-dynamic-require, global-require
  const mainMod = require(path.join(distRoot, 'main.js'));
  const { AppState } = mainMod;
  if (!AppState) {
    throw new Error('AppState not exported from main.js — rebuild electron');
  }

  console.log('[sd-interview-sim-t2] waiting for AppState…');
  await new Promise((r) => setTimeout(r, 3000));
  const appState = AppState.getInstance();
  const intelligenceManager = appState.getIntelligenceManager?.();
  if (!intelligenceManager?.runWhatShouldISay) {
    throw new Error('AppState.getIntelligenceManager().runWhatShouldISay unavailable');
  }

  const llm = appState.processingHelper?.getLLMHelper?.();
  if (!llm) {
    throw new Error('LLMHelper unavailable from processingHelper');
  }

  const { resolveGeminiApiKey } = require('./lib/sd-grounding-harness.js');
  const geminiKey = resolveGeminiApiKey(process.env);
  if (!geminiKey) {
    throw new Error('live SUT requires GEMINI_API_KEY (or GOOGLE_API_KEY) in the environment');
  }

  // Prefer switchToGemini so provider pins clear Ollama/custom and rebuild the client.
  // Re-apply after ModesManager — AppState boot can race credentials/embeddings init.
  async function pinGemini() {
    if (typeof llm.switchToGemini === 'function') {
      await llm.switchToGemini(geminiKey, models.sut);
    } else {
      if (typeof llm.setApiKey === 'function') llm.setApiKey(geminiKey);
      if (typeof llm.setModel === 'function') llm.setModel(models.sut);
    }
  }
  await pinGemini();

  // eslint-disable-next-line import/no-dynamic-require, global-require
  const { ModesManager } = require(path.join(distRoot, 'services/ModesManager.js'));
  const mm = ModesManager.getInstance();
  for (const m of mm.getModes()) {
    if (/sd.?interview.?sim|technical.?interview/i.test(m.name) && m.templateType === 'technical-interview') {
      try {
        mm.deleteMode(m.id);
      } catch {
        /* ignore */
      }
    }
  }
  const mode = mm.createMode({
    name: 'SD Interview Sim T2',
    templateType: 'technical-interview',
  });
  mm.setActiveMode(mode.id);
  await pinGemini();
  console.log(
    `[sd-interview-sim-t2] live SUT ready mode=${mode.id} model=${models.sut} userData=${tmpUserData}`,
  );

  // LESSON ingest (SPEC 08) — default on for live SUT; warn+continue if missing.
  let lessonsIngested = 0;
  if (shouldIngestLessonsForT2(process.env)) {
    try {
      const lessonDir = resolveLessonsDir({ repoRoot, env: process.env });
      if (!lessonDir) {
        console.warn(
          '[sd-interview-sim-t2] LESSON ingest skipped — no lessons dir ' +
            '(set SD_LESSONS_DIR or add lessons/hellointerview-system-design)',
        );
      } else {
        const orch = appState.getKnowledgeOrchestrator?.();
        if (!orch?.ingestDocument) {
          console.warn('[sd-interview-sim-t2] LESSON ingest skipped — KnowledgeOrchestrator unavailable');
        } else {
          const { DocType } = require(path.join(distRoot, 'knowledge', 'types.js'));
          const files = walkLessonFiles(lessonDir);
          console.log(
            `[sd-interview-sim-t2] ingesting ${files.length} LESSON file(s) from ${lessonDir}`,
          );
          for (const f of files) {
            const result = await orch.ingestDocument(f, DocType.LESSON);
            if (result?.success) lessonsIngested += 1;
            else {
              console.warn(
                `[sd-interview-sim-t2] ingest FAIL ${path.basename(f)}: ${result?.error || 'unknown'}`,
              );
            }
          }
          if (lessonsIngested > 0 && typeof orch.setKnowledgeMode === 'function') {
            orch.setKnowledgeMode(true);
          }
          console.log(
            `[sd-interview-sim-t2] LESSON ingest done: ${lessonsIngested}/${files.length} ok`,
          );
        }
      }
    } catch (err) {
      console.warn(
        `[sd-interview-sim-t2] LESSON ingest warn-and-continue: ${err?.message || err}`,
      );
    }
  } else {
    console.log('[sd-interview-sim-t2] LESSON ingest opted out (SD_INTERVIEW_SIM_T2_INGEST_LESSONS=0)');
  }

  const sessionTracker = createIntelligenceSessionAdapter(intelligenceManager);
  const sut = createLiveWhatToAnswerSut({
    intelligenceManager,
    timeoutMs: envInt('SD_INTERVIEW_SIM_T2_SUT_TIMEOUT_MS', 90_000),
  });

  return {
    sut,
    sessionTracker,
    intelligenceManager,
    tmpUserData,
    app,
    lessonsIngested,
  };
}

async function main() {
  const forceStub = process.env.SD_INTERVIEW_SIM_T2_STUB === '1';
  const live = !forceStub && shouldRunT2DualAgent(process.env);

  if (!live && !forceStub) {
    console.log(t2SkipMessage());
    process.exit(0);
  }

  // Default: live interviewer ⇒ live SUT. Opt out with SD_INTERVIEW_SIM_T2_LIVE_SUT=0.
  const wantLiveSut =
    live && process.env.SD_INTERVIEW_SIM_T2_LIVE_SUT !== '0';

  maybeReexecUnderElectron(forceStub, wantLiveSut);

  const interviewerModel =
    (process.env.SD_INTERVIEW_SIM_T2_INTERVIEWER_MODEL || '').trim() ||
    DEFAULT_INTERVIEWER_MODEL;
  const sutModel =
    (process.env.SD_INTERVIEW_SIM_T2_SUT_MODEL || '').trim() || DEFAULT_SUT_MODEL;

  const maxTurns = envInt('SD_INTERVIEW_SIM_T2_MAX_TURNS', DEFAULT_LIVE_MAX_TURNS);
  const maxInterviews = envInt('SD_INTERVIEW_SIM_T2_MAX_INTERVIEWS', 5);
  const maxUsd = envFloat('SD_INTERVIEW_SIM_T2_MAX_USD', 1.5);
  const retainN = envInt('SD_INTERVIEW_SIM_T2_RETAIN', 20);

  const corpusDir = resolveCorpusDir({
    corpusDir: process.env.SD_INTERVIEW_SIM_CORPUS_DIR || undefined,
    repoRoot,
  });
  const stateDir =
    process.env.SD_INTERVIEW_SIM_T2_STATE_DIR ||
    path.join(os.tmpdir(), 'natively-sd-interview-sim-t2');
  fs.mkdirSync(stateDir, { recursive: true });

  const nightlyCap = new NightlyInterviewCap({
    maxInterviewsPerNight: maxInterviews,
    stateDir,
  });

  const prompt =
    (process.env.SD_INTERVIEW_SIM_T2_PROMPT || '').trim() ||
    'Design a URL shortener like Bitly. Start with Requirements, then HLD.';

  const models = { interviewer: interviewerModel, sut: sutModel };

  let liveBoot = null;
  let sut = createEchoStubSut(models);
  let sessionTracker = null;
  let getSideChannelSnapshot;
  let candidateAgent = createThinCandidateAgent();

  if (wantLiveSut) {
    liveBoot = await bootLiveSut(models);
    sut = liveBoot.sut;
    sessionTracker = liveBoot.sessionTracker;
    getSideChannelSnapshot = () =>
      liveSideChannelSnapshot(liveBoot.intelligenceManager);
    candidateAgent = createThinCandidateAgent({
      getGateStatus: () =>
        liveBoot.intelligenceManager.getSdRequirementsGateStatus?.() ?? null,
    });
  }

  const interviewerAgent = live
    ? createLiveInterviewerAgent({ model: interviewerModel })
    : createStubInterviewerAgent([
        {
          text: `${prompt}\n\n\`\`\`mermaid\nflowchart LR\n  Client --> API\n\`\`\``,
        },
        { text: 'What is peak QPS and p99 latency?', end_interview: true },
      ]);

  console.log(
    `[sd-interview-sim-t2] mode=${live ? 'live-interviewer' : 'stub'} ` +
      `sut=${wantLiveSut ? 'live-wta' : 'echo-stub'} ` +
      `models=${JSON.stringify(models)} maxTurns=${maxTurns} ` +
      `maxInterviews/night=${maxInterviews} maxUsd=${maxUsd} corpus=${corpusDir}`,
  );
  console.log(
    '[sd-interview-sim-t2] corpus is workflow debug fuel — no fine-tune / train-job',
  );

  const results = [];
  try {
    while (nightlyCap.canStart()) {
      const { bundle, outcome, corpusPath } = await runT2DualAgent({
        scenario: { id: 'overnight-t2', prompt },
        interviewerAgent: live
          ? createLiveInterviewerAgent({ model: interviewerModel })
          : interviewerAgent,
        candidateAgent,
        sut,
        sessionTracker,
        getSideChannelSnapshot,
        maxTurns,
        budgets: {
          maxTurns,
          maxEstimatedUsd: maxUsd,
        },
        models,
        provenance: {
          git_sha: resolveGitSha(),
          tier: 'T2',
          sut_path: wantLiveSut ? 'runWhatShouldISay' : 'echo-stub',
          lessons_ingested: liveBoot?.lessonsIngested ?? 0,
        },
        nightlyCap,
        corpusDir,
        writeBundle: true,
      });

      results.push({
        run_id: bundle.run_id,
        end_reason: outcome.end_reason,
        spend: outcome.spend,
        corpusPath,
        turns: bundle.turns.length,
      });

      console.log(
        `[sd-interview-sim-t2] done run_id=${bundle.run_id} ` +
          `end_reason=${outcome.end_reason} turns=${bundle.turns.length} ` +
          `usd≈${outcome.spend.estimated_usd} path=${corpusPath || '(none)'}`,
      );

      if (outcome.end_reason === 'budget_hit' && bundle.turns.length === 0) {
        break;
      }
      if (!nightlyCap.canStart()) break;
      if (process.env.SD_INTERVIEW_SIM_T2_BATCH !== '1') break;
    }
  } finally {
    try {
      const retained = retainLastN(corpusDir, retainN);
      console.log(
        `[sd-interview-sim-t2] retainLastN=${retainN} kept=${retained.kept.length} ` +
          `deleted=${retained.deleted.length}`,
      );
    } catch (err) {
      console.warn(`[sd-interview-sim-t2] retain skipped: ${err?.message || err}`);
    }

    console.log(`[sd-interview-sim-t2] interviews=${results.length}`);

    if (liveBoot?.tmpUserData) {
      try {
        fs.rmSync(liveBoot.tmpUserData, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
    if (liveBoot?.app) {
      try {
        const code = typeof process.exitCode === 'number' ? process.exitCode : 0;
        liveBoot.app.exit(code);
        return;
      } catch {
        /* fall through */
      }
    }
  }

  process.exitCode = 0;
}

main().catch((err) => {
  console.error('[sd-interview-sim-t2] FATAL', err?.message || err);
  process.exitCode = 2;
  try {
    const { app } = require('electron');
    if (app && !app.isReady?.()) {
      /* ignore */
    } else if (app?.exit) {
      app.exit(2);
    }
  } catch {
    process.exit(2);
  }
});
