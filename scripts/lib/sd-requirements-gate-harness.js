// scripts/lib/sd-requirements-gate-harness.js
//
// Pure helpers for the Electron Requirements-gate core matrix (ticket 13).
// Separates fixture I/O, SessionTracker inject, transcript→slot fill, and
// stub streamChat from the Electron boot script — mirrors sd-grounding-harness
// separation. Does NOT extend benchmark-sd-grounding.

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

/** Slot extractors: map interviewer transcript text → slot fills (thin e2e stub). */
const SLOT_EXTRACTORS = [
  {
    id: 'functional_requirements',
    re: /\b(?:functional(?:\s*requirements?)?\s*[:\-–]?\s*)((?:create|shorten|ingest|produce|redirect)[^.]{0,120})/i,
    alt: /\b((?:create\s+short\s+links?\s+and\s+redirect|ingest\s+clicks?\s+and\s+produce\s+dashboards?)[^.]*)/i,
  },
  {
    id: 'scale_qps',
    re: /\b(?:scale|qps|throughput|events?\/sec)[^.\d]{0,40}(\d[\d,]*(?:\s*[kKmM])?(?:\s*(?:QPS|qps|events?\/sec))?)/i,
  },
  {
    id: 'latency',
    re: /\b(?:latency|p99)[^.\d]{0,40}((?:under\s+)?\d[\d.]*(?:\s*ms|\s*s(?:ec(?:onds?)?)?)?(?:\s*p99)?)/i,
  },
  {
    id: 'consistency_availability',
    re: /\b((?:prefer\s+)?(?:availability|consistency)(?:\s+over\s+(?:strong\s+)?(?:consistency|availability))?)/i,
  },
  {
    id: 'data_flow_stages',
    re: /\b(?:data\s*flow\s*stages?\s*[:\-–]?\s*)([^.]{10,200})/i,
  },
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

/**
 * Fill Requirements artifact slots from interviewer-role transcript text
 * (transcript → slot path for Electron e2e). Returns { artifact, fills }.
 */
function fillArtifactFromInterviewerTranscript(gate, artifact, interviewerItems) {
  const blob = (interviewerItems || []).map((it) => it.text).join('\n');
  let next = artifact;
  const fills = [];
  for (const ex of SLOT_EXTRACTORS) {
    if (next.slots[ex.id]?.filled) continue;
    // Skip data_flow_stages when class does not require it.
    if (ex.id === 'data_flow_stages' && !gate.isDataFlowRequired(next)) continue;
    let m = ex.re.exec(blob);
    if (!m && ex.alt) m = ex.alt.exec(blob);
    if (m && m[1] && String(m[1]).trim()) {
      const value = String(m[1]).trim();
      next = gate.fillSlotFromInterviewer(next, ex.id, value);
      fills.push({ id: ex.id, value });
    }
  }
  return { artifact: next, fills, interviewerBlob: blob };
}

/**
 * Deterministic stub streamChat (ticket 11): phase-aware canned text suitable
 * for structural asserts. Never calls a live model.
 */
function createStubStreamChat(gate, getArtifact) {
  return async function* streamChat(userMessage) {
    const artifact = getArtifact();
    const phase = gate.deriveSdPhase(artifact);
    const msg = String(userMessage || '');

    // Soft-refuse path when advance while incomplete.
    const refuse = gate.softRefuseIfPrematureAdvance(artifact, msg, 'mic');
    if (refuse.refused) {
      yield refuse.spoken;
      return;
    }

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

/**
 * Drive one matrix scenario against SessionTracker + gate helpers + stub LLM.
 * `gate` = required compiled sdRequirementsGate module.
 */
async function runMatrixScenario(gate, sessionTracker, fixture) {
  const failures = [];
  const notes = [];

  sessionTracker.reset?.();

  let artifact = gate.createEmptyRequirementsArtifact(
    fixture.problemKey || fixture.id,
    fixture.problemClass || 'crud_product',
  );
  if (fixture.problemClass) {
    artifact = gate.setProblemClass(artifact, fixture.problemClass);
  }

  injectTranscriptTurns(sessionTracker, fixture.turns || []);
  const ctx = readInterviewerContext(sessionTracker);
  if (ctx.interviewer.length === 0 && (fixture.turns || []).some((t) => t.role === 'interviewer')) {
    failures.push('SessionTracker returned no interviewer rows after fixture inject');
  }
  notes.push(`interviewerRows=${ctx.interviewer.length}`);

  const filled = fillArtifactFromInterviewerTranscript(gate, artifact, ctx.interviewer);
  artifact = filled.artifact;
  notes.push(`fills=${filled.fills.map((f) => f.id).join(',') || '-'}`);

  const getArtifact = () => artifact;
  const stubChat = createStubStreamChat(gate, getArtifact);

  // Candidate advance utterances (user-role turns).
  const advanceTurns = (fixture.turns || []).filter((t) => t.role === 'user' || t.speaker === 'user');

  let softRefused = false;
  let lastSpoken = '';
  let lastPhase = gate.deriveSdPhase(artifact);

  if (fixture.id === 'new-sd-problem-reset') {
    // First: fill + advance to close gate.
    for (const t of advanceTurns) {
      const refuse = gate.softRefuseIfPrematureAdvance(artifact, t.text, 'mic');
      if (refuse.refused) {
        softRefused = true;
        lastSpoken = refuse.spoken;
        artifact = refuse.artifact;
      } else {
        artifact = refuse.artifact;
        lastSpoken = await collectStream(stubChat(t.text));
        lastSpoken = gate.enforceStructuralGate(lastSpoken, gate.deriveSdPhase(artifact));
      }
    }
    const phaseAfterFirst = gate.deriveSdPhase(artifact);
    if (phaseAfterFirst !== fixture.expect.sdPhaseAfterFirstAdvance) {
      failures.push(
        `after first advance expected sdPhase=${fixture.expect.sdPhaseAfterFirstAdvance}, got ${phaseAfterFirst}`,
      );
    }

    // Reset on new problem key.
    const reset = gate.resetArtifactForNewSdProblem(artifact, fixture.newProblemKey);
    artifact = reset;
    lastPhase = gate.deriveSdPhase(artifact);
    if (lastPhase !== fixture.expect.sdPhaseAfterReset) {
      failures.push(`after reset expected sdPhase=${fixture.expect.sdPhaseAfterReset}, got ${lastPhase}`);
    }
    if (Boolean(artifact.gateClosed) !== Boolean(fixture.expect.gateClosedAfterReset)) {
      failures.push(`after reset gateClosed=${artifact.gateClosed}`);
    }
    if (gate.isChecklistComplete(artifact) !== Boolean(fixture.expect.checklistCompleteAfterReset)) {
      failures.push(`after reset checklistComplete=${gate.isChecklistComplete(artifact)}`);
    }
    if (fixture.expect.priorSlotsCleared && artifact.slots.functional_requirements?.filled) {
      failures.push('prior FR fill survived new-SD-problem reset');
    }

    // Inject the "new problem" interviewer turn already in fixtures; prove context readable.
    const afterResetCtx = readInterviewerContext(sessionTracker);
    if (!afterResetCtx.interviewer.some((it) => /rate limiter/i.test(it.text))) {
      failures.push('new SD problem interviewer turn not visible in SessionTracker context');
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

  // Soft-refuse / advance handling for remaining scenarios.
  for (const t of advanceTurns) {
    const refuse = gate.softRefuseIfPrematureAdvance(artifact, t.text, 'mic');
    if (refuse.refused) {
      softRefused = true;
      lastSpoken = refuse.spoken;
      artifact = refuse.artifact;
      // Soft-refuse must never include later headings.
      if (gate.hasLaterFrameworkHeadings(lastSpoken)) {
        failures.push('soft-refuse spoken contains later framework headings');
      }
    } else {
      artifact = refuse.artifact;
      lastSpoken = await collectStream(stubChat(t.text));
      lastSpoken = gate.enforceStructuralGate(lastSpoken, gate.deriveSdPhase(artifact));
    }
  }

  // If no advance turn, still run stub chat once to exercise structural gate.
  if (advanceTurns.length === 0) {
    lastSpoken = await collectStream(stubChat('Continue requirements grilling.'));
    lastSpoken = gate.enforceStructuralGate(lastSpoken, gate.deriveSdPhase(artifact));
  }

  lastPhase = gate.deriveSdPhase(artifact);
  const expect = fixture.expect || {};

  if (expect.sdPhaseAfter && lastPhase !== expect.sdPhaseAfter) {
    failures.push(`expected sdPhase=${expect.sdPhaseAfter}, got ${lastPhase}`);
  }
  if (typeof expect.checklistComplete === 'boolean' && gate.isChecklistComplete(artifact) !== expect.checklistComplete) {
    failures.push(
      `expected checklistComplete=${expect.checklistComplete}, got ${gate.isChecklistComplete(artifact)}`,
    );
  }
  if (typeof expect.gateClosed === 'boolean' && Boolean(artifact.gateClosed) !== expect.gateClosed) {
    failures.push(`expected gateClosed=${expect.gateClosed}, got ${artifact.gateClosed}`);
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
      if (!artifact.slots[id]?.filled) failures.push(`required slot not filled from transcript: ${id}`);
    }
  }
  if (expect.dataFlowRequired && !gate.isDataFlowRequired(artifact)) {
    failures.push('expected data_flow_stages required for pipeline class');
  }

  // Later-section allow / block on stubbed spoken output.
  if (typeof expect.laterSectionsAllowed === 'boolean') {
    const hasLater = gate.hasLaterFrameworkHeadings(lastSpoken);
    if (expect.laterSectionsAllowed && !hasLater && lastPhase === 'post_requirements') {
      // Re-run stub in post phase to assert allow path.
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

  // LESSON allowlist scenario.
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
