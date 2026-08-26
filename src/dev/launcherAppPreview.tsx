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

const noop = async () => undefined;

// A plain object, deliberately not a Proxy: the components read non-function
// properties too (platformUtils does `electronAPI?.platform.startsWith(...)` at
// module scope), so a catch-all that hands back a function breaks the app
// before it paints. Everything the components call is optional-chained, so any
// method missing here is simply a no-op.
const stub = {
    platform: 'darwin',
    getRecentMeetings: async () => MEETINGS,
    getMeetingDetails: async (id: string) => MEETINGS.find(m => m.id === id) ?? null,
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
