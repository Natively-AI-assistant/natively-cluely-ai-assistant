// electron/intelligence/context-os/sourceKinds.ts
//
// Context OS (Phase 1) — the canonical, fine-grained SourceKind union.
//
// This is DELIBERATELY richer than the legacy
// `customModeExecutionContract.SourceKind` (15 coarse values): the Context OS
// distinguishes profile_resume vs profile_project vs profile_jd vs
// profile_persona, and prior_assistant_message vs prior_assistant_claim,
// because capability grants differ per kind. The legacy union stays untouched;
// `legacyKindsFor()` maps each canonical kind onto the legacy kind(s) so the
// two systems can be compared in shadow mode without a rewrite.

/** Every distinct thing that can inject content into a model call. */
export type SourceKind =
  | 'mode_reference_file'
  | 'mode_reference_chunk'
  | 'okf_document_card'
  | 'profile_resume'
  | 'profile_project'
  | 'profile_jd'
  | 'profile_persona'
  | 'custom_profile_notes'
  | 'okf_profile_card'
  | 'live_transcript'
  | 'meeting_rag_chunk'
  | 'prior_assistant_message'
  | 'prior_assistant_claim'
  | 'hindsight_memory'
  | 'screen_context'
  | 'browser_dom'
  | 'custom_mode_prompt'
  | 'system_instruction';

export const ALL_SOURCE_KINDS: readonly SourceKind[] = [
  'mode_reference_file',
  'mode_reference_chunk',
  'okf_document_card',
  'profile_resume',
  'profile_project',
  'profile_jd',
  'profile_persona',
  'custom_profile_notes',
  'okf_profile_card',
  'live_transcript',
  'meeting_rag_chunk',
  'prior_assistant_message',
  'prior_assistant_claim',
  'hindsight_memory',
  'screen_context',
  'browser_dom',
  'custom_mode_prompt',
  'system_instruction',
] as const;

/** The profile-family kinds (PII; forbidden wholesale in reference-file modes). */
export const PROFILE_SOURCE_KINDS: readonly SourceKind[] = [
  'profile_resume',
  'profile_project',
  'profile_jd',
  'profile_persona',
  'custom_profile_notes',
  'okf_profile_card',
] as const;

/** The reference-file/document-family kinds. */
export const REFERENCE_SOURCE_KINDS: readonly SourceKind[] = [
  'mode_reference_file',
  'mode_reference_chunk',
  'okf_document_card',
] as const;

/** The transcript/meeting-family kinds. */
export const TRANSCRIPT_SOURCE_KINDS: readonly SourceKind[] = [
  'live_transcript',
  'meeting_rag_chunk',
] as const;

/** Memory-family kinds — never evidence without validation + explicit grant. */
export const MEMORY_SOURCE_KINDS: readonly SourceKind[] = [
  'prior_assistant_message',
  'prior_assistant_claim',
  'hindsight_memory',
] as const;

/** Untrusted ambient capture kinds (OWASP: external content is data, not instructions). */
export const UNTRUSTED_CAPTURE_KINDS: readonly SourceKind[] = [
  'screen_context',
  'browser_dom',
] as const;

export function isProfileSourceKind(kind: SourceKind): boolean {
  return (PROFILE_SOURCE_KINDS as readonly string[]).includes(kind);
}

export function isMemorySourceKind(kind: SourceKind): boolean {
  return (MEMORY_SOURCE_KINDS as readonly string[]).includes(kind);
}

// ── Legacy mapping ──────────────────────────────────────────────────────────
//
// `customModeExecutionContract.SourceKind` is the 15-value union the 2026-07-06
// SourceArbiter uses. Map each canonical kind to the legacy kind(s) it refines
// so shadow-mode comparisons ("would the legacy contract have allowed this?")
// are possible without touching the legacy module.

import type { SourceKind as LegacySourceKind } from '../../llm/customModeExecutionContract';

const LEGACY_KIND_MAP: Record<SourceKind, LegacySourceKind[]> = {
  mode_reference_file: ['reference_files'],
  mode_reference_chunk: ['reference_files'],
  okf_document_card: ['reference_files'],
  profile_resume: ['profile_resume'],
  profile_project: ['projects'],
  profile_jd: ['profile_jd'],
  profile_persona: ['persona'],
  custom_profile_notes: ['custom_context'],
  okf_profile_card: ['profile_resume', 'projects'],
  live_transcript: ['live_transcript'],
  meeting_rag_chunk: ['meeting_rag'],
  prior_assistant_message: ['prior_assistant_referent'],
  prior_assistant_claim: ['prior_assistant_facts'],
  hindsight_memory: ['long_term_memory'],
  screen_context: ['screen_context'],
  browser_dom: ['screen_context'],
  custom_mode_prompt: ['active_mode_pinned', 'custom_context'],
  system_instruction: ['system_prompt_injection'],
};

/** The legacy `customModeExecutionContract.SourceKind`(s) a canonical kind refines. */
export function legacyKindsFor(kind: SourceKind): LegacySourceKind[] {
  return LEGACY_KIND_MAP[kind] ?? ['unknown'];
}
