/**
 * What a Zoom or Teams window says about the call besides who is speaking:
 * how many are in it, the user's own name there, and which meeting it is
 * (its ID or join link, when the app has it on screen). Read-only: these come
 * from the tree the reader already polls (call_tree.rs); nothing opens a
 * panel or copies an invite to find them. A fact the window doesn't show is
 * null, and the session does without it.
 *
 *   meetingKey        meetingLinks key: `zoom:<9-11 digits>` or
 *                     `teams-id:<9-20 digits>` (or a Teams thread key from a
 *                     join link). From a labelled "Meeting ID" (Zoom's
 *                     meeting information, Teams' meeting info pane, an old
 *                     Zoom window title), or a link the app labels as the
 *                     meeting's invite / join link. A link in the chat is
 *                     never read as the meeting.
 *   participantCount  the app's own count ("Participants (5)", "5
 *                     participants"), the user included. A capped count
 *                     ("99+") is null.
 *   selfName          the name the app tags as the user's ("(me)", "(You)").
 *
 * Pure: platform-free; the tests replay trees.
 *
 * UNVERIFIED (2026-10-15): label wording from the apps' published UI, not a
 * recorded tree. Check on a real call per app and OS (NATIVELY_DUMP_CALL_TREE=1).
 */
import { meetingRefOf } from './meetingLinks';
import type { CallTree, CallTreeNode, DesktopCallApp, SolvedCall } from './callTreeSolvers';

export interface CallFacts {
    meetingKey: string | null;
    participantCount: number | null;
    selfName: string | null;
    /** The other people the window names (callTreeSolvers), for the roster. */
    participants: string[];
    /**
     * Whether the app itself is recording the call (Zoom's "Recording…" /
     * "Computer recording" indicator, Teams' "Recording has started" banner),
     * read from the window like every other fact. null when the tree shows
     * nothing either way. Read-only; Natively never starts or stops it.
     */
    recording: boolean | null;
}

// Zoom: the top-bar recording button / indicator ("Recording...", "Computer
// recording", "Smart recording", "This meeting is being recorded"). Teams: the
// recording banner ("Recording has started", "Recording and transcription have
// started", "This meeting is being recorded"). Localised variants as found in
// the apps' published UI; UNVERIFIED against live trees, like the other facts.
const RECORDING_ON = /(?:^|\b)(?:(?:computer|cloud|smart|local) recording|recording(?: and transcription)? (?:has|have) started|this (?:meeting|call) is being recorded|recording in progress|recording\.{2,3}|\brecording\b(?!\s+(?:stopped|off|disabled|unavailable)))/i;
const RECORDING_OFF = /recording (?:stopped|has stopped|paused|is paused|ended)|stop(?:ped)? recording|not recording/i;

/** True when the window shows the call being recorded, false when it shows it stopped, null when neither. */
export function recordingFromTree(tree: CallTree | null | undefined): boolean | null {
    if (!tree?.trusted) return null;
    let on = false;
    let off = false;
    for (const w of tree.windows) {
        for (const node of w.nodes) {
            if (isChatContainer(node)) continue;
            for (const t of fields(node)) {
                if (t.length > 160) continue;
                if (RECORDING_OFF.test(t)) off = true;
                else if (RECORDING_ON.test(t)) on = true;
            }
        }
    }
    if (on) return true;
    if (off) return false;
    return null;
}

const MEETING_ID_LABEL = '(?:meeting id|meeting-id|meeting number|webinar id|besprechungs-id|id de (?:la )?réunion|id de (?:la )?reunión|id da reunião|id riunione|id della riunione|vergader-id|mötes-id|id rapat|ミーティングid|会议\\s*id|會議\\s*id|회의\\s*id)';
const ID_INLINE = new RegExp(`${MEETING_ID_LABEL}\\s*[:：]?\\s*(\\d[\\d \\u00a0.-]{7,32}\\d)`, 'i');
const ID_LABEL_ONLY = new RegExp(`^${MEETING_ID_LABEL}\\s*[:：]?$`, 'i');
const DIGITS_ONLY = /^\d[\d  .-]{7,32}\d$/;
// A link the app labels as the meeting's own (not a link someone posted in the chat).
const MEETING_LINK_LABEL = /\b(?:invite link|invitation link|join link|meeting link|link to (?:join|this meeting|the meeting)|join url|meeting url|copy (?:invite )?link)\b/i;
const MEETING_LINK_ID = /join[_-]?link|invite[_-]?link|meeting[_-]?link/i;

const COUNT_WORDS = '(?:participants?|people|attendees|in this meeting|in the meeting|in this call|teilnehmer|teilnehmende|participantes|partecipanti|deelnemers|deltagare|peserta|参加者|参与者|參與者|참가자)';
const COUNT_AFTER = new RegExp(`^${COUNT_WORDS}\\s*(?:[(（]\\s*(\\d{1,4})(\\+?)\\s*[)）]|[:,·•-]\\s*(\\d{1,4})(\\+?))$`, 'i');
const COUNT_BEFORE = new RegExp(`^(\\d{1,4})(\\+?)\\s+${COUNT_WORDS}(?:\\s+in (?:this|the) (?:meeting|call))?$`, 'i');

function idKey(app: DesktopCallApp, raw: string): string | null {
    const digits = raw.replace(/[\s .-]/g, '');
    if (app === 'zoom') return /^\d{9,11}$/.test(digits) ? `zoom:${digits}` : null;
    return /^\d{9,20}$/.test(digits) ? `teams-id:${digits}` : null;
}

function linkKey(app: DesktopCallApp, url: string): string | null {
    const ref = meetingRefOf(url);
    if (!ref) return null;
    if (app === 'zoom' && ref.provider === 'zoom' && ref.key.startsWith('zoom:')) return ref.key;
    if (app === 'teams' && ref.provider === 'teams') return ref.key;
    return null;
}

const fields = (n: CallTreeNode) => [n.name, n.description, n.value].map((f) => (f ?? '').trim()).filter(Boolean);
const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"']+/gi;

// Chat is never the meeting: a pasted invite names another call. A chat
// window, or a chat pane / message list inside the call window, is skipped
// whole (its subtree, by depth), and an ID counts only on a short line of its
// own, the way the app's meeting information shows it, never mid-sentence.
const CHAT_WINDOW = /\b(?:chat|conversation|messages?)\b/i;
const CHAT_CONTAINER = /\b(?:chat|in-meeting chat|meeting chat|message list|messages|conversation|chat history|comments?)\b/i;
const CONTAINER_ROLE = /list|group|pane|table|scroll|document|region|section|feed|log|outline|tree|custom/i;
const MAX_ID_LINE = 60;

function isChatContainer(node: CallTreeNode): boolean {
    if (!CONTAINER_ROLE.test(node.role)) return false;
    return CHAT_CONTAINER.test(node.name) || CHAT_CONTAINER.test(node.id) || CHAT_CONTAINER.test(node.description);
}

/** The meeting the window shows, or null. Labelled IDs first, then labelled links. */
export function meetingKeyFromTree(app: DesktopCallApp, tree: CallTree | null | undefined): string | null {
    if (!tree || !tree.trusted) return null;
    let fromLink: string | null = null;
    for (const window of tree.windows) {
        if (CHAT_WINDOW.test(window.title) && !ID_INLINE.test(window.title)) continue;
        const inTitle = ID_INLINE.exec(window.title);
        const titleKey = inTitle ? idKey(app, inTitle[1]) : null;
        if (titleKey) return titleKey;
        const nodes = window.nodes;
        let chatDepth = -1;
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            if (chatDepth >= 0) {
                if (node.depth > chatDepth) continue;
                chatDepth = -1;
            }
            if (isChatContainer(node)) {
                chatDepth = node.depth;
                continue;
            }
            const texts = fields(node);
            for (const t of texts) {
                if (t.length > MAX_ID_LINE) continue;
                const m = ID_INLINE.exec(t);
                const key = m ? idKey(app, m[1]) : null;
                if (key) return key;
            }
            // "Meeting ID" in one node, the number in the next one or two.
            if (texts.some((t) => ID_LABEL_ONLY.test(t))) {
                for (let j = i + 1; j < Math.min(nodes.length, i + 4); j++) {
                    if (isChatContainer(nodes[j])) break;
                    const number = fields(nodes[j]).find((t) => DIGITS_ONLY.test(t));
                    const key = number ? idKey(app, number) : null;
                    if (key) return key;
                }
            }
            if (fromLink) continue;
            const labelled = MEETING_LINK_ID.test(node.id) || texts.some((t) => MEETING_LINK_LABEL.test(t));
            if (!labelled) continue;
            const candidates = [node.url ?? '', ...texts.flatMap((t) => t.match(URL_IN_TEXT) ?? [])];
            // The address is often the next node ("Invite link" then the URL).
            for (let j = i + 1; j < Math.min(nodes.length, i + 3); j++) {
                if (isChatContainer(nodes[j])) break;
                candidates.push(nodes[j].url ?? '', ...fields(nodes[j]).flatMap((t) => t.match(URL_IN_TEXT) ?? []));
            }
            for (const url of candidates) {
                const key = url ? linkKey(app, url.replace(/[)\].,;:!?]+$/, '')) : null;
                if (key) {
                    fromLink = key;
                    break;
                }
            }
        }
    }
    return fromLink;
}

/** The app's own head count, the user included; null when it shows none or a capped one. */
export function participantCountFromTree(tree: CallTree | null | undefined): number | null {
    if (!tree || !tree.trusted) return null;
    let best: number | null = null;
    let capped = false;
    for (const window of tree.windows) {
        for (const node of window.nodes) {
            for (const t of fields(node)) {
                const after = COUNT_AFTER.exec(t);
                const before = after ? null : COUNT_BEFORE.exec(t);
                const n = after ? Number(after[1] ?? after[3]) : before ? Number(before[1]) : NaN;
                const plus = after ? (after[2] ?? after[4]) === '+' : before ? before[2] === '+' : false;
                if (!Number.isFinite(n) || n < 1) continue;
                if (plus) {
                    capped = true;
                    continue;
                }
                best = best === null ? n : Math.max(best, n);
            }
        }
    }
    return capped && best === null ? null : best;
}

/** Everything above for one read; `solved` is that read's solveCallTree result. */
export function readCallFacts(app: DesktopCallApp, tree: CallTree | null | undefined, solved: SolvedCall): CallFacts {
    return {
        meetingKey: meetingKeyFromTree(app, tree),
        participantCount: participantCountFromTree(tree),
        selfName: solved.selfNames[0] ?? null,
        participants: solved.people.map((p) => p.name),
        recording: recordingFromTree(tree),
    };
}
