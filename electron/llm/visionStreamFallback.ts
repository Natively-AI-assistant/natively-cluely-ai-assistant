// electron/llm/visionStreamFallback.ts
//
// Pure, dependency-free core of the streaming vision-provider fallback chain.
//
// LLMHelper builds the concrete provider list (each `open()` wraps a real
// streamWith* SDK call) and the config/health map, then delegates the
// orchestration to runStreamingVisionFallback() here. Keeping the state machine
// free of SDK/Electron deps makes the fragile parts — the first-token "commit
// point", retry classification, circuit breaking, and speed reordering — unit
// testable with deterministic fake providers.
//
// The "commit point" pattern (LiteLLM / OpenRouter / Vercel AI SDK):
//   • Before the first content chunk is yielded, a provider error/timeout is
//     SILENT — the caller has seen nothing, so we fall back to the next
//     provider/attempt with no visible artifact.
//   • Once the first chunk is yielded we are COMMITTED to that provider; a
//     later failure cannot switch providers (that would duplicate output), so
//     we end the stream gracefully with whatever was already delivered.

export type VisionErrorClass =
  | 'auth'        // 401/403/quota/invalid-or-expired key — will not self-heal
  | 'rate'        // 429 rate limit
  | 'timeout'     // our TTFT / inter-chunk guard fired, or upstream timeout
  | 'network'     // ECONNRESET / ENOTFOUND / fetch failed
  | 'no_vision'   // model rejects images
  | 'payload'     // 413 / image too large
  | 'server'      // 5xx / overloaded
  | 'unknown';

export interface VisionStreamProvider {
  id: string;
  name: string;
  isLocal: boolean;
  priority: number;
  /** 1-based attempt; cloud families walk model tiers tier1→tier2→tier3. */
  open: (signal: AbortSignal, attempt: number) => AsyncGenerator<string, void, unknown>;
}

export interface VisionHealthEntry {
  /** Wall-clock ms until which the circuit is OPEN (provider skipped). */
  openUntil: number;
  consecutiveFails: number;
  /** EWMA of time-to-first-token in ms (alpha 0.2), or null if unmeasured. */
  ttftEma: number | null;
}

export interface VisionFallbackConfig {
  maxAttempts: number;
  ttftTimeoutMs: number;
  interChunkTimeoutMs: number;
  authCooldownMs: number;
  transientCooldownMs: number;
  /** Cooldown for structural incompatibilities (no_vision / payload too large). */
  incompatibleCooldownMs: number;
  backoffInitialMs: number;
  backoffMaxMs: number;
  /** Upper bound on closing a provider's upstream iterator so teardown can't hang the chain. */
  cleanupTimeoutMs: number;
}

export interface VisionFallbackHooks {
  now?: () => number;
  random?: () => number;
  /** Backoff sleeper — injectable so tests run instantly. Resolves early on abort. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
}

export const DEFAULT_VISION_FALLBACK_CONFIG: VisionFallbackConfig = {
  maxAttempts: 3,
  ttftTimeoutMs: 8_000,
  interChunkTimeoutMs: 15_000,
  authCooldownMs: 300_000,
  transientCooldownMs: 30_000,
  incompatibleCooldownMs: 600_000,
  backoffInitialMs: 250,
  backoffMaxMs: 10_000,
  cleanupTimeoutMs: 2_000,
};

/**
 * Classify a provider error into a coarse bucket that drives retry-vs-skip.
 * `timedOut` is true when our own TTFT/stall controller aborted the attempt.
 */
export function classifyVisionError(err: any, timedOut: boolean): VisionErrorClass {
  if (timedOut) return 'timeout';
  const msg = String(err?.message || err || '').toLowerCase();
  const status = Number((err && (err.status ?? err.statusCode ?? err.code)) || 0);
  if (
    status === 401 || status === 403 ||
    msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden') ||
    msg.includes('api key') || msg.includes('api_key') || msg.includes('invalid_api') ||
    msg.includes('expired') || msg.includes('quota') || msg.includes('insufficient_quota')
  ) return 'auth';
  if (
    status === 429 || msg.includes('429') || msg.includes('rate limit') ||
    msg.includes('rate_limit') || msg.includes('too many requests')
  ) return 'rate';
  if (
    msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout') ||
    msg.includes('aborted') || msg.includes('ttft') || msg.includes('stall')
  ) return 'timeout';
  if (
    msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('econnreset') ||
    msg.includes('epipe') || msg.includes('network') || msg.includes('fetch failed') || msg.includes('socket')
  ) return 'network';
  if (
    status === 413 || msg.includes('413') || msg.includes('payload') ||
    msg.includes('too large') || msg.includes('image too') || msg.includes('exceeds')
  ) return 'payload';
  if (
    msg.includes('does not support') || msg.includes('no vision') || msg.includes('image not supported') ||
    msg.includes('multimodal') || msg.includes('vision is not')
  ) return 'no_vision';
  if (
    status >= 500 || msg.includes('500') || msg.includes('502') || msg.includes('503') ||
    msg.includes('504') || msg.includes('529') || msg.includes('overloaded') || msg.includes('server error')
  ) return 'server';
  return 'unknown';
}

/**
 * Order providers fastest-healthy-first. OPEN-breaker providers are pushed to
 * the back (never dropped — if every provider is cooling we still try them all
 * rather than fail closed). Among the live set we sort by measured TTFT EWMA;
 * unmeasured providers keep their priority order via a priority*1e6 sentinel.
 */
export function orderVisionByHealth<T extends { id: string; priority: number }>(
  list: T[],
  health: Map<string, VisionHealthEntry>,
  now: number,
): T[] {
  const live = list.filter(p => (health.get(p.id)?.openUntil ?? 0) <= now);
  const cooling = list.filter(p => (health.get(p.id)?.openUntil ?? 0) > now);
  // "Fastest-first", but never demote an UNMEASURED provider behind a
  // measured-but-slow one — an untried higher-priority provider deserves its
  // turn. Sort: measured-then-unmeasured is decided per-pair below.
  //   • both measured   → faster TTFT EWMA first
  //   • both unmeasured → original priority order
  //   • one of each     → keep priority order (don't let a slow measurement
  //                       jump an untried higher-priority provider, and don't
  //                       bury a proven-fast provider behind an untried lower one)
  const ema = (p: T) => health.get(p.id)?.ttftEma ?? null;
  const sortLive = [...live].sort((a, b) => {
    const ea = ema(a), eb = ema(b);
    if (ea != null && eb != null) return ea - eb || a.priority - b.priority;
    return a.priority - b.priority;
  });
  const sortCooling = [...cooling].sort((a, b) => a.priority - b.priority);
  // Never fail closed: if every provider is cooling, still try them all.
  return sortLive.length > 0 ? [...sortLive, ...sortCooling] : sortCooling;
}

export function markVisionHealthy(health: Map<string, VisionHealthEntry>, id: string): void {
  const h = health.get(id) || { openUntil: 0, consecutiveFails: 0, ttftEma: null };
  h.openUntil = 0;
  h.consecutiveFails = 0;
  health.set(id, h);
}

export function markVisionUnhealthy(
  health: Map<string, VisionHealthEntry>, id: string, cooldownMs: number, now: number,
): void {
  const h = health.get(id) || { openUntil: 0, consecutiveFails: 0, ttftEma: null };
  h.consecutiveFails += 1;
  h.openUntil = now + cooldownMs;
  health.set(id, h);
}

export function recordVisionTtft(health: Map<string, VisionHealthEntry>, id: string, ms: number): void {
  const h = health.get(id) || { openUntil: 0, consecutiveFails: 0, ttftEma: null };
  // EWMA, alpha = 0.2 (LLM-SRE default): ema = 0.2*new + 0.8*old.
  h.ttftEma = h.ttftEma == null ? ms : 0.2 * ms + 0.8 * h.ttftEma;
  health.set(id, h);
}

/**
 * Run the streaming vision fallback over an already-ordered provider list.
 * Yields content tokens from the first provider that produces a first chunk.
 * Throws only when every provider fails pre-commit (the caller turns that into
 * a graceful user-facing message).
 */
export async function* runStreamingVisionFallback(
  orderedProviders: VisionStreamProvider[],
  cfg: VisionFallbackConfig,
  health: Map<string, VisionHealthEntry>,
  hooks: VisionFallbackHooks = {},
  abortSignal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const now = hooks.now ?? Date.now;
  const random = hooks.random ?? Math.random;
  const log = hooks.log ?? (() => { });
  const warn = hooks.warn ?? (() => { });
  const sleep = hooks.sleep ?? ((ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); resolve(); };
    signal?.addEventListener('abort', onAbort, { once: true });
  }));

  if (orderedProviders.length === 0) {
    throw new Error('No vision-capable provider configured.');
  }

  const failures: string[] = [];

  // Time-bounded close of a provider's upstream iterator. .return() runs the
  // generator's finally blocks (reader.cancel / stream.abort), which for a dead
  // socket can stall — so we never await it unbounded.
  const closeIterator = async (it: AsyncIterator<string> | null): Promise<void> => {
    if (!it || typeof it.return !== 'function') return;
    try {
      await Promise.race([
        Promise.resolve(it.return(undefined as any)).catch(() => { }),
        new Promise<void>((resolve) => setTimeout(resolve, cfg.cleanupTimeoutMs)),
      ]);
    } catch { /* ignore */ }
  };

  for (const provider of orderedProviders) {
    let providerFatal = false;

    for (let attempt = 1; attempt <= cfg.maxAttempts && !providerFatal; attempt++) {
      if (abortSignal?.aborted) return;

      const ctrl = new AbortController();
      const onOuterAbort = () => { try { ctrl.abort(); } catch { } };
      abortSignal?.addEventListener('abort', onOuterAbort, { once: true });

      const attemptStart = now();
      let it: AsyncIterator<string> | null = null;
      let committed = false;

      try {
        it = provider.open(ctrl.signal, attempt)[Symbol.asyncIterator]();

        // ── Race chunk #1 against the TTFT timeout (the only safe fallback point) ──
        const firstNext = it.next();
        firstNext.catch(() => { }); // swallow late rejection if the timeout wins
        let ttftTimer: ReturnType<typeof setTimeout> | null = null;
        const ttft = new Promise<never>((_, rej) => {
          ttftTimer = setTimeout(() => { try { ctrl.abort(); } catch { } rej(new Error('ttft-timeout')); }, cfg.ttftTimeoutMs);
        });
        let first: IteratorResult<string>;
        try {
          first = await Promise.race([firstNext, ttft]);
        } finally {
          if (ttftTimer) clearTimeout(ttftTimer);
        }

        if (first.done || typeof first.value !== 'string' || first.value.trim().length === 0) {
          throw new Error('empty-stream');
        }

        // ── COMMIT ──────────────────────────────────────────────────────────
        committed = true;
        recordVisionTtft(health, provider.id, now() - attemptStart);
        markVisionHealthy(health, provider.id);
        log(`[Vision] committed to ${provider.name} (attempt ${attempt}/${cfg.maxAttempts}, ttft=${now() - attemptStart}ms)`);
        yield first.value;

        // Drain — post-commit failures cannot switch providers (would duplicate
        // output). Every exit below funnels through the `finally` which aborts
        // the controller and closes the iterator, so no socket is left dangling.
        while (true) {
          if (abortSignal?.aborted) return;
          let next: IteratorResult<string>;
          let stallTimer: ReturnType<typeof setTimeout> | null = null;
          try {
            const nextChunk = it.next();
            nextChunk.catch(() => { });
            const stall = new Promise<never>((_, rej) => {
              stallTimer = setTimeout(() => { try { ctrl.abort(); } catch { } rej(new Error('interchunk-stall')); }, cfg.interChunkTimeoutMs);
            });
            next = await Promise.race([nextChunk, stall]);
          } catch (drainErr: any) {
            warn(`[Vision] ${provider.name} interrupted mid-stream after commit: ${drainErr?.message || drainErr}`);
            return; // partial answer already delivered; do not duplicate via another provider
          } finally {
            if (stallTimer) clearTimeout(stallTimer);
          }
          if (next.done) return;
          if (typeof next.value === 'string' && next.value.length > 0) yield next.value;
        }
      } catch (err: any) {
        // A throw after commit (e.g. consumer .throw()) must NOT trigger fallback.
        if (committed) return;
        // An outer cancel mid-attempt isn't the provider's fault — don't penalize it.
        if (abortSignal?.aborted) return;

        // Pre-commit failure → safe to retry / fall back silently.
        const timedOut = ctrl.signal.aborted;
        const cls = classifyVisionError(err, timedOut);
        const detail = `${provider.name} attempt ${attempt}/${cfg.maxAttempts}: ${cls}`;
        warn(`[Vision] ${detail} (${err?.message || err})`);
        failures.push(detail);

        if (cls === 'auth') {
          // Won't self-heal without a config change — open the breaker long.
          markVisionUnhealthy(health, provider.id, cfg.authCooldownMs, now());
          providerFatal = true;
        } else if (cls === 'no_vision' || cls === 'payload') {
          // Structurally incompatible with this image — retrying won't help, and
          // demote it so it isn't tried first on the next request either.
          markVisionUnhealthy(health, provider.id, cfg.incompatibleCooldownMs, now());
          providerFatal = true;
        } else {
          // Transient (timeout/rate/network/server/unknown) → backoff + retry.
          if (attempt >= cfg.maxAttempts) {
            markVisionUnhealthy(health, provider.id, cfg.transientCooldownMs, now());
          } else {
            const ceiling = Math.min(cfg.backoffInitialMs * Math.pow(2, attempt), cfg.backoffMaxMs);
            await sleep(Math.floor(random() * ceiling), abortSignal);
          }
        }
      } finally {
        // ALWAYS release per-attempt resources on every exit path (success,
        // commit-return, pre-commit error, timeout, outer abort, or the
        // orchestrator generator itself being .return()-ed by its consumer):
        //   1. abort the per-attempt controller so the upstream SDK request is
        //      cancelled even on the non-timeout error path, and
        //   2. close the upstream iterator (time-bounded) so its finally blocks
        //      run and no socket/connection leaks.
        abortSignal?.removeEventListener('abort', onOuterAbort);
        try { ctrl.abort(); } catch { /* ignore */ }
        await closeIterator(it);
      }
    }
  }

  throw new Error(`All vision providers failed: ${failures.join(' | ') || 'no attempts made'}`);
}
