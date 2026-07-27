// scripts/lib/sd-requirements-gate-smoke.js
//
// Pure helpers for the optional Requirements-gate real-API smoke:
// URL-shortener gated→advance scenario, structural heading asserts, and
// skip-gate alias. No Electron / network I/O — unit-testable.
//
// When dist-electron ships sdRequirementsGate (ticket 12), the Electron
// smoke prefers those production helpers; these patterns stay as a
// fallback + oracle for CI without a full product merge.

'use strict';

const { shouldRunRealApi, resolveGeminiApiKey } = require('./sd-grounding-harness.js');

/** Later Delivery Framework headings blocked while sdPhase=requirements. */
const LATER_FRAMEWORK_HEADING_PATTERNS = [
  /^#{1,3}\s*Core Entities\b/im,
  /^#{1,3}\s*Defining the Core Entities\b/im,
  /^#{1,3}\s*(?:The\s+)?API(?:\s*\/\s*Interface|\s+Design)?\b/im,
  /^#{1,3}\s*API\s*\/\s*Interface\b/im,
  /^#{1,3}\s*Data Flow\b/im,
  /^#{1,3}\s*High[- ]Level Design\b/im,
  /^#{1,3}\s*(?:Potential\s+)?Deep Dives?\b/im,
];

const REQUIREMENTS_PHASE_CONTRACT = `<requirements_phase_contract>
The Requirements grilling gate is OPEN. Speak clarifying questions and a live Requirements draft only.
Do not emit Core Entities, API / Interface, Data Flow, High-Level Design, or Deep Dives sections (or equivalents).
If LESSON / reference_file material is present, use it only to choose clarifiers and FR/NFR draft wording — not architecture, APIs, or deep dives.
</requirements_phase_contract>`;

const MANDATORY_SLOTS = [
  'functional_requirements',
  'scale_qps',
  'latency',
  'consistency_availability',
];

/**
 * Canonical happy-path smoke: URL shortener, fill mandatory slots from
 * interviewer fixtures, then candidate advance → post_requirements.
 */
const URL_SHORTENER_GATED_ADVANCE = {
  id: 'url-shortener-gated-advance',
  problemKey: 'url-shortener',
  problemPrompt:
    'Interviewer: Design a URL shortener like Bitly. Walk me through the system design — start with Requirements.',
  interviewerFills: [
    {
      slot: 'functional_requirements',
      text: 'Interviewer: Functional requirements are create short links and redirect; custom aliases are optional.',
    },
    {
      slot: 'scale_qps',
      text: 'Interviewer: Expect about 1k writes/sec and 10k redirects/sec at peak.',
    },
    {
      slot: 'latency',
      text: 'Interviewer: Redirect p99 should stay under 50ms.',
    },
    {
      slot: 'consistency_availability',
      text: 'Interviewer: Prefer availability for redirects; eventual consistency on click analytics is fine.',
    },
  ],
  advanceUtterance: "Let's move on to high-level design.",
  postAdvancePrompt:
    'Candidate: Checklist looks solid — please give High-Level Design and a Deep Dive on the short-code encoding / redirect hot path (Redis or similar is fine).',
};

function hasLaterFrameworkHeadings(text) {
  const t = typeof text === 'string' ? text : '';
  return LATER_FRAMEWORK_HEADING_PATTERNS.some((re) => re.test(t));
}

function softTruncateToRequirements(text) {
  const t = typeof text === 'string' ? text : '';
  if (!hasLaterFrameworkHeadings(t)) return t;
  let cut = t.length;
  for (const re of LATER_FRAMEWORK_HEADING_PATTERNS) {
    const m = re.exec(t);
    if (m && m.index < cut) cut = m.index;
  }
  const kept = t.slice(0, cut).trim();
  if (kept.length > 0) return kept;
  return (
    'Let me stay on Requirements for a moment — clarifying questions and the live draft only, ' +
    'then we can advance once the checklist is solid.'
  );
}

function assertGatedSpoken(text) {
  const spoken = softTruncateToRequirements(text);
  const misses = [];
  if (hasLaterFrameworkHeadings(spoken)) {
    misses.push('GATED:later-framework-heading');
  }
  if (!spoken || !String(spoken).trim()) {
    misses.push('GATED:empty');
  }
  return { ok: misses.length === 0, misses, spoken };
}

/**
 * After gate close: expect at least one later-framework heading OR a
 * recognizable shortener tech claim (live models vary in markdown style).
 */
function assertPostAdvanceSpoken(text) {
  const t = typeof text === 'string' ? text : '';
  const misses = [];
  const hasLater = hasLaterFrameworkHeadings(t);
  const techAny = [/redis/i, /base62/i, /cdn/i, /dynamodb/i, /memcached/i, /cache/i];
  const matchedTech = techAny.filter((re) => re.test(t));
  if (!hasLater && matchedTech.length === 0) {
    misses.push('POST:need HLD/Deep Dive heading or shortener tech claim');
  }
  if (!t.trim()) misses.push('POST:empty');
  return { ok: misses.length === 0, misses, matchedTech: matchedTech.map(String), hasLater };
}

function createEmptyArtifact(problemKey = 'url-shortener') {
  const slots = {};
  for (const id of [...MANDATORY_SLOTS, 'durability', 'read_write_ratio', 'data_flow_stages']) {
    slots[id] = { filled: false, askedOnce: false };
  }
  return {
    gateClosed: false,
    advanceAccepted: false,
    problemClass: 'crud_product',
    problemKey,
    slots,
  };
}

function fillSlotFromInterviewer(artifact, slotId, value) {
  return {
    ...artifact,
    slots: {
      ...artifact.slots,
      [slotId]: {
        ...artifact.slots[slotId],
        filled: true,
        fillSource: 'interviewer',
        value,
      },
    },
  };
}

function isChecklistComplete(artifact) {
  return MANDATORY_SLOTS.every((id) => artifact.slots[id]?.filled);
}

function acceptAdvance(artifact) {
  if (!isChecklistComplete(artifact)) return artifact;
  return { ...artifact, advanceAccepted: true, gateClosed: true };
}

function deriveSdPhase(artifact) {
  return artifact.gateClosed && artifact.advanceAccepted ? 'post_requirements' : 'requirements';
}

function applyInterviewerFills(artifact, fills = URL_SHORTENER_GATED_ADVANCE.interviewerFills) {
  let next = artifact;
  for (const fill of fills) {
    next = fillSlotFromInterviewer(next, fill.slot, fill.text);
  }
  return next;
}

/**
 * Same key rules as shouldRunRealApi; Requirements smoke also accepts
 * RUN_SD_REQUIREMENTS_GATE_E2E (already honored by shouldRunRealApi).
 */
function shouldRunRequirementsGateSmoke(env = process.env) {
  return shouldRunRealApi(env);
}

function skipMessage() {
  return (
    '[sd-req-gate-smoke] SKIP — set RUN_SD_REQUIREMENTS_GATE_E2E=1 (or RUN_SD_GROUNDING_E2E=1 / RUN_NATIVELY_API_E2E=1) ' +
    '+ GEMINI_API_KEY (preferred) or NATIVELY_API_KEY. Not for PR CI — weekly/dispatch only.'
  );
}

module.exports = {
  LATER_FRAMEWORK_HEADING_PATTERNS,
  REQUIREMENTS_PHASE_CONTRACT,
  MANDATORY_SLOTS,
  URL_SHORTENER_GATED_ADVANCE,
  hasLaterFrameworkHeadings,
  softTruncateToRequirements,
  assertGatedSpoken,
  assertPostAdvanceSpoken,
  createEmptyArtifact,
  fillSlotFromInterviewer,
  isChecklistComplete,
  acceptAdvance,
  deriveSdPhase,
  applyInterviewerFills,
  shouldRunRequirementsGateSmoke,
  skipMessage,
  resolveGeminiApiKey,
};
