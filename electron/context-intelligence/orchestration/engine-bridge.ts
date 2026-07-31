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
import type { AnswerSurface, EvidenceScope } from '../contracts/types';

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
    const composed = composePrompt({
      decision: result.decision,
      policy,
      evidence: result.evidence,
      realtimeInstruction: input.realtimeInstruction,
      conversationSummary: convoSummary,
      attachedSourceCount: input.attachedSourceCount,
      profileSourceCount: input.profileSourceCount,
    });

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
        path: result.decision.retrievalPlan.path,
        planned: result.decision.retrievalPlan.sourceTypes,
        evidence: acc.length,
        sources: srcIds,
        retrievedSources,
        answerability: result.trace.answerability,
        fallback: result.trace.fallbackUsed,
      }));
    } catch { /* observability must never break an answer */ }

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
      evidenceCount: result.evidence.length,
      // GROUNDED with nothing to retrieve means the mode authorizes no source
      // for this question. Distinct from FAST, where none was needed.
      unsupportedInMode: result.decision.retrievalPlan.path !== 'FAST'
        && result.decision.retrievalPlan.shouldRetrieve === false,
      modeId,
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
