// electron/llm/customModeExecutionContract.ts
//
// Custom-Mode Source Isolation (2026-07-06, hardening/v2.7.0).
//
// A single SourceArbiter that runs at the start of every turn and produces a
// CustomModeExecutionContract: the immutable, single-source-of-truth object
// that names which sources are allowed for THIS turn, which are forbidden,
// and which retrievers may run.
//
// Phase 4 of the migration: OBSERVE-ONLY. The arbiter logs the resolved
// contract on every turn (`[SOURCE-ARBITER]`) but does NOT yet enforce it.
// Enforcement is gated by the `customModeSourceEnforcement` intelligence flag
// (default OFF; see electron/intelligence/intelligenceFlags.ts). When that
// flag flips ON, callers that consult `isContractHonored(...)` will start
// refusing turns that violate the contract.
//
// The SourceArbiter is intentionally PURE: it takes inputs and returns a
// contract. It does not read LLMHelper state, does not touch the knowledge
// orchestrator, does not look at SessionTracker. All inputs are passed in by
// the caller (which is the IPC handler or the WTA path that already has the
// relevant context). This keeps it cheap to unit-test.

import { isIntelligenceFlagEnabled } from '../intelligence/intelligenceFlags';
import { isDocGroundedAnswerType } from './documentGroundedPrompt';

// ── Source kinds ──────────────────────────────────────────────────────────
//
// Named after the actual entry points enumerated in the entry-point audit
// (report 2026-07-06). Each kind corresponds to a real code path that can
// inject content into the model's prompt.

export type SourceKind =
  | 'reference_files'        // uploaded PDF / doc / text in the active mode
  | 'live_transcript'        // current 100s rolling transcript
  | 'screen_context'         // screen capture / page DOM
  | 'custom_context'         // user's pinned "Real-time prompt"
  | 'active_mode_pinned'     // active mode's pinned instructions
  | 'profile_resume'         // structured resume facts
  | 'profile_jd'             // structured job description facts
  | 'projects'               // structured projects (subset of profile)
  | 'long_term_memory'       // Hindsight long-term memory
  | 'meeting_rag'            // meeting RAG transcripts
  | 'persona'                // user-supplied persona prompt
  | 'prior_assistant_facts'  // prior assistant answers as factual evidence
  | 'prior_assistant_referent' // prior assistant answers for pronoun resolution only
  | 'system_prompt_injection' // mode prompt / skill prompt
  | 'unknown';

// ── Decisions ─────────────────────────────────────────────────────────────

export type SourceDecision = 'allow' | 'forbid' | 'allow_referent_only';

// ── Contract shape ────────────────────────────────────────────────────────

export interface CustomModeExecutionContract {
  contractId: string;
  buildTimestampMs: number;

  // Identity
  modeId: string;
  modeUniqueId: string | null;
  answerType: string;
  streamRoute: StreamRoute;

  // Source policy
  sourceAuthority: SourceAuthority;
  allowedSources: SourceKind[];
  forbiddenSources: SourceKind[];
  referentOnlySources: SourceKind[];

  // Evidence contract
  evidenceRequired: boolean;
  evidenceNamespace: 'reference_files' | 'live_transcript' | 'all_active';
  evidenceMinCoverage: number; // 0..1

  // Repair / regen policy
  repairable: boolean;
  repairMayBroaden: boolean;

  // Snapshot
  contractHash: string;
}

export type SourceAuthority =
  | 'reference_files_only'
  | 'profile_only'
  | 'transcript_only'
  | 'reference_files_plus_transcript'
  | 'profile_plus_transcript'
  | 'general_mixed'
  | 'ask_if_ambiguous';

export type StreamRoute =
  | 'manual_chat_stream'
  | 'phone_mirror'
  | 'wta_live'
  | 'wta_postcall'
  | 'suggestion'
  | 'rag_query'
  | 'unknown';

// ── Input ─────────────────────────────────────────────────────────────────

export interface ContractBuildInput {
  question: string;
  streamRoute: StreamRoute;
  modeId: string | null;
  modeUniqueId?: string | null;
  answerType: string | null;
  // What is the mode itself? Pass null when no active mode is loaded (mid-boot).
  isCustomMode: boolean;
  isDocGroundedCustomModeActive: boolean;
  hasReferenceFiles: boolean;
  hasCustomPrompt: boolean;
  hasLiveTranscript: boolean;
  hasProfileFacts: boolean;
  hasMeetingRag: boolean;
  hasLongTermMemory: boolean;
  // Caller may also pass the user-explicit intent for ambiguous "project" tokens.
  // When set, `project` disambiguates to that source. When unset, the contract
  // marks `sourceAuthority = 'ask_if_ambiguous'` and `evidenceRequired = false`.
  userExplicitSource?: 'reference_files' | 'profile' | 'transcript' | null;
}

// ── Construction ──────────────────────────────────────────────────────────

const PROFILE_SOURCES: SourceKind[] = [
  'profile_resume',
  'profile_jd',
  'projects',
];

const TRANSCRIPT_SOURCES: SourceKind[] = [
  'live_transcript',
  'meeting_rag',
];

const REFERENCE_SOURCES: SourceKind[] = [
  'reference_files',
  'custom_context',
  'active_mode_pinned',
];

const MEMORY_SOURCES: SourceKind[] = [
  'long_term_memory',
  'prior_assistant_facts',
];

export function buildCustomModeExecutionContract(input: ContractBuildInput): CustomModeExecutionContract {
  const {
    question,
    streamRoute,
    modeId,
    modeUniqueId = null,
    answerType,
    isCustomMode,
    isDocGroundedCustomModeActive,
    hasReferenceFiles,
    hasCustomPrompt,
    hasLiveTranscript,
    hasProfileFacts,
    hasMeetingRag,
    hasLongTermMemory,
    userExplicitSource,
  } = input;

  // 1. Determine source authority
  const sourceAuthority: SourceAuthority = (() => {
    if (isDocGroundedCustomModeActive && hasReferenceFiles) {
      return userExplicitSource === 'transcript'
        ? 'reference_files_plus_transcript'
        : 'reference_files_only';
    }
    if (isCustomMode && hasCustomPrompt && hasProfileFacts && !hasReferenceFiles) {
      return hasLiveTranscript ? 'profile_plus_transcript' : 'profile_only';
    }
    if (isCustomMode && hasCustomPrompt && !hasProfileFacts && hasLiveTranscript) {
      return 'transcript_only';
    }
    // Default: when a built-in (non-custom) mode is active or we have no
    // clear single-source policy, fall back to a permissive `general_mixed`
    // policy that downstream layers (AnswerPlanner + contextRoute) still
    // gate by per-answer-type rules. When the mode is ambiguous AND no
    // answer type info is available, mark `ask_if_ambiguous` so Phase H
    // can require explicit disambiguation.
    if (isCustomMode) {
      return 'general_mixed';
    }
    return 'ask_if_ambiguous';
  })();

  // 2. Determine allowed / forbidden / referent-only sources
  const allowed = new Set<SourceKind>();
  const forbidden = new Set<SourceKind>();
  const referentOnly = new Set<SourceKind>();

  // All contracts allow system_prompt_injection (it's how we shape the model).
  allowed.add('system_prompt_injection');

  // Persona is a user-tone preference; allowed unless we're strictly doc-grounded.
  if (!isDocGroundedCustomModeActive) {
    allowed.add('persona');
  } else {
    forbidden.add('persona');
  }

  switch (sourceAuthority) {
    case 'reference_files_only': {
      // Strict doc-grounded mode: only the uploaded material is allowed.
      allowed.add('reference_files');
      allowed.add('active_mode_pinned');
      allowed.add('custom_context'); // user's pinned prompt is allowed as INSTRUCTIONS
      // live_transcript may join IF user explicitly opted in
      if (userExplicitSource === 'transcript' && hasLiveTranscript) {
        allowed.add('live_transcript');
      } else {
        forbidden.add('live_transcript');
        forbidden.add('meeting_rag');
      }
      // Strictly forbid profile / memory / prior-assistant-facts
      for (const s of PROFILE_SOURCES) forbidden.add(s);
      for (const s of MEMORY_SOURCES) forbidden.add(s);
      forbidden.add('prior_assistant_facts');
      referentOnly.add('prior_assistant_referent'); // allow pronouns only
      break;
    }
    case 'reference_files_plus_transcript': {
      allowed.add('reference_files');
      allowed.add('active_mode_pinned');
      allowed.add('custom_context');
      if (hasLiveTranscript) allowed.add('live_transcript');
      if (hasMeetingRag) allowed.add('meeting_rag');
      for (const s of PROFILE_SOURCES) forbidden.add(s);
      for (const s of MEMORY_SOURCES) forbidden.add(s);
      forbidden.add('prior_assistant_facts');
      referentOnly.add('prior_assistant_referent');
      break;
    }
    case 'profile_only': {
      allowed.add('profile_resume');
      allowed.add('profile_jd');
      allowed.add('projects');
      allowed.add('custom_context');
      if (hasLiveTranscript) allowed.add('live_transcript');
      for (const s of MEMORY_SOURCES) forbidden.add(s);
      forbidden.add('reference_files');
      break;
    }
    case 'profile_plus_transcript': {
      allowed.add('profile_resume');
      allowed.add('profile_jd');
      allowed.add('projects');
      allowed.add('custom_context');
      if (hasLiveTranscript) allowed.add('live_transcript');
      if (hasMeetingRag) allowed.add('meeting_rag');
      for (const s of MEMORY_SOURCES) forbidden.add(s);
      break;
    }
    case 'transcript_only': {
      if (hasLiveTranscript) allowed.add('live_transcript');
      if (hasMeetingRag) allowed.add('meeting_rag');
      allowed.add('custom_context');
      for (const s of PROFILE_SOURCES) forbidden.add(s);
      for (const s of MEMORY_SOURCES) forbidden.add(s);
      forbidden.add('reference_files');
      break;
    }
    case 'general_mixed':
    case 'ask_if_ambiguous': {
      // Permissive: everything allowed, nothing forbidden; downstream layers
      // (AnswerPlanner + contextRoute) still gate by per-answer-type rules.
      for (const s of REFERENCE_SOURCES) allowed.add(s);
      for (const s of TRANSCRIPT_SOURCES) {
        if (s === 'live_transcript' && hasLiveTranscript) allowed.add(s);
        else if (s === 'meeting_rag' && hasMeetingRag) allowed.add(s);
      }
      for (const s of PROFILE_SOURCES) {
        if (hasProfileFacts) allowed.add(s);
      }
      if (hasLongTermMemory) allowed.add('long_term_memory');
      allowed.add('prior_assistant_facts'); // for non-doc-grounded, prior answers may inform
      break;
    }
  }

  // 3. Evidence contract
  const evidenceRequired = sourceAuthority === 'reference_files_only'
    || sourceAuthority === 'reference_files_plus_transcript'
    || isDocGroundedAnswerType(answerType);
  const evidenceNamespace: 'reference_files' | 'live_transcript' | 'all_active' =
    sourceAuthority === 'reference_files_only' || sourceAuthority === 'reference_files_plus_transcript'
      ? 'reference_files'
      : sourceAuthority === 'transcript_only' || sourceAuthority === 'profile_plus_transcript'
        ? 'live_transcript'
        : 'all_active';
  const evidenceMinCoverage = evidenceRequired ? 0.5 : 0.0;

  // 4. Repair policy
  const repairable = evidenceRequired && sourceAuthority !== 'ask_if_ambiguous';
  const repairMayBroaden = false; // regen may only broaden INSIDE allowedSources

  const contractId = `contract_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const buildTimestampMs = Date.now();

  const base = {
    contractId,
    buildTimestampMs,
    modeId: modeId ?? 'no-mode',
    modeUniqueId,
    answerType: answerType ?? 'unknown',
    streamRoute,
    sourceAuthority,
    allowedSources: Array.from(allowed).sort(),
    forbiddenSources: Array.from(forbidden).sort(),
    referentOnlySources: Array.from(referentOnly).sort(),
    evidenceRequired,
    evidenceNamespace,
    evidenceMinCoverage,
    repairable,
    repairMayBroaden,
    contractHash: '',
  };
  const contractHash = hashContract(base);
  return { ...base, contractHash };
}

function hashContract(c: Omit<CustomModeExecutionContract, 'contractHash'>): string {
  // Stable, content-only hash. crypto is optional in this file — fall back to
  // a deterministic djb2 if unavailable (the bundled build typically has it,
  // but tests under ELECTRON_RUN_AS_NODE may not).
  const payload = JSON.stringify({
    modeId: c.modeId,
    answerType: c.answerType,
    sourceAuthority: c.sourceAuthority,
    allowedSources: c.allowedSources,
    forbiddenSources: c.forbiddenSources,
    evidenceRequired: c.evidenceRequired,
    evidenceNamespace: c.evidenceNamespace,
  });
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const crypto = require('crypto') as typeof import('crypto');
    return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
  } catch {
    // djb2
    let h = 5381;
    for (let i = 0; i < payload.length; i++) h = ((h << 5) + h) ^ payload.charCodeAt(i);
    return `djb2_${(h >>> 0).toString(16)}`;
  }
}

// ── Observer logging ──────────────────────────────────────────────────────
//
// Phase 4 behavior: emit a single `[SOURCE-ARBITER]` line on every turn when
// the trace flag is on. Pure observability — no enforcement. When enforcement
// flips ON (Phase H), callers should consult `isContractHonored(...)` first.

export function logArbitratedContract(contract: CustomModeExecutionContract, question?: string): void {
  if (!isIntelligenceFlagEnabled('trace')) return;
  const summary = {
    contractId: contract.contractId,
    contractHash: contract.contractHash,
    modeId: contract.modeId,
    answerType: contract.answerType,
    streamRoute: contract.streamRoute,
    sourceAuthority: contract.sourceAuthority,
    allowedSources: contract.allowedSources,
    forbiddenSources: contract.forbiddenSources,
    referentOnlySources: contract.referentOnlySources,
    evidenceRequired: contract.evidenceRequired,
    evidenceNamespace: contract.evidenceNamespace,
    evidenceMinCoverage: contract.evidenceMinCoverage,
    repairable: contract.repairable,
    questionSnippet: (question ?? '').trim().slice(0, 80),
  };
  console.log('[SOURCE-ARBITER]', JSON.stringify(summary));
}

// ── Phase-H enforcement helper ────────────────────────────────────────────
//
// Used by downstream layers to decide "did this turn respect the contract?".
// Returns `null` when honored, or a string explaining the violation. Callers
// gate this on `isIntelligenceFlagEnabled('customModeSourceEnforcement')`.

export interface ContractCheckInput {
  contract: CustomModeExecutionContract;
  evidenceItems: Array<{ itemId: string; sourceKind: SourceKind }>;
  emittedAnswer: string;
}

export function isContractHonored(check: ContractCheckInput): { honored: true } | { honored: false; reason: string } {
  const { contract, evidenceItems } = check;
  const allowedSet = new Set(contract.allowedSources);
  // Each evidence item's sourceKind must be in allowedSources. Forbidden sources
  // being cited is a violation.
  const violatingItems = evidenceItems.filter(e => !allowedSet.has(e.sourceKind));
  if (violatingItems.length > 0) {
    const kinds = Array.from(new Set(violatingItems.map(v => v.sourceKind))).join(', ');
    return { honored: false, reason: `cited_forbidden_sources: ${kinds}` };
  }
  return { honored: true };
}

// ── SourceContractValidator (light v1) ────────────────────────────────────
//
// Phase 5 of the migration: a thin wrapper that runs the four light checks
// (unsupported entity, unsupported number, forbidden-source signal, list
// completeness) against the CustomModeExecutionContract. Wraps the existing
// `validateDocumentGroundedAnswer` for the numeric + list checks, and adds a
// new entity-leak check that catches the observed "Natively" / "my project"
// / "my resume" contamination in doc-grounded answers.
//
// Custom-Mode Source Isolation (2026-07-06, hardening/v2.7.0):
// The four checks are intentionally narrow — we only add things the existing
// production dataset has proven broken. Phase 5 ships these; Phase E of the
// wider migration expands to 10 checks once we have telemetry on v1.

import {
  validateDocumentGroundedAnswer,
  detectUnsupportedDocumentAnswer,
  detectIncompleteListAnswer,
} from './documentGroundedPrompt';

export interface SourceContractValidatorInput {
  contract: CustomModeExecutionContract;
  question: string;
  answer: string;
  retrievedBlock: string;
}

export interface SourceContractValidatorResult {
  ok: boolean;
  action: 'ship' | 'retry' | 'refuse';
  reason: string;
  reasons: string[];
  unsupportedTokens: string[];
  listMissing: string[];
  entityLeaks: string[];
  answerabilityViolations: string[];
}

// Forbidden-source signal phrases — when the answer contains one of these AND
// the retrieved evidence does not, the answer is leaking from a forbidden
// source. Tuned to the observed failures (Natively identity leak + generic
// project/meta leaks). Add more if new leaks appear in production telemetry.
const FORBIDDEN_SOURCE_SIGNAL_PHRASES = [
  /\bmy project\b/i,
  /\bmy resume\b/i,
  /\bmy experience\b/i,
  /\bI(?:'m| am) (?:an?|the) AI assistant\b/i,
  /\bI (?:cannot|can't|can not) share (?:that|this)\b/i,
  /\bI (?:don't|do not) have (?:a|an|the|my|personal)\b/i,
];

const FORBIDDEN_PROJECT_NAMES = [
  'Natively',
  'TalentScope',
  'agenticVLA',
  'Phlo',
];

const MERCURY_CONTROLLER_QUERY_RE = /\bmercury\s*x1\b/i;
const CONTROLLER_PROPERTY_QUERY_RE = /\b(?:processor|controller|control\s+system|controls?|main\s+controller|auxiliary\s+controller)\b/i;
const ESP32_ANSWER_RE = /\bESP32\b/i;
const XAVIER_NX_ANSWER_RE = /\bXavier\s+NX\b/i;
const MERCURY_CONTROLLER_SUPPORT_RE = /\bmercury\s*x1\b[\s\S]{0,220}\b(?:control\s+system|main\s+controller|auxiliary\s+controller|controlled\s+by|uses?\s+(?:an?\s+)?(?:NVIDIA\s+)?Jetson)\b|\b(?:control\s+system|main\s+controller|auxiliary\s+controller|controlled\s+by|uses?\s+(?:an?\s+)?(?:NVIDIA\s+)?Jetson)\b[\s\S]{0,220}\bmercury\s*x1\b/i;
const MERCURY_EXPECTED_CONTROLLER_RE = /\bJetson\s+Xavier\b/i;
const MERCURY_EXPECTED_AUX_RE = /\bJetson\s+Nano\b/i;
const ESP32_LOW_LEVEL_ONLY_RE = /\bESP32\b[\s\S]{0,180}\b(?:motor\s+control|low-level\s+motor|communication\s+board|motor\s+control\s+board)\b|\b(?:motor\s+control|low-level\s+motor|communication\s+board|motor\s+control\s+board)\b[\s\S]{0,180}\bESP32\b/i;
const CONTROLLER_SUPPORT_SENTENCE_RE = /\b(?:main\s+controller|auxiliary\s+controller|processor|controls?\s+(?:the\s+)?Mercury\s*X1|controlled\s+by|control\s+system)\b/i;

function evidenceSentences(text: string): string[] {
  return String(text || '')
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+|(?=\[Section\s+)/)
    .map(s => s.trim())
    .filter(Boolean);
}

function evidenceSentenceSupportsEntityAsController(retrievedBlock: string, entityRe: RegExp): boolean {
  return evidenceSentences(retrievedBlock).some(sentence => entityRe.test(sentence) && CONTROLLER_SUPPORT_SENTENCE_RE.test(sentence));
}

export function isMercuryControllerQuestion(question: string): boolean {
  return MERCURY_CONTROLLER_QUERY_RE.test(question) && CONTROLLER_PROPERTY_QUERY_RE.test(question);
}

function validateMercuryControllerAnswerability(input: { question: string; answer: string; retrievedBlock: string }): string[] {
  const { question, answer, retrievedBlock } = input;
  if (!isMercuryControllerQuestion(question)) return [];

  const violations: string[] = [];
  const evidenceSupportsController = MERCURY_CONTROLLER_SUPPORT_RE.test(retrievedBlock)
    && MERCURY_EXPECTED_CONTROLLER_RE.test(retrievedBlock)
    && MERCURY_EXPECTED_AUX_RE.test(retrievedBlock);

  if (!evidenceSupportsController) {
    violations.push('mercury_controller_evidence_missing_main_auxiliary_support');
  }

  if (XAVIER_NX_ANSWER_RE.test(answer) && !evidenceSentenceSupportsEntityAsController(retrievedBlock, /\bXavier\s+NX\b/i)) {
    violations.push('mercury_controller_unsupported_xavier_nx');
  }

  if (ESP32_ANSWER_RE.test(answer)) {
    const answerSentencesWithEsp32 = evidenceSentences(answer).filter(sentence => /\bESP32\b/i.test(sentence));
    const esp32PresentedAsController = answerSentencesWithEsp32.some(sentence => CONTROLLER_SUPPORT_SENTENCE_RE.test(sentence));
    const explicitlyController = evidenceSentenceSupportsEntityAsController(retrievedBlock, /\bESP32\b/i);
    const lowLevelOnly = evidenceSentences(retrievedBlock).some(sentence => /\bESP32\b/i.test(sentence) && ESP32_LOW_LEVEL_ONLY_RE.test(sentence));
    if (esp32PresentedAsController && (!explicitlyController || lowLevelOnly)) {
      violations.push('mercury_controller_esp32_only_low_level_motor_control');
    }
  }

  if (!MERCURY_EXPECTED_CONTROLLER_RE.test(answer) || !MERCURY_EXPECTED_AUX_RE.test(answer)) {
    violations.push('mercury_controller_answer_missing_xavier_or_nano');
  }

  return violations;
}

export function validateAgainstSourceContract(input: SourceContractValidatorInput): SourceContractValidatorResult {
  const { contract, question, answer, retrievedBlock } = input;
  const reasons: string[] = [];
  const unsupportedTokens: string[] = [];
  const listMissing: string[] = [];
  const entityLeaks: string[] = [];
  const answerabilityViolations: string[] = [];

  // If the contract isn't asking for evidence-based answers, nothing to validate.
  if (!contract.evidenceRequired) {
    return { ok: true, action: 'ship', reason: 'no_evidence_required', reasons: [], unsupportedTokens: [], listMissing: [], entityLeaks: [], answerabilityViolations: [] };
  }

  // 1. Existing numeric + list completeness (re-uses the tested primitives)
  const numericCheck = detectUnsupportedDocumentAnswer({ answer, retrievedBlock });
  if (numericCheck.unsupported) {
    reasons.push(`unsupported_numeric_value: ${numericCheck.unsupportedTokens.join(', ')}`);
    unsupportedTokens.push(...numericCheck.unsupportedTokens);
  }

  const listCheck = detectIncompleteListAnswer({ question, answer, retrievedBlock, answerIsRefusal: false });
  if (listCheck.incomplete) {
    reasons.push(`incomplete_list_answer: ${listCheck.missing.join(', ')}`);
    listMissing.push(...listCheck.missing);
  }

  // 2. Entity-leak check: forbidden source names appearing in the answer that
  //    don't appear in the retrieved block. This is the [Natively] leak the
  //    user observed.
  const blockLower = retrievedBlock.toLowerCase();
  for (const name of FORBIDDEN_PROJECT_NAMES) {
    const nameLower = name.toLowerCase();
    if (answer.includes(name) && !blockLower.includes(nameLower)) {
      reasons.push(`forbidden_entity_in_answer: ${name}`);
      entityLeaks.push(name);
    }
  }

  // 3. Forbidden-source signal phrases
  for (const re of FORBIDDEN_SOURCE_SIGNAL_PHRASES) {
    if (re.test(answer) && !re.test(retrievedBlock)) {
      const label = re.source.replace(/\\b/g, '').slice(0, 32);
      reasons.push(`forbidden_signal_in_answer: ${label}`);
    }
  }

  // 4. Property-specific answerability: controller/processor questions need
  //    controller evidence, not merely any sentence mentioning Mercury X1 + ESP32.
  const mercuryControllerViolations = validateMercuryControllerAnswerability({ question, answer, retrievedBlock });
  if (mercuryControllerViolations.length > 0) {
    for (const violation of mercuryControllerViolations) {
      reasons.push(violation);
      answerabilityViolations.push(violation);
    }
  }

  // 5. Delegate to the canonical validator for the greeting/refusal coverage
  //    that the post-stream IPC handler already wires in.
  const base = validateDocumentGroundedAnswer({
    question,
    answer,
    retrievedBlock,
    answerType: contract.answerType,
  });
  if (!base.ok && base.action !== 'ship') {
    reasons.push(base.reason);
  }

  if (reasons.length === 0) {
    return { ok: true, action: 'ship', reason: 'ok', reasons: [], unsupportedTokens: [], listMissing: [], entityLeaks: [], answerabilityViolations: [] };
  }

  const action: 'ship' | 'retry' | 'refuse' = contract.repairable
    ? 'retry'
    : 'refuse';

  return {
    ok: false,
    action,
    reason: reasons.join('; '),
    reasons,
    unsupportedTokens,
    listMissing,
    entityLeaks,
    answerabilityViolations,
  };
}