/**
 * Which meeting a link joins, as one comparable key.
 *
 * A calendar event carries its join link (Google's hangoutLink, a Zoom or
 * Teams add-on's conference entry point, or a URL pasted in the location or
 * description), and the browser tab the user is in has one too. When both
 * name the same meeting, the session is that event for certain, however many
 * other events overlap it in time (calendarSessionMatch.ts).
 *
 * Keys carry no password or tracking parameter: `zoom:81234567890`, never the
 * `pwd=`. The Companion extension computes them itself and sends only the key
 * (natively-browser/src/meeting-tabs.ts imports this file), so a meeting tab's
 * full address never leaves the browser.
 *
 * Pure: no Node or browser API beyond URL, so both builds and the tests run it.
 */

export type MeetingProvider = 'meet' | 'zoom' | 'teams' | 'webex';

export interface MeetingRef {
    provider: MeetingProvider;
    /** Provider-prefixed and normalized, e.g. `meet:abc-defg-hij`. Compare these. */
    key: string;
}

/** Hosts whose pages can be a meeting. A tab on any other host is never reported. */
const MEET_HOSTS = ['meet.google.com'];
const ZOOM_DOMAINS = ['zoom.us', 'zoomgov.com'];
const TEAMS_DOMAINS = ['teams.microsoft.com', 'teams.live.com', 'teams.cloud.microsoft', 'teams.microsoft.us'];
const WEBEX_DOMAINS = ['webex.com'];

const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

export function providerOfHost(hostname: string): MeetingProvider | null {
    const host = hostname.toLowerCase().replace(/\.$/, '');
    if (MEET_HOSTS.includes(host)) return 'meet';
    if (ZOOM_DOMAINS.some((d) => onDomain(host, d))) return 'zoom';
    if (TEAMS_DOMAINS.some((d) => onDomain(host, d))) return 'teams';
    if (WEBEX_DOMAINS.some((d) => onDomain(host, d))) return 'webex';
    return null;
}

const MEET_CODE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
const ZOOM_ID = /^\d{9,11}$/;
// A Teams meeting's thread: the same in a join link (URL-encoded, in the path)
// and in the web app while in the call (decoded, often after the #).
const TEAMS_THREAD = /19:meeting_[A-Za-z0-9_\-+=/]+?@thread\.v2/;

function safeDecode(s: string): string {
    try {
        return decodeURIComponent(s);
    } catch {
        return s;
    }
}

/** The meeting a single URL joins, or null for anything else (a Meet home page, a Zoom profile). */
export function meetingRefOf(raw: string): MeetingRef | null {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) return null;
    let url: URL;
    try {
        url = new URL(raw.trim());
    } catch {
        return null;
    }

    // zoommtg://zoom.us/join?confno=… is what Zoom writes into some invites' location.
    if (url.protocol === 'zoommtg:' || url.protocol === 'zoomus:') {
        const confno = url.searchParams.get('confno')?.replace(/\s+/g, '') ?? '';
        return ZOOM_ID.test(confno) ? { provider: 'zoom', key: `zoom:${confno}` } : null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

    const provider = providerOfHost(url.hostname);
    if (!provider) return null;
    const segs = url.pathname.split('/').filter(Boolean).map(safeDecode);

    switch (provider) {
        case 'meet': {
            const code = (segs[0] ?? '').toLowerCase();
            return MEET_CODE.test(code) ? { provider, key: `meet:${code}` } : null;
        }
        case 'zoom': {
            const [kind, a, b] = segs;
            // /j/<id> join, /s/<id> start, /w/<id> webinar, /wc/<id>/join and
            // /wc/join/<id> the web client, /my/<name> a personal room.
            if ((kind === 'j' || kind === 's' || kind === 'w') && ZOOM_ID.test(a ?? '')) return { provider, key: `zoom:${a}` };
            if (kind === 'wc') {
                if (ZOOM_ID.test(a ?? '')) return { provider, key: `zoom:${a}` };
                if (a === 'join' && ZOOM_ID.test(b ?? '')) return { provider, key: `zoom:${b}` };
            }
            if (kind === 'my' && a && /^[a-z0-9._-]{1,64}$/i.test(a)) return { provider, key: `zoom-my:${a.toLowerCase()}` };
            const confno = url.searchParams.get('confno')?.replace(/\s+/g, '') ?? '';
            if (ZOOM_ID.test(confno)) return { provider, key: `zoom:${confno}` };
            return null;
        }
        case 'teams': {
            const thread = safeDecode(`${url.pathname}${url.search}${url.hash}`).match(TEAMS_THREAD);
            if (thread) return { provider, key: `teams:${thread[0]}` };
            // The short join links (teams.microsoft.com/meet/<id>, teams.live.com/meet/<id>).
            if (segs[0] === 'meet' && /^\d{9,16}$/.test(segs[1] ?? '')) return { provider, key: `teams-id:${segs[1]}` };
            return null;
        }
        case 'webex': {
            const mtid = url.searchParams.get('MTID') ?? url.searchParams.get('mtid');
            if (mtid && /^[A-Za-z0-9]{8,64}$/.test(mtid)) return { provider, key: `webex-mtid:${mtid}` };
            // A personal room: <site>.webex.com/meet/<name> (or /join/<name>).
            const i = segs.findIndex((s) => s === 'meet' || s === 'join');
            const name = i >= 0 ? segs[i + 1] : undefined;
            if (name && /^[a-z0-9._-]{1,64}$/i.test(name)) return { provider, key: `webex:${url.hostname.toLowerCase()}/${name.toLowerCase()}` };
            return null;
        }
    }
}

// What a key looks like per provider, for keys that arrive from outside the
// app (the Companion extension computes its own; a malformed one is dropped).
const KEY_SHAPES: Array<[RegExp, MeetingProvider]> = [
    [/^meet:[a-z]{3}-[a-z]{4}-[a-z]{3}$/, 'meet'],
    [/^zoom:\d{9,11}$/, 'zoom'],
    [/^zoom-my:[a-z0-9._-]{1,64}$/, 'zoom'],
    [/^teams:19:meeting_[A-Za-z0-9_\-+=/]{1,200}@thread\.v2$/, 'teams'],
    [/^teams-id:\d{9,16}$/, 'teams'],
    [/^webex:[a-z0-9.-]{1,100}\/[a-z0-9._-]{1,64}$/, 'webex'],
    [/^webex-mtid:[A-Za-z0-9]{8,64}$/, 'webex'],
];

/** The provider of a well-formed key, or null for anything that is not one. */
export function providerOfKey(key: unknown): MeetingProvider | null {
    if (typeof key !== 'string' || key.length > 260) return null;
    for (const [shape, provider] of KEY_SHAPES) if (shape.test(key)) return provider;
    return null;
}

// Candidate URLs in free text (an event's location or HTML description). The
// character class stops at whitespace, quotes and angle brackets; trailing
// punctuation and HTML entities are trimmed after.
const URL_IN_TEXT = /\b(?:https?|zoommtg|zoomus):\/\/[^\s<>"'`]+/gi;

/** Every distinct meeting joined by a URL in `text`, with the URL as written, in order of appearance. */
export function meetingLinksIn(text: string | undefined | null): Array<{ url: string; ref: MeetingRef }> {
    if (typeof text !== 'string' || text.length === 0) return [];
    const out: Array<{ url: string; ref: MeetingRef }> = [];
    const seen = new Set<string>();
    for (const m of text.slice(0, 200_000).matchAll(URL_IN_TEXT)) {
        const url = m[0].replace(/&amp;/g, '&').replace(/[)\].,;:!?]+$/, '');
        const ref = meetingRefOf(url);
        if (ref && !seen.has(ref.key)) {
            seen.add(ref.key);
            out.push({ url, ref });
        }
    }
    return out;
}

/** Every distinct meeting joined by a URL in `text`, in order of appearance. */
export function meetingRefsIn(text: string | undefined | null): MeetingRef[] {
    return meetingLinksIn(text).map((l) => l.ref);
}
