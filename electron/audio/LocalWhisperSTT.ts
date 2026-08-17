/**
 * LocalWhisperSTT — local Whisper / Distil-Whisper / Moonshine STT provider.
 *
 * Dual-channel architecture: Natively captures Mic and System Audio as two
 * completely separate native streams. createSTTProvider() instantiates this
 * class TWICE — once per channel. No diarization model is needed; speaker
 * attribution is free from the hardware.
 *
 * STREAMING DESIGN (closes the latency gap with cloud STT):
 *
 *   Cloud STT providers (Deepgram/Soniox/ElevenLabs) emit *interim*
 *   transcripts every 100–300ms while the user is still speaking. Whisper
 *   wasn't designed for streaming — we approximate it with a per-model
 *   profile (see resolveStreamingProfile):
 *
 *   Whisper / Distil-Whisper path (slow, batch-architected models):
 *     - Tick every 1500ms while a segment is open (after 800ms of audio)
 *     - Apply LocalAgreement-2: only commit text where two overlapping
 *       inferences agree (longest common prefix). Stabilizes flicker.
 *     - First interim emit ~1.5–2.5s after speech starts.
 *
 *   Moonshine path (streaming-native, deterministic, ~100ms inference):
 *     - Tick every 750ms after just 400ms of audio
 *     - Skip LA-2 — the model's output is already stable; emit each
 *       cleaned partial directly.
 *     - First interim emit ~400–600ms after speech starts.
 *
 *   Nemotron 3.5 ASR Streaming path (genuinely chunked, cache-aware RNNT):
 *     - Tick every 560ms after 560ms of audio — NOT a tunable polling rate
 *       like the profiles above; 560ms (8960 samples @ 16kHz) is the fixed
 *       chunk size the ONNX export itself was built around.
 *     - Skip LA-2 — same rationale as Moonshine: the worker's per-chunk
 *       greedy RNNT decode is already stable.
 *     - First interim emit ~560ms after speech starts.
 *
 *   When VAD closes the segment (or hits MAX_SEGMENT_MS for a soft commit):
 *     - Run a final pass on the full segment
 *     - Emit { isFinal: true, confidence: 0.9 }
 *     - Reset session state for the next segment
 */

import { EventEmitter } from 'events';
import { Worker } from 'worker_threads';
import { resampleToF32 } from './whisper/audioResampler';
import { VadProcessor } from './whisper/vadProcessor';
import { filterHallucination } from './whisper/hallucinationFilter';
import { configureTransformersCache } from './whisper/modelManager';
import { clearLoadSentinel, modelPreloader, writeLoadSentinel } from './whisper/modelPreloader';
import { buildWorkerInitMessage } from './whisper/inferenceConfig';
import { resolveWhisperWorkerPath } from './whisper/workerPathResolver';
import type { WorkerOutMessage } from './whisper/types';
import { acquireOnnxSlot, hasEnoughMemoryForOnnxSession, getMinFreeGBForOnnxSession } from '../utils/onnxThreadConfig';
import { resolveNemotronLangId } from './whisper/nemotron/languageTable';
import { acquireSharedNemotronWorker } from './whisper/nemotron/sharedWorkerRegistry';
import { RECOGNITION_LANGUAGES } from '../config/languages';

export class LocalWhisperSTT extends EventEmitter {
    private readonly modelId: string;
    private inputSampleRate = 48000;
    private language = 'auto';
    // Optional context-biasing prompt sent out-of-band to the worker via
    // `setPrompt` messages. The worker tokenizes once and reuses the IDs
    // for every transcribe (see whisperWorker.ts updatePromptCache). 224
    // Whisper-decoder tokens cap is enforced worker-side. No-op for Moonshine.
    private contextPrompt = '';
    private contextPromptSentToWorker = '';
    // Char-length cap to prevent enormous strings from being copied through
    // worker IPC. ~8KB is well above 224 Whisper tokens (~3-4 chars/token).
    private static readonly PROMPT_MAX_CHARS = 8000;

    // ── Latency telemetry ──────────────────────────────────────────────
    // Perceived latency tracking. Two metrics:
    //   firstPartial = ms from VAD opening a segment → first agreed/committed
    //                  prefix emit (LocalAgreement-2 needs two streaming ticks
    //                  to converge, so this is NOT "first inference time").
    //   final        = ms from VAD opening a segment → final transcript emit.
    // Boundary detection uses VadProcessor.currentSegmentId() (monotonic
    // counter) instead of boolean edges on isInSpeech() — boolean edges miss
    // open+close-in-one-push and close+open-in-one-push patterns.
    private trackedSegmentId = 0;
    private segmentOpenedAt = 0;
    private firstPartialEmittedForSegment = 0;
    private firstPartialLatencies: number[] = [];
    private finalLatencies: number[] = [];
    private static readonly LATENCY_WINDOW = 100;
    private static readonly LATENCY_LOG_EVERY = 20;
    // Sanity clamp: any latency outside this range is treated as a tracking
    // bug (e.g. clock issue, missed segment id) and discarded so it can't
    // pollute p95/p99.
    private static readonly LATENCY_MAX_MS = 60_000;
    private latencyLogCounter = 0;
    // Optional channel label ('mic' / 'system') — disambiguates log lines
    // when both LocalWhisperSTT instances run the same model.
    private channelLabel = '';
    private worker: Worker | null = null;
    private vad: VadProcessor | null = null;
    private isActive = false;
    // Cross-loader ONNX gate slot. Acquired in spawnWorker() before posting
    // init; released in worker error/exit handlers so other ONNX consumers
    // (LocalReranker / LocalEmbeddingProvider / IntentClassifier) can take
    // the slot promptly. Whisper uses priority 'high' so its streaming loop
    // acquires before queued normal-priority consumers.
    private slotRelease: (() => void) | null = null;
    private taskCounter = 0;
    private workerReady = false;
    private isDrainingFinals = false;
    private drainingFinalsInFlight = 0;
    // Pending audio waiting for the worker to become ready. Always finals —
    // streaming partials are never queued (they're best-effort and only fire
    // while a segment is open AND the worker is ready).
    private pendingAudio: Array<{ audio: Float32Array; nemotronReset: boolean }> = [];

    // nemotron-rnnt only: how many samples of the CURRENT open VAD segment have
    // already been sent to the (stateful) worker engine. Reset to 0 at every
    // segment boundary (see dispatchFinal). Always 0 for every other model,
    // which ignores this field entirely and keeps sending the full cumulative
    // buffer every tick, as before.
    private nemotronSentSamples = 0;
    private readonly isNemotronModel: boolean;

    // Dual-channel Nemotron only. The channel identity this instance
    // registered with the shared worker (see
    // ./whisper/nemotron/sharedWorkerRegistry.ts) — reuses `channelLabel`
    // ('mic'/'system', set via setChannel() by main.ts right after
    // construction for every STT provider including Nemotron). Falls back to
    // a generated id if channelLabel is ever empty (defensive — real app
    // flow always sets it before start(), confirmed via main.ts's
    // createSTTProvider()). Used both to route worker messages to the
    // correct engine/chain and to filter incoming worker messages that
    // belong to the OTHER channel sharing this same worker (see
    // attachWorkerListeners below).
    private nemotronChannelId: string | null = null;
    // The registry's release() for this channel — decrements its refcount on
    // the shared worker; the worker itself only actually terminates once
    // every channel has released. Null for every non-Nemotron model (those
    // never call acquireSharedNemotronWorker at all).
    private nemotronWorkerRelease: (() => void) | null = null;

    // Dual-channel Nemotron only. The EXACT handler function references this
    // instance attached to the (possibly SHARED) worker via attachWorkerListeners(),
    // so beginWorkerTermination() can remove ONLY this instance's own listeners
    // via worker.off(event, handler) — never removeAllListeners(), which would
    // also strip the other channel's listeners and sharedWorkerRegistry.ts's
    // own listener off the same shared Worker object. Null for every
    // non-Nemotron model (those workers are never shared, so removeAllListeners
    // remains correct and simpler for them).
    private nemotronMessageHandler: ((msg: WorkerOutMessage) => void) | null = null;
    private nemotronErrorHandler: ((err: Error) => void) | null = null;
    private nemotronExitHandler: ((code: number) => void) | null = null;

    // nemotron-rnnt only: resolved NVIDIA PROMPT_DICTIONARY lang_id (see
    // ./whisper/nemotron/languageTable.ts), derived from `this.language` via
    // resolveAndApplyNemotronLanguage(). Defaults to 0 — the same value
    // NemotronEngine's own DEFAULT_LANG_ID falls back to (English,
    // task-11-fix1-report.md) — so an instance that's never had its language
    // explicitly (re)resolved still matches the engine's built-in default,
    // not an arbitrary sentinel. Ignored entirely by every other model.
    private nemotronLangId = 0;
    // Last langId actually pushed to the CURRENT worker, so
    // maybePushNemotronLangToWorker only posts on real change (same
    // "only on change" convention as contextPromptSentToWorker /
    // maybePushPromptToWorker). Reset to null in beginWorkerTermination —
    // a future worker starts without this state applied and must be re-sent.
    private nemotronLangIdSentToWorker: number | null = null;

    // Gap-flush: ensures a segment closes even if Rust SilenceSuppressor
    // stops sending audio before VAD's hangover completes.
    private gapFlushTimer: ReturnType<typeof setTimeout> | null = null;
    private static readonly GAP_FLUSH_MS = 400;
    // 5s grace timer for the previous worker to finish in-flight transcribes
    // before we terminate it. Tracked so rapid stop/start cycles or app quit
    // don't pin the event loop with stale termination timers.
    private workerTerminateTimer: ReturnType<typeof setTimeout> | null = null;

    // Streaming inference loop state.
    // Self-chaining setTimeout (not setInterval) so the delay can adapt at
    // each tick — the worker can be slower than STREAMING_INTERVAL_MS for
    // larger models (whisper-medium ~3-5s, whisper-large ~5-10s); piling up
    // ticks against an in-flight inference just churns the JS event loop.
    private streamingTimer: ReturnType<typeof setTimeout> | null = null;
    // Tuned per model family at construction time (see resolveStreamingProfile).
    private readonly streamingIntervalBaseMs: number;
    private readonly streamingMinAudioMs: number;
    private readonly skipAgreement: boolean;
    private static readonly STREAMING_INTERVAL_MAX_MS = 12000;
    private static readonly MAX_SEGMENT_MS = 14000;       // soft-commit before VAD's 15s hard-flush
    // Backoff: count consecutive ticks where we couldn't dispatch (worker
    // busy or no open segment with enough audio). After 3 in a row, double
    // the next delay; reset to base on a successful dispatch.
    private streamingStallCount = 0;
    private streamingNextDelayMs = 0; // set in constructor from streamingIntervalBaseMs
    // Watchdog: if the worker takes longer than this on an in-flight streaming
    // task we assume it's stuck (hypothesis: GPU lock, deadlock, dead pointer)
    // and force-clear the in-flight state so the loop can recover. Without
    // this, a stuck worker permanently pins streamingTaskInFlight=true and
    // every subsequent tick is a no-op stall (transcription appears to stop
    // after 3-4 questions once the worker gets wedged).
    private streamingWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
    private static readonly STREAMING_WATCHDOG_MS = 30000;

    // LocalAgreement-2 state. We hold the last partial transcript, and when
    // the next partial arrives we emit the longest common prefix as the
    // "stable" interim. The lastEmittedText is what we've already shown.
    private lastPartialText = '';
    private lastEmittedText = '';
    private streamingTaskInFlight = false;
    private streamingTaskId: string | null = null;
    /** Log-throttle state for a deterministic worker error repeating per audio window. */
    private lastWorkerErrorMessage: string | null = null;
    private repeatedWorkerErrorCount = 0;

    constructor(modelId: string) {
        super();
        this.modelId = modelId;
        this.isNemotronModel = LocalWhisperSTT.isNemotronModelId(modelId);
        configureTransformersCache();

        // Tune the streaming loop for this specific model's characteristics.
        // Moonshine: ~100ms inference, deterministic single-pass output, no
        // 30s padding. We can poll faster, dispatch on shorter audio, and
        // skip LocalAgreement-2's two-pass stability check (which adds an
        // entire tick of latency).
        // Whisper / Distil-Whisper: ~500ms-5s inference, conservative
        // params, LA-2 needed for stability.
        const profile = LocalWhisperSTT.resolveStreamingProfile(modelId);
        this.streamingIntervalBaseMs = profile.intervalMs;
        this.streamingMinAudioMs = profile.minAudioMs;
        this.skipAgreement = profile.skipAgreement;
        this.streamingNextDelayMs = this.streamingIntervalBaseMs;
        console.log(`[LocalWhisperSTT] streaming profile for ${modelId}: interval=${profile.intervalMs}ms minAudio=${profile.minAudioMs}ms skipAgreement=${profile.skipAgreement}`);
    }

    private static isNemotronModelId(modelId: string): boolean {
        return modelId.toLowerCase().includes('nemotron');
    }

    /**
     * Per-model streaming-loop profile. Faster, more aggressive parameters
     * for streaming-class models (Moonshine) — they finish each pass in
     * <200ms and produce stable output, so we can poll often and emit
     * partials directly without LocalAgreement-2's two-pass confirmation.
     */
    private static resolveStreamingProfile(modelId: string): { intervalMs: number; minAudioMs: number; skipAgreement: boolean } {
        // Loose match — covers `onnx-community/moonshine-*`, `usefulsensors/
        // moonshine-*`, and any future fork that keeps "moonshine" in the
        // path. Falls back to Whisper-safe defaults on no match.
        // TODO: validate the 750/400 numbers against measured first-partial
        // p50 once a Moonshine model is downloaded; expect <600ms.
        if (modelId.toLowerCase().includes('moonshine')) {
            return { intervalMs: 750, minAudioMs: 400, skipAgreement: true };
        }
        // Nemotron 3.5 ASR Streaming (sessionLayout: 'nemotron-rnnt' in
        // MODEL_CATALOG) — the ONLY model in this catalog with genuinely
        // chunked streaming inference: the ONNX export itself processes
        // audio in fixed 8960-sample (560ms @ 16kHz) chunks with cross-call
        // cache state (NemotronEngine.pushAudio, worker-side). Unlike
        // Moonshine's 750ms figure (a tunable polling rate chosen for
        // measured first-partial latency), 560ms here is NOT tunable — it's
        // dictated by the export's chunk size, so intervalMs/minAudioMs are
        // both pinned to it rather than picked independently. Skips
        // LocalAgreement-2 for the same reason as Moonshine: the worker's
        // per-chunk greedy RNNT decode is already stable, so there's no
        // ambiguous partial to stabilize across two passes.
        if (LocalWhisperSTT.isNemotronModelId(modelId)) {
            return { intervalMs: 560, minAudioMs: 560, skipAgreement: true };
        }
        return { intervalMs: 1500, minAudioMs: 800, skipAgreement: false };
    }

    setSampleRate(rate: number): void { this.inputSampleRate = rate; }
    setAudioChannelCount(_count: number): void {}
    setRecognitionLanguage(key: string): void {
        this.language = key || 'auto';
        if (this.isNemotronModel) this.resolveAndApplyNemotronLanguage();
    }
    setCredentials(_credPath: string): void {}

    /**
     * Optional human-readable channel label (e.g. 'mic', 'system') for log
     * disambiguation when both LocalWhisperSTT instances use the same model.
     */
    setChannel(label: string): void { this.channelLabel = (label ?? '').trim(); }

    /**
     * Set a context-biasing prompt (proper nouns, jargon, attendee names).
     * Pushed to the worker out-of-band only when the value actually changes.
     * Empty string disables biasing. Worker truncates to 224 Whisper tokens
     * (front of string preserved) and skips entirely for Moonshine. Safe to
     * call mid-stream — the worker applies the new prompt to subsequent
     * transcribes only; the in-flight one continues with the previous cache.
     */
    setContext(prompt: string): void {
        let trimmed = (prompt ?? '').trim();
        if (trimmed.length > LocalWhisperSTT.PROMPT_MAX_CHARS) {
            trimmed = trimmed.slice(0, LocalWhisperSTT.PROMPT_MAX_CHARS);
        }
        this.contextPrompt = trimmed;
        this.maybePushPromptToWorker();
    }

    private maybePushPromptToWorker(): void {
        if (!this.worker || !this.workerReady) return; // pushed in flushPending after ready
        if (this.contextPrompt === this.contextPromptSentToWorker) return;
        this.worker.postMessage({ type: 'setPrompt', prompt: this.contextPrompt });
        this.contextPromptSentToWorker = this.contextPrompt;
    }

    /**
     * nemotron-rnnt only: resolves `this.language` (the app's internal
     * settings key, e.g. 'english-us' / 'french' / 'auto' — see
     * electron/config/languages.ts's RECOGNITION_LANGUAGES, keyed by that
     * same `code` field, not raw BCP-47) to its BCP-47 locale, then to a
     * NVIDIA PROMPT_DICTIONARY lang_id via resolveNemotronLangId(). Called
     * from setRecognitionLanguage() whenever the language changes (including
     * at construction time — createSTTProvider() in main.ts calls
     * setRecognitionLanguage() immediately after `new LocalWhisperSTT(...)`,
     * before start() or any listener is attached).
     *
     * 'auto' → English, not fail-closed: 'auto' IS a real, user-selectable
     * RECOGNITION_LANGUAGES entry ("Auto Detect") — the language table's own
     * doc comment claiming this app "never sends Nemotron literal auto" was
     * wrong, corrected here. Nemotron has no real auto-detect mode (its
     * lang_id conditioning requires one explicit locale per session), so
     * this follows the SAME precedent AppState.setRecognitionLanguage
     * already applies for every other non-NativelyProSTT provider (main.ts:
     * "'auto' is only meaningful for NativelyProSTT — other providers fall
     * back to en-US"). This normalization must also live HERE, not only at
     * that call site, because createSTTProvider() (main.ts) calls
     * setRecognitionLanguage() with the RAW persisted value at construction
     * time — that particular call site does NOT go through
     * AppState.setRecognitionLanguage's own 'auto' normalization. Without
     * this, any user who previously picked "Auto Detect" would hit the
     * fail-closed path below on every app launch while on the Nemotron
     * model — surfacing as a disruptive "reconnecting"/eventually "failed"
     * STT status (main.ts's stt.on('error', ...) treats any non-auth/quota
     * error as retryable-then-fatal after 5 occurrences), not a one-time
     * settings notice.
     *
     * Fail-closed (per the design doc's error-handling section) for
     * everything else unmapped: any of the 21 non-"transcription-ready"
     * locales, or a RECOGNITION_LANGUAGES key with no BCP-47 mapping at all
     * — does NOT silently fall back to English. `nemotronLangId` is left at
     * whatever it last successfully resolved to (defaulting to 0/English,
     * matching NemotronEngine's own DEFAULT_LANG_ID, until the first
     * successful resolution), and an 'error' is surfaced via the same event
     * this class already uses for other unrecoverable-config problems (e.g.
     * spawnWorker's ONNX-slot failure path, the streaming-watchdog path
     * above).
     */
    private resolveAndApplyNemotronLanguage(): void {
        const attemptedKey = this.language;
        const effectiveKey = attemptedKey === 'auto' ? 'english-us' : attemptedKey;
        const bcp47 = RECOGNITION_LANGUAGES[effectiveKey]?.bcp47;
        const langId = bcp47 ? resolveNemotronLangId(bcp47) : null;
        if (langId === null) {
            // Deferred via setImmediate, not emitted synchronously: this
            // method can run during construction, synchronously inside
            // setRecognitionLanguage(), BEFORE createSTTProvider() (main.ts)
            // has wired an 'error' listener on the returned instance — a
            // synchronous emit here with no listener yet attached would
            // throw per Node's EventEmitter contract (unhandled 'error'
            // event) and crash STT provider creation outright. Deferring one
            // tick lets the caller's synchronous listener-wiring finish
            // first, matching how every other 'error' emit in this class is
            // already reached only via an async callback (worker message,
            // timer, promise rejection) scheduled well after construction.
            const keptLangId = this.nemotronLangId;
            setImmediate(() => {
                this.emit('error', new Error(
                    `Nemotron STT: recognition language "${attemptedKey}"` +
                    (bcp47 ? ` (resolved locale "${bcp47}")` : ' (no BCP-47 mapping found)') +
                    ' is not in the transcription-ready set — keeping the previous Nemotron ' +
                    `language (lang_id=${keptLangId}) rather than silently falling back to English.`,
                ));
            });
            return;
        }
        this.nemotronLangId = langId;
        this.maybePushNemotronLangToWorker();
    }

    private maybePushNemotronLangToWorker(): void {
        if (!this.worker || !this.workerReady) return; // pushed in flushPending after ready
        if (this.nemotronLangId === this.nemotronLangIdSentToWorker) return;
        this.worker.postMessage({ type: 'setLanguage', langId: this.nemotronLangId, channelId: this.nemotronChannelId });
        this.nemotronLangIdSentToWorker = this.nemotronLangId;
    }

    start(): void {
        if (this.isActive) return;
        this.isDrainingFinals = false;
        this.drainingFinalsInFlight = 0;
        this.isActive = true;
        this.vad = new VadProcessor();
        this.spawnWorker().catch((err) => {
            // Gate refusal or worker spawn failure (e.g. insufficient memory for
            // the ONNX session). There is NO retry path, so we must NOT leave a
            // live streaming loop + VAD churning with worker=null — that silently
            // drops every audio segment (dispatchFinal early-returns on !worker)
            // and leaks a self-chaining 12s streaming timer for the whole session.
            // Tear the instance back down to a clean inactive no-op (write() then
            // no-ops on !isActive/!vad) and surface the error so the supervisor
            // can fall back to cloud STT.
            console.error('[LocalWhisperSTT] spawnWorker failed:', err);
            this.stopStreamingLoop();
            if (this.gapFlushTimer) {
                clearTimeout(this.gapFlushTimer);
                this.gapFlushTimer = null;
            }
            this.vad = null;
            this.isActive = false;
            this.workerReady = false;
            this.emit('error', err instanceof Error ? err : new Error(String(err)));
        });
        this.startStreamingLoop();
    }

    stop(): void {
        if (!this.isActive) return;
        this.isActive = false;

        this.stopStreamingLoop();
        if (this.gapFlushTimer) {
            clearTimeout(this.gapFlushTimer);
            this.gapFlushTimer = null;
        }

        if (this.vad) {
            const segs = this.vad.flush();
            this.vad = null;
            this.isDrainingFinals = true;
            segs.forEach(s => this.dispatchFinal(s.samples));
        }

        this.resetAgreementState();

        // Print one final latency summary for the just-ended session, then
        // reset windows so the next start() starts with a clean slate.
        if (this.firstPartialLatencies.length > 0 || this.finalLatencies.length > 0) {
            this.logLatencySummary();
        }
        this.firstPartialLatencies = [];
        this.finalLatencies = [];
        this.segmentOpenedAt = 0;
        this.firstPartialEmittedForSegment = 0;
        this.trackedSegmentId = 0;
        this.latencyLogCounter = 0;

        const w = this.worker;
        if (w) {
            const shouldKeepWorkerForFinals = this.isDrainingFinals && (this.pendingAudio.length > 0 || this.drainingFinalsInFlight > 0);
            if (shouldKeepWorkerForFinals) return;
            this.beginWorkerTermination(w);
        }
    }

    write(chunk: Buffer): void {
        if (!this.isActive || !this.vad) return;
        const f32 = resampleToF32(chunk, this.inputSampleRate);
        const segs = this.vad.push(f32);
        segs.forEach(s => this.dispatchFinal(s.samples));

        // Soft-commit: if a segment has grown past MAX_SEGMENT_MS, force a
        // final pass and start a new (tail-keep) segment. The softCommit
        // bumps the segment id, so the boundary check below picks it up.
        const open = this.vad.peekOpenSegment();
        if (open && open.durationMs >= LocalWhisperSTT.MAX_SEGMENT_MS) {
            const committed = this.vad.softCommit();
            if (committed) this.dispatchFinal(committed.samples);
        }

        // Telemetry: re-stamp segmentOpenedAt whenever the open VAD segment
        // is a different one than we last tracked. ID-based detection
        // correctly handles open+close-in-one-push (two new segments seen
        // within a single write) and close+open-in-one-push (id rises but
        // isInSpeech stays true).
        if (this.vad.isInSpeech()) {
            const id = this.vad.currentSegmentId();
            if (id !== this.trackedSegmentId) {
                this.trackedSegmentId = id;
                this.segmentOpenedAt = performance.now();
                this.firstPartialEmittedForSegment = 0;
            }
        }

        // Reset gap-flush timer.
        if (this.gapFlushTimer) clearTimeout(this.gapFlushTimer);
        this.gapFlushTimer = setTimeout(() => {
            this.gapFlushTimer = null;
            if (this.isActive && this.vad) {
                const pending = this.vad.flush();
                pending.forEach(s => this.dispatchFinal(s.samples));
            }
        }, LocalWhisperSTT.GAP_FLUSH_MS);
    }

    finalize(): void {
        if (!this.isActive || !this.vad) return;
        const segs = this.vad.flush();
        segs.forEach(s => this.dispatchFinal(s.samples));
    }

    /* ──────────────── Streaming inference loop ──────────────── */

    private startStreamingLoop(): void {
        if (this.streamingTimer) return;
        this.streamingNextDelayMs = this.streamingIntervalBaseMs;
        this.streamingStallCount = 0;
        this.scheduleNextStreamingTick();
    }

    private scheduleNextStreamingTick(): void {
        if (!this.isActive) return;
        this.streamingTimer = setTimeout(() => {
            this.streamingTimer = null;
            // Wrap tick in try/catch — a throw here (worker disposed mid-post,
            // VAD nulled, etc.) would otherwise leave the chain unscheduled
            // and silently kill all partials for the rest of the session.
            try {
                this.streamingTick();
            } catch (e) {
                console.warn('[LocalWhisperSTT] streamingTick threw, continuing loop:', e);
                // Treat as a stall so the backoff timer kicks in if the
                // throw is persistent (e.g. recurring postMessage error).
                this.recordStreamingStall();
            }
            this.scheduleNextStreamingTick();
        }, this.streamingNextDelayMs);
    }

    private stopStreamingLoop(): void {
        if (this.streamingTimer) {
            clearTimeout(this.streamingTimer);
            this.streamingTimer = null;
        }
        this.clearStreamingWatchdog();
        this.streamingTaskInFlight = false;
        this.streamingTaskId = null;
        this.streamingStallCount = 0;
        this.streamingNextDelayMs = this.streamingIntervalBaseMs;
    }

    private armStreamingWatchdog(): void {
        this.clearStreamingWatchdog();
        this.streamingWatchdogTimer = setTimeout(() => {
            this.streamingWatchdogTimer = null;
            if (!this.streamingTaskInFlight) return;
            console.warn(`[LocalWhisperSTT] Streaming watchdog fired after ${LocalWhisperSTT.STREAMING_WATCHDOG_MS}ms — worker is stuck, force-clearing in-flight task`);
            const stuckTaskId = this.streamingTaskId;
            this.streamingTaskInFlight = false;
            this.streamingTaskId = null;
            this.streamingStallCount = 0;
            this.streamingNextDelayMs = this.streamingIntervalBaseMs;
            // nemotron-rnnt only: the wedged dispatch's samples never reached
            // (or never returned from) the engine, so nemotronSentSamples now
            // overcounts what the engine actually has. Unlike the cumulative
            // path (self-healing by construction — it always resends
            // everything), the delta path needs an explicit rewind: reset the
            // cursor so the NEXT tick resends the full open segment with
            // nemotronReset:true, forcing a clean NemotronEngine.reset() +
            // full re-decode instead of silently gapping the lost audio.
            if (this.isNemotronModel) this.nemotronSentSamples = 0;
            this.emit('error', new Error(
                `Local Whisper streaming task ${stuckTaskId ?? '?'} did not return within ${LocalWhisperSTT.STREAMING_WATCHDOG_MS}ms — worker likely stuck, unblocking next tick.`
            ));
        }, LocalWhisperSTT.STREAMING_WATCHDOG_MS);
    }

    private clearStreamingWatchdog(): void {
        if (this.streamingWatchdogTimer) {
            clearTimeout(this.streamingWatchdogTimer);
            this.streamingWatchdogTimer = null;
        }
    }

    private streamingTick(): void {
        if (!this.isActive || !this.vad || !this.workerReady || !this.worker) {
            this.recordStreamingStall();
            return;
        }
        // Cheap early-return: skip the peekOpenSegment allocation when the
        // VAD isn't currently in a speech segment.
        if (!this.vad.isInSpeech()) { this.recordStreamingStall(); return; }
        // Don't stack streaming requests — wait for the previous one to finish.
        if (this.streamingTaskInFlight) { this.recordStreamingStall(); return; }

        const open = this.vad.peekOpenSegment();
        if (!open || open.durationMs < this.streamingMinAudioMs) {
            this.recordStreamingStall();
            return;
        }

        // Successful dispatch — reset backoff to base interval.
        this.streamingStallCount = 0;
        this.streamingNextDelayMs = this.streamingIntervalBaseMs;

        this.streamingTaskInFlight = true;
        const taskId = `s${++this.taskCounter}`;
        this.streamingTaskId = taskId;
        // Pinned to the ArrayBuffer-backed generic (not the wider default
        // Float32Array<ArrayBufferLike>) so `.buffer` stays assignable to
        // Worker.postMessage's `Transferable` transfer-list type — `.slice()`
        // always creates a fresh ArrayBuffer, never a SharedArrayBuffer.
        let copy: Float32Array<ArrayBuffer>;
        let nemotronReset = false;
        if (this.isNemotronModel) {
            // Send only what's new since the last tick. `open.samples` keeps
            // growing (VAD hasn't closed this segment); slice(cursor) is the delta.
            nemotronReset = this.nemotronSentSamples === 0;
            copy = open.samples.slice(this.nemotronSentSamples);
            this.nemotronSentSamples = open.samples.length;
        } else {
            copy = open.samples.slice();
        }
        // Logged BEFORE arming, deliberately: LocalWhisperStuckWorker.test.mjs
        // asserts armStreamingWatchdog() and worker.postMessage sit within 200
        // characters of each other, as a proxy for "both on the same dispatch
        // path". Putting this between them breaks that proximity check without
        // changing behaviour, so it goes above instead.
        if (this.isNemotronModel) {
            console.log(
                `[LocalWhisperSTT/${this.channelLabel}] → transcribe ${taskId}: ${copy.length} samples ` +
                `(${Math.round((copy.length / 16000) * 1000)}ms delta, segment=${Math.round(open.durationMs)}ms, reset=${nemotronReset})`,
            );
        }
        this.armStreamingWatchdog();
        this.worker.postMessage(
            { type: 'transcribe', taskId, audio: copy, language: this.language, streaming: true, nemotronReset, channelId: this.nemotronChannelId },
            [copy.buffer]
        );
    }

    private recordStreamingStall(): void {
        this.streamingStallCount++;
        // After 3 consecutive stalls, exponentially back off so we stop
        // spinning while the worker is processing a slow model. Reset only
        // happens on a real dispatch.
        if (this.streamingStallCount >= 3) {
            this.streamingNextDelayMs = Math.min(
                LocalWhisperSTT.STREAMING_INTERVAL_MAX_MS,
                this.streamingNextDelayMs * 2
            );
        }
    }

    /**
     * LocalAgreement-2: commit the longest common prefix between the previous
     * partial and this one. The first partial of a segment seeds the
     * baseline (no emit — agreement requires two passes). Subsequent passes
     * emit only the *new* committed text as an interim transcript.
     */
    private handleStreamingPartial(text: string): void {
        this.clearStreamingWatchdog();
        this.streamingTaskInFlight = false;
        // Worker just became free → recover from any backoff state so the
        // next dispatch fires at the base interval instead of waiting out
        // the doubled delay scheduled while the worker was busy.
        this.streamingStallCount = 0;
        this.streamingNextDelayMs = this.streamingIntervalBaseMs;

        const cleaned = filterHallucination(text);
        if (!cleaned) return;

        // Streaming-class models (Moonshine) produce stable, deterministic
        // output — emit each partial directly. Skipping LA-2's two-pass
        // confirmation cuts an entire tick of latency (~750ms) off the
        // first-text time. The trade-off is occasional flicker on the last
        // word as the model refines, but partial transcripts already carry
        // confidence=0.7 to signal "may change" to consumers.
        if (this.skipAgreement) {
            // Skip duplicate emits when the model produces identical text
            // for consecutive ticks (stable utterance, no new audio).
            if (cleaned !== this.lastEmittedText) {
                this.lastEmittedText = cleaned;
                this.recordFirstPartialLatencyOnce();
                this.emit('transcript', {
                    text: cleaned.trim(),
                    isFinal: false,
                    confidence: 0.7,
                });
            }
            return;
        }

        // LocalAgreement-2 path (Whisper / Distil-Whisper): need two
        // overlapping passes to converge on a stable committed prefix.
        if (this.lastPartialText === '') {
            this.lastPartialText = cleaned;
            return;
        }

        const agreed = this.longestCommonPrefix(this.lastPartialText, cleaned);
        this.lastPartialText = cleaned;

        if (agreed.length > this.lastEmittedText.length) {
            this.lastEmittedText = agreed;
            this.recordFirstPartialLatencyOnce();
            this.emit('transcript', {
                text: this.lastEmittedText.trim(),
                isFinal: false,
                confidence: 0.7,
            });
        }
    }

    private recordFirstPartialLatencyOnce(): void {
        if (this.segmentOpenedAt > 0 && this.firstPartialEmittedForSegment !== this.trackedSegmentId) {
            const dt = performance.now() - this.segmentOpenedAt;
            if (dt > 0 && dt < LocalWhisperSTT.LATENCY_MAX_MS) {
                this.recordLatency(this.firstPartialLatencies, dt);
            }
            this.firstPartialEmittedForSegment = this.trackedSegmentId;
        }
    }

    /* ──────────────── Latency telemetry helpers ──────────────── */

    private recordLatency(arr: number[], ms: number): void {
        arr.push(ms);
        if (arr.length > LocalWhisperSTT.LATENCY_WINDOW) arr.shift();
        this.latencyLogCounter++;
        if (this.latencyLogCounter >= LocalWhisperSTT.LATENCY_LOG_EVERY) {
            this.latencyLogCounter = 0;
            this.logLatencySummary();
        }
    }

    private percentile(sorted: number[], p: number): number {
        if (sorted.length === 0) return 0;
        const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
        return Math.round(sorted[idx]);
    }

    private logLatencySummary(): void {
        const fp = [...this.firstPartialLatencies].sort((a, b) => a - b);
        const fn = [...this.finalLatencies].sort((a, b) => a - b);
        const fmt = (s: number[]) => s.length === 0
            ? 'n=0'
            : `n=${s.length} p50=${this.percentile(s, 50)}ms p95=${this.percentile(s, 95)}ms p99=${this.percentile(s, 99)}ms`;
        const channelTag = this.channelLabel ? `:${this.channelLabel}` : '';
        console.log(`[LocalWhisperSTT/${this.modelId.split('/').pop()}${channelTag}] latency · first-partial: ${fmt(fp)} · final: ${fmt(fn)}`);
    }

    /** Snapshot for UI / IPC. */
    public getLatencyStats(): { firstPartial: { count: number; p50: number; p95: number; p99: number }; final: { count: number; p50: number; p95: number; p99: number } } {
        const fp = [...this.firstPartialLatencies].sort((a, b) => a - b);
        const fn = [...this.finalLatencies].sort((a, b) => a - b);
        return {
            firstPartial: { count: fp.length, p50: this.percentile(fp, 50), p95: this.percentile(fp, 95), p99: this.percentile(fp, 99) },
            final:        { count: fn.length, p50: this.percentile(fn, 50), p95: this.percentile(fn, 95), p99: this.percentile(fn, 99) },
        };
    }

    private longestCommonPrefix(a: string, b: string): string {
        if (!a || !b) return '';
        const len = Math.min(a.length, b.length);
        let i = 0;
        while (i < len && a[i] === b[i]) i++;
        // Snap back to a word boundary ONLY when we've split mid-word — i.e.
        // both sides of position i are non-whitespace. Without this guard the
        // snap-back walked through the entire prefix and produced ''.
        if (i < a.length && /\S/.test(a[i]) && i > 0 && /\S/.test(a[i - 1])) {
            while (i > 0 && /\S/.test(a[i - 1])) i--;
        }
        return a.slice(0, i);
    }

    private resetAgreementState(): void {
        this.lastPartialText = '';
        this.lastEmittedText = '';
        // Invalidate any in-flight streaming task so its late `partial`
        // response is dropped by the taskId guard below instead of mutating
        // the next segment's agreement baseline.
        this.clearStreamingWatchdog();
        this.streamingTaskId = null;
    }

    /* ──────────────── Final segment dispatch ──────────────── */

    private dispatchFinal(audio: Float32Array): void {
        if (!this.worker) return;

        // A final pass closes the streaming window — clear agreement state so
        // the next segment starts clean.
        this.resetAgreementState();
        this.clearStreamingWatchdog();
        this.streamingTaskInFlight = false;

        let outgoing = audio;
        let nemotronReset = false;
        if (this.isNemotronModel) {
            // `audio` is the segment's FULL samples (VAD hands over the whole
            // closed segment here, not just the tail). Only the part beyond
            // what streaming ticks already sent is new. This also covers a
            // segment that closed before any streaming tick fired (short
            // utterance): nemotronSentSamples is still 0, so the whole segment
            // goes out as the delta, exactly as if it were one big chunk.
            nemotronReset = this.nemotronSentSamples === 0;
            outgoing = audio.length > this.nemotronSentSamples
                ? audio.slice(this.nemotronSentSamples)
                : new Float32Array(0);
            // Segment boundary — the NEXT segment (or a soft-committed
            // continuation of this one) starts from a clean cursor regardless
            // of how much of THIS segment was streamed.
            this.nemotronSentSamples = 0;
        }

        if (!this.workerReady) {
            const MAX_PENDING = 500;
            const item = { audio: outgoing.slice(), nemotronReset };
            if (this.pendingAudio.length < MAX_PENDING) {
                this.pendingAudio.push(item);
            } else {
                console.warn('[LocalWhisperSTT] Pending queue full — dropping oldest segment');
                const dropped = this.pendingAudio.shift();
                if (dropped?.nemotronReset && this.pendingAudio.length > 0) {
                    // Don't lose the segment-boundary reset signal just because
                    // its original item got dropped for capacity — carry it
                    // forward onto the new head so the engine still resets
                    // before replaying the backlog.
                    this.pendingAudio[0].nemotronReset = true;
                }
                this.pendingAudio.push(item);
            }
            return;
        }

        if (this.isDrainingFinals) {
            this.drainingFinalsInFlight++;
        }
        this.sendTranscribe(outgoing, false, nemotronReset);
    }

    private sendTranscribe(audio: Float32Array, streaming: boolean, nemotronReset: boolean = false): void {
        if (!this.worker) return;
        const taskId = `${streaming ? 's' : 't'}${++this.taskCounter}`;
        const copy = audio.slice();
        this.worker.postMessage(
            { type: 'transcribe', taskId, audio: copy, language: this.language, streaming, nemotronReset, channelId: this.nemotronChannelId },
            [copy.buffer]
        );
    }

    /* ──────────────── Worker lifecycle ──────────────── */

    private async spawnWorker(): Promise<void> {
        if (this.isNemotronModel) {
            // Dual-channel Nemotron: route through the shared-worker registry
            // instead of the warm-preload / cold-spawn / direct acquireOnnxSlot
            // path below. The registry decides cold-start vs join and owns
            // the ONE weight:3 ONNX slot acquisition for however many
            // channels end up sharing this model — LocalWhisperSTT no longer
            // calls acquireOnnxSlot directly for Nemotron. modelPreloader's
            // warm-worker path is also skipped entirely for Nemotron (see
            // modelPreloader.preload's own Nemotron guard) so there is never
            // a warm worker to take here in the first place.
            if (!hasEnoughMemoryForOnnxSession()) {
                const heapGB = (process.memoryUsage().heapUsed / 1024 ** 3).toFixed(1);
                throw new Error(
                    `[LocalWhisperSTT] insufficient available memory (<${getMinFreeGBForOnnxSession()}GB) — Whisper init refused (heaped=${heapGB}GB)`,
                );
            }
            const channelId = this.channelLabel || `nemotron-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            this.nemotronChannelId = channelId;
            const initMsg = buildWorkerInitMessage(this.modelId);
            const workerPath = resolveWhisperWorkerPath();
            console.log(`[LocalWhisperSTT] Acquiring shared Nemotron worker for channel "${channelId}"`);
            writeLoadSentinel(this.modelId);
            let worker: Worker;
            let release: () => void;
            try {
                ({ worker, release } = await acquireSharedNemotronWorker(
                    this.modelId,
                    channelId,
                    initMsg.executionProviders ?? ['cpu'],
                    initMsg.cacheDir,
                    workerPath,
                ));
            } catch (err: any) {
                // (2026-08-14 code review, two CONFIRMED findings.)
                //
                // 1. Clear the crash sentinel on ANY JS-level rejection. The
                //    sentinel exists to catch NATIVE aborts that kill the
                //    whole process before any catch can run — in that case
                //    nothing executes here and the sentinel correctly
                //    survives for next launch's poisoned-load recovery. But
                //    if this catch IS running, the app is alive and handling
                //    the failure gracefully (slot timeout, model mismatch,
                //    download/init error) — leaving the sentinel behind made
                //    the NEXT launch silently reset the user's model choice
                //    to tiny.en and show a false "recovered from a crash"
                //    notice, precisely when a user restarts after seeing a
                //    soft STT failure.
                clearLoadSentinel(this.modelId);
                // 2. The corrupt-model purge lived only in this instance's
                //    worker 'message' handler — which is attached AFTER this
                //    await. A Nemotron init failure travels through the
                //    registry's own listener as a pendingReady rejection and
                //    lands HERE instead, so the purge was unreachable: a
                //    corrupt-but-nonzero download stayed "installed" forever
                //    (isNemotronModelCached only checks size > 0) and every
                //    meeting start failed identically. Mirror the
                //    message-handler path's FULL structure — including the
                //    symbol-error guard: a macOS-12 dylib symbol failure is
                //    an environment problem, not corrupt files, and must
                //    never delete a perfectly good download.
                const message = err?.message ?? String(err);
                if (message.includes('Failed to load model')) {
                    const isOnnxSymbolError = message.includes('Symbol not found')
                        || message.includes('__ZNSt3__18to_charsEPcS0_d')
                        || message.includes('libonnxruntime');
                    if (!isOnnxSymbolError) {
                        try {
                            const { isCorruptModelError, purgeCorruptModel } = require('./whisper/modelManager');
                            if (isCorruptModelError(message)) {
                                purgeCorruptModel(this.modelId, message);
                            }
                        } catch (purgeErr) {
                            console.error('[LocalWhisperSTT] Corrupt-model purge failed:', purgeErr);
                        }
                    }
                }
                throw err;
            }
            clearLoadSentinel(this.modelId);
            this.worker = worker;
            this.nemotronWorkerRelease = release;
            // acquireSharedNemotronWorker only resolves once THIS channel's
            // own real `ready` has arrived (whether via a fresh cold-start or
            // by joining an already-loaded worker) — safe to mark ready
            // immediately, same as the warm-worker path below.
            this.workerReady = true;
            this.attachWorkerListeners();
            this.flushPending();
            return;
        }

        const warm = modelPreloader.takeWarmWorker(this.modelId);
        if (warm) {
            console.log(`[LocalWhisperSTT] Using preloaded warm worker for ${this.modelId}`);
            this.worker = warm;
            this.workerReady = true;
            // Inherit the slot release the preloader acquired. Both preloader
            // and our local listeners will call this — it's a no-op the
            // second time.
            this.slotRelease = (warm as any).__slotRelease ?? null;
            this.attachWorkerListeners();
            this.flushPending();
            return;
        }

        // Cold path. Acquire the shared ONNX slot at HIGH priority — Whisper
        // is latency-critical (~750ms real-time streaming) and would deadlock
        // behind a queued embedding batch.
        if (!hasEnoughMemoryForOnnxSession()) {
            const heapGB = (process.memoryUsage().heapUsed / 1024 ** 3).toFixed(1);
            throw new Error(
                `[LocalWhisperSTT] insufficient available memory (<${getMinFreeGBForOnnxSession()}GB) — Whisper init refused (heaped=${heapGB}GB)`,
            );
        }

        this.slotRelease = await acquireOnnxSlot('high', 1);

        console.log(`[LocalWhisperSTT] Cold-starting worker for ${this.modelId}`);
        const workerPath = resolveWhisperWorkerPath();
        writeLoadSentinel(this.modelId);
        this.worker = new Worker(workerPath);
        this.attachWorkerListeners();
        this.worker.postMessage(buildWorkerInitMessage(this.modelId));
    }

    private attachWorkerListeners(): void {
        if (!this.worker) return;

        const messageHandler = (msg: WorkerOutMessage) => {
            // Dual-channel Nemotron: this worker may be SHARED with another
            // LocalWhisperSTT instance (the other audio channel). Every
            // Nemotron-relevant message carries a channelId (see
            // whisperWorker.ts) — filter out anything that doesn't match
            // THIS instance's channel before any further processing, so the
            // two instances never react to each other's ready/progress/
            // partial/result/error. This is an ADDITIONAL, earlier layer on
            // top of the existing taskId-based filtering below (which stays,
            // unchanged, as its own correct check) — not a replacement for
            // it. Messages with no channelId at all (every non-Nemotron
            // model's messages) pass through untouched.
            if (this.isNemotronModel) {
                const msgChannelId = (msg as any).channelId;
                if (msgChannelId !== undefined && msgChannelId !== this.nemotronChannelId) {
                    return;
                }
            }
            if (msg.type === 'ready') {
                clearLoadSentinel(this.modelId);
                this.workerReady = true;
                this.flushPending();
                return;
            }

            // After stop(), allow only the explicitly flushed final segments to
            // return during the 5s drain window; partials and unrelated worker
            // messages remain ignored on a torn-down instance.
            if (!this.isActive && !(this.isDrainingFinals && msg.type === 'result')) return;

            if (msg.type === 'partial') {
                // Drop partials whose segment has already been finalized — the
                // agreement baseline is reset on every final dispatch and the
                // taskId is invalidated, so a late partial would otherwise
                // corrupt the next segment.
                if (msg.taskId !== this.streamingTaskId) {
                    this.streamingTaskInFlight = false;
                    return;
                }
                this.handleStreamingPartial(msg.text);
            } else if (msg.type === 'result') {
                const text = filterHallucination(msg.text);
                if (this.isNemotronModel) {
                    // Distinguishes the three silent outcomes this path had no
                    // way to tell apart: engine returned nothing, engine returned
                    // text that filterHallucination then dropped, or a real emit.
                    const raw = msg.text ?? '';
                    console.log(
                        `[LocalWhisperSTT/${this.channelLabel}] ← result: raw=${raw.length}ch ` +
                        `${raw.length === 0 ? '(ENGINE RETURNED EMPTY)' : JSON.stringify(raw.slice(0, 80))} ` +
                        `→ ${text ? 'EMITTED' : raw.length > 0 ? 'DROPPED BY filterHallucination' : 'nothing to emit'}`,
                    );
                }
                if (text) {
                    if (this.segmentOpenedAt > 0) {
                        const dt = performance.now() - this.segmentOpenedAt;
                        if (dt > 0 && dt < LocalWhisperSTT.LATENCY_MAX_MS) {
                            this.recordLatency(this.finalLatencies, dt);
                        }
                    }
                    this.emit('transcript', { text, isFinal: true, confidence: 0.9 });
                }
                // Reset segment timer regardless of emit (silent finals also close
                // the segment). Next write() that opens a fresh VAD segment will
                // re-stamp via the segment-id check.
                this.segmentOpenedAt = 0;
                if (this.isDrainingFinals) {
                    this.drainingFinalsInFlight = Math.max(0, this.drainingFinalsInFlight - 1);
                    if (this.drainingFinalsInFlight === 0 && this.worker) {
                        this.beginWorkerTermination(this.worker);
                    }
                }
            } else if (msg.type === 'error') {
                // Deduplicate an identical, repeating failure. The streaming loop
                // re-dispatches once per audio window, so a DETERMINISTIC worker
                // error (a bad decoder option, a corrupt model file) is re-raised
                // every ~1.5s: the 2026-08-12 log carried 10,183 byte-identical
                // ERROR lines in one day, which buries every other diagnostic in
                // the file. Log the first few verbatim, then only every 100th
                // with a running count. Behaviour is unchanged — this throttles
                // the LOG, never the transcription.
                if (msg.message === this.lastWorkerErrorMessage) {
                    this.repeatedWorkerErrorCount++;
                    if (this.repeatedWorkerErrorCount <= 3) {
                        console.error('[LocalWhisperSTT] Worker error:', msg.message);
                    } else if (this.repeatedWorkerErrorCount % 100 === 0) {
                        console.error(
                            `[LocalWhisperSTT] Worker error (repeated ${this.repeatedWorkerErrorCount}× — identical, likely deterministic):`,
                            msg.message,
                        );
                    }
                } else {
                    this.lastWorkerErrorMessage = msg.message;
                    this.repeatedWorkerErrorCount = 1;
                    console.error('[LocalWhisperSTT] Worker error:', msg.message);
                }
                if (this.isDrainingFinals && msg.taskId?.startsWith('t')) {
                    this.drainingFinalsInFlight = Math.max(0, this.drainingFinalsInFlight - 1);
                    if (this.drainingFinalsInFlight === 0 && this.worker) {
                        this.beginWorkerTermination(this.worker);
                    }
                }
                // If the failed task was the in-flight streaming one, unblock
                // the loop so the next tick can fire.
                if (msg.taskId && msg.taskId === this.streamingTaskId) {
                    this.streamingTaskInFlight = false;
                    this.streamingTaskId = null;
                    // Worker is free again; reset backoff so next tick is prompt.
                    this.streamingStallCount = 0;
                    this.streamingNextDelayMs = this.streamingIntervalBaseMs;
                    // nemotron-rnnt only: same rewind as the watchdog path
                    // above — this dispatch's samples never landed, so the
                    // cursor would otherwise overcount what the engine has.
                    if (this.isNemotronModel) this.nemotronSentSamples = 0;
                }
                if (msg.message.includes('Failed to load model')) {
                    const isOnnxSymbolError = msg.message.includes('Symbol not found')
                        || msg.message.includes('__ZNSt3__18to_charsEPcS0_d')
                        || msg.message.includes('libonnxruntime');

                    // The files are present but unreadable — almost always a
                    // truncated download that isModelCached waved through on its
                    // `size > 0` check. Remove them so the cache check stops
                    // reporting the model as installed and the next Install
                    // actually re-fetches. Without this the state is permanent:
                    // cached-but-corrupt reads as cached forever.
                    let purged = false;
                    if (!isOnnxSymbolError) {
                        try {
                            const { isCorruptModelError, purgeCorruptModel } = require('./whisper/modelManager');
                            if (isCorruptModelError(msg.message)) {
                                purged = purgeCorruptModel(this.modelId, msg.message);
                            }
                        } catch (e) {
                            console.error('[LocalWhisperSTT] Corrupt-model purge failed:', e);
                        }
                    }

                    this.emit('error', new Error(
                        isOnnxSymbolError
                            ? 'Local Whisper is not supported on macOS 12 (Monterey) or earlier. Please upgrade to macOS 13 Ventura or later, or use a cloud STT provider.'
                            // The old copy said "model not found" for this case, which was
                            // wrong twice over: the files were there, and it pointed the
                            // user at a download that silently no-opped because the model
                            // still counted as cached.
                            : purged
                                ? 'The local model files were incomplete and have been removed. Please reinstall the model in Settings → Audio.'
                                : 'Local Whisper model not found. Please download a model in Settings → Audio.'
                    ));
                }
            }
        };
        this.worker.on('message', messageHandler);

        const errorHandler = (err: Error) => {
            // Reset all in-flight streaming state so a dead worker can never
            // permanently pin streamingTaskInFlight=true (which would freeze
            // the loop — symptom: transcription stops after 3-4 questions).
            this.clearStreamingWatchdog();
            this.streamingTaskInFlight = false;
            this.streamingTaskId = null;
            // nemotron-rnnt only: same delta-cursor rewind as the watchdog
            // force-clear and streaming-task-error paths. Audio dispatched to
            // a now-dead worker never reached the engine — a stale cursor
            // would make the segment's eventual final dispatch a mis-sliced
            // tail-only delta with nemotronReset:false. (2026-08-14 review.)
            if (this.isNemotronModel) this.nemotronSentSamples = 0;
            // Free the shared ONNX gate slot — Whisper's session is gone.
            if (this.slotRelease) { this.slotRelease(); this.slotRelease = null; }
            // Dual-channel Nemotron: the registry's OWN 'error' listener
            // (attached once, when the shared worker was cold-started) is
            // what actually resets registry state + releases the real ONNX
            // slot on a genuine crash — it fires independently of this
            // listener (Node supports multiple listeners per event). Null
            // this out purely so a later stop()/beginWorkerTermination on
            // this now-dead instance doesn't try to act on a stale release
            // reference; releaseChannel() is idempotent/stale-safe regardless.
            this.nemotronWorkerRelease = null;
            this.workerReady = false;
            // Symmetric with the exit handler below: a worker `error` is
            // followed by a non-zero `exit` in node:worker_threads, so the
            // exit handler also calls recordLoadFailure. Calling here too is
            // belt-and-braces for the theoretical error-without-exit case
            // (e.g. a hard native abort that races the parent). Idempotent
            // because recordLoadFailure only sets a map expiry, never clears.
            modelPreloader.recordLoadFailure(this.modelId);
            const isOnnxSymbolError = err.message.includes('Symbol not found')
                || err.message.includes('to_chars')
                || err.message.includes('libonnxruntime');
            if (isOnnxSymbolError) {
                this.emit('error', new Error(
                    'Local Whisper is not supported on macOS 12 (Monterey) or earlier. Please upgrade to macOS 13 Ventura or later, or use a cloud STT provider.'
                ));
            } else {
                this.emit('error', err);
            }
        };
        this.worker.on('error', errorHandler);

        // 'exit' fires whenever the worker terminates (voluntarily or not),
        // including the 'error' path above. If the worker is gone, the
        // streaming loop must be unblocked — otherwise streamingTaskInFlight
        // stays true and the next tick silently stalls forever.
        const exitHandler = (code: number) => {
            if (code === 0) {
                clearLoadSentinel(this.modelId);
                return; // clean shutdown
            }
            modelPreloader.recordLoadFailure(this.modelId);
            this.clearStreamingWatchdog();
            if (this.slotRelease) { this.slotRelease(); this.slotRelease = null; }
            // See the matching comment in the 'error' handler above — the
            // registry's own 'exit' listener handles the real cleanup.
            this.nemotronWorkerRelease = null;
            const hadInFlight = this.streamingTaskInFlight;
            this.streamingTaskInFlight = false;
            this.streamingTaskId = null;
            this.workerReady = false;
            // Same delta-cursor rewind as the 'error' handler above — a
            // dead worker means dispatched-but-unprocessed audio, and a
            // stale cursor mis-slices the segment's final dispatch.
            if (this.isNemotronModel) this.nemotronSentSamples = 0;
            if (hadInFlight) {
                this.emit('error', new Error(
                    `Local Whisper worker exited unexpectedly (code=${code}) — transcription stream has been unblocked.`
                ));
            }
        };
        this.worker.on('exit', exitHandler);

        // Dual-channel Nemotron only: stash the exact function references so
        // beginWorkerTermination() can remove ONLY these three via
        // worker.off(), never removeAllListeners() — this worker may be
        // SHARED with another LocalWhisperSTT instance and
        // sharedWorkerRegistry.ts's own listener, all attached to the same
        // object. Non-Nemotron workers are never shared, so they don't need
        // this bookkeeping.
        if (this.isNemotronModel) {
            this.nemotronMessageHandler = messageHandler;
            this.nemotronErrorHandler = errorHandler;
            this.nemotronExitHandler = exitHandler;
        }
    }

    private flushPending(): void {
        // Push the cached prompt AND (nemotron-rnnt only) the resolved
        // lang_id to the worker FIRST so the queued transcribes see both on
        // their initial run (worker honors the latest cached prompt / lang_id
        // for whichever transcribe/pushAudio arrives next).
        this.maybePushPromptToWorker();
        this.maybePushNemotronLangToWorker();
        const queued = this.pendingAudio.splice(0);
        queued.forEach(({ audio, nemotronReset }) => this.sendTranscribe(audio, false, nemotronReset));
        if (this.isDrainingFinals && queued.length === 0 && this.drainingFinalsInFlight === 0 && this.worker) {
            this.beginWorkerTermination(this.worker);
        }
    }

    private beginWorkerTermination(w: Worker): void {
        this.worker = null;
        this.workerReady = false;
        this.isDrainingFinals = false;
        this.drainingFinalsInFlight = 0;
        // Free the shared ONNX gate slot on clean shutdown — the session's
        // BFCArena is being torn down with the worker, so the slot can go.
        if (this.slotRelease) { this.slotRelease(); this.slotRelease = null; }
        // Reset the sent-prompt tracker: a future spawnWorker call will get a
        // fresh worker with empty cache, so we must re-push on next ready.
        this.contextPromptSentToWorker = '';
        // Same reasoning for nemotron-rnnt's lang_id: a fresh worker's
        // NemotronEngine starts at its own DEFAULT_LANG_ID (0/English), not
        // whatever this instance last resolved — must re-push on next ready.
        this.nemotronLangIdSentToWorker = null;

        if (this.isNemotronModel) {
            // The shared worker may OUTLIVE this instance — the other channel
            // can still be actively using it (see sharedWorkerRegistry.ts's
            // refcount), and sharedWorkerRegistry.ts's OWN listener is also
            // attached directly to this same Worker object. removeAllListeners
            // is indiscriminate — it would strip the SURVIVING channel's
            // handlers (silently killing its transcription) AND the
            // registry's own 'message' listener (hanging every future
            // acquireSharedNemotronWorker join on this worker, since nothing
            // is left to resolve its `ready` wait) AND leave zero 'error'
            // listeners on the Worker object for a future real crash, which
            // Node's EventEmitter contract turns into an unhandled throw.
            // So: remove ONLY the exact handler references THIS instance
            // itself attached in attachWorkerListeners(), via worker.off()
            // (== removeListener), never removeAllListeners(), for this
            // shared-worker case.
            if (this.nemotronMessageHandler) { w.off('message', this.nemotronMessageHandler); this.nemotronMessageHandler = null; }
            if (this.nemotronErrorHandler) { w.off('error', this.nemotronErrorHandler); this.nemotronErrorHandler = null; }
            if (this.nemotronExitHandler) { w.off('exit', this.nemotronExitHandler); this.nemotronExitHandler = null; }
            //
            // No terminate()-after-a-timer here, unlike the non-Nemotron path
            // below: release() itself decides synchronously whether the
            // underlying worker actually terminates (refcount reaches 0) or
            // just loses this one channel — there's nothing to defer.
            if (this.nemotronWorkerRelease) { this.nemotronWorkerRelease(); this.nemotronWorkerRelease = null; }
            this.nemotronChannelId = null;
            return;
        }

        // Non-Nemotron: this worker is never shared with another
        // LocalWhisperSTT instance or the registry, so indiscriminate
        // removal is correct and simplest here — unchanged from before this
        // fix.
        w.removeAllListeners('message');
        w.removeAllListeners('error');
        if (this.workerTerminateTimer) clearTimeout(this.workerTerminateTimer);
        const t = setTimeout(() => {
            this.workerTerminateTimer = null;
            w.terminate();
        }, 5000);
        // unref so the timer doesn't pin the Node event loop on app quit.
        (t as any).unref?.();
        this.workerTerminateTimer = t;
    }
}
