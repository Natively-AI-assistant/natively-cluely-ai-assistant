// electron/context-intelligence/orchestration/engine-bridge.ts
//
// One adoption point for the IntelligenceEngine surfaces.
//
// WHY A SHARED BRIDGE
// Five engine surfaces — assist, clarify, brainstorm, code-hint and manual
// answer — construct NO source authority whatsoever today. Each passes a raw
// `session.getFormattedContext(N)` blob straight to the model. Wiring them one
// at a time would recreate the very thing F2 describes: several near-identical
// decision sites drifting apart. There is exactly one here.
//
// Returns null whenever the flag is off or anything goes wrong, so a caller's
// integration is a two-line change and the failure mode is "legacy behaviour",
// never "no answer".

import { isContextIntelligenceV3Enabled } from '../contracts/flag';
import { orchestrate, type AnswerRequest, type RetrievalPort } from './orchestrator';
import { composePrompt } from '../generation/prompt-composer';
import { resolveModePolicy, isModeId, type ModeId } from '../policies/mode-policy-registry';
import { recordLegacyTurn } from '../observability/legacy-trace';
import {
  readProviderScopePolicy,
  filterEvidenceByProviderScopes,
  dataScopesForEvidence,
  isScopeDenied,
} from '../policies/provider-scope-policy';
import type { AnswerSurface, EvidenceScope } from '../contracts/types';
import type { ProviderDataScope } from '../../llm/ProviderRouter';

export interface BridgeInput {
  surface: AnswerSurface;
  question: string;
  /** Raw templateType from ModesManager; unknown ids fall back rather than throw. */
  modeTemplateType?: string | null;
  /** The mode's UNIQUE id (mode_<uuid>) when one exists. Keys the per-mode
   *  Answer policy choice: two custom modes share a templateType, never an id. */
  modeUniqueId?: string | null;
  /** How many reference files the active mode has. Lets the composer say "no
   *  document is attached" instead of "the document does not mention it". */
  attachedSourceCount?: number;
  /** Attached file NAMES — deterministic filename-role routing (glossary /
   *  formula sheet, deep-run 2 issue 9). Always populated by call sites;
   *  never gated on debug level (routing must not depend on logging). */
  attachedFileNames?: readonly string[];
  /** How many Profile Intelligence sources hydrated this turn's retrieval
   *  (active résumé / target JD). Composer wording + telemetry — a zero-
   *  attachment turn with a live profile must NOT claim nothing was searched. */
  profileSourceCount?: number;
  /** Identity of the profile sources resolved into the turn ({role, id} only,
   *  never content) — the [V3] line's answer to "which source pools existed",
   *  as distinct from `sources` = what retrieval actually accepted. */
  resolvedProfileSources?: Array<{ role: string; id: string }>;
  /** Human-readable mode name for the [V3] observability line. */
  modeName?: string | null;
  /** Distinguishes call sites that share an AnswerSurface (AnswerSurface has
   *  no 'clarify'/'brainstorm' members, and the engine's manual-answer path
   *  shares 'manual-chat' with the IPC surface). Appended to legacyPath and
   *  the [V3] line so traces from different call sites stay separable. */
  pathTag?: string;
  scope?: Partial<EvidenceScope>;
  requestId?: string;
  requestSequence?: number;
  isFollowUp?: boolean;
  hasScreenContext?: boolean;
  /**
   * Attachment-derived source types for custom/general modes (deep-test D10) —
   * computed at the call site that holds the files, via
   * attachmentSourceTypeExtensions. Additive only.
   */
  extraAllowedSourceTypes?: import('../contracts/types').SourceType[];
  /**
   * Context-debug (2026-08-01): identity of the sources this turn COULD read
   * — id/role/name/status only, built at the call site that holds the files.
   * Never content.
   */
  debugSources?: import('../debug/debug-types').ContextDebugSource[];
  /**
   * TRUE when the calling transport will record generation timing + the final
   * answer and call the collector's complete() itself (manual-chat). Surfaces
   * that cannot correlate the final answer leave this unset and the bridge
   * finalizes a decision-only record immediately.
   */
  deferDebugCompletion?: boolean;
  /** Tone/length only — cannot widen authorization (§19.2). */
  realtimeInstruction?: string;
  conversationSummary?: string;
  retrieval?: RetrievalPort;
}

export interface BridgeResult {
  system: string;
  user: string;
  answerability: string;
  fallbackUsed: string;
  evidenceCount: number;
  /** True when the mode authorizes no source for this question — the caller
   *  should NOT quietly answer from model knowledge. */
  unsupportedInMode: boolean;
  modeId: ModeId;
  /**
   * The provider data scopes this prompt ACTUALLY carries, derived from the
   * source types of the evidence that survived filtering AND packing.
   *
   * The transport must be TOLD what it is sending. Before this existed, the V3
   * call site passed `[]` and LLMHelper regex-sniffed the payload for legacy
   * tag names that a V3 prompt never contains — so it inferred nothing and
   * enforced nothing. Pass this straight into streamChat's `extraDataScopes`.
   */
  packedDataScopes: ProviderDataScope[];
  /** Scopes whose evidence a privacy setting withheld from this turn. Empty on
   *  a normal turn. Present so callers can log/surface the withholding. */
  withheldDataScopes: ProviderDataScope[];
  /** Set when a context-debug collector is open for this turn (deferred
   *  completion) — the transport looks it up by this id to record the final
   *  answer and timings. */
  debugRequestId?: string;
}

/**
 * Build a V3 prompt for an engine surface, or null to keep legacy behaviour.
 *
 * Never throws. A defect in the new path must degrade to legacy, never break a
 * live answer — the same contract the wired manual-chat surface uses.
 */
export async function buildV3Prompt(input: BridgeInput): Promise<BridgeResult | null> {
  try {
    if (!isContextIntelligenceV3Enabled()) return null;
    const question = String(input.question || '').trim();
    if (!question) return null;

    const raw = input.modeTemplateType ?? 'general';
    const modeId: ModeId = isModeId(raw) ? raw : 'general';

    // The user's per-mode grounding choice (§6). Read per turn — not cached on
    // the bridge — so a change in Settings applies to the very next answer.
    let userAnswerPolicy: import('../policies/answer-policy').AnswerPolicy | null = null;
    try {
      const { getStoredAnswerPolicy } = require('../policies/answer-policy-store');
      userAnswerPolicy = getStoredAnswerPolicy(input.modeUniqueId ?? modeId);
    } catch { /* store unavailable — mode default applies */ }
    const policy = resolveModePolicy(modeId);

    const req: AnswerRequest = {
      requestId: input.requestId ?? `v3-${input.surface}-${Date.now()}`,
      requestSequence: input.requestSequence ?? 0,
      surface: input.surface,
      modeId,
      scope: { userId: 'local', ...input.scope },
      sessionId: input.scope?.sessionId ?? 'engine',
      manualQuestion: question,
      userAnswerPolicy,
      isFollowUp: input.isFollowUp,
      hasScreenContext: input.hasScreenContext,
      // Definite value lookups ground only where documents exist (deep-test D2).
      hasAttachedDocuments: (input.attachedSourceCount ?? 0) > 0
        || (input.profileSourceCount ?? 0) > 0,
      attachedFileNames: input.attachedFileNames,
      extraAllowedSourceTypes: input.extraAllowedSourceTypes,
    };

    // Prior-turn continuity: callers that have a live transcript window pass
    // their own summary; everyone else falls back to the session's V3
    // conversation state (previous question + capped answer summary, rendered
    // as a labelled referent — never evidence). Read BEFORE orchestrate(),
    // which advances the state with THIS turn's question.
    let convoSummary = input.conversationSummary;
    if (!convoSummary) {
      try {
        const { getConversationState } = require('../question/conversation-state-store');
        const cs = getConversationState(req.sessionId);
        if (cs?.previousQuestion) {
          convoSummary = `Previous question: ${cs.previousQuestion}`
            + (cs.previousAnswerSummary ? `\nPrevious answer (referent only, NOT evidence): ${cs.previousAnswerSummary}` : '');
        }
      } catch { /* continuity must never break a turn */ }
    }

    const result = await orchestrate(req, input.retrieval);

    // ── Outbound provider-data-scope filter ─────────────────────────────────
    // Settings > AI Providers > Privacy. Applied HERE — after retrieval, before
    // packing — because the composer writes its instructions against the
    // evidence it is handed. Filtering downstream of the composer would leave a
    // prompt whose checked-absence and no-evidence contracts describe material
    // the model can no longer see, which is a fabrication engine.
    //
    // The policy is read LIVE every turn: never cached here or anywhere, since
    // esbuild inlines this module into every entry bundle and a cached copy
    // would go stale outside the bundle that wrote it.
    const scopePolicy = readProviderScopePolicy();
    const scopeFilter = filterEvidenceByProviderScopes(result.evidence, scopePolicy);
    const withheldScopes = new Set<ProviderDataScope>(scopeFilter.withheldScopes);

    // Conversation continuity is CONVERSATION_STATE data, which maps to the
    // transcript scope. It reaches the prompt as prose rather than as an
    // EvidenceItem, so the evidence filter above cannot see it — drop it here
    // or the scope leaks through the one door the filter does not cover.
    if (convoSummary && isScopeDenied('transcript', scopePolicy)) {
      convoSummary = undefined;
      withheldScopes.add('transcript');
    }

    const composed = composePrompt({
      decision: result.decision,
      policy,
      evidence: scopeFilter.evidence,
      withheldScopes: [...withheldScopes],
      realtimeInstruction: input.realtimeInstruction,
      conversationSummary: convoSummary,
      attachedSourceCount: input.attachedSourceCount,
      profileSourceCount: input.profileSourceCount,
      // Defect D (2026-08-01): the CLARIFICATION verdict was computed and then
      // dropped here — the composer is the only place it can act.
      fallbackUsed: result.trace.fallbackUsed,
    });

    // What this prompt actually carries: the scopes of the evidence that
    // survived BOTH the privacy filter and the packing budget, plus the
    // transcript scope when a conversation summary rides along. This is the
    // truth handed to the transport instead of it guessing from the bytes.
    const includedIds = new Set(composed.packed.includedEvidenceIds);
    const packedDataScopes = new Set<ProviderDataScope>(
      dataScopesForEvidence(scopeFilter.evidence.filter((e) => includedIds.has(e.evidenceId))),
    );
    if (convoSummary) packedDataScopes.add('transcript');

    // ── Per-turn source line ────────────────────────────────────────────────
    // The one thing production could not answer about itself. A cross-mode
    // contamination report arrived with a full terminal log that contained no
    // record of which mode, which files, or which evidence any turn used, so
    // the defect had to be reconstructed by comparing answer prose against the
    // reference files in SQLite. Identity only — never content (12 §4).
    try {
      const acc = result.trace.acceptedEvidence ?? [];
      const srcIds = [...new Set(acc.map((e) => e.sourceId))];
      // {role, id} pairs of what retrieval actually ACCEPTED — the counterpart
      // of resolvedSources (what pools existed). Identity only, never content.
      const retrievedSources = [...new Map(
        acc.map((e) => [`${e.sourceType}:${e.sourceId}`, { role: e.sourceType, id: e.sourceId }]),
      ).values()];
      console.log('[V3]', JSON.stringify({
        surface: input.surface,
        ...(input.pathTag ? { tag: input.pathTag } : {}),
        mode: modeId,
        modeUniqueId: input.modeUniqueId ?? null,
        modeName: input.modeName ?? null,
        // `attachedFiles` kept for rerun-protocol parsers; the split fields are
        // the honest representation — attachedFiles alone reported the whole
        // source state as 0 while a profile résumé/JD pool existed.
        attachedFiles: input.attachedSourceCount ?? null,
        modeAttachedFiles: input.attachedSourceCount ?? null,
        profileSources: input.profileSourceCount ?? 0,
        profileResumeSources: (input.resolvedProfileSources ?? []).filter((s) => s.role === 'profile_resume').length,
        profileJobDescriptionSources: (input.resolvedProfileSources ?? []).filter((s) => s.role === 'profile_job_description').length,
        profileFactSources: (input.resolvedProfileSources ?? []).filter((s) => s.role === 'profile_fact').length,
        resolvedSources: input.resolvedProfileSources ?? [],
        // Defect D/F telemetry (2026-08-01): the resolver's decision and the
        // retrieval funnel were both invisible — a stale referent rewrite and a
        // "0 raw candidates" vs "all candidates filtered" distinction each had
        // to be reconstructed from answer prose.
        originalQuestion: result.trace.originalQuestion,
        resolvedQuestion: result.trace.resolvedQuestion,
        intent: result.trace.questionTypes,
        knowledgePolicy: policy.groundingPolicy,
        path: result.decision.retrievalPlan.path,
        planned: result.decision.retrievalPlan.sourceTypes,
        evidence: acc.length,
        sources: srcIds,
        retrievedSources,
        retrieval: (result.trace.retrievalAttempts ?? []).map((a) => ({
          candidates: a.candidateCount,
          admitted: a.admittedAfterScopeFilter,
          rejected: a.rejectedByScopeFilter,
          ...(a.failed ? { failed: true } : {}),
        })),
        answerability: result.trace.answerability,
        fallback: result.trace.fallbackUsed,
        // Privacy withholding (2026-08-01). Identity/counts only. A turn that
        // answered thinly because the user switched a data scope off was
        // previously indistinguishable in the logs from a retrieval miss.
        privacyWithheldCount: scopeFilter.withheldCount,
        privacyWithheldScopes: [...withheldScopes],
        outboundScopes: [...packedDataScopes],
        // Deep-test D5/D6 (2026-08-01): the two signals that turn a masked
        // failure into a diagnosable one — was this a document-specific
        // question, and did any claim get property-level (not merely topical)
        // support.
        documentSpecific: result.decision.claimRequirements
          .some((c) => c.authority === 'PRIVATE_SOURCE_REQUIRED'),
        propertyMatched: (result.trace.claimPlan ?? [])
          .some((c) => c.support === 'DIRECT_EVIDENCE'),
      }));
    } catch { /* observability must never break an answer */ }

    // ── Context Intelligence debug collector (2026-08-01) ───────────────────
    // Observes the SAME objects the [V3] line reads — the production trace and
    // frozen decision — never recomputing any of it. Level 'off' costs one
    // function call. Any failure here degrades to "no debug record".
    let debugRequestId: string | undefined;
    try {
      const { getContextDebugLevel, getContentInclusionEnabled } = require('../debug/debug-config');
      const level = getContextDebugLevel();
      if (level !== 'off') {
        const { beginTurnCollector } = require('../debug/turn-collector');
        const collector = beginTurnCollector({
          sessionId: req.sessionId,
          ...(req.scope.meetingId ? { meetingId: req.scope.meetingId } : {}),
          turnId: `turn_${req.requestId}`,
          requestId: req.requestId,
          conversationGeneration: req.requestSequence,
          modeId,
          ...(input.modeUniqueId ? { modeUniqueId: input.modeUniqueId } : {}),
          surface: `${input.surface}${input.pathTag ? `:${input.pathTag}` : ''}`,
        }, { level, includeContent: getContentInclusionEnabled(level) });

        collector.recordDecisionTrace({
          trace: result.trace,
          decision: result.decision,
          modeName: input.modeName,
          modeType: raw === 'general' && (input.modeName ?? 'General') !== 'General' ? 'custom' : 'default',
          policyVersion: policy.version,
          extraAllowedSourceTypes: input.extraAllowedSourceTypes as readonly string[] | undefined,
          documentSpecific: result.decision.claimRequirements
            .some((c) => c.authority === 'PRIVATE_SOURCE_REQUIRED'),
          propertyMatched: (result.trace.claimPlan ?? [])
            .some((c) => c.support === 'DIRECT_EVIDENCE'),
        });
        const resolvedProfiles = input.resolvedProfileSources ?? [];
        collector.recordAvailableSources({
          modeAttachmentCount: input.attachedSourceCount ?? 0,
          profileResumeCount: resolvedProfiles.filter((s) => s.role === 'profile_resume').length,
          profileJobDescriptionCount: resolvedProfiles.filter((s) => s.role === 'profile_job_description').length,
          profileFactCount: resolvedProfiles.filter((s) => s.role === 'profile_fact').length,
        });
        // Authorized sources = mode attachments PLUS resolved Profile
        // Intelligence pools (deep-run 2, issue 14: profile turns logged
        // authorizedSources: [] while the résumé/JD pools answered the turn).
        const authorized = [
          ...(input.debugSources ?? []),
          ...resolvedProfiles.map((s) => ({ id: s.id, role: s.role })),
        ];
        if (authorized.length) collector.recordAuthorizedSources(authorized);
        const rr = result.trace.referentResolution;
        if (rr) {
          collector.recordConversationState({
            activePerson: rr.activePerson ?? null,
            activeTopic: rr.activeTopic ?? null,
            previousQuestion: rr.previousQuestion ?? null,
            referentApplied: rr.applied,
            referentReason: rr.reason ?? null,
            referent: rr.referent ?? null,
          });
        }
        // The FILTERED set: the debug record must show what the model was
        // actually sent, and must not persist content the user's privacy
        // setting withheld from a cloud provider.
        collector.recordEvidenceItems(scopeFilter.evidence);

        if (input.deferDebugCompletion) {
          debugRequestId = req.requestId;   // the transport completes it
        } else {
          collector.recordAnswer('', false, 'answer_not_correlated_on_this_surface');
          collector.complete();
        }
      }
    } catch { /* debug logging must never break an answer */ }

    try {
      recordLegacyTurn({
        ...(result.trace as unknown as Record<string, unknown>),
        legacyPath: `v3-${input.surface}${input.pathTag ? `-${input.pathTag}` : ''}`,
      } as never);
    } catch { /* observability must never break an answer */ }

    return {
      system: composed.system,
      user: composed.user,
      answerability: result.answerability,
      fallbackUsed: result.trace.fallbackUsed,
      // Post-filter: the count callers branch on must describe the evidence the
      // model was actually given, not the evidence retrieval found.
      evidenceCount: scopeFilter.evidence.length,
      packedDataScopes: [...packedDataScopes],
      withheldDataScopes: [...withheldScopes],
      // GROUNDED with nothing to retrieve means the mode authorizes no source
      // for this question. Distinct from FAST, where none was needed.
      unsupportedInMode: result.decision.retrievalPlan.path !== 'FAST'
        && result.decision.retrievalPlan.shouldRetrieve === false,
      modeId,
      ...(debugRequestId ? { debugRequestId } : {}),
    };
  } catch (e) {
    // Flag-off returns null EARLY above; reaching here means the V3 path
    // FAILED and the caller will silently revert to legacy. That reversion
    // must be observable (§22.1) — count it and log one structured line.
    try {
      require('../observability/rollout-metrics').recordV3Fallback(
        `${input.surface}${input.pathTag ? `-${input.pathTag}` : ''}`, e,
      );
    } catch { /* observability only */ }
    return null;
  }
}
