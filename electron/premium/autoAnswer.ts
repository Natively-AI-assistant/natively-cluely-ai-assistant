/**
 * Auto Answer's boundary with the private premium submodule.
 *
 * The implementation (the engine, the LLM judge prompt, usage telemetry, the
 * on-device decision model and its paid download, the savings card's ledger,
 * and transcript sharing) lives in premium/electron/autoAnswer. This file is
 * what the source-available app compiles against: structural types for the
 * parts main.ts, ipcHandlers.ts, preload.ts and MeetingPersistence.ts touch,
 * and a loader that falls back to an inert stand-in when premium/ is absent.
 *
 * Without premium, Auto Answer is unavailable: access is always refused
 * ('auto_answer_unavailable'), the engine ignores transcript, and Settings hides
 * the rows. Nothing here branches on the platform; the premium side owns the
 * macOS / Windows differences (deciderRuntime.ts).
 *
 * premium/electron/autoAnswer/index.ts declares its export as
 * AutoAnswerPremium, so `npm run typecheck:premium` fails when the two drift.
 */
import type { TranscriptSegment } from '../SessionTracker';
import type { TranscriptTurn } from '../llm/transcriptCleaner';
import type { UsageEventInput } from '../services/UsageOutbox';
import type { resolveAutoAnswerThresholds } from '../context-intelligence/policies/mode-policy-registry';

export type AutoAnswerThresholds = ReturnType<typeof resolveAutoAnswerThresholds>;

// ─── Access ──────────────────────────────────────────────────────────────────

export interface TrainingConsent {
    version: number;
    grantedAt: string;
}

export type AutoAnswerAccess =
    | { allowed: true; basis: 'pro'; uploads: boolean }
    | { allowed: true; basis: 'sharing'; uploads: true }
    | { allowed: false; basis: 'none'; uploads: false; error: 'auto_answer_access_required' | 'auto_answer_unavailable' };

// ─── Engine ──────────────────────────────────────────────────────────────────

/** The question the engine hands to the answer pipeline (IntelligenceEngine.runAutoAnswer). */
export interface AutoAnswerQuestion {
    id: string;
    text: string;
    confidence: number;
    answerability: number;
    dialogueAct: string;
    isFollowUp: boolean;
    endpointSource?: string;
    candidateGeneration: number;
}

/** auto_answer_* events: enums and numbers, never text. Only the fields the app reads are named. */
export interface AutoAnswerTelemetryEvent {
    name: string;
    meetingGeneration: number;
    provider?: string;
}

/** The judge's request: built and read only by premium code. */
export type AutoAnswerJudgeRequest = object;

export interface AutoAnswerEngineHost {
    isEnabled(): boolean;
    isMeetingActive(): boolean;
    meetingGeneration(): number;
    engineAccepting(): boolean;
    answerStreamActive?(): boolean;
    recentTurns(): TranscriptTurn[];
    dispatch(question: AutoAnswerQuestion, options: { reuseSpeculative: boolean }): void | Promise<unknown>;
    cancelAutomaticAnswer?(reason: 'user_barge_in'): boolean;
    judgeCandidate?(req: AutoAnswerJudgeRequest, signal?: AbortSignal): Promise<string | null>;
    noteCandidate?(questionId: string, candidateGeneration: number): void;
    speculativeSnapshot?(): { questionId: string | null; text: string | null };
    prefetchAnswer?(questionId: string, text: string): void;
    warmQuery?(text: string): void;
    modeName?(): string | null;
    userName?(): string | null;
    telemetry?(event: AutoAnswerTelemetryEvent): void;
    log?(line: string): void;
    logContent?(label: string, text: string): void;
}

export interface AutoAnswerEngine {
    setThresholds(t: AutoAnswerThresholds): void;
    onMeetingStart(): void;
    /** The meeting's mode changed: drop speech held under the old mode (F-CTX-03). */
    onModeChanged(): void;
    onMeetingStop(): void;
    onEngineIdle(): void;
    onProviderEndpoint(): void;
    onLocalSpeechEnd(): void;
    /** A stop from a provider whose final follows it (REST, local): a hint for that final, not an endpoint (F-LAT-07). */
    onLocalSpeechEndBeforeFinal(): void;
    onLocalSpeechStart(): void;
    onManualAnswerStarted(): void;
    ingest(segment: TranscriptSegment): void;
}

// ─── Usage telemetry (one row per meeting, counts and labels only) ───────────

export interface AutoAnswerUsageDeps {
    sink(row: UsageEventInput): void;
    mode(): string | null;
    answerModel(): { provider?: string; model?: string } | null;
}

export interface AutoAnswerUsage {
    meetingStarted(): void;
    meetingEnded(): void;
    observe(event: AutoAnswerTelemetryEvent): void;
    answerShown(): void;
    stopAwaitingAnswer(): void;
}

// ─── On-device decision model ────────────────────────────────────────────────

export interface AutoAnswerDeciderTelemetry {
    name: string;
    decisionMode: string;
    decisionBackend: string;
    escalated: boolean;
}

export interface AutoAnswerDeciderOptions {
    platform: NodeJS.Platform;
    env: Record<string, string | undefined>;
    isPackaged: boolean;
    installedModelDir: () => string | null;
    llmJudge(req: AutoAnswerJudgeRequest, signal?: AbortSignal): Promise<string | null>;
    telemetry?(event: AutoAnswerDeciderTelemetry): void;
}

export interface AutoAnswerDecider {
    judgeCandidate(req: AutoAnswerJudgeRequest, signal?: AbortSignal): Promise<string | null>;
    warmUp(): void;
    dispose(): void;
}

export type AutoAnswerModelCredential =
    | { kind: 'api_key'; key: string }
    | { kind: 'pro'; key: string; provider: 'dodo' | 'gumroad' };

/** The Settings card's install state (mirrored for the renderer in src/types/electron.d.ts). */
export type AutoAnswerModelInstall =
    | { state: 'unsupported' }
    | { state: 'not_entitled' }
    | { state: 'available'; variant: string; bytes: number }
    | { state: 'downloading'; variant: string; received: number; total: number }
    | { state: 'installed'; variant: string; version: string; dir: string }
    | { state: 'error'; variant: string; error: string; retryable: boolean };

export interface AutoAnswerModelInstallerDeps {
    /** resources/models/auto-answer-decider: the shipped manifest + tokenizer. */
    bundledDir: string;
    /** <userData>/models/auto-answer-decider */
    installRoot: string;
    /** process.platform / process.arch / os.release(): premium picks the graph. */
    platform: NodeJS.Platform;
    arch: string;
    release: string;
    credential(): AutoAnswerModelCredential | null;
    apiBase: string;
    log?: { info?(m: string): void; warn?(m: string): void };
}

export interface AutoAnswerModelInstaller {
    installedDir(): string | null;
    status(): AutoAnswerModelInstall;
    install(onProgress?: (s: AutoAnswerModelInstall) => void, signal?: AbortSignal): Promise<AutoAnswerModelInstall>;
    remove(): void;
}

export interface AutoAnswerModelSavings {
    installedAt: string | null;
    before: { days: number; judgeCalls: number; tokens: number; usd: number };
    after: { days: number; moments: number; local: number; judged: number; tokensSaved: number; usdSaved: number; tokensSpent: number; usdSpent: number } | null;
    projection: { localShare: number; judgeCallsSaved: number; tokensSaved: number; usdSaved: number } | null;
    reference: { model: string; inPerM: number; outPerM: number; outTokensPerCall: number; charsPerToken: number };
}

export interface AutoAnswerSavingsLedger {
    recordJudgeCall(promptChars: number): void;
    recordLocalDecision(): void;
    markInstalled(): void;
    markRemoved(): void;
    flush(): void;
    summary(): AutoAnswerModelSavings;
}

// ─── Transcript sharing ──────────────────────────────────────────────────────

export interface TrainingOfferedMeeting {
    meetingId: string;
    startTime: number;
    durationMs: number;
    mode: string | null;
    transcript: Array<{ speaker: string; text: string; timestamp: number; final?: boolean }>;
    knownNames?: string[];
}

export interface TrainingUploaderDeps {
    dir: string;
    apiBase: () => string;
    installId: () => string | undefined;
    callerHeaders: () => Promise<Record<string, string>>;
    appVersion: string;
    platform: string;
    access: () => { allowed: boolean; basis: 'pro' | 'sharing' | 'none'; uploads: boolean };
    consent: () => TrainingConsent | null | undefined;
}

export interface TrainingUploader {
    meetingStarted(): void;
    noteAutoAnswerRan(): void;
    offerMeeting(m: TrainingOfferedMeeting): void;
    start(): void;
    stop(): void;
    flush(): Promise<void>;
    withdraw(): void;
    requestDeletion(): Promise<{ success: boolean; error?: string }>;
}

// ─── The module ──────────────────────────────────────────────────────────────

export interface AutoAnswerPremium {
    /** False only in the stand-in below. */
    readonly available: boolean;
    createEngine(host: AutoAnswerEngineHost, thresholds: AutoAnswerThresholds): AutoAnswerEngine;
    createUsageTelemetry(deps: AutoAnswerUsageDeps): AutoAnswerUsage;
    buildJudgePrompt(req: AutoAnswerJudgeRequest): string;
    acceptsLocalSpeechEndHint(sttProvider: string): boolean;
    autoAnswerAccess(input: { proOrTrial: boolean; consent: unknown }): AutoAnswerAccess;
    newTrainingConsent(now?: Date): TrainingConsent;
    createDecider(o: AutoAnswerDeciderOptions): AutoAnswerDecider;
    createModelInstaller(deps: AutoAnswerModelInstallerDeps): AutoAnswerModelInstaller;
    createSavingsLedger(o: { file: string | null }): AutoAnswerSavingsLedger;
    createTrainingUploader(deps: TrainingUploaderDeps): TrainingUploader;
    setTrainingMeetingSink(fn: ((m: TrainingOfferedMeeting) => void) | null): void;
    offerTrainingMeeting(m: TrainingOfferedMeeting): void;
}

// ─── Stand-in for builds without premium/ ────────────────────────────────────

const noop = (): void => { /* Auto Answer is not part of this build */ };

export const UNAVAILABLE_AUTO_ANSWER: AutoAnswerPremium = Object.freeze({
    available: false,
    createEngine: (): AutoAnswerEngine => ({
        setThresholds: noop, onMeetingStart: noop, onModeChanged: noop, onMeetingStop: noop, onEngineIdle: noop,
        onProviderEndpoint: noop, onLocalSpeechEnd: noop, onLocalSpeechEndBeforeFinal: noop, onLocalSpeechStart: noop,
        onManualAnswerStarted: noop, ingest: noop,
    }),
    createUsageTelemetry: (): AutoAnswerUsage => ({
        meetingStarted: noop, meetingEnded: noop, observe: noop, answerShown: noop, stopAwaitingAnswer: noop,
    }),
    buildJudgePrompt: () => '',
    acceptsLocalSpeechEndHint: () => false,
    autoAnswerAccess: (): AutoAnswerAccess => ({ allowed: false, basis: 'none', uploads: false, error: 'auto_answer_unavailable' }),
    newTrainingConsent: (now: Date = new Date()): TrainingConsent => ({ version: 1, grantedAt: now.toISOString() }),
    createDecider: (): AutoAnswerDecider => ({ judgeCandidate: async () => null, warmUp: noop, dispose: noop }),
    createModelInstaller: (): AutoAnswerModelInstaller => ({
        installedDir: () => null,
        status: () => ({ state: 'unsupported' }),
        install: async () => ({ state: 'unsupported' }),
        remove: noop,
    }),
    createSavingsLedger: (): AutoAnswerSavingsLedger => ({
        recordJudgeCall: noop, recordLocalDecision: noop, markInstalled: noop, markRemoved: noop, flush: noop,
        summary: () => ({
            installedAt: null,
            before: { days: 7, judgeCalls: 0, tokens: 0, usd: 0 },
            after: null,
            projection: null,
            reference: { model: '', inPerM: 0, outPerM: 0, outTokensPerCall: 0, charsPerToken: 4 },
        }),
    }),
    createTrainingUploader: (): TrainingUploader => ({
        meetingStarted: noop, noteAutoAnswerRan: noop, offerMeeting: noop, start: noop, stop: noop,
        flush: async () => { /* nothing to send */ }, withdraw: noop,
        requestDeletion: async () => ({ success: true }),
    }),
    setTrainingMeetingSink: noop,
    offerTrainingMeeting: noop,
});

let loaded: AutoAnswerPremium | null = null;

/**
 * The premium Auto Answer module, or the stand-in. Loaded once. `load` is for
 * tests; production uses the bundled require (esbuild inlines premium/ when it
 * is checked out; the core-smoke build marks it external and it fails here).
 */
export function loadAutoAnswerPremium(load?: () => unknown): AutoAnswerPremium {
    if (loaded && !load) return loaded;
    let mod: AutoAnswerPremium = UNAVAILABLE_AUTO_ANSWER;
    try {
        const m = (load ? load() : require('../../premium/electron/autoAnswer')) as { autoAnswerPremium?: AutoAnswerPremium } | null;
        if (m?.autoAnswerPremium?.available) mod = m.autoAnswerPremium;
    } catch {
        console.log('[AutoAnswer] premium module not available: Auto Answer is off in this build.');
    }
    if (!load) loaded = mod;
    return mod;
}
