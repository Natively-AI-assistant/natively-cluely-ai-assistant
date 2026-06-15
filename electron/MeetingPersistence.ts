// MeetingPersistence.ts
// Handles meeting lifecycle: stop, save, and recovery.
// Extracted from IntelligenceManager to decouple DB operations from LLM orchestration.

import { SessionTracker, TranscriptSegment } from './SessionTracker';
import { LLMHelper } from './LLMHelper';
import { DatabaseManager, Meeting } from './db/DatabaseManager';
import { GROQ_TITLE_PROMPT, GROQ_SUMMARY_JSON_PROMPT } from './llm';
import { buildPostCallEnhancements } from './services/post-call/PostCallWorkflow';
import { MeetingMemoryService } from './intelligence/MeetingMemoryService';
import { LongTermMemoryService } from './intelligence/memory/LongTermMemoryService';
import { isIntelligenceFlagEnabled } from './intelligence/intelligenceFlags';
import { telemetryService } from './services/telemetry/TelemetryService';
import type { ProviderDataScopePolicy } from './llm/ProviderRouter';
const crypto = require('crypto');

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
    public async stopMeeting(): Promise<string | null> {
        console.log('[MeetingPersistence] Stopping meeting and queueing save...');

        // 0. Force-save any pending interim transcript
        this.session.flushInterimTranscript();

        // 1. Snapshot valid data BEFORE resetting
        const durationMs = Date.now() - this.session.getSessionStartTime();
        if (durationMs < 1000) {
            console.log("Meeting too short, ignoring.");
            this.session.reset();
            return null;
        }

        // Phase 9 — privacy gate: 'never' retention or per-meeting do-not-persist
        // skips persistence entirely. We still emit telemetry (sanitized) so
        // usage analytics work, but NO transcript / NO summary / NO DB row.
        let doNotPersist = false;
        try {
            const { SettingsManager } = require('./services/SettingsManager');
            const retention = SettingsManager.getInstance().get('meetingRetention');
            if (retention === 'never') doNotPersist = true;
            // Per-meeting toggle is read from SessionTracker meeting metadata
            // (e.g. set via the renderer "Do not persist this meeting" toggle).
            const meta = this.session.getMeetingMetadata?.();
            if (meta && (meta as any).doNotPersist === true) doNotPersist = true;
        } catch (err) {
            console.error('[MeetingPersistence] Failed to read retention settings, defaulting to discard for safety:', err);
            doNotPersist = true; // Fail-secure fallback
        }
        if (doNotPersist) {
            console.log('[MeetingPersistence] doNotPersist set — skipping save (no DB row, no summary).');
            try {
                const { telemetryService } = require('./services/telemetry/TelemetryService');
                telemetryService.track({
                    name: 'meeting_stop',
                    properties: { persisted: false, reason: 'do_not_persist', durationMs },
                });
            } catch { /* non-fatal */ }
            this.session.reset();
            return null;
        }

        const snapshot = {
            transcript: [...this.session.getFullTranscript()],
            usage: [...this.session.getFullUsage()],
            startTime: this.session.getSessionStartTime(),
            durationMs: durationMs,
            context: this.session.getFullSessionContext()
        };

        // BUG-04 fix: snapshot metadata BEFORE reset() clears it so the
        // background processAndSaveMeeting worker receives the calendar info.
        const metadataSnapshot = this.session.getMeetingMetadata();

        // BUG-MODE-BLEEDING fix: snapshot the active mode BEFORE reset() so the
        // background processAndSaveMeeting worker uses the correct mode's note
        // sections even if the user switches modes before async processing completes.
        let modeSnapshot: { id: string; name: string; templateType: string } | null = null;
        try {
            const { ModesManager } = require('./services/ModesManager');
            const activeMode = ModesManager.getInstance().getActiveMode();
            if (activeMode) {
                modeSnapshot = { id: activeMode.id, name: activeMode.name, templateType: activeMode.templateType };
                console.log(`[MeetingPersistence] Mode snapshot captured: "${activeMode.name}" (${activeMode.templateType})`);
            }
        } catch (modeErr: any) {
            console.warn('[MeetingPersistence] Failed to capture mode snapshot:', modeErr?.message);
        }

        // 2. Reset state immediately so new meeting can start or UI is clean
        this.session.reset();

        const meetingId = crypto.randomUUID();

        // 4. Initial Save (Placeholder)
        const minutes = Math.floor(durationMs / 60000);
        const seconds = ((durationMs % 60000) / 1000).toFixed(0);
        const durationStr = `${minutes}:${Number(seconds) < 10 ? '0' : ''}${seconds}`;

        const placeholder: Meeting = {
            id: meetingId,
            title: "Processing...",
            date: new Date().toISOString(),
            duration: durationStr,
            summary: "Generating summary...",
            detailedSummary: { actionItems: [], keyPoints: [] },
            transcript: snapshot.transcript,
            usage: snapshot.usage,
            isProcessed: false
        };

        try {
            DatabaseManager.getInstance().saveMeeting(placeholder, snapshot.startTime, durationMs);
            // Notify Frontend
            const wins = require('electron').BrowserWindow.getAllWindows();
            wins.forEach((w: any) => w.webContents.send('meetings-updated'));
        } catch (e) {
            console.error("Failed to save placeholder", e);
        }

        this.processAndSaveMeeting(snapshot, meetingId, metadataSnapshot, modeSnapshot).catch(err => {
            console.error('[MeetingPersistence] Background processing failed:', err);
        });

        return meetingId;
    }

    /**
     * Heavy lifting: LLM Title, Summary, and DB Write
     */
    private async processAndSaveMeeting(
        data: { transcript: TranscriptSegment[], usage: any[], startTime: number, durationMs: number, context: string },
        meetingId: string,
        // BUG-04 fix: accept metadata snapshot so calendar info is not lost after session.reset()
        metadata?: { title?: string; calendarEventId?: string; source?: 'manual' | 'calendar' } | null,
        // BUG-MODE-BLEEDING fix: accept mode snapshot so async summary uses the mode that was
        // active when meeting stopped, not whatever mode is active when async processing runs.
        modeSnapshot?: { id: string; name: string; templateType: string } | null
    ): Promise<void> {
        let title = "Untitled Session";
        let summaryData: { overview?: string; actionItems: string[], keyPoints: string[], sections?: Array<{ title: string; bullets: string[] }> } = { actionItems: [], keyPoints: [] };
        // Phase 6 — post_call_summary lifecycle telemetry. Wrapped in try/catch
        // around track calls so a telemetry sink fault never breaks persistence.
        const _postCallStart = Date.now();
        try {
            telemetryService.track({
                name: 'post_call_summary_started',
                modeId: modeSnapshot?.id,
                properties: {
                    modeTemplateType: modeSnapshot?.templateType,
                    transcriptSegmentCount: data.transcript.length,
                    durationMs: data.durationMs,
                },
            });
        } catch { /* non-fatal */ }

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

            // Load template note sections for the mode that was active when meeting stopped.
            // BUG-MODE-BLEEDING fix: use the snapshotted mode, not getActiveMode() which may
            // return a different mode if the user switched modes before async processing completed.
            let modeNoteSections: Array<{ title: string; description: string }> = [];
            let modeContextBlock = '';
            try {
                const { ModesManager, TEMPLATE_NOTE_SECTIONS } = require('./services/ModesManager');
                const modesMgr = ModesManager.getInstance();

                // Use snapshot mode if available, otherwise fall back to current active mode (for recovery scenarios)
                const targetModeId = modeSnapshot?.id ?? modesMgr.getActiveMode()?.id;
                if (!targetModeId) {
                    console.log('[MeetingPersistence] No mode active — using generic summary.');
                } else {
                    // Get the mode's templateType from snapshot or look it up
                    const templateType = modeSnapshot?.templateType ?? modesMgr.getModes().find((m: { id: string; templateType?: string }) => m.id === targetModeId)?.templateType;
                    const modeName = modeSnapshot?.name ?? modesMgr.getModes().find((m: { id: string; name?: string }) => m.id === targetModeId)?.name ?? 'Unknown';

                    // Prefer user's customized DB sections; fall back to canonical template
                    const dbSections: Array<{ title: string; description: string }> = modesMgr.getNoteSections(targetModeId);
                    modeNoteSections = dbSections.length > 0
                        ? dbSections
                        : (templateType ? (TEMPLATE_NOTE_SECTIONS[templateType as keyof typeof TEMPLATE_NOTE_SECTIONS] ?? []) : []);
                    console.log(`[MeetingPersistence] Summary mode: "${modeName}" (${templateType}), sections: ${modeNoteSections.length} (${dbSections.length > 0 ? 'custom DB' : 'canonical template'})`);

                    // Build the summary-safe mode context block.
                    // Phase 6 — never inject raw reference-file bodies into post-call summary
                    // prompts. Use ModesManager.buildSummarySafeModeContextBlock(), which keeps
                    // the mode's customContext (trusted, low-token) and only adds retrieved
                    // reference snippets. Honors the providerDataScopes policy:
                    //   - `post_call_summary === false` → no mode context at all
                    //   - `reference_files === false`   → customContext only, no retrieved snippets
                    if (modeSnapshot) {
                        let scopePolicy: ProviderDataScopePolicy | undefined = undefined;
                        try {
                            const { SettingsManager } = require('./services/SettingsManager');
                            scopePolicy = SettingsManager.getInstance().get('providerDataScopes');
                        } catch { /* non-fatal */ }
                        const summaryAllowed = scopePolicy?.post_call_summary !== false;
                        const referenceSnippetsAllowed = scopePolicy?.reference_files !== false;

                        if (summaryAllowed) {
                            const transcriptHint = data.context.substring(0, 4000);
                            modeContextBlock = modesMgr.buildSummarySafeModeContextBlock(modeSnapshot.id, {
                                query: 'meeting summary',
                                transcript: transcriptHint,
                                tokenBudget: 1200,
                                includeReferenceSnippets: referenceSnippetsAllowed,
                            }) || '';
                        } else {
                            console.warn('[ScopeFallback] post_call_summary denied for cloud; routing to Ollama');
                            modeContextBlock = '';
                        }
                    }
                }
            } catch (modeErr: any) {
                console.warn('[MeetingPersistence] Failed to load mode sections:', modeErr?.message);
            }

            // Generate Structured Summary
            if (data.transcript.length > 2) {
                const baseRules = `RULES:
- Do NOT invent information not present in the context
- You MAY infer implied action items or next steps if they are logical consequences of the discussion
- Do NOT explain or define concepts mentioned
- Do NOT use filler phrases like "The meeting covered..." or "Discussed various..."
- Do NOT mention transcripts, AI, or summaries
- Do NOT sound like an AI assistant
- Sound like a senior PM's internal notes

STYLE: Calm, neutral, professional, skim-friendly. Short bullets, no sub-bullets.`;

                let summaryPrompt: string;
                let groqSummaryPrompt: string;

                if (modeNoteSections.length > 0) {
                    // Mode-specific structured notes — sections as object with title keys
                    const sectionList = modeNoteSections
                        .map(s => s.description?.trim()
                            ? `- "${s.title}": ${s.description}`
                            : `- "${s.title}"`)
                        .join('\n');
                    const sectionKeys = modeNoteSections
                        .map(s => `    "${s.title}": []`)
                        .join(',\n');

                    summaryPrompt = `You are a silent meeting note-taker. Extract structured notes from the conversation transcript below.
${modeContextBlock}
${baseRules}

SECTIONS TO FILL (extract only what is present in the transcript):
${sectionList}

Return ONLY valid JSON — no markdown fences, no comments, no extra keys. Each section value is an array of concise factual bullet strings taken directly from the conversation. Use [] if a section has no relevant content.

{
  "overview": "1-2 sentence summary of what was discussed",
  "sections": {
${sectionKeys}
  }
}`;
                    console.log('[MeetingPersistence] Using mode-specific prompt with sections:', modeNoteSections.map(s => s.title));
                    groqSummaryPrompt = summaryPrompt;
                } else {
                    // Default generic notes
                    summaryPrompt = `You are a silent meeting summarizer. Convert this conversation into concise internal meeting notes.

${baseRules}

Return ONLY valid JSON (no markdown code blocks):
{
  "overview": "1-2 sentence description of what was discussed",
  "keyPoints": ["3-6 specific bullets - each = one concrete topic or point discussed"],
  "actionItems": ["specific next steps, assigned tasks, or implied follow-ups. If absolutely none found, return empty array"]
}`;
                    groqSummaryPrompt = GROQ_SUMMARY_JSON_PROMPT;
                }

                const generatedSummary = await this.llmHelper.generateMeetingSummary(summaryPrompt, data.context.substring(0, 10000), groqSummaryPrompt);

                if (generatedSummary) {
                    // Strip markdown fences if present
                    const jsonMatch = generatedSummary.match(/```(?:json)?\n?([\s\S]*?)\n?```/) || [null, generatedSummary];
                    const jsonStr = (jsonMatch[1] || generatedSummary).trim();
                    console.log('[MeetingPersistence] LLM summary response received', { length: jsonStr.length });
                    try {
                        const parsed = JSON.parse(jsonStr);
                        if (modeNoteSections.length > 0 && parsed.sections && typeof parsed.sections === 'object') {
                            // Convert sections object into typed array preserving template order
                            const sectionsArr: Array<{ title: string; bullets: string[] }> = modeNoteSections
                                .map(s => ({
                                    title: s.title,
                                    bullets: Array.isArray(parsed.sections[s.title]) ? parsed.sections[s.title] as string[] : [],
                                }));
                            console.log('[MeetingPersistence] Parsed mode sections:', sectionsArr.map(s => `${s.title}(${s.bullets.length})`));
                            summaryData = {
                                overview: parsed.overview,
                                actionItems: [],
                                keyPoints: [],
                                sections: sectionsArr,
                            };
                        } else {
                            if (modeNoteSections.length > 0) {
                                console.warn('[MeetingPersistence] Mode sections expected but LLM did not return "sections" key. Falling back to generic.');
                            }
                            summaryData = parsed;
                        }
                    } catch (e) {
                        console.error('[MeetingPersistence] Failed to parse summary JSON', { responseLength: jsonStr.length, error: e });
                    }
                }
            } else {
                console.log("Transcript too short for summary generation.");
            }

            summaryData = {
                ...summaryData,
                ...buildPostCallEnhancements({
                    transcript: data.transcript,
                    modeTemplateType: modeSnapshot?.templateType,
                    summaryData,
                }),
            };

            // MEETING MEMORY V2 (Phase 8 wiring, behind meeting_memory_v2_enabled):
            // extract first-class structured memory (entities/topics/decisions/questions/
            // action-items/skills/companies) and PERSIST it into summary_json under a
            // `meetingMemory` key. This runs in the ALREADY-BACKGROUND processAndSaveMeeting
            // worker (fired fire-and-forget from stopMeeting), so it can never block live
            // answering (non-negotiable rule). It's a NEW key in summary_json — no DB
            // migration, fully backward-compatible (old meetings just lack it; readers
            // handle absence). Deterministic, no LLM, no extra provider call. Flag OFF →
            // summaryData is byte-for-byte unchanged.
            try {
                if (isIntelligenceFlagEnabled('meetingMemoryV2')) {
                    const record = new MeetingMemoryService().buildMeetingRecord({
                        meetingId,
                        segments: data.transcript,
                        mode: modeSnapshot?.templateType,
                        startedAt: data.startTime,
                        endedAt: data.startTime + data.durationMs,
                    });
                    (summaryData as any).meetingMemory = {
                        topics: record.topics,
                        questionsAsked: record.questionsAsked,
                        decisions: record.decisions,
                        actionItems: record.actionItems,
                        entities: record.entities,
                        skillsDiscussed: record.skillsDiscussed,
                        companiesDiscussed: record.companiesDiscussed,
                        participants: record.participants,
                        sourceQuality: record.sourceQuality,
                        schemaVersion: 1,
                    };
                }
            } catch (memErr) {
                console.warn('[MeetingMemoryV2] extraction skipped (non-fatal):', (memErr as any)?.message);
            }
        } catch (e) {
            console.error("Error generating meeting metadata", e);
        }

        try {
            const minutes = Math.floor(data.durationMs / 60000);
            const seconds = ((data.durationMs % 60000) / 1000).toFixed(0);
            const durationStr = `${minutes}:${Number(seconds) < 10 ? '0' : ''}${seconds}`;

            const meetingData: Meeting = {
                id: meetingId,
                title: title,
                date: new Date().toISOString(),
                duration: durationStr,
                summary: "See detailed summary",
                detailedSummary: summaryData,
                transcript: data.transcript,
                usage: data.usage,
                calendarEventId: calendarEventId,
                source: source,
                isProcessed: true
            };

            DatabaseManager.getInstance().saveMeeting(meetingData, data.startTime, data.durationMs);

            // HINDSIGHT POST-MEETING RETAIN (Phase 13 wiring, behind
            // hindsight_post_meeting_retain_enabled). After the meeting is persisted
            // locally, ASYNC-retain its summary into long-term memory IF Hindsight is
            // configured. LongTermMemoryService.fromFlags returns a NoopMemoryProvider
            // unless hindsight_memory is ALSO on AND a baseUrl is configured AND the
            // optional @vectorize-io/hindsight-client is installed — so with no server
            // this is a guaranteed no-op (the app works fully without Hindsight). retain
            // is async/queued (never blocks). Scope tags enforce per-user/org isolation.
            // Runs in the already-background processAndSaveMeeting worker.
            try {
                // Config from HindsightManager (settings OR env) so this works in a packaged
                // build, not just when HINDSIGHT_BASE_URL is exported in a dev shell.
                const { HindsightManager } = require('./services/HindsightManager') as typeof import('./services/HindsightManager');
                const _hm = HindsightManager.getInstance();
                const hsCfg = _hm.getHindsightConfig();
                // Skip a known-down server (cached health) — don't queue a retain that
                // can't land (2026-06-14 fix).
                if (isIntelligenceFlagEnabled('hindsightPostMeetingRetain') && hsCfg && _hm.isAvailable()) {
                    const ltm = LongTermMemoryService.fromFlags({ hindsight: hsCfg });
                    if (ltm.enabled) {
                        const summaryText = typeof summaryData?.overview === 'string'
                            ? summaryData.overview
                            : JSON.stringify(summaryData?.keyPoints ?? []);
                        // Per-install scope id (isolates two installs sharing one Cloud
                        // account); mode tag scopes by meeting mode.
                        ltm.retainMeetingSummary(meetingId, summaryText, { userId: _hm.localUserId(), meetingId }, modeSnapshot?.templateType);
                        console.log('[Hindsight] queued post-meeting summary retain', { meetingId, provider: ltm.providerName });
                    }
                }
            } catch (hsErr) {
                console.warn('[Hindsight] post-meeting retain skipped (non-fatal):', (hsErr as any)?.message);
            }

            // Metadata was already snapshotted before session.reset() — nothing to clear here.

            // Notify Frontend to refresh list
            const wins = require('electron').BrowserWindow.getAllWindows();
            wins.forEach((w: any) => w.webContents.send('meetings-updated'));

            // Phase 6 — post_call_summary_completed (no transcript / no summary text;
            // counts and durations only).
            try {
                const enhancements = (summaryData as any) || {};
                telemetryService.track({
                    name: 'post_call_summary_completed',
                    modeId: modeSnapshot?.id,
                    durationMs: Date.now() - _postCallStart,
                    properties: {
                        modeTemplateType: modeSnapshot?.templateType,
                        actionItemCount: Array.isArray(enhancements.actionItemsStructured) ? enhancements.actionItemsStructured.length : 0,
                        coachingInsightCount: Array.isArray(enhancements.coachingInsights) ? enhancements.coachingInsights.length : 0,
                        sectionsCount: Array.isArray(enhancements.sections) ? enhancements.sections.length : 0,
                    },
                });
            } catch { /* non-fatal */ }

        } catch (error) {
            console.error('[MeetingPersistence] Failed to save meeting:', error);
            try {
                telemetryService.track({
                    name: 'post_call_summary_failed',
                    modeId: modeSnapshot?.id,
                    durationMs: Date.now() - _postCallStart,
                    properties: { errorClass: (error as Error)?.constructor?.name ?? 'Unknown' },
                });
            } catch { /* non-fatal */ }
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

                const parts = (details.duration || '0:00').split(':');
                // EC-07 fix: guard against malformed duration strings (e.g. corrupted DB row)
                const mins = parseInt(parts[0]) || 0;
                const secs = parseInt(parts[1]) || 0;
                const durationMs = ((mins * 60) + secs) * 1000;
                const startTime = new Date(details.date).getTime();

                const snapshot = {
                    transcript: details.transcript as TranscriptSegment[],
                    usage: details.usage,
                    startTime: startTime,
                    durationMs: durationMs,
                    context: context
                };

                await this.processAndSaveMeeting(snapshot, m.id);
                console.log(`[MeetingPersistence] Recovered meeting ${m.id}`);

            } catch (e) {
                console.error(`[MeetingPersistence] Failed to recover meeting ${m.id}`, e);
            }
        }
    }
}
