/*
  The notepad's own logic (NotesWindow.tsx, 2026-10-20), pure so it is tested
  without a DOM:

  - Ask's sources: the transcript lines an answer matches (shared words, no
    model call), shown under the answer as "In the transcript".
  - Ask's context: the last few questions and answers, sent with a new one.
  - The heading's people, grouped by company (the email's domain).
  - The enhanced notes after Stop, as copyable text.
  - The transcript panel's search.
  - The transcript panel's mic and language pickers (which choices to offer).
  - Ask's recipes: the first ones shown, the rest behind "All recipes".
*/

export interface TranscriptLine { speaker: string; text: string; at: number }

const STOP = new Set(('the a an and or but if then than that this these those there their they them you your yours we our ours i me my mine he she his her it its is are was were be been being '
    + 'have has had do does did done to of in on at by for with from as about into over after before up down out off so not no yes just also very can could would should will '
    + 'shall may might must what which who whom whose when where why how all any some each more most other such only own same too again once here both few many much '
    + 'like think know going yeah okay right really thing things well get got make made said say says want need one two').split(' '));

/** The words that carry meaning in a line: lower case, 3+ letters, no common words. */
export function contentWords(text: string): Set<string> {
    const out = new Set<string>();
    for (const raw of text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []) {
        const w = raw.replace(/'s$/, '').replace(/^-+|-+$/g, '');
        if (w.length < 3 || STOP.has(w)) continue;
        out.add(w);
    }
    return out;
}

/**
 * The transcript lines an answer draws on, best first then in time order: a
 * line shares at least `minShared` meaningful words with the answer, and at
 * least a third of its own. At most `max`. Lines under four meaningful words
 * never count (a "yes, that works" matches everything).
 */
export function answerSources(answer: string, lines: TranscriptLine[], max = 3, minShared = 3): TranscriptLine[] {
    const words = contentWords(answer);
    if (words.size === 0) return [];
    const scored: Array<{ line: TranscriptLine; score: number }> = [];
    for (const line of lines) {
        const own = contentWords(line.text);
        if (own.size < 4) continue;
        let shared = 0;
        for (const w of own) if (words.has(w)) shared++;
        if (shared >= minShared && shared / own.size >= 1 / 3) scored.push({ line, score: shared / own.size + shared / 100 });
    }
    return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, max)
        .map((s) => s.line)
        .sort((a, b) => a.at - b.at);
}

export interface AskTurn { question: string; text: string; status: 'streaming' | 'done' | 'error' }

/** The last `max` finished turns as "User / Assistant" lines, for a follow-up question. */
export function askContext(turns: AskTurn[], max = 3): string | undefined {
    const done = turns.filter((t) => t.status === 'done' && t.text.trim()).slice(-max);
    if (done.length === 0) return undefined;
    return done.map((t) => `User: ${t.question}\nAssistant: ${t.text}`).join('\n\n');
}

export interface Attendee { email: string; name: string | null }

const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com']);

/** "acme.io" → "Acme". Personal mail domains read "Personal". */
export function companyOfEmail(email: string): string {
    const domain = (email.split('@')[1] ?? '').toLowerCase();
    if (!domain) return 'Other';
    if (FREE_MAIL.has(domain)) return 'Personal';
    const parts = domain.split('.');
    const name = parts.length >= 3 && ['co', 'com', 'org', 'net', 'ac', 'gov'].includes(parts[parts.length - 2]) ? parts[parts.length - 3] : parts[parts.length - 2] ?? parts[0];
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Other';
}

/** The people grouped by company, the user's own company first, the user marked. */
export function groupAttendees(attendees: Attendee[], selfEmail: string | null): Array<{ company: string; people: Array<Attendee & { self: boolean }> }> {
    const self = selfEmail?.toLowerCase() ?? null;
    const selfCompany = self ? companyOfEmail(self) : null;
    const groups = new Map<string, Array<Attendee & { self: boolean }>>();
    for (const a of attendees) {
        const company = companyOfEmail(a.email);
        const list = groups.get(company) ?? [];
        list.push({ ...a, self: !!self && a.email.toLowerCase() === self });
        groups.set(company, list);
    }
    return [...groups.entries()]
        .sort(([a], [b]) => (a === selfCompany ? -1 : b === selfCompany ? 1 : a.localeCompare(b)))
        .map(([company, people]) => ({ company, people: people.sort((x, y) => Number(y.self) - Number(x.self)) }));
}

/** "10:00 – 10:30" from two ISO times, in the user's clock; '' when unreadable. */
export function eventTimeRange(start: string | null | undefined, end: string | null | undefined, locale?: string): string {
    const s = start ? Date.parse(start) : NaN;
    const e = end ? Date.parse(end) : NaN;
    if (!Number.isFinite(s)) return '';
    const fmt = (ms: number) => new Date(ms).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
    return Number.isFinite(e) ? `${fmt(s)} – ${fmt(e)}` : fmt(s);
}

interface DetailedLike {
    schemaVersion?: number;
    overview?: string;
    tldr?: string[];
    sectionsV3?: Array<{ title: string; bullets: Array<{ text: string; fromUserNotes?: boolean }> }>;
    keyPoints?: string[];
    actionItems?: string[];
    decisions?: Array<{ text?: string; fromUserNotes?: boolean; evidence?: unknown[] }>;
    actionItemsV3?: Array<{ text?: string; owner?: string; deadline?: string; fromUserNotes?: boolean; evidence?: unknown[] }>;
}

export interface FallbackNoteSection {
    id: string;
    title: string;
    bullets: Array<{ id: string; text: string; fromUserNotes?: boolean; evidence?: any[] }>;
}

/** An action as the exports write it (notesDocument.actionItemLine): "May: Fix the crash (by November 9)". */
export function actionLine(a: { text?: string; owner?: string; deadline?: string }): string {
    const text = (a.text ?? '').trim();
    const owner = (a.owner ?? '').trim();
    const deadline = (a.deadline ?? '').trim();
    return `${owner ? `${owner}: ` : ''}${text}${deadline ? ` (by ${deadline})` : ''}`;
}

/**
 * The sections of a version 3 note written with no template (no mode active and
 * none picked in the notepad, 2026-10-31): Decisions and Action items, from the
 * structured lists the notes call wrote anyway. Without them the page showed only
 * the overview and the Summary, and every owner and date the call found stayed
 * hidden (the Granola benchmark: 21 of 21 meetings, e.g. six owned, dated actions
 * in a release planning call). Empty when the note has template sections.
 */
export function fallbackNoteSections(detailed: DetailedLike | null | undefined): FallbackNoteSection[] {
    if (!detailed || detailed.schemaVersion !== 3) return [];
    if ((detailed.sectionsV3 ?? []).some((s) => s && Array.isArray(s.bullets) && s.bullets.length > 0)) return [];
    const out: FallbackNoteSection[] = [];
    const decisions = (detailed.decisions ?? [])
        .filter((d) => typeof d?.text === 'string' && d.text.trim())
        .map((d, i) => ({ id: `decision-${i}`, text: d.text!.trim(), fromUserNotes: !!d.fromUserNotes, evidence: Array.isArray(d.evidence) ? d.evidence : undefined }));
    if (decisions.length) out.push({ id: 'fallback-decisions', title: 'Decisions', bullets: decisions });
    const actions = (detailed.actionItemsV3 ?? [])
        .filter((a) => typeof a?.text === 'string' && a.text.trim())
        .map((a, i) => ({ id: `action-${i}`, text: actionLine(a), fromUserNotes: !!a.fromUserNotes, evidence: Array.isArray(a.evidence) ? a.evidence : undefined }));
    if (actions.length) out.push({ id: 'fallback-actions', title: 'Action items', bullets: actions });
    return out;
}

export interface EnhancedSection { title: string; lines: Array<{ text: string; mine: boolean }> }

/**
 * The notes to show after Stop, in the meeting page's order: Summary, then the
 * template's sections (a line built on the user's own notes is "mine", drawn
 * in the primary ink). Older notes (no sections) fall back to key points and
 * action items. Version 3 notes never do: their key points only mirror the
 * Summary for older readers, so a v3 note with no sections showed the Summary
 * twice (2026-10-31), and the meeting page doesn't show them either. When the
 * template has its own Summary section (the General mode seeded on new installs
 * does), that section is the Summary and the tldr isn't drawn as a second one.
 * A v3 note with no template gets Decisions and Action items instead
 * (fallbackNoteSections). Empty when there are no notes yet.
 */
/**
 * Where the notes after Stop stand, from the saved meeting's summaryStatus
 * (MeetingPersistence). Main can finish with nothing to show: no speech to
 * write from (it skips the summary and saves "completed" with empty notes),
 * too little said, or a failed pass ("failed"). The notepad waited on the
 * pill forever in those cases (2026-11-01). Any other status, or none yet
 * (the meeting is still being saved), is still writing.
 */
export type NotesOutcome = 'ready' | 'writing' | 'nothing' | 'failed';
export function notesOutcome(hasNotes: boolean, summaryStatus: unknown): NotesOutcome {
    if (hasNotes) return 'ready';
    if (summaryStatus === 'completed') return 'nothing';
    if (summaryStatus === 'failed') return 'failed';
    return 'writing';
}

/** A template section that is itself the Summary: "Summary", "TL;DR" (not "Study summary"). */
export function isSummaryTitle(title: string | null | undefined): boolean {
    return /^\s*(?:summary|tl;?\s*dr)\s*:?\s*$/i.test(title ?? '');
}

export function enhancedSections(detailed: DetailedLike | null | undefined): EnhancedSection[] {
    if (!detailed) return [];
    const out: EnhancedSection[] = [];
    const tldr = (detailed.tldr ?? []).filter((t) => typeof t === 'string' && t.trim());
    const templated = (detailed.sectionsV3 ?? []).filter((s) => s && Array.isArray(s.bullets) && s.bullets.length > 0);
    const sections = templated.length ? templated : fallbackNoteSections(detailed);
    if (tldr.length && !sections.some((s) => isSummaryTitle(s.title))) out.push({ title: 'Summary', lines: tldr.map((text) => ({ text, mine: false })) });
    for (const s of sections) {
        out.push({ title: s.title, lines: s.bullets.filter((b) => b?.text?.trim()).map((b) => ({ text: b.text, mine: !!b.fromUserNotes })) });
    }
    if (sections.length === 0 && detailed.schemaVersion !== 3) {
        const kp = (detailed.keyPoints ?? []).filter((t) => typeof t === 'string' && t.trim());
        if (kp.length) out.push({ title: 'Key points', lines: kp.map((text) => ({ text, mine: false })) });
        const ai = (detailed.actionItems ?? []).filter((t) => typeof t === 'string' && t.trim());
        if (ai.length) out.push({ title: 'Action items', lines: ai.map((text) => ({ text, mine: false })) });
    }
    return out.filter((s) => s.lines.length > 0);
}

/**
 * The overview the meeting page shows above the Summary (2026-10-31), as plain
 * paragraphs: the notepad draws no markdown, so heading lines and bold/italic
 * markers are dropped and soft line breaks joined.
 */
export function enhancedOverview(detailed: DetailedLike | null | undefined): string[] {
    const raw = typeof detailed?.overview === 'string' ? detailed.overview : '';
    return raw
        .split(/\n\s*\n/)
        .map((p) => p
            .replace(/^#{1,6}\s.*$/gm, '')
            .replace(/(^|[^\w])(\*\*|__|\*|_)(\S(?:.*?\S)?)\2(?!\w)/g, '$1$3')
            .replace(/\s*\n\s*/g, ' ')
            .trim())
        .filter(Boolean);
}

/** The enhanced notes as markdown, for Copy: title, overview, then the sections. */
export function enhancedNotesMarkdown(title: string, sections: EnhancedSection[], overview: string[] = []): string {
    const parts = [`# ${title}`, ...overview];
    for (const s of sections) parts.push(`## ${s.title}\n${s.lines.map((l) => `- ${l.text}`).join('\n')}`);
    return parts.join('\n\n');
}

/**
 * Find in the transcript, as Granola's: every place the query occurs in a
 * line (case ignored, not overlapping), in transcript order. Matches are
 * highlighted where they are; nothing is filtered out.
 */
export interface TranscriptHit { at: number; from: number; to: number }
export function findInTranscript(lines: Array<{ text: string; at: number }>, query: string): TranscriptHit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: TranscriptHit[] = [];
    for (const l of lines) {
        const hay = l.text.toLowerCase();
        for (let i = hay.indexOf(q); i !== -1; i = hay.indexOf(q, i + q.length)) hits.push({ at: l.at, from: i, to: i + q.length });
    }
    return hits;
}

/**
 * The live transcript (2026-10-31). Each speaker keeps its own words in
 * progress, so you and the call heard at once grow side by side instead of
 * taking turns in one slot (which flipped the bubble between speakers and let
 * one side's final wipe the other's words). A line keeps the time its first
 * words arrived, and lines and words in progress are shown in that order, so
 * a line stays where it is when it is finalised. Words in progress not heard
 * from for `staleMs` are dropped, since a side can fall silent without a final.
 */
export interface LivePartial extends TranscriptLine { seen: number }
export interface LiveTranscript { lines: TranscriptLine[]; partials: LivePartial[] }
export const EMPTY_LIVE_TRANSCRIPT: LiveTranscript = { lines: [], partials: [] };
const byStart = (a: { at: number }, b: { at: number }) => a.at - b.at;
export function applyTranscriptEvent(
    state: LiveTranscript,
    ev: { speaker: string; text: string; at: number; final: boolean },
    now: number,
    keep = 600,
    staleMs = 8000,
): LiveTranscript {
    const own = state.partials.find((p) => p.speaker === ev.speaker);
    const others = state.partials.filter((p) => p.speaker !== ev.speaker && now - p.seen <= staleMs);
    const at = own?.at ?? ev.at;
    if (ev.final) {
        const lines = [...state.lines, { speaker: ev.speaker, text: ev.text, at }].sort(byStart).slice(-keep);
        return { lines, partials: others };
    }
    return { lines: state.lines, partials: [...others, { speaker: ev.speaker, text: ev.text, at, seen: now }].sort(byStart) };
}
/** Lines and words in progress, in the order they started; `partial` marks the latter. */
export function liveTranscriptRows(state: LiveTranscript): Array<TranscriptLine & { partial: boolean }> {
    return [
        ...state.lines.map((l) => ({ ...l, partial: false })),
        ...state.partials.map(({ speaker, text, at }) => ({ speaker, text, at, partial: true })),
    ].sort(byStart);
}

/**
 * Granola's listening bars (RandomAudioVisualizer): three bars, the middle the
 * liveliest, each a fresh random share of the level, from a 15% nub to full.
 * `level` is 0..1; `rand` is injectable for tests.
 */
export function listeningBarHeights(level: number, rand: () => number = Math.random): number[] {
    const amp = Math.max(0, Math.min(1, level));
    return [2, 1, 2].map((k) => {
        const r = (rand() * 0.4 + 0.6) * k;
        return Math.min(Math.floor((10 * amp) / r) + 1.5, 10) / 10;
    });
}


// ── The transcript panel's pickers (2026-10-20) ─────────────────────────────

/**
 * Speech providers whose languages depend on the model or the machine (a
 * local model's set, Apple Speech's installed locales, an NVIDIA deployment,
 * Deepgram's per-model gaps). Settings › Audio filters those; the notepad
 * sends the user there rather than offer a language that would stop the
 * transcript.
 */
export const LANGUAGE_RESTRICTED_PROVIDERS: ReadonlySet<string> = new Set(['local-whisper', 'apple-speech', 'nvidia_nim', 'deepgram']);

export interface LanguageEntry { label: string; group?: string }

/** The languages the notepad offers, Auto first, then English, then by name; null: pick in Settings. */
export function notepadLanguageChoices(
    provider: string,
    languages: Record<string, LanguageEntry>,
    offered: (key: string) => boolean = () => true,
): Array<{ key: string; label: string }> | null {
    if (LANGUAGE_RESTRICTED_PROVIDERS.has(provider)) return null;
    const rank = (key: string, l: LanguageEntry) => (key === 'auto' ? 0 : l.group === 'English' ? 1 : 2);
    return Object.entries(languages)
        .filter(([key, l]) => !!l && typeof l.label === 'string' && offered(key))
        .sort(([ka, a], [kb, b]) => rank(ka, a) - rank(kb, b) || a.label.localeCompare(b.label))
        // Settings' "Auto Detect" reads as just "Auto" here, as on the button.
        .map(([key, l]) => ({ key, label: key === 'auto' ? 'Auto' : l.label }));
}

/** The language button's word: the language's name ("English"), or "Auto". */
export function languageButtonLabel(key: string, languages: Record<string, LanguageEntry>): string {
    if (!key || key === 'auto') return 'Auto';
    const l = languages[key];
    if (!l) return 'Language';
    return l.group && l.group !== 'Auto' ? l.group : l.label;
}

/** The mic button's name: the saved device when it is still there, else the system default. */
export function micButtonLabel(devices: Array<{ id: string; name: string }>, savedId: string | null): string {
    if (savedId && savedId !== 'default') {
        const hit = devices.find((d) => d.id === savedId || d.name === savedId);
        if (hit) return hit.name;
    }
    const def = devices.find((d) => d.id === 'default');
    return def?.name && def.name !== 'default' ? def.name : 'Default microphone';
}

// ── Ask's recipes ───────────────────────────────────────────────────────────

/** How many recipes sit in the row before "All recipes" (Granola shows two). */
export const RECIPES_SHOWN = 2;

/** The recipes to draw: the first ones, or all of them once "All recipes" is open. */
export function visibleRecipes<T>(recipes: readonly T[], showAll: boolean): T[] {
    return showAll ? [...recipes] : recipes.slice(0, RECIPES_SHOWN);
}

/**
 * The heading of a saved meeting opened in the notepad (2026-11-02, the meeting
 * page's notepad button): its title, its calendar event and people, from the
 * saved row (getMeetingDetails). The live heading comes from the running
 * session instead; this fills it when the page was not that meeting's own.
 */
export function savedMeetingHeading(d: unknown): { title: string | null; people: number; event: { id: string; title: string | null; startTime: string | null; endTime: string | null; link: string | null } | null; attendees: Attendee[] } {
    const m = (d && typeof d === 'object' ? d : {}) as { title?: unknown; calendarEvent?: any };
    const title = typeof m.title === 'string' && m.title.trim() ? m.title.trim() : null;
    const ev = m.calendarEvent && typeof m.calendarEvent === 'object' && typeof m.calendarEvent.id === 'string' ? m.calendarEvent : null;
    const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
    const attendees: Attendee[] = Array.isArray(ev?.attendees)
        ? ev.attendees
            .filter((a: any) => a && typeof a.email === 'string' && a.email)
            .map((a: any) => ({ email: a.email as string, name: typeof a.name === 'string' && a.name.trim() ? a.name.trim() : null }))
        : [];
    return {
        title,
        people: attendees.length,
        event: ev ? { id: ev.id, title: str(ev.title), startTime: str(ev.startTime), endTime: str(ev.endTime), link: str(ev.link) } : null,
        attendees,
    };
}
