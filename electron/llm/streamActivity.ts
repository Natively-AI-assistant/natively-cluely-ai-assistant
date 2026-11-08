// electron/llm/streamActivity.ts
//
// Transport activity for the stream the live stall guard is driving (#680).
//
// WHY. The Codex backend can stop sending answer text partway through an
// answer, keep the connection alive with `:` keepalive comments, and deliver
// the rest in one burst when generation ends (traced 2026-10-25: holds of
// 4.2-8.2 s on gpt-6-luna, 17.5 s once on gpt-6.1-sol, inside the code block
// in every run that recorded where). The stall guard only sees answer text, so it read a live request as
// a dead one and cut the answer off. No reasoning or progress event arrives
// during a hold; the bytes are the only signal there is.
//
// WHY A SCOPE AND NOT A PARAMETER OR A SIGNAL KEY. raceStreamWithDeadline runs
// each iterator.next() inside withStreamActivity(), so a transport reporting
// from anywhere under that pull (any number of generator layers down) reports
// to that stream and no other. Keying by AbortSignal would miss the paths that
// hand the provider a derived signal (Fast Response picks and the vision
// chain use AbortSignal.any / per-attempt controllers), and threading a
// callback would change a dozen LLMHelper signatures. A stream pulled from
// outside raceStreamWithDeadline has no scope, and its notes are dropped: it
// keeps the plain stall budget, which is the behaviour before this existed.
//
// Kept in a globalThis slot because each esbuild entry point bundles its own
// copy of this module (premium, the test builds); every copy must share one
// scope or a transport would report into a store the guard never reads.

import { AsyncLocalStorage } from 'node:async_hooks';

export interface StreamActivity {
  /** Date.now() of the last bytes the transport received. Null until any. */
  lastAt: number | null;
}

const SLOT = Symbol.for('natively.streamActivity.v1');
const scope: AsyncLocalStorage<StreamActivity> =
  (globalThis as any)[SLOT] ?? ((globalThis as any)[SLOT] = new AsyncLocalStorage<StreamActivity>());

/** Run `pull` (one iterator.next()) with `activity` as the place transports report to. */
export function withStreamActivity<T>(activity: StreamActivity, pull: () => T): T {
  return scope.run(activity, pull);
}

/**
 * Record that the transport behind the current stream received bytes.
 * A no-op outside withStreamActivity. Content-free: a timestamp only.
 */
export function noteStreamActivity(now: number = Date.now()): void {
  const activity = scope.getStore();
  if (activity) activity.lastAt = now;
}
