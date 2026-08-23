/**
 * TurnPredictor (V2 §37, exactly) and the Smart Turn v3.1 implementation
 * behind it (V3 Amendment 2).
 *
 * The deterministic path — provider endpoint + extractor + quiet window —
 * never depends on this (V2 §38): a missing asset, a failed session, or a
 * failed inference all make `predict()` return null and the TurnManager
 * simply does not shorten its wait. The absence is logged ONCE.
 *
 * Smart Turn v3.1 (pipecat-ai/smart-turn-v3, BSD-2-Clause): a Whisper-Tiny
 * encoder + linear head that judges from the RAW WAVEFORM whether the
 * speaker has finished — the only component here that can see a declarative
 * question ("So you own that service now."), which carries the question in
 * pitch, not words. Input: Whisper log-mel `input_features` [1, 80, 800] for
 * the last 8 s of 16 kHz mono audio (zero-mean/unit-variance normalised);
 * output: sigmoid completion probability. The 8 s ring buffer is 256 KB of
 * int16 PCM; one inference runs per interviewer speech-stop.
 *
 * The feature frontend is `@huggingface/transformers`' WhisperFeatureExtractor
 * (already bundled for local Whisper STT) and the session is onnxruntime-node
 * through the repo's bounded session options — no new runtime, no new
 * dependency; one 8 MB asset shipped like the other ONNX models.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { TranscriptTurn } from '../../llm/transcriptCleaner';

export interface TurnPredictorInput {
    partialTranscript: string;
    recentTranscript: TranscriptTurn[];
    speechDurationMs: number;
    silenceMs: number;
}

export interface TurnPrediction {
    pContinuation: number;
    pEndpoint: number;
    pQuestionComplete: number;
    estimatedRemainingSpeechMs?: number;
}

/** V2 §37. `null` = no opinion (asset missing, not yet inferred, stale) — the deterministic path decides. */
export interface TurnPredictor {
    predict(input: TurnPredictorInput): TurnPrediction | null;
}

/**
 * A predictor whose evidence arrives asynchronously (audio inference on
 * speech-stop). The controller subscribes; `predict()` still answers
 * synchronously from the latest result.
 */
export interface AsyncTurnPredictor extends TurnPredictor {
    /** Feed interviewer-channel PCM (int16 LE bytes) at `sampleRate` Hz. */
    pushPcm(chunk: Buffer, sampleRate: number): void;
    /** The interviewer channel went silent: run one inference on the buffered audio. */
    onInterviewerSpeechStop(atMs: number): void;
    subscribe(listener: (prediction: TurnPrediction, atMs: number) => void): () => void;
    /** Whether an inference session is loaded (diagnostics only). */
    isAvailable(): boolean;
}

// ── Constants (unfitted placeholders, V3 Amendment 2/5) ───────────────────
export const SMART_TURN_SAMPLE_RATE = 16_000;
export const SMART_TURN_WINDOW_S = 8;
/** 8 s × 16 kHz int16 = 256 KB. */
export const SMART_TURN_RING_SAMPLES = SMART_TURN_SAMPLE_RATE * SMART_TURN_WINDOW_S;
/** A prediction older than this no longer describes the current silence. */
export const PREDICTION_TTL_MS = 2000;
/** Asset location, relative to the packaged `models/` root (same mechanism as the Xenova assets). */
export const SMART_TURN_ASSET_RELATIVE_PATH = 'pipecat-ai/smart-turn-v3/smart-turn-v3.1-cpu.onnx';
export const SMART_TURN_ASSET_SHA256 = 'fb68d55c2d542ce79e44b12013bfd571e90df8594ab096d757198e851b0c6594';
/** Whisper-Tiny frontend for an 8 s chunk: 80 mel bins, 400-pt FFT, hop 160 → 800 frames. */
export const SMART_TURN_FEATURE_CONFIG = {
    feature_size: 80,
    sampling_rate: SMART_TURN_SAMPLE_RATE,
    hop_length: 160,
    chunk_length: SMART_TURN_WINDOW_S,
    n_fft: 400,
    padding_value: 0,
    return_attention_mask: false,
    nb_max_frames: 800,
    n_samples: SMART_TURN_RING_SAMPLES,
} as const;

/**
 * Fixed-capacity int16 ring buffer. Writes overwrite the oldest samples;
 * `snapshot()` returns the buffered audio oldest→newest as Float32 in [-1, 1].
 */
export class PcmRingBuffer {
    private readonly buf: Int16Array;
    private head = 0;      // next write index
    private filled = 0;    // samples currently valid (≤ capacity)

    constructor(readonly capacity: number = SMART_TURN_RING_SAMPLES) {
        this.buf = new Int16Array(capacity);
    }

    /** Append int16 samples (any length; only the newest `capacity` survive). */
    push(samples: Int16Array): void {
        if (samples.length >= this.capacity) {
            this.buf.set(samples.subarray(samples.length - this.capacity));
            this.head = 0;
            this.filled = this.capacity;
            return;
        }
        const tail = this.capacity - this.head;
        if (samples.length <= tail) {
            this.buf.set(samples, this.head);
        } else {
            this.buf.set(samples.subarray(0, tail), this.head);
            this.buf.set(samples.subarray(tail), 0);
        }
        this.head = (this.head + samples.length) % this.capacity;
        this.filled = Math.min(this.capacity, this.filled + samples.length);
    }

    length(): number { return this.filled; }

    clear(): void { this.head = 0; this.filled = 0; }

    snapshot(): Float32Array {
        const out = new Float32Array(this.filled);
        const start = (this.head - this.filled + this.capacity) % this.capacity;
        for (let i = 0; i < this.filled; i++) out[i] = this.buf[(start + i) % this.capacity] / 32768;
        return out;
    }
}

/** int16 LE bytes → Int16Array (copy-free view when aligned), decimated to 16 kHz by simple averaging when needed. */
export function bytesToPcm16k(chunk: Buffer, sampleRate: number): Int16Array {
    const n = Math.floor(chunk.length / 2);
    const view = new Int16Array(n);
    for (let i = 0; i < n; i++) view[i] = chunk.readInt16LE(i * 2);
    if (sampleRate === SMART_TURN_SAMPLE_RATE || sampleRate <= 0) return view;
    const ratio = sampleRate / SMART_TURN_SAMPLE_RATE;
    if (ratio < 1) return view; // upsampling is not worth the error for a turn-level model
    const outLen = Math.floor(n / ratio);
    const out = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
        const from = Math.floor(i * ratio);
        const to = Math.min(n, Math.floor((i + 1) * ratio));
        let sum = 0;
        for (let j = from; j < to; j++) sum += view[j];
        out[i] = to > from ? Math.round(sum / (to - from)) : 0;
    }
    return out;
}

/** HF `do_normalize`: zero mean, unit variance (variance + 1e-7). */
export function normalizeWaveform(x: Float32Array): Float32Array {
    if (x.length === 0) return x;
    let mean = 0;
    for (let i = 0; i < x.length; i++) mean += x[i];
    mean /= x.length;
    let variance = 0;
    for (let i = 0; i < x.length; i++) { const d = x[i] - mean; variance += d * d; }
    variance /= x.length;
    const denom = Math.sqrt(variance + 1e-7);
    const out = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) out[i] = (x[i] - mean) / denom;
    return out;
}

export interface SmartTurnDeps {
    /** Resolve the asset on disk; null when missing. Injected so tests never touch the filesystem. */
    resolveAssetPath: () => string | null;
    /** Build an inference session for a path. Injected so tests run a stub model. */
    createSession: (modelPath: string) => Promise<SmartTurnSession>;
    /** Waveform → `input_features` data (Float32, 80×800). Injected for tests. */
    extractFeatures: (waveform: Float32Array) => Promise<{ data: Float32Array; dims: number[] }>;
    log?: (line: string) => void;
    now?: () => number;
}

export interface SmartTurnSession {
    /** Returns the sigmoid completion probability. */
    run(features: { data: Float32Array; dims: number[] }): Promise<number>;
    release?(): Promise<void>;
}

export class SmartTurnPredictor implements AsyncTurnPredictor {
    private readonly ring = new PcmRingBuffer();
    private session: SmartTurnSession | null = null;
    private sessionPromise: Promise<SmartTurnSession | null> | null = null;
    private unavailableLogged = false;
    private inflight = false;
    private latest: { prediction: TurnPrediction; atMs: number } | null = null;
    private listeners = new Set<(p: TurnPrediction, atMs: number) => void>();

    constructor(private readonly deps: SmartTurnDeps) {}

    isAvailable(): boolean { return this.session !== null; }

    pushPcm(chunk: Buffer, sampleRate: number): void {
        try { this.ring.push(bytesToPcm16k(chunk, sampleRate)); } catch { /* never throw on the audio thread's callback */ }
    }

    subscribe(listener: (p: TurnPrediction, atMs: number) => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    /** V2 §37: synchronous answer from the latest inference, null when absent or stale. */
    predict(_input: TurnPredictorInput): TurnPrediction | null {
        const now = this.deps.now?.() ?? Date.now();
        if (!this.latest || now - this.latest.atMs > PREDICTION_TTL_MS) return null;
        return this.latest.prediction;
    }

    onInterviewerSpeechStop(atMs: number): void {
        void this.infer(atMs);
    }

    /** Buffered audio for tests/diagnostics. */
    bufferedSamples(): number { return this.ring.length(); }

    /** Release the inference session (meeting stop / app quit). Safe to call repeatedly; lazily re-created on next use. */
    async dispose(): Promise<void> {
        const session = this.session;
        this.session = null;
        this.sessionPromise = null;
        this.latest = null;
        this.ring.clear();
        if (session?.release) { try { await session.release(); } catch { /* best effort */ } }
    }

    private async ensureSession(): Promise<SmartTurnSession | null> {
        if (this.session) return this.session;
        if (this.sessionPromise) return this.sessionPromise;
        this.sessionPromise = (async () => {
            try {
                const modelPath = this.deps.resolveAssetPath();
                if (!modelPath) {
                    this.logOnce(`[SmartTurn] asset not found (${SMART_TURN_ASSET_RELATIVE_PATH}); Auto Answer continues on the deterministic path`);
                    return null;
                }
                this.session = await this.deps.createSession(modelPath);
                this.deps.log?.('[SmartTurn] session ready');
                return this.session;
            } catch (err) {
                this.logOnce(`[SmartTurn] session failed to load: ${(err as Error)?.message ?? err}; deterministic path unaffected`);
                return null;
            }
        })();
        return this.sessionPromise;
    }

    private async infer(atMs: number): Promise<void> {
        if (this.inflight) return; // one inference per speech stop; a stop during inference is the same silence
        this.inflight = true;
        try {
            const session = await this.ensureSession();
            if (!session) return;
            if (this.ring.length() < SMART_TURN_SAMPLE_RATE / 4) return; // < 250 ms of audio: nothing to judge
            const waveform = normalizeWaveform(this.ring.snapshot());
            const features = await this.deps.extractFeatures(waveform);
            const p = await session.run(features);
            if (!Number.isFinite(p)) return;
            const pEndpoint = Math.max(0, Math.min(1, p));
            const prediction: TurnPrediction = {
                pEndpoint,
                pContinuation: 1 - pEndpoint,
                // Smart Turn judges completion of the turn, not question-ness; the
                // detector owns question confidence. Report the same number so a
                // future text model can refine it without an interface change.
                pQuestionComplete: pEndpoint,
            };
            this.latest = { prediction, atMs };
            for (const l of this.listeners) { try { l(prediction, atMs); } catch { /* listener faults never propagate */ } }
        } catch (err) {
            this.deps.log?.(`[SmartTurn] inference failed: ${(err as Error)?.message ?? err}`);
        } finally {
            this.inflight = false;
        }
    }

    private logOnce(line: string): void {
        if (this.unavailableLogged) return;
        this.unavailableLogged = true;
        this.deps.log?.(line);
    }
}

/**
 * Production wiring: resolve the asset through the shared packaged-model
 * resolver, build an onnxruntime-node session with the bounded options, and
 * extract features with transformers.js. Everything is required lazily so a
 * missing native module cannot break startup.
 */
export function createSmartTurnPredictor(log?: (line: string) => void): SmartTurnPredictor {
    return new SmartTurnPredictor({
        log,
        resolveAssetPath: () => {
            try {
                const { resolveLocalModelAsset } = require('../../services/LocalFallbackAssets') as typeof import('../../services/LocalFallbackAssets');
                const r = resolveLocalModelAsset(SMART_TURN_ASSET_RELATIVE_PATH);
                if (r.ok && r.path && fs.existsSync(r.path)) return r.path;
            } catch { /* fall through */ }
            const dev = path.join(process.cwd(), 'resources', 'models', SMART_TURN_ASSET_RELATIVE_PATH);
            return fs.existsSync(dev) ? dev : null;
        },
        createSession: async (modelPath: string) => {
            const { InferenceSession, Tensor } = require('onnxruntime-node') as typeof import('onnxruntime-node');
            const { getBoundedOnnxSessionOptions } = require('../../utils/onnxThreadConfig') as typeof import('../../utils/onnxThreadConfig');
            const session = await InferenceSession.create(modelPath, { ...getBoundedOnnxSessionOptions('default'), executionProviders: ['cpu'] } as any);
            return {
                run: async (features) => {
                    const input = new Tensor('float32', features.data, features.dims);
                    const out = await session.run({ input_features: input });
                    const first = out[Object.keys(out)[0]];
                    const value = (first?.data as Float32Array | undefined)?.[0];
                    return typeof value === 'number' ? value : Number.NaN;
                },
                release: async () => { try { await session.release(); } catch { /* best effort */ } },
            };
        },
        extractFeatures: async (waveform: Float32Array) => {
            // @huggingface/transformers is ESM-only; a true dynamic import() must
            // survive the CJS bundle (same trick as localEmbeddingWorker.ts).
            const { WhisperFeatureExtractor } = await (new Function('return import("@huggingface/transformers")')() as Promise<any>);
            const extractor = new WhisperFeatureExtractor({ ...SMART_TURN_FEATURE_CONFIG });
            const out = await extractor(waveform);
            const tensor = out.input_features;
            return { data: tensor.data as Float32Array, dims: [...tensor.dims] };
        },
    });
}
