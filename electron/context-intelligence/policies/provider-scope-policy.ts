// electron/context-intelligence/policies/provider-scope-policy.ts
//
// Outbound provider-data-scope enforcement for Context Intelligence V3.
//
// WHY THIS EXISTS
// Settings > AI Providers > Privacy offers six "Cloud provider data scopes"
// toggles. Before this module the enforcement lived entirely in LLMHelper and
// keyed off LEGACY prompt tags (`<reference_file>`, `<candidate_…>`,
// `<meeting_history>`). V3 packs every source as
// `<evidence … source_type="…">`, so a V3-composed prompt matched none of them:
// no scope was ever inferred, nothing was ever withheld, and the
// "[ScopeFallback] … omitting from context" log line asserted a removal that
// never happened.
//
// The fix has to happen HERE, before packContext, not at the transport. The
// composer writes its instructions against the evidence set it is given — the
// checked-absence contract, the precedence contract, the "no evidence" wording.
// Stripping evidence downstream of the composer leaves a prompt whose
// instructions describe material the model can no longer see, which is a
// fabrication engine in a repository with this fabrication history. Filter
// first, compose against what survived.
//
// NEVER CACHE THE POLICY. esbuild inlines every module into each entry bundle
// (see scripts/build-electron.js: every .ts is an entry point), so a cached
// policy would go stale in every bundle except the one that wrote it — the
// exact trap that caused the 2026-07-31 cross-mode retrieval defect.
// SettingsManager itself is anchored on globalThis, so the live read below is
// one truth across all bundles.

import type { EvidenceItem, SourceType } from '../contracts/types';
import type { ProviderDataScope, ProviderDataScopePolicy } from '../../llm/ProviderRouter';

/**
 * SourceType → the privacy toggle that governs sending it to a cloud provider.
 *
 * Continuity with the pre-V3 meaning of each toggle is the tie-breaker: the
 * legacy inference mapped `<candidate_*>` / `<user_context>` / `<meeting_history>`
 * to profile_history and `<reference_file>` to reference_files, so résumé and
 * profile facts stay on profile_history and uploaded documents stay on
 * reference_files. A user must be able to predict what a toggle does from its
 * label; a source type therefore maps to exactly ONE scope. (A "withhold if ANY
 * related scope is denied" fan-out was considered and rejected: it would make
 * reference_files=off silently disable the Profile Intelligence résumé, which
 * no user could predict from the UI.)
 *
 * JOB_DESCRIPTION is the one genuinely unsettled entry — legacy emitted it as
 * `<target_job_evidence>`, which NO legacy pattern matched, so there is no
 * continuity to preserve. It is filed under reference_files because it is an
 * uploaded document describing an external role, not the user's own history.
 *
 * Two scopes have no member here on purpose:
 *   • post_call_summary — produced by MeetingPersistence, never V3 evidence.
 *   • embeddings        — a retrieval-time concern (EmbeddingProviderResolver),
 *                         not a payload class.
 */
export const SOURCE_TYPE_DATA_SCOPE: Readonly<Record<SourceType, ProviderDataScope>> = Object.freeze({
  RESUME: 'profile_history',
  PROFILE_FACT: 'profile_history',
  JOB_DESCRIPTION: 'reference_files',
  REFERENCE_FILE: 'reference_files',
  PROJECT_FILE: 'reference_files',
  CODING_SAMPLE: 'reference_files',
  CANDIDATE_FILE: 'reference_files',
  MEETING_TRANSCRIPT: 'transcript',
  CONVERSATION_STATE: 'transcript',
  SCREEN_CONTEXT: 'screenshots',
});

export function dataScopeForSourceType(sourceType: string): ProviderDataScope | undefined {
  return (SOURCE_TYPE_DATA_SCOPE as Record<string, ProviderDataScope | undefined>)[sourceType];
}

/** Every SourceType governed by the given scopes. Used by the transport-layer
 *  backstop to decide which `<evidence>` blocks a denial removes. */
export function sourceTypesForScopes(scopes: readonly ProviderDataScope[]): Set<string> {
  const wanted = new Set<string>(scopes);
  const out = new Set<string>();
  for (const [sourceType, scope] of Object.entries(SOURCE_TYPE_DATA_SCOPE)) {
    if (wanted.has(scope)) out.add(sourceType);
  }
  return out;
}

/**
 * Deny-only environment override, e.g.
 *   NATIVELY_DENY_PROVIDER_SCOPES=transcript,reference_files
 *
 * It can only ADD denials on top of the stored policy — it can never grant a
 * scope the user switched off. That direction is deliberate: a loosening
 * override would be a privacy bypass reachable from the launch environment,
 * whereas a tightening one is a kill switch (and the only way to exercise the
 * real enforcement path end to end in a test, since the settings store needs a
 * live Electron app).
 */
export const DENY_PROVIDER_SCOPES_ENV = 'NATIVELY_DENY_PROVIDER_SCOPES';

const ALL_SCOPES: readonly ProviderDataScope[] = [
  'transcript', 'screenshots', 'reference_files', 'profile_history', 'embeddings', 'post_call_summary',
];

export function parseDeniedScopesEnv(raw: unknown): ProviderDataScope[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const wanted = new Set(raw.split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean));
  return ALL_SCOPES.filter((s) => wanted.has(s));
}

/**
 * Merge the deny-only env override into a stored policy. Monotonic: a scope
 * that is false stays false; a scope named by the env becomes false.
 */
export function applyEnvScopeDenials(
  policy: ProviderDataScopePolicy | undefined,
  envValue: unknown,
): ProviderDataScopePolicy | undefined {
  const denied = parseDeniedScopesEnv(envValue);
  if (denied.length === 0) return policy;
  const merged: ProviderDataScopePolicy = { ...(policy ?? {}) };
  for (const scope of denied) merged[scope] = false;
  return merged;
}

/**
 * The live policy. Read per turn — never memoised anywhere (see file header).
 * Returns undefined when the store is unavailable, which means "no policy
 * recorded" and therefore everything allowed: identical to the pre-existing
 * LLMHelper.getProviderScopePolicy() behaviour, so a settings-read failure
 * cannot silently start withholding evidence either.
 */
export function readProviderScopePolicy(): ProviderDataScopePolicy | undefined {
  let stored: ProviderDataScopePolicy | undefined;
  try {
    const { SettingsManager } = require('../../services/SettingsManager');
    stored = SettingsManager.getInstance().get('providerDataScopes');
  } catch {
    stored = undefined;
  }
  return applyEnvScopeDenials(stored, process.env[DENY_PROVIDER_SCOPES_ENV]);
}

export function isScopeDenied(scope: ProviderDataScope, policy?: ProviderDataScopePolicy): boolean {
  return policy?.[scope] === false;
}

export interface EvidenceScopeFilterResult {
  /** Evidence the policy permits to leave the process. */
  evidence: EvidenceItem[];
  /** Scopes that actually caused something to be withheld this turn. */
  withheldScopes: ProviderDataScope[];
  /** How many evidence items were withheld. */
  withheldCount: number;
}

/**
 * Drop every evidence item whose source type belongs to a denied scope.
 *
 * An unmapped source type is NOT withheld: the map is exhaustive over
 * SourceType today, and failing closed on an unknown future member would make
 * adding one silently delete evidence. It IS covered by the compile-time
 * Record<SourceType, …> above, which fails the build instead.
 */
export function filterEvidenceByProviderScopes(
  evidence: readonly EvidenceItem[],
  policy?: ProviderDataScopePolicy,
): EvidenceScopeFilterResult {
  const kept: EvidenceItem[] = [];
  const withheld = new Set<ProviderDataScope>();
  let withheldCount = 0;

  for (const item of evidence) {
    const scope = dataScopeForSourceType(item.sourceType);
    if (scope && isScopeDenied(scope, policy)) {
      withheld.add(scope);
      withheldCount += 1;
      continue;
    }
    kept.push(item);
  }

  return {
    evidence: kept,
    withheldScopes: [...withheld],
    withheldCount,
  };
}

/** The scopes a set of evidence items actually carries — what the transport is
 *  told it is sending, instead of the transport regex-sniffing it back out. */
export function dataScopesForEvidence(evidence: readonly EvidenceItem[]): ProviderDataScope[] {
  const out = new Set<ProviderDataScope>();
  for (const item of evidence) {
    const scope = dataScopeForSourceType(item.sourceType);
    if (scope) out.add(scope);
  }
  return [...out];
}

/**
 * Scopes carried by an ALREADY-COMPOSED prompt string, read off the
 * `<evidence … source_type="…">` markup the packer emits.
 *
 * This is the transport-layer backstop for prompts that reach LLMHelper without
 * declared scopes (the engine surfaces still hand composed prompts to legacy
 * transports). The primary mechanism is the filter above; this exists so a call
 * site that forgets to declare its scopes fails safe rather than silently.
 */
export function dataScopesForEvidenceMarkup(text: string | undefined): ProviderDataScope[] {
  const out = new Set<ProviderDataScope>();
  if (!text) return [];
  for (const m of text.matchAll(/<evidence\b[^>]*\bsource_type="([A-Za-z_]+)"/g)) {
    const scope = dataScopeForSourceType(m[1]);
    if (scope) out.add(scope);
  }
  return [...out];
}

/** Human-readable names for the privacy notice the composer renders. */
export function scopeLabels(scopes: readonly string[]): string {
  const LABEL: Record<string, string> = {
    transcript: 'Transcripts',
    screenshots: 'Screenshots',
    reference_files: 'Reference files',
    profile_history: 'Profile & history',
    embeddings: 'Embeddings',
    post_call_summary: 'Post-call summaries',
  };
  return scopes.map((s) => LABEL[s] ?? s).join(', ');
}
