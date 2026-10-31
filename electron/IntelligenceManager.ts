// IntelligenceManager.ts
// Thin facade that delegates to focused sub-modules.
// Maintains full backward compatibility — all existing callers continue to work unchanged.
//
// Sub-modules:
//   SessionTracker     — state, transcript arrays, context management, epoch compaction
//   IntelligenceEngine — LLM mode routing (6 modes), event emission
//   MeetingPersistence — meeting stop/save/recovery

import { EventEmitter } from 'events';
import { LLMHelper } from './LLMHelper';
import { SessionTracker, type ConversationSurface } from './SessionTracker';
import type { TurnIdentity } from './llm/turnIdentity';
import { IntelligenceEngine } from './IntelligenceEngine';
import { MeetingPersistence } from './MeetingPersistence';
import { ScreenContext } from './services/screen/ScreenContextService';

// Re-export types for backward compatibility
export type { TranscriptSegment, SuggestionTrigger, ContextItem } from './SessionTracker';
export type { IntelligenceMode, IntelligenceModeEvents } from './IntelligenceEngine';
export type { DynamicAction } from './services/dynamic-actions/DynamicAction';

export const GEMINI_FLASH_MODEL = "gemini-3.8-flash";
export const GEMINI_FLASH_LITE_MODEL = "gemini-3.1-flash-lite";

/**
 * IntelligenceManager - Facade for the intelligence layer.
 * 
 * Delegates to:
 * - SessionTracker:     context, transcripts, epoch summaries
 * - IntelligenceEngine: LLM modes (assist, whatToSay, followUp, recap, clarify, manual, followUpQuestions)
 * - MeetingPersistence: meeting stop/save/recovery
 */
export class IntelligenceManager extends EventEmitter {
    private session: SessionTracker;
    private engine: IntelligenceEngine;
    private persistence: MeetingPersistence;

    constructor(llmHelper: LLMHelper) {
        super();
        this.session = new SessionTracker();
        this.engine = new IntelligenceEngine(llmHelper, this.session);
        this.persistence = new MeetingPersistence(this.session, llmHelper);

        // Wire the LLMHelper used by the async per-section prompt compiler (Phase 16b).
        // Fire-and-forget compilation runs when a user adds/edits a note section or custom mode.
        try {
            const { ModesManager } = require('./services/ModesManager');
            ModesManager.setLlmHelperForCompiler(llmHelper);
        } catch { /* non-fatal */ }

        // Forward all engine events through the facade
        this.forwardEngineEvents();
    }

    /**
     * Give the engine lazy access to the RAG manager, for live-meeting
     * evidence (issue #552's resolveMeetingEvidence — the JIT semantic port
     * plus the BM25 live-transcript port).
     *
     * Called from main.ts AFTER RAGManager exists — this manager is
     * constructed first, so a provider closure is passed rather than the
     * instance. `RAGManager` satisfies `MeetingRagLike` structurally
     * (getRetriever/getLiveMeetingId); the engine keeps no RAG import of its
     * own, so it is typed here instead.
     */
    setMeetingRagProvider(provider: (() => import('./context-intelligence/retrieval/meeting-evidence').MeetingRagLike | null) | null): void {
        this.engine.setMeetingRagProvider(provider);
    }

    /**
     * Forward all events from IntelligenceEngine through this facade
     * so existing listeners on IntelligenceManager continue to work.
     */
    private forwardEngineEvents(): void {
        const events = [
            'assist_update', 'suggested_answer', 'suggested_answer_token', 'suggested_answer_discard',
            // Planner declined to answer a trigger (cooldown dedup) — forwarded so
            // a skip is observable rather than silent.
            'suggestion_skipped',
            // Verified code execution (background): ✓ badge + corrected message.
            'code_verified', 'code_correction',
            'refined_answer', 'refined_answer_token',
            'recap', 'recap_token', 'clarify', 'clarify_token',
            'follow_up_questions_update', 'follow_up_questions_token',
            // The live helpers: What did I miss?, Define, Sound smart.
            'live_helper', 'live_helper_token',
            // The user's own buttons (llm/customButtons.ts).
            'custom_button', 'custom_button_token',
            'manual_answer_started', 'manual_answer_result',
            'mode_changed', 'error',
            // Sprint 7: dedicated channel for negotiation coaching payloads.
            'negotiation_coaching',
            // Phase 3: Cluely-style dynamic action card emissions.
            'dynamic_action_emitted',
        ];

        for (const event of events) {
            this.engine.on(event, (...args: any[]) => {
                this.emit(event, ...args);
            });
        }
    }

    // ============================================
    // LLM Initialization (delegates to engine)
    // ============================================

    /** The V3 conversation-ring key. See IntelligenceEngine.conversationSessionId. */
    conversationSessionId(): string {
        return this.engine.conversationSessionId();
    }

    initializeLLMs(): void {
        // Cancel any in-flight streams before swapping LLM clients
        this.engine.reset();
        this.engine.initializeLLMs();
    }

    reinitializeLLMs(): void {
        this.engine.reset();
        this.engine.reinitializeLLMs();
    }

    // ============================================
    // Context Management (delegates to session)
    // ============================================

    setMeetingMetadata(metadata: any): void {
        this.session.setMeetingMetadata(metadata);
    }

    /**
     * The running session's metadata (title, calendarEvent, callKey…), or null.
     * Read by the automatic stop (main: meetingAutoStop) for the calendar end,
     * the call's tab and the speakers' names.
     */
    liveMeetingMetadata(): any {
        return this.session.getMeetingMetadata();
    }

    addTranscript(segment: import('./SessionTracker').TranscriptSegment, skipRefinementCheck: boolean = false): void {
        if (skipRefinementCheck) {
            // Direct add without refinement detection
            this.session.addTranscript(segment);
        } else {
            // Let the engine handle transcript + refinement detection
            this.engine.handleTranscript(segment, false);
        }
        if (segment?.final) this.persistence.noteLiveChange(true);
    }

    addAssistantMessage(
        text: string,
        writeDecision?: { policy?: 'store_conversational_only' | 'store_non_authoritative' | 'do_not_store'; reason?: string; blockedFromSessionTracker?: boolean; answersSpokenQuestion?: boolean },
        surface?: ConversationSurface,
        identity?: TurnIdentity,
    ): boolean {
        return this.session.addAssistantMessage(text, writeDecision, surface, identity);
    }

    getContext(lastSeconds: number = 120) {
        return this.session.getContext(lastSeconds);
    }

    getLastAssistantMessage(surface?: ConversationSurface): string | null {
        return this.session.getLastAssistantMessage(surface);
    }

    /** The system design currently on the table (shared across surfaces), or null. */
    getActiveDesign() {
        return this.session.getActiveDesign();
    }

    /** A fresh design turn is starting; remember what it asked (a hint only). */
    noteDesignQuestion(question: string | null | undefined): void {
        this.session.noteDesignQuestion(question);
    }

    /** Record a renderer-validated Mermaid repair wherever the broken block was stored. */
    applyDiagramRepair(originalSource: string, repairedSource: string): boolean {
        return this.session.applyDiagramRepair(originalSource, repairedSource);
    }

    getContextEpoch(): number {
        return this.session.getContextEpoch();
    }

    getFormattedContext(lastSeconds: number = 120): string {
        return this.session.getFormattedContext(lastSeconds);
    }

    /** What people said in the last `lastSeconds`, from the durable transcript (see SessionTracker). */
    getFormattedSpeech(lastSeconds: number = 600): string {
        return this.session.getFormattedSpeech(lastSeconds);
    }

    getLastInterviewerTurn(): string | null {
        return this.session.getLastInterviewerTurn();
    }

    /** Date.now() of the last mid-meeting reset, else 0 (SessionTracker.getAssistantViewStartedAt). */
    getAssistantViewStartedAt(): number {
        return this.session.getAssistantViewStartedAt();
    }

    /** The rolling recap of the meeting so far (SessionTracker.getMeetingRecaps). */
    getMeetingRecaps(): ReadonlyArray<{ fromTs: number; toTs: number; lines: number; text: string }> {
        return this.session.getMeetingRecaps();
    }

    /** Current meeting's finalized transcript as the assistant reads it (retrieval). */
    // `tailLines`: only the newest that many (a caller that reads the last few seconds).
    getCurrentMeetingTranscript(tailLines?: number): Array<{ speaker: string; text: string; timestamp: number; origin?: string }> {
        // `origin` rides along so the live-transcript evidence can tell a line
        // the user SAID from one they TYPED into the overlay (typed chat is
        // echoed into the transcript as speaker 'user', origin 'manual_chat').
        const lines = this.session.getRetrievalTranscript();
        return (tailLines !== undefined && lines.length > tailLines ? lines.slice(-tailLines) : lines).map(s => ({ speaker: s.speaker, text: s.text, timestamp: s.timestamp, ...(s.origin ? { origin: s.origin } : {}) }));
    }

    /** The running meeting's whole transcript (kept across the reset shortcut), for in-meeting search. */
    getCurrentMeetingFullTranscript(): Array<{ speaker: string; text: string; timestamp: number }> {
        return this.session.getPersistableTranscript().map(s => ({ speaker: s.speaker, text: s.text, timestamp: s.timestamp }));
    }

    /** `imagePaths`: the screenshots the answer used; the Usage tab shows previews of them. */
    logUsage(type: string, question: string, answer: string, imagePaths?: readonly string[]): void {
        this.session.logUsage(type, question, answer, imagePaths);
    }

    /**
     * Raw usage-entry passthrough, for callers that must set fields `logUsage`
     * does not expose — today only `synthetic`, which excludes an entry from
     * `SessionTracker.getRecentManualTurn` (and therefore from
     * `buildRecentManualContext`'s prompt injection) while still persisting it
     * to the Meeting Notes usage panel.
     *
     * Added 2026-08-14: a truncated manual-chat turn needs exactly that split —
     * the call was made and must be billed/shown, but its partial answer must
     * never be replayed into the next prompt as context. Without this proxy the
     * call site's `im?.pushUsage?.(…)` optional-chained into a silent no-op and
     * dropped the usage row altogether.
     */
    pushUsage(entry: any): void {
        this.session.pushUsage(entry);
    }

    // ============================================
    // Transcript Handling (delegates to engine)
    // ============================================

    handleTranscript(segment: import('./SessionTracker').TranscriptSegment): void {
        this.engine.handleTranscript(segment);
        // The live copy on disk follows finished lines (LiveMeetingJournal: a
        // timer, never a write on this path).
        if (segment?.final) this.persistence.noteLiveChange(true);
    }

    /** A line recovered after a transcription outage, at its original time (SessionTracker.insertRecoveredTranscript). */
    insertRecoveredTranscript(segment: import('./SessionTracker').TranscriptSegment): boolean {
        const inserted = this.session.insertRecoveredTranscript(segment);
        // Recovered words reach the live journal like any final line, or a crash
        // in a quiet stretch afterwards would lose them a second time.
        if (inserted) this.persistence.noteLiveChange(true);
        return inserted;
    }

    async handleSuggestionTrigger(trigger: import('./SessionTracker').SuggestionTrigger): Promise<void> {
        return this.engine.handleSuggestionTrigger(trigger);
    }

    /** Mode + cooldown gate for the Auto Answer trigger. See IntelligenceEngine.canAutoAnswer. */
    canAutoAnswer(): boolean {
        return this.engine.canAutoAnswer();
    }

    /** Barge-in: abort the streaming AUTOMATIC answer only. See IntelligenceEngine.cancelAutomaticAnswer. */
    cancelAutomaticAnswer(reason: 'user_barge_in'): boolean {
        return this.engine.cancelAutomaticAnswer(reason);
    }

    /** Auto Answer V3 offer card: register an externally built action so accept/dismiss IPC resolves it. */
    registerDynamicAction(action: import('./services/dynamic-actions/DynamicAction').DynamicAction): void {
        this.engine.registerDynamicAction(action);
    }

    // ── Auto Answer V3 narrow APIs (V2 §43) ──
    isManualAnswerActive(): boolean { return this.engine.isManualAnswerActive(); }
    /** A What-to-Answer stream is live (any kind: manual, automatic, speculative). */
    isAnswerStreaming(): boolean { return this.engine.isAnswerStreaming(); }
    noteAutoAnswerCandidate(questionId: string, candidateGeneration: number): void {
        this.engine.noteAutoAnswerCandidate(questionId, candidateGeneration);
    }
    /**
     * How many answers the session log holds. A count only: the funnel reports
     * how many answers a meeting produced, never what they were.
     */
    getAnswerCount(): number {
        try { return this.session.getFullUsage().length; } catch { return 0; }
    }

    getSpeculativeSnapshot(): { questionId: string | null; text: string | null } {
        return this.engine.getSpeculativeSnapshot();
    }
    /**
     * Start the answer while the judge is still deciding.
     *
     * This delegation was missing from the moment the prefetch landed
     * (0d5bf7fb): main.ts called it on the MANAGER while it only ever existed
     * on the ENGINE, so every call threw `is not a function` straight into the
     * defensive catch in SimpleAutoAnswer.maybePrefetch — which is exactly the
     * kind of "optimisation is never allowed to break the pipeline" guard that
     * turns a hard failure into a silent one. The feature has therefore never
     * run: no `Auto Answer prefetch fired` line appears in any captured log.
     */
    prefetchAutoAnswer(questionId: string, text: string): void {
        this.engine.prefetchAutoAnswer(questionId, text);
    }
    runAutoAnswer(
        question: Parameters<IntelligenceEngine['runAutoAnswer']>[0],
        options: { reuseSpeculative: boolean },
    ): Promise<void> {
        return this.engine.runAutoAnswer(question, { ...options, context: this.getFormattedContext(120) });
    }
    /**
     * The ONE canonical live read surface (V2 §11/§27). Lazily built over the
     * manager's session with the deterministic extractor; the session instance
     * is stable for the manager's lifetime.
     */
    getLiveTranscriptBrain(): import('./intelligence/LiveTranscriptBrain').LiveTranscriptBrain {
        if (!this.liveTranscriptBrain) {
            const { LiveTranscriptBrain } = require('./intelligence/LiveTranscriptBrain') as typeof import('./intelligence/LiveTranscriptBrain');
            const { extractLatestQuestion } = require('./llm/transcriptQuestionExtractor') as typeof import('./llm/transcriptQuestionExtractor');
            this.liveTranscriptBrain = new LiveTranscriptBrain(this.session as any, extractLatestQuestion as any);
        }
        return this.liveTranscriptBrain;
    }
    private liveTranscriptBrain: import('./intelligence/LiveTranscriptBrain').LiveTranscriptBrain | null = null;

    // ============================================
    // Mode Executors (delegates to engine)
    // ============================================

    async runAssistMode(): Promise<string | null> {
        return this.engine.runAssistMode();
    }

    async runWhatShouldISay(question?: string, confidence?: number, imagePaths?: string[], options?: { skipCooldown?: boolean; forceFresh?: boolean; screenContext?: ScreenContext; promptInstruction?: string; activeSkill?: { id: string; name: string; promptBlock: string }; domContext?: string }): Promise<string | null> {
        return this.engine.runWhatShouldISay(question, confidence, imagePaths, options);
    }

    async runFollowUp(intent: string, userRequest?: string): Promise<string | null> {
        return this.engine.runFollowUp(intent, userRequest);
    }

    async runRecap(): Promise<string | null> {
        return this.engine.runRecap();
    }

    async runClarify(): Promise<string | null> {
        return this.engine.runClarify();
    }

    async runFollowUpQuestions(): Promise<string | null> {
        return this.engine.runFollowUpQuestions();
    }

    /** What did I miss?, Define, Sound smart (llm/liveHelpers.ts). */
    async runLiveHelper(action: import('./llm/liveHelpers').LiveHelperAction, opts?: { sinceMs?: number }): Promise<string | null> {
        return this.engine.runLiveHelper(action, opts);
    }

    async runCustomButton(button: import('./llm/promptSystemV2').CustomButtonActionV2, imagePaths?: string[], readSeconds?: number): Promise<string | null> {
        return this.engine.runCustomButton(button, imagePaths, readSeconds);
    }

    async runManualAnswer(question: string): Promise<string | null> {
        return this.engine.runManualAnswer(question);
    }

    async runCodeHint(imagePaths?: string[], problemStatement?: string): Promise<string | null> {
        return this.engine.runCodeHint(imagePaths, problemStatement);
    }

    setCodingQuestion(question: string, source: 'screenshot' | 'transcript'): void {
        this.session.setCodingQuestion(question, source);
    }

    getDetectedCodingQuestion(): { question: string | null; source: 'screenshot' | 'transcript' | null } {
        return this.session.getDetectedCodingQuestion();
    }

    clearCodingQuestion(): void {
        this.session.clearCodingQuestion();
    }

    async runBrainstorm(imagePaths?: string[], problemStatement?: string): Promise<string | null> {
        return this.engine.runBrainstorm(imagePaths, problemStatement);
    }

    // ============================================
    // State Management
    // ============================================

    getActiveMode() {
        return this.engine.getActiveMode();
    }

    setMode(mode: import('./IntelligenceEngine').IntelligenceMode): void {
        // This was private in the original, but kept for compatibility
        (this.engine as any).setMode(mode);
    }

    // ============================================
    // Meeting Lifecycle (delegates to persistence)
    // ============================================

    async stopMeeting(): Promise<{ meetingId: string; memoryEligibleCount: number } | null> {
        try {
            return await this.persistence.stopMeeting();
        } finally {
            this.engine.endMeetingConversation();
        }
    }

    beginMeetingConversation(id: string): void {
        this.engine.beginMeetingConversation(id);
    }

    async recoverUnprocessedMeetings(): Promise<void> {
        return this.persistence.recoverUnprocessedMeetings();
    }

    /** The notes window's text for the running (or next) meeting; Stop passes it to the notes. */
    setLiveUserNotes(text: string): void {
        this.persistence.setLiveUserNotes(text);
    }

    /** The note template for the running (or next) meeting's notes; null clears. False for an unknown id. */
    setLiveNoteTemplate(id: string | null): boolean {
        return this.persistence.setLiveNoteTemplate(id);
    }

    getLiveNoteTemplate(): string | null {
        return this.persistence.getLiveNoteTemplate();
    }

    /** A meeting started: its transcript is kept on disk as it grows (LiveMeetingJournal). */
    beginLiveMeeting(startedAt?: number): string {
        return this.persistence.beginLiveMeeting(startedAt);
    }

    /**
     * Write the running meeting now, synchronously, for the next launch to
     * recover (quit, the OS ending the session). No notes are written here.
     */
    flushLiveMeeting(endedBy: 'quit' | 'os_session_end'): boolean {
        return this.persistence.flushLiveMeeting(endedBy);
    }

    /** Called with the meeting id each time a meeting's notes are saved or regenerated. */
    setMeetingNotesSavedListener(listener: ((meetingId: string) => void) | null): void {
        this.persistence.setNotesSavedListener(listener);
    }

    /** Regenerate V3 notes for a saved meeting (optionally with a different mode/tone). */
    async regenerateMeetingSummary(meetingId: string, opts?: { templateType?: string; modeId?: string; noteTemplateId?: string | null; tone?: 'professional' | 'warm' | 'concise' | 'friendly' | 'your_style' }): Promise<boolean> {
        return this.persistence.regenerateSavedMeeting(meetingId, opts);
    }

    /** Regenerate only the follow-up draft for a saved meeting (V3 notes or older ones). */
    async regenerateMeetingFollowUp(meetingId: string, tone?: 'professional' | 'warm' | 'concise' | 'friendly' | 'your_style'): Promise<boolean> {
        return this.persistence.regenerateFollowUpDraft(meetingId, tone);
    }

    // ============================================
    // Mode Context Management
    // ============================================

    /**
     * Clear mode-specific transient context without resetting the full session.
     * Called when user switches modes to prevent old mode's context (Interviewer
     * Q's, JD context, assistant response history) from bleeding into the new mode.
     */
    clearSessionContext(): void {
        this.session.clearSessionContext();
    }

    /**
     * Supersede every in-flight live answer (2026-07-31). Called by
     * modes:set-active: WTA supersession was generation-relative only, so a
     * slow generation planned under mode A stayed "current" through the switch
     * and streamed A's answer into a UI showing mode B. engine.reset() bumps
     * currentGenerationId (breaking every active stream's guard) and aborts
     * the WTA cancellation token.
     */
    supersedeLiveAnswers(): void {
        this.engine.reset();
    }

    // ============================================
    // Phase 3 — Dynamic Actions facade
    // ============================================

    /**
     * Bind dynamic-action engine to the active meeting/mode.
     * Caller is the IPC handler that starts a meeting (with sessionId) or
     * the modes:set-active handler that switches the active mode mid-meeting.
     */
    setDynamicActionContext(params: { sessionId: string; modeId: string; modeTemplateType: string }): void {
        this.engine.setDynamicActionContext(params);
    }

    clearDynamicActionContext(): void {
        this.engine.clearDynamicActionContext();
    }

    acceptDynamicAction(actionId: string): import('./services/dynamic-actions/DynamicAction').DynamicAction | null {
        return this.engine.acceptDynamicAction(actionId);
    }

    dismissDynamicAction(actionId: string): void {
        this.engine.dismissDynamicAction(actionId);
    }

    getActiveDynamicActions(): import('./services/dynamic-actions/DynamicAction').DynamicAction[] {
        return this.engine.getActiveDynamicActions();
    }

    // ============================================
    // Reset (resets all sub-modules)
    // ============================================

    /**
     * resetEngine: Cancel in-flight LLM streams WITHOUT touching session state.
     * Use this when swapping API keys or providers mid-session so the transcript
     * is not wiped. (full reset() also clears the session — only use that at
     * end of meeting or explicit session teardown.)
     */
    resetEngine(): void {
        this.engine.reset();
    }

    reset(): void {
        this.session.reset({ keepMeetingRecord: this.persistence.liveMeetingId !== null });
        this.engine.reset();
        this.engine.clearWtaDiversityHistory();
        // V3 conversation state (referents, active topic, previous source ids)
        // outlived every reset: it is keyed by meeting id, and outside a
        // meeting that key is a constant, so an ad-hoc session accumulated
        // referents across unrelated questions until the next mode switch.
        // Measured 2026-09-10: "Why do you want this role?" resolved to
        // "(referring to: PYQ)" from a past-paper question asked before the
        // reset. A reset is the session boundary; the referents go with it.
        try {
            require('./context-intelligence/question/conversation-state-store').clearConversationState();
        } catch { /* non-fatal — the store is process-global and optional */ }
    }
}
