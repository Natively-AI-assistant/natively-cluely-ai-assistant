// scripts/lib/sd-requirements-gate-harness.js
//
// Electron Requirements-gate core matrix helpers (ticket 13).
// Injects fixtures into SessionTracker, then drives the PRODUCTION
// prepareSdRequirementsForAnswerPlan + working-copy APIs (live path).
// Stub streamChat only for structural heading asserts — never a live model.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'sd-requirements-gate');

const CORE_MATRIX_IDS = [
  'happy-gated-advance',
  'premature-soft-refuse',
  'lesson-allowlist-gated',
  'new-sd-problem-reset',
  'pipeline-data-flow-stages',
];

function loadFixture(id) {
  const p = path.join(FIXTURE_DIR, `${id}.json`);
  if (!fs.existsSync(p)) throw new Error(`missing fixture: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadCoreMatrixFixtures() {
  return CORE_MATRIX_IDS.map(loadFixture);
}

/**
 * Inject synthetic turns into SessionTracker via the same addTranscript API
 * production STT uses (ticket 10). Speakers: system→interviewer, user→user,
 * assistant→assistant (mapSpeakerToRole).
 */
function injectTranscriptTurns(sessionTracker, turns, baseTs = Date.now()) {
  const injected = [];
  let i = 0;
  for (const turn of turns || []) {
    const speaker =
      turn.speaker ||
      (turn.role === 'user' ? 'user' : turn.role === 'assistant' ? 'assistant' : 'system');
    const segment = {
      speaker,
      text: String(turn.text || ''),
      timestamp: baseTs + i * 1000,
      final: true,
    };
    const result = sessionTracker.addTranscript(segment);
    injected.push({ segment, result, role: result?.role || null });
    i += 1;
  }
  return injected;
}

/** Read interviewer-attributed rows back from production SessionTracker APIs. */
function readInterviewerContext(sessionTracker, lastSeconds = 180) {
  const items = sessionTracker.getContextWithInterim
    ? sessionTracker.getContextWithInterim(lastSeconds)
    : sessionTracker.getContext?.(lastSeconds) || [];
  const interviewer = (items || []).filter((it) => it.role === 'interviewer');
  const last = sessionTracker.getLastInterviewerTurn?.() || null;
  return { items: items || [], interviewer, lastInterviewerTurn: last };
}

/** Thin wrapper kept for callers; prefers production live.fill when available. */
function fillArtifactFromInterviewerTranscript(gate, artifact, interviewerItems, live) {
  const blob = (interviewerItems || []).map((it) => it.text).join('\n');
  if (live?.fillArtifactFromInterviewerText) {
    const filled = live.fillArtifactFromInterviewerText(artifact, blob);
    return { ...filled, interviewerBlob: blob };
  }
  // Fallback: should not run once live module is required by e2e.
  throw new Error('fillArtifactFromInterviewerTranscript requires sdRequirementsLive');
}

/**
 * Deterministic stub streamChat (ticket 11): phase-aware canned text suitable
 * for structural asserts. Never calls a live model.
 */
function createStubStreamChat(gate, getArtifact) {
  return async function* streamChat(_userMessage) {
    const artifact = getArtifact();
    const phase = gate.deriveSdPhase(artifact);

    if (phase === 'requirements') {
      // Deliberately leak later headings — structural gate must strip them.
      yield [
        'Quick clarifying question on the next open slot.',
        '',
        '## Requirements',
        '- Live draft from interviewer answers so far.',
        '',
        '## Core Entities',
        'URL, User — MUST NOT SHIP WHILE GATED',
        '## High-Level Design',
        'CDN + Redis — MUST NOT SHIP WHILE GATED',
        '## Deep Dives',
        'Base62 — MUST NOT SHIP WHILE GATED',
      ].join('\n');
      return;
    }

    yield [
      '## Requirements',
      '- Checklist complete; advancing.',
      '## Core Entities',
      'URL, User, Click',
      '## API / Interface',
      'POST /shorten',
      '## High-Level Design',
      'CDN in front of app servers and Redis',
      '## Deep Dives',
      'Base62 encoding tradeoffs',
    ].join('\n');
  };
}

async function collectStream(gen) {
  let out = '';
  for await (const t of gen) out += String(t);
  return out;
}

const SD_PLAN = { answerType: 'system_design_answer', forbiddenContextLayers: [] };

function commitWorkingCopy(sessionTracker, prepared) {
  if (prepared.artifact && sessionTracker.setSdRequirementsArtifact) {
    sessionTracker.setSdRequirementsArtifact(prepared.artifact);
  }
  return prepared;
}

/**
 * Drive one matrix scenario against SessionTracker + PRODUCTION prepare.
 * `gate` = compiled sdRequirementsGate; `live` = compiled sdRequirementsLive.
 */
async function runMatrixScenario(gate, sessionTracker, fixture, live) {
  if (!live || typeof live.prepareSdRequirementsForAnswerPlan !== 'function') {
    throw new Error(
      'runMatrixScenario requires compiled sdRequirementsLive — rebuild electron and pass live module',
    );
  }

  const failures = [];
  const notes = [];

  sessionTracker.reset?.();
  sessionTracker.clearSdRequirementsLive?.();

  injectTranscriptTurns(sessionTracker, fixture.turns || []);
  const ctx = readInterviewerContext(sessionTracker);
  if (ctx.interviewer.length === 0 && (fixture.turns || []).some((t) => t.role === 'interviewer')) {
    failures.push('SessionTracker returned no interviewer rows after fixture inject');
  }
  notes.push(`interviewerRows=${ctx.interviewer.length}`);
  notes.push('prepare=sdRequirementsLive');

  const interviewerTexts = ctx.interviewer.map((it) => it.text);
  const problemQuestion = fixture.problemKey || fixture.id;
  const advanceTurns = (fixture.turns || []).filter((t) => t.role === 'user' || t.speaker === 'user');
  const latestAdvance = advanceTurns.length
    ? [String(advanceTurns[advanceTurns.length - 1].text || '')]
    : [];

  const getArtifact = () =>
    sessionTracker.getSdRequirementsArtifact?.() ||
    gate.createEmptyRequirementsArtifact(problemQuestion);

  const stubChat = createStubStreamChat(gate, getArtifact);

  let softRefused = false;
  let lastSpoken = '';
  let lastPhase = 'requirements';
  let artifact = null;
  let fills = [];

  if (fixture.id === 'new-sd-problem-reset') {
    // Fill + advance via production prepare (working copy on SessionTracker).
    let prepared = commitWorkingCopy(
      sessionTracker,
      live.prepareSdRequirementsForAnswerPlan({
        answerPlan: { ...SD_PLAN },
        artifact: sessionTracker.getSdRequirementsArtifact?.() ?? null,
        problemQuestion,
        interviewerTexts,
        candidateTexts: latestAdvance,
      }),
    );
    fills = prepared.fills || [];
    notes.push(`fills=${fills.map((f) => f.id).join(',') || '-'}`);

    if (prepared.softRefuseSpoken) {
      softRefused = true;
      lastSpoken = prepared.softRefuseSpoken;
    } else {
      lastSpoken = await collectStream(stubChat(latestAdvance[0] || 'Continue'));
      lastSpoken = gate.enforceStructuralGate(lastSpoken, prepared.sdPhase);
    }

    const phaseAfterFirst = prepared.sdPhase;
    if (phaseAfterFirst !== fixture.expect.sdPhaseAfterFirstAdvance) {
      failures.push(
        `after first advance expected sdPhase=${fixture.expect.sdPhaseAfterFirstAdvance}, got ${phaseAfterFirst}`,
      );
    }

    // New SD problem → production prepare resets working copy.
    prepared = commitWorkingCopy(
      sessionTracker,
      live.prepareSdRequirementsForAnswerPlan({
        answerPlan: { ...SD_PLAN },
        artifact: sessionTracker.getSdRequirementsArtifact?.() ?? null,
        problemQuestion: fixture.newProblemKey,
        interviewerTexts: [],
        candidateTexts: [],
      }),
    );
    artifact = prepared.artifact;
    lastPhase = prepared.sdPhase;

    if (lastPhase !== fixture.expect.sdPhaseAfterReset) {
      failures.push(`after reset expected sdPhase=${fixture.expect.sdPhaseAfterReset}, got ${lastPhase}`);
    }
    if (Boolean(artifact?.gateClosed) !== Boolean(fixture.expect.gateClosedAfterReset)) {
      failures.push(`after reset gateClosed=${artifact?.gateClosed}`);
    }
    if (gate.isChecklistComplete(artifact) !== Boolean(fixture.expect.checklistCompleteAfterReset)) {
      failures.push(`after reset checklistComplete=${gate.isChecklistComplete(artifact)}`);
    }
    if (fixture.expect.priorSlotsCleared && artifact?.slots?.functional_requirements?.filled) {
      failures.push('prior FR fill survived new-SD-problem reset');
    }

    const afterResetCtx = readInterviewerContext(sessionTracker);
    if (!afterResetCtx.interviewer.some((it) => /rate limiter/i.test(it.text))) {
      failures.push('new SD problem interviewer turn not visible in SessionTracker context');
    }

    // Prove working copy is the SessionTracker artifact.
    if (sessionTracker.getSdRequirementsArtifact?.() !== artifact) {
      failures.push('SessionTracker working copy not updated after prepare reset');
    }

    return {
      id: fixture.id,
      ok: failures.length === 0,
      failures,
      notes,
      artifact,
      sdPhase: lastPhase,
      spoken: lastSpoken,
      softRefused,
    };
  }

  // Core path: production prepare stamps sdPhase from transcript + advance.
  const prepared = commitWorkingCopy(
    sessionTracker,
    live.prepareSdRequirementsForAnswerPlan({
      answerPlan: { ...SD_PLAN },
      artifact: sessionTracker.getSdRequirementsArtifact?.() ?? null,
      problemQuestion,
      interviewerTexts,
      candidateTexts: latestAdvance,
    }),
  );
  artifact = prepared.artifact;
  fills = prepared.fills || [];
  notes.push(`fills=${fills.map((f) => f.id).join(',') || '-'}`);
  lastPhase = prepared.sdPhase;

  if (prepared.softRefuseSpoken) {
    softRefused = true;
    lastSpoken = prepared.softRefuseSpoken;
    if (gate.hasLaterFrameworkHeadings(lastSpoken)) {
      failures.push('soft-refuse spoken contains later framework headings');
    }
  } else {
    lastSpoken = await collectStream(
      stubChat(latestAdvance[0] || 'Continue requirements grilling.'),
    );
    lastSpoken = gate.enforceStructuralGate(lastSpoken, lastPhase);
  }

  if (sessionTracker.getSdRequirementsArtifact?.()?.problemKey !== artifact?.problemKey) {
    failures.push('SessionTracker working copy missing after prepare');
  }

  const expect = fixture.expect || {};

  if (expect.sdPhaseAfter && lastPhase !== expect.sdPhaseAfter) {
    failures.push(`expected sdPhase=${expect.sdPhaseAfter}, got ${lastPhase}`);
  }
  if (typeof expect.checklistComplete === 'boolean' && gate.isChecklistComplete(artifact) !== expect.checklistComplete) {
    failures.push(
      `expected checklistComplete=${expect.checklistComplete}, got ${gate.isChecklistComplete(artifact)}`,
    );
  }
  if (typeof expect.gateClosed === 'boolean' && Boolean(artifact?.gateClosed) !== expect.gateClosed) {
    failures.push(`expected gateClosed=${expect.gateClosed}, got ${artifact?.gateClosed}`);
  }
  if (typeof expect.softRefused === 'boolean' && softRefused !== expect.softRefused) {
    failures.push(`expected softRefused=${expect.softRefused}, got ${softRefused}`);
  }
  if (Array.isArray(expect.softRefuseMustName)) {
    for (const name of expect.softRefuseMustName) {
      if (!new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(lastSpoken)) {
        failures.push(`soft-refuse missing named slot: ${name}`);
      }
    }
  }
  if (Array.isArray(expect.requiredSlotsFilled)) {
    for (const id of expect.requiredSlotsFilled) {
      if (!artifact?.slots?.[id]?.filled) failures.push(`required slot not filled from transcript: ${id}`);
    }
  }
  if (expect.dataFlowRequired && !gate.isDataFlowRequired(artifact)) {
    failures.push('expected data_flow_stages required for pipeline class');
  }

  if (typeof expect.laterSectionsAllowed === 'boolean') {
    const hasLater = gate.hasLaterFrameworkHeadings(lastSpoken);
    if (expect.laterSectionsAllowed && !hasLater && lastPhase === 'post_requirements') {
      const post = gate.enforceStructuralGate(
        await collectStream(stubChat('Walk High-Level Design now.')),
        'post_requirements',
      );
      if (!gate.hasLaterFrameworkHeadings(post)) {
        failures.push('post_requirements stub output missing later framework headings');
      }
      lastSpoken = post;
    } else if (!expect.laterSectionsAllowed && hasLater) {
      failures.push('later framework headings leaked while gate open');
    }
  }

  if (fixture.lessonChunks) {
    const filtered = gate.filterLessonChunksForPhase(fixture.lessonChunks, lastPhase);
    const text = filtered.map((c) => c.text).join('\n');
    for (const must of expect.lessonMustInclude || []) {
      if (!text.includes(must)) failures.push(`LESSON filter missing: ${must}`);
    }
    for (const forbid of expect.lessonMustExclude || []) {
      if (text.includes(forbid)) failures.push(`LESSON filter leaked: ${forbid}`);
    }
    notes.push(`lessonFilteredChars=${text.length}`);
  }

  return {
    id: fixture.id,
    ok: failures.length === 0,
    failures,
    notes,
    artifact,
    sdPhase: lastPhase,
    spoken: lastSpoken,
    softRefused,
  };
}

module.exports = {
  FIXTURE_DIR,
  CORE_MATRIX_IDS,
  loadFixture,
  loadCoreMatrixFixtures,
  injectTranscriptTurns,
  readInterviewerContext,
  fillArtifactFromInterviewerTranscript,
  createStubStreamChat,
  collectStream,
  runMatrixScenario,
};
