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
 * Event-driven: no wall-clock timers for stage eligibility. The drain loop
 * runs on requestAnimationFrame and only evaluates when foreground +
 * homepage-mounted + not-in-meeting + no active toaster.
 */

import { loadState, saveState } from './persistence';

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
  private rafHandle: number | null = null;
  private running = false;
  private stageConfigs: StageConfig[] = [];

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
    this.scheduleTick();
  }

  stop(): void {
    this.running = false;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
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

  getSnapshot(): OrchestratorState {
    return this.state;
  }

  private notify(): void {
    this.listeners.forEach(l => l(this.state));
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

  // ─── Drain loop ───────────────────────────────────────────────

  private scheduleTick(): void {
    if (!this.running) return;
    this.rafHandle = requestAnimationFrame(() => {
      this.tick();
      this.scheduleTick();
    });
  }

  private tick(): void {
    if (!this.running) return;
    if (!this.shouldEvaluate()) return;
    this.evaluateAndDispatch();
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