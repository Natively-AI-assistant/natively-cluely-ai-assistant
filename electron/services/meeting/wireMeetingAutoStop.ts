/**
 * Auto-stop and the quit flush in the running app: the MeetingEndDetector's
 * signals read from the real sources, and the OS events a running meeting's
 * transcript is written on before the process goes.
 *
 * Signals:
 *   microphone  the native module's getMicUsers (macOS: the HAL's running-IO
 *               processes; Windows: the microphone ConsentStore), as known
 *               meeting apps and browsers, Natively itself left out
 *   calendar    the session's linked event (SessionCalendarLinker writes it
 *               into the meeting metadata)
 *   tabs        the Companion extension's meeting tabs (liveMeetings), only
 *               while Meeting detection is on (it is what asks for them)
 *   transcript  main's STT handler, both channels
 *
 * Off when the setting is off, in Ambient AI Chat (no audio, so silence means
 * nothing), and the inactivity stop alone is off while Undetectable is on
 * (a stop shows the launcher, unprompted, during what may be a proctored
 * session). Pure helpers take the platform, so both OS branches are tested.
 */
import { MeetingEndDetector, type MeetingEndReason, type MeetingEndSignals } from './MeetingEndDetector';
import { runEndOfCallCheck } from './endOfCallCheck';
import { appOfProcess, isSelf, type ProcessRef, type SelfIdentity } from '../meetingDetection/meetingApps';
import type { LiveMeetingSource } from '../meetingDetection/liveMeetings';

/** The apps holding a microphone, as names, meeting apps before browsers; null: unknown. */
export function micAppsOf(platform: string, micUsers: ProcessRef[] | null, self: SelfIdentity): string[] | null {
    if (micUsers === null) return null;
    const meeting: string[] = [];
    const browser: string[] = [];
    for (const proc of micUsers) {
        if (isSelf(platform, proc, self)) continue;
        const app = appOfProcess(platform, proc);
        if (!app) continue;
        // Chat apps that call (WhatsApp, Slack…) end a call the way meeting apps do.
        const list = app.kind === 'browser' ? browser : meeting;
        if (!list.includes(app.name)) list.push(app.name);
    }
    return [...meeting, ...browser];
}

export const DEFAULT_INACTIVITY_MINUTES = 15;

/** The inactivity setting as minutes, bounded; anything else is the default. */
export function inactivityMinutes(raw: unknown): number {
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 2 && raw <= 240 ? Math.round(raw) : DEFAULT_INACTIVITY_MINUTES;
}

export interface MeetingAutoStopDeps {
    platform: string;
    self: SelfIdentity;
    native: { getMicUsers?: () => ProcessRef[] | null } | null;
    live: LiveMeetingSource;
    /** The running session's metadata (calendarEvent, callKey) or null. */
    metadata: () => any;
    /** Grows when the user uses Natively (answers, chats): activity, not silence. */
    activityCount?: () => number;
    /** "me" / "them" display names for the model check. */
    speakerNames: () => { me: string; them: string };
    settings: () => { enabled: boolean; inactivityMinutes: number };
    /** One fast model call (LLMHelper.generateJudgeVerdict), or null without a provider. */
    generate: ((prompt: string, signal: AbortSignal) => Promise<string>) | null;
    stopMeeting: (reason: MeetingEndReason, detail: string) => void;
    /** Overlay notice: the time it stops at, or null to clear it. */
    notify: (stopsAt: number | null) => void;
    log?: (line: string) => void;
    now?: () => number;
    setInterval?: (fn: () => void, ms: number) => unknown;
    clearInterval?: (handle: unknown) => void;
}

export interface MeetingAutoStop {
    /** A meeting started. */
    start(ctx: { ambientChat: boolean; undetectable: boolean }): void;
    /** The meeting ended (any way). */
    end(): void;
    noteTranscript(speaker: string, text: string, final: boolean): void;
    noteTyping(): void;
    noteActivity(): void;
    keepGoing(): void;
    /** Undetectable switched during the meeting: the inactivity stop follows it. */
    setUndetectable(on: boolean): void;
    /**
     * Transcription paused from the notepad (transcriptionPause.ts): the silence
     * is the user's choice, so the inactivity stop is off until it resumes; the
     * resume counts from then. The call ending (mic released, tab gone) still stops it.
     */
    setPaused(paused: boolean): void;
    readonly detector: MeetingEndDetector | null;
}

export function createMeetingAutoStop(deps: MeetingAutoStopDeps): MeetingAutoStop {
    const log = deps.log ?? ((l: string) => console.log(l));
    let detector: MeetingEndDetector | null = null;
    let undetectable = false;
    let paused = false;

    const signals: MeetingEndSignals = {
        micApps: () => micAppsOf(deps.platform, deps.native?.getMicUsers ? deps.native.getMicUsers() ?? null : null, deps.self),
        calendarEventEnd: () => {
            const end = deps.metadata()?.calendarEvent?.endTime;
            const ms = typeof end === 'string' ? Date.parse(end) : NaN;
            return Number.isFinite(ms) ? ms : null;
        },
        callKey: () => {
            const key = deps.metadata()?.callKey;
            return typeof key === 'string' && key ? key : null;
        },
        // Only an answer from the browser that showed the call: it still being
        // connected without the tab means the tab was closed; that browser gone
        // (or another one reporting) says nothing about this call.
        callTabOpen: (key) => {
            if (deps.live.tabState) return deps.live.tabState(key);
            const all = deps.live.list();
            if (all.length === 0) return null;
            return all.some((m) => m.key === key);
        },
        speakerNames: deps.speakerNames,
        activityCount: deps.activityCount,
    };

    return {
        get detector() {
            return detector;
        },
        start(ctx) {
            detector?.dispose();
            detector = null;
            undetectable = ctx.undetectable;
            paused = false;
            const { enabled, inactivityMinutes: minutes } = deps.settings();
            if (!enabled) {
                log('[MeetingAutoStop] off (Settings: End meetings automatically when the call ends)');
                return;
            }
            if (ctx.ambientChat) {
                log('[MeetingAutoStop] off for this meeting: Ambient AI Chat captures no audio');
                return;
            }
            detector = new MeetingEndDetector({
                signals,
                checkEnded: deps.generate
                    ? (transcript) => runEndOfCallCheck(transcript, { generate: deps.generate, names: deps.speakerNames })
                    : null,
                stop: deps.stopMeeting,
                warn: deps.notify,
                log,
                now: deps.now,
                setInterval: deps.setInterval,
                clearInterval: deps.clearInterval,
            }, {
                inactivityMs: minutes * 60_000,
                // A meeting under 3 minutes old never ends by the release or model layers (Granola's rule).
                minMeetingMs: 3 * 60_000,
                inactivityEnabled: !ctx.undetectable,
            });
            detector.start();
        },
        end() {
            detector?.dispose();
            detector = null;
        },
        noteTranscript(speaker, text, final) {
            detector?.noteTranscript(speaker === 'user' ? 'me' : 'them', text, final);
        },
        setUndetectable(on) {
            undetectable = on;
            detector?.setInactivityEnabled(!on && !paused);
        },
        setPaused(next) {
            if (paused === next) return;
            paused = next;
            detector?.setInactivityEnabled(!undetectable && !paused);
            if (!next) detector?.noteResume();
        },
        noteTyping() {
            detector?.noteTyping();
        },
        noteActivity() {
            detector?.noteActivity();
        },
        keepGoing() {
            detector?.noteResume();
        },
    };
}

/**
 * The OS events on which a running meeting is written to disk before the
 * process goes. Both platforms: before-quit (Cmd+Q, the menu, the tray,
 * app.quit) and will-quit. Then what each OS does instead of quitting the app
 * normally:
 *   darwin  powerMonitor 'shutdown' (a restart or shutdown; macOS also
 *           terminates the app, but this lands first)
 *   win32   a window's 'session-end' (shutdown, restart, log-off: Electron
 *           does not emit before-quit then)
 * Any other platform gets the two Electron events only.
 */
export type QuitFlushHook = 'app:before-quit' | 'app:will-quit' | 'powerMonitor:shutdown' | 'window:session-end';

export function quitFlushHooks(platform: string): QuitFlushHook[] {
    switch (platform) {
        case 'darwin':
            return ['app:before-quit', 'app:will-quit', 'powerMonitor:shutdown'];
        case 'win32':
            return ['app:before-quit', 'app:will-quit', 'window:session-end'];
        default:
            return ['app:before-quit', 'app:will-quit'];
    }
}

export interface QuitFlushDeps {
    platform: string;
    app: { on(event: 'before-quit' | 'will-quit', fn: () => void): unknown; on(event: 'browser-window-created', fn: (e: unknown, win: { on(ev: 'session-end', fn: () => void): unknown }) => void): unknown };
    powerMonitor: { on(event: 'shutdown', fn: () => void): unknown } | null;
    /** Windows already open when this registers (session-end is per window). */
    existingWindows?: () => Array<{ on(ev: 'session-end', fn: () => void): unknown }>;
    /** Writes the running meeting, if any; returns whether a row was written. */
    flush: (endedBy: 'quit' | 'os_session_end') => boolean;
    log?: (line: string) => void;
    now?: () => number;
}

/**
 * Registers the flush on each hook for this platform. The flush is a
 * synchronous SQLite write (well under the 300 ms quit budget even for a
 * two-hour meeting); its time is logged.
 */
export function registerQuitFlush(deps: QuitFlushDeps): QuitFlushHook[] {
    const log = deps.log ?? ((l: string) => console.log(l));
    const now = deps.now ?? Date.now;
    let lastSessionEndAt = -Infinity;
    const run = (endedBy: 'quit' | 'os_session_end', on: string) => {
        const t0 = now();
        // Every window hears the same session end; one write is enough.
        if (endedBy === 'os_session_end') {
            if (t0 - lastSessionEndAt < 2_000) return;
            lastSessionEndAt = t0;
        }
        try {
            const wrote = deps.flush(endedBy);
            if (wrote) log(`[LiveMeetingJournal] running meeting written for recovery on ${on} in ${now() - t0} ms`);
        } catch (err) {
            log(`[LiveMeetingJournal] flush on ${on} failed: ${(err as Error)?.message}`);
        }
    };
    const hooks = quitFlushHooks(deps.platform);
    for (const hook of hooks) {
        switch (hook) {
            case 'app:before-quit':
                deps.app.on('before-quit', () => run('quit', 'before-quit'));
                break;
            case 'app:will-quit':
                deps.app.on('will-quit', () => run('quit', 'will-quit'));
                break;
            case 'powerMonitor:shutdown':
                deps.powerMonitor?.on('shutdown', () => run('os_session_end', 'system shutdown'));
                break;
            case 'window:session-end':
                // Every window, open now or later: Windows tells each of them.
                for (const win of deps.existingWindows?.() ?? []) {
                    win.on('session-end', () => run('os_session_end', 'Windows session end'));
                }
                deps.app.on('browser-window-created', (_e, win) => {
                    win.on('session-end', () => run('os_session_end', 'Windows session end'));
                });
                break;
        }
    }
    return hooks;
}
