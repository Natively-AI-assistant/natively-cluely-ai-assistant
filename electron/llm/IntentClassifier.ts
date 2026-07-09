// electron/llm/IntentClassifier.ts
// Lightweight intent classification for "What should I say?"
// Micro step that runs before answer generation
//
// Two-tier classification:
//   1. Regex fast-path (< 1ms) for common patterns
//   2. Local SLM fallback (zero-shot, ~10-50ms) for messy/ambiguous speech

import fs from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';
import { app } from 'electron';
import { acquireOnnxSlot, hasEnoughMemoryForOnnxSession, getMinFreeGBForOnnxSession } from '../utils/onnxThreadConfig';
import {
    clearLoadSentinel as clearOnnxLoadSentinel,
    consumePoisonedOnnxLoad,
    isSentinelWithinTtl,
    writeLoadSentinel as writeOnnxLoadSentinel,
} from '../utils/onnxLoadSentinel';
import { ProviderStatusRegistry } from '../services/ProviderStatusRegistry';
import type { LocalWorkerStatus } from '../utils/workerStatus';

/** Hardcoded intent model id — must match `intentClassifierWorker.ts`. Used
 *  as the sentinel key so a poisoned load is attributable. */
const INTENT_MODEL_ID = 'Xenova/mobilebert-uncased-mnli';

/** Process-local poison flag: set by the cold-start consume path to tell the
 *  warmup + classify paths to skip ONNX entirely this launch. Cleared on
 *  retry (via `clearStartupPoison`). Mirrors the in-memory `nonRecoverableLoadError`
 *  latch but seeded from disk so it survives a native main-thread abort. */
let startupPoisoned = false;

export type ConversationIntent =
    | 'clarification'      // "Can you explain that?"
    | 'follow_up'          // "What happened next?"
    | 'deep_dive'          // "Tell me more about X"
    | 'behavioral'         // "Give me an example of..."
    | 'example_request'    // "Can you give a concrete example?"
    | 'summary_probe'      // "So to summarize..."
    | 'coding'             // "Write code for X" or implementation questions
    | 'general';           // Default fallback

export interface IntentResult {
    intent: ConversationIntent;
    confidence: number;
    answerShape: string;
}

/**
 * Answer shapes mapped to intents
 * This controls HOW the answer is structured, not just WHAT it says
 */
const INTENT_ANSWER_SHAPES: Record<ConversationIntent, string> = {
    clarification: 'Give a direct, focused 1-2 sentence clarification. No setup, no context-setting.',
    follow_up: 'Continue the narrative naturally. 1-2 sentences. No recap of what was already said.',
    deep_dive: 'Provide a structured but concise explanation. Use concrete specifics, not abstract concepts.',
    behavioral: 'Use a specific story only when grounded candidate/profile context exists. Without grounding, use the required no-context admission opener and keep any example illustrative, unnamed, modest, and qualitative.',
    example_request: 'Provide one concrete example from grounded context when available. Without grounding, label it as illustrative and avoid invented names, companies, dates, metrics, or first-person claims.',
    summary_probe: 'Confirm the summary briefly and add one clarifying point if needed.',
    coding: 'Provide a FULL, complete, working and production-ready code implementation (including necessary boilerplate like Java imports/classes). Start with a brief approach description, then the fully runnable code block, then a concise explanation of why this approach works.',
    general: 'Respond naturally based on context. Keep it conversational and direct.'
};

// ========================
// Zero-Shot SLM Classifier
// ========================

/**
 * Candidate labels for zero-shot classification.
 * These map to ConversationIntent types.
 */
const ZERO_SHOT_LABELS: Record<string, ConversationIntent> = {
    'asking for clarification or explanation': 'clarification',
    'asking about what happened next or follow-up': 'follow_up',
    'requesting more detail or deeper explanation': 'deep_dive',
    'asking for a personal experience or behavioral example': 'behavioral',
    'requesting a concrete example or instance': 'example_request',
    'summarizing or confirming understanding': 'summary_probe',
    'asking about code, programming, or implementation': 'coding',
    'general conversation or question': 'general',
};

const ZERO_SHOT_LABEL_KEYS = Object.keys(ZERO_SHOT_LABELS);

/** Minimum confidence from the SLM to trust its classification */
const SLM_CONFIDENCE_THRESHOLD = 0.35;

/**
 * Singleton lazy-loaded zero-shot classifier hosted in a worker thread.
 * The transformers.js/ONNX pipeline is intentionally kept off the Electron
 * main process so startup warmup and live classification cannot stall window
 * animation or IPC handling.
 */
class ZeroShotClassifier {
    private static instance: ZeroShotClassifier | null = null;
    private worker: Worker | null = null;
    private requestId = 0;
    private pendingRequests = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void; timer: ReturnType<typeof setTimeout> }>();
    private loadingPromise: Promise<void> | null = null;
    private loadFailed = false;
    private loaded = false;
    private slotRelease: (() => void) | null = null;
    private lastWorkerStatus: LocalWorkerStatus | null = null;
    private nonRecoverableLoadError: Error | null = null;

    private static readonly WORKER_TIMEOUT_MS = 30_000;

    private constructor() {}

    static getInstance(): ZeroShotClassifier {
        if (!ZeroShotClassifier.instance) {
            ZeroShotClassifier.instance = new ZeroShotClassifier();
        }
        return ZeroShotClassifier.instance;
    }

    private getWorkerPath(): string {
        const candidates = [
            path.join(__dirname, 'intentClassifierWorker.js'),
            path.join(__dirname, 'llm', 'intentClassifierWorker.js'),
            path.join(__dirname, 'electron', 'llm', 'intentClassifierWorker.js'),
        ];

        let resolvedPath = candidates.find(p => fs.existsSync(p)) ?? candidates[0];
        if (resolvedPath.includes('app.asar') && !resolvedPath.includes('app.asar.unpacked')) {
            resolvedPath = resolvedPath.replace('app.asar', 'app.asar.unpacked');
        }
        return resolvedPath;
    }

    private getWorker(): Worker {
        if (!this.worker) {
            // Cross-launch disk sentinel: written BEFORE new Worker() so a native
            // ORT abort that kills the process before the JS `ready` arrives
            // leaves a recoverable breadcrumb for the next launch's consume.
            writeOnnxLoadSentinel('intent', INTENT_MODEL_ID);
            this.worker = new Worker(this.getWorkerPath());

            this.worker.on('message', (msg: { type: string; requestId?: number; labels?: string[]; scores?: number[]; error?: string; status?: LocalWorkerStatus }) => {
                if (msg.type === 'status' && msg.status) {
                    // Worker reached `ready` — clear the poisoned-load sentinel
                    // for this family/model pair. Without this clear, a clean
                    // init could still leave a stale sentinel if the worker
                    // happened to crash AFTER posting ready.
                    if (msg.status.type === 'ready') {
                        clearOnnxLoadSentinel('intent', INTENT_MODEL_ID);
                    }
                    this.handleWorkerStatus(msg.status);
                    return;
                }
                const pending = this.pendingRequests.get(msg.requestId as number);
                if (!pending) return;
                clearTimeout(pending.timer);
                this.pendingRequests.delete(msg.requestId);

                if (msg.type === 'error') {
                    pending.reject(new Error(msg.error || 'Worker error'));
                } else {
                    pending.resolve(msg);
                }
            });

            this.worker.on('error', (err) => {
                console.warn('[IntentClassifier] Worker error, regex-only fallback until retry:', err);
                this.loaded = false;
                this.loadingPromise = null;
                // Worker died mid-load (no `ready` arrived) — treat the failure
                // as non-recoverable so future calls don't spin up a fresh
                // worker against the same broken asset. Latching prevents the
                // infinite-retry loop a missing packaged model would otherwise
                // cause. A diagnostics-driven "reset and retry" path can
                // explicitly clear this latch when the user reinstalls.
                if (!this.loaded && !this.nonRecoverableLoadError) {
                    this.latchNonRecoverableLoadError(`Worker error before ready: ${err?.message || err}`);
                }
                if (this.slotRelease) { this.slotRelease(); this.slotRelease = null; }
                this.rejectAllPending(err);
            });

            this.worker.on('exit', (code) => {
                if (code !== 0) {
                    console.warn(`[IntentClassifier] Worker exited with code ${code}`);
                }
                // Clear on clean exit; non-zero exit keeps the sentinel so
                // the next launch knows the previous attempt died hard.
                if (code === 0) clearOnnxLoadSentinel('intent', INTENT_MODEL_ID);
                this.worker = null;
                this.loaded = false;
                this.loadingPromise = null;
                if (this.slotRelease) { this.slotRelease(); this.slotRelease = null; }
                this.rejectAllPending(new Error(`Worker exited with code ${code}`));
                // If we never reached `loaded` and the latch hasn't been set,
                // this exit was the load-failure case. Classify the failure
                // so the diagnostics surface a reinstall-required message.
                if (!this.loaded && !this.nonRecoverableLoadError) {
                    this.latchNonRecoverableLoadError(`Worker exited with code ${code} before model loaded`);
                }
            });
        }
        return this.worker;
    }

    private rejectAllPending(err: Error): void {
        for (const [, pending] of this.pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(err);
        }
        this.pendingRequests.clear();
    }

    private handleWorkerStatus(status: LocalWorkerStatus): void {
        this.lastWorkerStatus = status;
        if (status.type === 'ready') {
            ProviderStatusRegistry.getInstance().setStatus({
                id: 'intent-classifier',
                kind: 'packaged_local',
                health: 'ready',
                requiredForStartup: false,
                requiredForCoreFallback: true,
                message: 'Intent classifier ready',
                recoverable: true,
                details: { backend: status.backend, modelPath: status.modelPath },
            });
            return;
        }
        if (!status.recoverable) {
            this.nonRecoverableLoadError = new Error(status.message);
        }
        ProviderStatusRegistry.getInstance().setStatus({
            id: 'intent-classifier',
            kind: 'packaged_local',
            health: status.recoverable ? 'degraded' : 'missing_required_asset',
            requiredForStartup: false,
            requiredForCoreFallback: true,
            // Human-readable status; `details.reason` carries the debug
            // classification (module-missing / native-addon-missing / etc.)
            // for the renderer's diagnostic UI.
            message: status.recoverable
                ? 'Intent classifier running in fallback mode (regex + heuristics). Smart suggestions may be less accurate.'
                : 'Natively local classifier assets are missing or corrupted. Please reinstall Natively.',
            recoverable: status.recoverable,
            details: { backend: status.backend, reason: status.reason, error: status.message },
        });
    }

    getStatus(): LocalWorkerStatus | null {
        return this.lastWorkerStatus ? { ...this.lastWorkerStatus } : null;
    }

    /**
     * Latch a synthetic non-recoverable failure when the worker dies before
     * the model is fully loaded. Publishes a fresh ProviderStatus so the
     * renderer can show "reinstall required" without waiting for the next
     * user-driven classify call. Idempotent.
     */
    public latchNonRecoverableLoadError(message: string): void {
        this.nonRecoverableLoadError = new Error(message);
        ProviderStatusRegistry.getInstance().setStatus({
            id: 'intent-classifier',
            kind: 'packaged_local',
            health: 'missing_required_asset',
            requiredForStartup: false,
            requiredForCoreFallback: true,
            message: 'Natively local classifier assets are missing or corrupted. Please reinstall Natively.',
            recoverable: false,
            details: { reason: 'worker-died-before-ready', error: message },
        });
    }

    private postToWorker<T>(message: any): Promise<T> {
        this.requestId = (this.requestId + 1) % Number.MAX_SAFE_INTEGER;
        const id = this.requestId;
        message.requestId = id;

        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`[IntentClassifier] Worker request ${id} timed out after ${ZeroShotClassifier.WORKER_TIMEOUT_MS}ms`));
            }, ZeroShotClassifier.WORKER_TIMEOUT_MS);

            this.pendingRequests.set(id, { resolve, reject, timer });
            this.getWorker().postMessage(message);
        });
    }

    private workerConfig(): Record<string, any> {
        const isPackaged = Boolean(app?.isPackaged);
        return {
            isPackaged,
            localModelPath: path.join(process.resourcesPath || '', 'models'),
            cacheDir: path.join(__dirname, '../../resources/models'),
        };
    }

    /**
     * Lazy-load the zero-shot classification model in a worker thread.
     * Uses Xenova/mobilebert-uncased-mnli — tiny (~100MB quantized), fast (~10-50ms inference).
     *
     * If the cold-start consume path (see `consumeStartupPoison`) determined
     * the previous process died while loading this model, the warmup is
     * skipped entirely this launch and the classifier falls through to the
     * regex tier. The poison flag is in-memory only — clearing it via
     * `clearStartupPoison` (the onnx-reset-family IPC) restores the next
     * call to attempt a fresh load.
     */
    private async ensureLoaded(): Promise<void> {
        if (startupPoisoned) return;
        if (this.loaded) return;
        if (this.nonRecoverableLoadError) return;
        if (this.loadFailed) return;

        if (this.loadingPromise) {
            await this.loadingPromise;
            return;
        }

        // Cross-loader ONNX gate (shared with LocalReranker / LocalEmbeddingProvider /
        // Whisper). Gate refusal is non-fatal — the classifier falls through to
        // regex-only and the next call retries. Gate refusals do NOT set
        // loadFailed (that's reserved for actual load errors); a less-pressured
        // moment will retry the full init automatically.
        if (!hasEnoughMemoryForOnnxSession()) {
            console.warn(
                `[IntentClassifier] skipping zero-shot worker load — free memory below ${getMinFreeGBForOnnxSession()}GB floor`,
            );
            this.loadingPromise = Promise.resolve().then(() => { this.loadingPromise = null; });
            return;
        }

        const releaseSlot = await acquireOnnxSlot('normal');

        this.loadingPromise = (async () => {
            try {
                await this.postToWorker({ type: 'init', ...this.workerConfig() });
                this.loaded = true;
                this.slotRelease = releaseSlot;
            } catch (e) {
                releaseSlot();
                console.warn('[IntentClassifier] Failed to load zero-shot worker model, regex-only fallback:', e);
                this.loadFailed = true;
                this.loaded = false;
            }
        })();

        try {
            await this.loadingPromise;
        } finally {
            this.loadingPromise = null;
        }
    }

    private mapWorkerResult(result: { labels?: string[]; scores?: number[] }, textLength: number): IntentResult | null {
        const topLabel = result.labels?.[0];
        const topScore = result.scores?.[0];

        if (!topLabel || typeof topScore !== 'number' || topScore < SLM_CONFIDENCE_THRESHOLD) {
            return null;
        }

        const intent = ZERO_SHOT_LABELS[topLabel] || 'general';
        console.log(`[IntentClassifier] SLM classified`, { intent, confidence: topScore, textLength });

        return {
            intent,
            confidence: topScore,
            answerShape: INTENT_ANSWER_SHAPES[intent],
        };
    }

    /**
     * Classify text using the zero-shot model.
     * Returns null if the model isn't loaded or classification fails.
     */
    async classify(text: string): Promise<IntentResult | null> {
        await this.ensureLoaded();
        if (!this.loaded) return null;

        try {
            const result = await this.postToWorker<{ labels?: string[]; scores?: number[] }>({
                type: 'classify',
                text,
                labels: ZERO_SHOT_LABEL_KEYS,
                ...this.workerConfig(),
            });
            return this.mapWorkerResult(result, text.length);
        } catch (e) {
            console.warn('[IntentClassifier] SLM classification error:', e);
            return null;
        }
    }

    /**
     * Warm up the model in background (non-blocking).
     * Call this early in app lifecycle to avoid cold-start latency.
     */
    warmup(): void {
        this.ensureLoaded().catch(() => {});
    }
}

// ========================
// Regex Fast-Path
// ========================

/**
 * Pattern-based intent detection (fast, no model call)
 * For common patterns this is sufficient
 */
function detectIntentByPattern(lastInterviewerTurn: string): IntentResult | null {
    const text = lastInterviewerTurn.toLowerCase().trim();

    // Clarification patterns
    if (/(can you explain|what do you mean|clarify|could you elaborate on that specific)/i.test(text)) {
        return { intent: 'clarification', confidence: 0.9, answerShape: INTENT_ANSWER_SHAPES.clarification };
    }

    // Follow-up patterns  
    if (/(what happened|then what|and after that|what.s next|how did that go)/i.test(text)) {
        return { intent: 'follow_up', confidence: 0.85, answerShape: INTENT_ANSWER_SHAPES.follow_up };
    }

    // Deep dive patterns
    if (/(tell me more|dive deeper|explain further|walk me through|how does that work|how (should|would) (you|i) explain)/i.test(text)) {
        return { intent: 'deep_dive', confidence: 0.85, answerShape: INTENT_ANSWER_SHAPES.deep_dive };
    }

    // DSA/coding interview patterns. Keep this deterministic and run it
    // BEFORE behavioral/example matching so prompts like "give me an example
    // React component in TypeScript" still route to the coding contract.
    if (/(two\s*sum|longest substring|reverse (a )?linked list|detect a cycle|binary search|sliding window|two pointers?|hash\s?(map|set|table)|stack|queue|heap|trie|union[- ]find|dynamic programming|\bdp\b|backtracking|recursion|graph|tree|\bbfs\b|\bdfs\b|time complexity|space complexity|big[- ]?o)/i.test(text)) {
        return { intent: 'coding', confidence: 0.95, answerShape: INTENT_ANSWER_SHAPES.coding };
    }

    // Coding patterns (Broad detection for programming/implementation)
    if (/(write code|code for|program for|\bprogram\b|\bimplement\b|function for|algorithm for|algorithm|how to code|setup a .* project|using .* library|debug this|snippet|boilerplate|example of .* in .*|best practice for .* code|utility method|component for|logic for|\bsolve\b|solve .* in (javascript|typescript|python|java|c\+\+|sql))/i.test(text)) {
        return { intent: 'coding', confidence: 0.9, answerShape: INTENT_ANSWER_SHAPES.coding };
    }

    // Simple programming interview prompts. Keep these deterministic because
    // terse asks like "odd even code" are common in the manual box and often
    // lack explicit words like "implement".
    if (/(odd\s*(?:\/|or|and)?\s*even|even\s*(?:\/|or|and)?\s*odd|prime number|palindrome|factorial|fibonacci|reverse string|sort array|find max|find min|check if|check whether|determine whether|detect whether)/i.test(text)) {
        return { intent: 'coding', confidence: 0.9, answerShape: INTENT_ANSWER_SHAPES.coding };
    }

    // Behavioral patterns
    if (/(give me an example|tell me about a time|describe a situation|when have you|share an experience)/i.test(text)) {
        return { intent: 'behavioral', confidence: 0.9, answerShape: INTENT_ANSWER_SHAPES.behavioral };
    }

    // Example request patterns
    if (/(for example|concrete example|specific instance|like what|such as)/i.test(text)) {
        return { intent: 'example_request', confidence: 0.85, answerShape: INTENT_ANSWER_SHAPES.example_request };
    }

    // Summary probe patterns
    if (/(so to summarize|in summary|so basically|so you.re saying|let me make sure)/i.test(text)) {
        return { intent: 'summary_probe', confidence: 0.85, answerShape: INTENT_ANSWER_SHAPES.summary_probe };
    }

    // Words like "optimize" and "refactor" appear in normal interview answers
    // too ("optimize latency", "refactor a process"). Treat them as coding
    // only when a programming noun is also present.
    if (/\b(optimi[sz]e|refactor)\b/i.test(text) && /\b(code|function|algorithm|query|sql|typescript|javascript|python|java|class|method|implementation)\b/i.test(text)) {
        return { intent: 'coding', confidence: 0.85, answerShape: INTENT_ANSWER_SHAPES.coding };
    }

    return null; // No clear pattern detected
}

// ========================
// Context-Aware Fallback
// ========================

/**
 * Context-aware intent detection
 * Looks at conversation flow, not just the last turn
 */
function detectIntentByContext(
    recentTranscript: string,
    assistantMessageCount: number
): IntentResult {
    // If we've given multiple answers and interviewer is probing, likely follow_up
    if (assistantMessageCount >= 2) {
        // Check if interviewer is drilling down
        const lines = recentTranscript.split('\n');
        const interviewerLines = lines.filter(l => l.includes('[INTERVIEWER'));

        // Short interviewer prompts after long exchanges = follow-up probe
        const lastInterviewerLine = interviewerLines[interviewerLines.length - 1] || '';
        if (lastInterviewerLine.length < 50 && assistantMessageCount >= 2) {
            return { intent: 'follow_up', confidence: 0.7, answerShape: INTENT_ANSWER_SHAPES.follow_up };
        }
    }

    // Default to general
    return { intent: 'general', confidence: 0.5, answerShape: INTENT_ANSWER_SHAPES.general };
}

// ========================
// Public API
// ========================

/**
 * Main intent classification function (async)
 *
 * Three-tier priority:
 *   1. Regex fast-path (< 1ms, high confidence)
 *   2. Zero-shot SLM fallback (~10-50ms, medium-high confidence)
 *   3. Context-based heuristic (0ms, low confidence)
 */
export async function classifyIntent(
    lastInterviewerTurn: string | null,
    recentTranscript: string,
    assistantMessageCount: number
): Promise<IntentResult> {
    // Tier 1: Try regex-based first (high confidence, instant)
    if (lastInterviewerTurn) {
        const patternResult = detectIntentByPattern(lastInterviewerTurn);
        if (patternResult) {
            return patternResult;
        }

        // Tier 2: Try zero-shot SLM (if regex didn't match)
        if (lastInterviewerTurn.trim().length > 5) {
            const slmResult = await ZeroShotClassifier.getInstance().classify(lastInterviewerTurn);
            if (slmResult) {
                return slmResult;
            }
        }
    }

    // Tier 3: Fall back to context-based heuristic
    return detectIntentByContext(recentTranscript, assistantMessageCount);
}

/**
 * Get answer shape guidance for prompt injection
 */
export function getAnswerShapeGuidance(intent: ConversationIntent): string {
    return INTENT_ANSWER_SHAPES[intent];
}

/**
 * Pre-warm the SLM model in background.
 * Call this during app initialization to avoid cold-start on first classification.
 *
 * No-op when the cold-start consume path seeded `startupPoisoned` — the
 * previous process died while loading the model; we don't retry until the
 * user explicitly clears the poison via `clearIntentClassifierPoison`.
 */
export function warmupIntentClassifier(): void {
    if (startupPoisoned) return;
    ZeroShotClassifier.getInstance().warmup();
}

/**
 * Cold-start helper: read the leftover intent sentinel from disk (if any)
 * and seed the in-memory poison flag so the warmup + classify paths skip
 * the ONNX worker this launch. Returns the recovered sentinel record so
 * the caller can stash a recovery notice on AppState.
 *
 * Idempotent. Safe to call more than once (the second call returns null).
 */
export function consumeIntentClassifierSentinel(): { modelId: string; startedAt: number; attempt: number } | null {
    const consumed = consumePoisonedOnnxLoad('intent');
    if (consumed && isSentinelWithinTtl(consumed)) {
        startupPoisoned = true;
        // Also seed the singleton's in-memory latch so a future explicit
        // `__resetForTests`/reinstall path still observes the poison. Use the
        // public clear path to undo if the user requests a retry.
        try {
            ZeroShotClassifier.getInstance().latchNonRecoverableLoadError(
                `Recovered from previous launch: intent classifier crashed during load (attempt ${consumed.attempt}).`,
            );
        } catch { /* defensive — never let the consume helper itself throw */ }
        return consumed;
    }
    return null;
}

/**
 * Public reset: clears the cold-start poison flag AND the singleton's
 * in-memory non-recoverable latch, allowing the next classify call to
 * attempt a fresh load. Mirrors the local-whisper-reset-to-default IPC
 * but generalized. Idempotent.
 */
export function clearIntentClassifierPoison(): void {
    startupPoisoned = false;
    clearOnnxLoadSentinel('intent', INTENT_MODEL_ID);
    try {
        const inst = ZeroShotClassifier.getInstance() as unknown as {
            nonRecoverableLoadError?: Error | null;
            loadFailed?: boolean;
            loaded?: boolean;
        };
        inst.nonRecoverableLoadError = null;
        inst.loadFailed = false;
        // We do NOT clear `loaded` — if the singleton actually has a live
        // worker, leave it alone. The sentinel clearance is enough to let
        // ensureLoaded() attempt a new spawn if the next call hits.
    } catch { /* defensive */ }
}

/**
 * Diagnostic accessor: is the intent classifier currently skipped because
 * the previous launch poisoned the load? Used by tests and the recovery IPC.
 */
export function isIntentClassifierPoisoned(): boolean {
    return startupPoisoned;
}
