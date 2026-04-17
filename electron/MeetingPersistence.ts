// MeetingPersistence.ts
// Handles meeting lifecycle: stop, save, and recovery.
// Extracted from IntelligenceManager to decouple DB operations from LLM orchestration.

import { SessionTracker } from './SessionTracker';
import { LLMHelper } from './LLMHelper';
import { DatabaseManager } from './db/DatabaseManager';
import { GROQ_TITLE_PROMPT, GROQ_SUMMARY_JSON_PROMPT } from './llm';

export class MeetingPersistence {
    private session: SessionTracker;
    private llmHelper: LLMHelper;

    constructor(session: SessionTracker, llmHelper: LLMHelper) {
        this.session = session;
        this.llmHelper = llmHelper;
    }

    /**
     * Stops the meeting immediately, snapshots data, and triggers background processing.
     * Returns immediately so UI can switch.
     */
    public async stopMeeting(meetingId: string | null): Promise<string | null> {
        console.log('[MeetingPersistence] Stopping meeting and queueing save...');

        if (!meetingId) {
            console.warn('[MeetingPersistence] stopMeeting called with no active meetingId');
            this.session.reset();
            return null;
        }

        // 0. Force-save any pending interim transcript
        const flushedInterim = this.session.flushInterimTranscript();

        // 1. Snapshot valid data BEFORE resetting
        const durationMs = Date.now() - this.session.getSessionStartTime();
        if (durationMs < 1000) {
            console.log("Meeting too short, ignoring.");
            this.session.reset();
            return null;
        }

        if (flushedInterim) {
            DatabaseManager.getInstance().appendTranscriptSegment(meetingId, {
                speaker: flushedInterim.speaker,
                text: flushedInterim.text,
                timestamp: flushedInterim.timestamp,
            });
            DatabaseManager.getInstance().flushPendingTranscriptSegments();
        }

        const snapshot = {
            usage: [...this.session.getFullUsage()],
            startTime: this.session.getSessionStartTime(),
            durationMs,
            context: this.session.getFullSessionContext()
        };

        // BUG-04 fix: snapshot metadata BEFORE reset() clears it so the
        // background processAndSaveMeeting worker receives the calendar info.
        const metadataSnapshot = this.session.getMeetingMetadata();

        // 2. Reset state immediately so new meeting can start or UI is clean
        this.session.reset();

        this.processAndFinalizeMeeting(snapshot, meetingId, metadataSnapshot).catch(err => {
            console.error('[MeetingPersistence] Background processing failed:', err);
        });

        return meetingId;
    }

    /**
     * Heavy lifting: LLM Title, Summary, and DB Write
     */
    private async processAndFinalizeMeeting(
        data: { usage: any[], startTime: number, durationMs: number, context: string },
        meetingId: string,
        // BUG-04 fix: accept metadata snapshot so calendar info is not lost after session.reset()
        metadata?: { title?: string; calendarEventId?: string; source?: 'manual' | 'calendar' } | null
    ): Promise<void> {
        let title = "Untitled Session";
        let summaryData: { actionItems: string[], keyPoints: string[] } = { actionItems: [], keyPoints: [] };

        // Use passed-in metadata snapshot (NOT this.session.getMeetingMetadata() which is already cleared)
        let calendarEventId: string | undefined;
        let source: 'manual' | 'calendar' = 'manual';

        if (metadata) {
            if (metadata.title) title = metadata.title;
            if (metadata.calendarEventId) calendarEventId = metadata.calendarEventId;
            if (metadata.source) source = metadata.source;
        }

        try {
            // Generate Title (only if not set by calendar)
            if (!metadata || !metadata.title) {
                const titlePrompt = `Generate a concise 3-6 word title for this meeting context. Output ONLY the title text. Do not use quotes or conversational filler.`;
                const groqTitlePrompt = GROQ_TITLE_PROMPT;

                const generatedTitle = await this.llmHelper.generateMeetingSummary(titlePrompt, data.context.substring(0, 5000), groqTitlePrompt);
                if (generatedTitle) title = generatedTitle.replace(/["*]/g, '').trim();
            }

            // Generate Structured Summary
            if (data.context && data.context.trim().length > 80) {
                const summaryPrompt = `You are a silent meeting summarizer. Convert this conversation into concise internal meeting notes.
    
    RULES:
    - Do NOT invent information not present in the context
    - You MAY infer implied action items or next steps if they are logical consequences of the discussion
    - Do NOT explain or define concepts mentioned
    - Do NOT use filler phrases like "The meeting covered..." or "Discussed various..."
    - Do NOT mention transcripts, AI, or summaries
    - Do NOT sound like an AI assistant
    - Sound like a senior PM's internal notes
    
    STYLE: Calm, neutral, professional, skim-friendly. Short bullets, no sub-bullets.
    
    Return ONLY valid JSON (no markdown code blocks):
    {
      "overview": "1-2 sentence description of what was discussed",
      "keyPoints": ["3-6 specific bullets - each = one concrete topic or point discussed"],
      "actionItems": ["specific next steps, assigned tasks, or implied follow-ups. If absolutely none found, return empty array"]
    }`;

                const groqSummaryPrompt = GROQ_SUMMARY_JSON_PROMPT;

                const generatedSummary = await this.llmHelper.generateMeetingSummary(summaryPrompt, data.context.substring(0, 10000), groqSummaryPrompt);

                if (generatedSummary) {
                    const jsonMatch = generatedSummary.match(/```json\n([\s\S]*?)\n```/) || [null, generatedSummary];
                    const jsonStr = (jsonMatch[1] || generatedSummary).trim();
                    try {
                        summaryData = JSON.parse(jsonStr);
                    } catch (e) { console.error("Failed to parse summary JSON", e); }
                }
            } else {
                console.log('Context too short for summary generation.');
            }
        } catch (e) {
            console.error("Error generating meeting metadata", e);
        }

        try {
            DatabaseManager.getInstance().finalizeMeeting(meetingId, {
                title,
                startTimeMs: data.startTime,
                durationMs: data.durationMs,
                summary: 'See detailed summary',
                detailedSummary: summaryData,
                usage: data.usage,
                calendarEventId,
                source,
            });

            // Metadata was already snapshotted before session.reset() — nothing to clear here.

            // Notify Frontend to refresh list
            const wins = require('electron').BrowserWindow.getAllWindows();
            wins.forEach((w: any) => w.webContents.send('meetings-updated'));

        } catch (error) {
            console.error('[MeetingPersistence] Failed to save meeting:', error);
        }
    }

    /**
     * Recover meetings that were started but not fully processed (e.g. app crash)
     */
    public async recoverUnprocessedMeetings(): Promise<void> {
        console.log('[MeetingPersistence] Checking for unprocessed meetings...');
        const db = DatabaseManager.getInstance();
        const unprocessed = db.getUnprocessedMeetings();

        if (unprocessed.length === 0) {
            console.log('[MeetingPersistence] No unprocessed meetings found.');
            return;
        }

        console.log(`[MeetingPersistence] Found ${unprocessed.length} unprocessed meetings. recovering...`);

        for (const m of unprocessed) {
            try {
                const details = db.getMeetingDetails(m.id);
                if (!details) continue;

                console.log(`[MeetingPersistence] Recovering meeting ${m.id}...`);

                const context = details.transcript?.map(t => {
                    const label = t.speaker === 'interviewer' ? 'INTERVIEWER' :
                        t.speaker === 'user' ? 'ME' : 'ASSISTANT';
                    return `[${label}]: ${t.text}`;
                }).join('\n') || "";

                const startTime = new Date(details.date).getTime();
                const safeStartTime = Number.isFinite(startTime) ? startTime : Date.now();
                const lastTimestamp = details.transcript && details.transcript.length > 0
                    ? details.transcript[details.transcript.length - 1].timestamp
                    : null;
                const durationMs = Number.isFinite(lastTimestamp)
                    ? Math.max(0, (lastTimestamp as number) - safeStartTime)
                    : Math.max(0, Date.now() - safeStartTime);

                const snapshot = {
                    usage: details.usage,
                    startTime: safeStartTime,
                    durationMs,
                    context,
                };

                await this.processAndFinalizeMeeting(snapshot, m.id);
                console.log(`[MeetingPersistence] Recovered meeting ${m.id}`);

            } catch (e) {
                console.error(`[MeetingPersistence] Failed to recover meeting ${m.id}`, e);
            }
        }
    }
}
