// electron/llm/providerCallBudget.ts
//
// Per-turn call budget + cross-turn circuit breaker for the selected-provider
// text path (pipeline forensics 2026-11-13, F-LAT-10; ADR-003).
//
// PROBLEM. With every request returning 500, one question cost 15-17 answer
// calls before the canned retry line (P2/O2/F0-s16g), 7-10 s after speech end:
//   × 3  the OpenAI/Anthropic SDK's own retries (maxRetries defaults to 2),
//        invisible to the fallback engine that is supposed to own retrying;
//   × 2  the parallel "hedge" retry of a lone provider;
//   × 3  speculation, prefetch and the regeneration each starting over.
//
// DECISION (ADR-003):
//   • a turn may spend at most TURN_MAX_UNCOMMITTED_CALLS provider calls that
//     did not produce an answer — 1 primary, 1 hedge or spare, 1 regeneration.
//     A call that commits (first real token) refunds its slot, so a turn that
//     answered can still run its repair/verifier passes;
//   • a provider family that failed BREAKER_FAILURE_THRESHOLD times in a row
//     within BREAKER_WINDOW_MS is skipped for BREAKER_COOLDOWN_MS, then gets
//     ONE probe call; success closes it, failure re-opens it;
//   • a call the engine manages gets maxRetries: 0 from the SDK, so the engine
//     is the only thing retrying.
//
// Pure: no Electron, no SDK imports — unit testable and identical on macOS and
// Windows.

export const TURN_MAX_UNCOMMITTED_CALLS = 3;
export const BREAKER_FAILURE_THRESHOLD = 3;
export const BREAKER_WINDOW_MS = 30_000;
export const BREAKER_COOLDOWN_MS = 20_000;

export const PROVIDER_CIRCUIT_OPEN_CODE = 'PROVIDER_CIRCUIT_OPEN';
export const TURN_CALL_BUDGET_EXHAUSTED_CODE = 'TURN_CALL_BUDGET_EXHAUSTED';

// ── Calls whose retrying the fallback engine owns ─────────────────────────
const engineManagedSignals = new WeakSet<AbortSignal>();

export function markEngineManagedSignal(signal: AbortSignal | undefined): void {
  if (signal) engineManagedSignals.add(signal);
}

/** SDK request options for a streaming call: no SDK-internal retries when the
 *  fallback engine owns this call's retrying. Empty otherwise (SDK default). */
export function sdkRetryOptions(signal: AbortSignal | undefined): { maxRetries?: number } {
  return signal && engineManagedSignals.has(signal) ? { maxRetries: 0 } : {};
}

// ── Per-turn budget ───────────────────────────────────────────────────────
export class TurnCallBudget {
  private readonly used = new WeakMap<object, number>();
  private readonly aliases = new WeakMap<object, object>();

  constructor(private readonly max: number = TURN_MAX_UNCOMMITTED_CALLS) { }

  /** Make `key` share `turnKey`'s budget (a regeneration with a fresh signal). */
  alias(key: object | undefined | null, turnKey: object | undefined | null): void {
    if (!key || !turnKey || key === turnKey) return;
    this.aliases.set(key, this.resolve(turnKey));
  }

  resolve(key: object): object {
    let k = key;
    for (let i = 0; i < 8; i++) {
      const next = this.aliases.get(k);
      if (!next || next === k) break;
      k = next;
    }
    return k;
  }

  remaining(key: object): number {
    return Math.max(0, this.max - (this.used.get(this.resolve(key)) ?? 0));
  }

  /** Spend one slot; false when the turn has none left. */
  tryTake(key: object): boolean {
    const k = this.resolve(key);
    const n = this.used.get(k) ?? 0;
    if (n >= this.max) return false;
    this.used.set(k, n + 1);
    return true;
  }

  /** A call that committed did not cost the turn a failed attempt. */
  refund(key: object): void {
    const k = this.resolve(key);
    const n = this.used.get(k) ?? 0;
    if (n > 0) this.used.set(k, n - 1);
  }
}

// ── Cross-turn circuit breaker, per provider family ──────────────────────
interface BreakerEntry {
  consecutiveFails: number;
  lastFailAt: number;
  openUntil: number;
  probeInFlight: boolean;
}

export type BreakerDecision = 'closed' | 'probe' | 'open';

export class ProviderCircuitBreaker {
  private readonly entries = new Map<string, BreakerEntry>();

  constructor(private readonly opts: {
    threshold?: number; windowMs?: number; cooldownMs?: number; now?: () => number;
  } = {}) { }

  private get now(): number { return (this.opts.now ?? Date.now)(); }
  private get threshold(): number { return this.opts.threshold ?? BREAKER_FAILURE_THRESHOLD; }
  private get windowMs(): number { return this.opts.windowMs ?? BREAKER_WINDOW_MS; }
  private get cooldownMs(): number { return this.opts.cooldownMs ?? BREAKER_COOLDOWN_MS; }

  /** May a call to `family` go out now? 'probe' means: this one call only. */
  admit(family: string): BreakerDecision {
    const e = this.entries.get(family);
    if (!e || e.openUntil === 0) return 'closed';
    if (this.now < e.openUntil) return 'open';
    if (e.probeInFlight) return 'open';
    e.probeInFlight = true;
    return 'probe';
  }

  /** Read-only: is the family currently being skipped? */
  isOpen(family: string): boolean {
    const e = this.entries.get(family);
    if (!e || e.openUntil === 0) return false;
    return this.now < e.openUntil || e.probeInFlight;
  }

  /** Remaining cool-down, for the user-facing error. */
  retryInMs(family: string): number {
    const e = this.entries.get(family);
    return e ? Math.max(0, e.openUntil - this.now) : 0;
  }

  recordSuccess(family: string): void {
    this.entries.delete(family);
  }

  recordFailure(family: string): void {
    const now = this.now;
    const e = this.entries.get(family) ?? { consecutiveFails: 0, lastFailAt: 0, openUntil: 0, probeInFlight: false };
    const wasProbe = e.probeInFlight;
    e.probeInFlight = false;
    if (wasProbe) {
      // The probe failed: straight back to open.
      e.consecutiveFails += 1;
      e.lastFailAt = now;
      e.openUntil = now + this.cooldownMs;
    } else {
      if (e.consecutiveFails > 0 && now - e.lastFailAt > this.windowMs) e.consecutiveFails = 0;
      e.consecutiveFails += 1;
      e.lastFailAt = now;
      if (e.consecutiveFails >= this.threshold) e.openUntil = now + this.cooldownMs;
    }
    this.entries.set(family, e);
  }

  /** The call ended without an outcome that says anything about the provider
   *  (cancelled, lost a hedge race): release a probe slot if it held one. */
  recordNeutral(family: string): void {
    const e = this.entries.get(family);
    if (e) e.probeInFlight = false;
  }
}

/** The error for a family the breaker is skipping. 503 so every classifier
 *  reads it as "the provider is unavailable", which is what it is. */
export function circuitOpenError(name: string, retryInMs: number): Error {
  const secs = Math.max(1, Math.ceil(retryInMs / 1000));
  return Object.assign(
    new Error(`${name} failed repeatedly (503 unavailable); not calling it again for ${secs}s`),
    { status: 503, code: PROVIDER_CIRCUIT_OPEN_CODE },
  );
}

export function turnBudgetExhaustedError(name: string): Error {
  return Object.assign(
    new Error(`${name}: this turn already used its ${TURN_MAX_UNCOMMITTED_CALLS} provider attempts (503 unavailable)`),
    { status: 503, code: TURN_CALL_BUDGET_EXHAUSTED_CODE },
  );
}

/**
 * Wrap a provider `open` so every call it makes is charged to the turn budget,
 * gated by the family breaker, marked engine-managed (no SDK retries), and its
 * outcome recorded. A call refused by the budget or the breaker throws BEFORE
 * any request is made.
 */
export function guardProviderOpen(opts: {
  family: string;
  name: string;
  turnKey: object;
  budget: TurnCallBudget;
  breaker: ProviderCircuitBreaker;
  /** The caller's own cancel: an abort through it says nothing about the provider. */
  outerSignal?: AbortSignal;
  open: (signal: AbortSignal) => AsyncGenerator<string, void, unknown>;
}): (signal: AbortSignal) => AsyncGenerator<string, void, unknown> {
  const { family, name, turnKey, budget, breaker, outerSignal, open } = opts;
  return (signal: AbortSignal) => (async function* () {
    const admitted = breaker.admit(family);
    if (admitted === 'open') throw circuitOpenError(name, breaker.retryInMs(family));
    if (!budget.tryTake(turnKey)) {
      if (admitted === 'probe') breaker.recordNeutral(family);
      throw turnBudgetExhaustedError(name);
    }
    markEngineManagedSignal(signal);
    let committed = false;
    let settled = false;
    try {
      for await (const chunk of open(signal)) {
        if (!committed && typeof chunk === 'string' && chunk.trim().length > 0) {
          committed = true;
          settled = true;
          breaker.recordSuccess(family);
          budget.refund(turnKey);
        }
        yield chunk;
      }
      if (!committed) {
        // Ended with no text: a failed call, unless the turn was cancelled.
        settled = true;
        if (outerSignal?.aborted || isHedgeLoss(signal)) breaker.recordNeutral(family);
        else breaker.recordFailure(family);
      }
    } catch (e) {
      if (!committed) {
        settled = true;
        if (outerSignal?.aborted || isHedgeLoss(signal)) breaker.recordNeutral(family);
        else breaker.recordFailure(family);
      }
      throw e;
    } finally {
      // Closed from outside before any outcome (the engine gave up on the
      // first token, or the consumer stopped): the engine only does that on its
      // own first-token timeout or a cancel.
      if (!settled) {
        if (outerSignal?.aborted || isHedgeLoss(signal)) breaker.recordNeutral(family);
        else breaker.recordFailure(family);
      }
    }
  })();
}

function isHedgeLoss(signal: AbortSignal): boolean {
  const r: any = (signal as any)?.reason;
  return !!r && /hedge-lost/.test(String(r?.message ?? r));
}
