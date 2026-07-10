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
  /** Real-custom-mode-repair: reference files own ambiguous nouns by default,
   *  but explicit résumé/JD/transcript switches are still allowed (unlike
   *  `reference_files_only`, which forbids them). Mirrors
   *  ModeSourceContract.sourceAuthority — see electron/services/modeSourceContract.ts. */
  | 'reference_files_primary'
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
  /**
   * Real-custom-mode-repair (2026-07-11): the mode's PERSISTED
   * ModeSourceContract.sourceAuthority (electron/services/modeSourceContract.ts),
   * when the caller has it available. When present, this is AUTHORITATIVE —
   * it replaces the legacy heuristic chain below (isDocGroundedCustomModeActive
   * + hasProfileFacts + hasLiveTranscript inference) entirely, closing the root
   * cause of the P0 contamination incident: a mode's source authority silently
   * re-derived (and could flip) on every turn from a live regex match against
   * the prompt text, defaulting to `general_mixed` (everything allowed) with no
   * user visibility whenever the regex pair didn't match. Absent → legacy
   * heuristic (backward compatible for callers that haven't been updated yet).
   */
  persistedSourceAuthority?: SourceAuthority | null;
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
    persistedSourceAuthority,
  } = input;

  // 1. Determine source authority. The PERSISTED contract (when supplied) is
  // authoritative — see persistedSourceAuthority doc comment above. This
  // replaces the legacy live-heuristic chain, which is kept ONLY as the
  // fallback for callers that haven't threaded the persisted value through yet.
  const sourceAuthority: SourceAuthority = persistedSourceAuthority ?? (() => {
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
    case 'reference_files_primary': {
      // Real-custom-mode-repair: reference files own ambiguous nouns by
      // default (evidence), but an EXPLICIT user source switch this turn
      // ("answer from my resume instead") grants that source as evidence too
      // — unlike `reference_files_only`, which is a hard prison. Without an
      // explicit switch, profile/JD/transcript stay forbidden as evidence
      // (never a silent mix), matching the seminar-mode product semantics in
      // docs/context-os/real-custom-mode-repair/05_PRODUCT_SOURCE_POLICY.md.
      allowed.add('reference_files');
      allowed.add('active_mode_pinned');
      allowed.add('custom_context');
      if (userExplicitSource === 'profile' && hasProfileFacts) {
        allowed.add('profile_resume');
        allowed.add('profile_jd');
        allowed.add('projects');
      } else {
        for (const s of PROFILE_SOURCES) forbidden.add(s);
      }
      if (userExplicitSource === 'transcript' && hasLiveTranscript) {
        allowed.add('live_transcript');
        if (hasMeetingRag) allowed.add('meeting_rag');
      } else {
        forbidden.add('live_transcript');
        forbidden.add('meeting_rag');
      }
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
  const isReferenceFilesAuthority = sourceAuthority === 'reference_files_only'
    || sourceAuthority === 'reference_files_primary'
    || sourceAuthority === 'reference_files_plus_transcript';
  const evidenceRequired = isReferenceFilesAuthority
    || isDocGroundedAnswerType(answerType);
  const evidenceNamespace: 'reference_files' | 'live_transcript' | 'all_active' =
    isReferenceFilesAuthority
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

// ── SourceContractValidator (general v2, blacklist-free) ───────────────────
//
// Custom-Mode Source Disambiguation (2026-07-06): the v1 validator hardcoded a
// per-deployment blacklist (`FORBIDDEN_PROJECT_NAMES = ['Natively', …]`) and a
// document-specific `validateMercuryControllerAnswerability` function. Those do
// not generalize to the next uploaded document or the next user's résumé.
//
// v2 replaces both with GENERAL, evidence-first mechanisms:
//   1. Numeric + list completeness — the existing generic primitives (kept).
//   2. Unsupported-ENTITY check: extract candidate proper nouns / quoted terms
//      from the answer and reject any that do NOT appear in the retrieved
//      evidence block. This catches "Natively", "Jetson", "ESP32" AND any future
//      entity with ZERO hardcoded names — a leaked entity is simply one the
//      evidence never mentions.
//   3. Forbidden first-person-source SIGNAL check (generic possessive shapes:
//      "my project", "my résumé"), fired only when the evidence lacks the same
//      shape.
//   4. Property-aware answerability: for a question asking a specific PROPERTY
//      of a target entity (processor/controller, cost, funding, cloud provider,
//      participants, dataset size, …), require the evidence to contain the
//      target entity together with a synonym of the requested property — one
//      rule that applies to EVERY entity/property, not a Mercury-specific fn.
//
// The stricter v2 behavior (entity + property checks) is gated by the
// `customModeSourceEnforcement` flag (default OFF) so it can be rolled out on
// telemetry; the generic numeric/list checks run whenever `evidenceRequired`.

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

// GENERIC first-person-source signal shapes — a doc-grounded answer that claims
// personal ownership ("my project", "my résumé", "my experience") is leaking
// from the profile source. These are SHAPES, not entity names, so they
// generalize across every deployment. Fired only when the evidence block does
// NOT itself contain the same shape.
const FORBIDDEN_SOURCE_SIGNAL_PHRASES = [
  /\bmy project\b/i,
  /\bmy resume\b/i,
  /\bmy résumé\b/i,
  /\bmy experience\b/i,
  /\bI(?:'m| am) (?:an?|the) AI assistant\b/i,
  /\bI (?:cannot|can't|can not) share (?:that|this)\b/i,
  /\bI (?:don't|do not) have (?:a|an|the|my|personal)\b/i,
];

function evidenceSentences(text: string): string[] {
  return String(text || '')
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+|(?=\[Section\s+)/)
    .map(s => s.trim())
    .filter(Boolean);
}

// ── General unsupported-ENTITY extraction ──────────────────────────────────
//
// A leaked entity is simply a proper noun / product token in the ANSWER that
// the evidence never mentions. We extract candidate entities generically:
//   - Capitalized multi-word or single-word proper nouns ("Natively", "Jetson
//     Xavier"), excluding sentence-initial common words.
//   - ALLCAPS / alphanumeric product tokens ("ESP32", "GPT-4", "RQ1").
//   - Double-quoted spans.
// Then reject any whose normalized form is absent from the evidence block. No
// entity is ever hardcoded — the evidence is the sole authority.

// Common sentence-initial / function words that are Capitalized but not entities.
const ENTITY_STOPWORDS = new Set([
  'The', 'A', 'An', 'This', 'That', 'These', 'Those', 'It', 'They', 'We', 'I',
  'In', 'On', 'For', 'To', 'Of', 'And', 'Or', 'But', 'If', 'When', 'What',
  'Which', 'How', 'Why', 'Where', 'Who', 'Phase', 'Section', 'Project', 'Page',
  'Yes', 'No', 'Your', 'My', 'Their', 'His', 'Her', 'Its', 'Our', 'Requirements',
  'Design', 'Implementation', 'Testing', 'Step', 'Stage', 'Figure', 'Table',
]);

function normalizeEntity(s: string): string {
  return s.toLowerCase().replace(/[\s\-]+/g, '').replace(/[.,;:!?)"']+$/, '');
}

/**
 * Candidate entities in `text`: proper-noun phrases + alphanumeric product
 * tokens + quoted spans. Generic — no hardcoded names.
 */
export function extractCandidateEntities(text: string): string[] {
  const out = new Set<string>();
  const t = String(text || '');
  // Proper-noun phrases: one-or-more Capitalized words, optionally with an
  // internal lowercase connector (e.g. "Bank of America"). Trim leading
  // stopword-only heads.
  for (const m of t.match(/\b[A-Z][a-zA-Z0-9]+(?:\s+(?:of|the|and)?\s*[A-Z][a-zA-Z0-9]+)*\b/g) || []) {
    const words = m.split(/\s+/);
    // Drop when EVERY word is a stopword (e.g. "The Design").
    const meaningful = words.filter(w => !ENTITY_STOPWORDS.has(w));
    if (meaningful.length === 0) continue;
    // Use the meaningful span so "In Natively" → "Natively".
    const phrase = meaningful.join(' ');
    if (phrase.length >= 3) out.add(phrase);
  }
  // Alphanumeric product/model tokens: a letter-run followed by digits, or
  // ALLCAPS+digits ("ESP32", "GPT-4", "RQ1", "X1").
  for (const m of t.match(/\b(?:[A-Z]{2,}\d+|[A-Za-z]+\d[A-Za-z0-9-]*)\b/g) || []) {
    if (m.length >= 2 && !ENTITY_STOPWORDS.has(m)) out.add(m);
  }
  // Double-quoted spans.
  for (const m of t.match(/"([^"]{2,40})"/g) || []) out.add(m.replace(/"/g, ''));
  return [...out];
}

/**
 * Entities present in the ANSWER but absent from the evidence block. These are
 * the source-leak / hallucination candidates. Generic — catches any name.
 */
export function unsupportedEntities(answer: string, retrievedBlock: string): string[] {
  const blockNorm = normalizeEntity(retrievedBlock);
  const leaks: string[] = [];
  for (const ent of extractCandidateEntities(answer)) {
    if (!blockNorm.includes(normalizeEntity(ent))) leaks.push(ent);
  }
  return leaks;
}

// ── General property-aware answerability ────────────────────────────────────
//
// For a question asking a specific PROPERTY of a target entity, require the
// evidence to contain the target entity together with a synonym of the
// requested property. One rule for every entity/property — replaces the
// Mercury-specific function.

export type RequestedProperty =
  | 'phase_or_stage'
  | 'processor_or_controller'
  | 'cost_or_price'
  | 'funding_source'
  | 'cloud_provider'
  | 'human_participants'
  | 'dataset_size'
  | 'metric_or_result'
  | 'unknown';

// Generic synonym sets per property. Extend as new property classes appear —
// these are CATEGORY synonyms, never document-specific terms.
const PROPERTY_SYNONYMS: Record<Exclude<RequestedProperty, 'unknown'>, RegExp> = {
  phase_or_stage: /\b(phase|stage|step|objective|milestone|pipeline|methodology|workflow)s?\b/i,
  processor_or_controller: /\b(processor|controller|control\s+system|controlled\s+by|compute\s+(?:unit|module)|main\s+controller|auxiliary\s+controller|mcu|soc|cpu|gpu\s+module)\b/i,
  cost_or_price: /\b(cost|price|priced|budget|expense|expenditure|\$\s?\d|usd|dollars?|euros?)\b/i,
  funding_source: /\b(funded|funding|sponsor|sponsored|grant|grants?|financed|backed\s+by|supported\s+by)\b/i,
  cloud_provider: /\b(aws|amazon\s+web\s+services|gcp|google\s+cloud|azure|cloud\s+provider|on-?prem|data\s?center)\b/i,
  human_participants: /\b(participants?|subjects?|volunteers?|respondents?|users?\s+recruited|human\s+(?:subjects|evaluators))\b/i,
  dataset_size: /\b(dataset|samples?|examples?|episodes?|rows?|records?|images?|trajectories|demonstrations?)\b/i,
  metric_or_result: /\b(accuracy|precision|recall|f1|success\s+rate|score|error\s+rate|latency|throughput|%|percent)\b/i,
};

// What PROPERTY is the question asking for? Generic classification.
export function classifyRequestedProperty(question: string): RequestedProperty {
  const q = String(question || '');
  if (/\b(phase|stage|step|objective|milestone|pipeline\s+stage)s?\b/i.test(q)) return 'phase_or_stage';
  if (/\b(processor|controller|control\s+system|controls?|compute|mcu|soc)\b/i.test(q)) return 'processor_or_controller';
  if (/\b(cost|price|budget|expensive|how\s+much\s+(?:did|does|to))\b/i.test(q)) return 'cost_or_price';
  if (/\b(funded|funding|sponsor|grant|financed|who\s+paid|who\s+funded)\b/i.test(q)) return 'funding_source';
  if (/\b(cloud\s+provider|which\s+cloud|aws|gcp|azure|hosted\s+on)\b/i.test(q)) return 'cloud_provider';
  if (/\b(participants?|subjects?|volunteers?|how\s+many\s+people)\b/i.test(q)) return 'human_participants';
  if (/\b(dataset\s+size|how\s+many\s+(?:samples|examples|episodes|images)|size\s+of\s+the\s+dataset)\b/i.test(q)) return 'dataset_size';
  return 'unknown';
}

/**
 * Extract the TARGET ENTITY the property question is about (the thing whose
 * property is asked). Generic: the first candidate entity in the question, else
 * empty (property-only questions like "who funded this research?" have no named
 * target and skip the entity co-occurrence requirement).
 */
export function extractPropertyTargetEntity(question: string): string {
  const ents = extractCandidateEntities(question);
  return ents.length > 0 ? ents[0] : '';
}

/**
 * General property-aware answerability check. Returns violation codes when the
 * evidence does not support answering the requested property for the target
 * entity. No entity or document term is hardcoded.
 */
const ANSWER_IS_REFUSAL_RE = /not (?:directly )?(?:mentioned|specified|stated|provided|included|found|available|present)|could ?n[o']t find|could not find|not in (?:the )?(?:uploaded|provided|retrieved|document)|isn'?t (?:in|mentioned|specified)|no (?:information|mention|data) (?:about|on|regarding)/i;

export function validatePropertyAnswerability(input: { question: string; answer: string; retrievedBlock: string }): string[] {
  const { question, answer, retrievedBlock } = input;
  const property = classifyRequestedProperty(question);
  if (property === 'unknown') return [];
  // An honest refusal makes NO property claim — it is the CORRECT response when
  // the evidence lacks the property. Never flag it as unanswerable.
  if (ANSWER_IS_REFUSAL_RE.test(answer)) return [];
  const synonym = PROPERTY_SYNONYMS[property];
  const violations: string[] = [];

  const targetEntity = extractPropertyTargetEntity(question);
  const sentences = evidenceSentences(retrievedBlock);

  // Does ANY evidence sentence contain the requested property synonym AND (when
  // a target entity is named) that entity? If not, the evidence cannot answer
  // the property — a confident answer would be unsupported.
  const supportingSentence = sentences.some(s => {
    if (!synonym.test(s)) return false;
    if (!targetEntity) return true; // property-only question
    return normalizeEntity(s).includes(normalizeEntity(targetEntity));
  });

  if (!supportingSentence) {
    violations.push(`property_evidence_missing:${property}`);
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

  // 2. GENERAL unsupported-entity check: any proper noun / product token in the
  //    answer that the evidence never mentions is a source leak or hallucination.
  //    Catches "Natively", "Jetson", "ESP32" AND any future entity — no hardcoded
  //    names. Gated by `customModeSourceEnforcement` (default OFF) since it is the
  //    new, broader behavior; the numeric/list checks above always run.
  const strictEnforcement = isIntelligenceFlagEnabled('customModeSourceEnforcement');
  if (strictEnforcement) {
    for (const ent of unsupportedEntities(answer, retrievedBlock)) {
      reasons.push(`unsupported_entity_in_answer: ${ent}`);
      entityLeaks.push(ent);
    }
  }

  // 3. Forbidden first-person-source SIGNAL shapes ("my project", "my résumé").
  //    Generic possessive shapes, not entity names — fired only when the
  //    evidence itself lacks the same shape.
  for (const re of FORBIDDEN_SOURCE_SIGNAL_PHRASES) {
    if (re.test(answer) && !re.test(retrievedBlock)) {
      const label = re.source.replace(/\\b/g, '').slice(0, 32);
      reasons.push(`forbidden_signal_in_answer: ${label}`);
    }
  }

  // 4. GENERAL property-aware answerability: a question asking a specific
  //    property (processor/controller, cost, funding, cloud provider,
  //    participants, dataset size, …) of a target entity requires evidence
  //    containing that entity + a property synonym. One rule for every
  //    entity/property. Gated with the entity check.
  if (strictEnforcement) {
    for (const violation of validatePropertyAnswerability({ question, answer, retrievedBlock })) {
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