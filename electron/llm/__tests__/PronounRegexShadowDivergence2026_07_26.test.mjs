// electron/llm/__tests__/PronounRegexShadowDivergence2026_07_26.test.mjs
//
// Phase 6 Slice 4 (context-rebuild) item 2, follow-up pass (2026-07-26):
// the plan's own pre-required test
// (PronounRegexKnowledgeForkClosedByIsLayerAllowed2026_07_25.test.mjs)
// already proved isLayerAllowed(plan, 'resume') resolves to a single,
// uniform false for the exact 6-question corpus that documents the
// pronoun-regex fork — but that test calls isLayerAllowed directly, not
// through KnowledgeOrchestrator.processQuestion() itself. This file closes
// that last gap: a real, additive SHADOW-ONLY observation wired into
// processQuestion(), behind a new flag, that computes both decisions on
// every real call and logs a divergence — with NO return-value change,
// exactly mirroring the CanonicalTurnV2 shadow-wiring pattern already
// established in ipcHandlers.ts for Slice 3 (resolveCanonicalTurn) and
// documented as this codebase's safe way to observe a replacement
// decision-maker before ever promoting it.
//
// Deliberately NOT attempted in this pass: retiring the pronoun regex
// itself (CANDIDATE_REF_REGEX/CANDIDATE_FRAMING_REGEX/
// isGenericKnowledgeQuestion) as the live gate — that is the actual Slice
// 4 item 2 deletion, which the migration plan's own STATUS note correctly
// defers pending a live-trace campaign (deleting a currently-LIVE gate
// with real user traffic). This is strictly the shadow-observation
// half — safe, additive, zero behavior change — built to make that future
// promotion decision an evidence-based one instead of a cold start.
//
// Uses the same mock-KnowledgeDatabaseManager pattern already established
// in LeadershipGroundingFixBehavioral2026_07_25.test.mjs /
// InterviewerPerspectiveGrounding.test.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const { KnowledgeOrchestrator } = require(
  path.resolve(repoRoot, 'dist-electron/premium/electron/knowledge/KnowledgeOrchestrator.js'),
);
const { __resetIntelligenceFlagsCache } = require(
  path.resolve(repoRoot, 'dist-electron/electron/intelligence/intelligenceFlags.js'),
);

function makeResume() {
  return {
    id: 1,
    type: 'resume',
    structured_data: {
      identity: { name: 'Priya Nair', email: '', location: '', phone: '', links: [] },
      summary: '',
      skills: ['Python', 'Kubernetes'],
      experience: [
        { company: 'Acme Robotics', role: 'Software Engineer', start_date: '2022-01', end_date: null, bullets: ['Built a container orchestration pipeline on EKS.'] },
      ],
      projects: [],
      education: [],
      achievements: [],
      certifications: [],
      leadership: [],
    },
  };
}

function makeOrchestrator() {
  const db = {
    initializeSchema() {},
    getDocumentByType(t) { return t === 'resume' ? makeResume() : null; },
    getAllNodes() { return []; },
    getNodeCount() { return 0; },
    getIntro() { return null; },
    getGapAnalysis() { return null; },
    getNegotiationScript() { return null; },
    getMockQuestions() { return null; },
    getCultureMappings() { return null; },
  };
  const o = new KnowledgeOrchestrator(db);
  o.setKnowledgeMode(true);
  return o;
}

describe('pronounRegexShadowObservation flag registration', () => {
  test('resolves to false under this bare node:test harness (dev/test-only default)', () => {
    __resetIntelligenceFlagsCache();
    delete process.env.NATIVELY_PRONOUN_REGEX_SHADOW_OBSERVATION;
    const { isIntelligenceFlagEnabled } = require(
      path.resolve(repoRoot, 'dist-electron/electron/intelligence/intelligenceFlags.js'),
    );
    assert.equal(isIntelligenceFlagEnabled('pronounRegexShadowObservation'), false);
  });

  test('NATIVELY_PRONOUN_REGEX_SHADOW_OBSERVATION=1 env override enables it', () => {
    __resetIntelligenceFlagsCache();
    process.env.NATIVELY_PRONOUN_REGEX_SHADOW_OBSERVATION = '1';
    try {
      const { isIntelligenceFlagEnabled } = require(
        path.resolve(repoRoot, 'dist-electron/electron/intelligence/intelligenceFlags.js'),
      );
      assert.equal(isIntelligenceFlagEnabled('pronounRegexShadowObservation'), true);
    } finally {
      delete process.env.NATIVELY_PRONOUN_REGEX_SHADOW_OBSERVATION;
      __resetIntelligenceFlagsCache();
    }
  });
});

describe('processQuestion shadow-logs a divergence without changing its return value', () => {
  test('flag OFF: no shadow log call, behavior identical to before this change', async () => {
    __resetIntelligenceFlagsCache();
    delete process.env.NATIVELY_PRONOUN_REGEX_SHADOW_OBSERVATION;
    const o = makeOrchestrator();
    const logs = [];
    const origWarn = console.warn;
    console.warn = (...args) => logs.push(args);
    try {
      const result = await o.processQuestion('Have I demonstrated Kubernetes experience?');
      assert.ok(result !== undefined, 'processQuestion must still return its normal result');
      const shadowLogs = logs.filter((a) => String(a[0] || '').includes('[PronounRegexShadow]'));
      assert.equal(shadowLogs.length, 0, 'no shadow-divergence log when the flag is off');
    } finally {
      console.warn = origWarn;
    }
  });

  test('flag ON: a real question produces a shadow-divergence or shadow-agreement trace, and processQuestion\'s return value is byte-identical to flag-off', async () => {
    __resetIntelligenceFlagsCache();
    process.env.NATIVELY_PRONOUN_REGEX_SHADOW_OBSERVATION = '1';
    const question = 'Have I demonstrated Kubernetes experience?';
    try {
      const oShadowOn = makeOrchestrator();
      const logs = [];
      const origLog = console.log;
      const origWarn = console.warn;
      console.log = (...args) => { logs.push(args); origLog.apply(console, args); };
      console.warn = (...args) => { logs.push(args); origWarn.apply(console, args); };
      let resultOn;
      try {
        resultOn = await oShadowOn.processQuestion(question);
      } finally {
        console.log = origLog;
        console.warn = origWarn;
      }
      const shadowLogs = logs.filter((a) => String(a[0] || '').includes('[PronounRegexShadow]'));
      assert.ok(shadowLogs.length > 0, 'flag ON must produce exactly one shadow trace line (agreement or divergence) per call');

      __resetIntelligenceFlagsCache();
      delete process.env.NATIVELY_PRONOUN_REGEX_SHADOW_OBSERVATION;
      const oShadowOff = makeOrchestrator();
      const resultOff = await oShadowOff.processQuestion(question);

      assert.deepEqual(resultOn, resultOff, 'the shadow observation must be a pure side-channel log — processQuestion\'s actual return value must be unaffected by the flag');
    } finally {
      delete process.env.NATIVELY_PRONOUN_REGEX_SHADOW_OBSERVATION;
      __resetIntelligenceFlagsCache();
    }
  });

  test('flag ON: the shadow trace names both the legacy gate\'s decision and isLayerAllowed\'s decision', async () => {
    __resetIntelligenceFlagsCache();
    process.env.NATIVELY_PRONOUN_REGEX_SHADOW_OBSERVATION = '1';
    try {
      const o = makeOrchestrator();
      const logs = [];
      const origLog = console.log;
      const origWarn = console.warn;
      console.log = (...args) => { logs.push(args); };
      console.warn = (...args) => { logs.push(args); };
      try {
        await o.processQuestion('Have I demonstrated Kubernetes experience?');
      } finally {
        console.log = origLog;
        console.warn = origWarn;
      }
      const shadowLogs = logs.filter((a) => String(a[0] || '').includes('[PronounRegexShadow]'));
      assert.equal(shadowLogs.length, 1, 'exactly one shadow trace per processQuestion call');
      const payload = shadowLogs[0][1];
      assert.ok(payload && typeof payload === 'object', 'the trace must carry a structured payload');
      assert.ok('legacyResumeAllowed' in payload, 'must name the legacy gate\'s resume-allowed decision');
      assert.ok('canonicalResumeAllowed' in payload, 'must name isLayerAllowed\'s resume-allowed decision');
      assert.ok('answerType' in payload, 'must name the AnswerPlan\'s answerType for correlation');
    } finally {
      delete process.env.NATIVELY_PRONOUN_REGEX_SHADOW_OBSERVATION;
      __resetIntelligenceFlagsCache();
    }
  });
});
