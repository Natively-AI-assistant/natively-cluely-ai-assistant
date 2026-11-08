/**
 * Dictation in the running app: the DictationController with the real
 * microphone, the user's speech provider, their model, the clipboard and a
 * silent OS notification.
 *
 * Output is the clipboard and nothing else: no key presses, no paste, no
 * focus change in any app (the brief's binding rule, guarded by
 * Dictation2026_10_15.test.mjs, which scans this folder for keystroke APIs).
 * The notice is an OS notification like the meeting-detected one, so it shows
 * whichever app is in front; like that one it is never shown while
 * Undetectable blocks native prompts or a disguise is on (the text still
 * reaches the clipboard).
 *
 * Platform: the microphone is the same native capture meetings use
 * (CoreAudio on macOS, WASAPI on Windows, both behind MicrophoneCapture); the
 * speech providers are platform-neutral except Apple Speech (macOS only).
 */
import { DictationController, type DictationAudioSink, type DictationCapture } from './DictationController';
import { formatDictation } from './dictationFormatter';
import { liveTimingFor } from './dictationSession';
import type { DictationNotice } from './dictationCopy';
import type { ReplayableStt, SpeechClip } from '../../audio/sttGapRecovery';

export interface DictationWiring {
    platform: string;
    appVersion: string;
    isEnabled: () => boolean;
    isMeetingActive: () => boolean;
    /** Undetectable's native-prompt gate, or a disguise. */
    promptsBlocked: () => boolean;
    /** The LLMHelper, when one is up. */
    llm: () => { chat: (...args: any[]) => Promise<string>; isLocalOnly?: () => boolean } | null | undefined;
    /** The microphone the last meeting used, or undefined for the system default. */
    inputDeviceId: () => string | undefined;
    accelerator: () => string;
}

function sttProvider(): string {
    try {
        const { CredentialsManager } = require('../CredentialsManager');
        return String(CredentialsManager.getInstance().getSttProvider() || 'none');
    } catch {
        return 'none';
    }
}

function localOnlyOf(w: DictationWiring): boolean {
    try { return !!w.llm()?.isLocalOnly?.(); } catch { return false; }
}

/** A private live instance of the user's chosen provider for the mic, or null. */
function createLiveInstance(w: DictationWiring): ReplayableStt | null {
    const id = sttProvider();
    if (id === 'none') return null;
    if (id === 'natively') {
        const { CredentialsManager } = require('../CredentialsManager');
        const key = CredentialsManager.getInstance().getNativelyApiKey?.();
        if (!key) return null;
        const { NativelyProSTT } = require('../../audio/NativelyProSTT');
        const platform = w.platform === 'darwin' ? 'mac' : w.platform === 'win32' ? 'windows' : 'linux';
        const stt = new NativelyProSTT(key, 'mic', { appVersion: w.appVersion, platform });
        try { stt.setRecognitionLanguage?.(CredentialsManager.getInstance().getSttLanguage?.()); } catch { /* default language */ }
        return stt as ReplayableStt;
    }
    if (id === 'apple-speech') {
        if (w.platform !== 'darwin') return null;
        const { AppleSpeechSTT } = require('../../audio/AppleSpeechSTT');
        const stt = new AppleSpeechSTT();
        try {
            const { CredentialsManager } = require('../CredentialsManager');
            stt.setRecognitionLanguage?.(CredentialsManager.getInstance().getSttLanguage?.());
        } catch { /* default language */ }
        return stt as ReplayableStt;
    }
    const { createPrivateSttInstance } = require('../../audio/sttRecoveryTranscribers');
    return createPrivateSttInstance(id, 'mic');
}

/** The recording, transcribed by the next transcriber the privacy plan allows. */
async function transcribeWithPlan(w: DictationWiring, clip: SpeechClip): Promise<string> {
    const { buildRecoveryTranscribers } = require('../../audio/sttRecoveryTranscribers');
    const list: Array<{ id: string; transcribe(c: SpeechClip): Promise<string>; dispose?(): void }> =
        buildRecoveryTranscribers('mic', { effectiveProvider: sttProvider(), localOnly: localOnlyOf(w) });
    let lastErr: Error | null = null;
    for (const t of list) {
        try {
            return await t.transcribe(clip);
        } catch (err) {
            lastErr = err as Error;
            console.warn(`[Dictation] ${t.id} could not transcribe: ${lastErr?.message}`);
        } finally {
            try { t.dispose?.(); } catch { /* ignore */ }
        }
    }
    throw lastErr ?? new Error('no transcriber available');
}

async function openMicrophone(w: DictationWiring, sink: DictationAudioSink): Promise<DictationCapture> {
    const { MicrophoneCapture } = require('../../audio/MicrophoneCapture');
    const open = (deviceId?: string) => {
        const capture = new MicrophoneCapture(deviceId);
        let rate = 0;
        capture.on('data', (chunk: Buffer) => {
            if (!rate) rate = capture.getSampleRate();
            sink.onAudio(chunk, rate);
        });
        capture.on('sample_rate_changed', (r: number) => { if (r > 0) rate = r; });
        capture.on('error', (err: Error) => sink.onError(err));
        capture.start();
        return capture;
    };
    let capture: any;
    const wanted = w.inputDeviceId();
    try {
        capture = open(wanted);
    } catch (err) {
        if (!wanted) throw err;
        console.warn('[Dictation] saved microphone failed, using the default:', (err as Error)?.message);
        capture = open(undefined);
    }
    return {
        stop: async () => {
            try { capture.disablePreWarm?.(); } catch { /* ignore */ }
            await capture.destroy();
        },
    };
}

/** The last notice, kept referenced (Electron drops an unreferenced Notification). */
let shownNotice: { close(): void } | null = null;

function showNotice(w: DictationWiring, n: DictationNotice): void {
    if (w.promptsBlocked()) return;
    const { Notification } = require('electron');
    if (!Notification.isSupported()) return;
    try { shownNotice?.close(); } catch { /* already gone */ }
    const notif = new Notification({ title: n.title, body: n.body, silent: true });
    notif.on('close', () => { if (shownNotice === notif) shownNotice = null; });
    notif.on('failed', (_e: unknown, error: string) => {
        console.warn(`[Dictation] the OS did not show the notice: ${error}`);
        if (shownNotice === notif) shownNotice = null;
    });
    shownNotice = notif;
    notif.show();
}

export function wireDictation(w: DictationWiring): DictationController {
    return new DictationController({
        platform: w.platform,
        accelerator: w.accelerator,
        isMeetingActive: w.isMeetingActive,
        hasProvider: () => sttProvider() !== 'none',
        startCapture: (sink) => openMicrophone(w, sink),
        createLive: () => createLiveInstance(w),
        liveTiming: () => {
            let custom = false;
            try { custom = !!require('../CredentialsManager').CredentialsManager.getInstance().getOpenAiSttBaseUrl?.(); } catch { /* the cloud endpoint */ }
            return liveTimingFor(sttProvider(), { openAiCustomEndpoint: custom });
        },
        transcribeClip: (clip) => transcribeWithPlan(w, clip),
        format: async (raw) => {
            const llm = w.llm();
            const complete = llm
                ? (system: string, user: string) => llm.chat(user, undefined, undefined, system, true /* skipModeInjection */)
                : null;
            return (await formatDictation(raw, complete)).text;
        },
        writeClipboard: (text) => {
            const { clipboard } = require('electron');
            clipboard.writeText(text);
        },
        notify: (notice) => showNotice(w, notice),
    });
}

// The running controller, for the shortcut handler and the Settings switch.
let registered: { controller: DictationController; wiring: DictationWiring } | null = null;

export function registerDictation(controller: DictationController, wiring: DictationWiring): void {
    registered = { controller, wiring };
}

/** The dictation shortcut fired. Ignored while the setting is off. */
export function pressDictation(): void {
    if (!registered || !registered.wiring.isEnabled()) return;
    registered.controller.press().catch((err) => console.warn('[Dictation] press failed:', err?.message));
}

/** The setting was turned off: drop a dictation in progress. */
export function cancelDictation(): void {
    registered?.controller.cancel();
}
