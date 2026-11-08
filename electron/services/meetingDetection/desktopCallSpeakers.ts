/**
 * Who speaks in a Zoom or Teams desktop call, for the call's roster
 * (callRoster.ts), the same record the Meet page fills through the Companion
 * extension. Saving the meeting then names the lines exactly as it does for
 * Meet (nameCallLines, MeetingPersistence).
 *
 * While a Natively meeting runs, every ~500 ms: is Zoom or Teams the app
 * holding the microphone (the same signals meeting detection reads)? If so,
 * read its window's accessibility tree on a worker thread (native
 * readCallTree), read the people and the speaking marks out of it
 * (callTreeSolvers.ts), and report them under an app-scoped key
 * ('zoom-app:<pid>'). The session takes that key as its call when no meeting
 * tab gave one.
 *
 * A speaking mark appears some time after the voice starts (the app's own
 * voice detection, then the redraw, then our poll). Each report is moved back
 * by that app's detection lag on that OS (DETECTION_LAG_MS), so the spans line
 * up with the audio the transcript came from.
 *
 * Each read also gives the call's other facts (callFacts.ts: the meeting ID
 * when the window shows it, the app's head count, the user's own name there;
 * callMuteState.ts: whether the user is muted; callScreenShare.ts: whether
 * someone else is sharing a screen), handed to `onFacts` for the session,
 * the mic and the screen-share snapshots. All read-only.
 *
 * Never blocks: one read at a time, each bounded in the native module by node
 * count and wall time, and none of it on the audio path. macOS needs the
 * Accessibility permission, which Natively asks for elsewhere (stealth typing)
 * and never here: without it the reads come back untrusted and this stays
 * idle, checking again now and then. Platform and clock are injected, so both
 * OS branches are tested anywhere.
 */
import { appOfProcess, isSelf, type ProcessRef, type SelfIdentity } from './meetingApps';
import { callRoster as defaultRoster, type CallRoster } from './callRoster';
import { solveCallTree, type CallTree, type DesktopCallApp } from './callTreeSolvers';
import { readCallFacts } from './callFacts';
import { selfMuteFromTree } from './callMuteState';
import { screenShareFromTree, type ScreenShareReading } from './callScreenShare';

export type { DesktopCallApp } from './callTreeSolvers';

/**
 * How long after the voice starts each app shows it, per OS (ms). Starting
 * points from what similar tools measured; to be re-measured per app and OS
 * against a recorded call (say a word on a second machine, compare the mark's
 * first report with the audio's onset).
 */
export const DETECTION_LAG_MS: Readonly<Record<DesktopCallApp, Readonly<Partial<Record<string, number>>>>> = {
    zoom: { darwin: 500, win32: 1400 },
    teams: { darwin: 500, win32: 900 },
};

/** The lag for this app on this OS; null where this OS has no reader. */
export function detectionLagMs(app: DesktopCallApp, platform: string): number | null {
    const lag = DETECTION_LAG_MS[app]?.[platform];
    return typeof lag === 'number' ? lag : null;
}

/** meetingApps' name for the app → the desktop reader's, for the two it reads. */
export function desktopAppOf(name: string | undefined): DesktopCallApp | null {
    if (name === 'Zoom') return 'zoom';
    if (name === 'Microsoft Teams') return 'teams';
    return null;
}

export function appCallKey(app: DesktopCallApp, pid: number): string {
    return `${app}-app:${pid}`;
}

export interface WindowRef {
    pid: number;
    path?: string;
}

/**
 * The desktop call to read: Zoom or Teams holding the microphone, and the pid
 * of the process that owns its windows (the one whose tree has the call).
 * `windows` may be a getter: it is only read once one of the two holds the mic.
 */
export function locateDesktopCall(
    platform: string,
    micUsers: ProcessRef[] | null,
    windowList: WindowRef[] | null | (() => WindowRef[] | null),
    self: SelfIdentity,
): { app: DesktopCallApp; pid: number } | null {
    if (!micUsers) return null;
    let cached: WindowRef[] | null | undefined;
    const windows = () => (cached === undefined ? (cached = typeof windowList === 'function' ? windowList() : windowList) : cached);
    for (const user of micUsers) {
        if (isSelf(platform, user, self)) continue;
        const known = appOfProcess(platform, user);
        const app = known?.kind === 'meeting' ? desktopAppOf(known.name) : null;
        if (!app) continue;
        const owner = (windows() ?? []).find((w) => appOfProcess(platform, { pid: w.pid, path: w.path })?.name === known!.name);
        if (owner && owner.pid > 0) return { app, pid: owner.pid };
        // macOS names the capturing pid; it owns the windows unless a helper captures.
        if (platform === 'darwin' && user.pid && user.pid > 0) return { app, pid: user.pid };
    }
    return null;
}

export interface ReadCallTreeOptions {
    maxNodes?: number;
    maxDepth?: number;
    budgetMs?: number;
    maxWindows?: number;
}

export interface DesktopCallNative {
    getMicUsers?: () => ProcessRef[] | null;
    getVisibleWindows?: () => WindowRef[] | null;
    readCallTree?: (pid: number, options?: ReadCallTreeOptions | null) => Promise<CallTree | null>;
}

/** One read's facts about the call, beyond who is speaking. */
export interface DesktopCallReport {
    app: DesktopCallApp;
    platform: string;
    /** The roster key the people are reported under ('zoom-app:<pid>'). */
    rosterKey: string;
    /** When the tree was read. */
    at: number;
    /** meetingLinks key, once the window has shown one (kept for the call). */
    meetingKey: string | null;
    participantCount: number | null;
    participants: string[];
    /** The user's name as the app shows it, once seen (kept for the call). */
    selfName: string | null;
    /** true muted, false live, null unknown (counts as live). */
    selfMuted: boolean | null;
    share: ScreenShareReading;
    /** The app's own recording indicator (callFacts.recordingFromTree); null when the window shows nothing. */
    recording: boolean | null;
}

/** Reads in a row a different meeting key must show before it replaces the one held. */
export const MEETING_KEY_SWITCH_READS = 3;

export interface DesktopCallSpeakersDeps {
    platform: string;
    native: DesktopCallNative | null;
    self: SelfIdentity;
    /** The user's own names (the calendar account's), so their tile is never "someone else". */
    selfNames?: () => string[];
    /** A call was found: its roster key, for the session's metadata. */
    onCall?: (key: string) => void;
    /** Each read's facts; null when there is no call to read (any more). */
    onFacts?: (report: DesktopCallReport | null) => void;
    /** Each tree read, for recording fixtures (NATIVELY_DUMP_CALL_TREE). */
    dump?: (app: DesktopCallApp, platform: string, tree: CallTree) => void;
    roster?: CallRoster;
    now?: () => number;
    setTimeout?: (fn: () => void, ms: number) => unknown;
    clearTimeout?: (handle: unknown) => void;
    log?: (message: string) => void;
}

export const POLL_MS = 500;
/** How often to look again for the app (and re-check it still holds the mic). */
export const LOCATE_MS = 2_000;
/** Without the Accessibility permission, how often to check whether it arrived. */
export const UNTRUSTED_RETRY_MS = 15_000;
const TREE_OPTIONS: ReadCallTreeOptions = { maxNodes: 2_500, maxDepth: 40, budgetMs: 250, maxWindows: 6 };
const DUMP_EVERY_MS = 30_000;
/** Reads in a row with nobody recognised before saying so in the log. */
const UNRECOGNISED_LOG_AFTER = 20;

interface ActiveCall {
    app: DesktopCallApp;
    pid: number;
    key: string;
    lag: number;
}

export class DesktopCallSpeakers {
    private readonly roster: CallRoster;
    private readonly now: () => number;
    private readonly log: (message: string) => void;
    private call: ActiveCall | null = null;
    private lastLocate = -Infinity;
    private run = 0;
    private running = false;
    private timer: unknown = null;
    private learnedSelf = new Set<string>();
    private logged = new Set<string>();
    private unrecognised = 0;
    private everRecognised = false;
    private lastDump = -Infinity;
    private meetingKey: string | null = null;
    private nextKey: { key: string; reads: number } | null = null;
    private selfName: string | null = null;
    private factsLive = false;

    constructor(private readonly deps: DesktopCallSpeakersDeps) {
        this.roster = deps.roster ?? defaultRoster;
        this.now = deps.now ?? Date.now;
        this.log = deps.log ?? ((m) => console.log(`[DesktopCallSpeakers] ${m}`));
    }

    /** The roster key of the call being read, if any. */
    get key(): string | null {
        return this.call?.key ?? null;
    }

    /** Starts reading for this meeting. Idempotent. */
    start(): void {
        if (this.running) return;
        this.running = true;
        const run = ++this.run;
        this.learnedSelf.clear();
        this.unrecognised = 0;
        this.everRecognised = false;
        this.lastLocate = -Infinity;
        const tick = async () => {
            this.timer = null;
            if (run !== this.run) return;
            let delay = POLL_MS;
            const started = this.now();
            try {
                delay = await this.step(run);
            } catch (err) {
                this.once('step', `a read failed; trying again (${(err as Error)?.message ?? err})`);
                delay = LOCATE_MS;
            }
            if (run !== this.run) return;
            const wait = Math.max(0, delay - (this.now() - started));
            this.timer = (this.deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms)))(() => void tick(), wait);
        };
        void tick();
    }

    /** Stops reading; what was open in the roster closes at its last report. */
    stop(): void {
        this.running = false;
        this.run++;
        if (this.timer !== null) (this.deps.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
        this.timer = null;
        this.release();
    }

    private release(): void {
        if (this.call) this.roster.end(this.call.key);
        this.call = null;
        this.meetingKey = null;
        this.nextKey = null;
        this.selfName = null;
        this.reportFacts(null);
    }

    private reportFacts(report: DesktopCallReport | null): void {
        if (!report && !this.factsLive) return;
        this.factsLive = !!report;
        try {
            this.deps.onFacts?.(report);
        } catch (err) {
            this.once('facts', `a call-facts listener failed (${(err as Error)?.message ?? err})`);
        }
    }

    /**
     * The meeting the window shows: the first key seen holds for the call; a
     * different one replaces it only after MEETING_KEY_SWITCH_READS reads in a
     * row (the user moved to another meeting in the same app).
     */
    private settleMeetingKey(seen: string | null): string | null {
        if (!seen || seen === this.meetingKey) {
            if (seen) this.nextKey = null;
            return this.meetingKey;
        }
        if (this.meetingKey === null) {
            this.meetingKey = seen;
            this.log(`the ${this.call?.app ?? 'meeting'} window names its meeting (${seen.split(':')[0]})`);
            return seen;
        }
        this.nextKey = this.nextKey?.key === seen ? { key: seen, reads: this.nextKey.reads + 1 } : { key: seen, reads: 1 };
        if (this.nextKey.reads >= MEETING_KEY_SWITCH_READS) {
            this.meetingKey = seen;
            this.nextKey = null;
            this.log('the window now names a different meeting');
        }
        return this.meetingKey;
    }

    private once(id: string, message: string): void {
        if (this.logged.has(id)) return;
        this.logged.add(id);
        this.log(message);
    }

    /**
     * One poll; returns how long to wait before the next. Public for the
     * tests, which drive it with a fake clock and a fake native module.
     */
    async step(run: number = this.run): Promise<number> {
        const native = this.deps.native;
        if (!native?.readCallTree || !native.getMicUsers) {
            this.once('native', 'the native module has no call-tree reader; desktop call names are off');
            return UNTRUSTED_RETRY_MS;
        }
        if (!Object.values(DETECTION_LAG_MS).some((byOs) => typeof byOs[this.deps.platform] === 'number')) {
            this.once(`platform:${this.deps.platform}`, `no desktop call reader on ${this.deps.platform}`);
            return UNTRUSTED_RETRY_MS;
        }
        const now = this.now();
        if (!this.call || now - this.lastLocate >= LOCATE_MS) {
            this.lastLocate = now;
            const found = locateDesktopCall(this.deps.platform, native.getMicUsers() ?? null, () => native.getVisibleWindows?.() ?? null, this.deps.self);
            if (!found) {
                this.release();
                return LOCATE_MS;
            }
            if (!this.call || this.call.pid !== found.pid || this.call.app !== found.app) {
                this.release();
                const lag = detectionLagMs(found.app, this.deps.platform);
                if (lag === null) {
                    this.once(`platform:${this.deps.platform}`, `no ${found.app} reader on ${this.deps.platform}`);
                    return UNTRUSTED_RETRY_MS;
                }
                this.call = { ...found, key: appCallKey(found.app, found.pid), lag };
                this.log(`reading ${found.app} (${this.deps.platform}) for who speaks`);
                try {
                    this.deps.onCall?.(this.call.key);
                } catch { /* the session's bookkeeping never stops the reads */ }
            }
        }
        const call = this.call;
        const tree = await native.readCallTree(call.pid, TREE_OPTIONS);
        if (run !== this.run || this.call !== call) return POLL_MS;
        if (!tree) return LOCATE_MS;
        if (!tree.trusted) {
            this.once('untrusted', 'Accessibility is not granted; desktop call names stay off until it is');
            this.reportFacts(null);
            return UNTRUSTED_RETRY_MS;
        }
        if (this.deps.dump && now - this.lastDump >= DUMP_EVERY_MS) {
            this.lastDump = now;
            try {
                this.deps.dump(call.app, this.deps.platform, tree);
            } catch { /* a fixture recorder never stops the reads */ }
        }
        const knownSelf = [...(this.deps.selfNames?.() ?? []), ...this.learnedSelf];
        const solved = solveCallTree(call.app, tree, knownSelf);
        for (const name of solved.selfNames) this.learnedSelf.add(name);
        if (solved.people.length === 0) {
            if (!this.everRecognised && ++this.unrecognised === UNRECOGNISED_LOG_AFTER) {
                const nodes = tree.windows.reduce((n, w) => n + w.nodes.length, 0);
                this.log(`no participants recognised in ${call.app}'s window yet (${tree.windows.length} windows, ${nodes} nodes${tree.truncated ? ', cut short' : ''})`);
            }
        } else {
            this.everRecognised = true;
        }
        // The tree is as of the middle of the read; the voice began `lag` earlier.
        const seenAt = now + Math.round((tree.elapsedMs ?? 0) / 2) - call.lag;
        this.roster.report(call.key, solved.people, seenAt);
        const facts = readCallFacts(call.app, tree, solved);
        if (facts.participantCount !== null) this.roster.noteCount(call.key, facts.participantCount, now);
        this.selfName ??= facts.selfName;
        const mute = selfMuteFromTree(call.app, tree, [...knownSelf, ...solved.selfNames]);
        this.reportFacts({
            app: call.app,
            platform: this.deps.platform,
            rosterKey: call.key,
            at: now,
            meetingKey: this.settleMeetingKey(facts.meetingKey),
            recording: facts.recording,
            participantCount: facts.participantCount,
            participants: facts.participants,
            selfName: this.selfName,
            selfMuted: mute.muted,
            share: screenShareFromTree(call.app, tree),
        });
        return POLL_MS;
    }
}
