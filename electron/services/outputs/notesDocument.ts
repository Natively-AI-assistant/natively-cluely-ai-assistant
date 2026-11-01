// One plain description of a meeting's notes, built from the saved meeting, that
// every output reads: the PDF and HTML files, Slack, Notion, CRM notes and the
// local MCP server. Pure (no Electron), so each converter is testable on its own
// and they cannot drift from each other about what "the notes" are.
//
// It mirrors what the meeting page shows: the Summary (tl;dr) and the mode's
// sections, minus a "Next steps" section (the action items carry that), then the
// action items, which every output offers explicitly. Older notes (before
// schema 3) give their overview, key points and action items.

export interface InlineSpan {
    text: string;
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
}

export interface NotesSection {
    heading: string;
    /** Free text above the bullets (an older note's overview). */
    paragraph?: string;
    bullets: string[];
}

export interface NotesActionItem {
    text: string;
    owner?: string;
    deadline?: string;
    done: boolean;
}

export interface NotesTranscriptLine {
    speaker: string;
    text: string;
    /** Milliseconds from the start of the meeting. */
    offsetMs: number;
}

export interface NotesAttendee {
    email: string;
    name?: string;
}

export interface NotesDocument {
    meetingId: string;
    title: string;
    /** ISO date the meeting was saved under. */
    dateIso: string;
    /** "Tuesday, 14 October 2026", in the given locale. */
    dateLabel: string;
    durationLabel?: string;
    attendees: NotesAttendee[];
    participants: string[];
    sections: NotesSection[];
    actionItems: NotesActionItem[];
    transcript: NotesTranscriptLine[];
    /** The user's own typed notes, as typed. */
    userNotes?: string;
}

/** The fields of a saved meeting this reads (DatabaseManager.getMeetingDetails). */
export interface MeetingLike {
    id: string;
    title?: string;
    date?: string;
    duration?: string;
    summary?: string;
    detailedSummary?: any;
    transcript?: Array<{ speaker?: string; text?: string; timestamp?: number; speakerId?: string }>;
    calendarEvent?: { attendees?: Array<{ email?: string; name?: string }> } | null;
    userNotes?: string;
}

export interface BuildNotesOptions {
    /** The user's own name, for their transcript lines. */
    selfName?: string;
    locale?: string;
    timeZone?: string;
}

const NEXT_STEPS_TITLE = /^(?:\s*next\s*steps?\b|\s*what\s+happens\s+next\b)/i;
// A template section that is itself the Summary, so the tldr isn't sent as a second one (2026-10-31).
const SUMMARY_TITLE = /^\s*(?:summary|tl;?\s*dr)\s*:?\s*$/i;

export function plainTitle(raw: unknown): string {
    const t = String(raw ?? '')
        .replace(/^\s*(?:[-*+•–—]|#{1,6})[ \t]+/, '')
        .replace(/\*\*|`/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return t || 'Untitled meeting';
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim() : '');

/**
 * Splits **bold**, *italic* / _italic_ and `code` out of a line of note text.
 * Anything unbalanced stays literal. Used so Slack, Notion and the HTML file
 * keep the emphasis the notes have, each in its own syntax.
 */
export function inlineSpans(text: string): InlineSpan[] {
    const spans: InlineSpan[] = [];
    const re = /(\*\*([^*\n]+?)\*\*|`([^`\n]+?)`|(?<![\w*])\*([^*\n]+?)\*(?![\w*])|(?<![\w_])_([^_\n]+?)_(?![\w_]))/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) spans.push({ text: text.slice(last, m.index) });
        if (m[2] !== undefined) spans.push({ text: m[2], bold: true });
        else if (m[3] !== undefined) spans.push({ text: m[3], code: true });
        else spans.push({ text: (m[4] ?? m[5]) as string, italic: true });
        last = m.index + m[0].length;
    }
    if (last < text.length) spans.push({ text: text.slice(last) });
    return spans.filter((s) => s.text.length > 0);
}

/** The text with emphasis markers removed. */
export function plainText(text: string): string {
    return inlineSpans(text).map((s) => s.text).join('');
}

function speakerName(raw: string | undefined, speakerId: string | undefined, labels: Record<string, string>, selfName?: string): string {
    const src = (speakerId || raw || '').toLowerCase();
    const id = /^(user|me)$/.test(src)
        ? 'me'
        : /^(interviewer|them|other|system|assistant)$/.test(src)
            ? 'speaker_1'
            : src.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
    if (labels[id]) return labels[id];
    if (id === 'me') return selfName || 'Me';
    if (id === 'speaker_1') return 'Speaker 1';
    const voice = /^speaker_(\d+)$/.exec(id);
    if (voice) return `Speaker ${voice[1]}`;
    return raw || 'Speaker';
}

function formatDate(iso: string, locale: string, timeZone?: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    try {
        return d.toLocaleDateString(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', ...(timeZone ? { timeZone } : {}) });
    } catch {
        return d.toISOString().slice(0, 10);
    }
}

function durationLabel(raw: unknown): string | undefined {
    const m = /^(\d+):(\d{2})$/.exec(String(raw ?? ''));
    if (!m) return undefined;
    const minutes = Number(m[1]);
    if (minutes <= 0) return undefined;
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** "1:02:03" or "2:03" from the start of the meeting. */
export function formatOffset(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function buildNotesDocument(meeting: MeetingLike, opts: BuildNotesOptions = {}): NotesDocument {
    const d = meeting.detailedSummary && typeof meeting.detailedSummary === 'object' ? meeting.detailedSummary : {};
    const sections: NotesSection[] = [];
    const actionItems: NotesActionItem[] = [];

    if (d.schemaVersion === 3) {
        const tldr = (Array.isArray(d.tldr) ? d.tldr : []).map(clean).filter(Boolean);
        const v3 = Array.isArray(d.sectionsV3) ? [...d.sectionsV3] : [];
        const ownSummary = v3.some((s: any) => SUMMARY_TITLE.test(clean(s?.title)) && Array.isArray(s?.bullets) && s.bullets.length > 0);
        if (!ownSummary && tldr.length) sections.push({ heading: 'Summary', bullets: tldr });
        else if (!ownSummary && clean(d.overview)) sections.push({ heading: 'Summary', paragraph: clean(d.overview), bullets: [] });
        v3.sort((a: any, b: any) => (a?.order ?? 0) - (b?.order ?? 0));
        for (const s of v3) {
            const heading = clean(s?.title);
            if (!heading || NEXT_STEPS_TITLE.test(heading)) continue;
            // Notes without a template end with their action items as a section
            // (MeetingSummaryReducer); the export lists them itself, below.
            if (s?.id === 'auto_action_items') continue;
            const bullets = (Array.isArray(s.bullets) ? s.bullets : [])
                .map((b: any) => clean(typeof b === 'string' ? b : b?.text))
                .filter(Boolean);
            if (bullets.length) sections.push({ heading, bullets });
        }
        // No template (no mode active, none picked in the notepad): the decisions stand in for
        // the template's sections, as on the meeting page and in the notepad (fallbackNoteSections).
        // The action items follow below either way.
        const templated = v3.some((s: any) => Array.isArray(s?.bullets) && s.bullets.length > 0);
        const decisions = (Array.isArray(d.decisions) ? d.decisions : []).map((x: any) => clean(typeof x === 'string' ? x : x?.text)).filter(Boolean);
        if (!templated && decisions.length) sections.push({ heading: 'Decisions', bullets: decisions });
        const items = Array.isArray(d.actionItemsV3) && d.actionItemsV3.length
            ? d.actionItemsV3
            : (Array.isArray(d.actionItemsStructured) ? d.actionItemsStructured : []);
        for (const a of items) {
            const text = clean(a?.text);
            if (!text) continue;
            actionItems.push({
                text,
                ...(clean(a.owner) ? { owner: clean(a.owner) } : {}),
                ...(clean(a.deadline) ? { deadline: clean(a.deadline) } : {}),
                done: a.status === 'done',
            });
        }
    } else {
        const overview = clean(d.overview) || clean(meeting.summary);
        if (overview) sections.push({ heading: 'Summary', paragraph: overview, bullets: [] });
        const keyPoints = (Array.isArray(d.keyPoints) ? d.keyPoints : []).map(clean).filter(Boolean);
        if (keyPoints.length) sections.push({ heading: clean(d.keyPointsTitle) || 'Key points', bullets: keyPoints });
        for (const s of Array.isArray(d.sections) ? d.sections : []) {
            const heading = clean(s?.title);
            const bullets = (Array.isArray(s?.bullets) ? s.bullets : []).map(clean).filter(Boolean);
            if (heading && bullets.length && !NEXT_STEPS_TITLE.test(heading)) sections.push({ heading, bullets });
        }
        for (const a of Array.isArray(d.actionItems) ? d.actionItems : []) {
            const text = clean(a);
            if (text) actionItems.push({ text, done: false });
        }
    }

    const labels: Record<string, string> = d.speakerLabels && typeof d.speakerLabels === 'object' ? d.speakerLabels : {};
    const rows = Array.isArray(meeting.transcript) ? meeting.transcript : [];
    const times = rows.map((r) => r?.timestamp).filter((t): t is number => typeof t === 'number' && t > 0);
    const start = times.length ? Math.min(...times) : 0;
    const transcript: NotesTranscriptLine[] = rows
        .filter((r) => clean(r?.text))
        .map((r) => ({
            speaker: speakerName(r.speaker, r.speakerId, labels, opts.selfName),
            text: clean(r.text),
            offsetMs: typeof r.timestamp === 'number' && r.timestamp > 0 && start ? r.timestamp - start : 0,
        }));

    const seen = new Set<string>();
    const attendees: NotesAttendee[] = [];
    for (const a of meeting.calendarEvent?.attendees || []) {
        const email = clean(a?.email).toLowerCase();
        if (!email || seen.has(email)) continue;
        seen.add(email);
        attendees.push({ email, ...(clean(a?.name) ? { name: clean(a?.name) } : {}) });
    }

    const dateIso = clean(meeting.date) || new Date(0).toISOString();
    return {
        meetingId: meeting.id,
        title: plainTitle(meeting.title),
        dateIso,
        dateLabel: formatDate(dateIso, opts.locale || 'en-US', opts.timeZone),
        ...(durationLabel(meeting.duration) ? { durationLabel: durationLabel(meeting.duration) } : {}),
        attendees,
        participants: (Array.isArray(d.callParticipants) ? d.callParticipants : []).map(clean).filter(Boolean),
        sections,
        actionItems,
        transcript,
        ...(clean(meeting.userNotes) ? { userNotes: clean(meeting.userNotes) } : {}),
    };
}

/** "Owner: text (by Friday)", the one-line form every text output uses. */
export function actionItemLine(a: NotesActionItem): string {
    return `${a.owner ? `${a.owner}: ` : ''}${plainText(a.text)}${a.deadline ? ` (by ${a.deadline})` : ''}`;
}

/** The notes as Markdown: CRM note bodies (Attio takes Markdown) and the MCP server. */
export function notesToMarkdown(doc: NotesDocument, opts: { includeTitle?: boolean; includeActionItems?: boolean } = {}): string {
    const out: string[] = [];
    if (opts.includeTitle !== false) {
        out.push(`# ${doc.title}`);
        out.push([doc.dateLabel, doc.durationLabel].filter(Boolean).join(' · '));
    }
    for (const s of doc.sections) {
        out.push(`## ${s.heading}`);
        if (s.paragraph) out.push(s.paragraph);
        if (s.bullets.length) out.push(s.bullets.map((b) => `- ${b}`).join('\n'));
    }
    if (opts.includeActionItems !== false && doc.actionItems.length) {
        out.push('## Action items');
        out.push(doc.actionItems.map((a) => `- [${a.done ? 'x' : ' '}] ${actionItemLine(a)}`).join('\n'));
    }
    return out.filter((p) => p.trim()).join('\n\n');
}

/** The notes as plain text, no markup at all (HubSpot / Affinity note bodies). */
export function notesToPlainText(doc: NotesDocument): string {
    const out: string[] = [doc.title, [doc.dateLabel, doc.durationLabel].filter(Boolean).join(' · ')];
    for (const s of doc.sections) {
        out.push(s.heading);
        if (s.paragraph) out.push(plainText(s.paragraph));
        if (s.bullets.length) out.push(s.bullets.map((b) => `• ${plainText(b)}`).join('\n'));
    }
    if (doc.actionItems.length) {
        out.push('Action items');
        out.push(doc.actionItems.map((a) => `${a.done ? '☑' : '☐'} ${actionItemLine(a)}`).join('\n'));
    }
    return out.filter((p) => p.trim()).join('\n\n');
}

export function transcriptToText(lines: NotesTranscriptLine[]): string {
    return lines.map((l) => `[${formatOffset(l.offsetMs)}] ${l.speaker}: ${l.text}`).join('\n');
}
