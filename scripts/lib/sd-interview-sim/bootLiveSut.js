// scripts/lib/sd-interview-sim/bootLiveSut.js
//
// Shared Electron AppState boot for live WTA SUT (T2 overnight + REPL).
// Must run under the Electron binary (not ELECTRON_RUN_AS_NODE).

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  createIntelligenceSessionAdapter,
  createLiveWhatToAnswerSut,
} = require('./liveSut');
const {
  resolveLessonsDir,
  shouldIngestLessonsForT2,
  walkLessonFiles,
} = require('./lessonIngest');
const { resolveGeminiApiKey } = require('../sd-grounding-harness.js');

/**
 * @param {{
 *   repoRoot: string,
 *   models: { sut?: string },
 *   sutOpts?: { promptInstruction?: string, sdProblemKey?: string },
 *   timeoutMs?: number,
 *   userDataPrefix?: string,
 *   modeName?: string,
 *   logPrefix?: string,
 *   ingestLessons?: boolean,
 * }} opts
 */
async function bootLiveSut(opts) {
  const repoRoot = opts.repoRoot;
  const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
  const logPrefix = opts.logPrefix || '[sd-interview-sim]';
  const models = opts.models || {};
  const sutOpts = opts.sutOpts || {};

  if (!fs.existsSync(path.join(distRoot, 'main.js'))) {
    throw new Error(
      `dist-electron missing (${distRoot}). Run: npm run build:electron`,
    );
  }

  process.env.NATIVELY_E2E = process.env.NATIVELY_E2E || '1';
  // Live WTA needs AppState; CLI/sim must not open launcher/overlay windows.
  process.env.NATIVELY_HEADLESS = process.env.NATIVELY_HEADLESS || '1';

  const tmpUserData = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      opts.userDataPrefix || 'natively-sd-interview-sim-',
    ),
  );
  // Quieter AppState defaults for harness userData (many paths still use console.log).
  try {
    fs.writeFileSync(
      path.join(tmpUserData, 'settings.json'),
      JSON.stringify({ verboseLogging: false, isUndetectable: false }, null, 2),
      'utf8',
    );
  } catch {
    /* ignore */
  }
  const { app } = require('electron');
  app.setPath('userData', tmpUserData);
  await app.whenReady();

  // eslint-disable-next-line import/no-dynamic-require, global-require
  const mainMod = require(path.join(distRoot, 'main.js'));
  const { AppState } = mainMod;
  if (!AppState) {
    throw new Error('AppState not exported from main.js — rebuild electron');
  }

  console.log(`${logPrefix} waiting for AppState…`);
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

  const geminiKey = resolveGeminiApiKey(process.env);
  if (!geminiKey) {
    throw new Error('live SUT requires GEMINI_API_KEY (or GOOGLE_API_KEY) in the environment');
  }

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
    if (
      /sd.?interview.?sim|technical.?interview/i.test(m.name) &&
      m.templateType === 'technical-interview'
    ) {
      try {
        mm.deleteMode(m.id);
      } catch {
        /* ignore */
      }
    }
  }
  const mode = mm.createMode({
    name: opts.modeName || 'SD Interview Sim',
    templateType: 'technical-interview',
  });
  mm.setActiveMode(mode.id);
  await pinGemini();
  console.log(
    `${logPrefix} live SUT ready mode=${mode.id} model=${models.sut} userData=${tmpUserData}`,
  );

  let lessonsIngested = 0;
  const wantLessons =
    opts.ingestLessons != null ? opts.ingestLessons : shouldIngestLessonsForT2(process.env);
  if (wantLessons) {
    try {
      const lessonDir = resolveLessonsDir({ repoRoot, env: process.env });
      if (!lessonDir) {
        console.warn(
          `${logPrefix} LESSON ingest skipped — no lessons dir ` +
            '(set SD_LESSONS_DIR or add lessons/hellointerview-system-design)',
        );
      } else {
        const orch = appState.getKnowledgeOrchestrator?.();
        if (!orch?.ingestDocument) {
          console.warn(`${logPrefix} LESSON ingest skipped — KnowledgeOrchestrator unavailable`);
        } else {
          const { DocType } = require(path.join(distRoot, 'knowledge', 'types.js'));
          const files = walkLessonFiles(lessonDir);
          console.log(`${logPrefix} ingesting ${files.length} LESSON file(s) from ${lessonDir}`);
          for (const f of files) {
            const result = await orch.ingestDocument(f, DocType.LESSON);
            if (result?.success) lessonsIngested += 1;
            else {
              console.warn(
                `${logPrefix} ingest FAIL ${path.basename(f)}: ${result?.error || 'unknown'}`,
              );
            }
          }
          if (lessonsIngested > 0 && typeof orch.setKnowledgeMode === 'function') {
            orch.setKnowledgeMode(true);
          }
          console.log(`${logPrefix} LESSON ingest done: ${lessonsIngested}/${files.length} ok`);
        }
      }
    } catch (err) {
      console.warn(`${logPrefix} LESSON ingest warn-and-continue: ${err?.message || err}`);
    }
  } else {
    console.log(`${logPrefix} LESSON ingest opted out`);
  }

  const sessionTracker = createIntelligenceSessionAdapter(intelligenceManager);
  const sut = createLiveWhatToAnswerSut({
    intelligenceManager,
    timeoutMs: opts.timeoutMs != null ? opts.timeoutMs : 90_000,
    ...(sutOpts.promptInstruction
      ? { promptInstruction: sutOpts.promptInstruction }
      : {}),
    ...(sutOpts.sdProblemKey ? { sdProblemKey: sutOpts.sdProblemKey } : {}),
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

module.exports = { bootLiveSut };
