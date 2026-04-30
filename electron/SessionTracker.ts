// SessionTracker.ts
// Manages session state, transcript arrays, context windows, and epoch compaction.
// Extracted from IntelligenceManager to decouple state management from LLM orchestration.

import { RecapLLM } from './llm';
import { isVerboseLogging } from './verboseLog';

export interface TranscriptSegment {
    marker?: string;
    speaker: string;
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

/**
 * Structured anti-repetition register, populated on every assistant response.
 * Replaces the previous strategy of relying on the model to notice repetition
 * inside the last-3-responses block. Each bucket is bounded — see SessionTracker
 * MAX_REGISTER_* constants for caps.
 */
export interface ConversationRegister {
    anchorsUsed: Set<string>;       // proper-noun-shaped tokens the candidate has invoked
    metricsDropped: Set<string>;    // numeric specifics with units / percent
    projectsMentioned: Set<string>; // anchors the model framed as projects (Title-Case 2-4 word)
    openersUsed: string[];          // first sentence (or first ~8 words) of recent responses, ordered
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

    // Structured anti-repetition register — see ConversationRegister.
    private conversationRegister: ConversationRegister = {
        anchorsUsed: new Set(),
        metricsDropped: new Set(),
        projectsMentioned: new Set(),
        openersUsed: [],
    };
    private static readonly MAX_REGISTER_ANCHORS = 30;
    private static readonly MAX_REGISTER_METRICS = 30;
    private static readonly MAX_REGISTER_PROJECTS = 20;
    private static readonly MAX_REGISTER_OPENERS = 8;
    // Title-Case proper-noun runs: "NxtHumans", "IPG Scout", "Multi-Agent Orchestrator".
    // Single capitalised words are too noisy ("I", "The", "So") so we require length>=2 chars
    // and either a multi-word run, an internal capital (camel/Pascal), or an all-caps token.
    private static readonly ANCHOR_PATTERN = /\b(?:[A-Z][A-Za-z0-9]+(?:[-/&]?\s+[A-Z][A-Za-z0-9]+){1,3}|[A-Z][a-z]+[A-Z][A-Za-z0-9]+|[A-Z]{2,}[A-Za-z0-9]*)\b/g;
    // Numbers with a unit or percent — captures "40%", "825K records", "3 weeks", "50k users".
    private static readonly METRIC_PATTERN = /\b\d+(?:[.,]\d+)?\s*(?:%|percent|x|×|k\b|m\b|bn\b|s\b|ms|seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|yrs?|users?|customers?|requests?|rps|qps|tps|gb|mb|kb|tb|records?|rows?|deals?|reps?|engineers?|people)\b/gi;
    // Stop-list of capitalised tokens that pollute anchor extraction. Keep it short — the
    // pattern itself already filters single capitalised words.
    private static readonly ANCHOR_STOPLIST = new Set([
        'I', 'The', 'A', 'An', 'My', 'Our', 'Their', 'His', 'Her',
        'So', 'Yes', 'No', 'Well', 'Yeah', 'OK', 'Okay',
        'Time', 'Space', 'Follow', 'Why',
    ]);

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
            console.log(`[SessionTracker] Coding question stored (source: ${source}): "${trimmed.substring(0, 80)}..."`);
            return;
        }

        if (source === 'screenshot') {
            // Screenshot always updates immediately (explicit user Solve action)
            this.detectedCodingQuestion = trimmed;
            this.codingQuestionSource = source;
            this.codingQuestionSetAt = now;
            console.log(`[SessionTracker] Coding question updated via screenshot: "${trimmed.substring(0, 80)}..."`);
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
            console.log(`[SessionTracker] Coding question updated via transcript (prev was ${this.codingQuestionSource}, stale=${isStale}): "${trimmed.substring(0, 80)}..."`);
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
     * Heuristic to decide if an interviewer statement looks like a coding question.
     * Requires ≥2 of the signal patterns and minimum length to avoid false positives
     * on casual conversation ("can you implement X?" → yes, "sounds good!" → no).
     */
    private looksLikeCodingQuestion(text: string): boolean {
        if (text.length < 50) return false;
        const recruiterAdminSignals = [
            /\b(recruiter|portal|position|role|client|profile|resume|offer|salary|rate|w-?2|contract|notice period|manager|interview request|vendor|beeline|valid id|id proof|driver license)\b/i,
            /\b(jpmorgan|chase|bank of america|capital one|wells fargo)\b/i,
        ];
        const hasRecruiterAdminContext = recruiterAdminSignals.some(p => p.test(text));
        const patterns = [
            /\b(implement|write|code|solve|design|build|create)\b/i,
            /\b(given\s+(an?|the)\s+(array|string|list|tree|graph|matrix|number|integer|node|linked list|stack|queue|heap))\b/i,
            /\b(return|find\s+(all|the|a|any)|count|check\s+if|determine|calculate|maximize|minimize|sort)\b/i,
            /\b(function|method|algorithm|data structure|class)\b/i,
            /\b(O\(n\)|time complexity|space complexity|optimal|efficient|brute force)\b/i,
            /\b(two sum|three sum|binary search|dynamic programming|BFS|DFS|palindrome|anagram|substring|subarray|rotation)\b/i,
        ];
        const strongCodingSignals = [
            /\b(given\s+(an?|the)\s+(array|string|list|tree|graph|matrix|number|integer|node|linked list|stack|queue|heap))\b/i,
            /\b(O\(n\)|time complexity|space complexity|optimal|efficient|brute force)\b/i,
            /\b(two sum|three sum|binary search|dynamic programming|BFS|DFS|palindrome|anagram|substring|subarray|rotation)\b/i,
        ];
        const matchCount = patterns.filter(p => p.test(text)).length;
        const hasStrongCodingSignal = strongCodingSignals.some(p => p.test(text));
        if (hasRecruiterAdminContext && !hasStrongCodingSignal) return false;
        return matchCount >= 2 && (hasStrongCodingSignal || matchCount >= 3);
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

        // Filter out internal system prompts that might be passed via IPC
        const isInternalPrompt = text.startsWith("You are a real-time interview assistant") ||
            text.startsWith("You are a helper") ||
            text.startsWith("CONTEXT:");

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
        console.log(`[SessionTracker] addAssistantMessage called with:`, text.substring(0, 50));

        // Natively-style filtering
        if (!text) return;

        const cleanText = text.trim();
        if (cleanText.length < 10) {
            console.warn(`[SessionTracker] Ignored short message (<10 chars)`);
            return;
        }

        if (cleanText.includes("I'm not sure") || cleanText.includes("I can't answer")) {
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

        // Structured anti-repetition extraction. Pure-regex; no LLM call.
        this.updateConversationRegister(cleanText);

        this.evictOldEntries();
    }

    /**
     * Handle incoming transcript from native audio service
     */
    handleTranscript(segment: TranscriptSegment): { role: 'interviewer' | 'user' | 'assistant' } | null {
        // Track interim segments for interviewer to prevent data loss on stop
        if (segment.speaker === 'user') {
            if (isVerboseLogging() && (Math.random() < 0.05 || segment.final)) {
                console.log(`[SessionTracker] RX User Segment: Final=${segment.final} Text="${segment.text.substring(0, 50)}..."`);
            }
        }
        if (segment.speaker === 'interviewer') {
            if (isVerboseLogging() && (Math.random() < 0.05 || segment.final)) {
                console.log(`[SessionTracker] RX Interviewer Segment: Final=${segment.final} Text="${segment.text.substring(0, 50)}..."`);
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

    getLastAssistantMessage(): string | null {
        return this.lastAssistantMessage;
    }

    getAssistantResponseHistory(): AssistantResponse[] {
        return this.assistantResponseHistory;
    }

    getConversationRegister(): ConversationRegister {
        return this.conversationRegister;
    }

    getLastInterimInterviewer(): TranscriptSegment | null {
        return this.lastInterimInterviewer;
    }

    /**
     * Get formatted context string for LLM prompts
     */
    getFormattedContext(lastSeconds: number = 120): string {
        const items = this.getContext(lastSeconds);
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
            answer
        });
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
            console.log('[SessionTracker] Force-saving pending interim transcript:', this.lastInterimInterviewer.text);
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
        this.conversationRegister = {
            anchorsUsed: new Set(),
            metricsDropped: new Set(),
            projectsMentioned: new Set(),
            openersUsed: [],
        };
    }

    // ============================================
    // Private Helpers
    // ============================================

    mapSpeakerToRole(speaker: string): 'interviewer' | 'user' | 'assistant' {
        if (speaker === 'user') return 'user';
        if (speaker === 'assistant') return 'assistant';
        return 'interviewer'; // system audio = interviewer
    }

    /**
     * Pure-regex extraction of anchors / metrics / openers from a fresh assistant
     * response. Intentionally cheap (single pass per pattern, bounded loops). The
     * model never sees the buckets directly — they are formatted into the
     * <already_said_this_interview> block by WhatToAnswerLLM.
     *
     * Trade-off note: the anchor pattern over-collects (it'll grab phrases like
     * "New York", "Postgres" mid-sentence). That's fine; the goal is to give the
     * model a list of "things you've already said" — false positives just nudge
     * it to vary, which is what we want anyway.
     */
    private updateConversationRegister(text: string): void {
        // Strip code blocks before extraction — code is full of capitalised tokens
        // (class names, identifiers) that aren't conversational anchors.
        const conversational = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]+`/g, ' ');

        // 1. Anchors / projects (Title-Case proper noun runs)
        const anchorMatches = conversational.match(SessionTracker.ANCHOR_PATTERN) || [];
        for (const raw of anchorMatches) {
            const candidate = raw.trim();
            if (!candidate || SessionTracker.ANCHOR_STOPLIST.has(candidate)) continue;
            this.conversationRegister.anchorsUsed.add(candidate);
            // Multi-word Title-Case spans (length >= 2 words) read as project / product names
            // more than as bare anchors — track them separately so the block can mention both.
            if (/\s/.test(candidate)) {
                this.conversationRegister.projectsMentioned.add(candidate);
            }
        }
        this.boundSet(this.conversationRegister.anchorsUsed, SessionTracker.MAX_REGISTER_ANCHORS);
        this.boundSet(this.conversationRegister.projectsMentioned, SessionTracker.MAX_REGISTER_PROJECTS);

        // 2. Metrics with units
        const metricMatches = conversational.match(SessionTracker.METRIC_PATTERN) || [];
        for (const raw of metricMatches) {
            const m = raw.trim().replace(/\s+/g, ' ');
            if (m) this.conversationRegister.metricsDropped.add(m);
        }
        this.boundSet(this.conversationRegister.metricsDropped, SessionTracker.MAX_REGISTER_METRICS);

        // 3. Opener — first sentence (or first ~10 words) of the response, lowercased
        // for similarity matching. Stored verbatim (truncated) so the model can recognise
        // a near-repeat.
        const opener = this.extractOpener(text);
        if (opener) {
            // Drop near-duplicates within the recent window — same first 6 lowercase words.
            const sig = opener.toLowerCase().split(/\s+/).slice(0, 6).join(' ');
            const seen = this.conversationRegister.openersUsed.some(o =>
                o.toLowerCase().split(/\s+/).slice(0, 6).join(' ') === sig
            );
            if (!seen) {
                this.conversationRegister.openersUsed.push(opener);
                if (this.conversationRegister.openersUsed.length > SessionTracker.MAX_REGISTER_OPENERS) {
                    this.conversationRegister.openersUsed = this.conversationRegister.openersUsed.slice(
                        -SessionTracker.MAX_REGISTER_OPENERS
                    );
                }
            }
        }
    }

    private extractOpener(text: string): string {
        // Skip code blocks at the start (e.g., a bare code-only response has no opener).
        const trimmed = text.replace(/^```[\s\S]*?```/, '').trim();
        if (!trimmed) return '';
        const firstSentenceMatch = trimmed.match(/^[^.!?\n]{3,}[.!?]/);
        if (firstSentenceMatch) {
            return firstSentenceMatch[0].trim().slice(0, 100);
        }
        // No sentence boundary in a short reply — take first ~10 words.
        const words = trimmed.split(/\s+/).slice(0, 10).join(' ');
        return words.slice(0, 100);
    }

    /**
     * Trim a Set to its most recent N entries while preserving insertion order.
     * Set iteration order in JS is insertion order, so dropping the head is just
     * "skip the first (size-cap) entries on rebuild".
     */
    private boundSet(set: Set<string>, cap: number): void {
        if (set.size <= cap) return;
        const arr = Array.from(set);
        set.clear();
        for (const v of arr.slice(-cap)) set.add(v);
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
                        const marker = `[Earlier discussion: ${oldEntries.length} segments — ${oldEntries.slice(0, 3).map(s => s.text.substring(0, 40)).join('; ')}...]`;
                        this.transcriptEpochSummaries.push(marker);
                    }
                } catch (e) {
                    // If summarization fails, store a simple marker
                    const fallback = `[Earlier discussion: ${oldEntries.length} segments, topics: ${oldEntries.slice(0, 3).map(s => s.text.substring(0, 40)).join('; ')}...]`;
                    this.transcriptEpochSummaries.push(fallback);
                    console.warn('[SessionTracker] Epoch summarization failed, using fallback marker');
                }
            } else {
                // BUG-03 fix: recapLLM not yet available — always push a plain marker so early
                // context is not silently discarded with no record in transcriptEpochSummaries.
                const marker = `[Earlier discussion (no LLM): ${oldEntries.length} segments — ${oldEntries.slice(0, 3).map(s => s.text.substring(0, 40)).join('; ')}...]`;
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
