/**
 * Who is in a call and who spoke when, as a meeting page shows it (the
 * Companion extension reading Google Meet: the participant list and the
 * speaking indicator on each tile).
 *
 * Kept per meeting key, so a session reads the call it linked to. The user's
 * own tile never enters: the microphone channel is already "me". Speaking is
 * kept as spans; a span still open (the report stopped mid-sentence, the tab
 * closed) is closed at the last report.
 */

// ── FUTURE PLAN: names from other meeting apps (not built; judged not needed yet, 2026-09-27) ──
//
// Today only Google Meet in a browser feeds this roster (natively-browser's
// Meet reader). Every other source would report the same way,
// `report(key, [{ name, speaking }], now)`, so attribution, saving and the
// notes need no change. What each would take:
//
// 1. Zoom web client and Teams web (app.zoom.us/wc/…, teams.microsoft.com):
//    WHAT: a reader per service beside natively-browser/src/meet-dom.ts, and
//          the same optional host grant from the popup.
//    HOW:  in a live call, record the page as was done for Meet: find each
//          participant's tile, its name element, and the element that changes
//          while that person talks. Read the CHANGE, not obfuscated class names.
//          Leave out the user's own tile. Report under the tab's meeting key
//          (meetingLinks.ts already parses both services).
//    VERIFY: a fixture shaped like the measured page (as tests/meet/meet-dom.check.mjs
//          does for Meet), and a live call with two real accounts. Scripted
//          guests are refused by the services' bot checks.
//
// 2. Zoom and Teams desktop apps (no page to read):
//    WHAT: read the app's accessibility tree: the participant list and its
//          "speaking" state.
//    HOW:  native-module/src/meeting_signals.rs gains a reader. macOS uses
//          AXUIElement (cidre's `ax` feature) and needs the Accessibility
//          permission, a new prompt that must be asked for in Settings, never at
//          startup. Windows uses UI Automation (no prompt). Poll only while a
//          Natively meeting runs in that app (MeetingDetector already knows
//          which app holds the mic). Key the roster by an app-scoped key
//          ('zoom-app:<pid>'), and have the linker's callKey fall back to it.
//    VERIFY: the apps' trees change between releases. Pin the paths with a
//          recorded tree fixture per app and OS, and re-check on each app update.
//
// 3. Before either: install Zoom and Teams and confirm the detector's app
//    identities with a real call (see the note on KNOWN_APPS in meetingApps.ts).

export interface PersonReport {
    name: string;
    speaking: boolean;
}

export interface SpeakingSpan {
    name: string;
    start: number;
    end: number;
}

interface CallState {
    /** name → when first and last seen in the call */
    people: Map<string, { first: number; last: number }>;
    /** name → speaking since */
    open: Map<string, number>;
    spans: SpeakingSpan[];
    lastReport: number;
}

const MAX_PEOPLE = 100;
const MAX_SPANS = 20_000;
/** A personal room is the same key every day; older talk is dropped. */
const KEEP_MS = 6 * 60 * 60_000;

export class CallRoster {
    private calls = new Map<string, CallState>();

    /** One report from the page: everyone in the call now, and who is speaking. */
    report(key: string, people: PersonReport[], now: number): void {
        let call = this.calls.get(key);
        if (!call) {
            call = { people: new Map(), open: new Map(), spans: [], lastReport: now };
            this.calls.set(key, call);
        }
        const speaking = new Set<string>();
        for (const p of people.slice(0, MAX_PEOPLE)) {
            const seen = call.people.get(p.name);
            if (seen) seen.last = now;
            else if (call.people.size < MAX_PEOPLE) call.people.set(p.name, { first: now, last: now });
            if (p.speaking) speaking.add(p.name);
        }
        for (const [name, since] of call.open) {
            if (!speaking.has(name)) {
                this.close(call, name, since, now);
            }
        }
        for (const name of speaking) {
            if (!call.open.has(name)) call.open.set(name, now);
        }
        call.lastReport = now;
        if (call.spans.length > 0 && call.spans[0].end < now - KEEP_MS) {
            call.spans = call.spans.filter((s) => s.end >= now - KEEP_MS);
            for (const [name, seen] of call.people) if (seen.last < now - KEEP_MS) call.people.delete(name);
        }
    }

    /** The page went away (tab closed, left the call): close what is open. */
    end(key: string): void {
        const call = this.calls.get(key);
        if (!call) return;
        for (const [name, since] of call.open) this.close(call, name, since, call.lastReport);
    }

    private close(call: CallState, name: string, since: number, end: number): void {
        call.open.delete(name);
        if (end > since && call.spans.length < MAX_SPANS) call.spans.push({ name, start: since, end });
    }

    /**
     * The call between `fromMs` and `toMs`: who was in it (first seen first)
     * and the speaking spans, clipped to the window. Open spans count up to
     * the last report.
     */
    snapshot(key: string, fromMs: number, toMs: number): { participants: string[]; spans: SpeakingSpan[] } {
        const call = this.calls.get(key);
        if (!call) return { participants: [], spans: [] };
        const participants = [...call.people.entries()]
            .filter(([, seen]) => seen.last >= fromMs && seen.first <= toMs)
            .sort((a, b) => a[1].first - b[1].first)
            .map(([name]) => name);
        const all = [...call.spans, ...[...call.open].map(([name, start]) => ({ name, start, end: call.lastReport }))];
        const spans = all
            .filter((s) => s.end > fromMs && s.start < toMs)
            .map((s) => ({ name: s.name, start: Math.max(s.start, fromMs), end: Math.min(s.end, toMs) }))
            .sort((a, b) => a.start - b.start);
        return { participants, spans };
    }

    forget(key: string): void {
        this.calls.delete(key);
    }

    keys(): string[] {
        return [...this.calls.keys()];
    }
}

/**
 * The process's one roster. Kept on globalThis because the Electron build
 * bundles each file with its own copy of what it imports: the Meet reader's
 * reports (main) and the save that reads them (MeetingPersistence) must meet
 * in the same object whichever bundle they run from.
 */
const ROSTER_KEY = Symbol.for('natively.callRoster');
export const callRoster: CallRoster = ((globalThis as any)[ROSTER_KEY] ??= new CallRoster());
