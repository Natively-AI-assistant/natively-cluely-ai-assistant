// MeetingPersistence.ts
// Handles meeting lifecycle: stop, save, and recovery.
// Extracted from IntelligenceManager to decouple DB operations from LLM orchestration.

import { SessionTracker, TranscriptSegment } from './SessionTracker';
import { LLMHelper } from './LLMHelper';
import { DatabaseManager, Meeting } from './db/DatabaseManager';
import { GROQ_SUMMARY_JSON_PROMPT } from './llm';
import { buildPostCallEnhancements } from './services/post-call/PostCallWorkflow';
import { MeetingContextAssembler } from './services/meeting/MeetingContextAssembler';
import { MEETING_TITLE_MAX_CHARS, cleanMeetingTitle, firstSentenceOf, fitTitleLength, isAnswerFragmentTitle, isAnswerShapedGeneration, isEmptySessionTitle, isNarrationTitle, isQuestionTitle } from './services/meeting/MeetingSummaryV3';
import { NOTE_CALL_TIMEOUT_MS } from './services/meeting/generateStructured';
import type { MeetingSummaryTelemetryMeta } from './services/meeting/types';
import { TranscriptNormalizer } from './services/meeting/TranscriptNormalizer';
import { buildShortSessionPrompt, countHumanContent, isShortSession, parseShortSessionNotes } from './services/meeting/shortSessionNotes';
import { notesContextFromParams } from './services/meeting/MeetingContextAssembler';
import { formatSharedScreensBlock, sharedScreenEntries } from './services/meeting/screenShareNotes';
import { buildNotesInputs, type NotesInputs } from './services/meeting/notesInputs';
import { buildV2FallbackPrompts, parseV2SummaryResponse, v2NotesHaveContent } from './services/meeting/v2FallbackNotes';
import { MeetingMemoryService, buildPersistedMeetingMemory } from './intelligence/MeetingMemoryService';
import type { MeetingMemoryProvenanceTelemetry } from './intelligence/MeetingMemoryService';
import { LongTermMemoryService } from './intelligence/memory/LongTermMemoryService';
import { isIntelligenceFlagEnabled } from './intelligence/intelligenceFlags';
import { recordAttribution, hindsightModeFor } from './intelligence/IntelligenceAttribution';
import { telemetryService } from './services/telemetry/TelemetryService';
import type { ProviderDataScopePolicy } from './llm/ProviderRouter';
import { LiveMeetingJournal, type LiveJournalSnapshot, type MeetingRecoveryMeta } from './services/meeting/LiveMeetingJournal';
import { getUserDictionary } from './audio/userDictionary';
import { isArchivableNotes } from './services/meeting/notesVersions';
const crypto = require('crypto');

/** Longest a derived fallback title may be: the same bound as a generated one. */
const DERIVED_TITLE_MAX_CHARS = MEETING_TITLE_MAX_CHARS;
/** Fewest distinct 4+ letter note words a title's grounding is judged against. */
const GROUNDING_MIN_CORPUS_WORDS = 12;

// How a note line opens when it narrates rather than names: a speaker label
// ("Evin: HackerRank was not flagging anything") or a description of the session
// ("A very short session in which Evin asked…"). Both were saved as real titles.
const NOTE_SPEAKER_LABEL_RE = /^[\p{L}][\p{L}.' -]{0,30}:\s+(?=\S)/u;
const NOTE_SESSION_PREAMBLE_RE = /^(?:(?:a|an|this|the)\s+(?:(?:very|short|brief|quick)\s+)*(?:session|meeting|call|conversation|chat)\s+(?:in which|where|that)\s+|in (?:this|the) (?:session|meeting|call|conversation),?\s+)/i;

/** Collapse one note string into a title: the speaker label and session preamble
 *  dropped, first sentence only, cut on a whole phrase within 50 characters
 *  (fitTitleLength), first letter capitalised.
 *  Deliberately NOT routed through cleanMeetingTitle / isAnswerFragmentTitle /
 *  isAnswerShapedGeneration as a whole: those guards judge MODEL output ("did it
 *  name the meeting or answer it"), and a note sentence is answer-shaped by
 *  construction. Only the shapes that are never a name apply: narration, a
 *  question, a description of an empty session. */
function shortenToTitleLength(value: string): string {
    let collapsed = String(value || '').replace(/\s+/g, ' ').replace(/^["'`\s]+|["'`\s]+$/g, '').trim();
    collapsed = collapsed.replace(NOTE_SPEAKER_LABEL_RE, '').replace(NOTE_SESSION_PREAMBLE_RE, '').trim();
    if (!collapsed) return '';
    const firstSentence = firstSentenceOf(collapsed);
    // A note that narrates ("The user asked the assistant…"), says the session was
    // empty, or asks a question is not a name; the caller moves on to the next note
    // (or keeps the default title).
    if (isNarrationTitle(firstSentence) || isEmptySessionTitle(firstSentence) || isQuestionTitle(firstSentence)) return '';
    // The character bound is the binding one here: a note phrase is not prose to
    // be stopped at eight words, and the word cap would cut it short of 50.
    const out = fitTitleLength(firstSentence.replace(/[\s.,;:!?]+$/, ''), DERIVED_TITLE_MAX_CHARS, DERIVED_TITLE_MAX_CHARS);
    // The cut can leave a narrating head of a longer sentence ("Evin said …").
    if (!out || isNarrationTitle(out)) return '';
    return out.charAt(0).toUpperCase() + out.slice(1);
}

/** Topics as a readable list that fits the title: "Onboarding, pilot and
 *  security review". Drops topics from the end until it fits; a single topic
 *  that is itself too long is cut on a whole phrase. A topic that only says the
 *  session was empty is left out, and the others still make the title. */
function topicsTitle(allTopics: string[]): string {
    const topics = allTopics.filter(t => !isEmptySessionTitle(t) && !isQuestionTitle(t) && !isNarrationTitle(t));
    for (let n = Math.min(3, topics.length); n >= 1; n--) {
        const chosen = topics.slice(0, n);
        const joined = n === 1 ? chosen[0] : `${chosen.slice(0, -1).join(', ')} and ${chosen[n - 1]}`;
        if (joined.length <= DERIVED_TITLE_MAX_CHARS) return joined.charAt(0).toUpperCase() + joined.slice(1);
    }
    return shortenToTitleLength(topics[0] || '');
}

/**
 * Deterministic, llm-free title derived from the notes already in hand.
 *
 * Tier order: topics (the meeting's subjects, already short noun phrases, so they
 * read most like a title), then the first takeaway, then the overview. Takeaways and
 * the overview are sentences, so only their first phrase survives. Returns null when
 * every tier is empty, or only says the session was empty or asks a question: the
 * meeting then keeps its default title rather than a description of its emptiness.
 */
function deriveDeterministicTitle(parts: { topics: string[]; takeaways: string[]; overview: string }): string | null {
    const topics = parts.topics.map(t => String(t || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (topics.length > 0) {
        const fromTopics = topicsTitle(topics);
        if (fromTopics) return fromTopics;
    }
    // The first takeaway that makes a name: one that only says the session was
    // empty, or asks a question, gives way to the next.
    for (const takeaway of parts.takeaways.map(t => String(t || '').trim()).filter(Boolean)) {
        const fromTakeaway = shortenToTitleLength(takeaway);
        if (fromTakeaway) return fromTakeaway;
    }
    if (parts.overview) {
        const fromOverview = shortenToTitleLength(parts.overview);
        if (fromOverview) return fromOverview;
    }
    return null;
}

/** Where a meeting's title came from. `none` = nothing groundable to name. */
export type TitleSource = 'model' | 'fallback' | 'none';

export interface GeneratedTitle {
    title: string | null;
    source: TitleSource;
}

/**
 * Name the meeting from the title its notes call wrote (2026-10-18).
 *
 * Naming used to be a model call of its own after the notes were written. Now the
 * notes call that reads the whole meeting writes "title" in the same reply — the V3
 * overview (SummaryPolisher.polishOverview), the short-session call or the V2
 * fallback — so naming a meeting costs no request, and the name covers the whole
 * meeting rather than its opening. This function only VETS that title: it never
 * calls a model.
 *
 * Returns `none` ONLY when there is nothing groundable to name. Every other failure
 * (no title in the reply, the no-action sentinel, an answer instead of a name, a name
 * with nothing in common with the notes) falls back to a title DERIVED FROM THE NOTES
 * — see deriveDeterministicTitle. A real production meeting was saved unnamed because
 * the model returned "[[NO_ACTION]]" (2026-08-26): a meeting always needs a name, so
 * `none` must mean "nothing to name", never "generation misbehaved". The source tells
 * a REGENERATE apart from a first save (shouldReplaceTitleOnRegenerate).
 *
 * Fallback input priority (RC-9): topics, then tldr -> keyPoints -> overview, because
 * BOTH summary pipelines must work: the legacy V2 path populates keyPoints/overview but
 * leaves tldr empty.
 */
export function vetProposedTitle(
    proposed: string | null | undefined,
    summary: { title?: string; tldr?: string[]; keyPoints?: string[]; overview?: string; topics?: string[] },
): GeneratedTitle {
    const asFallback = (t: string | null): GeneratedTitle => ({ title: t, source: t ? 'fallback' : 'none' });
    const clean = (arr?: string[]) => (arr || []).map(t => String(t || '').trim()).filter(Boolean);
    const overview = typeof summary.overview === 'string' ? summary.overview.trim() : '';
    const topics = clean(summary.topics).slice(0, 10);

    // tldr -> keyPoints -> overview. Never combine tiers — the first non-empty source wins.
    let takeaways = clean(summary.tldr);
    if (takeaways.length === 0) takeaways = clean(summary.keyPoints);

    if (takeaways.length === 0 && !overview && topics.length === 0) return { title: null, source: 'none' };

    const fallbackTitle = deriveDeterministicTitle({ topics, takeaways, overview });
    let generatedTitle = typeof proposed === 'string' ? proposed : '';
    if (!generatedTitle.trim()) return asFallback(fallbackTitle);

    // Reuse the prompt system's OWN sentinel helpers rather than a local regex, so a
    // change to NO_ACTION_SENTINEL can never leave this check matching the old token.
    let isRefusal: ((text: string) => boolean) | null = null;
    let stripRefusal: ((text: string) => string) | null = null;
    try {
        const promptSystemV2 = require('./llm/promptSystemV2');
        if (typeof promptSystemV2.shouldSuppressModelOutput === 'function') isRefusal = promptSystemV2.shouldSuppressModelOutput;
        if (typeof promptSystemV2.stripLeadingNoActionSentinel === 'function') stripRefusal = promptSystemV2.stripLeadingNoActionSentinel;
    } catch { /* the shape guards below still run */ }

    // REFUSAL, not a bad title. Detect it explicitly: routed through the guards below it
    // reads as "ungrounded", which sent the first investigation of this down the wrong path.
    if (isRefusal?.(generatedTitle)) {
        console.warn('[MeetingPersistence] Title refused with the no-action sentinel — using the note-derived fallback.');
        return asFallback(fallbackTitle);
    }
    // Misfire shape: sentinel followed by a real title. Keep the title, drop the sentinel.
    if (stripRefusal) generatedTitle = stripRefusal(generatedTitle);

    const cleanedTitle = cleanMeetingTitle(generatedTitle);
    if (!cleanedTitle) return asFallback(fallbackTitle);
    // The reply is judged as written too: the clamp can cut "A very short session in
    // which Evin asked…" down to a shape the checks no longer recognise.
    const asWritten = generatedTitle.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? '';
    if (isAnswerFragmentTitle(cleanedTitle) || isAnswerShapedGeneration(generatedTitle) || isAnswerFragmentTitle(asWritten)) {
        console.warn(`[MeetingPersistence] Generated title rejected as answer fragment: "${cleanedTitle}"`);
        return asFallback(fallbackTitle);
    }

    // The shape guards above (cleanMeetingTitle / isAnswerFragmentTitle /
    // isAnswerShapedGeneration) only check that the model NAMED the meeting rather than
    // answering it — none of them checks whether the title is about THIS meeting. A real
    // production failure produced a well-formed, Title Case, non-answer-shaped title
    // ("Penetration testing of the user-facing input surface") for a meeting whose notes
    // never mentioned that topic at all. Mirror the grounding check FollowUpDraftGenerator
    // already applies to email subjects (see validatedSubject there): require the title to
    // share at least one meaningful word with the note content it was generated from.
    const titleTokens = new Set(
        cleanedTitle.toLowerCase().split(/\W+/).filter(w => w.length >= 4)
    );
    if (titleTokens.size > 0) {
        const corpus = [
            ...clean(summary.tldr),
            ...clean(summary.keyPoints),
            ...topics,
            overview,
            typeof summary.title === 'string' ? summary.title : '',
        ].join(' ').toLowerCase().split(/\W+/).filter(w => w.length >= 4);
        const corpusSet = new Set(corpus);
        // Too few words to judge by: a short session's notes ("Evin said hello and
        // the call ended") rarely repeat the word its name uses ('Quick greeting'),
        // and that name is exactly what the title rule asks for.
        if (corpusSet.size >= GROUNDING_MIN_CORPUS_WORDS) {
            // Word forms count as the same word: "greeting" is grounded by "greeted".
            const stem = (w: string) => w.slice(0, 5);
            const corpusStems = new Set([...corpusSet].map(stem));
            let overlap = 0;
            for (const t of titleTokens) if (corpusSet.has(t) || corpusStems.has(stem(t))) overlap++;
            // Require ≥1 overlapping meaningful word. A title with ZERO overlap with the
            // notes it was generated from is ungrounded/hallucinated — drop it in favour
            // of the note-derived fallback rather than saving it silently.
            if (overlap === 0) {
                console.warn(`[MeetingPersistence] Generated title rejected as ungrounded (no overlap with notes): "${cleanedTitle}"`);
                return asFallback(fallbackTitle);
            }
        }
        // No usable corpus (sparse summary) — accept the title rather than drop it,
        // matching FollowUpDraftGenerator's validatedSubject behaviour for the same case.
        // A short session's few words count as sparse too.
    }

    return { title: cleanedTitle, source: 'model' };
}

// The two placeholders a meeting can be carrying instead of a real name:
// "Untitled Session" (this file's save-path default) and "Meeting Notes"
// (MeetingSummaryReducer's `params.title || 'Meeting Notes'`).
const DEFAULT_MEETING_TITLE_RE = /^(?:untitled\b|meeting notes$)/i;

/** True when a title is absent or one of the known placeholders — i.e. not a real name. */
export function isDefaultMeetingTitle(title: string | null | undefined): boolean {
    const t = typeof title === 'string' ? title.trim() : '';
    return !t || DEFAULT_MEETING_TITLE_RE.test(t);
}

/**
 * Regeneration-only title policy (2026-08-26).
 *
 * On the FIRST save a note-derived fallback is always an improvement over the "Untitled
 * Session" default. On REGENERATION it is not: the meeting may already carry a good
 * model-generated name, and since the fallback landed a refusal/timeout during regenerate
 * would silently DOWNGRADE it to the mechanical one (the old `null` return could not).
 * So a fallback-derived title may only fill an empty/placeholder title; a model-generated
 * one always wins. A manual rename is protected one layer lower by replaceDetailedSummary's
 * user_titled CASE WHEN, so this predicate never has to reason about it.
 */
export function shouldReplaceTitleOnRegenerate(existing: string | null | undefined, candidate: GeneratedTitle): boolean {
    if (!candidate?.title) return false;
    if (candidate.source === 'model') return true;
    return isDefaultMeetingTitle(existing);
}

/** The database as the live journal's store; null while the database is unavailable. */
function liveJournalStore(): import('./services/meeting/LiveMeetingJournal').LiveJournalStore | null {
    try {
        const db = DatabaseManager.getInstance();
        return { write: (row) => db.writeLiveMeeting(row), remove: (id) => db.removeLiveMeeting(id) };
    } catch {
        return null;
    }
}

/** Longest notes-window text kept for a meeting (the prompts read the first 8,000 characters). */
const LIVE_USER_NOTES_MAX_CHARS = 50_000;

/** "m:ss", as the meetings list shows a duration. */
function formatDuration(durationMs: number): string {
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

/**
 * The user's dictionary (Settings > Audio) as the notes' spelling list, unless
 * the caller passed one. Undefined when the list is empty, so the prompts stay
 * exactly as before for users without a dictionary.
 */
/** The notes' SHARED SCREENS block for a meeting's saved descriptions; undefined for none. */
function attachedImagesBlockFor(raw: unknown): string | undefined {
    const { formatAttachedImagesBlock } = require('./services/meeting/meetingNotesContext') as typeof import('./services/meeting/meetingNotesContext');
    return formatAttachedImagesBlock(raw) || undefined;
}

function sharedScreensBlockFor(raw: unknown): string | undefined {
    let timeZone: string | undefined;
    try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* UTC */ }
    return formatSharedScreensBlock(raw, { timeZone }) || undefined;
}

function notesVocabulary(explicit?: string[]): string[] | undefined {
    if (Array.isArray(explicit)) return explicit;
    const list = getUserDictionary();
    return list.length > 0 ? list : undefined;
}

/** What processAndSaveMeeting reads from the session's metadata (Stop's snapshot, or a recovery's). */
type ProcessMetadata = {
    title?: string;
    calendarEventId?: string;
    calendarEvent?: import('./services/calendar/calendarSessionMatch').CalendarEventSnapshot;
    callKey?: string;
    source?: 'manual' | 'calendar';
    /** A recovered meeting's saved speaking record (the live roster is gone). */
    callRoster?: { participants: string[]; spans: Array<{ name: string; start: number; end: number }>; count?: number };
    /** The user's name as the Zoom / Teams window showed it: names "Me" when the calendar gives no name. */
    callSelfName?: string;
    /** Whether the meeting app showed itself recording the call (read-only, callFacts.recordingFromTree). */
    callRecording?: boolean;
    /** Pictures the user attached to their notes during the meeting, each described for the notes. */
    attachedImages?: Array<{ path: string; name?: string; description: string; at: number }>;
    /** What others shared on screen, described (ScreenShareContext): context for the notes. */
    sharedScreens?: import('./services/meeting/ScreenShareContext').SharedScreenEntry[];
    /** The user's own notes typed during the meeting; the notes are built around them when present. */
    userNotes?: string;
    /** The user's spelling list for names and terms. */
    vocabulary?: string[];
};

/**
 * Memory-eligible lines, as Stop counts them (spoken lines; typed chat and
 * answers are not). Undefined for rows saved before lines carried their origin
 * (2026-10-04): those are processed as they always were.
 */
function countMemoryEligible(transcript: TranscriptSegment[]): number | undefined {
    if (!transcript.some((seg: any) => typeof seg?.origin === 'string' && seg.origin.length > 0)) return undefined;
    try {
        const { isMemoryEligibleSegment } = require('./intelligence/MeetingMemoryService');
        return transcript.filter((seg: any) => isMemoryEligibleSegment(seg)).length;
    } catch {
        return transcript.length;
    }
}

/**
 * The metadata and mode a recovered meeting is processed with: what was saved
 * with it, and otherwise what its row still holds (the linked calendar event).
 * Before 2026-10-15 recovery passed nothing, and a recovered meeting lost its
 * calendar speaker names, its Meet names and its mode.
 */
export function recoveryMetadataFor(
    details: { calendarEventId?: string; calendarEvent?: import('./services/calendar/calendarSessionMatch').CalendarEventSnapshot; source?: 'manual' | 'calendar'; userNotes?: string | null },
    saved: Partial<MeetingRecoveryMeta> | null,
): { metadata: ProcessMetadata | null; mode: { id: string; name: string; templateType: string } | null } {
    const metadata: ProcessMetadata = {};
    const eventId = saved?.calendarEventId ?? details.calendarEventId;
    if (eventId) metadata.calendarEventId = eventId;
    const event = saved?.calendarEvent ?? details.calendarEvent;
    if (event && event.id === eventId) metadata.calendarEvent = event;
    if (saved?.title) metadata.title = saved.title;
    else if (metadata.calendarEvent?.title) metadata.title = metadata.calendarEvent.title;
    const source = saved?.source ?? details.source;
    if (source === 'manual' || source === 'calendar') metadata.source = source;
    if (typeof saved?.callKey === 'string') metadata.callKey = saved.callKey;
    if (saved?.callRoster && Array.isArray(saved.callRoster.participants) && Array.isArray(saved.callRoster.spans)) metadata.callRoster = saved.callRoster;
    if (typeof saved?.callSelfName === 'string' && saved.callSelfName.trim()) metadata.callSelfName = saved.callSelfName;
    if (Array.isArray(saved?.sharedScreens) && saved.sharedScreens.length > 0) metadata.sharedScreens = saved.sharedScreens;
    // The user's notes from the meeting: the live copy's, else the meeting row's.
    const userNotes = typeof saved?.userNotes === 'string' && saved.userNotes.trim() ? saved.userNotes : details.userNotes;
    if (typeof userNotes === 'string' && userNotes.trim()) metadata.userNotes = userNotes;
    const mode = saved?.mode && typeof saved.mode.id === 'string' ? saved.mode : null;
    return { metadata: Object.keys(metadata).length > 0 ? metadata : null, mode };
}

export class MeetingPersistence {
    private session: SessionTracker;
    private llmHelper: LLMHelper;

    constructor(session: SessionTracker, llmHelper: LLMHelper) {
        this.session = session;
        this.llmHelper = llmHelper;
        this.liveJournal = new LiveMeetingJournal({
            store: () => liveJournalStore(),
            snapshot: () => this.liveSnapshot(),
        });
    }

    // ── The running meeting on disk (LiveMeetingJournal) ─────────────────
    //
    // The transcript is written as it grows, so a meeting still running when
    // the app quits, crashes or the OS ends the session is recovered at the
    // next launch instead of lost. Stop saves the meeting under the journal's
    // id and removes the live copy.
    private liveJournal: LiveMeetingJournal;
    // Meetings whose notes are being written right now, so a recovery pass
    // never writes them a second time.
    private processing = new Set<string>();
    private recovering: Promise<void> | null = null;

    // What the user is typing in the notes window (2026-10-15). Held here, not
    // in the session's metadata, so a calendar link or a mode change that
    // replaces the metadata never drops it. Kept across a meeting start: notes
    // typed just before Start belong to the meeting. Stop takes it.
    private liveUserNotes = '';

    /** The notes window's text for the running (or next) meeting. */
    public setLiveUserNotes(text: string): void {
        const next = typeof text === 'string' ? text.slice(0, LIVE_USER_NOTES_MAX_CHARS) : '';
        if (next === this.liveUserNotes) return;
        this.liveUserNotes = next;
        // Typing is a finished change: on disk within ~2 s, like a final line.
        this.liveJournal.noteChange(true);
    }

    public getLiveUserNotes(): string {
        return this.liveUserNotes;
    }

    /** A meeting started (main: startMeetingTransition). */
    public beginLiveMeeting(startedAt: number = Date.now()): string {
        // The meeting's clock starts here. It was left at the last reset (the
        // previous Stop, or app launch), so a saved meeting's start and length
        // included the idle time before it (2026-10-15).
        this.session.markMeetingStart(startedAt);
        const id = crypto.randomUUID();
        this.liveJournal.begin(id, startedAt);
        // AI interactions past what memory keeps go to disk once each, so a
        // meeting with thousands of answers loses none (2026-10-16). Same
        // privacy rule as the journal: nothing is written for a meeting that
        // must not be kept.
        this.session.setUsageOverflowSink?.((entries) => {
            if (this.liveJournal.meetingId !== id || this.mustNotPersist()) return;
            try { DatabaseManager.getInstance().appendLiveUsageOverflow(id, entries); }
            catch (e) { console.warn('[MeetingPersistence] could not write older AI answers to disk:', (e as Error)?.message); }
        });
        return id;
    }

    /** The running meeting's AI interactions that left memory (oldest first). Read before its live row is removed. */
    private liveUsageOverflow(): any[] {
        const id = this.liveJournal.meetingId;
        if (!id) return [];
        try { return DatabaseManager.getInstance().getLiveUsageOverflow(id); } catch { return []; }
    }

    /** A line or answer was added to the session; `final`: a finished line. */
    public noteLiveChange(final: boolean): void {
        this.liveJournal.noteChange(final);
    }

    /**
     * Write the running meeting now, synchronously (quit, OS session end). It
     * is NOT processed here: the next launch writes its notes. Returns whether
     * a row was written.
     */
    public flushLiveMeeting(endedBy: 'quit' | 'os_session_end'): boolean {
        return this.liveJournal.flush(endedBy);
    }

    public get liveMeetingId(): string | null {
        return this.liveJournal.meetingId;
    }

    // Told each time a meeting's notes are saved or regenerated, so search can
    // index the summary at the one moment it exists. An instance field, not a
    // module-level registry: the build bundles each entry file separately, so
    // module state is not shared between them.
    private notesSavedListener: ((meetingId: string) => void) | null = null;

    public setNotesSavedListener(listener: ((meetingId: string) => void) | null): void {
        this.notesSavedListener = listener;
    }

    private notifyNotesSaved(meetingId: string): void {
        try {
            this.notesSavedListener?.(meetingId);
        } catch (e: any) {
            console.warn('[MeetingPersistence] notes-saved listener threw (non-fatal):', e?.message);
        }
    }

    /**
     * Names for the voice the call left unnamed (`speaker_1`), from the
     * transcript (speakerNameSuggestions.ts). Applied, like a rename, only
     * when certain and strongly evidenced; otherwise kept as a suggestion the
     * Speakers row's rename field starts from. A rename the user made in the
     * meantime always wins. Never throws.
     */
    private async suggestSpeakerNamesAfterSave(
        meetingId: string,
        transcript: Array<{ speaker: string; text: string; speakerId?: string }>,
        labels: Record<string, string> | undefined,
        participants: string[],
        calendarEvent: import('./services/calendar/calendarSessionMatch').CalendarEventSnapshot | undefined,
    ): Promise<void> {
        try {
            if (labels?.speaker_1) return;
            const { isOtherSide } = require('./services/meetingDetection/attributeSpeakers') as typeof import('./services/meetingDetection/attributeSpeakers');
            const unnamed = transcript.filter((l) => isOtherSide(l.speaker) && !(l.speakerId && labels?.[l.speakerId]));
            if (unnamed.length < 2) return;
            const userName = this.calendarUserName();
            const lines = transcript.flatMap((l) => {
                if (/^(user|me)$/i.test(l.speaker)) return [{ label: 'Me', text: l.text }];
                if (!isOtherSide(l.speaker)) return [];
                const named = l.speakerId ? labels?.[l.speakerId] : undefined;
                return [{ label: named || 'Speaker 1', text: l.text }];
            });
            const invitees = (calendarEvent?.attendees ?? []).filter((a: any) => a?.response !== 'declined' && a?.name).map((a: any) => String(a.name));
            const others = new Set([...participants, ...invitees].map((n) => n.toLowerCase()));
            const { suggestSpeakerNames } = require('./services/meeting/speakerNameSuggestions') as typeof import('./services/meeting/speakerNameSuggestions');
            const result = await suggestSpeakerNames(
                { lines, targets: ['Speaker 1'], userName, participants, invitees },
                (system, context) => this.llmHelper.generateMeetingSummary(system, context, system, { timeoutMs: 20_000, purpose: 'extraction' }),
                { othersKnown: others.size > 0 ? others.size : null },
            );
            if (result.suggestions.length === 0) return;
            const db = DatabaseManager.getInstance();
            const current: Record<string, string> = (db.getMeetingDetails(meetingId)?.detailedSummary as any)?.speakerLabels || {};
            if (current.speaker_1) return; // renamed meanwhile
            const applied = result.apply['Speaker 1'];
            const next = applied ? { ...current, speaker_1: applied } : current;
            const speakerSuggestions = result.suggestions.map((s) => ({
                id: 'speaker_1',
                name: s.name,
                certainty: s.certainty,
                applied: s.name === applied,
                evidence: s.evidence,
            }));
            const { SpeakerLabelService } = require('./services/meeting/SpeakerLabelService');
            const svc = new SpeakerLabelService();
            const ok = db.updateSpeakerLabels(meetingId, next, (d: any) => {
                const renamed = applied ? svc.applyRenamesToSummary(d, d?.speakerLabels, next) : d;
                return { ...renamed, speakerSuggestions };
            });
            console.log(`[MeetingPersistence] speaker name suggestion: ${applied ? 'applied' : 'kept as a suggestion'} (${result.suggestions.length})`);
            // A name now on the voice is someone the user met (People view).
            if (ok && applied) this.reindexPeople(meetingId);
            if (ok) {
                try {
                    require('electron').BrowserWindow.getAllWindows().forEach((w: any) => w.webContents.send('meetings-updated'));
                } catch { /* a closed window is not a failure */ }
            }
        } catch (e: any) {
            console.warn('[MeetingPersistence] speaker name suggestion skipped:', e?.message);
        }
    }

    /** Re-read who a meeting was with (People view). Never throws. */
    protected reindexPeople(meetingId: string): void {
        try {
            const { indexMeetingPeople } = require('./services/organise/organiseService') as typeof import('./services/organise/organiseService');
            indexMeetingPeople(meetingId);
        } catch { /* the People view re-reads it later */ }
    }

    /**
     * The connected calendar account's name, which labels the user's own voice
     * ("me") in the notes; undefined without a connected calendar. A method so a
     * test can supply one (the build bundles CalendarManager into this file).
     */
    protected calendarUserName(): string | undefined {
        return followUpSenderName();
    }

    /**
     * The connected calendar account (name and address) for the notes' meeting
     * context: the address splits the invite into the user's colleagues and the
     * other side. Undefined without a connected calendar. A method so a test can
     * supply one.
     */
    protected calendarAccount(): { name?: string; email?: string } | undefined {
        try {
            const { CalendarManager } = require('./services/CalendarManager');
            const status = CalendarManager.getInstance().getConnectionStatus();
            if (!status?.connected) return undefined;
            return {
                ...(typeof status.name === 'string' ? { name: status.name } : {}),
                ...(typeof status.email === 'string' ? { email: status.email } : {}),
            };
        } catch {
            return undefined;
        }
    }

    /**
     * The user's current role and company from Profile Intelligence, for the
     * notes' meeting context. Only when Profile Intelligence is on (knowledge
     * mode) and the "Profile and history" provider scope is not turned off, the
     * same gates the live answers use. Undefined otherwise or with no résumé.
     */
    protected profileForNotes(): { role?: string; company?: string; bio?: string } | undefined {
        try {
            const { SettingsManager } = require('./services/SettingsManager');
            const sm = SettingsManager.getInstance();
            const scopes = sm.get('providerDataScopes') as ProviderDataScopePolicy | undefined;
            if (scopes?.profile_history === false || scopes?.post_call_summary === false) return undefined;
            // "About you" (Settings): the user's own words, used whenever set, with
            // or without a résumé profile; the profile below adds role and company.
            const bioRaw = sm.get('userBio');
            const bio = typeof bioRaw === 'string' ? bioRaw.replace(/\s+/g, ' ').trim().slice(0, 600) : '';
            const withBio = (p: { role?: string; company?: string } | undefined) => (bio ? { ...(p ?? {}), bio } : p);
            const orchestrator = (this.llmHelper as any)?.getKnowledgeOrchestrator?.();
            const on = typeof orchestrator?.isKnowledgeMode === 'function' ? orchestrator.isKnowledgeMode() : sm.get('knowledgeMode') === true;
            if (!on) return withBio(undefined);
            const profile = orchestrator?.getProfileData?.();
            const latest = Array.isArray(profile?.experience) ? profile.experience[0] : undefined;
            const role = typeof latest?.role === 'string' ? latest.role.trim() : '';
            const company = typeof latest?.company === 'string' ? latest.company.trim() : '';
            return withBio(role || company ? { ...(role ? { role } : {}), ...(company ? { company } : {}) } : undefined);
        } catch {
            return undefined;
        }
    }

    /**
     * Titles, companies and the user's notes on the invite's people, from the
     * People and Companies pages (accepted values only). A method so a test can
     * supply them.
     */
    protected knownPeopleFor(event: import('./services/calendar/calendarSessionMatch').CalendarEventSnapshot): import('./services/meeting/meetingNotesContext').KnownPersonInput[] {
        try {
            const { knownPeopleForEvent } = require('./services/organise/organiseService') as typeof import('./services/organise/organiseService');
            return knownPeopleForEvent(event);
        } catch {
            return [];
        }
    }

    /**
     * After a meeting is saved: who it was with, the folders its rules file it
     * into, and (when the notes may be written) the titles and companies people
     * stated, kept as suggestions. Never awaited by the save; never throws.
     */
    /**
     * Settings › Connectors: the meeting's notes are ready, so webhooks, Zapier
     * and the user's automatic-send rules may send them (connectorsDeliveryIpc).
     * Nothing goes anywhere without a rule or endpoint the user made. Never throws.
     */
    protected connectorsNotesReady(meetingId: string): void {
        try {
            const { connectorsDelivery } = require('./services/outputs/connectorsDeliveryIpc') as typeof import('./services/outputs/connectorsDeliveryIpc');
            void connectorsDelivery.notesReady(meetingId);
        } catch (e: any) {
            console.warn('[MeetingPersistence] connectors step skipped:', e?.message);
        }
    }

    /** `afterOrganised` runs once the folder rules have placed the meeting, whether or not they did anything. */
    protected organiseAfterSave(input: Omit<import('./services/organise/organiseService').AfterSaveInput, 'call'>, afterOrganised?: () => void): void {
        try {
            const { afterMeetingSaved } = require('./services/organise/organiseService') as typeof import('./services/organise/organiseService');
            void afterMeetingSaved({
                ...input,
                call: (system, context) => this.llmHelper.generateMeetingSummary(system, context, system, { timeoutMs: 25_000, purpose: 'extraction' }),
            }).then((r) => {
                if (r.folders.length || r.facts) console.log(`[MeetingPersistence] organise: ${r.people} people, ${r.folders.length} folder(s), ${r.facts} suggested fact(s)`);
                if (r.folders.length || r.facts) {
                    try { require('electron').BrowserWindow.getAllWindows().forEach((w: any) => w.webContents.send('meetings-updated')); } catch { /* a closed window is not a failure */ }
                }
            }).catch(() => { /* logged inside */ }).finally(() => afterOrganised?.());
        } catch (e: any) {
            console.warn('[MeetingPersistence] organise step skipped:', e?.message);
            afterOrganised?.();
        }
    }

    /** Earlier meetings linked to calendar events, for the "last time" lookup. */
    protected seriesCandidates(beforeMs: number): import('./services/meeting/recurringMeetings').SeriesCandidate[] {
        try {
            return DatabaseManager.getInstance().getCalendarLinkedMeetingsSince(beforeMs - 120 * 24 * 60 * 60 * 1000, 200);
        } catch {
            return [];
        }
    }

    /**
     * Everything the notes prompts carry besides the transcript. Never throws:
     * on any failure the notes are written exactly as they were before this existed.
     */
    private notesInputsFor(src: {
        meetingId: string; title?: string; startMs: number;
        calendarEvent?: import('./services/calendar/calendarSessionMatch').CalendarEventSnapshot | null;
        callParticipants?: string[]; userNotes?: string; vocabulary?: string[];
    }): NotesInputs | null {
        try {
            let timeZone: string | undefined;
            try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* UTC below */ }
            return buildNotesInputs({
                ...src,
                nowMs: Date.now(),
                timeZone,
                user: this.calendarAccount() ?? null,
                profile: this.profileForNotes() ?? null,
                seriesCandidates: src.calendarEvent ? this.seriesCandidates(src.startMs) : [],
                knownPeople: src.calendarEvent ? this.knownPeopleFor(src.calendarEvent) : [],
            });
        } catch (e: any) {
            console.warn('[MeetingPersistence] notes context skipped (non-fatal):', e?.message);
            return null;
        }
    }

    /**
     * Stops the meeting immediately, snapshots data, and triggers background processing.
     * Returns immediately so UI can switch.
     */
    public async stopMeeting(): Promise<{ meetingId: string; memoryEligibleCount: number } | null> {
        console.log('[MeetingPersistence] Stopping meeting and queueing save...');

        // 0. Force-save any pending interim transcript
        this.session.flushInterimTranscript();

        // 1. Snapshot valid data BEFORE resetting
        const durationMs = Date.now() - this.session.getSessionStartTime();
        // Stop takes the notes window's text: it goes to the notes as `userNotes`.
        const userNotes = this.liveUserNotes.trim() ? this.liveUserNotes : undefined;
        this.liveUserNotes = '';
        if (durationMs < 1000) {
            console.log("Meeting too short, ignoring.");
            this.liveJournal.end();
            this.session.reset();
            return null;
        }

        // Phase 9 — privacy gate: 'never' retention or per-meeting do-not-persist
        // skips persistence entirely. We still emit telemetry (sanitized) so
        // usage analytics work, but NO transcript / NO summary / NO DB row.
        // Per-meeting toggle is read from SessionTracker meeting metadata
        // (e.g. set via the renderer "Do not persist this meeting" toggle).
        const doNotPersist = this.mustNotPersist();
        if (doNotPersist) {
            this.liveJournal.end();
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

        // ZERO-ELIGIBLE COUNT (deep-run 2 issue 11, 2026-08-01): computed HERE,
        // at the snapshot, because this is the last place segment provenance
        // exists — DatabaseManager.saveMeeting persists (speaker, content,
        // timestamp) only, so origin/confidence cannot be re-derived from the
        // DB read that the RAG step and recovery paths perform. A session whose
        // transcript contains no memory-eligible segments (manual chat +
        // assistant answers only — e.g. audio capture off) must not run the
        // summary LLM, mode auto-detect, meeting-memory extraction, Hindsight
        // retention, or RAG chunking/embedding.
        let memoryEligibleCount = 0;
        try {
            const { isMemoryEligibleSegment } = require('./intelligence/MeetingMemoryService');
            memoryEligibleCount = this.session.getPersistableTranscript()
                .filter((seg: any) => isMemoryEligibleSegment(seg)).length;
        } catch (err) {
            // Fail OPEN to the legacy behavior (process everything): a broken
            // eligibility import must not silently discard real meetings.
            console.warn('[MeetingPersistence] eligibility check unavailable — processing normally:', err);
            memoryEligibleCount = this.session.getPersistableTranscript().length;
        }

        const snapshot = {
            // The whole meeting (2026-10-15): getFullTranscript() was compacted
            // past 1,800 lines and getFullUsage() kept the last 500 answers, so a
            // 187-minute meeting was saved with only its last 73 minutes.
            transcript: [...this.session.getPersistableTranscript()],
            usage: [...this.liveUsageOverflow(), ...this.session.getPersistableUsage()],
            startTime: this.session.getSessionStartTime(),
            durationMs: durationMs,
            context: this.session.getFullSessionContext(),
            memoryEligibleCount,
        };

        // BUG-04 fix: snapshot metadata BEFORE reset() clears it so the
        // background processAndSaveMeeting worker receives the calendar info.
        const sessionMetadata = this.session.getMeetingMetadata();
        const metadataSnapshot = userNotes ? { ...(sessionMetadata || {}), userNotes } : sessionMetadata;

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
        // Saved with the placeholder, so a crash while the notes are written
        // still recovers them with the calendar, the call's names and the mode.
        const recoveryMeta = this.captureRecoveryMeta(metadataSnapshot, modeSnapshot, snapshot.startTime, durationMs);

        // 2. Reset state immediately so new meeting can start or UI is clean
        this.session.reset();

        // The live copy's id, so the saved meeting replaces it (never a second meeting).
        const meetingId = this.liveJournal.meetingId ?? crypto.randomUUID();

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
            isProcessed: false,
            summaryStatus: 'queued',
            recoveryMeta,
            ...(userNotes ? { userNotes } : {}),
        };

        try {
            DatabaseManager.getInstance().saveMeeting(placeholder, snapshot.startTime, durationMs);
            // Saved: the live copy is no longer needed. (Not on failure: the
            // live copy is then the only one, and the next launch recovers it.)
            this.liveJournal.end();
            // The older answers are in the saved meeting now (read into the
            // snapshot above), whether or not a live row was ever written.
            DatabaseManager.getInstance().removeLiveUsageOverflow(meetingId);
            // Notify Frontend
            const wins = require('electron').BrowserWindow.getAllWindows();
            wins.forEach((w: any) => w.webContents.send('meetings-updated'));
        } catch (e) {
            console.error("Failed to save placeholder", e);
        }

        // One writer per meeting: a recovery pass skips a meeting in this set.
        this.processing.add(meetingId);
        this.processAndSaveMeeting(snapshot, meetingId, metadataSnapshot, modeSnapshot).catch(err => {
            console.error('[MeetingPersistence] Background processing failed:', err);
        }).finally(() => this.processing.delete(meetingId));

        // memoryEligibleCount rides along so the caller (main.ts) can skip the
        // RAG chunk/embed step for zero-eligible sessions — the DB re-read that
        // step performs has no provenance columns to decide with.
        return { meetingId, memoryEligibleCount };
    }

    /**
     * Retention "never" or the meeting's own do-not-persist: the meeting must
     * not reach the disk. Fails secure (a settings read that throws = do not keep).
     */
    private mustNotPersist(): boolean {
        try {
            const { SettingsManager } = require('./services/SettingsManager');
            const retention = SettingsManager.getInstance().get('meetingRetention');
            if (retention === 'never') return true;
            const meta = this.session.getMeetingMetadata?.();
            return !!(meta && (meta as any).doNotPersist === true);
        } catch (err) {
            console.error('[MeetingPersistence] Failed to read retention settings, defaulting to discard for safety:', err);
            return true;
        }
    }

    /** The active mode, as the notes should use it. */
    private captureModeSnapshot(): { id: string; name: string; templateType: string } | null {
        try {
            const { ModesManager } = require('./services/ModesManager');
            const activeMode = ModesManager.getInstance().getActiveMode();
            if (activeMode) return { id: activeMode.id, name: activeMode.name, templateType: activeMode.templateType };
        } catch (modeErr: any) {
            console.warn('[MeetingPersistence] Failed to capture mode snapshot:', modeErr?.message);
        }
        return null;
    }

    /**
     * Everything a recovery needs besides the transcript: the metadata Stop
     * hands processAndSaveMeeting, the mode, and the call's speaking record
     * (held only in memory by callRoster, so it would be gone after a restart).
     */
    private captureRecoveryMeta(metadata: any, mode: { id: string; name: string; templateType: string } | null, startTime: number, durationMs: number): MeetingRecoveryMeta {
        const meta: MeetingRecoveryMeta = { startTime, durationMs, mode };
        if (metadata && typeof metadata === 'object') {
            if (typeof metadata.title === 'string') meta.title = metadata.title;
            if (typeof metadata.calendarEventId === 'string') meta.calendarEventId = metadata.calendarEventId;
            if (metadata.calendarEvent && typeof metadata.calendarEvent === 'object') meta.calendarEvent = metadata.calendarEvent;
            if (metadata.source === 'manual' || metadata.source === 'calendar') meta.source = metadata.source;
            if (typeof metadata.callSelfName === 'string' && metadata.callSelfName) meta.callSelfName = metadata.callSelfName;
            if (Array.isArray(metadata.sharedScreens) && metadata.sharedScreens.length > 0) meta.sharedScreens = metadata.sharedScreens;
            if (typeof metadata.callKey === 'string') {
                meta.callKey = metadata.callKey;
                try {
                    const { callRoster } = require('./services/meetingDetection/callRoster') as typeof import('./services/meetingDetection/callRoster');
                    const snap = callRoster.snapshot(metadata.callKey, startTime, startTime + durationMs + 30_000);
                    if (snap.participants.length > 0 || snap.spans.length > 0) meta.callRoster = snap;
                } catch { /* no roster: names come from the calendar only */ }
            }
        }
        return meta;
    }

    private liveSnapshot(): LiveJournalSnapshot | null {
        if (this.mustNotPersist()) return null;
        const startedAt = this.session.getSessionStartTime();
        const metadata = this.session.getMeetingMetadata?.();
        const { startTime: _s, durationMs: _d, ...meta } = this.captureRecoveryMeta(metadata, this.captureModeSnapshot(), startedAt, Date.now() - startedAt);
        if (this.liveUserNotes.trim()) meta.userNotes = this.liveUserNotes;
        return {
            // The whole meeting, as Stop saves it (not the assistant's view).
            transcript: [...this.session.getPersistableTranscript()],
            usage: [...this.session.getPersistableUsage()],
            meta,
        };
    }

    /**
     * Heavy lifting: LLM Title, Summary, and DB Write
     */
    private async processAndSaveMeeting(
        data: { transcript: TranscriptSegment[], usage: any[] | undefined, startTime: number, durationMs: number, context: string, memoryEligibleCount?: number },
        meetingId: string,
        // BUG-04 fix: accept metadata snapshot so calendar info is not lost after session.reset()
        metadata?: ProcessMetadata | null,
        // BUG-MODE-BLEEDING fix: accept mode snapshot so async summary uses the mode that was
        // active when meeting stopped, not whatever mode is active when async processing runs.
        modeSnapshot?: { id: string; name: string; templateType: string } | null
    ): Promise<void> {
        let title = "Untitled Session";
        let summaryData: any = { actionItems: [], keyPoints: [] };
        let v3SummaryMeta: MeetingSummaryTelemetryMeta | null = null;
        let generationSucceeded = false;
        let postCallSummaryAllowed = true;
        // The detected mode, kept for the folder rules that run after the save.
        let detectedTemplateType: string | undefined;
        // Phase 6 — post_call_summary lifecycle telemetry. Wrapped in try/catch
        // around track calls so a telemetry sink fault never breaks persistence.
        const _postCallStart = Date.now();
        // ATTRIBUTION (task Phase 3/9): prove the post-meeting memory pipeline ran.
        let _meetingMemoryRecorded = false;
        let _meetingMemoryCounts: ({ topics: number; decisions: number; actionItems: number; entities: number } & Partial<MeetingMemoryProvenanceTelemetry>) | null = null;
        let _hindsightRetainQueued = false;
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

        // ZERO-ELIGIBLE EARLY EXIT (deep-run 2 issue 11, 2026-08-01). A live
        // run showed a no-audio session ("Meeting starting WITHOUT audio
        // capture") still invoking generateMeetingSummary on 3,297 chars of
        // manual chat and queueing 30 chunks for embedding — wasted cost AND a
        // provenance leak: chat and assistant answers minted meeting
        // "evidence". Manual chat is referent-only; it stays in the persisted
        // transcript for display but must not produce a summary, meeting
        // memory, or Hindsight retention. The transcript-count gates further
        // down (`transcript.length > 2`) cannot catch this — chat segments
        // count toward length.
        if ((data.memoryEligibleCount ?? data.transcript.length) === 0) {
            const mins = Math.floor(data.durationMs / 60000);
            const secs = ((data.durationMs % 60000) / 1000).toFixed(0);
            const finalMeeting: Meeting = {
                id: meetingId,
                title: metadata?.title || 'Chat session',
                date: new Date().toISOString(),
                duration: `${mins}:${Number(secs) < 10 ? '0' : ''}${secs}`,
                summary: '',
                detailedSummary: { actionItems: [], keyPoints: [] },
                transcript: data.transcript,
                usage: data.usage,
                isProcessed: true,
                summaryStatus: 'completed',
            };
            try {
                DatabaseManager.getInstance().saveMeeting(finalMeeting, data.startTime, data.durationMs);
                const wins = require('electron').BrowserWindow.getAllWindows();
                wins.forEach((w: any) => w.webContents.send('meetings-updated'));
            } catch (e) {
                console.error('[MeetingPersistence] Failed to persist zero-eligible meeting:', e);
            }
            try {
                telemetryService.track({
                    name: 'post_call_summary_skipped',
                    modeId: modeSnapshot?.id,
                    properties: {
                        reason: 'NO_MEMORY_ELIGIBLE_TRANSCRIPT',
                        transcriptSegmentCount: data.transcript.length,
                        meetingSummaryCalls: 0,
                        ragChunks: 0,
                        embeddings: 0,
                        hindsightQueued: false,
                    },
                });
            } catch { /* non-fatal */ }
            console.log('[MeetingPersistence] No memory-eligible transcript — skipped title/summary/memory/Hindsight for this session.');
            return;
        }

        // Use passed-in metadata snapshot (NOT this.session.getMeetingMetadata() which is already cleared)
        let calendarEventId: string | undefined;
        let calendarEvent: import('./services/calendar/calendarSessionMatch').CalendarEventSnapshot | undefined;
        let source: 'manual' | 'calendar' = 'manual';

        if (metadata) {
            if (metadata.title) title = metadata.title;
            if (metadata.calendarEventId) calendarEventId = metadata.calendarEventId;
            if (metadata.calendarEvent && metadata.calendarEvent.id === calendarEventId) calendarEvent = metadata.calendarEvent;
            if (metadata.source) source = metadata.source;
        }

        // The calendar can name the speakers: the mic is always the user, so with
        // a connected calendar their account name labels it in EVERY meeting
        // (it used to happen only for meetings linked to an event, so most
        // transcripts still said "Me"); a linked 1:1 also names the other voice,
        // the one other attendee (calendarSpeakerLabels). No calendar name: "Me".
        // The notes are written from a NAMED COPY of the transcript, so "Priya
        // will send the deck" rather than "Speaker 1 will…"; the stored
        // transcript keeps its raw speakers, because the rename map is keyed on
        // them. The same map is saved as the meeting's speaker labels, exactly as
        // if the user had typed the names, and under the same "Speaker labels" switch.
        let calendarLabels: Record<string, string> | null = null;
        let llmTranscript = data.transcript;
        // No calendar name: the name the Zoom / Teams window showed as the user's.
        const appSelfName = typeof metadata?.callSelfName === 'string' && metadata.callSelfName.trim() ? metadata.callSelfName.trim() : undefined;
        const userName = this.calendarUserName() ?? appSelfName;
        if ((calendarEvent || userName) && isIntelligenceFlagEnabled('speakerLabelsV1')) {
            try {
                const { calendarSpeakerLabels } = require('./services/calendar/calendarSessionMatch') as typeof import('./services/calendar/calendarSessionMatch');
                calendarLabels = calendarSpeakerLabels(calendarEvent, userName);
                if (calendarLabels) {
                    const { SpeakerLabelService } = require('./services/meeting/SpeakerLabelService');
                    llmTranscript = new SpeakerLabelService().applyLabels(data.transcript, calendarLabels);
                }
            } catch (e: any) {
                console.warn('[MeetingPersistence] calendar speaker names skipped:', e?.message);
                calendarLabels = null;
                llmTranscript = data.transcript;
            }
        }

        // The call's own record of who spoke (the Meet page's speaking indicator,
        // via the Companion extension): each other-side line whose speaker is
        // clear gets that person, in the stored transcript (as a speaker id, so
        // the notes show the name and a rename applies per person) and in the
        // notes' named copy; the people in the call are kept with the meeting.
        // Group calls get names this way, which the calendar alone can't give.
        // Same "Speaker labels" switch.
        let storedTranscript = data.transcript;
        let callLabels: Record<string, string> | null = null;
        let callConfidence: Record<string, number> | null = null;
        let callParticipants: string[] = [];
        if (metadata?.callKey && isIntelligenceFlagEnabled('speakerLabelsV1')) {
            try {
                const { nameCallLines } = require('./services/meetingDetection/nameCallLines') as typeof import('./services/meetingDetection/nameCallLines');
                // A recovered meeting: the app's roster was lost with the old
                // process, so the call's record comes from what was saved.
                let roster: import('./services/meetingDetection/callRoster').CallRoster | undefined;
                if (metadata.callRoster) {
                    const { CallRoster, callRoster } = require('./services/meetingDetection/callRoster') as typeof import('./services/meetingDetection/callRoster');
                    if (!callRoster.has(metadata.callKey)) {
                        roster = new CallRoster();
                        roster.restore(metadata.callKey, metadata.callRoster, data.startTime, data.startTime + data.durationMs);
                    }
                }
                const named = nameCallLines(data.transcript, metadata.callKey, data.startTime, data.durationMs, roster);
                if (named) {
                    storedTranscript = named.transcript;
                    callParticipants = named.participants;
                    if (Object.keys(named.labels).length > 0) {
                        callLabels = named.labels;
                        callConfidence = named.confidence;
                        const byLine = named.transcript;
                        llmTranscript = llmTranscript.map((seg, i) => {
                            const id = byLine[i]?.speakerId;
                            return id && named.labels[id] ? { ...seg, speaker: named.labels[id] } : seg;
                        });
                    }
                }
            } catch (e: any) {
                console.warn('[MeetingPersistence] call speaker names skipped:', e?.message);
                storedTranscript = data.transcript;
                callLabels = null;
                callConfidence = null;
                callParticipants = [];
            }
        }
        // People sharing the user's microphone (Settings, Audio): the mic channel
        // was transcribed with provider diarization, so its lines carry voice ids.
        // The voice with the most words stays "Me"; each other real voice becomes "Speaker N",
        // numbered past the call's named people (meeting/roomSpeakers.ts). The
        // same lines are renamed in the notes' copy. Before the strip below,
        // which would drop the voice ids this reads.
        try {
            const { SettingsManager } = require('./services/SettingsManager');
            if (SettingsManager.getInstance().get('roomSpeakersEnabled') === true) {
                const { splitRoomSpeakers } = require('./services/meeting/roomSpeakers') as typeof import('./services/meeting/roomSpeakers');
                const split = splitRoomSpeakers(storedTranscript, { usedIds: Object.keys(callLabels || {}) });
                if (split.voices > 0) {
                    storedTranscript = split.transcript;
                    llmTranscript = llmTranscript.map((seg, i) => (split.renamed.has(i) ? { ...seg, speaker: split.renamed.get(i)! } : seg));
                    console.log(`[MeetingPersistence] room speakers: ${split.voices} other voice(s) on the microphone`);
                }
            }
        } catch (e: any) {
            console.warn('[MeetingPersistence] room speakers skipped:', e?.message);
        }

        // Only the call's named ids are stored: an STT provider's own voice ids
        // (diarization) stay in-session, as they always have.
        storedTranscript = storedTranscript.map((seg: any) => {
            if (!seg?.speakerId || (callLabels && callLabels[seg.speakerId])) return seg;
            const { speakerId: _unnamed, ...rest } = seg;
            return rest;
        });

        // Scope gate applies to the entire post-call LLM summary path, not just
        // mode-reference snippets. If denied, V3 is skipped and LLMHelper's existing
        // fallback behavior handles the legacy path without sending transcript to cloud.
        try {
            const { SettingsManager } = require('./services/SettingsManager');
            const scopePolicy = SettingsManager.getInstance().get('providerDataScopes') as ProviderDataScopePolicy | undefined;
            postCallSummaryAllowed = scopePolicy?.post_call_summary !== false;
        } catch { /* settings unavailable → keep existing default */ }

        // The meeting's people, last time in its series, the user's notes: built
        // once here (local reads only, no model call) for every notes prompt below.
        // Only when the notes may be written at all.
        const notesInputs = postCallSummaryAllowed
            ? this.notesInputsFor({
                meetingId,
                title: metadata?.title,
                startMs: data.startTime,
                calendarEvent: calendarEvent ?? null,
                callParticipants,
                userNotes: metadata?.userNotes,
                vocabulary: notesVocabulary(metadata?.vocabulary),
            })
            : null;
        if (notesInputs?.previousMeetingId) console.log(`[MeetingPersistence] Notes will read last time from meeting ${notesInputs.previousMeetingId}.`);
        const notesContextParams = {
            meetingContextBlock: notesInputs?.meetingContextBlock,
            lastTimeBlock: notesInputs?.lastTimeBlock,
            userNotes: notesInputs?.userNotes,
            vocabulary: notesInputs?.vocabulary,
            // What others shared on screen ("Snapshot shared screens"), described.
            sharedScreensBlock: notesInputs ? sharedScreensBlockFor(metadata?.sharedScreens) : undefined,
            attachedImagesBlock: notesInputs ? attachedImagesBlockFor(metadata?.attachedImages) : undefined,
        };

        try {
            // The title is named by the notes call itself (vetProposedTitle) and vetted
            // once summaryData is final, below, whichever pipeline produced it.
            let proposedTitle: string | undefined;

            // Load template note sections for the mode that was active when meeting stopped.
            // BUG-MODE-BLEEDING fix: use the snapshotted mode, not getActiveMode() which may
            // return a different mode if the user switched modes before async processing completed.
            let modeNoteSections: Array<{ title: string; description: string; compiledPrompt?: string }> = [];
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

                    // Prefer user's customized DB sections (carry compiledPrompt); fall back to canonical template
                    const dbSections: Array<{ title: string; description: string; compiledPrompt?: string }> = modesMgr.getNoteSections(targetModeId);
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
                        postCallSummaryAllowed = summaryAllowed;
                        const referenceSnippetsAllowed = scopePolicy?.reference_files !== false;

                        if (summaryAllowed) {
                            const transcriptHint = data.transcript
                                .map(segment => `${segment.speaker || 'speaker'}: ${segment.text || ''}`)
                                .join('\n')
                                .slice(0, 4000);
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

            // MODE AUTO-DETECTION (Phase 10, behind meetingModeAutoDetect). Deterministic,
            // no LLM, no provider call — safe even when post_call_summary scope is denied.
            // NEVER switches the live mode; only records a suggestion in summary.mode.detected*.
            let detectedMode: { templateType: string; modeId?: string; modeName?: string; confidence: number } | undefined;
            try {
                if (isIntelligenceFlagEnabled('meetingModeAutoDetect') && data.transcript.length > 2) {
                    const { MeetingModeDetector } = require('./services/meeting/MeetingModeDetector');
                    // The invite's description and the people on it are signals too
                    // (they used to be dropped: only the title reached the detector).
                    const detection = new MeetingModeDetector().detect({
                        transcript: data.transcript,
                        calendarTitle: metadata?.title ?? calendarEvent?.title,
                        calendarDescription: calendarEvent?.description,
                        participants: notesInputs?.participantNames ?? [],
                        participantEmails: notesInputs?.participantEmails ?? [],
                        userEmail: this.calendarAccount()?.email,
                    });
                    if (detection.confidence > 0 && detection.templateType !== 'general') {
                        let modeId: string | undefined;
                        let modeName: string | undefined;
                        try {
                            const { ModesManager } = require('./services/ModesManager');
                            const match = ModesManager.getInstance().getModes().find((m: { id: string; name: string; templateType: string }) => m.templateType === detection.templateType);
                            if (match) { modeId = match.id; modeName = match.name; }
                        } catch { /* non-fatal */ }
                        detectedMode = { templateType: detection.templateType, modeId, modeName, confidence: detection.confidence };
                        detectedTemplateType = detection.templateType;
                        console.log(`[MeetingPersistence] Mode auto-detect: ${detection.templateType} (conf ${detection.confidence})`);
                    }
                }
            } catch (detErr: any) {
                console.warn('[MeetingPersistence] Mode auto-detect skipped (non-fatal):', detErr?.message);
            }

            // Generate Structured Summary. V3 is the long-context path: it never uses a
            // naïve transcript prefix as the primary summary input. If it fails or is
            // disabled, the existing V2 single-pass path below remains the compatibility fallback.
            // SHORT SESSION (2026-10-04, owner decision): every gate below counts
            // transcript LINES, so three lines of greeting ran the full pipeline —
            // an extraction call, two polish calls and a title call — and saved
            // 6.5 KB of notes about "hi". Below the minimum (see
            // shortSessionNotes.ts) the notes and the title are written by ONE
            // small call.
            let shortSession = false;
            if (data.transcript.length > 2 && postCallSummaryAllowed) {
                try {
                    const sized = new TranscriptNormalizer().normalize(llmTranscript as any);
                    shortSession = isShortSession(sized);
                    if (shortSession) {
                        const { lines, words } = countHumanContent(sized);
                        console.log(`[MeetingPersistence] Short session (${lines} lines, ${words} words) — one small notes call, no polish.`);
                        DatabaseManager.getInstance().updateSummaryStatus(meetingId, 'queued');
                        const shortPrompt = buildShortSessionPrompt(notesContextFromParams(notesContextParams));
                        const raw = sized.text
                            ? await this.llmHelper.generateMeetingSummary(shortPrompt, sized.text, shortPrompt, { timeoutMs: NOTE_CALL_TIMEOUT_MS })
                            : '';
                        const notes = parseShortSessionNotes(raw);
                        if (notes) {
                            summaryData = { overview: notes.overview, keyPoints: notes.keyPoints, actionItems: notes.actionItems };
                            proposedTitle = notes.title;
                            generationSucceeded = true;
                        }
                    }
                } catch (shortErr: any) {
                    // A failed small call leaves the meeting saved with its
                    // transcript and no notes; it must not fall through to the
                    // four-call pipeline this branch exists to avoid.
                    console.warn('[MeetingPersistence] Short-session notes call failed (non-fatal):', shortErr?.message);
                }
            }

            if (!shortSession && data.transcript.length > 2 && isIntelligenceFlagEnabled('meetingSummaryV3') && postCallSummaryAllowed) {
                const db = DatabaseManager.getInstance();
                db.updateSummaryStatus(meetingId, 'queued');
                const assembler = new MeetingContextAssembler(this.llmHelper);
                const v3StartedMs = Date.now();
                const assembled = await assembler.assembleSummary({
                    transcript: llmTranscript,
                    title,
                    modeTemplateType: modeSnapshot?.templateType,
                    modeNoteSections,
                    modeContextBlock,
                    modeMeta: {
                        ...(modeSnapshot?.id ? { selectedModeId: modeSnapshot.id } : {}),
                        ...(modeSnapshot?.name ? { selectedModeName: modeSnapshot.name } : {}),
                        ...(modeSnapshot?.templateType ? { selectedTemplateType: modeSnapshot.templateType } : {}),
                        ...(detectedMode ? {
                            ...(detectedMode.modeId ? { detectedModeId: detectedMode.modeId } : {}),
                            detectedModeName: detectedMode.modeName || detectedMode.templateType,
                            detectedConfidence: detectedMode.confidence,
                        } : {}),
                        summaryModeUsed: modeSnapshot?.templateType || 'general',
                    },
                    startedAtMs: v3StartedMs,
                    startedAtIso: new Date(v3StartedMs).toISOString(),
                    // No follow-up draft here: it is written on demand, when the user
                    // clicks Generate on the notes (regenerateFollowUpDraft below).
                    // #1 — constrained LLM Summary polish (note-content-only, gated, safe fallback).
                    polishSummary: isIntelligenceFlagEnabled('meetingSummaryLlmPolish'),
                    onStatusUpdate: status => db.updateSummaryStatus(meetingId, status),
                    ...notesContextParams,
                });
                v3SummaryMeta = assembled.meta;
                if (assembled.summary) {
                    proposedTitle = assembled.proposedTitle;
                    const v3 = assembled.summary;
                    summaryData = {
                        schemaVersion: 3,
                        title: v3.title,
                        tldr: v3.tldr,
                        whatChanged: v3.whatChanged,
                        overview: v3.overview,
                        sectionsV3: v3.sections,
                        sections: v3.sections.map(section => ({ title: section.title, bullets: section.bullets.map(bullet => bullet.text) })),
                        decisions: v3.decisions,
                        actionItemsV3: v3.actionItems,
                        actionItems: v3.actionItems.map(item => item.text),
                        actionItemsStructured: v3.actionItems.map(item => ({
                            id: item.id || `action_${crypto.randomUUID()}`,
                            text: item.text,
                            ...(item.owner ? { owner: item.owner } : {}),
                            ...(item.deadline ? { deadline: item.deadline } : {}),
                            ...(typeof item.sourceTimestampMs === 'number' ? { sourceTimestamp: item.sourceTimestampMs } : {}),
                        })),
                        openQuestions: v3.openQuestions,
                        risks: v3.risks,
                        followUpDraft: v3.followUpDraft,
                        timeline: v3.timeline,
                        people: v3.people,
                        topics: v3.topics,
                        sourceQuality: v3.sourceQuality,
                        mode: v3.mode,
                        generation: v3.generation,
                        recipes: v3.recipes,
                        keyPoints: v3.tldr,
                        actionItemsTitle: 'Action Items',
                        keyPointsTitle: 'TLDR',
                    };
                    generationSucceeded = true;

                    // CROSS-MEETING RECALL (Phase 13, behind meetingMemoryV2). Local-first,
                    // deterministic, no LLM, no network. Compares this meeting's open
                    // questions/risks to recent prior meetings to surface "still open from
                    // last time". Degrades to nothing when there is no prior history.
                    const recall = computeCrossMeetingRecall(meetingId, v3);
                    if (recall) (summaryData as any).crossMeeting = recall;
                }
            }

            if (!postCallSummaryAllowed && isIntelligenceFlagEnabled('meetingSummaryV3')) {
                console.warn('[MeetingSummaryV3] post_call_summary scope denied — skipping V3 cloud summary path.');
            }

            if (!shortSession && summaryData.schemaVersion !== 3 && data.transcript.length > 2 && postCallSummaryAllowed) {
                const { summaryPrompt, groqSummaryPrompt } = buildV2FallbackPrompts({
                    modeNoteSections,
                    modeContextBlock,
                    notesContext: notesContextFromParams(notesContextParams),
                    transcriptChars: llmTranscript.reduce((sum, seg) => sum + String(seg?.text || '').length, 0),
                    groqGenericPrompt: GROQ_SUMMARY_JSON_PROMPT,
                });
                if (modeNoteSections.length > 0) console.log('[MeetingPersistence] Using mode-specific prompt with sections:', modeNoteSections.map(s => s.title));

                const fallbackContext = buildBalancedTranscriptContext(llmTranscript, 16000);
                const generatedSummary = await this.llmHelper.generateMeetingSummary(summaryPrompt, fallbackContext, groqSummaryPrompt);

                if (generatedSummary) {
                    console.log('[MeetingPersistence] LLM summary response received', { length: generatedSummary.length });
                    // Reads "overview" and the Groq prompt's old "summary" key alike
                    // (the fallback used to save Groq's notes with no overview).
                    const parsed = parseV2SummaryResponse(generatedSummary, modeNoteSections);
                    if (parsed) {
                        if (modeNoteSections.length > 0 && !Array.isArray(parsed.sections)) {
                            console.warn('[MeetingPersistence] Mode sections expected but LLM did not return "sections" key. Falling back to generic.');
                        }
                        // The reply's title is a proposal, vetted below; it is not a note field.
                        const { title: v2Title, ...v2Notes } = parsed;
                        proposedTitle = v2Title;
                        summaryData = v2Notes;
                        generationSucceeded = v2NotesHaveContent(summaryData);
                    } else {
                        console.error('[MeetingPersistence] Failed to parse summary JSON', { responseLength: generatedSummary.length });
                    }
                }
            } else if (data.transcript.length <= 2) {
                // This used to print for EVERY meeting whose V3 notes had already
                // succeeded (the branch above is also skipped then), which read
                // as "the notes were refused" in a log where they had just been
                // written. Say it only when it is true.
                console.log("Transcript too short for summary generation.");
            }

            // Name the meeting from the FINISHED notes (Task 9) — only if not set by
            // calendar/user and summary scope allows transcript LLM use. The notes call
            // already wrote a title in its reply (V3 overview, short session or V2
            // fallback); vetProposedTitle checks it and otherwise derives one from the
            // notes. No model call here. A meeting with nothing to name keeps its
            // existing default — never blocks saving.
            if ((!metadata || !metadata.title) && postCallSummaryAllowed) {
                const generatedTitle = vetProposedTitle(proposedTitle, summaryData).title;
                if (generatedTitle) {
                    title = generatedTitle;
                    if (summaryData && summaryData.schemaVersion === 3) summaryData.title = generatedTitle;
                }
            }

            const postCallEnhancements = buildPostCallEnhancements({
                transcript: data.transcript,
                modeTemplateType: modeSnapshot?.templateType,
                summaryData,
            });
            summaryData = summaryData.schemaVersion === 3
                ? {
                    ...summaryData,
                    coachingInsights: postCallEnhancements.coachingInsights,
                    actionItemsStructured: Array.isArray(summaryData.actionItemsStructured) && summaryData.actionItemsStructured.length > 0
                        ? summaryData.actionItemsStructured
                        : postCallEnhancements.actionItemsStructured,
                    // No follow-up draft: it is written only when the user asks
                    // (the meeting page's Follow-up email button).
                }
                : {
                    ...summaryData,
                    ...postCallEnhancements,
                    // Older notes too: their follow-up waits for the button
                    // (regenerateFollowUpDraft takes them), so the template draft
                    // the post-call workflow builds is not saved.
                    followUpDraft: undefined,
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
                        segments: llmTranscript,
                        mode: modeSnapshot?.templateType,
                        startedAt: data.startTime,
                        endedAt: data.startTime + data.durationMs,
                    });
                    // DEFECT B (P0, 2026-08-01) HARD INVARIANT: buildPersistedMeetingMemory
                    // recomputes eligibility over the raw transcript and forces EMPTY
                    // decisions/actionItems/topics/entities when ZERO memory-eligible
                    // (origin 'stt' / legacy provider-confidence) segments exist —
                    // regardless of what the extractor returned. Defense-in-depth on top
                    // of the extractor's own provenance filter. A zero-audio session of
                    // manual-chat questions + assistant answers persists NO meeting memory.
                    const persisted = buildPersistedMeetingMemory(llmTranscript, record);
                    if (persisted.telemetry.zeroEligibleGuardApplied) {
                        console.warn('[MeetingMemoryV2] zero memory-eligible (spoken/STT) transcript segments — persisting EMPTY structured memory. Manual-chat questions and assistant answers are not meeting evidence (Defect B provenance guard).', {
                            meetingId,
                            totalSegments: data.transcript.length,
                            manualChatMessages: persisted.telemetry.manualChatMessages,
                            assistantMessages: persisted.telemetry.assistantMessages,
                        });
                    }
                    (summaryData as any).meetingMemory = persisted.meetingMemory;
                    _meetingMemoryRecorded = true;
                    // Content-free attribution: COUNTS only, never the extracted text.
                    _meetingMemoryCounts = {
                        topics: persisted.meetingMemory.topics.length,
                        decisions: persisted.meetingMemory.decisions.length,
                        actionItems: persisted.meetingMemory.actionItems.length,
                        entities: persisted.meetingMemory.entities.length,
                        ...persisted.telemetry,
                    };
                }
            } catch (memErr) {
                console.warn('[MeetingMemoryV2] extraction skipped (non-fatal):', (memErr as any)?.message);
            }
        } catch (e) {
            console.error("Error generating meeting metadata", e);
        }

        let meetingSaved = false;
        try {
            const minutes = Math.floor(data.durationMs / 60000);
            const seconds = ((data.durationMs % 60000) / 1000).toFixed(0);
            const durationStr = `${minutes}:${Number(seconds) < 10 ? '0' : ''}${seconds}`;

            // The calendar's speaker names become the meeting's labels (a rename
            // the user already made always wins). Regenerate and the follow-up
            // draft carry speakerLabels forward, as they do the user's own.
            if (calendarLabels && summaryData && typeof summaryData === 'object' && !summaryData.speakerLabels) {
                summaryData = { ...summaryData, speakerLabels: calendarLabels };
            }
            // The call's names join them (a user's rename of an id still wins),
            // and the people who were in the call are kept for the notes.
            if (summaryData && typeof summaryData === 'object') {
                if (callLabels) summaryData = { ...summaryData, speakerLabels: { ...callLabels, ...(summaryData.speakerLabels || {}) } };
                if (callConfidence && Object.keys(callConfidence).length > 0) summaryData = { ...summaryData, speakerConfidence: callConfidence };
                if (callParticipants.length > 0) summaryData = { ...summaryData, callParticipants };
                // Kept with the meeting so Regenerate writes from the same screens.
                const screens = sharedScreenEntries(metadata?.sharedScreens);
                if (screens.length > 0) summaryData = { ...summaryData, sharedScreens: screens };
            }

            const meetingData: Meeting = {
                id: meetingId,
                title: title,
                date: new Date().toISOString(),
                duration: durationStr,
                summary: "See detailed summary",
                detailedSummary: summaryData,
                transcript: storedTranscript,
                usage: data.usage,
                calendarEventId: calendarEventId,
                calendarEvent: calendarEvent,
                source: source,
                isProcessed: true,
                summaryStatus: generationSucceeded || data.transcript.length <= 2 ? 'completed' : 'failed'
            };

            DatabaseManager.getInstance().saveMeeting(meetingData, data.startTime, data.durationMs);
            // The catch below rewrites the title and blanks legacySummary on the
            // assumption that the save never happened. Everything after this line
            // is inside the same try, so that assumption has to be recorded, not
            // inferred — see the guard at the top of the catch.
            meetingSaved = true;
            if (generationSucceeded) this.notifyNotesSaved(meetingId);

            // The other side's voice still unnamed ("Speaker 1"): one short call
            // proposes a name from what was said, after the save so the notes
            // never wait on it. Same "Speaker labels" switch, same data scope as
            // the notes. See services/meeting/speakerNameSuggestions.ts.
            if (postCallSummaryAllowed && isIntelligenceFlagEnabled('speakerLabelsV1')
                && (process.env.NATIVELY_SPEAKER_NAME_SUGGESTIONS || '').toLowerCase() !== 'off') {
                void this.suggestSpeakerNamesAfterSave(meetingId, storedTranscript, summaryData?.speakerLabels, callParticipants, calendarEvent);
            }

            // People, folder rules, proposed titles (services/organise). After the
            // speaker suggestion is queued, so a name it applies is picked up
            // the next time the People view syncs; the model call here is the
            // same data scope as the notes.
            this.organiseAfterSave({
                meetingId,
                detectedTemplateType,
                transcript: storedTranscript,
                speakerLabels: summaryData?.speakerLabels,
                userNotes: metadata?.userNotes,
                allowModel: postCallSummaryAllowed,
            // After the folder rules, so a connector rule for one folder sees this meeting in it.
            }, generationSucceeded ? () => this.connectorsNotesReady(meetingId) : undefined);

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
                // can't land (2026-06-14 fix). Skip a failed-generation summary too
                // (2026-07-25, RC8-adjacent context-rebuild fix, non-negotiable rule 13):
                // this condition previously never checked summaryStatus, so a summary
                // whose generation failed (meetingData.summaryStatus === 'failed',
                // computed one line above) could still be queued into Hindsight as if
                // it were a validated, committed fact — see
                // docs/context-rebuild/02_INGESTION_AND_STORAGE_AUDIT.md §C.1.
                if (isIntelligenceFlagEnabled('hindsightPostMeetingRetain') && hsCfg && _hm.isAvailable()
                    && meetingData.summaryStatus !== 'failed') {
                    const ltm = LongTermMemoryService.fromFlags({ hindsight: hsCfg });
                    if (ltm.enabled) {
                        const summaryText = summaryData?.schemaVersion === 3 && Array.isArray(summaryData?.tldr)
                            ? summaryData.tldr.join('\n')
                            : (typeof summaryData?.overview === 'string'
                                ? summaryData.overview
                                : JSON.stringify(summaryData?.keyPoints ?? []));
                        // Per-install scope id (isolates two installs sharing one Cloud
                        // account); mode tag scopes by meeting mode.
                        ltm.retainMeetingSummary(meetingId, summaryText, { userId: _hm.localUserId(), meetingId }, modeSnapshot?.templateType);
                        _hindsightRetainQueued = true;
                        console.log('[Hindsight] queued post-meeting summary retain', { meetingId, provider: ltm.providerName });
                    }
                }
            } catch (hsErr) {
                console.warn('[Hindsight] post-meeting retain skipped (non-fatal):', (hsErr as any)?.message);
            }

            // Metadata was already snapshotted before session.reset() — nothing to clear here.

            // Notify Frontend to refresh list.
            // Wrapped like its twin on the failure path below: webContents.send
            // throws on a destroyed window, and an unguarded throw HERE — after
            // the save succeeded — fell into the catch and marked a saved
            // meeting as failed.
            try {
                const wins = require('electron').BrowserWindow.getAllWindows();
                wins.forEach((w: any) => w.webContents.send('meetings-updated'));
            } catch { /* a closed window is not a save failure */ }

            // ATTRIBUTION: one record proving which post-meeting memory layers ran on save
            // (bug #4: MeetingMemoryService + Hindsight retain not previously evidenced).
            try {
                const _hmEnabled = isIntelligenceFlagEnabled('hindsightMemory') && isIntelligenceFlagEnabled('hindsightPostMeetingRetain');
                let _hsConfigured = false; let _hsAvailable = false;
                try {
                    const { HindsightManager } = require('./services/HindsightManager') as typeof import('./services/HindsightManager');
                    const _hm2 = HindsightManager.getInstance();
                    _hsConfigured = Boolean(_hm2.getHindsightConfig());
                    _hsAvailable = _hsConfigured && _hm2.isAvailable();
                } catch { /* attribution only */ }
                recordAttribution({
                    answer_type: 'meeting_summary',
                    mode: modeSnapshot?.templateType || 'meeting',
                    surface: 'meeting',
                    meeting_memory_used: isIntelligenceFlagEnabled('meetingMemoryV2'),
                    meeting_memory_record_used: _meetingMemoryRecorded,
                    hindsight_enabled: _hmEnabled,
                    hindsight_mode: hindsightModeFor({ memoryFlagOn: isIntelligenceFlagEnabled('hindsightMemory'), configured: _hsConfigured, available: _hsAvailable }),
                    hindsight_retain_queued: _hindsightRetainQueued,
                });
                if (_meetingMemoryCounts) {
                    console.log('[MeetingMemoryV2] structured memory persisted', { meetingId, ..._meetingMemoryCounts, hindsightRetainQueued: _hindsightRetainQueued });
                }
            } catch { /* attribution never breaks persistence */ }

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
                        schemaVersion: typeof enhancements.schemaVersion === 'number' ? enhancements.schemaVersion : 2,
                        v3Used: Boolean(v3SummaryMeta?.v3Used),
                        chunkCount: v3SummaryMeta?.chunkCount ?? 0,
                        summaryStrategy: v3SummaryMeta?.strategy ?? 'fallback',
                        transcriptCoveragePercent: v3SummaryMeta?.transcriptCoveragePercent ?? 0,
                    },
                });
            } catch { /* non-fatal */ }

        } catch (error) {
            console.error('[MeetingPersistence] Failed to save meeting:', error);
            // saveMeeting never ran on this path, so the placeholder row endMeeting
            // wrote is still carrying title "Processing..." and legacySummary
            // "Generating summary...". Flipping the status alone (what this used to
            // do) left the meeting reading as perpetually in-flight — a notes screen
            // saying the notes could not be generated under a heading that says
            // "Processing...", and the blurb leaking into exported PDFs, global-search
            // snippets and the RAG summary field.
            //
            // `title` is whatever the pipeline had reached before it threw: the
            // calendar name when the meeting was matched to an event, the generated
            // title if it got that far, else this file's "Untitled Session" default —
            // which isDefaultMeetingTitle recognises, so a later recovery pass is free
            // to replace it. is_processed stays 0 so recoverUnprocessedMeetings picks
            // this meeting up at the next app start.
            // ONLY when the save really did not happen. This try also covers
            // post-save work (the renderer broadcast, the Hindsight retain, the
            // attribution record), and markSummaryGenerationFailed is
            // destructive: it blanks legacySummary and rewrites the title. A
            // throw from any of that used to destroy the notes of a meeting
            // that had saved perfectly. The old catch only flipped the status,
            // which is why this was survivable before and is not now.
            if (!meetingSaved) {
                try { DatabaseManager.getInstance().markSummaryGenerationFailed(meetingId, title); } catch { /* non-fatal */ }
            } else {
                console.warn('[MeetingPersistence] post-save step failed; the meeting is saved and is left intact', {
                    meetingId, error: (error as any)?.message,
                });
            }
            // Nothing on this path notified the renderer, so an open meeting kept
            // showing the in-progress placeholder until something else happened to
            // refresh it. The happy path below broadcasts; so should the failure.
            try {
                const wins = require('electron').BrowserWindow.getAllWindows();
                wins.forEach((w: any) => w.webContents.send('meetings-updated'));
            } catch { /* non-fatal */ }
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
     * Recover meetings that were started but not fully processed: a meeting
     * still running when the app quit, crashed or the OS ended the session (its
     * live copy, LiveMeetingJournal), and a meeting whose notes were never
     * written (the placeholder Stop saved). Each is processed with the metadata
     * Stop would have passed (calendar event, the call's speaking record, the
     * mode), saved with it. Never twice at once, and never a meeting whose
     * notes are being written right now.
     */
    public recoverUnprocessedMeetings(): Promise<void> {
        if (this.recovering) return this.recovering;
        this.recovering = this.recoverOnce().finally(() => { this.recovering = null; });
        return this.recovering;
    }

    private async recoverOnce(): Promise<void> {
        console.log('[MeetingPersistence] Checking for unprocessed meetings...');
        const db = DatabaseManager.getInstance();

        this.promoteLiveMeetings(db);

        const unprocessed = db.getUnprocessedMeetings();

        if (unprocessed.length === 0) {
            console.log('[MeetingPersistence] No unprocessed meetings found.');
            return;
        }

        console.log(`[MeetingPersistence] Found ${unprocessed.length} unprocessed meetings. recovering...`);

        for (const m of unprocessed) {
            if (this.processing.has(m.id)) {
                console.log(`[MeetingPersistence] ${m.id}: notes are being written now; not recovering it.`);
                continue;
            }
            try {
                const details = db.getMeetingDetails(m.id);
                if (!details) continue;

                console.log(`[MeetingPersistence] Recovering meeting ${m.id}...`);

                const context = details.transcript?.map(t => {
                    const label = t.speaker === 'interviewer' ? 'INTERVIEWER' :
                        t.speaker === 'user' ? 'ME' : 'ASSISTANT';
                    return `[${label}]: ${t.text}`;
                }).join('\n') || "";

                const saved = db.getMeetingRecoveryMeta(m.id) as Partial<MeetingRecoveryMeta> | null;
                const parts = (details.duration || '0:00').split(':');
                // EC-07 fix: guard against malformed duration strings (e.g. corrupted DB row)
                const mins = parseInt(parts[0]) || 0;
                const secs = parseInt(parts[1]) || 0;
                const durationMs = typeof saved?.durationMs === 'number' && saved.durationMs >= 0 ? saved.durationMs : ((mins * 60) + secs) * 1000;
                // The true start when it was saved; created_at is when Stop ran.
                const startTime = typeof saved?.startTime === 'number' && saved.startTime > 0 ? saved.startTime : new Date(details.date).getTime();

                const transcript = details.transcript as TranscriptSegment[];
                const snapshot = {
                    transcript,
                    usage: details.usage,
                    startTime: startTime,
                    durationMs: durationMs,
                    context: context,
                    memoryEligibleCount: countMemoryEligible(transcript),
                };

                const { metadata, mode } = recoveryMetadataFor(details, saved);
                this.processing.add(m.id);
                try {
                    await this.processAndSaveMeeting(snapshot, m.id, metadata, mode);
                } finally {
                    this.processing.delete(m.id);
                }
                console.log(`[MeetingPersistence] Recovered meeting ${m.id}${saved ? ' (with its saved calendar, call and mode details)' : ''}`);

            } catch (e) {
                console.error(`[MeetingPersistence] Failed to recover meeting ${m.id}`, e);
            }
        }
    }

    /**
     * Left-over live copies become unprocessed meetings (the loop above then
     * writes their notes). The running meeting's own copy is never touched; a
     * copy the user's retention now forbids is deleted; one shorter than a
     * second, or with nothing in it, is dropped as Stop would drop it.
     */
    private promoteLiveMeetings(db: DatabaseManager): void {
        let rows: ReturnType<DatabaseManager['getLiveMeetings']> = [];
        try {
            rows = db.getLiveMeetings();
        } catch (e) {
            console.warn('[MeetingPersistence] reading live meetings failed:', (e as Error)?.message);
            return;
        }
        try { db.sweepOrphanUsageOverflow(this.liveJournal.meetingId); } catch { /* next launch */ }
        if (rows.length === 0) return;
        let retentionNever = false;
        try {
            const { SettingsManager } = require('./services/SettingsManager');
            retentionNever = SettingsManager.getInstance().get('meetingRetention') === 'never';
        } catch {
            retentionNever = true; // fail secure, as Stop does
        }
        for (const row of rows) {
            if (row.id === this.liveJournal.meetingId) continue;
            const meta = (row.meta || {}) as Partial<MeetingRecoveryMeta>;
            const durationMs = typeof meta.durationMs === 'number' ? meta.durationMs : Math.max(0, row.updatedAt - row.startedAt);
            const hasNotes = typeof meta.userNotes === 'string' && meta.userNotes.trim().length > 0;
            if (retentionNever || durationMs < 1000 || (row.transcript.length === 0 && row.usage.length === 0 && !hasNotes)) {
                try { db.removeLiveMeeting(row.id); } catch { /* next launch */ }
                console.log(`[MeetingPersistence] Live meeting ${row.id} dropped (${retentionNever ? 'retention is "never"' : 'nothing to keep'}).`);
                continue;
            }
            const placeholder: Meeting = {
                id: row.id,
                title: 'Processing...',
                date: new Date(row.updatedAt || Date.now()).toISOString(),
                duration: formatDuration(durationMs),
                summary: 'Generating summary...',
                detailedSummary: { actionItems: [], keyPoints: [] },
                transcript: row.transcript,
                usage: row.usage,
                ...(typeof meta.calendarEventId === 'string' ? { calendarEventId: meta.calendarEventId, source: 'calendar' as const } : {}),
                ...(meta.calendarEvent ? { calendarEvent: meta.calendarEvent } : {}),
                isProcessed: false,
                summaryStatus: 'queued',
                recoveryMeta: { ...meta, startTime: row.startedAt, durationMs, endedBy: meta.endedBy ?? 'crash' },
                ...(hasNotes ? { userNotes: meta.userNotes } : {}),
            };
            try {
                const created = db.promoteLiveMeeting(placeholder, row.startedAt, durationMs);
                console.log(`[MeetingPersistence] Live meeting ${row.id} (${row.transcript.length} lines, ended by ${meta.endedBy ?? 'a crash'}) ${created ? 'saved for recovery' : 'was already saved; live copy removed'}.`);
            } catch (e) {
                console.error(`[MeetingPersistence] Live meeting ${row.id} could not be saved for recovery`, e);
            }
        }
        try {
            const wins = require('electron').BrowserWindow.getAllWindows();
            wins.forEach((w: any) => w.webContents.send('meetings-updated'));
        } catch { /* non-fatal */ }
    }

    /**
     * Regenerate the V3 notes for an already-saved meeting (user-initiated, Phase 12).
     * Re-runs the full map-reduce pipeline on the stored transcript, optionally with a
     * different mode and with the saved speaker rename labels applied. Never blocks: the
     * caller invokes this from an IPC handler off the UI thread; it updates summary_status
     * so the UI can show progress.
     *
     * Honors providerDataScopes.post_call_summary — if denied, returns false (no cloud call).
     */
    public async regenerateSavedMeeting(meetingId: string, opts?: { templateType?: string; modeId?: string; tone?: 'professional' | 'warm' | 'concise' | 'friendly' | 'your_style'; userNotes?: string; vocabulary?: string[] }): Promise<boolean> {
        const db = DatabaseManager.getInstance();
        const details = db.getMeetingDetails(meetingId);
        if (!details || !Array.isArray(details.transcript) || details.transcript.length < 3) return false;

        // Scope gate.
        let postCallSummaryAllowed = true;
        try {
            const { SettingsManager } = require('./services/SettingsManager');
            const scopePolicy = SettingsManager.getInstance().get('providerDataScopes') as ProviderDataScopePolicy | undefined;
            postCallSummaryAllowed = scopePolicy?.post_call_summary !== false;
        } catch { /* default allow */ }
        if (!postCallSummaryAllowed) {
            console.warn('[MeetingPersistence] regenerate denied — post_call_summary scope off.');
            return false;
        }

        // Resolve the target mode (explicit override, else stored selected mode, else active).
        let templateType = opts?.templateType;
        let modeId: string | undefined;
        let modeName: string | undefined;
        let modeNoteSections: Array<{ title: string; description: string; compiledPrompt?: string }> = [];
        let modeContextBlock = '';
        try {
            const { ModesManager, TEMPLATE_NOTE_SECTIONS } = require('./services/ModesManager');
            const modesMgr = ModesManager.getInstance();
            const storedMode = (details.detailedSummary as any)?.mode;
            const all = modesMgr.getModes() as Array<{ id: string; name: string; templateType: string }>;
            // PRECEDENCE (2026-09-25): explicit mode id > explicit template > the mode
            // this meeting ran under > the active mode. The auto-detect suggestion
            // ("Regenerate notes as Sales") used to lose to the saved mode here, so the
            // notes came back in the ORIGINAL template and the suggestion vanished as if
            // it had worked.
            const resolved = resolveRegenerateTarget({
                modeId: opts?.modeId,
                templateType: opts?.templateType,
                stored: storedMode,
                modes: all,
                activeTemplateType: modesMgr.getActiveMode()?.templateType,
            });
            templateType = resolved.templateType;
            const explicitMode = resolved.explicitMode;
            const explicitTemplate = resolved.explicitTemplate;
            // F-503: prefer the mode this meeting actually ran under.
            // MeetingPersistence PERSISTS selectedModeId at write time, but
            // regeneration used to ignore it and resolve by templateType —
            // `getModes()` is ORDER BY created_at ASC, so `find` returned the
            // OLDEST row with that template. Every user-built custom mode is
            // templateType 'general' and the built-in "General" is seeded
            // first, so regenerating a meeting run under a custom mode silently
            // used a DIFFERENT mode's note sections and then rewrote
            // modeMeta.selectedModeId/Name with that other mode's identity.
            const byId = resolved.byId;
            // Fall back to the legacy template lookup only when the recorded
            // mode is gone (deleted) or was never recorded (pre-selectedModeId
            // meetings).
            const match = resolved.match;
            if (!byId && !explicitMode && !explicitTemplate && storedMode?.selectedModeId) {
                console.warn(`[MeetingPersistence] regenerate: mode ${storedMode.selectedModeId} no longer exists; falling back to the first '${templateType}' mode.`);
            }
            if (match) { modeId = match.id; modeName = match.name; modeNoteSections = modesMgr.getNoteSections(match.id); }
            if (modeNoteSections.length === 0 && templateType) modeNoteSections = TEMPLATE_NOTE_SECTIONS[templateType as keyof typeof TEMPLATE_NOTE_SECTIONS] ?? [];
        } catch (e: any) {
            console.warn('[MeetingPersistence] regenerate mode load failed:', e?.message);
        }

        // Apply saved speaker labels so evidence/owners use renamed speakers.
        let transcript = details.transcript as TranscriptSegment[];
        try {
            if (isIntelligenceFlagEnabled('speakerLabelsV1')) {
                // A meeting saved before the calendar named "me" in every meeting
                // has no `me` label: with a connected calendar the regenerated notes
                // name the user all the same (the Transcript tab shows that name too).
                const stored = (details.detailedSummary as any)?.speakerLabels;
                const { calendarSpeakerLabels, modernizeCalendarLabels } = require('./services/calendar/calendarSessionMatch') as typeof import('./services/calendar/calendarSessionMatch');
                // A `me` the calendar wrote in full before first names regenerates as
                // the first name (modernizeCalendarLabels); one the user typed stays.
                const userName = this.calendarUserName();
                const current = modernizeCalendarLabels(stored, (details as any).calendarEvent, userName) ?? stored;
                const labels = current?.me ? current : { ...(calendarSpeakerLabels(null, userName) ?? {}), ...(current ?? {}) };
                if (labels && Object.keys(labels).length > 0) {
                    const { SpeakerLabelService } = require('./services/meeting/SpeakerLabelService');
                    transcript = new SpeakerLabelService().applyLabels(transcript, labels);
                }
            }
        } catch (e: any) {
            console.warn('[MeetingPersistence] regenerate speaker labels skipped:', e?.message);
        }

        // The same meeting context the first save had: the invite's people, last
        // time in the series (as of this meeting, not of today), the user's notes.
        const savedStartMs = new Date(details.date).getTime();
        const regenInputs = this.notesInputsFor({
            meetingId,
            title: details.title,
            startMs: Number.isFinite(savedStartMs) ? savedStartMs : Date.now(),
            calendarEvent: (details as any).calendarEvent ?? null,
            callParticipants: Array.isArray((details.detailedSummary as any)?.callParticipants) ? (details.detailedSummary as any).callParticipants : [],
            // The notes the user typed in the meeting, as saved with it; the
            // caller can pass others.
            userNotes: opts?.userNotes ?? details.userNotes ?? undefined,
            vocabulary: notesVocabulary(opts?.vocabulary),
        });

        db.updateSummaryStatus(meetingId, 'queued');
        // No follow-up is written here: one is written only when the user asks for it
        // (the meeting page's Follow-up email button, regenerateFollowUpDraft). A
        // follow-up the meeting already has is kept as it is (buildV3DetailedSummary);
        // Reset in the follow-up sheet writes it again from the new notes.

        try {
            const startedMs = Date.now();
            const assembler = new MeetingContextAssembler(this.llmHelper);
            const assembled = await assembler.assembleSummary({
                transcript,
                title: details.title,
                modeTemplateType: templateType,
                modeNoteSections,
                modeContextBlock,
                modeMeta: {
                    ...(modeId ? { selectedModeId: modeId } : {}),
                    ...(modeName ? { selectedModeName: modeName } : {}),
                    ...(templateType ? { selectedTemplateType: templateType } : {}),
                    summaryModeUsed: templateType || 'general',
                },
                startedAtMs: startedMs,
                startedAtIso: new Date(startedMs).toISOString(),
                polishSummary: isIntelligenceFlagEnabled('meetingSummaryLlmPolish'),
                onStatusUpdate: status => db.updateSummaryStatus(meetingId, status),
                meetingContextBlock: regenInputs?.meetingContextBlock,
                lastTimeBlock: regenInputs?.lastTimeBlock,
                userNotes: regenInputs?.userNotes,
                vocabulary: regenInputs?.vocabulary,
                sharedScreensBlock: regenInputs ? sharedScreensBlockFor((details.detailedSummary as any)?.sharedScreens) : undefined,
            });

            if (!assembled.summary) {
                db.updateSummaryStatus(meetingId, 'failed');
                return false;
            }
            const v3 = assembled.summary;
            // Task 9: regeneration is the case where a bad title is otherwise permanent
            // (the old title was passed straight through). Re-derive it from the fresh
            // notes; fall back to the existing v3.title when nothing groundable comes
            // back. replaceDetailedSummary's own user_titled CASE WHEN still protects a
            // manual rename regardless of what we pass here.
            // The overview call named the meeting in its reply (no title call). A missing
            // or rejected name yields a NOTE-DERIVED fallback rather than null, so an
            // unguarded assignment would overwrite a good existing title with the mechanical
            // one. shouldReplaceTitleOnRegenerate lets a model-generated title through and
            // holds a fallback back unless the current title is empty/placeholder.
            const regenerated = vetProposedTitle(assembled.proposedTitle, v3);
            // First NON-PLACEHOLDER of [fresh summary title, DB row title]: the reducer
            // fills v3.title with 'Meeting Notes' when the meeting has no name, so a
            // first-non-EMPTY read would hide a good DB title behind that placeholder.
            const v3Title = typeof v3.title === 'string' ? v3.title.trim() : '';
            const dbTitle = typeof details.title === 'string' ? details.title.trim() : '';
            const existingTitle = isDefaultMeetingTitle(v3Title) ? dbTitle : v3Title;
            if (shouldReplaceTitleOnRegenerate(existingTitle, regenerated)) {
                v3.title = regenerated.title as string;
            } else if (regenerated.title) {
                console.log(`[MeetingPersistence] regenerate: keeping the existing title "${existingTitle}" over the note-derived fallback.`);
            }
            const detailedSummary = buildV3DetailedSummary(v3, details.detailedSummary);
            // "Capture key points" used to be erased by Regenerate: neither the
            // "From earlier meetings" recall nor the structured memory record was
            // carried into the rebuilt blob. The recall is recomputed against the
            // NEW notes (the items it matches may have changed); the memory record
            // is built from the transcript, which Regenerate does not change, so it
            // is kept as saved.
            const recall = computeCrossMeetingRecall(meetingId, v3);
            if (recall) detailedSummary.crossMeeting = recall;
            const prevMemory = (details.detailedSummary as any)?.meetingMemory;
            if (prevMemory) detailedSummary.meetingMemory = prevMemory;
            const prevScreens = sharedScreenEntries((details.detailedSummary as any)?.sharedScreens);
            if (prevScreens.length > 0) detailedSummary.sharedScreens = prevScreens;
            // The notes being replaced stay as a version the meeting page shows
            // in its own tab (bounded; DatabaseManager.archiveNotesVersion).
            if (isArchivableNotes(details.detailedSummary)) db.archiveNotesVersion(meetingId, details.detailedSummary);
            const ok = db.replaceDetailedSummary(meetingId, detailedSummary, { title: v3.title, summaryStatus: 'completed' });
            if (ok) { this.notifyNotesSaved(meetingId); this.connectorsNotesReady(meetingId); }
            try {
                const wins = require('electron').BrowserWindow.getAllWindows();
                wins.forEach((w: any) => w.webContents.send('meetings-updated'));
            } catch { /* non-fatal */ }
            return ok;
        } catch (e: any) {
            console.error('[MeetingPersistence] regenerate failed:', e?.message);
            try { db.updateSummaryStatus(meetingId, 'failed'); } catch { /* non-fatal */ }
            return false;
        }
    }

    /**
     * Write the follow-up draft for a saved V3 meeting, or rewrite it (cheap; no
     * re-summarize). This is the ONLY place a draft is first written: meetings save
     * without one and the notes offer Generate, which lands here.
     */
    public async regenerateFollowUpDraft(meetingId: string, tone?: 'professional' | 'warm' | 'concise' | 'friendly' | 'your_style'): Promise<boolean> {
        const db = DatabaseManager.getInstance();
        const details = db.getMeetingDetails(meetingId);
        const detailed = details?.detailedSummary as any;
        // Older notes (before V3) get a follow-up too, written from their own fields.
        if (!detailed || typeof detailed !== 'object') return false;

        let postCallSummaryAllowed = true;
        try {
            const { SettingsManager } = require('./services/SettingsManager');
            const scopePolicy = SettingsManager.getInstance().get('providerDataScopes') as ProviderDataScopePolicy | undefined;
            postCallSummaryAllowed = scopePolicy?.post_call_summary !== false;
        } catch { /* default allow */ }
        if (!postCallSummaryAllowed) return false;

        try {
            const { FollowUpDraftGenerator } = require('./services/meeting/FollowUpDraftGenerator');
            // Tone and voice: "Your style" (the samples of the mode this meeting ran
            // under) unless a preset tone was picked. Off with the template draft
            // (NATIVELY_FOLLOWUP_DRAFT_V2=0): no model call at all.
            const llmDraft = isIntelligenceFlagEnabled('followUpDraftV2');
            let styleModeId: string | undefined;
            try { styleModeId = require('./services/outputs/outputsIpc').meetingStyleModeId(detailed); } catch { styleModeId = undefined; }
            const voice = await followUpVoice(styleModeId, tone, styleGuideReader(llmDraft, this.llmHelper));
            const draft = await new FollowUpDraftGenerator(this.llmHelper).generate({
                summary: detailed.schemaVersion !== 3 ? followUpSourceFromLegacyNotes(detailed, details?.title) : {
                    title: detailed.title,
                    overview: detailed.overview || '',
                    tldr: detailed.tldr || [],
                    whatChanged: detailed.whatChanged || [],
                    decisions: detailed.decisions || [],
                    actionItems: detailed.actionItemsV3 || detailed.actionItemsStructured || [],
                    openQuestions: detailed.openQuestions || [],
                    // These are the new rich fields the widened generator consumes — without them,
                    // the regenerated draft would lose every mode-specific note section (sales
                    // objections, recruiting concerns, interview approach/complexity, etc.) and
                    // regress to the original "doesn't understand the meeting" symptom.
                    risks: detailed.risks || [],
                    sections: detailed.sectionsV3 || detailed.sections || [],
                },
                mode: detailed.mode?.selectedTemplateType,
                tone: voice.tone,
                senderName: followUpSenderFirstName(),
                styleGuide: voice.styleGuide,
                styleSignOff: voice.styleSignOff,
                // NATIVELY_FOLLOWUP_DRAFT_V2=0 kill switch: the template draft, no LLM call.
                deterministicOnly: !llmDraft,
            });
            const ok = db.replaceDetailedSummary(meetingId, { ...detailed, followUpDraft: draft });
            try {
                const wins = require('electron').BrowserWindow.getAllWindows();
                wins.forEach((w: any) => w.webContents.send('meetings-updated'));
            } catch { /* non-fatal */ }
            return ok;
        } catch (e: any) {
            console.error('[MeetingPersistence] follow-up regenerate failed:', e?.message);
            return false;
        }
    }
}

/**
 * What a follow-up is written from, for notes saved before V3: key points stand
 * in for the takeaways, the plain action items become items, and section
 * bullets (plain strings there) take the V3 bullet shape. Exported for tests.
 */
export function followUpSourceFromLegacyNotes(detailed: any, meetingTitle?: string): {
    title?: string; overview: string; tldr: string[]; actionItems: any[];
    sections: Array<{ title: string; order: number; bullets: Array<{ text: string }> }>;
} {
    const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : []);
    const structured = Array.isArray(detailed?.actionItemsStructured) ? detailed.actionItemsStructured : null;
    return {
        title: detailed?.title || meetingTitle,
        overview: typeof detailed?.overview === 'string' ? detailed.overview : '',
        tldr: strings(detailed?.keyPoints),
        actionItems: structured ?? strings(detailed?.actionItems).map((text) => ({ text })),
        sections: (Array.isArray(detailed?.sections) ? detailed.sections : [])
            .filter((s: any) => s && typeof s.title === 'string' && Array.isArray(s.bullets))
            .map((s: any, i: number) => ({
                title: s.title,
                order: i,
                bullets: s.bullets
                    .map((b: any) => (typeof b === 'string' ? { text: b } : { text: typeof b?.text === 'string' ? b.text : '' }))
                    .filter((b: { text: string }) => b.text.trim().length > 0),
            })),
    };
}

/**
 * The tone and voice a follow-up is drafted in. A preset tone (Professional, Warm,
 * Concise, Friendly) drafts in that tone alone. Otherwise ('your_style', or no
 * tone asked) the user's own voice from the mode's writing samples, derived (one
 * model call) only when the samples changed; with no samples, or no recorded mode,
 * no tone, so the generator uses the mode's default. Exported for tests.
 */
export async function followUpVoice(
    modeId: string | undefined,
    asked: FollowUpToneArg | undefined,
    guideFor: (modeId: string) => Promise<StyleVoice | undefined>,
): Promise<{ tone?: FollowUpToneArg; styleGuide?: string; styleSignOff?: string }> {
    if (asked && asked !== 'your_style') return { tone: asked };
    let voice: StyleVoice | undefined;
    try { voice = modeId ? await guideFor(modeId) : undefined; } catch { voice = undefined; }
    if (!voice?.guide) return {};
    return { tone: 'your_style', styleGuide: voice.guide, ...(voice.signOff ? { styleSignOff: voice.signOff } : {}) };
}

/** One mode's writing style for a draft: the prompt block and the usual sign-off. */
type StyleVoice = { guide: string; signOff?: string };

/** The style of one mode's samples, for followUpVoice (outputs/writingStyle.ts). */
function styleGuideReader(llmDraft: boolean, llmHelper: any): (modeId: string) => Promise<StyleVoice | undefined> {
    return async (modeId) => {
        const { getWritingStyleService, styleModelCall } = require('./services/outputs/outputsIpc');
        const { styleGuideForDraft } = require('./services/outputs/writingStyle');
        const svc = getWritingStyleService(modeId);
        const guide = await styleGuideForDraft(svc, llmDraft, styleModelCall(llmHelper));
        return guide ? { guide, signOff: svc.signOffForFollowUp() } : undefined;
    };
}
type FollowUpToneArg = 'professional' | 'warm' | 'concise' | 'friendly' | 'your_style';

/**
 * Which mode a Regenerate rebuilds the notes in. PRECEDENCE: an explicit mode id
 * (the auto-detect suggestion) > an explicit template > the mode this meeting ran
 * under (F-503) > the active mode. `match` falls back to the first mode with the
 * resolved template when the chosen one no longer exists. Pure — exported for tests.
 */
export function resolveRegenerateTarget<M extends { id: string; templateType: string }>(input: {
    modeId?: string;
    templateType?: string;
    stored?: { selectedModeId?: string; selectedTemplateType?: string } | null;
    modes: M[];
    activeTemplateType?: string;
}): { templateType: string | undefined; explicitMode: M | undefined; explicitTemplate: boolean; byId: M | undefined; match: M | undefined } {
    const explicitMode = input.modeId ? input.modes.find((m) => m.id === input.modeId) : undefined;
    const explicitTemplate = Boolean(!explicitMode && input.templateType);
    const templateType = explicitMode?.templateType
        || input.templateType
        || input.stored?.selectedTemplateType
        || input.activeTemplateType;
    const byId = explicitMode
        ?? (explicitTemplate || !input.stored?.selectedModeId
            ? undefined
            : input.modes.find((m) => m.id === input.stored!.selectedModeId));
    const match = byId ?? input.modes.find((m) => m.templateType === templateType);
    return { templateType, explicitMode, explicitTemplate, byId, match };
}

// CROSS-MEETING RECALL (Phase 13, behind meetingMemoryV2 — "Capture key points").
// Local-first, deterministic, no LLM, no network. Compares this meeting's open
// questions, action items, risks and decisions to the 15 most recent other meetings
// to surface "still open from last time" and earlier decisions. Returns null when the
// switch is off, there is no prior history, or nothing matched. Shared by the
// meeting-end save and Regenerate so the two can never disagree.
function computeCrossMeetingRecall(
    meetingId: string,
    v3: import('./services/meeting/types').MeetingSummaryV3,
): import('./services/meeting/CrossMeetingRecall').CrossMeetingResult | null {
    try {
        if (!isIntelligenceFlagEnabled('meetingMemoryV2')) return null;
        const { CrossMeetingRecall, priorFromDetailedSummary } = require('./services/meeting/CrossMeetingRecall');
        const recent = DatabaseManager.getInstance().getRecentMeetings(15)
            .filter(m => m.id !== meetingId)
            .map(priorFromDetailedSummary)
            .filter((p: unknown): p is NonNullable<typeof p> => p !== null);
        const recall = new CrossMeetingRecall().compute(v3, recent);
        return recall.stillOpen.length > 0 ? recall : null;
    } catch (xmErr) {
        console.warn('[CrossMeetingRecall] skipped (non-fatal):', (xmErr as any)?.message);
        return null;
    }
}

// Build the persisted detailedSummary blob from a MeetingSummaryV3, preserving back-compat
// V2 bridge fields. Mirrors the inline mapping in processAndSaveMeeting so regenerate and
// initial save produce identical shapes.
/**
 * The user's own name, to sign follow-up drafts with: the Google account connected
 * for Calendar sync (CalendarManager reads it from that sign-in's id_token). Only
 * the name is used, never the email. Undefined when Calendar is not connected or
 * the account carried no name, and the draft is then signed with no name.
 */
function followUpSenderName(): string | undefined {
    try {
        const { CalendarManager } = require('./services/CalendarManager');
        const status = CalendarManager.getInstance().getConnectionStatus();
        return status?.connected && typeof status.name === 'string' ? status.name : undefined;
    } catch {
        return undefined;
    }
}

/** The sender's first name: what the follow-up email is signed with (and how it
 *  refers to the user), whatever the mode's signAs — "Evin", not the account's
 *  "Evin John Ignatious". */
function followUpSenderFirstName(): string | undefined {
    try {
        const { firstNameOf } = require('./services/calendar/calendarSessionMatch') as typeof import('./services/calendar/calendarSessionMatch');
        return firstNameOf(followUpSenderName()) ?? undefined;
    } catch {
        return undefined;
    }
}

function buildV3DetailedSummary(v3: import('./services/meeting/types').MeetingSummaryV3, prev?: any): any {
    return {
        ...(prev && typeof prev === 'object' ? { speakerLabels: prev.speakerLabels } : {}),
        schemaVersion: 3,
        title: v3.title,
        tldr: v3.tldr,
        whatChanged: v3.whatChanged,
        overview: v3.overview,
        sectionsV3: v3.sections,
        sections: v3.sections.map(section => ({ title: section.title, bullets: section.bullets.map(b => b.text) })),
        decisions: v3.decisions,
        actionItemsV3: v3.actionItems,
        actionItems: v3.actionItems.map(item => item.text),
        actionItemsStructured: v3.actionItems.map(item => ({
            id: item.id || `action_${crypto.randomUUID()}`,
            text: item.text,
            ...(item.owner ? { owner: item.owner } : {}),
            ...(item.deadline ? { deadline: item.deadline } : {}),
            ...(typeof item.sourceTimestampMs === 'number' ? { sourceTimestamp: item.sourceTimestampMs } : {}),
        })),
        openQuestions: v3.openQuestions,
        risks: v3.risks,
        // Regenerated notes keep the follow-up the meeting had (edited or not): none
        // is written without the user asking.
        followUpDraft: v3.followUpDraft ?? (prev && typeof prev === 'object' ? prev.followUpDraft : undefined),
        timeline: v3.timeline,
        people: v3.people,
        topics: v3.topics,
        sourceQuality: v3.sourceQuality,
        mode: v3.mode,
        generation: v3.generation,
        recipes: v3.recipes,
        keyPoints: v3.tldr,
        actionItemsTitle: 'Action Items',
        keyPointsTitle: 'TLDR',
    };
}

function buildBalancedTranscriptContext(transcript: TranscriptSegment[], maxChars: number): string {
    const lines = (Array.isArray(transcript) ? transcript : [])
        .map(segment => `${segment.speaker || 'speaker'}: ${segment.text || ''}`)
        .filter(line => line.trim().length > 0);
    const full = lines.join('\n');
    if (full.length <= maxChars) return full;

    const budget = Math.max(3000, maxChars);
    const part = Math.floor(budget / 3);
    const start = full.slice(0, part);
    const middleStart = Math.max(0, Math.floor(full.length / 2) - Math.floor(part / 2));
    const middle = full.slice(middleStart, middleStart + part);
    const end = full.slice(Math.max(0, full.length - part));
    return [
        start,
        '\n[...middle of transcript preserved below...]\n',
        middle,
        '\n[...end of transcript preserved below...]\n',
        end,
    ].join('').slice(0, maxChars);
}
