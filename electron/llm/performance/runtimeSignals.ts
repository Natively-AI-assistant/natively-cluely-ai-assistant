// electron/llm/performance/runtimeSignals.ts
//
// The environmental facts a latency sample needs in order to be classified.
//
// Phase 10 asks for sample classes like LAPTOP_RESUMED and NETWORK_SWITCH. Those
// are not derivable from the stream itself — a turn that took 40s because the
// lid was shut looks identical, from inside the driver, to a provider that hung.
// The difference is only knowable from outside, which is what this module
// carries.
//
// CROSS-PLATFORM (CLAUDE.md). `powerMonitor`'s 'suspend'/'resume' events exist
// on both macOS and Windows and main.ts already subscribes to them for capture
// recovery. This module does NOT subscribe a second time — a second listener on
// the same events is how two subsystems come to disagree about whether a resume
// happened. main.ts pokes `noteSystemResumed()` from the handler it already
// has, so there is one subscription and one truth. Windows additionally fires
// 'resume' on some dock/undock transitions where macOS does not; that only ever
// causes a sample to be classified as `app_resumed` and excluded from latency,
// which is the conservative direction.
//
// Nothing here is persisted and nothing is transmitted: these are per-process
// facts about the last few seconds.

import { currentNetworkProfile, type NetworkProfile, OFFLINE_NETWORK_PROFILE } from './networkProfile';

/**
 * How long after a resume a sample is still considered contaminated.
 *
 * A machine coming back from sleep re-associates its Wi-Fi, re-opens TLS
 * sessions and re-warms DNS. 20s is generous enough to cover that on a slow
 * network and short enough that it does not swallow a normal working session.
 */
export const RESUME_QUARANTINE_MS = 20_000;

/**
 * How long a network profile is cached before being recomputed.
 *
 * `os.networkInterfaces()` is a syscall; doing it per turn is wasteful and doing
 * it never means a hotspot switch is invisible. 10s is well under the length of
 * a working session on one network and well over the rate turns arrive at.
 */
export const NETWORK_CACHE_MS = 10_000;

export class RuntimeSignals {
  private lastResumeAt = 0;
  private cachedNetwork: NetworkProfile = OFFLINE_NETWORK_PROFILE;
  /**
   * `null` means NEVER READ, which is not the same as "read at time 0".
   *
   * A numeric sentinel of 0 conflates the two, and the difference is real: with
   * `cachedNetworkAt = 0` the very first `network()` call returns the OFFLINE
   * placeholder whenever `now()` is under NETWORK_CACHE_MS, so every sample in
   * that window is filed against the id 'offline' instead of the real network.
   * Production's `Date.now()` is far past that, which is exactly what makes the
   * bug invisible there and reproducible under an injected clock.
   */
  private cachedNetworkAt: number | null = null;
  private lastSeenNetworkId: string | null = null;
  private networkChangedAt = 0;
  private readonly now: () => number;
  private readonly read: () => NetworkProfile;

  constructor(opts: { now?: () => number; readNetwork?: () => NetworkProfile } = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.read = opts.readNetwork ?? currentNetworkProfile;
  }

  /** Called from main.ts's EXISTING powerMonitor 'resume' handler. */
  noteSystemResumed(): void {
    this.lastResumeAt = this.now();
    // Force a network recompute on the next read: the interface that comes back
    // after a resume is frequently not the one that went away.
    this.cachedNetworkAt = null;
  }

  /** The current network profile, cached. */
  network(): NetworkProfile {
    const t = this.now();
    if (this.cachedNetworkAt !== null && t - this.cachedNetworkAt < NETWORK_CACHE_MS) {
      return this.cachedNetwork;
    }
    this.cachedNetworkAt = t;
    this.cachedNetwork = this.read();
    if (this.lastSeenNetworkId !== null && this.lastSeenNetworkId !== this.cachedNetwork.id) {
      this.networkChangedAt = t;
    }
    this.lastSeenNetworkId = this.cachedNetwork.id;
    return this.cachedNetwork;
  }

  /**
   * Did the environment change during a turn that started at `startedAt`?
   *
   * Both windows are checked against the turn's START, not against `now`: a
   * resume that happened 5s into a 30s turn contaminated that turn even if it is
   * now 25s in the past.
   */
  contaminatedSince(startedAt: number): 'app_resumed' | 'network_switch' | null {
    if (this.lastResumeAt > 0 && this.now() - this.lastResumeAt < RESUME_QUARANTINE_MS) return 'app_resumed';
    if (this.lastResumeAt > 0 && this.lastResumeAt >= startedAt) return 'app_resumed';
    if (this.networkChangedAt >= startedAt) return 'network_switch';
    return null;
  }
}

const GLOBAL_KEY = '__nativelyRuntimeSignals__';

export function getRuntimeSignals(): RuntimeSignals {
  const g = globalThis as Record<string, unknown>;
  const existing = g[GLOBAL_KEY] as RuntimeSignals | undefined;
  if (existing) return existing;
  const signals = new RuntimeSignals();
  g[GLOBAL_KEY] = signals;
  return signals;
}

/** Test hook. */
export function __setRuntimeSignals(signals: RuntimeSignals | null): void {
  const g = globalThis as Record<string, unknown>;
  if (signals) g[GLOBAL_KEY] = signals; else delete g[GLOBAL_KEY];
}
