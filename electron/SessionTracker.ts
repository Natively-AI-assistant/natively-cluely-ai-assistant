// SessionTracker.ts
// Manages session state, transcript arrays, context windows, and epoch compaction.
// Extracted from IntelligenceManager to decouple state management from LLM orchestration.

import { RecapLLM } from './llm';
import { isVerboseLogging } from './verboseLog';

// Canned-fallback phrases that mean the model gave up entirely, not phrases
// that might legitimately appear inside a real answer. Matched only when the
// ENTIRE (trimmed, punctuation-stripped) message consists of one of these —
// never as a substring — so honest answers like "I'm not sure of his exact
// title, but he's on the platform team" are kept in session history instead
// of being silently dropped from contextItems/fullTranscript/history.
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
}

export interface SuggestionTrigger {
    context: string;
    lastQuestion: string;
    confidence: number;
}

// Context item matching Swift ContextManager structure
export interface ContextItem {
    role: 'interviewer' | 'user' | 'assistant';
    text: string;
    timestamp: number;
}

export interface AssistantResponse {
    text: string;
    timestamp: number;
    questionContext: string;
}

export class SessionTracker {
    // Context management (mirrors Swift ContextManager)
    private contextItems: ContextItem[] = [];
    private readonly contextWindowDuration: number = 120; // 120 seconds
    private readonly maxContextItems: number = 500;

    // Last assistant message for follow-up mode
    private lastAssistantMessage: string | null = null;

    // Temporal RAG: Track all assistant responses in session for anti-repetition
    private assistantResponseHistory: AssistantResponse[] = [];

    // Meeting metadata
    private currentMeetingMetadata: {
        title?: string;
        calendarEventId?: string;
        source?: 'manual' | 'calendar';
    } | null = null;

    // Full Session Tracking (Persisted)
    private fullTranscript: TranscriptSegment[] = [];
    private fullUsage: any[] = []; // UsageInteraction
    private sessionStartTime: number = Date.now();

    // Rolling summarization: epoch summaries preserve early context when arrays are compacted
    private static readonly MAX_EPOCH_SUMMARIES = 5;
    private transcriptEpochSummaries: string[] = [];
    private isCompacting: boolean = false;

    // Track interim interviewer segment
    private lastInterimInterviewer: TranscriptSegment | null = null;

    // Detected coding question from transcript or screenshot extraction
    private detectedCodingQuestion: string | null = null;
    private codingQuestionSource: 'screenshot' | 'transcript' | null = null;
    private codingQuestionSetAt: number | null = null;

    // Rolling buffer for multi-segment interviewer question detection
    private recentInterviewerBuffer: { text: string; timestamp: number }[] = [];
    private static readonly INTERVIEWER_BUFFER_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
    // Screenshot-detected question stays sticky for 3 min before transcript can override
    private static readonly SCREENSHOT_STALE_MS = 3 * 60 * 1000;

    // Reference to RecapLLM for epoch summarization (injected later)
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

    getDetectedCodingQuestion(): { question: string | null; source: 'screenshot' | 'transcript' | null } {
        return { question: this.detectedCodingQuestion, source: this.codingQuestionSource };
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
        this.detectedCodingQuestion = null;
        this.codingQuestionSource = null;
        this.codingQuestionSetAt = null;
        this.recentInterviewerBuffer = [];
        this.lastAssistantMessage = null;
        this.assistantResponseHistory = [];
        this.lastInterimInterviewer = null;
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
            timestamp: segment.timestamp
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
            this.fullTranscript.push(segment);
            // Compact transcript with summarization instead of losing early context
            // Fire-and-forget: sync context; errors are caught internally
            void this.compactTranscriptIfNeeded().catch(e =>
                console.warn('[SessionTracker] compactTranscript error (non-fatal):', e)
            );
        }

        return { role };
    }

    /**
     * Add assistant-generated message to context
     */
    addAssistantMessage(text: string): void {
        console.log(`[SessionTracker] addAssistantMessage called`, { length: text.length });

        // Natively-style filtering
        if (!text) return;

        const cleanText = text.trim();
        if (cleanText.length < 10) {
            console.warn(`[SessionTracker] Ignored short message (<10 chars)`);
            return;
        }

        if (isCannedFallbackPhrase(cleanText)) {
            console.warn(`[SessionTracker] Ignored fallback message`);
            return;
        }

        this.contextItems.push({
            role: 'assistant',
            text: cleanText,
            timestamp: Date.now()
        });

        // Also add to fullTranscript so it persists in the session history (and summaries)
        this.fullTranscript.push({
            speaker: 'assistant',
            text: cleanText,
            timestamp: Date.now(),
            final: true,
            confidence: 1.0
        });

        // Compact transcript with summarization instead of losing early context
        // Fire-and-forget: sync context; errors are caught internally
        void this.compactTranscriptIfNeeded().catch(e =>
            console.warn('[SessionTracker] compactTranscript error (non-fatal):', e)
        );

        this.lastAssistantMessage = cleanText;

        // Temporal RAG: Track response history for anti-repetition
        this.assistantResponseHistory.push({
            text: cleanText,
            timestamp: Date.now(),
            questionContext: this.getLastInterviewerTurn() || 'unknown'
        });

        // Keep history bounded (last 10 responses)
        if (this.assistantResponseHistory.length > 10) {
            this.assistantResponseHistory = this.assistantResponseHistory.slice(-10);
        }

        console.log(`[SessionTracker] lastAssistantMessage updated, history size: ${this.assistantResponseHistory.length}`);
        this.evictOldEntries();
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
     * which reads `contextItems` — hard-evicted to `contextWindowDuration` (120s) on
     * EVERY final segment by `evictOldEntries()` — this reads `fullTranscript`, the
     * session's persisted store that survives the 120s eviction. It exists to make
     * genuinely long-range recall possible: a project named at minute 1 is still
     * present at minute 62.
     *
     * WHY THIS METHOD EXISTS: `IntelligenceEngine.LIVE_MEMORY_WINDOW_SECONDS = 7200`
     * fed `getContext(7200)` into the long-range follow-up memory and assumed a 2h
     * window. But `contextItems` can never hold more than ~120s, so that path
     * silently saw at most the last two minutes — the long-range entity it was built
     * to recall had already been evicted. Pointing it at the durable store fixes the
     * bug for the common case (a multi-minute session under the compaction threshold).
     *
     * BOUND: after a >1800-segment session `compactTranscriptIfNeeded` summarizes and
     * evicts the OLDEST 500 raw segments into an epoch summary, so this returns only
     * the raw segments STILL RESIDENT — a minute-1 entity in a *very* long session can
     * still age out of the raw store into a summary. That's a far higher bar than the
     * 120s `contextItems` eviction this fixes; for the full summary-prefixed view see
     * `getFullSessionContext()`.
     *
     * @param lastSeconds Window size in seconds (default 7200 = 2h). `Infinity`
     *   returns the entire resident transcript.
     */
    getDurableContext(lastSeconds: number = 7200): ContextItem[] {
        const cutoff = Number.isFinite(lastSeconds)
            ? Date.now() - (lastSeconds * 1000)
            : -Infinity;
        const out: ContextItem[] = [];
        for (const seg of this.fullTranscript) {
            if (seg.timestamp < cutoff) continue;
            const text = (seg.text || '').trim();
            if (!text) continue;
            out.push({ role: this.mapSpeakerToRole(seg.speaker), text, timestamp: seg.timestamp });
        }
        return out;
    }

    getLastAssistantMessage(): string | null {
        return this.lastAssistantMessage;
    }

    getAssistantResponseHistory(): AssistantResponse[] {
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

        const lastInterim = this.lastInterimInterviewer;
        if (lastInterim && lastInterim.text.trim().length > 0) {
            const lastItem = contextItems[contextItems.length - 1];
            const isDuplicate = lastItem &&
                lastItem.role === 'interviewer' &&
                (lastItem.text === lastInterim.text ||
                    Math.abs(lastItem.timestamp - lastInterim.timestamp) < 1000);

            if (!isDuplicate) {
                contextItems.push({
                    role: 'interviewer',
                    text: lastInterim.text,
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
     * Formatted context including rolling interim interviewer speech.
     */
    getFormattedContextWithInterim(lastSeconds: number = 120): string {
        return this.formatContextItems(this.getContextWithInterim(lastSeconds));
    }

    private formatContextItems(items: ContextItem[]): string {
        return items.map(item => {
            const label = item.role === 'interviewer' ? 'INTERVIEWER' :
                item.role === 'user' ? 'ME' :
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
        const recentTranscript = this.fullTranscript.map(segment => {
            const role = this.mapSpeakerToRole(segment.speaker);
            const label = role === 'interviewer' ? 'INTERVIEWER' :
                role === 'user' ? 'ME' :
                    'ASSISTANT';
            return `[${label}]: ${segment.text}`;
        }).join('\n');

        // Prepend epoch summaries for full session context preservation
        if (this.transcriptEpochSummaries.length > 0) {
            const epochContext = this.transcriptEpochSummaries.join('\n---\n');
            return `[SESSION HISTORY - EARLIER DISCUSSION]\n${epochContext}\n\n[RECENT TRANSCRIPT]\n${recentTranscript}`;
        }

        return recentTranscript;
    }

    // ============================================
    // Session Data Accessors (for MeetingPersistence)
    // ============================================

    getFullTranscript(): TranscriptSegment[] {
        return this.fullTranscript;
    }

    getFullUsage(): any[] {
        return this.fullUsage;
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

    // ============================================
    // Usage Tracking
    // ============================================

    /**
     * Cap usage array with simple eviction (usage doesn't need summarization)
     */
    capUsageArray(): void {
        if (this.fullUsage.length > 500) {
            this.fullUsage = this.fullUsage.slice(-500);
        }
    }

    /**
     * Public method to log usage from external sources (e.g. IPC direct chat)
     */
    logUsage(type: string, question: string, answer: string): void {
        this.fullUsage.push({
            type,
            timestamp: Date.now(),
            question,
            answer,
            source: type === 'chat' ? 'manual_chat' : 'external',
        });
        this.capUsageArray();
    }

    pushUsage(entry: any): void {
        this.fullUsage.push(entry);
        this.capUsageArray();
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

    reset(): void {
        this.contextItems = [];
        this.fullTranscript = [];
        this.fullUsage = [];
        this.transcriptEpochSummaries = [];
        this.sessionStartTime = Date.now();
        this.lastAssistantMessage = null;
        this.assistantResponseHistory = [];
        this.lastInterimInterviewer = null;
        this.detectedCodingQuestion = null;
        this.codingQuestionSource = null;
        this.codingQuestionSetAt = null;
        this.recentInterviewerBuffer = [];
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
     * Compact transcript buffer by summarizing oldest entries into an epoch summary.
     * Called instead of raw slice() to preserve early meeting context.
     */
    private async compactTranscriptIfNeeded(): Promise<void> {
        if (this.fullTranscript.length <= 1800 || this.isCompacting) return;

        this.isCompacting = true;
        try {
            // Take the oldest 500 entries to summarize
            const summarizeCount = 500;
            const oldEntries = this.fullTranscript.slice(0, summarizeCount);
            const summaryInput = oldEntries.map(seg => {
                const role = this.mapSpeakerToRole(seg.speaker);
                const label = role === 'interviewer' ? 'INTERVIEWER' :
                    role === 'user' ? 'ME' : 'ASSISTANT';
                return `[${label}]: ${seg.text}`;
            }).join('\n');

            // Fire-and-forget LLM summarization (non-blocking)
            if (this.recapLLM) {
                try {
                    const epochSummary = await this.recapLLM.generate(
                        `Summarize this conversation segment into 3-5 concise bullet points preserving key topics, decisions, and questions:\n\n${summaryInput}`
                    );
                    if (epochSummary && epochSummary.trim().length > 0) {
                        this.transcriptEpochSummaries.push(epochSummary.trim());
                        console.log(`[SessionTracker] Epoch summary created (${this.transcriptEpochSummaries.length} total)`);
                    } else {
                        // Empty LLM response — store a basic marker so context is not lost
                        const marker = `[Earlier discussion: ${oldEntries.length} segments summarized without transcript snippets.]`;
                        this.transcriptEpochSummaries.push(marker);
                    }
                } catch (e) {
                    // If summarization fails, store a simple marker
                    const fallback = `[Earlier discussion: ${oldEntries.length} segments summarized without transcript snippets.]`;
                    this.transcriptEpochSummaries.push(fallback);
                    console.warn('[SessionTracker] Epoch summarization failed, using fallback marker');
                }
            } else {
                // BUG-03 fix: recapLLM not yet available — always push a plain marker so early
                // context is not silently discarded with no record in transcriptEpochSummaries.
                const marker = `[Earlier discussion (no LLM): ${oldEntries.length} segments summarized without transcript snippets.]`;
                this.transcriptEpochSummaries.push(marker);
                console.warn('[SessionTracker] recapLLM not available — storing plain epoch marker');
            }

            // Cap epoch summaries to prevent LLM context window overflow
            if (this.transcriptEpochSummaries.length > SessionTracker.MAX_EPOCH_SUMMARIES) {
                this.transcriptEpochSummaries = this.transcriptEpochSummaries.slice(-SessionTracker.MAX_EPOCH_SUMMARIES);
            }

            // Evict ONLY the exact 500 oldest entries that we just summarized
            this.fullTranscript = this.fullTranscript.slice(summarizeCount);
        } finally {
            this.isCompacting = false;
        }
    }
}
