// electron/context-intelligence/policies/mode-policy-registry.ts
//
// THE single source of truth for mode behaviour.
//
// WHY THIS SHAPE
// Mode is currently reinterpreted at ~95 branch sites across ~30 files, and
// EIGHT files hold their own copy of the mode-id list — five as plain string
// sets with no compile-time link to the mode union. That is why adding the 8th
// mode (`seminar`) compiled cleanly while silently disabling its routing in six
// places, and why an unvalidated templateType can create a mode with no system
// prompt at all.
//
// The registry below is typed `Record<ModeId, ModePolicy>` — NOT Partial, not an
// array. Adding a ModeId without a policy is a COMPILE ERROR, which is exactly
// the guarantee the legacy string sets fail to provide.
//
// See docs/context-intelligence-v3/05_MODE_POLICY_SPEC.md

import type { SourceType, GroundingPolicy } from '../contracts/types';

/** The eight built-in modes. `thesis` and `coding-interview` are deliberately
 *  absent: they do not exist in this codebase (verified across all DB
 *  migrations) and are served by `seminar` and `technical-interview`. */
export type ModeId =
  | 'general'
  | 'sales'
  | 'recruiting'
  | 'team-meet'
  | 'looking-for-work'
  | 'technical-interview'
  | 'lecture'
  | 'seminar';

export const MODE_IDS: readonly ModeId[] = [
  'general', 'sales', 'recruiting', 'team-meet',
  'looking-for-work', 'technical-interview', 'lecture', 'seminar',
] as const;

export interface CapabilityPolicy {
  explainSourceContent: boolean;
  summarize: boolean;
  compareSources: boolean;
  directEvidenceInference: boolean;
  calculateFromEvidence: boolean;
  generatePseudocode: boolean;
  generateCode: boolean;
  critique: boolean;
  brainstorm: boolean;
  suggestImprovements: boolean;
  makeRecommendations: boolean;
  useGeneralTechnicalKnowledge: boolean;
  useGeneralIndustryKnowledge: boolean;
  hypotheticalExamples: boolean;
  unsupportedPersonalClaims: 'REFUSE' | 'DISCLOSE_GAP';
  externalSuggestionDisclosure: 'NONE' | 'WHEN_SOURCE_SPECIFIC' | 'ALWAYS';
}

export interface ModePolicy {
  id: ModeId;
  /** Bumped on any behavioural change; recorded in every AnswerTrace so a
   *  regression can be attributed to a policy revision. */
  version: string;
  name: string;
  purpose: string;

  allowedSourceTypes: SourceType[];
  sourcePriorities: Partial<Record<SourceType, number>>;

  /**
   * Which Profile Intelligence pools this mode hydrates WITHOUT duplicate mode
   * attachments (the user's active résumé / target JD / verified facts,
   * uploaded once in Profile settings).
   *
   * EXPLICIT opt-in, deliberately distinct from allowedSourceTypes: Recruiting
   * allows JOB_DESCRIPTION — a hiring JD attached to the mode — but the user's
   * own target JD must never leak into candidate evaluation, and Recruiting's
   * CANDIDATE_FILE must never be conflated with the user's résumé. An empty
   * list means "mode attachments only", which is every mode's pre-2026-07-31
   * behaviour. Subset of allowedSourceTypes by contract (asserted in tests).
   */
  profileSources: SourceType[];

  groundingPolicy: GroundingPolicy;
  capabilityPolicy: CapabilityPolicy;

  /** Claim classes that always require private evidence in this mode. */
  personalClaimsRequireEvidence: boolean;
  documentClaimsRequireEvidence: boolean;
  meetingClaimsRequireEvidence: boolean;
  jobClaimsRequireJdEvidence: boolean;

  retrievalPolicy: {
    enabled: boolean;
    maximumAttempts: 2;
    maximumCandidates: number;
    maximumAcceptedEvidence: number;
  };

  contextBudget: {
    evidenceTokens: number;
    conversationTokens: number;
    transcriptTokens: number;
    screenTokens: number;
  };

  citations: 'HIDDEN' | 'OPTIONAL' | 'VISIBLE';
}

// ── capability presets ──────────────────────────────────────────────────────

const OPEN_CAPS: CapabilityPolicy = {
  explainSourceContent: true, summarize: true, compareSources: true,
  directEvidenceInference: true, calculateFromEvidence: true,
  generatePseudocode: true, generateCode: true,
  critique: true, brainstorm: true, suggestImprovements: true, makeRecommendations: true,
  useGeneralTechnicalKnowledge: true, useGeneralIndustryKnowledge: true,
  hypotheticalExamples: true,
  unsupportedPersonalClaims: 'DISCLOSE_GAP',
  externalSuggestionDisclosure: 'WHEN_SOURCE_SPECIFIC',
};

// Strict grounding must NOT block valid transformations. A seminar document may
// describe an algorithm without containing code; explanation, summary,
// pseudocode and derived code all remain permitted. What is blocked is
// unsupported findings and external facts presented as document content.
const STRICT_DOC_CAPS: CapabilityPolicy = {
  ...OPEN_CAPS,
  brainstorm: false,
  makeRecommendations: false,
  useGeneralIndustryKnowledge: false,
  hypotheticalExamples: false,
  externalSuggestionDisclosure: 'ALWAYS',
};

const budget = (evidence: number, conv: number, tx: number, screen: number) =>
  ({ evidenceTokens: evidence, conversationTokens: conv, transcriptTokens: tx, screenTokens: screen });

const retrieval = (candidates: number, accepted: number) =>
  ({ enabled: true, maximumAttempts: 2 as const, maximumCandidates: candidates, maximumAcceptedEvidence: accepted });

// ── the registry ────────────────────────────────────────────────────────────

export const MODE_POLICIES: Record<ModeId, ModePolicy> = {
  general: {
    id: 'general', version: '1.0.0', name: 'General',
    purpose: 'Universal adaptive copilot for any meeting or conversation.',
    allowedSourceTypes: ['REFERENCE_FILE', 'MEETING_TRANSCRIPT', 'CONVERSATION_STATE', 'SCREEN_CONTEXT'],
    sourcePriorities: { REFERENCE_FILE: 1, MEETING_TRANSCRIPT: 2 },
    profileSources: [],
    groundingPolicy: 'OPEN_KNOWLEDGE', capabilityPolicy: OPEN_CAPS,
    personalClaimsRequireEvidence: true, documentClaimsRequireEvidence: true,
    meetingClaimsRequireEvidence: true, jobClaimsRequireJdEvidence: true,
    retrievalPolicy: retrieval(20, 6), contextBudget: budget(1500, 600, 800, 400),
    citations: 'HIDDEN',
  },

  sales: {
    id: 'sales', version: '1.0.0', name: 'Sales',
    purpose: 'Close deals with strategic discovery and objection handling.',
    allowedSourceTypes: ['REFERENCE_FILE', 'MEETING_TRANSCRIPT', 'CONVERSATION_STATE', 'SCREEN_CONTEXT'],
    sourcePriorities: { REFERENCE_FILE: 1, MEETING_TRANSCRIPT: 2 },
    profileSources: [],
    groundingPolicy: 'SOURCE_FIRST', capabilityPolicy: OPEN_CAPS,
    // Pricing, commitments and customer statements are product claims: they
    // require evidence and must never be generated.
    personalClaimsRequireEvidence: true, documentClaimsRequireEvidence: true,
    meetingClaimsRequireEvidence: true, jobClaimsRequireJdEvidence: true,
    retrievalPolicy: retrieval(20, 6), contextBudget: budget(1800, 600, 900, 300),
    citations: 'OPTIONAL',
  },

  recruiting: {
    id: 'recruiting', version: '1.0.0', name: 'Recruiting',
    purpose: 'Evaluate candidates with structured interview insights.',
    // CANDIDATE_FILE is a distinct source type from RESUME so a candidate's
    // documents can never be confused with the Natively user's own resume.
    allowedSourceTypes: ['CANDIDATE_FILE', 'JOB_DESCRIPTION', 'REFERENCE_FILE', 'MEETING_TRANSCRIPT', 'CONVERSATION_STATE'],
    sourcePriorities: { CANDIDATE_FILE: 1, JOB_DESCRIPTION: 2, REFERENCE_FILE: 3 },
    // The user's OWN profile must never describe a candidate: no hydration.
    profileSources: [],
    groundingPolicy: 'SOURCE_FIRST', capabilityPolicy: OPEN_CAPS,
    personalClaimsRequireEvidence: true, documentClaimsRequireEvidence: true,
    meetingClaimsRequireEvidence: true, jobClaimsRequireJdEvidence: true,
    retrievalPolicy: retrieval(20, 6), contextBudget: budget(1800, 600, 900, 200),
    citations: 'OPTIONAL',
  },

  'team-meet': {
    id: 'team-meet', version: '1.0.0', name: 'Team Meet',
    purpose: 'Track action items and key decisions from meetings.',
    allowedSourceTypes: ['MEETING_TRANSCRIPT', 'REFERENCE_FILE', 'SCREEN_CONTEXT', 'CONVERSATION_STATE'],
    sourcePriorities: { MEETING_TRANSCRIPT: 1, REFERENCE_FILE: 2 },
    profileSources: [],
    groundingPolicy: 'OPEN_KNOWLEDGE', capabilityPolicy: OPEN_CAPS,
    personalClaimsRequireEvidence: true, documentClaimsRequireEvidence: true,
    meetingClaimsRequireEvidence: true, jobClaimsRequireJdEvidence: true,
    retrievalPolicy: retrieval(20, 6), contextBudget: budget(1200, 800, 1400, 400),
    citations: 'HIDDEN',
  },

  'looking-for-work': {
    id: 'looking-for-work', version: '1.1.0', name: 'Looking for work',
    purpose: 'Answer interview questions with confidence and clarity.',
    allowedSourceTypes: ['RESUME', 'JOB_DESCRIPTION', 'PROFILE_FACT', 'REFERENCE_FILE', 'CONVERSATION_STATE'],
    // Resume outranks JD: the JD may shape EMPHASIS, never prove experience.
    sourcePriorities: { RESUME: 1, PROFILE_FACT: 2, JOB_DESCRIPTION: 3 },
    // Profile Intelligence is the PRIMARY source here (uploaded once in
    // Profile settings); mode attachments are optional supplements.
    profileSources: ['RESUME', 'JOB_DESCRIPTION', 'PROFILE_FACT'],
    groundingPolicy: 'SOURCE_FIRST', capabilityPolicy: OPEN_CAPS,
    personalClaimsRequireEvidence: true, documentClaimsRequireEvidence: true,
    meetingClaimsRequireEvidence: true, jobClaimsRequireJdEvidence: true,
    retrievalPolicy: retrieval(20, 6), contextBudget: budget(1800, 600, 600, 200),
    citations: 'HIDDEN',
  },

  'technical-interview': {
    id: 'technical-interview', version: '1.1.0', name: 'Technical Interview',
    purpose: 'Whiteboard-style coding and system design support.',
    allowedSourceTypes: ['RESUME', 'JOB_DESCRIPTION', 'PROJECT_FILE', 'CODING_SAMPLE', 'SCREEN_CONTEXT', 'CONVERSATION_STATE'],
    sourcePriorities: { RESUME: 1, PROJECT_FILE: 2, CODING_SAMPLE: 3, JOB_DESCRIPTION: 4 },
    // Same latent defect as looking-for-work: RESUME was planned but had no
    // pool without duplicate attachments. JD/résumé hydrate; PROFILE_FACT is
    // not in this mode's allowlist so it is not opted in.
    profileSources: ['RESUME', 'JOB_DESCRIPTION'],
    groundingPolicy: 'SOURCE_FIRST', capabilityPolicy: OPEN_CAPS,
    personalClaimsRequireEvidence: true, documentClaimsRequireEvidence: true,
    meetingClaimsRequireEvidence: true, jobClaimsRequireJdEvidence: true,
    retrievalPolicy: retrieval(20, 6), contextBudget: budget(1600, 700, 700, 800),
    citations: 'HIDDEN',
  },

  lecture: {
    id: 'lecture', version: '1.0.0', name: 'Lecture',
    purpose: 'Capture key concepts and content from lectures.',
    allowedSourceTypes: ['REFERENCE_FILE', 'MEETING_TRANSCRIPT', 'CONVERSATION_STATE'],
    sourcePriorities: { REFERENCE_FILE: 1, MEETING_TRANSCRIPT: 2 },
    profileSources: [],
    groundingPolicy: 'SOURCE_FIRST', capabilityPolicy: OPEN_CAPS,
    personalClaimsRequireEvidence: true, documentClaimsRequireEvidence: true,
    meetingClaimsRequireEvidence: true, jobClaimsRequireJdEvidence: true,
    retrievalPolicy: retrieval(24, 8), contextBudget: budget(2000, 500, 1000, 200),
    citations: 'OPTIONAL',
  },

  seminar: {
    id: 'seminar', version: '1.0.0', name: 'Seminar',
    purpose: 'Strict file-grounded Q&A for presentations, thesis defences and paper walkthroughs.',
    allowedSourceTypes: ['REFERENCE_FILE', 'MEETING_TRANSCRIPT', 'CONVERSATION_STATE'],
    sourcePriorities: { REFERENCE_FILE: 1, MEETING_TRANSCRIPT: 2 },
    profileSources: [],
    // SOURCE_FIRST, not STRICT_SOURCE_ONLY: the existing seminar contract is
    // "answer general-labeled with a visible preamble, NEVER refuse". §27.2
    // forbids hiding failures behind over-refusal, so labelling beats refusing.
    groundingPolicy: 'SOURCE_FIRST', capabilityPolicy: STRICT_DOC_CAPS,
    personalClaimsRequireEvidence: true, documentClaimsRequireEvidence: true,
    meetingClaimsRequireEvidence: true, jobClaimsRequireJdEvidence: true,
    retrievalPolicy: retrieval(24, 8), contextBudget: budget(2400, 400, 800, 200),
    citations: 'VISIBLE',
  },
};

export class UnknownModeError extends Error {
  constructor(modeId: string) {
    super(`Unknown modeId "${modeId}". Mode policy resolution FAILS CLOSED — a mode ` +
          `absent from the registry has no policy and must not fall back to mode-blind behaviour.`);
    this.name = 'UnknownModeError';
  }
}

export function isModeId(v: unknown): v is ModeId {
  return typeof v === 'string' && (MODE_IDS as readonly string[]).includes(v);
}

/**
 * Resolve a mode policy. THROWS on an unknown id.
 *
 * The legacy path fails OPEN: an unvalidated templateType yields empty note
 * sections and an empty system prompt, producing a mode that silently has no
 * instructions at all. Failing closed here is the whole point.
 */
export function resolveModePolicy(modeId: string): ModePolicy {
  if (!isModeId(modeId)) throw new UnknownModeError(modeId);
  return MODE_POLICIES[modeId];
}

/** Is this source type authorized by the mode at all? Distinct from whether it
 *  is AUTHORITATIVE for a given claim (see source-authority-policy). */
export function modeAllowsSource(policy: ModePolicy, source: SourceType): boolean {
  return policy.allowedSourceTypes.includes(source);
}

/** Modes authorize sources; they do not force them into every answer. */
export function generalKnowledgeAllowed(policy: ModePolicy): boolean {
  if (policy.groundingPolicy === 'STRICT_SOURCE_ONLY') return false;
  return policy.capabilityPolicy.useGeneralTechnicalKnowledge;
}
