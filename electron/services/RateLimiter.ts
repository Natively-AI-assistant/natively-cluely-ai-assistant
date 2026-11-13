/**
 * RateLimiter - Token bucket rate limiter for LLM API calls
 * Prevents 429 errors on free-tier API plans by queuing requests
 * when the bucket is empty.
 *
 * BUG-4 fixes:
 *   1. MAX_QUEUE_DEPTH cap — prevents unbounded memory growth under sustained load
 *      (e.g. fast-text mode at 1 req/s with a 6 req/min limit → 54 waiters in 60s).
 *   2. destroy() now rejects waiters instead of resolving them — the old behaviour
 *      called resolve() with no token, silently bypassing the rate limit on shutdown.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Live vs background lanes (pipeline forensics 2026-11-13, F-LAT-06).
 *
 * One bucket per provider is shared by the live meeting (Auto Answer judge,
 * answer, repair) and background work (note-section prompt compiles). In
 * dev-s09c a new mode's ~112 compile calls drained the bucket and the first
 * judge of the meeting waited 2.6 s in acquire(), then timed out. Background
 * work is marked by running it inside runAsBackgroundLlmWork(); its acquires:
 *   • never take the last LIVE_RESERVE_FRACTION of the bucket,
 *   • are served only after every queued live waiter, and
 *   • hold off while a live acquire happened within `liveQuietMs` (a meeting
 *     that is answering), resuming once it goes quiet.
 * Everything not marked is live, so existing callers are unchanged.
 * AsyncLocalStorage is plain Node and behaves the same on macOS and Windows.
 */
const llmWorkLane = new AsyncLocalStorage<'background'>();

/** Run `fn` (and every await inside it) as background LLM work. */
export function runAsBackgroundLlmWork<T>(fn: () => Promise<T>): Promise<T> {
    return llmWorkLane.run('background', fn);
}

export function isBackgroundLlmWork(): boolean {
    return llmWorkLane.getStore() === 'background';
}

const LIVE_RESERVE_FRACTION = 0.25;
const DEFAULT_LIVE_QUIET_MS = 10_000;

export interface RateLimiterOptions {
    /** How long after the last live acquire background work keeps waiting. */
    liveQuietMs?: number;
}

type Waiter = { resolve: () => void; reject: (err: Error) => void };

export class RateLimiter {
    private tokens: number;
    private readonly maxTokens: number;
    private readonly refillRatePerSecond: number;
    private lastRefillTime: number;
    private waitQueue: Waiter[] = [];
    private backgroundQueue: Waiter[] = [];
    private readonly liveReserve: number;
    private readonly liveQuietMs: number;
    private lastLiveAcquireAt = Number.NEGATIVE_INFINITY;
    private refillTimer: ReturnType<typeof setInterval> | null = null;

    // Hard cap on pending waiters — beyond this depth, new callers get an immediate
    // rejection instead of queuing. Prevents memory explosion during rate-limit storms.
    // 20 queued requests = ~33s of wait at 6 req/min (Groq free tier) before the first
    // queued request even starts — anything beyond that is an abuse pattern.
    private readonly MAX_QUEUE_DEPTH = 20;

    /**
     * @param maxTokens - Maximum burst capacity (e.g. 30 for Groq free tier)
     * @param refillRatePerSecond - Tokens added per second (e.g. 0.5 = 30/min)
     */
    constructor(maxTokens: number, refillRatePerSecond: number, opts: RateLimiterOptions = {}) {
        this.maxTokens = maxTokens;
        this.tokens = maxTokens;
        this.refillRatePerSecond = refillRatePerSecond;
        this.lastRefillTime = Date.now();
        this.liveReserve = Math.max(1, Math.ceil(maxTokens * LIVE_RESERVE_FRACTION));
        this.liveQuietMs = Math.max(0, opts.liveQuietMs ?? DEFAULT_LIVE_QUIET_MS);

        // Refill tokens periodically. unref() so the timer does not keep the
        // event loop alive — important for unit tests that create a limiter
        // without explicitly destroy()ing it (otherwise `node --test` hangs
        // forever waiting for the interval to drain).
        this.refillTimer = setInterval(() => this.refill(), 1000);
        if (this.refillTimer && typeof this.refillTimer.unref === 'function') {
            this.refillTimer.unref();
        }
    }

    /**
     * Acquire a token. Resolves immediately if available.
     * If the bucket is empty, waits up to MAX_QUEUE_DEPTH slots.
     * Throws RateLimitQueueFullError if the queue is full — callers should catch and fail-fast.
     */
    public async acquire(): Promise<void> {
        if (isBackgroundLlmWork()) return this.acquireBackground();
        this.lastLiveAcquireAt = Date.now();
        this.refill();

        if (this.tokens >= 1) {
            this.tokens -= 1;
            return;
        }

        if (this.waitQueue.length >= this.MAX_QUEUE_DEPTH) {
            throw new Error(
                `Rate limiter queue full (${this.MAX_QUEUE_DEPTH} waiters) — request rejected to prevent memory overflow`
            );
        }

        // Wait for a token to become available
        return new Promise<void>((resolve, reject) => {
            this.waitQueue.push({ resolve, reject });
        });
    }

    /** A background acquire: may it take a token right now? */
    private backgroundMayTake(): boolean {
        return this.waitQueue.length === 0
            && this.tokens >= 1 + this.liveReserve
            && Date.now() - this.lastLiveAcquireAt >= this.liveQuietMs;
    }

    private async acquireBackground(): Promise<void> {
        this.refill();
        if (this.backgroundQueue.length === 0 && this.backgroundMayTake()) {
            this.tokens -= 1;
            return;
        }
        if (this.backgroundQueue.length >= this.MAX_QUEUE_DEPTH) {
            throw new Error(
                `Rate limiter background queue full (${this.MAX_QUEUE_DEPTH} waiters) — request rejected`
            );
        }
        return new Promise<void>((resolve, reject) => {
            this.backgroundQueue.push({ resolve, reject });
        });
    }

    private refill(): void {
        const now = Date.now();
        const elapsed = (now - this.lastRefillTime) / 1000;
        const newTokens = elapsed * this.refillRatePerSecond;

        if (newTokens >= 1) {
            this.tokens = Math.min(this.maxTokens, this.tokens + Math.floor(newTokens));
            this.lastRefillTime = now;

            // Wake up waiting requests — live first, always.
            while (this.waitQueue.length > 0 && this.tokens >= 1) {
                this.tokens -= 1;
                const waiter = this.waitQueue.shift()!;
                waiter.resolve();
            }
        }
        // Background waiters, only from what live does not need. Checked on every
        // tick, not only on a refill, so they resume when live work goes quiet.
        while (this.backgroundQueue.length > 0 && this.backgroundMayTake()) {
            this.tokens -= 1;
            this.backgroundQueue.shift()!.resolve();
        }
    }

    public destroy(): void {
        if (this.refillTimer) {
            clearInterval(this.refillTimer);
            this.refillTimer = null;
        }
        // BUG-4 fix: reject (not resolve) all queued waiters on destroy.
        // Previously called resolve() which let callers proceed without a token —
        // silently bypassing the rate limit on app shutdown.
        for (const queue of [this.waitQueue, this.backgroundQueue]) {
            while (queue.length > 0) {
                const waiter = queue.shift()!;
                waiter.reject(new Error('RateLimiter destroyed — request cancelled'));
            }
        }
    }
}

/**
 * Pre-configured rate limiters for known providers.
 * These match documented free-tier limits.
 */
export function createProviderRateLimiters() {
    return {
        // Groq's documented free-tier ceiling for its chat models is 30 RPM
        // (paid tiers are far higher). The previous 6/min bucket sat BELOW the
        // provider's own limit, so it protected nothing and, because acquire()
        // queues rather than fails, the 7th Groq request inside a minute waited
        // up to 10 s in silence — the "fast" provider's worst latency spikes were
        // self-inflicted (Auto Answer judge + prefetch + answer on one question
        // is three requests). A genuine 429 is still handled where the request
        // is made (createGroqCompletion's ladder / retry).
        groq: new RateLimiter(30, 0.5),       // 30 req/min
        gemini: new RateLimiter(120, 2.0),    // 120 req/min
        openai: new RateLimiter(120, 2.0),    // 120 req/min
        claude: new RateLimiter(120, 2.0),    // 120 req/min
        deepseek: new RateLimiter(120, 2.0),  // OpenAI-compatible — conservative default
        litellm: new RateLimiter(120, 2.0),   // OpenAI-compatible proxy — conservative default
        nvidia_nim: new RateLimiter(120, 2.0),
        // OpenRouter fronts other vendors and enforces its own per-key ceiling,
        // so this mirrors the NVIDIA budget rather than any single upstream's.
        openrouter: new RateLimiter(120, 2.0),
        // Fluxion publishes no rate limits at all (no documented ceiling, and
        // its own terms reserve the right to throttle per group/channel), so
        // this is the same conservative gateway default rather than a
        // documented figure.
        fluxion: new RateLimiter(120, 2.0),
        // AgentRouter publishes no numbers either, but its terms name bypassing
        // its rate and concurrency limits as grounds for suspension, and it is a
        // free community service. Half the gateway default: an interactive
        // meeting never needs 60 requests a minute, and a runaway loop should
        // queue here rather than get the user's account flagged.
        agentrouter: new RateLimiter(60, 1.0),
        // 9Router runs on the user's own machine, so the only ceiling that
        // matters is the upstream it forwards to — which it chooses per
        // request and rotates between accounts. Nothing local to rate-limit,
        // so this is the same conservative gateway default rather than a
        // documented figure.
        ninerouter: new RateLimiter(120, 2.0),
    };
}
