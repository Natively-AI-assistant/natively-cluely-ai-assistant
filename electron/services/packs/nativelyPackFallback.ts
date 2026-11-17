/**
 * One app, two Natively keys (Evin, 2026-11-17).
 *
 * The server keeps packs and monthly/yearly plans on SEPARATE keys (natively-api
 * lib/planChange.js). A subscriber who buys a pack to get through a busy week
 * would otherwise have to paste the pack key over their plan's key and back. So
 * the app holds both: the plan's key stays the saved key, the pack key is held
 * beside it (CredentialsManager.nativelyPackApiKey), and:
 *
 *   - when the plan's AI or voice allowance is used up (a plan-limit refusal),
 *     the pack key becomes the key in use until the plan refills
 *     (quota_resets_at), or the pack ends, whichever is first;
 *   - then the plan's key is in use again.
 *
 * "In use" is one stored time (nativelyPackInUseUntil); CredentialsManager.
 * getNativelyApiKey() answers with the key in use, so every consumer follows it
 * once `resync` has re-pointed the ones that hold a key (LLMHelper, the voice
 * pipeline, retrieval, the pack clock).
 *
 * Pure: no Electron, no fetch, no timers of its own. ipcHandlers.ts wires it.
 * Nothing here depends on the operating system.
 */

export type KeyFamily = 'pack' | 'subscription';

/** The parts of a /v1/usage answer this needs. */
export interface KeyUsage {
  ok: boolean;
  plan?: string | null;
  billing_period?: string | null;
  quota_resets_at?: string | null;
  pack?: { ended?: boolean | null } | null;
  error?: string;
  /** HTTP status of a refusal (401/403 = the key itself is refused). */
  status?: number;
}

export interface PackFallbackState {
  /** A pack key is held beside the saved key. */
  held: boolean;
  /** The pack key is the one in use now. */
  inUse: boolean;
  /** Until when (ISO), while in use. */
  until: string | null;
  /** Why this state was announced. */
  reason: string;
}

export interface NativelyPackFallbackDeps {
  getMainKey(): string | undefined;
  getPackKey(): string | undefined;
  getInUseUntil(): string | undefined;
  setInUseUntil(iso: string | null): void;
  fetchUsage(key: string): Promise<KeyUsage>;
  /** Re-point everything that holds a Natively key at the key now in use. */
  resync(reason: string): Promise<void> | void;
  notify(state: PackFallbackState): void;
  /** Keys that are never real (the free trial's sentinel). */
  isPlaceholderKey?(key: string): boolean;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
  log?: Pick<Console, 'log' | 'warn'>;
}

/** When the plan's refill time is unknown, look again after this long. */
export const UNKNOWN_REFILL_HOLD_MS = 24 * 60 * 60 * 1000;
/** Timers longer than this are re-armed (setTimeout overflows past ~24.8 days). */
const MAX_TIMER_MS = 6 * 60 * 60 * 1000;

/** A refusal for the plan's allowance (ai_quota_exceeded, transcription_quota_exceeded, …). */
export function isPlanAllowanceRefusal(code: unknown): boolean {
  return typeof code === 'string' && /^(?:[a-z]+_)?quota_exceeded$|^plan_limit$|^limit_exceeded$/.test(code);
}

export function familyOf(usage: Pick<KeyUsage, 'plan' | 'billing_period'> | null | undefined): KeyFamily | null {
  if (!usage) return null;
  const plan = typeof usage.plan === 'string' ? usage.plan.toLowerCase() : '';
  if (usage.billing_period === 'pack' || plan.startsWith('pack_')) return 'pack';
  return plan ? 'subscription' : null;
}

/**
 * Where a pasted key goes:
 *   'main'  the saved key (today's behaviour)
 *   'pack'  held beside a live monthly/yearly key
 *   'swap'  the new monthly/yearly key is saved; the live pack key it replaces is held beside it
 *   'same'  it is the pack key already held: nothing to do
 */
export type KeySlot = 'main' | 'pack' | 'swap' | 'same';

export function decideKeySlot(input: {
  newKey: string;
  mainKey?: string;
  packKey?: string;
  newUsage: KeyUsage | null;
  mainUsage: KeyUsage | null;
  mainIsPlaceholder?: boolean;
}): KeySlot {
  const { newKey, mainKey, packKey, newUsage, mainUsage } = input;
  if (packKey && newKey === packKey) return 'same';
  if (!mainKey || input.mainIsPlaceholder || mainKey === newKey) return 'main';
  // A refused new key, or a saved key that no longer works: as before, the
  // pasted key becomes the saved key (the save reports a refusal itself).
  if (!newUsage?.ok || !mainUsage?.ok) return 'main';
  const fresh = familyOf(newUsage);
  const saved = familyOf(mainUsage);
  if (fresh === 'pack' && saved === 'subscription') return 'pack';
  if (fresh === 'subscription' && saved === 'pack' && !mainUsage.pack?.ended) return 'swap';
  return 'main';
}

export function createNativelyPackFallback(deps: NativelyPackFallbackDeps) {
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? console;
  const schedule = deps.schedule ?? ((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    if (typeof (t as any).unref === 'function') (t as any).unref();
    return () => clearTimeout(t);
  });
  let cancelTimer: (() => void) | null = null;
  let switching: Promise<void> | null = null;

  const untilMs = (): number => {
    const t = Date.parse(deps.getInUseUntil() || '');
    return Number.isFinite(t) ? t : 0;
  };
  const inUse = (): boolean => !!deps.getPackKey() && untilMs() > now();

  function state(reason: string): PackFallbackState {
    const on = inUse();
    return { held: !!deps.getPackKey(), inUse: on, until: on ? deps.getInUseUntil() || null : null, reason };
  }

  function arm(): void {
    if (cancelTimer) { cancelTimer(); cancelTimer = null; }
    if (!inUse()) return;
    const wait = Math.max(1_000, Math.min(untilMs() - now(), MAX_TIMER_MS));
    cancelTimer = schedule(() => { void check('timer'); }, wait);
  }

  async function backToMain(reason: string): Promise<void> {
    if (cancelTimer) { cancelTimer(); cancelTimer = null; }
    deps.setInUseUntil(null);
    log.log(`[PackFallback] back to the plan's key (${reason})`);
    try { await deps.resync(`plan key back: ${reason}`); } catch (e: any) { log.warn('[PackFallback] resync failed:', e?.message ?? e); }
    deps.notify(state(reason));
  }

  /**
   * The SAVED key was refused for its plan's allowance. Switch to the held pack
   * key if it still works. A refusal on the pack key itself, a trial, or a
   * customer with no pack key held changes nothing.
   */
  function onPlanLimit(limit: { code: string; onTrial: boolean }): Promise<void> {
    if (limit.onTrial || !isPlanAllowanceRefusal(limit.code)) return Promise.resolve();
    const main = deps.getMainKey();
    const pack = deps.getPackKey();
    if (!main || !pack || deps.isPlaceholderKey?.(main) || inUse()) return Promise.resolve();
    if (switching) return switching;
    switching = (async () => {
      const [packUsage, mainUsage] = await Promise.all([
        deps.fetchUsage(pack).catch((): KeyUsage => ({ ok: false })),
        deps.fetchUsage(main).catch((): KeyUsage => ({ ok: false })),
      ]);
      if (!packUsage.ok || packUsage.pack?.ended) {
        log.log(`[PackFallback] the plan is used up but the held pack does not work (${packUsage.error ?? 'ended'})`);
        return;
      }
      const refill = Date.parse(mainUsage.ok ? mainUsage.quota_resets_at || '' : '');
      const until = Number.isFinite(refill) && refill > now() ? refill : now() + UNKNOWN_REFILL_HOLD_MS;
      deps.setInUseUntil(new Date(until).toISOString());
      log.log(`[PackFallback] plan used up (${limit.code}) — using the pack until ${new Date(until).toISOString()}`);
      arm();
      try { await deps.resync('plan used up'); } catch (e: any) { log.warn('[PackFallback] resync failed:', e?.message ?? e); }
      deps.notify(state('plan_used_up'));
    })().finally(() => { switching = null; });
    return switching;
  }

  /**
   * Back to the plan's key when its refill time has come, the pack has ended,
   * or the pack key is gone. `reason` 'pack_ended' comes from the pack clock.
   */
  async function check(reason: string): Promise<void> {
    if (!deps.getInUseUntil()) return;
    if (!deps.getPackKey()) return backToMain('pack key removed');
    if (untilMs() <= now()) return backToMain('plan refilled');
    if (reason === 'pack_ended') return backToMain('pack ended');
    if (reason === 'startup' || reason === 'timer') {
      const pack = deps.getPackKey()!;
      const usage = await deps.fetchUsage(pack).catch((): KeyUsage | null => null);
      // Only a definite answer ends it (the key refused, or its pack over); a
      // network failure, a 429 or a 5xx keeps the pack in use.
      if (usage && (usage.ok ? !!usage.pack?.ended : usage.status === 401 || usage.status === 403)) {
        return backToMain('pack ended');
      }
    }
    arm();
  }

  return {
    onPlanLimit,
    check,
    state: () => state('read'),
    /** Run once at startup: resume a fallback that outlived a restart, or end it. */
    start(): Promise<void> {
      return check('startup');
    },
    /** Stop using the pack now (the pack key was removed or replaced). */
    stop(reason: string): Promise<void> {
      return deps.getInUseUntil() ? backToMain(reason) : Promise.resolve();
    },
    /** Where a pasted key goes (see decideKeySlot). Asks the server about both keys. */
    async slotForSave(newKey: string): Promise<KeySlot> {
      const mainKey = deps.getMainKey();
      const packKey = deps.getPackKey();
      if (packKey && newKey === packKey) return 'same';
      if (!mainKey || mainKey === newKey || deps.isPlaceholderKey?.(mainKey)) return 'main';
      const [newUsage, mainUsage] = await Promise.all([
        deps.fetchUsage(newKey).catch(() => null),
        deps.fetchUsage(mainKey).catch(() => null),
      ]);
      return decideKeySlot({ newKey, mainKey, packKey, newUsage, mainUsage });
    },
  };
}

export type NativelyPackFallback = ReturnType<typeof createNativelyPackFallback>;

// One per process, not per bundle: the build makes every .ts file its own
// bundle with its imports inlined (see nativelyPlanLimitEvents.ts), so the pack
// clock's wiring reaches the instance ipcHandlers.ts made through this holder.
const HOLDER_KEY = Symbol.for('natively.nativelyPackFallback');
const holder = globalThis as unknown as { [HOLDER_KEY]?: NativelyPackFallback | null };

export function setNativelyPackFallback(instance: NativelyPackFallback | null): void {
  holder[HOLDER_KEY] = instance;
}

export function currentNativelyPackFallback(): NativelyPackFallback | null {
  return holder[HOLDER_KEY] ?? null;
}
