// SessionTracker.ts
// Manages session state, transcript arrays, context windows, and the rolling meeting recap.
// Extracted from IntelligenceManager to decouple state management from LLM orchestration.

import { RecapLLM } from './llm';
import { isVerboseLogging } from './verboseLog';
import { makeUsagePreviews } from './services/meeting/usagePreviews';
import type { AttemptId, TurnIdentity } from './llm/turnIdentity';
import { stripGistTrailer } from '../src/lib/displayMarkup';
import { createActiveDesignState, type ActiveDesign } from '../src/lib/diagram/activeDesign.mjs';
import { replaceMermaidSource } from '../src/lib/diagram/fencedBlocks.mjs';

// Canned-fallback phrases that mean the model gave up entirely, not phrases
// that might legitimately appear inside a real answer. Matched only when the
// ENTIRE (trimmed, punctuation-stripped) message consists of one of these —
// never as a substring — so honest answers like "I'm not sure of his exact
// title, but he's on the platform team" are kept in session history instead
// of being silently dropped from contextItems/the transcript/history.
// Mirrors the equivalent guard in LLMHelper.processResponse (kept as a
// separate local copy here to avoid a cross-module import for one helper).
const CANNED_FALLBACK_PHRASES = [
    "i'm not sure",
    "it depends",
    "i can't answer",
    "i don't know",
];
function isCannedFallbackPhrase(text: string): boolean {
    const normalized = text.trim().toLowerCase().replace(/^[\s"'.!?]+|[\s"'.!?]+$/g, '');
    return CANNED_FALLBACK_PHRASES.includes(normalized);
}

/**
 * Provenance of a transcript segment (Defect B fix, 2026-08-01). Real spoken
 * audio ('stt') is the ONLY origin that is evidence for meeting memory
 * extraction; typed manual-chat questions, assistant answers, injected system
 * instructions, and test fixtures share this store but must never be mined as
 * things that "happened in the meeting". Optional so old stored segments and
 * un-migrated callers keep working — readers fall back to a documented
 * heuristic (see isMemoryEligibleSegment in intelligence/MeetingMemoryService).
 */
export type TranscriptOrigin = 'stt' | 'manual_chat' | 'assistant' | 'system_instruction' | 'test';

// Label, inside [..], of a line the user typed to the assistant in the rolling
// context. Defined in its own module so the other formatter can share it.
import { TYPED_TURN_LABEL } from './llm/typedTurnLabel';
import { insertSortedByTimestamp } from './audio/sttGapRecovery';
export { TYPED_TURN_LABEL };

export interface TranscriptSegment {
    marker?: string;
    speaker: string;
    // Optional canonical speaker id from provider diarization (e.g. "speaker_2"). Only set on
    // the remote/system channel when diarization is enabled; the mic channel is always "me".
    // Additive — summary normalization reads it when present, everything else ignores it.
    speakerId?: string;
    text: string;
    timestamp: number;
    final: boolean;
    confidence?: number;
    /** Where this segment came from. Absent = legacy/unknown writer (see TranscriptOrigin). */
    origin?: TranscriptOrigin;
    /** An assistant line that answers something the user TYPED (overlay chat or
     *  phone), as opposed to a live suggestion nobody asked for in writing.
     *  Meeting notes keep these beside the typed question they answer; every
     *  other reader still sees origin 'assistant' and treats it as before. */
    chatReply?: boolean;
    /** STT provider id that produced this segment (WTA audit F9, additive). */
    sttProvider?: string;
    /** Punctuation provenance (WTA audit F9): 'unavailable' means the provider
     *  never guaranteed punctuation — scoring must treat a missing '?' as
     *  NEUTRAL, not negative. Absent = legacy writer (same neutral treatment). */
    punctuationSource?: import('./llm/punctuationProvenance').PunctuationSource;
}

export interface SuggestionTrigger {
    context: string;
    lastQuestion: string;
    /**
     * Trigger-level confidence that `lastQuestion` is an answerable question.
     * Optional since the Auto Answer V3 campaign: the automatic trigger no
     * longer fabricates a value, and an absent confidence means "defer to the
     * planner's own classifier score" (PlannerDecision falls back to
     * intentResult.confidence).
     */
    confidence?: number;
    /**
     * True when the trigger came from the Auto Answer path rather than a user
     * action. The engine records the resulting generation so a user barge-in
     * can cancel exactly that stream and never a manual What-to-Answer.
     */
    automatic?: boolean;
    // ── Auto Answer V3 identity/quality fields (all optional, V2 §26) ──
    questionId?: string;
    answerability?: number;
    dialogueAct?: string;
    isFollowUp?: boolean;
    endpointSource?: string;
    candidateGeneration?: number;
    /** The controller verified (by id or embedding cosine) that the speculative cache answers THIS question. */
    reuseSpeculative?: boolean;
}

// Context item matching Swift ContextManager structure
export interface ContextItem {
    role: 'interviewer' | 'user' | 'assistant';
    /** A user line that was TYPED to the assistant, not said in the meeting. */
    typed?: boolean;
    text: string;
    timestamp: number;
    /** STT provider id (WTA audit F9, additive; absent on legacy/assistant items). */
    sttProvider?: string;
    /** Punctuation provenance (WTA audit F9, additive; see TranscriptSegment). */
    punctuationSource?: import('./llm/punctuationProvenance').PunctuationSource;
}

/**
 * Which conversational surface produced/consumes a turn (real-app
 * source-switch repair, 2026-07-14, Phase 9 — surface isolation). Manual chat,
 * What-to-Answer (live suggestions), and meeting auto-answer are DISTINCT
 * conversations that happen to share this session's transcript/meeting
 * context; a turn from one must not silently look like a prior turn of
 * another when resolving a follow-up referent ("what about that?"). Optional
 * (absent = legacy/unknown caller) so this is purely additive — no existing
 * write site is required to change.
 */
export type ConversationSurface = 'manual_chat' | 'what_to_answer' | 'screenshot' | 'meeting_auto_answer' | 'phone_mirror';

export interface AssistantResponse {
    text: string;
    timestamp: number;
    questionContext: string;
    /** Which surface produced this turn. Absent for legacy callers. */
    surface?: ConversationSurface;
}

export class SessionTracker {
    // Context management (mirrors Swift ContextManager)
    private contextItems: ContextItem[] = [];
    // Grounding-campaign2 fix (H7, 2026-07-17): this eviction bound must be >=
    // the largest `lastSeconds` any live call site actually requests, or
    // getContext(N) silently truncates to whatever this value is regardless of
    // N. Every live caller (IntelligenceEngine.runWhatShouldISay/
    // planSuggestionTrigger, LiveTranscriptBrain's DEFAULT_ANSWER_WINDOW_SECONDS,
    // main.ts's comp-evidence provider) requests 180s — this was hard-coded to
    // 120, so getContext(180) returned only the last ~120s of a 180s window and
    // called it a match. Raised to 180 so the write-side retention actually
    // covers every documented 180s read. Fixture-proven: traces2/... (H7).
    private readonly contextWindowDuration: number = 180; // seconds
    private readonly maxContextItems: number = 500;

    // Last assistant message for follow-up mode
    private lastAssistantMessage: string | null = null;
    // Per-surface last assistant message (Phase 9 surface isolation,
    // 2026-07-14) — populated ADDITIVELY alongside the shared
    // `lastAssistantMessage` above, never replacing it (existing meeting/WTA
    // continuity that intentionally reads the shared field is unaffected).
    // Keyed by ConversationSurface; a surface with no turns yet is simply absent.
    private lastAssistantMessageBySurface: Partial<Record<ConversationSurface, string>> = {};

    // Phase 6 Slice 1 (context-rebuild, 2026-07-25) — TurnIdentity write guard.
    // Tracks, PER SURFACE (mirroring lastAssistantMessageBySurface above — a
    // newer commit on one surface must never reject an un-superseded write on
    // a different surface), the highest AttemptId that has already committed
    // an addAssistantMessage write. attemptId is minted from a single
    // globally-monotonic counter (ipcHandlers.ts's `_chatStreamId`), so a
    // strictly SMALLER incoming attemptId is unambiguously stale. Keyed by
    // 'unspecified' for identity-tagged calls that pass no surface. Only
    // consulted when the caller passes `identity` — omitting it (every
    // existing caller, until Slice 1's ipcHandlers.ts wiring lands) is a
    // complete no-op, exactly like `surface` being optional above.
    private lastCommittedAttemptBySurface: Partial<Record<ConversationSurface | 'unspecified', AttemptId>> = {};

    // Temporal RAG: Track all assistant responses in session for anti-repetition
    private assistantResponseHistory: AssistantResponse[] = [];

    // Meeting metadata
    private currentMeetingMetadata: {
        title?: string;
        calendarEventId?: string;
        /** Filled in at start by SessionCalendarLinker when the session matches an event. */
        calendarEvent?: import('./services/calendar/calendarSessionMatch').CalendarEventSnapshot;
        /** The call it is in (a meeting tab's key), for who spoke when (meetingDetection/callRoster). */
        callKey?: string;
        source?: 'manual' | 'calendar';
        /** From the Zoom / Teams window (main: startDesktopCallSpeakers), read-only facts. */
        callSelfName?: string;
        callMeetingKey?: string;
        callParticipantCount?: number;
        /** What others shared on screen, described (services/meeting/ScreenShareContext.ts). */
        sharedScreens?: import('./services/meeting/ScreenShareContext').SharedScreenEntry[];
    } | null = null;

    // Full Session Tracking: every segment of the session, oldest first. The
    // saved meeting gets all of it; the assistant reads it from
    // assistantViewStart on (getAssistantTranscript). Until 2026-10-15 a
    // second, compacted array fed prompts and the saved meeting alike, so a
    // 187-minute meeting was saved with only its last 73 minutes (each
    // compaction dropped 500 segments past 1,800).
    private persistedTranscript: TranscriptSegment[] = [];
    // A ceiling, not a working limit: measured ~3.5 MB per 20,000 lines, and a
    // ten-hour meeting is ~15,000. Only a runaway source could reach it.
    private static readonly MAX_PERSISTED_SEGMENTS = 200_000;
    private fullUsage: any[] = []; // UsageInteraction
    // AI interactions the assistant no longer holds but the saved meeting
    // keeps: those before a reset made during a running meeting, and those
    // past the 500-entry cap of fullUsage (which used to drop them from the
    // saved meeting too).
    private usageArchive: any[] = [];
    // In memory: the live journal rewrites the whole session every few seconds
    // (LiveMeetingJournal), and its row grows with this archive: measured 0.4 ms
    // a write at 3 hours, 23 ms (84 worst) with 10,000 answers. Answers past it
    // go to usageOverflowSink, written once each, and are read back at Stop and
    // at recovery, so none is lost (2026-10-16).
    private static readonly MAX_ARCHIVED_USAGE = 1_000;
    private usageOverflowSink: ((entries: any[]) => void) | null = null;
    // Screenshot previews (base64 JPEGs) in the archive are bounded too: past
    // this many characters the oldest archived answers keep their text and
    // lose their previews. (fullUsage's own 500 still hold theirs.)
    private static readonly MAX_ARCHIVED_IMAGE_CHARS = 64 * 1024 * 1024;
    private archivedImageChars = 0;
    // Where the assistant's view of the transcript starts in persistedTranscript:
    // 0, or the length at a reset made during a running meeting (the assistant
    // forgets what came before; the saved meeting does not).
    private assistantViewStart = 0;
    // When that view began (Date.now() of a reset made during a running
    // meeting), or 0. Lets stores keyed by time, like the live semantic index,
    // forget the same lines (2026-10-16: it kept answering from before a reset).
    private assistantViewStartedAt = 0;
    private sessionStartTime: number = Date.now();

    // Rolling recap of the meeting (2026-10-15), for "summarise the meeting so
    // far": a typed summary request is otherwise answered from the six
    // retrieved windows, a few minutes of a long meeting. Each block of
    // RECAP_BLOCK_LINES spoken lines is summarised once, in the background,
    // after any answer in flight (ForegroundGate); nothing is evicted. Replaces
    // the compaction recap, whose output nothing read.
    private static readonly RECAP_BLOCK_LINES = 400;
    private static readonly MAX_RECAPS = 60;
    private static readonly RECAP_RETRY_MS = 60_000;
    private meetingRecaps: Array<{ fromTs: number; toTs: number; lines: number; text: string }> = [];
    // Index in persistedTranscript up to which recaps exist (or were attempted).
    private recapCursor = 0;
    private isRecapping: boolean = false;
    private recapFailedAt = 0;

    // Advanced by reset() only. The recap call reads it before its await and
    // drops its result if it moved, so an ended session cannot write into the
    // next one. clearSessionContext() keeps the transcript and does NOT advance
    // it: a recap in flight across a mode switch still applies.
    private sessionEpoch: number = 0;
    // Advanced by reset() AND clearSessionContext(). An answer asked before
    // either (phone-mirror, launcher or overlay chat) is still shown, but not
    // saved into the context that replaced the one it was asked in.
    private contextEpoch: number = 0;

    // Track interim interviewer segment
    private lastInterimInterviewer: TranscriptSegment | null = null;

    // Detected coding question from transcript or screenshot extraction
    private detectedCodingQuestion: string | null = null;
    private codingQuestionSource: 'screenshot' | 'transcript' | null = null;
    private codingQuestionSetAt: number | null = null;

    // The system design currently on the table (latest valid Mermaid diagram,
    // its view and version). ONE shared instance for every route that records
    // through addAssistantMessage — typed chat, What to Answer, Auto Answer,
    // follow-ups — so a design drawn on one surface can be refined from
    // another. Cleared with the session context (new meeting, mode switch,
    // reset); expires on its own after a quiet half hour.
    private activeDesign = createActiveDesignState();

    // Rolling buffer for multi-segment interviewer question detection
    private recentInterviewerBuffer: { text: string; timestamp: number }[] = [];
    private static readonly INTERVIEWER_BUFFER_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
    // Screenshot-detected question stays sticky for 3 min before transcript can override
    private static readonly SCREENSHOT_STALE_MS = 3 * 60 * 1000;

    // Reference to RecapLLM for the rolling meeting recap (injected later)
    private recapLLM: RecapLLM | null = null;

    // ============================================
    // Configuration
    // ============================================

    public setRecapLLM(recapLLM: RecapLLM | null): void {
        this.recapLLM = recapLLM;
    }

    public setMeetingMetadata(metadata: any): void {
        this.currentMeetingMetadata = metadata;
    }

    public getMeetingMetadata() {
        return this.currentMeetingMetadata;
    }

    public clearMeetingMetadata(): void {
        this.currentMeetingMetadata = null;
    }

    // ============================================
    // Coding Question Tracking
    // ============================================

    /**
     * Set the current coding question.
     * Priority rules (avoids stale Q1 blocking Q2 detection in multi-question interviews):
     *  - Screenshot → always stored immediately (explicit user action via Solve)
     *  - Transcript → stored if nothing is known yet, OR if existing question is also from
     *    transcript (newer detection = newer question), OR if screenshot question is stale
     *    (> 3 min old — user likely moved to the next question)
     */
    setCodingQuestion(question: string, source: 'screenshot' | 'transcript'): void {
        const now = Date.now();
        const trimmed = question.trim();
        if (!trimmed) return;

        if (this.detectedCodingQuestion === null) {
            // Nothing stored — accept any source
            this.detectedCodingQuestion = trimmed;
            this.codingQuestionSource = source;
            this.codingQuestionSetAt = now;
            console.log(`[SessionTracker] Coding question stored`, { source, length: trimmed.length });
            return;
        }

        if (source === 'screenshot') {
            // Screenshot always updates immediately (explicit user Solve action)
            this.detectedCodingQuestion = trimmed;
            this.codingQuestionSource = source;
            this.codingQuestionSetAt = now;
            console.log(`[SessionTracker] Coding question updated via screenshot`, { length: trimmed.length });
            return;
        }

        // source === 'transcript'
        const isStale = this.codingQuestionSetAt !== null
            && (now - this.codingQuestionSetAt) > SessionTracker.SCREENSHOT_STALE_MS;
        const canOverride = this.codingQuestionSource === 'transcript' || isStale;

        if (canOverride) {
            this.detectedCodingQuestion = trimmed;
            this.codingQuestionSource = source;
            this.codingQuestionSetAt = now;
            console.log(`[SessionTracker] Coding question updated via transcript`, { source: this.codingQuestionSource, stale: isStale, length: trimmed.length });
        } else {
            console.log(`[SessionTracker] Transcript question ignored — screenshot question is recent (< ${SessionTracker.SCREENSHOT_STALE_MS / 1000}s)`);
        }
    }

    getDetectedCodingQuestion(): { question: string | null; source: 'screenshot' | 'transcript' | null; setAt: number | null } {
        return { question: this.detectedCodingQuestion, source: this.codingQuestionSource, setAt: this.codingQuestionSetAt };
    }

    clearCodingQuestion(): void {
        this.detectedCodingQuestion = null;
        this.codingQuestionSource = null;
        this.codingQuestionSetAt = null;
        this.recentInterviewerBuffer = [];
    }

    /**
     * Clear all mode-specific transient context.
     * Called when the user switches modes mid-meeting to prevent the old mode's
     * context (Interviewer Q's, JD context, assistant responses, etc.) from
     * bleeding into the new mode's responses.
     */
    clearSessionContext(): void {
        this.contextItems = [];
        this.activeDesign.clear();
        this.pendingDiagramRepairs = [];
        this.lastRepairedAnswer = null;
        this.detectedCodingQuestion = null;
        this.codingQuestionSource = null;
        this.codingQuestionSetAt = null;
        this.recentInterviewerBuffer = [];
        this.lastAssistantMessage = null;
        this.assistantResponseHistory = [];
        this.lastInterimInterviewer = null;
        this.contextEpoch++;
        console.log('[SessionTracker] Mode-specific session context cleared');
    }

    /**
     * Heuristic to decide if an interviewer statement looks like a coding question.
     * Requires ≥2 of the signal patterns and minimum length to avoid false positives
     * on casual conversation ("can you implement X?" → yes, "sounds good!" → no).
     */
    private looksLikeCodingQuestion(text: string): boolean {
        if (text.length < 50) return false;
        const patterns = [
            /\b(implement|write|code|solve|design|build|create)\b/i,
            /\b(given\s+(an?|the)\s+(array|string|list|tree|graph|matrix|number|integer|node|linked list|stack|queue|heap))\b/i,
            /\b(return|find\s+(all|the|a|any)|count|check\s+if|determine|calculate|maximize|minimize|sort)\b/i,
            /\b(function|method|algorithm|data structure|class)\b/i,
            /\b(O\(n\)|time complexity|space complexity|optimal|efficient|brute force)\b/i,
            /\b(two sum|three sum|binary search|dynamic programming|BFS|DFS|palindrome|anagram|substring|subarray|rotation)\b/i,
        ];
        const matchCount = patterns.filter(p => p.test(text)).length;
        return matchCount >= 2;
    }

    // ============================================
    // Context Management
    // ============================================

    /**
     * Add a transcript segment to context.
     * Only stores FINAL transcripts.
     * Returns { role, isRefinementCandidate } so the engine can decide whether to trigger follow-up.
     */
    addTranscript(segment: TranscriptSegment): { role: 'interviewer' | 'user' | 'assistant' } | null {
        if (!segment.final) return null;

        const role = this.mapSpeakerToRole(segment.speaker);
        const text = segment.text.trim();

        if (!text) return null;

        // Deduplicate: check if this exact item already exists
        const lastItem = this.contextItems[this.contextItems.length - 1];
        if (lastItem &&
            lastItem.role === role &&
            Math.abs(lastItem.timestamp - segment.timestamp) < 500 &&
            lastItem.text === text) {
            return null;
        }

        this.contextItems.push({
            role,
            text,
            timestamp: segment.timestamp,
            ...(role === 'user' && segment.origin === 'manual_chat' ? { typed: true } : {}),
            // F9 provenance rides along when the seam supplied it (additive;
            // legacy writers leave both undefined = neutral treatment).
            ...(segment.sttProvider ? { sttProvider: segment.sttProvider } : {}),
            ...(segment.punctuationSource ? { punctuationSource: segment.punctuationSource } : {}),
        });

        this.evictOldEntries();

        // Filter out only exact internal system prompts (not broad prefix match)
        // These are injected internally and should not be treated as real transcript
        const knownInternalPrompts = [
            "You are a real-time interview assistant",
            "You are a helper",
        ];
        const isExactInternalPrompt = knownInternalPrompts.some(p => text === p);
        const isContextInjection = text.startsWith("CONTEXT:");
        const isInternalPrompt = isExactInternalPrompt || isContextInjection;

        if (!isInternalPrompt) {
            // Add to session transcript
            this.keepForPersistence(segment);
            // Fire-and-forget; errors are caught internally
            void this.recapIfDue().catch(e =>
                console.warn('[SessionTracker] meeting recap error (non-fatal):', e)
            );
        }

        return { role };
    }

    /**
     * A line recovered after a transcription outage (audio/sttGapRecovery.ts),
     * put back at the time it was SAID, so the saved transcript and the notes
     * read in order. Unlike handleTranscript it triggers nothing: no answer,
     * no coding-question detection, no refinement. The rolling context gets it
     * too when it still falls inside the window.
     */
    insertRecoveredTranscript(segment: TranscriptSegment): boolean {
        const text = (segment.text || '').trim();
        if (!text || !segment.final) return false;
        // Into the whole transcript, at the time it was said. A line from
        // before a reset made during the meeting stays out of the assistant's
        // view; one inside an already recapped block is not recapped again.
        const at = insertSortedByTimestamp(this.persistedTranscript, { ...segment, text });
        if (at < this.assistantViewStart) this.assistantViewStart++;
        if (at < this.recapCursor) this.recapCursor++;
        if (this.persistedTranscript.length > SessionTracker.MAX_PERSISTED_SEGMENTS) {
            this.persistedTranscript.shift();
            if (this.assistantViewStart > 0) this.assistantViewStart--;
            if (this.recapCursor > 0) this.recapCursor--;
        }
        const cutoff = Date.now() - (this.contextWindowDuration * 1000);
        if (segment.timestamp >= cutoff) {
            insertSortedByTimestamp(this.contextItems, {
                role: this.mapSpeakerToRole(segment.speaker),
                text,
                timestamp: segment.timestamp,
                ...(segment.sttProvider ? { sttProvider: segment.sttProvider } : {}),
                ...(segment.punctuationSource ? { punctuationSource: segment.punctuationSource } : {}),
            });
        }
        return true;
    }

    /**
     * Add assistant-generated message to context
     */
    addAssistantMessage(
        text: string,
        // `answersSpokenQuestion`: the Answer button sends what the user SAID
        // through the typed-chat handler, so its reply arrives on the
        // 'manual_chat' surface too. It is a live suggestion, not a reply to
        // typed chat, and must not be tagged (or noted) as one.
        writeDecision?: { policy?: 'store_conversational_only' | 'store_non_authoritative' | 'do_not_store'; reason?: string; blockedFromSessionTracker?: boolean; answersSpokenQuestion?: boolean },
        // Phase 9 surface isolation (2026-07-14): OPTIONAL — absent means the
        // caller hasn't been updated yet, and this write behaves exactly as
        // before (shared lastAssistantMessage / assistantResponseHistory
        // only). Passing a surface additionally populates the per-surface map
        // a same-surface-only reader (getLastAssistantMessage(surface)) can
        // consult, without changing what the shared, cross-surface state sees.
        surface?: ConversationSurface,
        // Phase 6 Slice 1 (context-rebuild, 2026-07-25): OPTIONAL — absent
        // means the caller hasn't been updated yet (every existing caller,
        // today), and this write behaves exactly as before. Passing an
        // identity additionally rejects the write if a newer attempt for the
        // same surface has already committed (see
        // lastCommittedAttemptBySurface above).
        identity?: TurnIdentity,
    ): boolean {
        // A diagram of this answer that the overlay already repaired (the
        // repair can land while the answer is still streaming, before any of
        // it is recorded here) is recorded repaired.
        {
            const before = text;
            text = this.withPendingDiagramRepairs(text);
            this.lastRepairedAnswer = text !== before ? { before: stripGistTrailer(before), after: stripGistTrailer(text) } : null;
        }
        console.log(`[SessionTracker] addAssistantMessage called`, { length: text.length, policy: writeDecision?.policy || 'store_conversational_only', surface: surface ?? 'unspecified' });

        // TurnIdentity write guard — checked FIRST, before any other filter
        // and before either of this method's two writes, in the SAME
        // synchronous call (this method has no `await`, so nothing can
        // interleave between this check and the writes below — the
        // non-interleavable-block requirement the migration plan calls for
        // falls out of the method already being synchronous, not from any
        // added locking).
        if (identity) {
            const key = surface ?? 'unspecified';
            const lastCommitted = this.lastCommittedAttemptBySurface[key];
            if (lastCommitted != null && identity.attemptId < lastCommitted) {
                console.warn(`[SessionTracker] Rejected stale-attempt assistant message`, {
                    surface: key,
                    attemptId: identity.attemptId,
                    lastCommittedAttemptId: lastCommitted,
                });
                return false;
            }
        }

        if (writeDecision?.policy === 'do_not_store' || writeDecision?.blockedFromSessionTracker) {
            console.warn(`[SessionTracker] Blocked assistant message by write policy`, { reason: writeDecision?.reason || 'unspecified' });
            return false;
        }

        // Natively-style filtering
        if (!text) return false;

        // Prompt System v2 no-action sentinel (2026-08-01): [[NO_ACTION]] is a
        // machine signal, never a message. It must not enter contextItems,
        // the transcript (and therefore meeting recaps, DB transcripts, or
        // meeting persistence), lastAssistantMessage, or response history —
        // regardless of which of the ~23 call sites forgot to gate it.
        try {
            const { shouldSuppressModelOutput } = require('./llm/promptSystemV2') as typeof import('./llm/promptSystemV2');
            if (shouldSuppressModelOutput(text)) {
                console.warn(`[SessionTracker] Suppressed no-action sentinel (never stored)`);
                return false;
            }
        } catch { /* non-fatal — fall through to normal filtering */ }

        // The trailing [[GIST]] line is display metadata (the overlay/phone
        // chip), never answer text: history, the meeting transcript, the
        // usage log and every follow-up that re-reads the last answer get the
        // answer without it. One chokepoint for all ~30 callers.
        const cleanText = stripGistTrailer(text).trim();
        if (cleanText.length < 10) {
            console.warn(`[SessionTracker] Ignored short message (<10 chars)`);
            return false;
        }

        if (isCannedFallbackPhrase(cleanText)) {
            console.warn(`[SessionTracker] Ignored fallback message`);
            return false;
        }

        this.contextItems.push({
            role: 'assistant',
            text: cleanText,
            timestamp: Date.now()
        });

        // Also add to the transcript so it persists in the session history (and summaries)
        const assistantSegment: TranscriptSegment = {
            speaker: 'assistant',
            text: cleanText,
            timestamp: Date.now(),
            final: true,
            confidence: 1.0,
            // Defect B (2026-08-01): assistant answers are NOT meeting evidence.
            // Meeting-memory extraction filters on origin === 'stt'.
            origin: 'assistant',
            ...((surface === 'manual_chat' || surface === 'phone_mirror') && writeDecision?.answersSpokenQuestion !== true ? { chatReply: true } : {}),
        };
        this.keepForPersistence(assistantSegment);

        this.lastAssistantMessage = cleanText;
        if (surface) {
            this.lastAssistantMessageBySurface[surface] = cleanText;
        }
        // A final answer carrying a valid diagram becomes (or updates) the
        // design on the table. An answer without one leaves it untouched.
        try { this.activeDesign.observeAnswer(cleanText); } catch { /* continuity only */ }
        if (identity) {
            this.lastCommittedAttemptBySurface[surface ?? 'unspecified'] = identity.attemptId;
        }

        // Temporal RAG: Track response history for anti-repetition
        this.assistantResponseHistory.push({
            text: cleanText,
            timestamp: Date.now(),
            questionContext: this.getLastInterviewerTurn() || 'unknown',
            surface,
        });

        // Keep history bounded (last 10 responses)
        if (this.assistantResponseHistory.length > 10) {
            this.assistantResponseHistory = this.assistantResponseHistory.slice(-10);
        }

        console.log(`[SessionTracker] lastAssistantMessage updated, history size: ${this.assistantResponseHistory.length}`);
        this.evictOldEntries();
        return true;
    }

    /**
     * Handle incoming transcript from native audio service
     */
    handleTranscript(segment: TranscriptSegment): { role: 'interviewer' | 'user' | 'assistant' } | null {
        // Track interim segments for interviewer to prevent data loss on stop
        if (segment.speaker === 'user') {
            if (isVerboseLogging() && (Math.random() < 0.05 || segment.final)) {
                console.log(`[SessionTracker] RX User Segment`, { final: segment.final, length: segment.text.length });
            }
        }
        if (segment.speaker === 'interviewer') {
            if (isVerboseLogging() && (Math.random() < 0.05 || segment.final)) {
                console.log(`[SessionTracker] RX Interviewer Segment`, { final: segment.final, length: segment.text.length });
            }

            if (!segment.final) {
                this.lastInterimInterviewer = segment;
            } else {
                this.lastInterimInterviewer = null;

                // Add segment to rolling buffer and evict old entries
                this.recentInterviewerBuffer.push({ text: segment.text, timestamp: segment.timestamp });
                const bufferCutoff = Date.now() - SessionTracker.INTERVIEWER_BUFFER_WINDOW_MS;
                this.recentInterviewerBuffer = this.recentInterviewerBuffer.filter(e => e.timestamp >= bufferCutoff);

                // Test single segment first; if no match, test accumulated recent turns
                // (interviewer may state a problem across multiple speech segments)
                if (this.looksLikeCodingQuestion(segment.text)) {
                    this.setCodingQuestion(segment.text, 'transcript');
                } else if (this.recentInterviewerBuffer.length > 1) {
                    const combinedText = this.recentInterviewerBuffer.map(e => e.text).join(' ');
                    if (this.looksLikeCodingQuestion(combinedText)) {
                        this.setCodingQuestion(combinedText, 'transcript');
                    }
                }
            }
        }

        return this.addTranscript(segment);
    }

    // ============================================
    // Context Accessors
    // ============================================

    /**
     * Get context items within the last N seconds
     */
    getContext(lastSeconds: number = 120): ContextItem[] {
        const cutoff = Date.now() - (lastSeconds * 1000);
        return this.contextItems.filter(item => item.timestamp >= cutoff);
    }

    /**
     * DURABLE context window (Intelligence OS, 2026-06-12). Unlike `getContext()`,
     * which reads `contextItems` — hard-evicted to `contextWindowDuration` (180s) on
     * EVERY final segment by `evictOldEntries()` — this reads the session's
     * persisted store that survives the 180s eviction. It exists to make
     * genuinely long-range recall possible: a project named at minute 1 is still
     * present at minute 62.
     *
     * WHY THIS METHOD EXISTS: `IntelligenceEngine.LIVE_MEMORY_WINDOW_SECONDS = 7200`
     * fed `getContext(7200)` into the long-range follow-up memory and assumed a 2h
     * window. But `contextItems` can never hold more than ~180s, so that path
     * silently saw at most the last two minutes — the long-range entity it was built
     * to recall had already been evicted. Pointing it at the durable store fixes the
     * bug for the common case.
     *
     * Reads the whole transcript since the last reset (2026-10-15: it read a
     * compacted copy, so past 1,800 lines compaction took the oldest 500 out of
     * this window as well). Bounded by `lastSeconds` and by the last reset.
     *
     * @param lastSeconds Window size in seconds (default 7200 = 2h). `Infinity`
     *   returns every line since the last reset.
     */
    private static readonly DURABLE_SCAN_OLDER_RUN = 200;

    getDurableContext(lastSeconds: number = 7200): ContextItem[] {
        const cutoff = Number.isFinite(lastSeconds)
            ? Date.now() - (lastSeconds * 1000)
            : -Infinity;
        const out: ContextItem[] = [];
        // Found from the end: lines arrive roughly in time order, so the window starts where a
        // run of lines older than the cutoff begins (a run, not the first one,
        // because providers' timestamps can be slightly out of order). This
        // keeps each call proportional to the window, not to the meeting.
        const lines = this.persistedTranscript;
        let from = lines.length;
        for (let i = lines.length - 1, olderRun = 0; i >= this.assistantViewStart; i--) {
            if (lines[i].timestamp < cutoff) {
                if (++olderRun >= SessionTracker.DURABLE_SCAN_OLDER_RUN) break;
            } else {
                olderRun = 0;
                from = i;
            }
        }
        for (let i = from; i < lines.length; i++) {
            const seg = lines[i];
            if (seg.timestamp < cutoff) continue;
            const text = (seg.text || '').trim();
            if (!text) continue;
            const role = this.mapSpeakerToRole(seg.speaker);
            out.push({ role, text, timestamp: seg.timestamp, ...(role === 'user' && seg.origin === 'manual_chat' ? { typed: true } : {}) });
        }
        return out;
    }

    /**
     * The last assistant message. With NO argument, returns the shared,
     * cross-surface value (unchanged legacy behavior — meeting/WTA continuity
     * that intentionally wants "the last thing said on ANY surface" keeps
     * working exactly as before).
     *
     * With a `surface` argument (Phase 9 surface isolation, 2026-07-14),
     * returns ONLY that surface's own last message — `null` if that surface
     * has never written one, even if a DIFFERENT surface has. Use this for a
     * follow-up-referent resolution that must not treat a WTA/meeting answer
     * as the user's own prior manual-chat turn (the reported "concatenated/
     * unrelated WTA responses leaking into manual chat" defect).
     */
    getLastAssistantMessage(surface?: ConversationSurface): string | null {
        if (surface) {
            return this.lastAssistantMessageBySurface[surface] ?? null;
        }
        return this.lastAssistantMessage;
    }

    getAssistantResponseHistory(surface?: ConversationSurface): AssistantResponse[] {
        if (surface) {
            return this.assistantResponseHistory.filter((r) => r.surface === surface);
        }
        return this.assistantResponseHistory;
    }

    getLastInterimInterviewer(): TranscriptSegment | null {
        return this.lastInterimInterviewer;
    }

    /**
     * Context items for LLM prompts, including the latest interim interviewer
     * partial when finals have not caught up yet (matches What to Answer path).
     */
    getContextWithInterim(lastSeconds: number = 120): ContextItem[] {
        const contextItems = [...this.getContext(lastSeconds)];

        // RC-1 (session C, 2026-08-21): same resolver as the WTA injection site
        // in IntelligenceEngine — a cumulative provider interim (measured up to
        // 10K chars) must never be appended whole; only its novel tail is.
        const lastInterim = this.lastInterimInterviewer;
        if (lastInterim && lastInterim.text.trim().length > 0) {
            const { resolveInterimInjection } = require('./llm/interimInjectionGuard') as typeof import('./llm/interimInjectionGuard');
            const verdict = resolveInterimInjection({
                interim: { text: lastInterim.text, timestamp: lastInterim.timestamp },
                recentInterviewerFinals: contextItems.filter(item => item.role === 'interviewer'),
                lastContextItem: contextItems[contextItems.length - 1] ?? null,
                now: Date.now(),
            });
            if (verdict.action === 'inject') {
                contextItems.push({
                    role: 'interviewer',
                    text: verdict.text,
                    timestamp: lastInterim.timestamp,
                });
            }
        }

        return contextItems;
    }

    /**
     * Get formatted context string for LLM prompts
     */
    getFormattedContext(lastSeconds: number = 120): string {
        return this.formatContextItems(this.getContext(lastSeconds));
    }

    /**
     * What people SAID in the last `lastSeconds`, formatted like
     * getFormattedContext, read from the durable transcript. getFormattedContext
     * reads the rolling window, which is evicted after three minutes whatever
     * is asked for: "draw what we discussed" was handed at most three minutes
     * of a meeting however long the window it asked for. Speech only — the
     * assistant's own suggestions are not something anyone described.
     */
    getFormattedSpeech(lastSeconds: number = 600): string {
        return this.formatContextItems(this.getDurableContext(lastSeconds).filter((item) => item.role !== 'assistant' && !item.typed));
    }

    /**
     * Formatted context including rolling interim interviewer speech.
     */
    getFormattedContextWithInterim(lastSeconds: number = 120): string {
        return this.formatContextItems(this.getContextWithInterim(lastSeconds));
    }

    private formatContextItems(items: ContextItem[]): string {
        return items.map(item => {
            // A typed line is the user's, but it was never said aloud. Labelled
            // [ME] it reached the prompt as the meeting's own speech — a typed
            // "hi" was handed to the model as something said in the meeting,
            // beside the same "hi" as a User line (2026-10-04). The label is
            // upper-case words only so the label strippers and the two turn
            // parsers (TYPED_TURN_LABEL's importers) treat it like the others.
            const label = item.role === 'interviewer' ? 'INTERVIEWER' :
                item.role === 'user' ? (item.typed ? TYPED_TURN_LABEL : 'ME') :
                    'ASSISTANT (PREVIOUS SUGGESTION)';
            return `[${label}]: ${item.text}`;
        }).join('\n');
    }

    /**
     * Get the last interviewer turn
     */
    getLastInterviewerTurn(): string | null {
        for (let i = this.contextItems.length - 1; i >= 0; i--) {
            if (this.contextItems[i].role === 'interviewer') {
                return this.contextItems[i].text;
            }
        }
        return null;
    }

    /**
     * Get full session context from accumulated transcript (User + Interviewer + Assistant)
     */
    getFullSessionContext(): string {
        const recentTranscript = this.getAssistantTranscript().slice(this.recapCursor > this.assistantViewStart ? this.recapCursor - this.assistantViewStart : 0).map(segment => {
            const role = this.mapSpeakerToRole(segment.speaker);
            const label = role === 'interviewer' ? 'INTERVIEWER' :
                role === 'user' ? 'ME' :
                    'ASSISTANT';
            return `[${label}]: ${segment.text}`;
        }).join('\n');

        // Prepend epoch summaries for full session context preservation
        if (this.meetingRecaps.length > 0) {
            const epochContext = this.meetingRecaps.map(r => r.text).join('\n---\n');
            return `[SESSION HISTORY - EARLIER DISCUSSION]\n${epochContext}\n\n[RECENT TRANSCRIPT]\n${recentTranscript}`;
        }

        return recentTranscript;
    }

    // ============================================
    // Session Data Accessors (for MeetingPersistence)
    // ============================================

    /** Every line since the last reset (the same as getAssistantTranscript()). */
    getFullTranscript(): TranscriptSegment[] {
        return this.getAssistantTranscript();
    }

    /** Every segment of the session, oldest first, for saving the meeting. */
    getPersistableTranscript(): TranscriptSegment[] {
        return this.persistedTranscript;
    }

    private keepForPersistence(segment: TranscriptSegment): void {
        this.persistedTranscript.push(segment);
        if (this.persistedTranscript.length > SessionTracker.MAX_PERSISTED_SEGMENTS) {
            console.warn('[SessionTracker] persisted transcript hit its ceiling; dropping the oldest line');
            this.persistedTranscript.shift();
            if (this.assistantViewStart > 0) this.assistantViewStart--;
            if (this.recapCursor > 0) this.recapCursor--;
        }
    }

    /**
     * The meeting starts now. The start time was otherwise left at the last
     * reset() (the previous meeting's stop, or app launch), so a meeting's
     * saved start and duration included the idle time before it.
     */
    markMeetingStart(at: number = Date.now()): void {
        this.sessionStartTime = at;
    }

    getFullUsage(): any[] {
        return this.fullUsage;
    }

    /** Receives the oldest archived interactions as they leave memory (the running meeting writes them to disk). */
    setUsageOverflowSink(sink: ((entries: any[]) => void) | null): void {
        this.usageOverflowSink = sink;
    }

    /** Every AI interaction of the meeting still in memory, for saving it (includes those before a mid-meeting reset). */
    getPersistableUsage(): any[] {
        return this.usageArchive.length > 0 ? [...this.usageArchive, ...this.fullUsage] : this.fullUsage;
    }

    private archiveUsage(entries: any[]): void {
        if (entries.length === 0) return;
        const imageChars = (e: any): number => (Array.isArray(e?.images) ? e.images.reduce((n: number, img: unknown) => n + (typeof img === 'string' ? img.length : 0), 0) : 0);
        this.usageArchive.push(...entries);
        for (const e of entries) this.archivedImageChars += imageChars(e);
        if (this.usageArchive.length > SessionTracker.MAX_ARCHIVED_USAGE) {
            const dropped = this.usageArchive.slice(0, this.usageArchive.length - SessionTracker.MAX_ARCHIVED_USAGE);
            for (const e of dropped) this.archivedImageChars -= imageChars(e);
            // Their text goes to disk; screenshot previews of answers this old do not.
            try { this.usageOverflowSink?.(dropped.map((e) => (Array.isArray(e?.images) ? (({ images: _i, ...rest }) => rest)(e) : e))); }
            catch (err) { console.warn('[SessionTracker] usage overflow sink failed (non-fatal):', err); }
            this.usageArchive = this.usageArchive.slice(-SessionTracker.MAX_ARCHIVED_USAGE);
        }
        // A copy without previews replaces the entry: the original object may
        // still be held by whoever logged it.
        for (let i = 0; i < this.usageArchive.length && this.archivedImageChars > SessionTracker.MAX_ARCHIVED_IMAGE_CHARS; i++) {
            const chars = imageChars(this.usageArchive[i]);
            if (chars === 0) continue;
            const { images: _images, ...rest } = this.usageArchive[i];
            this.usageArchive[i] = rest;
            this.archivedImageChars -= chars;
        }
    }

    /** Date.now() of the last reset made during a running meeting, else 0. */
    getAssistantViewStartedAt(): number {
        return this.assistantViewStartedAt;
    }

    /**
     * The transcript the assistant reads for recall and retrieval: every line
     * since the last reset. `maxLines` keeps the newest that many, for readers
     * whose cost grows with the line count.
     */

    getAssistantTranscript(maxLines: number = Infinity): TranscriptSegment[] {
        const from = Math.max(this.assistantViewStart, this.persistedTranscript.length - maxLines);
        return from <= 0 ? this.persistedTranscript : this.persistedTranscript.slice(from);
    }

    // The keyword (BM25) index over the live transcript is rebuilt for every
    // question: measured ~34 ms at 5,000 lines, ~93 ms at 15,000. The newest
    // 6,000 lines (some 3.5 hours of speech) keep that cost off the first word
    // of an answer; the embedded (JIT) index covers the whole meeting.
    private static readonly RETRIEVAL_MAX_LINES = 6000;

    /** The transcript retrieval reads for a question (see RETRIEVAL_MAX_LINES). */
    getRetrievalTranscript(): TranscriptSegment[] {
        return this.getAssistantTranscript(SessionTracker.RETRIEVAL_MAX_LINES);
    }

    getRecentManualTurn(maxAgeMs: number = 5 * 60 * 1000): { question: string; answer: string; timestamp: number } | null {
        // Usage entries are appended chronologically by current callers; if a future
        // restore/replay path pushes out-of-order entries, sort by timestamp here.
        const cutoff = Date.now() - maxAgeMs;
        for (let i = this.fullUsage.length - 1; i >= 0; i--) {
            const entry = this.fullUsage[i];
            if (!entry || entry.timestamp < cutoff) continue;
            if (entry.type !== 'chat') continue;
            if (entry.source !== 'manual_chat') continue;
            if (entry.synthetic === true) continue;

            const question = typeof entry.question === 'string' ? entry.question.trim() : '';
            const answer = typeof entry.answer === 'string' ? entry.answer.trim() : '';
            if (!question || !answer) continue;
            if (question === 'Clarify Question' || question === 'Recap Meeting') continue;

            return { question, answer, timestamp: entry.timestamp };
        }
        return null;
    }

    getSessionStartTime(): number {
        return this.sessionStartTime;
    }

    getSessionEpoch(): number {
        return this.sessionEpoch;
    }

    getContextEpoch(): number {
        return this.contextEpoch;
    }

    // ============================================
    // Usage Tracking
    // ============================================

    /**
     * Cap usage array with simple eviction (usage doesn't need summarization)
     */
    capUsageArray(): void {
        if (this.fullUsage.length > 500) {
            // Out of the assistant's memory, still in the saved meeting.
            this.archiveUsage(this.fullUsage.slice(0, this.fullUsage.length - 500));
            this.fullUsage = this.fullUsage.slice(-500);
        }
    }

    /**
     * Public method to log usage from external sources (e.g. IPC direct chat)
     */
    logUsage(type: string, question: string, answer: string, imagePaths?: readonly string[]): void {
        this.pushUsage({
            type,
            timestamp: Date.now(),
            question,
            answer: typeof answer === 'string' ? stripGistTrailer(answer) : answer,
            source: type === 'chat' ? 'manual_chat' : 'external',
            imagePaths,
        });
    }

    // ============================================
    // Active design (system-design diagrams)
    // ============================================

    /** The design on the table, or null. */
    getActiveDesign(): ActiveDesign | null {
        try { return this.activeDesign.get(); } catch { return null; }
    }

    /** A fresh design turn is starting; remember what it asked (a hint only). */
    noteDesignQuestion(question: string | null | undefined): void {
        try { this.activeDesign.noteDesignQuestion(question); } catch { /* hint only */ }
    }

    /**
     * Says what the turn being answered is: a follow-up on the design (keep it
     * in focus through the answer), or not one (`false`: forget a mark left by
     * a follow-up that was never answered).
     */
    touchActiveDesign(followsUp: boolean = true, mayFollowUp: boolean = false): void {
        try {
            if (followsUp) this.activeDesign.touch();
            else this.activeDesign.untouch();
            // An undecided turn: the model was handed the design and decides
            // whether the turn is about it (see activeDesign.consider).
            if (!followsUp && mayFollowUp) this.activeDesign.consider();
        } catch { /* hint only */ }
    }

    /** Drop the design (a new meeting must not inherit the previous one's). */
    clearActiveDesign(): void {
        this.activeDesign.clear();
        this.pendingDiagramRepairs = [];
        this.lastRepairedAnswer = null;
    }

    /**
     * The renderer repaired a Mermaid block that did not parse. Put the working
     * source wherever the broken one was recorded — the design on the table,
     * the last answer, and the usage log that becomes the saved meeting — so a
     * reopened meeting draws the repaired diagram. Exact-source match only: a
     * repair can never be merged into a different answer.
     */
    applyDiagramRepair(originalSource: string, repairedSource: string): boolean {
        let changed = false;
        try { changed = this.activeDesign.applyRepair(originalSource, repairedSource) || changed; } catch { /* ignore */ }
        const swap = (text: unknown): unknown => {
            if (typeof text !== 'string') return text;
            const next = replaceMermaidSource(text, originalSource, repairedSource);
            if (next !== text) changed = true;
            return next;
        };
        this.lastAssistantMessage = swap(this.lastAssistantMessage) as string | null;
        for (const key of Object.keys(this.lastAssistantMessageBySurface) as ConversationSurface[]) {
            this.lastAssistantMessageBySurface[key] = swap(this.lastAssistantMessageBySurface[key]) as string;
        }
        // Only the most recent entries: a repair belongs to an answer just shown.
        // The saved record's tail, not the assistant's: after a reset made during
        // a meeting the assistant's lists are empty, the answer is still saved.
        for (const entry of this.getPersistableUsage().slice(-6)) {
            if (!entry || typeof entry.answer !== 'string') continue;
            entry.answer = swap(entry.answer);
        }
        for (const item of this.contextItems.slice(-6)) {
            if (item.role === 'assistant') item.text = swap(item.text) as string;
        }
        for (const seg of this.persistedTranscript.slice(-12)) {
            if (seg.speaker !== 'assistant') continue;
            seg.text = swap(seg.text) as string;
        }
        for (const h of this.assistantResponseHistory.slice(-4)) {
            h.text = swap(h.text) as string;
        }
        // The overlay accepts a repair when its card draws — which can be while
        // the answer is still streaming, before any of it has been recorded.
        // Nothing matched then, and the broken source was recorded afterwards
        // (as the saved answer AND as the design on the table). It is kept for
        // a short while and applied to what is recorded next.
        if (!changed) this.rememberPendingDiagramRepair(originalSource, repairedSource);
        return changed;
    }

    private pendingDiagramRepairs: Array<{ original: string; repaired: string; at: number }> = [];
    /** The last answer a pending repair was applied to, as written and as recorded (for the usage log's copy). */
    private lastRepairedAnswer: { before: string; after: string } | null = null;
    private static readonly PENDING_DIAGRAM_REPAIR_TTL_MS = 5 * 60 * 1000;
    private static readonly PENDING_DIAGRAM_REPAIR_MAX = 8;

    private rememberPendingDiagramRepair(original: string, repaired: string): void {
        if (typeof original !== 'string' || typeof repaired !== 'string' || !original.trim() || original === repaired) return;
        this.pendingDiagramRepairs = this.pendingDiagramRepairs.filter((r) => r.original !== original);
        this.pendingDiagramRepairs.push({ original, repaired, at: Date.now() });
        while (this.pendingDiagramRepairs.length > SessionTracker.PENDING_DIAGRAM_REPAIR_MAX) this.pendingDiagramRepairs.shift();
    }

    /** An answer about to be recorded, with any diagram the overlay already repaired swapped in (exact source only). */
    private withPendingDiagramRepairs(text: string): string {
        if (typeof text !== 'string' || this.pendingDiagramRepairs.length === 0) return text;
        const cutoff = Date.now() - SessionTracker.PENDING_DIAGRAM_REPAIR_TTL_MS;
        this.pendingDiagramRepairs = this.pendingDiagramRepairs.filter((r) => r.at >= cutoff);
        let out = text;
        try {
            for (const repair of [...this.pendingDiagramRepairs]) {
                const next = replaceMermaidSource(out, repair.original, repair.repaired);
                if (next !== out) {
                    out = next;
                    // Spent: one repair belongs to one answer.
                    this.pendingDiagramRepairs = this.pendingDiagramRepairs.filter((r) => r !== repair);
                }
            }
        } catch { /* the answer is recorded as written */ }
        return out;
    }

    /**
     * `imagePaths`: the screenshots the answer used. They are not stored; their
     * previews are made in the background (usagePreviews.ts) and land on the same
     * entry object as `images`, which is what DatabaseManager.saveMeeting persists.
     * The screenshot files are temporary (ScreenshotHelper deletes them), so this
     * has to happen now rather than at save time.
     */
    pushUsage(entry: any): void {
        // The same object stays in the log (callers may hold it); only the file
        // paths come off it, so they are never persisted.
        const imagePaths = entry?.imagePaths;
        if (entry && 'imagePaths' in entry) delete entry.imagePaths;
        // Same rule as logUsage: the usage log (ai_interactions) stores the
        // answer without its [[GIST]] display line. In place, for the same reason.
        if (entry && typeof entry.answer === 'string') entry.answer = stripGistTrailer(entry.answer);
        // (The usage entry is written after the assistant message; a repair
        // spent there is found here through the message it was applied to.)
        if (entry && typeof entry.answer === 'string' && this.lastRepairedAnswer && entry.answer === this.lastRepairedAnswer.before) {
            entry.answer = this.lastRepairedAnswer.after;
        }
        this.fullUsage.push(entry);
        this.capUsageArray();
        if (Array.isArray(imagePaths) && imagePaths.length > 0) {
            makeUsagePreviews(imagePaths)
                .then((images) => { if (images.length > 0) entry.images = images; })
                .catch((err) => console.warn('[SessionTracker] Screenshot previews for usage failed:', err?.message ?? err));
        }
    }

    // ============================================
    // Interim Transcript Flush
    // ============================================

    /**
     * Force-save any pending interim transcript (called on meeting stop)
     */
    flushInterimTranscript(): void {
        if (this.lastInterimInterviewer) {
            console.log('[SessionTracker] Force-saving pending interim transcript', { length: this.lastInterimInterviewer.text.length });
            const finalSegment = { ...this.lastInterimInterviewer, final: true };
            this.addTranscript(finalSegment);
            this.lastInterimInterviewer = null;
        }
    }

    // ============================================
    // Reset
    // ============================================

    /**
     * `keepMeetingRecord`: the reset shortcut during a running meeting clears
     * what the assistant remembers, not the meeting's saved transcript or its
     * start (it used to wipe both, so the saved meeting lost everything said
     * before the reset).
     */
    reset(opts: { keepMeetingRecord?: boolean } = {}): void {
        this.contextItems = [];
        if (!opts.keepMeetingRecord) {
            this.persistedTranscript = [];
            this.sessionStartTime = Date.now();
            this.usageArchive = [];
            this.archivedImageChars = 0;
            this.assistantViewStart = 0;
            this.assistantViewStartedAt = 0;
        } else {
            this.archiveUsage(this.fullUsage);
            this.assistantViewStart = this.persistedTranscript.length;
            this.assistantViewStartedAt = Date.now();
        }
        this.fullUsage = [];
        this.meetingRecaps = [];
        this.recapCursor = this.assistantViewStart;
        this.recapFailedAt = 0;
        this.lastAssistantMessage = null;
        this.assistantResponseHistory = [];
        this.lastInterimInterviewer = null;
        this.detectedCodingQuestion = null;
        this.codingQuestionSource = null;
        this.codingQuestionSetAt = null;
        this.recentInterviewerBuffer = [];
        this.activeDesign.clear();
        this.pendingDiagramRepairs = [];
        this.lastRepairedAnswer = null;
        this.sessionEpoch++;
        this.contextEpoch++;
    }

    // ============================================
    // Private Helpers
    // ============================================

    mapSpeakerToRole(speaker: string): 'interviewer' | 'user' | 'assistant' {
        if (speaker === 'user') return 'user';
        if (speaker === 'assistant') return 'assistant';
        return 'interviewer'; // system audio = interviewer
    }

    private evictOldEntries(): void {
        const cutoff = Date.now() - (this.contextWindowDuration * 1000);
        this.contextItems = this.contextItems.filter(item => item.timestamp >= cutoff);

        // Safety limit
        if (this.contextItems.length > this.maxContextItems) {
            this.contextItems = this.contextItems.slice(-this.maxContextItems);
        }
    }

    /**
     * Summarise the next block of the meeting once it has RECAP_BLOCK_LINES
     * spoken lines (see meetingRecaps). One call at a time; a failed one is
     * retried after RECAP_RETRY_MS, never on every new line.
     */
    private async recapIfDue(): Promise<void> {
        if (!this.recapLLM || this.isRecapping) return;
        if (this.recapFailedAt && Date.now() - this.recapFailedAt < SessionTracker.RECAP_RETRY_MS) return;
        const from = Math.max(this.recapCursor, this.assistantViewStart);
        const block: TranscriptSegment[] = [];
        let to = from;
        for (; to < this.persistedTranscript.length && block.length < SessionTracker.RECAP_BLOCK_LINES; to++) {
            const seg = this.persistedTranscript[to];
            if (this.mapSpeakerToRole(seg.speaker) !== 'assistant' && seg.origin !== 'manual_chat' && (seg.text || '').trim()) block.push(seg);
        }
        if (block.length < SessionTracker.RECAP_BLOCK_LINES) return;

        this.isRecapping = true;
        const epoch = this.sessionEpoch;
        try {
            // Background work: never ahead of an answer being generated.
            const { ForegroundGate } = require('./services/ForegroundGate') as typeof import('./services/ForegroundGate');
            await ForegroundGate.waitUntilIdle();
            if (this.sessionEpoch !== epoch) return;
            const input = block.map((seg) => `[${this.mapSpeakerToRole(seg.speaker) === 'user' ? 'ME' : 'THEM'}]: ${seg.text}`).join('\n');
            let text = '';
            try {
                text = (await this.recapLLM.generate(
                    `Summarize this part of a meeting as 3 to 6 short bullet points. Keep every decision, owner, number, date and deadline exactly as said. No preamble.\n\n${input}`
                )).trim();
            } catch (e: any) {
                if (this.sessionEpoch !== epoch) return;
                this.recapFailedAt = Date.now();
                console.warn('[SessionTracker] Meeting recap failed; retrying later:', e?.message || e);
                return;
            }
            if (this.sessionEpoch !== epoch) return;
            if (!text) { this.recapFailedAt = Date.now(); return; }
            this.recapFailedAt = 0;
            this.meetingRecaps.push({ fromTs: block[0].timestamp, toTs: block[block.length - 1].timestamp, lines: block.length, text });
            if (this.meetingRecaps.length > SessionTracker.MAX_RECAPS) this.meetingRecaps.shift();
            this.recapCursor = to;
            console.log(`[SessionTracker] Meeting recap ${this.meetingRecaps.length} written (${block.length} lines)`);
        } finally {
            this.isRecapping = false;
        }
        // A backlog (recapLLM set late, or a burst of lines) continues block by block.
        void this.recapIfDue().catch(() => { /* logged inside */ });
    }

    /**
     * The meeting so far as recaps, oldest first, covering everything up to the
     * last block summarised (lines after it are in the live transcript). Empty
     * until the first block of RECAP_BLOCK_LINES spoken lines is summarised.
     */
    getMeetingRecaps(): ReadonlyArray<{ fromTs: number; toTs: number; lines: number; text: string }> {
        return this.meetingRecaps;
    }
}
