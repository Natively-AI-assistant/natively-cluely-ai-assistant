/**
 * One app, two Natively keys (Evin, 2026-11-17).
 *
 * The server keeps packs and monthly/yearly plans on SEPARATE keys (natively-api
 * lib/planChange.js). Every pack a customer buys lands on their ONE pack key:
 * the hours stack, unused credit carries, and the stack ends with the newest
 * pack's window. The app holds the plan's key (the saved key) and that pack key
 * beside it (CredentialsManager.nativelyPackApiKey).
 *
 * The pack is used FIRST (Evin, 2026-11-17/18):
 *
 *   - a held pack that is live is the key in use as soon as it is held, at
 *     startup and after a plan key is saved beside it, whatever the plan has
 *     left; the plan's own allowance waits;
 *   - it stays in use until the PACK's own time is over (its use-by date,
 *     pack.ends_at, or its hours);
 *   - it stops early when it has used up something the plan still has (AI,
 *     voice, knowledge or research), so a request the plan can answer is never
 *     refused; an allowance the plan does not include (limit 0) or has also
 *     used up does not stop it;
 *   - then the plan's key is in use again. A pack that stopped early is used
 *     again once the plan runs out of that too;
 *   - research is the one exception to one key for everything (Evin,
 *     2026-11-18): once the pack's research runs are spent, company research
 *     uses the plan's research while the plan has some, and the pack stays in
 *     use for the rest (researchKey; resolveCompanySearchProvider.ts).
 *
 * Which key serves is decided from what the server says about BOTH keys
 * (choosePackOrPlan), never from a refusal code alone. No definite answer
 * (offline, 5xx) keeps whatever is in use.
 *
 * "In use" is one stored time (nativelyPackInUseUntil); CredentialsManager.
 * getNativelyApiKey() answers with the key in use, so every consumer follows it
 * once `resync` has re-pointed the ones that hold a key (LLMHelper, the voice
 * pipeline, retrieval, the pack clock, Pro).
 *
 * Pure: no Electron, no fetch, no timers of its own. ipcHandlers.ts wires it.
 * Nothing here depends on the operating system.
 */

export type KeyFamily = 'pack' | 'subscription';
export type Resource = 'ai' | 'voice' | 'knowledge' | 'research';

interface Meter {
  remaining?: number | null;
  limit?: number | null;
  /** Research only: the run counts the server's gate compares. */
  runs_remaining?: number | null;
  runs_limit?: number | null;
}

/** The parts of a /v1/usage answer this needs. */
export interface KeyUsage {
  ok: boolean;
  plan?: string | null;
  billing_period?: string | null;
  /** ends_at: the pack's use-by date (ISO). */
  pack?: { ended?: boolean | null; ends_at?: string | null } | null;
  /** What is left of each allowance. */
  quota?: {
    ai?: Meter | null;
    voice?: Meter | null;
    transcription?: Meter | null;
    knowledge?: { embedding?: Meter | null; reranker?: Meter | null } | null;
    embedding?: Meter | null;
    research?: Meter | null;
    search?: Meter | null;
  } | null;
  error?: string;
  /** HTTP status of a refusal (401/403 = the key itself is refused). */
  status?: number;
}

export interface PackFallbackState {
  /** A pack key is held beside the saved key. */
  held: boolean;
  /** The pack key is the one in use now. */
  inUse: boolean;
  /** The pack's use-by date (ISO) while in use, when the server named it. */
  until: string | null;
  /** Why this state was announced. */
  reason: string;
  /**
   * Not in use although the pack is live: it used up something the plan still
   * has. False for a pack that is over, not looked at yet, or unanswered.
   */
  stoppedEarly: boolean;
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

/** The pack's use-by date unknown: keep it in use this long, then ask again. */
export const UNKNOWN_PACK_END_HOLD_MS = 24 * 60 * 60 * 1000;
/** No definite answer from the server: keep what is in use, ask again after this. */
export const RETRY_MS = 15 * 60 * 1000;
/** A held pack not in use: look again this often (has the plan ended?). */
export const WATCH_MS = 30 * 60 * 1000;
/** The pack's use-by date has passed here but the server has not ended it yet (clocks differ): ask again this soon. */
export const END_GRACE_MS = 60 * 1000;
/** Plan-limit events closer together than this share one look. */
const EVENT_SPACING_MS = 20 * 1000;
/** Timers longer than this are re-armed (setTimeout overflows past ~24.8 days). */
const MAX_TIMER_MS = 6 * 60 * 60 * 1000;

export function familyOf(usage: Pick<KeyUsage, 'plan' | 'billing_period'> | null | undefined): KeyFamily | null {
  if (!usage) return null;
  const plan = typeof usage.plan === 'string' ? usage.plan.toLowerCase() : '';
  if (usage.billing_period === 'pack' || plan.startsWith('pack_')) return 'pack';
  return plan ? 'subscription' : null;
}

/** The server definitely refused the key itself (not offline, not busy). */
const keyRefused = (u: KeyUsage | null | undefined): boolean => !!u && !u.ok && (u.status === 401 || u.status === 403);

/** A pack that is definitely over: its time or hours are up, or its key is refused. */
export function packIsOver(u: KeyUsage | null | undefined): boolean {
  return !!u && (u.ok ? !!u.pack?.ended : keyRefused(u));
}

/**
 * A meter that has run out. Same rule as the server's isResourceExhausted: a
 * null limit is unmetered, never "out". A limit of 0 is an allowance the plan
 * does not include: not used up, so a Standard plan with no research does not
 * hand everything to the pack.
 */
function read(m: Meter, runs: boolean): { limit: number | null | undefined; remaining: number | null | undefined } {
  return {
    limit: runs && m.runs_limit !== undefined ? m.runs_limit : m.limit,
    remaining: runs && m.runs_remaining !== undefined ? m.runs_remaining : m.remaining,
  };
}

function gone(m: Meter | null | undefined, runs = false): boolean {
  if (!m) return false;
  const { limit, remaining } = read(m, runs);
  if (limit === null || limit === 0) return false;
  return typeof remaining === 'number' && remaining <= 0;
}

/** The allowances a working key has used up; null for a key with no answer. */
export function usedUp(u: KeyUsage | null | undefined): Set<Resource> | null {
  if (!u?.ok) return null;
  const q = u.quota;
  const out = new Set<Resource>();
  if (gone(q?.ai)) out.add('ai');
  if (gone(q?.voice ?? q?.transcription)) out.add('voice');
  // Knowledge is two halves (embedding, reranker): either one out stops it.
  if (gone(q?.knowledge?.embedding ?? q?.embedding) || gone(q?.knowledge?.reranker)) out.add('knowledge');
  if (gone(q?.research ?? q?.search, true)) out.add('research');
  return out;
}

/**
 * What a working key can still serve: metered with some left, or unmetered.
 * An allowance with limit 0 is one the plan does not include.
 */
function stillHas(u: KeyUsage): Set<Resource> {
  const q = u.quota;
  const has = (m: Meter | null | undefined, runs = false): boolean => {
    if (!m) return false;
    const { limit, remaining } = read(m, runs);
    if (limit === null) return true;            // unmetered
    if (limit === 0) return false;              // not part of this plan
    return typeof remaining !== 'number' || remaining > 0;
  };
  const out = new Set<Resource>();
  if (has(q?.ai)) out.add('ai');
  if (has(q?.voice ?? q?.transcription)) out.add('voice');
  const emb = q?.knowledge?.embedding ?? q?.embedding;
  const rer = q?.knowledge?.reranker;
  if ((emb || rer) && (!emb || has(emb)) && (!rer || has(rer))) out.add('knowledge');
  if (has(q?.research ?? q?.search, true)) out.add('research');
  return out;
}

/**
 * The key company research should use: the plan's while the pack is in use,
 * its research runs are spent and the plan still has research; otherwise null
 * (the key in use).
 */
export function researchGoesToPlan(packUsage: KeyUsage | null, mainUsage: KeyUsage | null): boolean {
  const packOut = usedUp(packUsage);
  if (!packOut?.has('research') || !mainUsage?.ok) return false;
  return stillHas(mainUsage).has('research');
}

/**
 * Which key should serve now:
 *   'pack'     the pack (see the header for when);
 *   'plan'     the plan's key;
 *   'unknown'  no definite answer about a key that matters: keep what is in use.
 */
export function choosePackOrPlan(input: {
  mainUsage: KeyUsage | null;
  packUsage: KeyUsage | null;
  packInUse: boolean;
}): 'pack' | 'plan' | 'unknown' {
  const { mainUsage, packUsage } = input;
  if (packIsOver(packUsage)) return 'plan';
  const packOut = usedUp(packUsage);
  if (!packOut) return 'unknown';
  // The pack is used first: while it has everything, the plan does not matter
  // (not even an offline answer about it).
  if (packOut.size === 0) return 'pack';
  // An ended plan (cancelled, expired, refunded, payment failed) has nothing.
  if (keyRefused(mainUsage)) return 'pack';
  if (!mainUsage?.ok) return 'unknown';
  const planHas = stillHas(mainUsage);
  // Never refuse what the plan can still answer for a pack that has run out of
  // it. Not research: that goes to the plan's key on its own (researchKey).
  if ([...packOut].some((r) => r !== 'research' && planHas.has(r))) return 'plan';
  return 'pack';
}

/**
 * Where a pasted key goes:
 *   'main'        the saved key (today's behaviour)
 *   'pack'        held beside a live monthly/yearly key
 *   'swap'        the new monthly/yearly key is saved; the live pack key it replaces is held beside it
 *   'same'        it is the pack key already held: nothing to do
 *   'pack_taken'  a second pack key while a live one is held or saved: refused.
 *                 Every pack lands on the customer's one pack key (bought with
 *                 the same email, or from the app's pack buttons).
 */
export type KeySlot = 'main' | 'pack' | 'swap' | 'same' | 'pack_taken';

export function decideKeySlot(input: {
  newKey: string;
  mainKey?: string;
  packKey?: string;
  newUsage: KeyUsage | null;
  mainUsage: KeyUsage | null;
  /** The held pack key's answer, when one is held. */
  packUsage?: KeyUsage | null;
  mainIsPlaceholder?: boolean;
}): KeySlot {
  const { newKey, mainKey, packKey, newUsage, mainUsage, packUsage } = input;
  if (packKey && newKey === packKey) return 'same';
  if (!mainKey || input.mainIsPlaceholder || mainKey === newKey) return 'main';
  const fresh = newUsage?.ok ? familyOf(newUsage) : null;
  const saved = mainUsage?.ok ? familyOf(mainUsage) : null;
  // A live pack is already here: a "maybe" (no answer) counts as live, so a
  // pack is never thrown away on a network blip.
  const liveHeldPack = !!packKey && !packIsOver(packUsage);
  const liveSavedPack = saved === 'pack' && !mainUsage?.pack?.ended;
  if (fresh === 'pack' && (liveHeldPack || liveSavedPack)) return 'pack_taken';
  // A refused new key, or a saved key that no longer works: as before, the
  // pasted key becomes the saved key (the save reports a refusal itself).
  if (!newUsage?.ok || !mainUsage?.ok) return 'main';
  if (fresh === 'pack' && saved === 'subscription') return 'pack';
  if (fresh === 'subscription' && saved === 'pack' && !mainUsage.pack?.ended) return 'swap';
  return 'main';
}

export const PACK_TAKEN_MESSAGE =
  'You already have a pack key. New packs are added to it when you buy with the same email or from the pack buttons here. To use this key instead, remove the current pack first.';

export function createNativelyPackFallback(deps: NativelyPackFallbackDeps) {
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? console;
  const schedule = deps.schedule ?? ((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    if (typeof (t as any).unref === 'function') (t as any).unref();
    return () => clearTimeout(t);
  });
  let cancelTimer: (() => void) | null = null;
  let evaluating: Promise<void> | null = null;
  let lastEventLookAt = -Infinity;
  /** The pack's use-by date (ms) as the server last named it; null when unknown. */
  let knownEnd: number | null = null;
  // The plan's key refused at the latest definite answer (the plan ended).
  let planWasEnded = false;
  // The latest verdict was 'plan' for a pack that is still live.
  let stoppedEarly = false;
  // The latest answers about both keys, for researchKey.
  let lastUsage: { pack: string; main: string; packUsage: KeyUsage | null; mainUsage: KeyUsage | null } | null = null;

  const untilMs = (): number => {
    const t = Date.parse(deps.getInUseUntil() || '');
    return Number.isFinite(t) ? t : 0;
  };
  /** The pack key is the key in use right now (CredentialsManager's own rule). */
  const serving = (): boolean => !!deps.getPackKey() && untilMs() > now();
  /** The pack was put in use and nothing has ended that yet (its time may have just passed). */
  const marked = (): boolean => !!deps.getPackKey() && !!deps.getInUseUntil();

  function state(reason: string): PackFallbackState {
    const on = serving();
    const until = on && knownEnd != null && knownEnd > now() ? new Date(knownEnd).toISOString() : null;
    return { held: !!deps.getPackKey(), inUse: on, until, reason, stoppedEarly: !on && stoppedEarly };
  }

  function armIn(ms: number): void {
    if (cancelTimer) { cancelTimer(); cancelTimer = null; }
    cancelTimer = schedule(() => { void evaluate('timer'); }, Math.max(1_000, Math.min(ms, MAX_TIMER_MS)));
  }

  /** The next look: at the end of the pack's time, or a watch while it is only held. */
  /**
   * The next look. In use: at the pack's end, and at least every WATCH_MS so a
   * plan that ends meanwhile moves Pro to the pack (review 2026-11-18). Held
   * and over: slowly (MAX_TIMER_MS), since a pack bought later lands on the
   * same key and brings it back.
   */
  function arm(overPack = false): void {
    if (cancelTimer) { cancelTimer(); cancelTimer = null; }
    if (marked()) return armIn(Math.min(untilMs() - now(), WATCH_MS));
    if (deps.getPackKey() && deps.getMainKey()) armIn(overPack ? MAX_TIMER_MS : WATCH_MS);
  }

  async function resyncAndNotify(why: string, reason: string): Promise<void> {
    try { await deps.resync(why); } catch (e: any) { log.warn('[PackFallback] resync failed:', e?.message ?? e); }
    deps.notify(state(reason));
  }

  async function backToMain(reason: string): Promise<void> {
    if (cancelTimer) { cancelTimer(); cancelTimer = null; }
    deps.setInUseUntil(null);
    knownEnd = null;
    log.log(`[PackFallback] back to the plan's key (${reason})`);
    arm();
    await resyncAndNotify(`plan key back: ${reason}`, reason);
  }

  /**
   * Keep (or put) the pack in use until `until`. `announce`: the pack key was
   * not in use for the consumers that hold a key (LLMHelper, voice, Pro), so
   * re-point them. Extending the time of a pack already in use announces
   * nothing: those consumers never left it (review 2026-11-17: re-syncing on
   * every extension rebuilt the voice pipeline mid-meeting every 15 minutes
   * during an outage).
   */
  async function usePack(until: number, end: number | null, why: string, reason: string, announce: boolean): Promise<void> {
    knownEnd = end;
    deps.setInUseUntil(new Date(until).toISOString());
    arm();
    if (announce) {
      log.log(`[PackFallback] ${why} — using the pack until ${new Date(until).toISOString()}`);
      await resyncAndNotify(why, reason);
    }
  }

  /** Ask the server about both keys and put the right one in use. One at a time. */
  function evaluate(trigger: string): Promise<void> {
    if (evaluating) return evaluating;
    evaluating = (async () => {
      // A key pasted or removed while the server was being asked: ask again
      // about the keys held NOW (a few times at most), never act on old answers.
      for (let attempt = 0; attempt < 3; attempt++) {
        const main = deps.getMainKey();
        const pack = deps.getPackKey();
        if (!pack || !main || deps.isPlaceholderKey?.(main)) {
          if (deps.getInUseUntil()) await backToMain(pack ? 'no plan key' : 'pack key removed');
          return;
        }
        const wasMarked = marked();
        // At startup the consumers took whatever key CredentialsManager gave
        // them, which is the plan's once the stored time has passed.
        const consumersOnPlan = !wasMarked || (trigger === 'startup' && !serving());
        const [packUsage, mainUsage] = await Promise.all([
          deps.fetchUsage(pack).catch((): KeyUsage | null => null),
          deps.fetchUsage(main).catch((): KeyUsage | null => null),
        ]);
        if (deps.getPackKey() !== pack || deps.getMainKey() !== main) continue;
        lastUsage = { pack, main, packUsage, mainUsage };
        const verdict = choosePackOrPlan({ mainUsage, packUsage, packInUse: wasMarked });
        const planEnded = keyRefused(mainUsage);
        // The plan ended while the pack was already in use: announce it, so Pro
        // moves to the pack key (ipcHandlers resyncNativelyKeyInUse).
        const planJustEnded = planEnded && !planWasEnded;
        if (planEnded || mainUsage?.ok) planWasEnded = planEnded;
        stoppedEarly = verdict === 'plan' && !packIsOver(packUsage);
        if (verdict === 'unknown') {
          // No definite answer: whatever is in use stays in use, and we ask again.
          if (wasMarked && untilMs() <= now() + RETRY_MS) {
            await usePack(now() + RETRY_MS, knownEnd, 'no answer from the server', 'kept', consumersOnPlan);
          }
          armIn(RETRY_MS);
          return;
        }
        if (verdict === 'plan') {
          if (wasMarked) {
            await backToMain(packIsOver(packUsage) ? 'pack time over' : 'pack used up what the plan still has');
          } else if (packIsOver(packUsage)) {
            // Over, until a new pack lands on this key: look rarely.
            arm(true);
          } else {
            arm();
          }
          return;
        }
        const endRaw = Date.parse((packUsage?.ok && packUsage.pack?.ends_at) || '');
        const end = Number.isFinite(endRaw) ? endRaw : null;
        // Past its use-by here but not ended by the server (this clock runs
        // ahead): ask again in a minute rather than holding it a day.
        const until = end == null ? now() + UNKNOWN_PACK_END_HOLD_MS : Math.max(end, now() + END_GRACE_MS);
        await usePack(
          until,
          end,
          planEnded && (!wasMarked || planJustEnded) ? `plan ended (${mainUsage?.error ?? 'refused'})` : wasMarked ? 'pack still has time' : `pack first (${trigger})`,
          planEnded ? 'plan_ended' : 'pack_first',
          consumersOnPlan || planJustEnded,
        );
        return;
      }
      log.warn('[PackFallback] the keys kept changing while the server was asked; looking again later');
      armIn(RETRY_MS);
    })().finally(() => { evaluating = null; });
    return evaluating;
  }

  /**
   * A plan-limit refusal reached the app: on the plan's key (the pack may take
   * over) or, while the pack is in use, on the pack's key (the plan may take
   * back). The server's numbers decide, not the refusal code. A trial is not a plan.
   */
  function onPlanLimit(limit: { code: string; onTrial: boolean }): Promise<void> {
    if (limit.onTrial || !deps.getPackKey()) return Promise.resolve();
    if (evaluating) return evaluating;
    if (now() - lastEventLookAt < EVENT_SPACING_MS) return Promise.resolve();
    lastEventLookAt = now();
    return evaluate(String(limit.code || 'plan limit'));
  }

  /**
   * Look again. `reason` 'pack_ended' comes from the pack clock: the key in use
   * was refused mid-meeting. On the pack that is its end; on the plan's key it
   * may be the plan ending, so both keys are asked.
   */
  async function check(reason: string): Promise<void> {
    if (reason === 'pack_ended' && marked()) return backToMain('pack ended');
    // A look already running may have compared the keys before this change
    // (a pasted pack, a saved plan key): look again once it is done.
    if (evaluating) return evaluating.then(() => evaluate(reason));
    return evaluate(reason);
  }

  return {
    onPlanLimit,
    check,
    state: () => state('read'),
    /**
     * The plan's key for company research when the pack in use has spent its
     * research runs and the plan has research left; null means the key in use.
     * From the latest look: a stale "has research" costs one refused search,
     * whose refusal asks again (nudgeNativelyPackFallback).
     */
    researchKey(): string | null {
      const main = deps.getMainKey();
      const pack = deps.getPackKey();
      if (!serving() || !main || !pack || !lastUsage) return null;
      if (lastUsage.main !== main || lastUsage.pack !== pack) return null;
      return researchGoesToPlan(lastUsage.packUsage, lastUsage.mainUsage) ? main : null;
    },
    /** Run once at startup: resume or end a pack in use, or put it in use for an ended plan. */
    start(): Promise<void> {
      return evaluate('startup');
    },
    /** Stop using the pack now (the pack key was removed or replaced). */
    stop(reason: string): Promise<void> {
      return deps.getInUseUntil() ? backToMain(reason) : Promise.resolve();
    },
    /** Where a pasted key goes (see decideKeySlot). Asks the server about every key involved. */
    async slotForSave(newKey: string): Promise<KeySlot> {
      const mainKey = deps.getMainKey();
      const packKey = deps.getPackKey();
      if (packKey && newKey === packKey) return 'same';
      if (!mainKey || mainKey === newKey || deps.isPlaceholderKey?.(mainKey)) return 'main';
      const [newUsage, mainUsage, packUsage] = await Promise.all([
        deps.fetchUsage(newKey).catch(() => null),
        deps.fetchUsage(mainKey).catch(() => null),
        packKey ? deps.fetchUsage(packKey).catch(() => null) : Promise.resolve(null),
      ]);
      return decideKeySlot({ newKey, mainKey, packKey, newUsage, mainUsage, packUsage });
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

/**
 * A Natively refusal outside the AI and voice paths (research search, knowledge
 * embedding or reranking): look at both keys now rather than at the next
 * 30-minute check. Not the shared plan-limit event: the trial end listens to
 * that, and these refusals can be plain rate limits. onPlanLimit is throttled
 * and decides from /v1/usage, so a rate limit only costs one look.
 */
export function nudgeNativelyPackFallback(code: string): void {
  try { void currentNativelyPackFallback()?.onPlanLimit({ code, onTrial: false }); } catch { /* not wired */ }
}
