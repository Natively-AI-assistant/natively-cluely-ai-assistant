// The clock a free trial is judged by.
//
// A trial's expiry is the server's time (started + 30 minutes), but it used to
// be compared with the computer's clock alone, so winding the clock back kept
// Pro on indefinitely (the AI stops anyway: the server refuses the token). Two
// fixes, both here:
//
//   1. The trial clock never runs backwards. It starts at the server's start
//      time, and each reading is the later of the computer's clock and the last
//      reading plus the time measured since by the monotonic clock
//      (performance.now(), which winding the clock does not move). The furthest
//      reading is saved, so a restart resumes from it. Wound back, a trial
//      still runs out after its 30 minutes of the app being open.
//   2. Once the trial is over by the server's word (/v1/trial/status
//      `expired`) or by this clock, it is marked ended and stays ended.
//
// What it costs an honest user: a computer clock that ran ahead during the
// trial ends it early by that much (it did before too). No process.platform:
// performance.now() is monotonic on macOS and Windows alike.

export const SAVE_EVERY_MS = 30_000;

export interface TrialClockStore {
  /** The current trial's start (changes when a new trial begins). */
  startedAt(): string | undefined;
  /** The furthest reading saved for this trial. */
  load(): number | undefined;
  save(ms: number): void;
}

export interface TrialClock {
  /** The trial's "now" in epoch ms. */
  now(): number;
  /** A time the server vouched for (epoch ms): the clock never reads earlier from here on. */
  observe(serverNowMs: number): void;
}

export function createTrialClock(
  store: TrialClockStore,
  opts: { wallNow?: () => number; monoNow?: () => number; saveEveryMs?: number } = {},
): TrialClock {
  const wallNow = opts.wallNow ?? Date.now;
  const monoNow = opts.monoNow ?? (() => performance.now());
  const saveEvery = opts.saveEveryMs ?? SAVE_EVERY_MS;

  let trial: string | undefined | null = null; // null: not read yet
  let last = 0;
  let lastMono = 0;
  let savedAt = -Infinity;

  const sync = (): void => {
    const started = store.startedAt();
    if (started === trial) return;
    trial = started;
    const stored = store.load();
    const startedMs = started ? Date.parse(started) : NaN;
    last = Math.max(stored ?? -Infinity, Number.isFinite(startedMs) ? startedMs : -Infinity);
    if (!Number.isFinite(last)) last = wallNow();
    lastMono = monoNow();
    savedAt = stored ?? -Infinity;
  };

  const advance = (floor: number): number => {
    sync();
    const mono = monoNow();
    const reading = Math.max(wallNow(), last + Math.max(0, mono - lastMono), floor);
    last = reading;
    lastMono = mono;
    if (reading - savedAt >= saveEvery) {
      savedAt = reading;
      try { store.save(reading); } catch { /* the next reading saves again */ }
    }
    return reading;
  };

  return {
    now: () => advance(-Infinity),
    observe: (serverNowMs) => {
      if (Number.isFinite(serverNowMs)) advance(serverNowMs);
    },
  };
}

/** Is this trial over? No trial counts as over. */
export function trialIsOver(t: { token?: string; expiresAt?: string; endedAt?: string }, nowMs: number): boolean {
  if (!t.token || !t.expiresAt) return true;
  if (t.endedAt) return true;
  const expires = Date.parse(t.expiresAt);
  if (!Number.isFinite(expires)) return true;
  return nowMs >= expires;
}

/**
 * The server's "now", from a /v1/trial/status answer: expires_at minus
 * remaining_ms, only while some time remains (at zero it says nothing about how
 * long ago the trial ended). undefined when the answer does not carry both.
 */
export function serverNowFromStatus(data: { expires_at?: unknown; remaining_ms?: unknown } | null | undefined): number | undefined {
  if (!data || typeof data.expires_at !== 'string' || typeof data.remaining_ms !== 'number') return undefined;
  const expires = Date.parse(data.expires_at);
  if (!Number.isFinite(expires) || !(data.remaining_ms > 0)) return undefined;
  return expires - data.remaining_ms;
}
