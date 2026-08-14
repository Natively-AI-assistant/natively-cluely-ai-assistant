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
  /**
   * Optional per-provider time-to-first-token budget (ms). Overrides the
   * config-level `ttftTimeoutMs` for THIS provider only. Vision is slower than
   * text — heavier models (Pro) and multi-screenshot requests need a longer
   * budget so we don't abort a healthy-but-slow first token. When omitted the
   * provider uses cfg.ttftTimeoutMs.
   */
  ttftTimeoutMs?: number;
  /**
   * Optional intra-family HEDGE partner. When set AND cfg.hedgeEnabled, the
   * engine opens this provider normally, then — if no first token has arrived
   * within a short EWMA-derived delay — launches the partner IN PARALLEL. The
   * first usable first-token wins; the loser is aborted immediately. Used to cut
   * tail latency when the primary flash model is intermittently slow, without
   * paying for a duplicate call on the fast common case. Partner is skipped if
   * its circuit breaker is OPEN. (See openHedged.)
   */
  hedgeWith?: {
    id: string;
    name: string;
    open: (signal: AbortSignal, attempt: number) => AsyncGenerator<string, void, unknown>;
  };
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
  // ── Hedging (tail-latency) — only applies to providers with `hedgeWith` set ──
  /** Master switch. When false, hedgeWith is ignored (byte-identical to no-hedge). */
  hedgeEnabled: boolean;
  /** Hedge delay when the primary has no measured TTFT EWMA yet. */
  hedgeDelayDefaultMs: number;
  /** Fraction of the primary's ttftEma to wait before launching the partner (~p50 trigger). */
  hedgeDelayEmaFactor: number;
  /** Lower/upper clamp on the hedge delay so it stays well below ttftTimeoutMs. */
  hedgeDelayMinMs: number;
  hedgeDelayMaxMs: number;
  /**
   * Optional: abort the ENTIRE provider chain (not just the current provider's
   * attempts) when a pre-commit error matches. Use when the remaining providers
   * would fail for the SAME reason — e.g. a serial cascade of models that all
   * share one API key: an expired-key / no-credits error on the first model
   * means every sibling on that key fails too, so retrying them is wasted
   * latency. When this returns true the engine stops immediately and throws (the
   * caller's catch can then fall through to a DIFFERENT provider). Receives the
   * raw error and its classified VisionErrorClass. Post-commit failures never
   * reach this (output already started). Default: never stop early.
   */
  stopChainOnError?: (err: any, errorClass: VisionErrorClass) => boolean;
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
  // Vision TTFT is slower than text (image encode + multimodal prefill). 8s was
  // too aggressive and aborted healthy first tokens on screenshots — especially
  // multi-screenshot requests. 20s base; per-provider overrides bump Pro higher
  // and the call site scales with image count.
  ttftTimeoutMs: 20_000,
  interChunkTimeoutMs: 15_000,
  authCooldownMs: 300_000,
  transientCooldownMs: 30_000,
  incompatibleCooldownMs: 600_000,
  backoffInitialMs: 250,
  backoffMaxMs: 10_000,
  cleanupTimeoutMs: 2_000,
  // Hedging defaults — off unless the caller opts in (and a provider sets hedgeWith).
  hedgeEnabled: false,
  hedgeDelayDefaultMs: 3_000,
  hedgeDelayEmaFactor: 0.6,
  hedgeDelayMinMs: 2_500,
  hedgeDelayMaxMs: 6_000,
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

// Time-bounded close of a provider's upstream iterator. .return() runs the
// generator's finally blocks (reader.cancel / stream.abort), which for a dead
// socket can stall — so we never await it unbounded. Module-level so the hedge
// helper reuses the exact same teardown as the engine loop.
export async function closeIteratorBounded(it: AsyncIterator<string> | null, cleanupTimeoutMs: number): Promise<void> {
  if (!it || typeof it.return !== 'function') return;
  try {
    await Promise.race([
      Promise.resolve(it.return(undefined as any)).catch(() => { }),
      new Promise<void>((resolve) => setTimeout(resolve, cleanupTimeoutMs)),
    ]);
  } catch { /* ignore */ }
}

/**
 * Hedged open: start `primary`, and if it hasn't produced a first token within
 * an EWMA-derived delay, launch `primary.hedgeWith` IN PARALLEL. The first
 * branch to yield a usable first token wins; the loser is aborted + closed.
 * Returns the winner's live stream (first token re-injected). Throws if BOTH
 * branches fail pre-token (the engine then advances to the next provider).
 *
 * TTFT is recorded against the WINNING id so health/ordering stay accurate.
 * The partner is skipped (primary runs solo) when its circuit breaker is OPEN.
 */
export async function* openHedged(
  primary: VisionStreamProvider,
  cfg: VisionFallbackConfig,
  health: Map<string, VisionHealthEntry>,
  hooks: VisionFallbackHooks,
  outerSignal: AbortSignal,
  attempt: number,
): AsyncGenerator<string, void, unknown> {
  const now = hooks.now ?? Date.now;
  const log = hooks.log ?? (() => { });
  const partner = primary.hedgeWith;

  // Hedge delay from the primary's measured TTFT EWMA (~p50 trigger), clamped.
  const ema = health.get(primary.id)?.ttftEma ?? null;
  const rawDelay = ema != null ? Math.round(ema * cfg.hedgeDelayEmaFactor) : cfg.hedgeDelayDefaultMs;
  const hedgeDelayMs = Math.min(cfg.hedgeDelayMaxMs, Math.max(cfg.hedgeDelayMinMs, rawDelay));

  // Skip the partner if its breaker is OPEN — don't pour requests into a cooling provider.
  const partnerBreakerClosed = partner ? (health.get(partner.id)?.openUntil ?? 0) <= now() : false;
  const useHedge = !!partner && partnerBreakerClosed;

  interface Branch {
    id: string; name: string; ctrl: AbortController; it: AsyncIterator<string>;
    started: number;
    /** Resolves to the branch+first-token on a USABLE first token; rejects on
     *  error or empty/done first chunk. Never rejects the outer race directly. */
    firstUsable: Promise<{ branch: Branch; first: IteratorResult<string> }>;
  }
  const branches: Branch[] = [];
  const startBranch = (p: { id: string; name: string; open: (s: AbortSignal, a: number) => AsyncGenerator<string, void, unknown> }): Branch => {
    const ctrl = new AbortController();
    const onAbort = () => { try { ctrl.abort(); } catch { } };
    outerSignal.addEventListener('abort', onAbort, { once: true });
    const it = p.open(ctrl.signal, attempt)[Symbol.asyncIterator]();
    const branch: Branch = { id: p.id, name: p.name, ctrl, it, started: now(), firstUsable: undefined as any };
    branch.firstUsable = it.next().then((res) => {
      if (res.done || typeof res.value !== 'string' || res.value.trim().length === 0) {
        throw new Error('empty-stream');
      }
      return { branch, first: res };
    });
    branch.firstUsable.catch(() => { }); // swallow when this branch loses/fails
    return branch;
  };

  // First-usable-token race over a set of branch promises: resolves with the
  // first success; rejects only when ALL provided promises have rejected.
  const firstSuccess = (ps: Promise<{ branch: Branch; first: IteratorResult<string> }>[]) =>
    new Promise<{ branch: Branch; first: IteratorResult<string> }>((resolve, reject) => {
      let remaining = ps.length; let settled = false;
      for (const p of ps) p.then(
        (v) => { if (!settled) { settled = true; resolve(v); } },
        () => { remaining--; if (remaining === 0 && !settled) { settled = true; reject(new Error('all-branches-failed')); } },
      );
    });

  branches.push(startBranch(primary));
  let winner: Branch; let first: IteratorResult<string>;

  if (!useHedge) {
    // No hedge: just await the primary's first usable token (engine's own
    // ttftTimeoutMs still wraps this call as the hard ceiling).
    ({ branch: winner, first } = await branches[0].firstUsable);
  } else {
    // Wait for the primary to win OR the hedge delay to elapse.
    let hedgeTimer: ReturnType<typeof setTimeout> | null = null;
    const hedgeElapsed = new Promise<'hedge'>((resolve) => { hedgeTimer = setTimeout(() => resolve('hedge'), hedgeDelayMs); });
    const primaryOutcome = branches[0].firstUsable.then((v) => ({ kind: 'win' as const, v }), (e) => ({ kind: 'fail' as const, e }));

    const race = await Promise.race([primaryOutcome, hedgeElapsed]);
    if (hedgeTimer) clearTimeout(hedgeTimer);

    if (race !== 'hedge' && race.kind === 'win') {
      // Primary produced a usable token before the hedge delay — no duplicate call.
      ({ branch: winner, first } = race.v);
    } else {
      // Either the delay elapsed (primary still pending) or the primary failed
      // fast — launch the partner and race whatever is still live.
      log(`[Vision] hedge fired after ${hedgeDelayMs}ms → racing ${partner!.name}`);
      branches.push(startBranch(partner!));
      // If the primary already failed fast, only the partner is in the race;
      // otherwise race both still-pending first tokens.
      const pool = (race !== 'hedge' && race.kind === 'fail')
        ? [branches[1].firstUsable]
        : [branches[0].firstUsable, branches[1].firstUsable];
      ({ branch: winner, first } = await firstSuccess(pool));
    }
  }

  // Abort + close every loser immediately (free socket/quota).
  for (const b of branches) {
    if (b !== winner) { try { b.ctrl.abort(new Error('hedge-lost')); } catch { } void closeIteratorBounded(b.it, cfg.cleanupTimeoutMs); }
  }
  recordVisionTtft(health, winner.id, now() - winner.started);
  if (branches.length > 1) log(`[Vision] hedge winner: ${winner.name} (ttft=${now() - winner.started}ms)`);

  // Re-inject the winning first token, then delegate to its live stream.
  yield first.value as string;
  try {
    yield* { [Symbol.asyncIterator]: () => winner.it } as AsyncIterable<string>;
  } finally {
    await closeIteratorBounded(winner.it, cfg.cleanupTimeoutMs);
  }
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

  // Time-bounded close of a provider's upstream iterator (module helper).
  const closeIterator = (it: AsyncIterator<string> | null): Promise<void> =>
    closeIteratorBounded(it, cfg.cleanupTimeoutMs);

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
        // Hedge group: when enabled and this provider declares a partner, the
        // first usable token is raced across primary+partner (delayed launch).
        // Otherwise plain single-provider open. Either way the engine's own TTFT
        // timeout below wraps it as the hard ceiling.
        const src = (cfg.hedgeEnabled && provider.hedgeWith && (health.get(provider.id)?.openUntil ?? 0) <= now())
          ? openHedged(provider, cfg, health, hooks, ctrl.signal, attempt)
          : provider.open(ctrl.signal, attempt);
        it = src[Symbol.asyncIterator]();

        // ── Race chunk #1 against the TTFT timeout (the only safe fallback point) ──
        const firstNext = it.next();
        firstNext.catch(() => { }); // swallow late rejection if the timeout wins
        let ttftTimer: ReturnType<typeof setTimeout> | null = null;
        // Per-provider TTFT budget when set (e.g. Pro is slower), else config default.
        const providerTtftMs = provider.ttftTimeoutMs ?? cfg.ttftTimeoutMs;
        const ttft = new Promise<never>((_, rej) => {
          ttftTimer = setTimeout(() => { try { ctrl.abort(); } catch { } rej(new Error('ttft-timeout')); }, providerTtftMs);
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

        // Whole-chain abort: when the remaining providers would fail for the SAME
        // reason (e.g. every sibling shares one expired/no-credit API key), stop
        // immediately instead of walking them. The `finally` below still runs for
        // THIS attempt; the throw exits both loops so the caller can fall through
        // to a different provider. Mark this provider unhealthy first so it isn't
        // tried first next time either.
        if (cfg.stopChainOnError && cfg.stopChainOnError(err, cls)) {
          markVisionUnhealthy(health, provider.id, cfg.authCooldownMs, now());
          warn(`[Vision] ${provider.name}: ${cls} is fatal for the whole chain (shared-credential) — aborting remaining providers`);
          throw new Error(`Provider chain aborted (${cls}): ${err?.message || err}`);
        }

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
