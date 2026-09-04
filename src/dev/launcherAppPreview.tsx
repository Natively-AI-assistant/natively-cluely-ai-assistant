// DEV-ONLY preview that renders the REAL <Launcher> (and therefore the real
// <MeetingDetails>) against a stubbed window.electronAPI, so the list ⇄
// meeting-notes transition on screen is the app's own code path rather than a
// mirror of it. Not shipped — vite's build input is index.html alone.
//
// The stub only has to satisfy the calls Launcher/MeetingDetails make on mount;
// everything is optional-chained in the components, so anything missing is a
// no-op rather than a crash.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';

const now = Date.now();
const iso = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();

const MEETINGS = [
    { id: 'm1', title: 'Weekly sync — engineering', mins: 45 },
    { id: 'm2', title: 'Design review: launcher transitions', mins: 180 },
    { id: 'm3', title: 'Customer call — Northwind', mins: 320 },
    { id: 'm4', title: '1:1 with Priya', mins: 1500 },
    { id: 'm5', title: 'Roadmap planning Q4', mins: 1600 },
    { id: 'm6', title: 'Incident retro — audio pipeline', mins: 2900 },
].map((m, i) => ({
    id: m.id,
    title: m.title,
    date: iso(m.mins),
    duration: `${18 + i * 7}:${String((i * 13) % 60).padStart(2, '0')}`,
    summary: 'Short summary line shown in the list row.',
    detailedSummary: {
        schemaVersion: 3,
        tldr: [
            'The launcher ⇄ meeting-notes navigation had no real transition and read as a blink.',
            'PR #511 replaces it with a cover/uncover model: the notes panel is always the upper layer.',
        ],
        keyPoints: [
            'Details slides in 24px from the right and fades over 200ms.',
            'The list never moves laterally — it recedes by scaling up to 1.03.',
            'Scaling up rather than down keeps the clip box from uncovering a window edge.',
        ],
        actionItems: [
            'Merge PR #511 and rebuild the renderer.',
            'Check the reduced-motion branch with the OS setting enabled.',
        ],
        overview:
            'Moving between the launcher list and a meeting’s notes previously used a single ' +
            'AnimatePresence mode="wait" doing a 0.15s opacity-only fade. Because mode="wait" ' +
            'serialises the two fades, the old panel dissolved to nothing, a dead gap followed, and ' +
            'only then did the new one fade up — no direction and no continuity. The replacement ' +
            'keeps both layers mounted so one genuinely covers the other.',
    },
    transcript: Array.from({ length: 8 }, (_, k) => ({
        speaker: k % 2 === 0 ? 'You' : 'Priya',
        text: 'Transcript line ' + (k + 1) + ' — rendered by the real MeetingDetails component.',
        timestamp: k * 27,
    })),
    usage: [],
}));

// The state the app is in for the ~30-60s after a meeting ends: the placeholder
// row is saved, the notes are still being written. Held at 'chunking' so the
// skeleton stays up for as long as you look at it.
MEETINGS.unshift({
    id: 'm0',
    title: 'Processing...',
    date: iso(1),
    duration: '32:14',
    summary: 'Generating summary...',
    detailedSummary: { actionItems: [], keyPoints: [] },
    transcript: Array.from({ length: 6 }, (_, k) => ({
        speaker: k % 2 === 0 ? 'You' : 'Priya',
        text: 'Transcript line ' + (k + 1) + ' — saved before the summary is generated.',
        timestamp: k * 31,
    })),
    usage: [],
    summaryStatus: 'chunking',
} as unknown as (typeof MEETINGS)[number]);

// Generation failed with nothing to fall back on — the terminal state the
// skeleton must NOT shimmer into forever.
MEETINGS.splice(1, 0, {
    id: 'm0f',
    title: 'Vendor call — Contoso',
    date: iso(140),
    duration: '12:40',
    summary: '',
    detailedSummary: { actionItems: [], keyPoints: [] },
    transcript: Array.from({ length: 5 }, (_, k) => ({
        speaker: k % 2 === 0 ? 'You' : 'Sam',
        text: 'Transcript line ' + (k + 1) + ' — kept even though the summary failed.',
        timestamp: k * 24,
    })),
    usage: [],
    summaryStatus: 'failed',
} as unknown as (typeof MEETINGS)[number]);

// Starts generating, then FAILS 8s in — the live generating → failed handoff,
// which is the transition the status allow-list exists for.
MEETINGS.splice(2, 0, {
    id: 'm0x',
    title: 'Processing...',
    date: iso(200),
    duration: '08:02',
    summary: 'Generating summary...',
    detailedSummary: { actionItems: [], keyPoints: [] },
    transcript: Array.from({ length: 5 }, (_, k) => ({
        speaker: k % 2 === 0 ? 'You' : 'Ana',
        text: 'Transcript line ' + (k + 1) + ' — kept when generation dies.',
        timestamp: k * 19,
    })),
    usage: [],
    summaryStatus: 'reducing',
} as unknown as (typeof MEETINGS)[number]);

// A LEGACY (schema v2) note: no tldr, no sectionsV3, no follow-up. Only the title
// and overview take the cascade; actionItems/keyPoints render through
// EditableTextBlock and must stay untouched — wrapping words inside an editable
// field would break caret, selection and save.
MEETINGS.splice(3, 0, {
    id: 'm0legacy',
    title: 'Budget review — legacy note',
    date: iso(600),
    duration: '24:10',
    summary: 'A pre-V3 meeting note.',
    detailedSummary: {
        overview: 'A legacy note stored before the V3 schema existed: an overview blob plus two flat lists, with no sections and no follow-up draft.',
        actionItems: ['Send the revised figures to Ana.', 'Book the follow-up for Thursday.'],
        keyPoints: ['Q4 spend is tracking 8% under plan.', 'Headcount stays flat until the ledger migration lands.'],
    },
    transcript: Array.from({ length: 4 }, (_, k) => ({
        speaker: k % 2 === 0 ? 'You' : 'Ana',
        text: 'Legacy transcript line ' + (k + 1) + '.',
        timestamp: k * 22,
    })),
    usage: [],
    summaryStatus: 'completed',
} as unknown as (typeof MEETINGS)[number]);

const BOOT_MS = Date.now();

// What m0 becomes once generation lands.
const FINISHED_M0 = {
    title: 'Standup — payments squad',
    summary: 'See detailed summary',
    summaryStatus: 'completed',
    detailedSummary: {
        schemaVersion: 3,
        overview:
            'The squad walked the reconciliation backlog, agreed the retry window is the ' +
            'actual cause of the duplicate-charge reports, and moved the ledger migration ' +
            'behind a flag so it can ship without blocking the release train.',
        tldr: [
            'Duplicate charges trace to the 90s retry window, not the gateway.',
            'The ledger migration ships behind a flag this week.',
            'Reconciliation backlog is down to 400 rows from 12k.',
        ],
        sectionsV3: [
            {
                id: 's1',
                title: 'Decisions',
                bullets: [
                    { id: 'b1', text: 'Shorten the retry window to 20s and re-measure over a full day.' },
                    { id: 'b2', text: 'Ship the ledger migration behind payments_ledger_v2, default off.' },
                    { id: 'b3', text: 'Hold the gateway upgrade until reconciliation is at zero.' },
                ],
            },
            {
                id: 's2',
                title: 'Open questions',
                bullets: [
                    { id: 'b4', text: 'Who owns the backfill once the flag flips on?' },
                    { id: 'b5', text: 'Does the 20s window break the partner SLA?' },
                ],
            },
        ],
        actionItems: [],
        keyPoints: [],
        followUpDraft: {
            subject: 'Payments standup — retry window + ledger flag',
            body: 'Quick recap from this morning:\n\n' +
                '- The duplicate charges come from the 90s retry window; we are cutting it to 20s and re-measuring.\n' +
                '- The ledger migration ships behind payments_ledger_v2 (default off) so it does not block the release.\n' +
                '- Reconciliation is down to ~400 rows.\n\nOpen: backfill ownership, and whether 20s breaks the partner SLA.',
            tone: 'professional',
        },
    },
};

const noop = async () => undefined;

// A plain object, deliberately not a Proxy: the components read non-function
// properties too (platformUtils does `electronAPI?.platform.startsWith(...)` at
// module scope), so a catch-all that hands back a function breaks the app
// before it paints. Everything the components call is optional-chained, so any
// method missing here is simply a no-op.
const stub = {
    platform: 'darwin',
    getRecentMeetings: async () => MEETINGS,
    getMeetingDetails: async (id: string) => {
        // m0 finishes generating 8s after load, so opening it shows the whole arc:
        // skeleton → live status → the notes swapping in. MeetingDetails polls
        // getMeetingDetails while the status is in-progress, which is what picks
        // this up; nothing here has to push.
        if (id === 'm0' && Date.now() - BOOT_MS > 8_000) {
            return { ...MEETINGS[0], ...FINISHED_M0 };
        }
        // m0x dies instead of finishing: status flips to 'failed' with the
        // placeholder summary still empty, exactly as the hard-failure catch in
        // MeetingPersistence leaves it (and with no broadcast, so only the poll
        // sees it).
        if (id === 'm0x' && Date.now() - BOOT_MS > 8_000) {
            const m = MEETINGS.find(x => x.id === 'm0x');
            // Mirrors DatabaseManager.markSummaryGenerationFailed: the placeholder
            // title and blurb are cleared alongside the failed status, so the notes
            // screen is not left saying "Notes couldn't be generated" underneath a
            // heading that reads "Processing...".
            return { ...m, title: 'Untitled Session', summary: '', summaryStatus: 'failed' };
        }
        return MEETINGS.find(m => m.id === id) ?? null;
    },
    getUpcomingEvents: async () => [],
    onboardingGetFlags: async () => ({}),
    onboardingSetFlag: noop,
    getSetting: async () => null,
    setSetting: noop,
    calendarRefresh: noop,
    // Pinned so the preview sits in the app's normal resting state: without
    // these the catch-all makes them truthy and you get the "Meeting ongoing"
    // pill and the undetectable dashed border, which are stub artefacts.
    getMeetingActive: async () => false,
    getUndetectable: async () => true,
    seedDemo: noop,
    searchGlobalMeetings: async () => ({ enabled: false, results: [] }),
};

// Effects DO call methods that are not optional-chained (ConnectCalendarButton
// does `window.electronAPI.getCalendarStatus()`, useShortcuts does
// `.onKeybindsUpdate()`), and their return values get awaited, called as
// unsubscribe handles, and iterated. So the fallback has to be all three at
// once: callable, thenable, and object-like when resolved.
//
// `resolved` deliberately has NO `then`, or awaiting it would recurse forever.
const resolved: any = new Proxy({}, {
    get: (_t, k) =>
        k === 'then' ? undefined
        : k === 'forEach' ? () => {}
        : k === 'map' || k === 'filter' ? () => []
        : k === Symbol.iterator ? function* () {}
        : undefined,
});
const anyFn: any = new Proxy(function () {}, {
    apply: () => anyFn,                                  // unsub() / destroy()
    // `.then(cb)` must return the chainable, not cb's result, or the very
    // common `getX().then(...).catch(...)` blows up on the .catch.
    get: (_t, k) =>
        k === 'then'
            ? (res: any) => { try { res?.(resolved); } catch { /* ignore */ } return anyFn; }
            : anyFn,
});

// The proxy sits *over* the object above rather than replacing it, so real data
// properties like `platform` still read as data.
const api = new Proxy(stub as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : anyFn),
    has: () => true,
});

(window as unknown as { electronAPI: unknown }).electronAPI = api;

// Rendered only after the stub is installed — Launcher's module graph touches
// window.electronAPI during mount effects.
const { default: Launcher } = await import('../components/Launcher');

function Preview() {
    return (
        <div className="h-screen w-screen overflow-hidden">
            <Launcher
                onStartMeeting={() => {}}
                onOpenSettings={() => {}}
                onOpenProfile={() => {}}
                onOpenModes={() => {}}
                onPageChange={() => {}}
            />
        </div>
    );
}

createRoot(document.getElementById('preview-root')!).render(<Preview />);
