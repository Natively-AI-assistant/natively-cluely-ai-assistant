// The Natively API refused a request for its plan allowance (2026-11-03).
//
// LLMHelper hears the refusal; the trial lives in ipcHandlers.ts. A free
// trial's AI allowance running out ends the trial there and then (see
// src/lib/trial/trialAllowance.mjs), so the refusal has to reach it. A module
// bus rather than a callback on the helper: it does not care which LLMHelper
// instance made the request, or whether one existed when ipcHandlers started.
import { EventEmitter } from 'node:events';

export interface NativelyPlanLimit {
  /** The refusal's code from the 429 body, e.g. `ai_quota_exceeded`. */
  code: string;
  /** The request went out on the free trial, not on a paid key. */
  onTrial: boolean;
}

// One bus per process, not per bundle: the build makes every .ts file its own
// esbuild bundle with its imports inlined, so a plain module-level emitter
// would be copied into each bundle that imports this file, and the side that
// emits could miss the side that listens.
const BUS_KEY = Symbol.for('natively.nativelyPlanLimitEvents');
const holder = globalThis as unknown as { [BUS_KEY]?: EventEmitter };
const bus: EventEmitter = holder[BUS_KEY] ?? (holder[BUS_KEY] = new EventEmitter());
bus.setMaxListeners(4);

export function onNativelyPlanLimit(listener: (limit: NativelyPlanLimit) => void): () => void {
  bus.on('limit', listener);
  return () => { bus.off('limit', listener); };
}

/** Never throws: a listener's failure must not change how the request fails. */
export function emitNativelyPlanLimit(limit: NativelyPlanLimit): void {
  for (const listener of bus.listeners('limit')) {
    try {
      (listener as (l: NativelyPlanLimit) => void)(limit);
    } catch (e: any) {
      console.warn('[NativelyAPI] plan-limit listener failed:', e?.message || e);
    }
  }
}

/**
 * The error an answer fails with once the Natively API is refusing for a
 * limit, in place of "No AI provider configured. Please add at least one API
 * key in Settings.", which is what the request fell through to and which the
 * overlay and the funnel read as a rejected key (src/lib/chatFailure.mjs).
 *
 * The wording is for that classifier, not for people: "trial ended" is
 * TRIAL_ENDED and the snake_case code is PLAN_LIMIT, each with its own
 * translated sentence in the overlay. Kept here, not in src/lib: LLMHelper is
 * also compiled alone by plain tsc in tests, which carries no .mjs files.
 */
export function nativelyLimitErrorMessage(limit: Partial<NativelyPlanLimit> | null | undefined): string {
  const code = typeof limit?.code === 'string' && /^[a-z_]{1,64}$/.test(limit.code) ? limit.code : 'ai_quota_exceeded';
  return limit?.onTrial === true
    ? `Natively API: trial ended, its AI allowance is used (${code})`
    : `Natively API HTTP 429: ${code} (plan allowance exhausted)`;
}
