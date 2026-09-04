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

/**
 * Credential-scrub a [V3] trace payload before stringifying. Keeps every
 * diagnostic field (question, plan, evidence identity) and strips only
 * credential-shaped keys. See utils/redactForLog.redactSecretsOnly.
 */
function redactTracePayload<T>(payload: T): unknown {
  try { return require('../../utils/redactForLog').redactSecretsOnly(payload); } catch { return payload; }
}


/**
 * A rendered COMPLETED exchange — an answer, in one of the two shapes this
 * module produces. Deliberately not a general "looks like dialogue" test: the
 * point is to distinguish what WE rendered from a raw transcript window a
 * caller passed through.
 */
const COMPLETED_EXCHANGE_RE = /^(?:Assistant:|Previous answer)/m;

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
   * Where `question` came from. Defaults to 'manual' — correct for the manual
   * chat and typed-question call sites, which is what every caller was before
   * this field existed.
   *
   * 'transcript' means the string was chosen from live speech by
   * extractLatestQuestion, NOT typed by the user. That matters downstream:
   * resolveQuestion (orchestrator.ts) stamps manual input `confidence: 1`, so
   * a low-confidence extraction — a fragment the extractor itself scored 0.3
   * or 0.4 — was arriving indistinguishable from a deliberate typed question,
   * with no answerability signal for the decision layer to defend against.
   */
  questionSource?: 'manual' | 'transcript';
  /** Extractor confidence (0..1) when questionSource is 'transcript'. */
  questionConfidence?: number;
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
  /**
   * Multi-turn chat history (Settings > Intelligence > Memory > "Chat history").
   *
   * Passed IN rather than read here on purpose: this subsystem has no dependency
   * on the intelligence flag registry, and contracts/retrieval-flags.ts records
   * what adding the first one would cost (20 of its 62 flags resolve differently
   * in dev/test, and that split is why composePrompt and assistantClaims shipped
   * inert). The caller owns the read; this module owns the behaviour.
   *
   * `false` is a genuine rollback to the pre-2026-08-29 window: ONE turn, the
   * answer capped at 280 chars, and the no-evidence notice restored — not a
   * half-disabled state. Undefined means ON, so every other surface and every
   * test gets the fixed behaviour by default.
   */
  multiTurnHistory?: boolean;
  retrieval?: RetrievalPort;
  /**
   * Surface persona/voice contract factory (2026-08-02). Called AFTER the
   * decision exists so the caller can compose against what the turn actually
   * is (`codingTask` = the router classified it a coding problem — the same
   * semantic-activation contract Prompt System v2 uses everywhere else).
   * A callback rather than a string because the caller cannot know the
   * decision, and the bridge must not import the caller's prompt system —
   * the caller (which already holds both worlds) supplies the bridge a
   * closure instead. Returning null/throwing ⇒ no persona, composition
   * byte-identical to before this field existed.
   */
  personaBase?: (ctx: { codingTask: boolean }) => string | null;
  /**
   * The CALLER's routed coding verdict (AnswerPlanner's `isCodingAnswerType`).
   *
   * personaBase's `codingTask` was derived here from V3's own CODING_TASK_RE, a
   * hand-maintained keyword list (turn-classifier.ts). Measured 2026-08-11 by
   * dumping the composed system prompt: "Implement an LRU cache…" matched and
   * received the coding contract (17157 chars); "Write a BFS shortest-path
   * function…" did NOT match and shipped without it (14430 chars) — the phrase
   * "write a function" is split by "BFS shortest-path". "Given a binary tree,
   * return its level order traversal" misses too. Both are ordinary interview
   * questions, and both route to a coding answerType via AnswerPlanner.
   *
   * A miss means the model is never told to produce Complexity or a Dry Run,
   * and the downstream repair then paints "O(?) — state the actual time bound"
   * into sections it was never asked for.
   *
   * So the routed decision wins when the caller supplies one; the regex remains
   * only as the fallback for callers that don't. This is what this module's own
   * comment already specified — detection "stays with the existing
   * deterministic router (AnswerPlanner), never re-derived here from text".
   */
  codingTask?: boolean;
}

export interface BridgeResult {
  system: string;
  user: string;
  answerability: string;
  fallbackUsed: string;
  evidenceCount: number;
  /**
   * The evidence block this prompt was composed from — what the model was
   * actually given, not what a later retrieval happens to return.
   *
   * Added 2026-08-28 for the post-stream doc-grounded validator, which re-ran a
   * separate LEGACY retrieval and judged a V3-grounded answer against a
   * different evidence set, overwriting a correct answer with the canonical
   * refusal when the two disagreed. `evidenceCount` said HOW MUCH evidence
   * there was; nothing said WHAT it was, so no caller could validate honestly.
   *
   * Empty string when the turn had no evidence — which is a meaningful answer,
   * not a missing value.
   */
  evidenceBlock: string;
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
      // Route the question to the field that matches its actual provenance so
      // resolveQuestion assigns real confidence (manual → 1, transcript → 0.7)
      // instead of stamping everything `manual/1.0`.
      ...(input.questionSource === 'transcript'
        ? { transcriptQuestion: question }
        : { manualQuestion: question }),
      questionConfidence: input.questionConfidence,
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
    // A caller-supplied summary (the live-transcript surfaces) is real content
    // by construction; the session fallback below decides for itself.
    //
    // The toggle is applied HERE as well as in the session branch (2026-08-29).
    // It used to be read only inside `if (!convoSummary)`, and the
    // live-transcript surfaces always supply their own summary — so they never
    // entered that branch and `multiTurnHistory === false` had NO effect there.
    //
    // TWO HALVES, and the first one alone was not enough. Reading the flag here
    // only matters if a caller SENDS it, and for a while only ipcHandlers did:
    // the three IntelligenceEngine call sites (what-to-answer, assist, engine
    // manual-chat) left it undefined, so `=== false` was never true and the
    // rollback still could not reach live spoken answers. They pass it now.
    // If a new buildV3Prompt call site appears, it needs the flag too.
    //
    // And a THIRD half is still missing: only ipcHandlers calls
    // recordAnswerSummary, so the ring is never populated on those surfaces and
    // the flag there currently skips an empty ring. See IntelligenceEngine's
    // call site for the full note.
    //
    // A caller-supplied summary is only "content" when it actually holds a
    // COMPLETED EXCHANGE, which is what ComposeInput.conversationHasContent
    // documents. Mere presence was the old test, and the live spoken surfaces
    // pass IntelligenceEngine's conversationWindow(90) — SessionTracker's
    // rolling speech window, "[ME]: …" / "[INTERVIEWER]: …" lines with no
    // exchange in them. So the FIRST spoken question of any session with a
    // transcript had "earlier turns may already contain what is being asked"
    // appended to its absence notice, about turns that do not exist.
    //
    // The discriminator is the ANSWER side, in the shapes this file itself
    // renders: the ring's "Assistant: " lines, or the one-turn fallback's
    // "Previous answer". A question-only fallback is deliberately excluded —
    // it is rendered for continuity, but with no answer there is nothing to
    // answer FROM, which is the same rule the ring branch below applies when it
    // sets convoHasContent from turns.length.
    //
    // Anchored per line so "[ASSISTANT (PREVIOUS SUGGESTION)]: …" from the
    // transcript formatter cannot satisfy it.
    let convoHasContent = input.multiTurnHistory === false
      ? false
      : Boolean(input.conversationSummary) && COMPLETED_EXCHANGE_RE.test(input.conversationSummary!);
    // Set when the rendered history actually contains a [screen attached…]
    // line, so packedDataScopes can declare `screenshots` truthfully rather
    // than filing screen content under `transcript`.
    let historyCarriesScreenText = false;
    /** Screen lines existed but the `screenshots` scope is denied — reported in
     *  withheldScopes once that set exists, so the [V3] line and the debug
     *  collector both show the withholding rather than a silent drop. */
    let historyScreenWithheld = false;
    if (!convoSummary) {
      try {
        const { getConversationState } = require('../question/conversation-state-store');
        const cs = getConversationState(req.sessionId);
        // The RING first (2026-08-28). Rendering only previousQuestion +
        // previousAnswerSummary was a one-turn sliding window: turn 3 could
        // never see turn 1, so a screenshot described in turn 1 was gone by the
        // time the user asked about it. Oldest turn first, so the model reads
        // the exchange in the order it happened.
        // The toggle. OFF skips the ring entirely and falls through to the
        // one-turn block below, which is exactly what shipped before the fix.
        let turns: Array<{ q: string; a: string; screen?: string }> =
          input.multiTurnHistory === false ? [] : (cs?.turns ?? []);
        // Only a COMPLETED exchange counts as something to answer from. The
        // question-only fallback below is rendered for continuity, but it is
        // not history, and the composer must not relax its no-evidence notice
        // on the strength of it.
        convoHasContent = turns.length > 0;
        if (turns.length) {
          // ENFORCE the mode's declared conversation budget, oldest dropped
          // first. The ring is already bounded by construction, but a full ring
          // of long answers is ~4k tokens — well past every mode's declared
          // conversationTokens, a field the packer never read. Honouring it
          // here keeps the declaration true instead of decorative.
          const budgetChars = Math.max(0, (policy.contextBudget?.conversationTokens ?? 600) * 4);
          // Decided BEFORE the budget loop, because the loop must not charge for
          // text it will not send. Billing a withheld screen line against the
          // conversation budget evicted older turns to make room for something
          // that is then dropped — so denying the `screenshots` scope silently
          // shortened a user's history as well as redacting it.
          const screensDenied = isScopeDenied('screenshots', readProviderScopePolicy());
          let spent = 0;
          const kept: typeof turns = [];
          for (let i = turns.length - 1; i >= 0; i--) {
            const t = turns[i];
            const screenCost = screensDenied ? 0 : (t.screen?.length ?? 0);
            const cost = t.q.length + t.a.length + screenCost + 32;
            // Always keep the most recent exchange, even if it alone overruns:
            // dropping it would leave a follow-up with no antecedent at all.
            if (kept.length && spent + cost > budgetChars) break;
            spent += cost;
            kept.unshift(t);
          }
          turns = kept;
          // SCREEN TEXT IS SCREENSHOT DATA, WHEREVER IT TRAVELS.
          //
          // These lines are rendered into convoSummary, which is dropped only
          // when the TRANSCRIPT scope is denied and tagged only as `transcript`
          // in packedDataScopes. So a user who denied `screenshots` for their
          // provider had the SCREEN_CONTEXT evidence correctly withheld by
          // filterEvidenceByProviderScopes — and the same text delivered anyway
          // inside this history line, for up to 10 turns. The evidence filter
          // only sees EvidenceItems; prose walks past it.
          //
          // Same class as the transcript drop below ("the one door the filter
          // does not cover"), which is exactly why it needs the same treatment.
          //
          // The policy is read HERE rather than reusing the one below, because
          // the history is rendered before orchestrate() runs. Reading it twice
          // is correct by this module's own rule: the policy is read live every
          // turn and never cached, since esbuild inlines this file into every
          // entry bundle and a cached copy would go stale outside the bundle
          // that wrote it.
          const hadScreen = turns.some((t) => t.screen);
          const renderedScreen = hadScreen && !screensDenied;
          historyScreenWithheld = hadScreen && screensDenied;
          const rendered = turns.map((t) => [
            `User: ${t.q}`,
            // The screenshot the user attached on that turn, as text. The image
            // is long gone from the payload by now; this is all a follow-up has.
            ...(t.screen && !screensDenied ? [`[screen attached that turn] ${t.screen}`] : []),
            `Assistant: ${t.a}`,
          ].join('\n')).join('\n\n');
          historyCarriesScreenText = renderedScreen;
          // The CURRENT question is not in the ring yet (its answer does not
          // exist), so nothing here duplicates it.
          convoSummary = rendered;
        } else if (cs?.previousQuestion) {
          // Fallback for a turn already in flight when the ring was empty —
          // e.g. the first turn after an upgrade, or a caller that advances
          // without ever recording an answer.
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
    // EVIDENCE withholding only. Everything downstream reads this set as "this
    // turn's evidence was filtered": absenceContract() returns '' on any entry,
    // privacyWithholdingNotice PRE-EMPTS noEvidenceNotice entirely, and the
    // PARTIAL notice narrates a truncated record. Feeding a CONVERSATION-ring
    // withholding in here made all three fire for a turn whose own evidence was
    // untouched — the user asked something unrelated two turns later and was
    // told to refuse because the Screenshots setting withheld the material.
    const withheldScopes = new Set<ProviderDataScope>(scopeFilter.withheldScopes);

    // Conversation continuity is CONVERSATION_STATE data, which maps to the
    // transcript scope. It reaches the prompt as prose rather than as an
    // EvidenceItem, so the evidence filter above cannot see it — drop it here
    // or the scope leaks through the one door the filter does not cover.
    // The transcript branch DOES belong in the evidence set, and the asymmetry
    // with the screen line above is deliberate: this one empties convoSummary,
    // so the turn really is left with nothing and pre-empting the no-evidence
    // notice is the honest outcome. The screen case removes one line from a
    // history that otherwise survives intact.
    if (convoSummary && isScopeDenied('transcript', scopePolicy)) {
      convoSummary = undefined;
      withheldScopes.add('transcript');
    }

    // AUDIT set — "what did the privacy settings drop this turn?", which is a
    // wider question than "was this turn's evidence filtered?". The screen line
    // belongs here: it really was withheld, and a silent drop is exactly what
    // HistoryScreenScopeLeak pins against. It just must not reach the composer.
    //
    // Guarded on convoSummary like its sibling at packedDataScopes below: if
    // the transcript denial removed the whole history block, nothing was
    // rendered for a screen line to be withheld FROM, and `transcript` is
    // already reporting the real cause.
    const auditWithheldScopes = new Set<ProviderDataScope>(withheldScopes);
    if (historyScreenWithheld && convoSummary) auditWithheldScopes.add('screenshots');

    // Persona resolution must never break a turn: a throwing factory or a null
    // return simply composes without one (today's behaviour).
    let personaBase: string | undefined;
    try {
      personaBase = input.personaBase?.({
        // Routed verdict first (see BridgeInput.codingTask); the keyword check
        // is the fallback for callers that supply none.
        codingTask: input.codingTask
          ?? (result.decision.questionTypes as readonly string[]).includes('CODING_TASK'),
      }) ?? undefined;
    } catch { personaBase = undefined; }

    const composed = composePrompt({
      decision: result.decision,
      policy,
      personaBase,
      evidence: scopeFilter.evidence,
      withheldScopes: [...withheldScopes],
      realtimeInstruction: input.realtimeInstruction,
      conversationSummary: convoSummary,
      conversationHasContent: convoHasContent && Boolean(convoSummary),
      // Only TRUE when a screen line actually survived into the rendered
      // history — so a withheld `screenshots` scope cannot make the composer
      // treat an observation as available.
      conversationHasScreenObservation: historyCarriesScreenText && Boolean(convoSummary),
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
    // Declared separately from `transcript`: an audit that asks "did screen
    // content leave the device this turn?" must not have to know that screen
    // text is smuggled inside the conversation summary.
    // `&& convoSummary`, matching conversationHasScreenObservation above.
    // historyCarriesScreenText is computed while RENDERING the history, but the
    // transcript-scope check further down can still set convoSummary =
    // undefined and drop the whole block. Without this guard a user who denied
    // `transcript` had the entire history removed from the prompt and was told
    // by this very audit line that screen content had left the device. It fails
    // safe (over-declaring, never under-), but answering "did screen content go
    // out this turn?" is the line's only job, so a wrong `true` defeats it.
    if (historyCarriesScreenText && convoSummary) packedDataScopes.add('screenshots');

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
      // Pre-stringified, so redactForLog only sees a string and applies the
      // free-text credential patterns — no key-level scrubbing. Scrub at the
      // source so a future field carrying a key cannot land verbatim.
      console.log('[V3]', JSON.stringify(redactTracePayload({
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
        privacyWithheldScopes: [...auditWithheldScopes],
        outboundScopes: [...packedDataScopes],
        // Deep-test D5/D6 (2026-08-01): the two signals that turn a masked
        // failure into a diagnosable one — was this a document-specific
        // question, and did any claim get property-level (not merely topical)
        // support.
        documentSpecific: result.decision.claimRequirements
          .some((c) => c.authority === 'PRIVATE_SOURCE_REQUIRED'),
        propertyMatched: (result.trace.claimPlan ?? [])
          .some((c) => c.support === 'DIRECT_EVIDENCE'),
      })));
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
      // T4 (2026-08-28): the evidence THIS PROMPT WAS BUILT FROM, exposed so a
      // post-stream validator can check the answer against what the model was
      // actually given. Before this, `IntelligenceEngine`'s doc-grounded
      // validator re-ran a separate LEGACY retrieval and judged a V3-grounded
      // answer against a different evidence set — then overwrote the streamed
      // answer with the canonical refusal when the two disagreed. The evidence
      // block is the only thing that can settle that, and it was never carried
      // out of here. Empty string when the turn had no evidence, which is
      // itself the answer to "was there anything to be grounded in?".
      evidenceBlock: composed.packed.evidenceBlock ?? '',
      answerability: result.answerability,
      fallbackUsed: result.trace.fallbackUsed,
      // Post-filter: the count callers branch on must describe the evidence the
      // model was actually given, not the evidence retrieval found.
      evidenceCount: scopeFilter.evidence.length,
      packedDataScopes: [...packedDataScopes],
      withheldDataScopes: [...auditWithheldScopes],
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
