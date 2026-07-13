/**
 * OnboardingOrchestrator — central, sequential, single-slot toaster queue.
 *
 * Replaces the prior pattern of "every toaster self-schedules with setTimeout",
 * which caused 9 toasters/popovers to fire in the first ~20s on install.
 *
 * The orchestrator owns:
 *   - A queue of pending stages (declared by stageCatalog.ts)
 *   - Counters (startupCount, totalUsageMs, turnCount)
 *   - Homepage-mounted clock (homepageMountedAt, paused on backgrounding/meeting)
 *   - Per-toaster completion / skip log (completed, skipped)
 *   - Per-toaster cooldowns (lastShownTimes)
 *   - The currently-active toaster slot (activeToasterId — single-slot invariant)
 *
 * It does NOT own:
 *   - The toaster components themselves (they live in stageCatalog.ts)
 *   - The user-state patch (premium/profile/etc.) — pushed in via emit()
 *   - The renderer — that lives in OrchestratedToasterHost.tsx
 *
 * Event-driven: events re-evaluate state changes, while a one-shot deadline
 * timer handles only the next known time-gated eligibility transition. It never
 * polls while waiting for a user or IPC event.
 */

// Explicit `.ts` extension — this directory also has a `.mjs` companion
// (persistence.mjs) so `node --test` can exercise the pure logic without a
// TS loader. Vite's default resolver tries `.mjs` before `.ts` on an
// unqualified specifier (see orchestrator.mjs's own note on this), so an
// unqualified import here would silently pull in the .mjs twin instead.
// Functionally equivalent today, but do not remove the extension — it is
// the only thing preventing a repeat of the orchestrator.mjs shadowing bug.
import { loadState, saveState } from './persistence.ts';

// ─── Types ────────────────────────────────────────────────────────

export type ToasterId =
  | 'permissions'
  | 'browser_extension'
  | 'profile_intelligence'
  | 'modes_manager'
  | 'trial_promo'
  | 'quiet_window'
  | 'support'
  | 'ads'
  | 'review_prompt';

export interface OrchestratorState {
  version: string;
  startupCount: number;
  totalUsageMs: number;
  turnCount: number;
  homepageMountedAt: number | null;
  /**
   * Captured performance.now() at the moment the app was last backgrounded
   * while the homepage was mounted. Used to freeze the homepage mount clock
   * across backgrounding — without this, `homepageMountedFor` keeps growing
   * while the user is away.
   */
  homepageFrozenAt: number | null;
  homepageCurrentlyMounted: boolean;
  appInForeground: boolean;
  meetingActive: boolean;
  queue: ToasterId[];
  completed: Record<string, number>;
  skipped: Set<string>;
  activeToasterId: ToasterId | null;
  lastShownTimes: Record<string, number>;
  /**
   * Internal revision counter that increments on every `notify()` so
   * `useSyncExternalStore` consumers detect a change. Not persisted.
   */
  __rev?: number;
}

export interface UserState {
  isPremium: boolean;
  hasProfile: boolean;
  hasNativelyKey: boolean;
  hasTrialToken: boolean;
  extensionConnected: boolean;
  extensionSupported: boolean;
  permsShown: boolean;
  macTCCBlocked: boolean;
  seenProfileOnboarding: boolean;
  seenModesOnboarding: boolean;
  activeModeSet: boolean;
  donationShouldShow: boolean;
  isV2_8_OrNewer: boolean;
}

export interface Triggers {
  requiresHomepageMounted?: boolean;
  requiresHomepageDuration?: number;     // ms
  requiresStartupCount?: number;
  requiresTurnCount?: number;
  requiresTotalUsageMs?: number;
  requiresForeground?: boolean;
  requiresMeetingInactive?: boolean;
}

export interface StageConfig {
  id: ToasterId;
  order: number;                          // queue position
  triggers: Triggers;
  skipWhen?: (s: UserState) => boolean;
  onceEver?: boolean;
  cooldownMs?: (s: UserState) => number;
  reEligibility?: (s: UserState, completed: Record<string, number>) => boolean;
  customPredicate?: (ctx: Ctx) => boolean;
  /** Other stages that must be completed OR skipped before this can fire. */
  requiresStages?: ToasterId[];
  /**
   * If true, this stage never renders a UI component — when dispatched, it is
   * immediately auto-completed (treated as `markSkipped`). Used for purely
   * gating stages (quiet_window) and "marker" stages where the actual UI is
   * triggered by separate user actions (profile_intelligence, modes_manager).
   */
  isGateOnly?: boolean;
}

export interface Ctx {
  startupCount: number;
  totalUsageMs: number;
  turnCount: number;
  homepageMountedFor: number;             // ms, 0 if not mounted
  appInForeground: boolean;
  homepageCurrentlyMounted: boolean;
  meetingActive: boolean;
  userState: UserState;
  completed: Record<string, number>;
  skipped: ReadonlySet<string>;
  lastShownTimes: Record<string, number>;
  now: number;
}

export type OrchestratorEvent =
  | { type: 'launcher:mounted' }
  | { type: 'launcher:unmounted' }
  | { type: 'startup:complete' }
  | { type: 'turn:done'; surface?: 'chat' | 'meeting' | 'ask-ai' }
  | { type: 'usage:tick'; deltaMs: number }
  | { type: 'foreground:change'; isForeground: boolean }
  | { type: 'meeting:state'; isActive: boolean }
  | { type: 'user-state:change'; patch: Partial<UserState> }
  | { type: 'queue:set'; queue: ToasterId[] };

type Listener = (state: OrchestratorState) => void;

// ─── UserState default ────────────────────────────────────────────

export const DEFAULT_USER_STATE: UserState = {
  isPremium: false,
  hasProfile: false,
  hasNativelyKey: false,
  hasTrialToken: false,
  extensionConnected: false,
  extensionSupported: true,
  permsShown: false,
  macTCCBlocked: false,
  seenProfileOnboarding: false,
  seenModesOnboarding: false,
  activeModeSet: false,
  donationShouldShow: false,
  isV2_8_OrNewer: true,
};

// ─── Orchestrator ─────────────────────────────────────────────────

export class OnboardingOrchestrator {
  private state: OrchestratorState;
  private userState: UserState = DEFAULT_USER_STATE;
  private listeners = new Set<Listener>();
  // A single one-shot deadline timer. Never use it as a recurring poll: doing
  // so needlessly wakes the renderer and can retain compositor work under
  // Windows software compositing.
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stageConfigs: StageConfig[] = [];
  // Bumped on every notify() so useSyncExternalStore consumers see a new
  // snapshot reference and re-render. Persisted `state.version` (string) is
  // unrelated.
  private revision = 0;
  // Toasters the user explicitly dismissed THIS session. Not persisted — a
  // genuinely-blocked permission (macTCCBlocked) is still re-raised on the next
  // launch. This exists so an explicit dismiss (the X button) is not undone on
  // the very next RAF frame by a still-true reEligibility predicate, which is
  // what made the X appear to do nothing for a re-eligible stage.
  private dismissedThisSession = new Set<ToasterId>();

  constructor() {
    this.state = loadState();
  }

  // ─── Lifecycle ────────────────────────────────────────────────

  start(stageConfigs: StageConfig[]): void {
    if (this.running) return;
    this.running = true;

    // Sort configs by `order` and seed the queue
    this.stageConfigs = [...stageConfigs].sort((a, b) => a.order - b.order);

    // Build queue if not already populated (e.g. cold launch with no legacy state)
    if (this.state.queue.length === 0) {
      this.state.queue = this.stageConfigs.map(c => c.id);
    }

    // Bump startup count on first start per session
    if (!this._sessionStartTracked) {
      this._sessionStartTracked = true;
      this.emit({ type: 'startup:complete' });
    }

    this.persist();
    this.ensureDraining();
  }

  stop(): void {
    this.running = false;
    if (this.tickTimer !== null) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private _sessionStartTracked = false;

  // ─── Pub/sub ──────────────────────────────────────────────────

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    // Push current state synchronously
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  // CRITICAL FIX (audit round 2): cache the snapshot object so React's
  // `useSyncExternalStore` sees a referentially-stable value when nothing has
  // changed. Without caching, every internal `getSnapshot()` call returned a
  // fresh object, React's `Object.is` check saw a "change" on every poll, and
  // the host re-rendered forever — causing "Maximum update depth exceeded".
  // The bug lived in the orchestrator's own .mjs shim's comment history
  // (cf6a2f9) and was reintroduced by the round-1 revision-counter fix.
  // Cache key: revision counter (monotonically incremented by notify()).
  private cachedSnapshot: OrchestratorState | null = null
  private cachedRevision = -1

  getSnapshot(): OrchestratorState {
    if (this.cachedRevision !== this.revision || !this.cachedSnapshot) {
      this.cachedSnapshot = { ...this.state, __rev: this.revision }
      this.cachedRevision = this.revision
    }
    return this.cachedSnapshot
  }

  private notify(): void {
    this.revision++;
    this.listeners.forEach(l => l(this.state))
    // A state change can remove a prerequisite or move the earliest deadline
    // sooner. Replace (rather than retain) a stale future deadline so skips and
    // newly-eligible stages are dispatched promptly; waiting for another event
    // still leaves no timer.
    if (this.tickTimer !== null) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    this.ensureDraining();
  }

  // ─── Event bus ────────────────────────────────────────────────

  emit(event: OrchestratorEvent): void {
    switch (event.type) {
      case 'launcher:mounted':
        if (!this.state.homepageCurrentlyMounted) {
          this.state.homepageCurrentlyMounted = true;
          this.state.homepageMountedAt = performance.now();
          this.state.homepageFrozenAt = null;
          // Note: NOT persisted. homepageMountedAt uses performance.now()
          // which is per-process; persisting it across launches produces a
          // stale negative diff and breaks every duration trigger.
        }
        break;

      case 'launcher:unmounted':
        if (this.state.homepageCurrentlyMounted) {
          this.state.homepageCurrentlyMounted = false;
          this.state.homepageMountedAt = null;
          this.state.homepageFrozenAt = null;
          // Same: not persisted.
        }
        break;

      case 'startup:complete':
        this.state.startupCount += 1;
        this.persist();
        break;

      case 'turn:done':
        this.state.turnCount += 1;
        this.persist();
        break;

      case 'usage:tick':
        this.state.totalUsageMs += event.deltaMs;
        this.persist();
        break;

      case 'foreground:change':
        this.state.appInForeground = event.isForeground;
        if (!event.isForeground && this.state.homepageCurrentlyMounted && this.state.homepageMountedAt != null) {
          // Backgrounding while homepage mounted — freeze the clock.
          // Capture the elapsed time as of freeze; reset mountedAt so buildCtx
          // returns 0. On resume, restore mountedAt to (now - frozenElapsed).
          const elapsed = performance.now() - this.state.homepageMountedAt;
          this.state.homepageFrozenAt = elapsed;
          this.state.homepageMountedAt = null;
        } else if (event.isForeground && this.state.homepageFrozenAt != null) {
          // Resume — restore the clock. BuildCtx computes `now - mountedAt`,
          // so we set mountedAt to (now - frozenAt) to preserve elapsed time.
          this.state.homepageMountedAt = performance.now() - this.state.homepageFrozenAt;
          this.state.homepageFrozenAt = null;
        }
        this.notify();
        break;

      case 'meeting:state':
        this.state.meetingActive = event.isActive;
        this.persist();
        break;

      case 'user-state:change':
        this.userState = { ...this.userState, ...event.patch };
        break;

      case 'queue:set':
        if (this.state.activeToasterId) {
          // Cannot mutate queue while a toaster is visible — caller must
          // dismiss first. Silently ignore.
          return;
        }
        this.state.queue = event.queue.filter(
          id => !this.stageConfigs.some(c => c.id === id),
        ).concat(event.queue);
        this.persist();
        break;
    }
    this.notify();
  }

  // ─── Deadline scheduler ───────────────────────────────────────
  //
  // NATIVE-LEAK FIX (2026-07-10, refined 2026-07-13): this originally used a
  // self-perpetuating requestAnimationFrame loop (scheduleTick → rAF → tick →
  // scheduleTick) that rescheduled EVERY FRAME (~60fps) for the entire
  // lifetime of the launcher window, regardless of whether there was any
  // pending onboarding work. A never-idling rAF keeps Chromium's compositor
  // permanently in the "BeginFrame pending" state, so it produces a real
  // frame every vsync and never enters the idle path that reclaims raster
  // tiles. Combined with the launcher's `repeat: Infinity` toaster
  // animations, under SOFTWARE compositing (Windows 10, macOS-27
  // GPU-fallback) that drove unbounded PartitionAlloc raster-tile churn — a
  // native (non-V8) memory leak that grew RSS to multiple GB with a flat JS
  // heap and OOM-froze the app / crashed the renderer in fontations_ffi.
  // Confirmed by per-day git bisect: introduced by the orchestrator
  // (cf6a2f9, 2026-07-04), absent at 8836b40 (2026-07-03).
  //
  // Replacing rAF with a one-second recursive setTimeout was still
  // insufficient: a pending stage kept the launcher waking forever even
  // while no state could change. A copied real-profile dev run reproduced
  // the same ~70 MB/s native renderer growth with every modal hidden, while
  // disabling only orch.start() remained flat.
  //
  // Schedule only the next *known time deadline*. All non-time eligibility
  // inputs (foreground, homepage mount, user-state, turns, usage, dependencies
  // and custom predicates) arrive through emit()/setUserState(), whose notify()
  // call re-arms this scheduler. Once a toaster is active there is deliberately
  // no timer: its dismiss/skip event is the next meaningful state transition.
  private static readonly MAX_TIMEOUT_MS = 2_147_483_647;

  /** Lazily schedule the next eligibility deadline, if one is knowable. */
  private ensureDraining(): void {
    if (!this.running || this.tickTimer !== null) return;
    const delayMs = this.nextEvaluationDelayMs();
    if (delayMs === null) return;
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null;
      this.tick();
    }, Math.min(delayMs, OnboardingOrchestrator.MAX_TIMEOUT_MS));
  }

  private tick(): void {
    if (!this.running || !this.shouldEvaluate()) return;
    this.evaluateAndDispatch();
    // evaluateAndDispatch may have skipped gate stages or found a later
    // time-gated stage. Recompute once; never turn this into a polling loop.
    this.ensureDraining();
  }

  /**
   * Return milliseconds until the earliest stage whose only unmet condition is
   * a clock-based trigger, or 0 when a stage can be evaluated immediately.
   * Return null when a user/event transition is required instead of polling.
   */
  private nextEvaluationDelayMs(): number | null {
    if (!this.shouldEvaluate()) return null;

    const ctx = this.buildCtx();
    let nextDelay: number | null = null;
    const consider = (delay: number) => {
      const bounded = Math.max(0, Math.ceil(delay));
      nextDelay = nextDelay === null ? bounded : Math.min(nextDelay, bounded);
    };

    for (const id of this.state.queue) {
      const config = this.stageConfigs.find(c => c.id === id);
      if (!config || this.state.skipped.has(id) || this.dismissedThisSession.has(id)) continue;

      // A hard skip is progress that evaluateAndDispatch can make immediately.
      if (config.skipWhen?.(ctx.userState)) {
        consider(0);
        continue;
      }

      // Match shouldShowToaster(): completion only suppresses once-ever stages.
      // Cooldown/re-eligibility stages must still contribute their next deadline
      // or they can become eligible after an otherwise idle session with no timer
      // left to dispatch them.
      if (config.onceEver && ctx.completed[id] && !config.reEligibility?.(ctx.userState, ctx.completed)) continue;
      if (config.requiresStages?.some(dep => !ctx.completed[dep] && !ctx.skipped.has(dep))) continue;

      const triggers = config.triggers;
      // These values cannot become true merely by waiting, so wait for their
      // event instead of keeping the renderer on a timer.
      if (
        (triggers.requiresStartupCount != null && ctx.startupCount < triggers.requiresStartupCount) ||
        (triggers.requiresTurnCount != null && ctx.turnCount < triggers.requiresTurnCount) ||
        (triggers.requiresTotalUsageMs != null && ctx.totalUsageMs < triggers.requiresTotalUsageMs) ||
        (config.customPredicate && !config.customPredicate(ctx))
      ) continue;

      let delay = 0;
      if (triggers.requiresHomepageDuration != null) {
        delay = Math.max(delay, triggers.requiresHomepageDuration - ctx.homepageMountedFor);
      }
      const cooldownMs = config.cooldownMs?.(ctx.userState) ?? 0;
      if (cooldownMs > 0) {
        delay = Math.max(delay, cooldownMs - (ctx.now - (ctx.lastShownTimes[id] ?? 0)));
      }
      consider(delay);
    }

    return nextDelay;
  }

  private shouldEvaluate(): boolean {
    return (
      this.state.appInForeground &&
      this.state.homepageCurrentlyMounted &&
      !this.state.meetingActive &&
      this.state.activeToasterId === null
    );
  }

  private evaluateAndDispatch(): void {
    const ctx = this.buildCtx();
    let progressMade = false;
    do {
      progressMade = false;
      for (const id of this.state.queue) {
        const config = this.stageConfigs.find(c => c.id === id);
        if (!config) continue;

        // Auto-skip: if skipWhen returns true, mark the stage as skipped so
        // downstream requiresStages are unblocked.
        if (config.skipWhen?.(ctx.userState) && !this.state.skipped.has(id)) {
          this.state.skipped.add(id);
          this.persist();
          progressMade = true;
          continue;
        }

        if (this.shouldShowToaster(id, ctx, config)) {
          // Gate-only stages auto-complete when they would dispatch. They
          // never render UI; their only purpose is to gate downstream stages.
          if (config.isGateOnly) {
            this.completeToaster(id, false);
            progressMade = true;
            continue;
          }
          this.state.activeToasterId = id;
          this.state.lastShownTimes[id] = ctx.now;
          this.persist();
          this.notify();
          return; // single-slot invariant
        }
      }
    } while (progressMade && !this.state.activeToasterId);
  }

  // ─── Decision engine ──────────────────────────────────────────

  shouldShowToaster(id: ToasterId, ctx: Ctx, config: StageConfig): boolean {
    // 0. Explicitly dismissed this session — never re-raise until next launch.
    if (this.dismissedThisSession.has(id)) return false;

    // 1. Hard skip — user-state
    if (config.skipWhen?.(ctx.userState)) return false;

    // 2. Already done forever (onceEver + completed and not re-eligible)
    if (config.onceEver && ctx.completed[id] && !config.reEligibility?.(ctx.userState, ctx.completed)) {
      return false;
    }

    // 3. Cooldown
    const lastShown = ctx.lastShownTimes[id] ?? 0;
    const cooldownMs = config.cooldownMs ? config.cooldownMs(ctx.userState) : 0;
    if (cooldownMs > 0 && ctx.now - lastShown < cooldownMs) return false;

    // 4. Prerequisites — every required stage must be completed OR skipped
    if (config.requiresStages?.some(dep => !ctx.completed[dep] && !ctx.skipped.has(dep))) {
      return false;
    }

    // 5. Soft triggers — ALL must be satisfied
    const t = config.triggers;
    if (t.requiresHomepageMounted && !ctx.homepageCurrentlyMounted) return false;
    if (t.requiresHomepageDuration != null && ctx.homepageMountedFor < t.requiresHomepageDuration) return false;
    if (t.requiresStartupCount != null && ctx.startupCount < t.requiresStartupCount) return false;
    if (t.requiresTurnCount != null && ctx.turnCount < t.requiresTurnCount) return false;
    if (t.requiresTotalUsageMs != null && ctx.totalUsageMs < t.requiresTotalUsageMs) return false;
    if (t.requiresForeground && !ctx.appInForeground) return false;
    if (t.requiresMeetingInactive && ctx.meetingActive) return false;

    // 6. Custom predicate (e.g. DonationManager fetch outcome)
    if (config.customPredicate && !config.customPredicate(ctx)) return false;

    return true;
  }

  // ─── Toaster dismissal / skip ─────────────────────────────────

  markDismissed(id: ToasterId): void {
    // Record the explicit dismiss for this session so the drain loop does not
    // instantly re-raise a re-eligible stage (e.g. permissions while
    // macTCCBlocked is genuinely true) on the next animation frame.
    this.dismissedThisSession.add(id);
    this.completeToaster(id, false);
  }

  markSkipped(id: ToasterId): void {
    this.completeToaster(id, true);
  }

  private completeToaster(id: ToasterId, explicitSkip: boolean): void {
    // Gate-only stages can be "completed" without being the active toaster
    // (they're auto-completed inside evaluateAndDispatch).
    if (this.state.activeToasterId !== id && this.state.activeToasterId !== null) return;
    const ts = Date.now();
    this.state.completed[id] = ts;
    if (explicitSkip) this.state.skipped.add(id);
    this.state.activeToasterId = null;

    // Insert quiet_window after trial_promo (the 5th stage) to gate marketing.
    // Capture the current turnCount as the baseline so the predicate
    // resolves on the next 3 user turns.
    if (id === 'trial_promo') {
      this.state.completed['_turnCountAtQuietStart'] = this.state.turnCount;
      this.insertAfterCurrent('quiet_window');
    }
    this.persist();
    this.notify();
  }

  /** Inserts a stage ID at the position of the current active toaster + 1. */
  private insertAfterCurrent(id: ToasterId): void {
    // Remove any prior quiet_window instance (idempotency)
    this.state.queue = this.state.queue.filter(q => q !== id);
    // Insert after the most recently dismissed toaster, i.e. at the head
    // of the remaining queue (since the dismissed one is the activeToasterId
    // and is not in the queue — only pending stages are).
    const insertAt = this.state.queue.findIndex(q => !this.state.completed[q] && !this.state.skipped.has(q));
    if (insertAt === -1) {
      this.state.queue.push(id);
    } else {
      this.state.queue.splice(insertAt, 0, id);
    }
  }

  // ─── User state injection ─────────────────────────────────────

  setUserState(patch: Partial<UserState>): void {
    this.userState = { ...this.userState, ...patch };
    this.notify();
  }

  getUserState(): UserState {
    return this.userState;
  }

  // ─── Internals ────────────────────────────────────────────────

  private buildCtx(): Ctx {
    const homepageMountedFor =
      this.state.homepageCurrentlyMounted && this.state.homepageMountedAt != null
        ? performance.now() - this.state.homepageMountedAt
        : 0;
    return {
      startupCount: this.state.startupCount,
      totalUsageMs: this.state.totalUsageMs,
      turnCount: this.state.turnCount,
      homepageMountedFor,
      appInForeground: this.state.appInForeground,
      homepageCurrentlyMounted: this.state.homepageCurrentlyMounted,
      meetingActive: this.state.meetingActive,
      userState: this.userState,
      completed: this.state.completed,
      skipped: this.state.skipped,
      lastShownTimes: this.state.lastShownTimes,
      now: Date.now(),
    };
  }

  private persist(): void {
    saveState(this.state);
  }

  // ─── Test hooks ───────────────────────────────────────────────

  _setStateForTests(state: OrchestratorState): void {
    this.state = state;
  }

  _getState(): OrchestratorState {
    return this.state;
  }
}

// ─── Singleton accessor ───────────────────────────────────────────

let singleton: OnboardingOrchestrator | null = null;

export function getOrchestrator(): OnboardingOrchestrator {
  if (!singleton) singleton = new OnboardingOrchestrator();
  return singleton;
}

export function resetOrchestratorForTests(): void {
  singleton = null;
}