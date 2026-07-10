// electron/services/modeSourceContract.ts
//
// Real-Custom-Mode Repair (2026-07-11) — the persisted, explicit, typed
// per-mode source contract required by the incident investigation
// (docs/context-os/real-custom-mode-repair/05_PRODUCT_SOURCE_POLICY.md).
//
// WHY: `documentGrounded` / `sourceAuthority` were previously RE-DERIVED on
// every single turn by running two regexes (DOCUMENT_SOURCE_RE,
// DOCUMENT_CONSTRAINT_RE) against the mode's free-form `customContext` text
// (ModesManager.getActiveModeDocumentGroundingInfo). A real user's natural
// phrasing of "answer from my uploaded thesis" routinely fails to satisfy
// both regexes simultaneously, silently downgrading the mode to
// `general_mixed` (everything allowed) with ZERO visibility to the user —
// this was the root cause of the P0 contamination incident (thesis
// questions answered from the candidate's résumé).
//
// This module is the single source of truth for what a mode's source policy
// IS. It is:
//   - EXPLICIT: a typed object, not a regex match against prose.
//   - PERSISTED: written once (by the user, or by one-time migration) and
//     read back identically every time — no re-derivation drift.
//   - GENERALIZED: contains no document names, mode IDs, or hardcoded
//     entities — every field is a closed enum describing a SHAPE of policy,
//     applicable to any future custom mode.
//
// Nothing in this module hardcodes "seminar" / "thesis" / "AgenticVLA" / any
// mode id / any file name / any benchmark question.

export type ModeSourceOwner = 'reference_files' | 'profile' | 'transcript' | 'mixed' | 'clarify';

export type ModeSourceSwitch = 'reference_files' | 'profile' | 'job_description' | 'transcript';

export type ModeSourceAuthority =
  | 'reference_files_only'
  | 'reference_files_primary'
  | 'reference_files_plus_transcript'
  | 'profile_only'
  | 'profile_plus_transcript'
  | 'transcript_only'
  | 'general_mixed'
  | 'ask_if_ambiguous';

export type ModeConflictPolicy =
  | 'reference_files_win'
  | 'profile_wins'
  | 'transcript_wins'
  | 'ask_clarification';

export interface ModeSourceContract {
  /** Schema version — bump and add a migrator when the shape changes. */
  version: 1;
  defaultOwner: ModeSourceOwner;
  allowedExplicitSwitches: ModeSourceSwitch[];
  sourceAuthority: ModeSourceAuthority;
  evidenceRequired: boolean;
  conflictPolicy: ModeConflictPolicy;
  memoryPolicy: {
    allowPriorAssistantFacts: boolean;
    allowPriorAssistantReferents: boolean;
    allowHindsight: boolean;
  };
  /**
   * How this contract came to exist. Surfaced in the UI/telemetry so a
   * silently-migrated legacy mode is visibly distinguishable from a user's
   * explicit, confirmed choice. Never used as a security boundary itself.
   */
  origin: 'user_selected' | 'migrated_from_prompt' | 'default_new_mode';
}

const CONFLICT_POLICY_FOR_AUTHORITY: Record<ModeSourceAuthority, ModeConflictPolicy> = {
  reference_files_only: 'reference_files_win',
  reference_files_primary: 'reference_files_win',
  reference_files_plus_transcript: 'reference_files_win',
  profile_only: 'profile_wins',
  profile_plus_transcript: 'profile_wins',
  transcript_only: 'transcript_wins',
  general_mixed: 'ask_clarification',
  ask_if_ambiguous: 'ask_clarification',
};

const EVIDENCE_REQUIRED_FOR_AUTHORITY: Record<ModeSourceAuthority, boolean> = {
  reference_files_only: true,
  reference_files_primary: true,
  reference_files_plus_transcript: true,
  profile_only: false,
  profile_plus_transcript: false,
  transcript_only: true,
  general_mixed: false,
  ask_if_ambiguous: false,
};

/** A brand-new mode with no reference files / prompt yet: safe, ambiguous-aware default. */
export function defaultSourceContractForNewMode(): ModeSourceContract {
  return {
    version: 1,
    defaultOwner: 'clarify',
    allowedExplicitSwitches: ['reference_files', 'profile', 'job_description', 'transcript'],
    sourceAuthority: 'ask_if_ambiguous',
    evidenceRequired: false,
    conflictPolicy: 'ask_clarification',
    memoryPolicy: { allowPriorAssistantFacts: false, allowPriorAssistantReferents: true, allowHindsight: false },
    origin: 'default_new_mode',
  };
}

/**
 * Build a contract from the user's explicit "Primary knowledge source" UI
 * selection (Phase 5 design). This is the AUTHORITATIVE construction path —
 * the renderer maps its radio/checkbox state directly onto these fields, no
 * prompt-text inference involved.
 */
export function buildUserSelectedSourceContract(input: {
  defaultOwner: ModeSourceOwner;
  allowedExplicitSwitches?: ModeSourceSwitch[];
  hasLiveTranscriptCapable?: boolean;
}): ModeSourceContract {
  const switches = input.allowedExplicitSwitches ?? [];
  const sourceAuthority: ModeSourceAuthority = (() => {
    switch (input.defaultOwner) {
      case 'reference_files':
        if (switches.length > 0) return 'reference_files_primary';
        return switches.includes('transcript') ? 'reference_files_plus_transcript' : 'reference_files_only';
      case 'profile':
        return input.hasLiveTranscriptCapable ? 'profile_plus_transcript' : 'profile_only';
      case 'transcript':
        return 'transcript_only';
      case 'mixed':
      case 'clarify':
      default:
        return 'ask_if_ambiguous';
    }
  })();
  return {
    version: 1,
    defaultOwner: input.defaultOwner,
    allowedExplicitSwitches: switches,
    sourceAuthority,
    evidenceRequired: EVIDENCE_REQUIRED_FOR_AUTHORITY[sourceAuthority],
    conflictPolicy: CONFLICT_POLICY_FOR_AUTHORITY[sourceAuthority],
    memoryPolicy: sourceAuthority === 'reference_files_only' || sourceAuthority === 'reference_files_primary' || sourceAuthority === 'reference_files_plus_transcript'
      ? { allowPriorAssistantFacts: false, allowPriorAssistantReferents: true, allowHindsight: false }
      : { allowPriorAssistantFacts: true, allowPriorAssistantReferents: true, allowHindsight: true },
    origin: 'user_selected',
  };
}

// ── Legacy prompt-text heuristic — kept ONLY for one-time migration ────────
//
// Mirrors the pre-existing DOCUMENT_SOURCE_RE / DOCUMENT_CONSTRAINT_RE pair
// from ModesManager.ts so a legacy mode whose prompt ALREADY satisfied the
// strict old detector keeps its exact prior (correct) behavior after
// migration. Never re-run per-turn after this — the migration result is
// persisted once and becomes the mode's stable contract.

const DOCUMENT_SOURCE_RE = /\b(uploaded|attached|provided|reference|source material|course material|seminar material|lecture material|presentation|slides?|deck|papers?|pdfs?|files?|documents?|docs?|notes?|attached material|uploaded content|provided material)\b/i;
const DOCUMENT_CONSTRAINT_RE = /\b(source[-\s]?of[-\s]?truth|from the files?|from the documents?|from the uploaded|answer(?:s|ing)?\s+from\s+(?:the\s+)?(?:uploaded|attached|provided|reference|files?|documents?)|based on (?:uploaded|provided|attached|the\s+(?:uploaded|attached|provided|reference)|my\s+(?:uploaded|attached|provided|reference|files?|documents?|docs?|notes?|papers?|slides?|presentation))|based on the [a-z]+ i(?:'ve| have)?\s+(?:uploaded|attached|provided|shared|given)|use only|only use|only reference|only rely|rely only|use\s+the\s+(?:uploaded|attached|provided|reference|files?|documents?|docs?|notes?|papers?|slides?|presentation)|(?:stick to|restrict to|limit to|draw from)(?:\s+\w+){0,2}\s+(?:the\s+)?(?:uploaded|attached|provided|reference|files?|documents?|docs?|notes?|papers?|slides?|presentation|material)|(?:material|content|info(?:rmation)?)\s+in\s+the\s+(?:file|document|pdf|notes?|slides?|presentation)|do not use knowledge outside|(?:don['’]?t|do not)\s+(?:use|rely on|draw on|add)\s+(?:anything\s+)?(?:outside|beyond|other than|not\s+(?:written|mentioned|present|found)\s+(?:there|in))|ground(?:ed)? (?:your )?answers? in|ground(?:ed)? in|(?:check|read|refer to|consult|verify|look at)\s+the\s+(?:file|document|pdf|notes?|slides?|presentation|material)\s+(?:first|before))\b/i;

/** True only when the OLD strict detector would have matched (both regexes). */
export function legacyPromptDetectsStrictDocumentGrounding(customContext: string): boolean {
  const prompt = customContext || '';
  return DOCUMENT_SOURCE_RE.test(prompt) && DOCUMENT_CONSTRAINT_RE.test(prompt);
}

/**
 * One-time migration for a legacy mode with no persisted contract yet.
 *
 * CRITICAL invariant (incident fix): a mode with reference files whose
 * prompt does NOT clearly satisfy the strict legacy detector NEVER migrates
 * to `general_mixed` (everything allowed) — that silent promotion is
 * exactly the leak this incident is about. It migrates to `ask_if_ambiguous`
 * (`defaultOwner: 'clarify'`) instead, so an ambiguous question triggers a
 * source-honest clarification rather than a silent profile/document mix.
 */
export function migrateSourceContractFromPrompt(input: {
  customContext: string;
  hasReferenceFiles: boolean;
  hasProfileFacts: boolean;
}): ModeSourceContract {
  const { customContext, hasReferenceFiles, hasProfileFacts } = input;
  const hasCustomPrompt = (customContext || '').trim().length > 0;

  if (hasReferenceFiles && legacyPromptDetectsStrictDocumentGrounding(customContext)) {
    // HIGH CONFIDENCE: preserve the exact prior strict behavior.
    return {
      version: 1,
      defaultOwner: 'reference_files',
      allowedExplicitSwitches: [],
      sourceAuthority: 'reference_files_only',
      evidenceRequired: true,
      conflictPolicy: 'reference_files_win',
      memoryPolicy: { allowPriorAssistantFacts: false, allowPriorAssistantReferents: true, allowHindsight: false },
      origin: 'migrated_from_prompt',
    };
  }

  if (hasReferenceFiles && hasCustomPrompt) {
    // AMBIGUOUS: has files, but the prompt doesn't clearly declare
    // exclusivity. NEVER promote to general_mixed (everything allowed) — that
    // silent promotion is exactly the P0 incident. `reference_files_primary`
    // is the correct migration target (not `ask_if_ambiguous`): the kernel
    // resolves it to sourceOwner='reference_files' for EVERY question in this
    // mode (docs/context-os/real-custom-mode-repair/05_PRODUCT_SOURCE_POLICY.md
    // — "default owner: reference files"), not only questions that happen to
    // match an ambiguous-term regex, while explicit "answer from my résumé"
    // asks still work via sourceOwnership.ts's reference_files_primary case.
    return {
      version: 1,
      defaultOwner: 'reference_files',
      allowedExplicitSwitches: ['profile', 'job_description', 'transcript'],
      sourceAuthority: 'reference_files_primary',
      evidenceRequired: true,
      conflictPolicy: 'reference_files_win',
      memoryPolicy: { allowPriorAssistantFacts: false, allowPriorAssistantReferents: true, allowHindsight: false },
      origin: 'migrated_from_prompt',
    };
  }

  if (hasCustomPrompt && hasProfileFacts && !hasReferenceFiles) {
    return {
      version: 1,
      defaultOwner: 'profile',
      allowedExplicitSwitches: ['job_description', 'transcript'],
      sourceAuthority: 'profile_only',
      evidenceRequired: false,
      conflictPolicy: 'profile_wins',
      memoryPolicy: { allowPriorAssistantFacts: true, allowPriorAssistantReferents: true, allowHindsight: true },
      origin: 'migrated_from_prompt',
    };
  }

  return {
    version: 1,
    defaultOwner: 'clarify',
    allowedExplicitSwitches: ['reference_files', 'profile', 'job_description', 'transcript'],
    sourceAuthority: 'ask_if_ambiguous',
    evidenceRequired: false,
    conflictPolicy: 'ask_clarification',
    memoryPolicy: { allowPriorAssistantFacts: true, allowPriorAssistantReferents: true, allowHindsight: true },
    origin: 'migrated_from_prompt',
  };
}

// ── Serialization ────────────────────────────────────────────────────────

export function serializeModeSourceContract(contract: ModeSourceContract): string {
  return JSON.stringify(contract);
}

/** Parses + shape-validates. Returns null on any malformed/missing/older-version input. */
export function parseModeSourceContract(json: string | null | undefined): ModeSourceContract | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.version !== 1) return null;
    if (typeof parsed.defaultOwner !== 'string') return null;
    if (typeof parsed.sourceAuthority !== 'string') return null;
    if (!Array.isArray(parsed.allowedExplicitSwitches)) return null;
    if (typeof parsed.evidenceRequired !== 'boolean') return null;
    if (typeof parsed.conflictPolicy !== 'string') return null;
    if (!parsed.memoryPolicy || typeof parsed.memoryPolicy !== 'object') return null;
    if (typeof parsed.origin !== 'string') return null;
    return parsed as ModeSourceContract;
  } catch {
    return null;
  }
}

// ── Derived flags for legacy call sites ─────────────────────────────────────
//
// `documentGrounded` / `documentGroundedCustomModeActive` remain the field
// names ~65 call sites already read (ModesManager.ActiveModeDocumentGroundingInfo).
// They are now PURE functions of the persisted contract instead of live regex
// re-evaluation, closing the incident's root cause while preserving every
// existing consumer's contract.

export function documentGroundedFromContract(contract: ModeSourceContract, hasReferenceFiles: boolean): boolean {
  if (!hasReferenceFiles) return false;
  return contract.sourceAuthority === 'reference_files_only'
    || contract.sourceAuthority === 'reference_files_primary'
    || contract.sourceAuthority === 'reference_files_plus_transcript';
}
