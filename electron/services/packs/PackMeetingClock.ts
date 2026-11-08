/**
 * The Pro pack meeting clock: reports live meeting time to natively-api so a
 * Pro pack ends when its hours are used.
 *
 * WHY (2026-11-06, Evin). A Pro pack (Light $5 = 2 h within 7 days, Heavy $10
 * = 5 h within 14 days) is sold as MEETING hours, and it unlocks Pro as well
 * as the API. Its hours must run out whatever transcribes the meeting:
 * Natively's speech-to-text or the customer's own keys. A meter fed only by
 * our own transcription minutes would never end for someone on their own keys,
 * and $5 would be a cheap Pro licence.
 *
 * HOW. While a meeting is live and a Natively API key is saved, the clock
 * ticks once a minute and POSTs the seconds since the last tick to
 * /v1/pack/meeting-tick as { meeting_id, seq, seconds }. The server debits
 * each (key, meeting_id, seq) once, so a tick re-sent after a lost response is
 * safe; it clamps a tick to 90 s. A key that is not a pack answers
 * { metered: false } and the clock stops for that meeting, so a monthly or
 * yearly key costs one request per meeting.
 *
 * SLEEP. Time the machine spends asleep is not meeting time. The owner calls
 * suspend() / resume() from Electron's powerMonitor (both macOS and Windows
 * emit them), and no single tick may claim more than MAX_GAP_MS, so a missed
 * suspend event, a timer that fired late or a main thread that hung cannot
 * bill more than a little over one minute. This matters because the two
 * platforms' monotonic clocks disagree about sleep: on macOS
 * mach_absolute_time stops while asleep, on Windows QueryPerformanceCounter
 * keeps counting. The cap makes the result the same on both.
 *
 * PURE ON PURPOSE. No Electron, no network, no process.platform: every effect
 * is injected, so the behaviour is identical on macOS and Windows by
 * construction and the tests exercise all of it on either.
 *
 * Type-erasable TypeScript only (no enums, no parameter properties): the test
 * imports this source file directly, with no build step.
 */

/** How often a live meeting reports. The server allows 90 s per tick. */
export const TICK_INTERVAL_MS = 60_000;
/** The most wall time one tick may claim. A longer gap is time nobody saw pass. */
export const MAX_GAP_MS = 75_000;
/** Ticks kept for re-sending through an outage (~10 h of meetings). Oldest go first. */
export const MAX_PENDING = 600;

export interface TickBody {
  meeting_id: string;
  seq: number;
  seconds: number;
}

export interface TickAnswer {
  status: number;
  body: any;
}

export interface PackEndedInfo {
  /** 'hours_used' | 'window_closed' | undefined when the server did not say. */
  reason?: string;
}

export interface PackMeetingClockDeps {
  /** The saved Natively API key, or null/undefined (none, or a trial sentinel). */
  getApiKey(): string | null | undefined;
  /** POST the tick. Throws on a network error. */
  postTick(key: string, body: TickBody): Promise<TickAnswer>;
  /** Milliseconds. Monotonic preferred; the gap cap covers either kind. */
  now(): number;
  /** Repeats fn every ms. Returns a cancel function. */
  every(fn: () => void, ms: number): () => void;
  /** A fresh id, [A-Za-z0-9_-], 8 to 72 characters. */
  newMeetingId(): string;
  /** The pack has ended (hours used or window closed). Re-check Pro. */
  onPackEnded(info: PackEndedInfo): void;
  /** Latest pack view the server sent with a counted tick. */
  onPackState?(pack: any): void;
  log?: { log(...a: unknown[]): void; warn(...a: unknown[]): void };
}

interface PendingTick {
  key: string;
  body: TickBody;
}

export function createPackMeetingClock(deps: PackMeetingClockDeps) {
  const log = deps.log ?? console;

  // The live meeting, or null between meetings.
  let meeting: {
    id: string;
    key: string;
    seq: number;
    /** When unbilled time last started accruing; null while suspended. */
    since: number | null;
    /** Sub-second remainder carried to the next tick. */
    carryMs: number;
    cancelTimer: () => void;
  } | null = null;

  // Ticks not yet confirmed by the server, oldest first. They outlive their
  // meeting: a tick that failed at the end of one meeting is sent during the next.
  let pending: PendingTick[] = [];
  let sending: Promise<void> | null = null;
  // Set once the server says this key is not a pack; cleared when the key changes.
  let notPackKey: string | null = null;
  let endedReported = false;

  /** Move time accrued since `since` (capped) into whole seconds on a new tick. */
  function accrue(at: number): void {
    if (!meeting || meeting.since === null) return;
    const gap = Math.max(0, at - meeting.since);
    meeting.since = at;
    const ms = meeting.carryMs + Math.min(gap, MAX_GAP_MS);
    const seconds = Math.floor(ms / 1000);
    meeting.carryMs = ms - seconds * 1000;
    if (seconds <= 0) return;
    pending.push({ key: meeting.key, body: { meeting_id: meeting.id, seq: meeting.seq++, seconds } });
    if (pending.length > MAX_PENDING) pending = pending.slice(pending.length - MAX_PENDING);
  }

  function stopTimer(): void {
    if (meeting) { try { meeting.cancelTimer(); } catch { /* already gone */ } }
  }

  function packEnded(info: PackEndedInfo): void {
    // Nothing more to meter on this key; whatever is queued for it is moot.
    const key = meeting?.key;
    if (meeting) { stopTimer(); meeting = null; }
    if (key) pending = pending.filter((t) => t.key !== key);
    if (endedReported) return;
    endedReported = true;
    log.log(`[PackClock] the pack has ended (${info.reason ?? 'no reason given'}) — re-checking Pro`);
    try { deps.onPackEnded(info); } catch (e: any) { log.warn('[PackClock] onPackEnded threw:', e?.message ?? e); }
  }

  /** Send queued ticks in order. Stops at the first one that must be retried. */
  async function drain(): Promise<void> {
    while (pending.length > 0) {
      const tick = pending[0];
      let answer: TickAnswer;
      try {
        answer = await deps.postTick(tick.key, tick.body);
      } catch (e: any) {
        log.warn(`[PackClock] tick not sent (${e?.message ?? e}) — kept for the next minute`);
        return;
      }
      const { status, body } = answer;
      if (status >= 200 && status < 300) {
        pending.shift();
        if (body?.metered === false) {
          // Not a pack: stop metering this key, drop its queue.
          notPackKey = tick.key;
          pending = pending.filter((t) => t.key !== tick.key);
          if (meeting?.key === tick.key) { stopTimer(); meeting = null; }
          continue;
        }
        if (body?.pack) { try { deps.onPackState?.(body.pack); } catch { /* a listener never stops the clock */ } }
        if (body?.pack?.ended) { packEnded({ reason: body.pack.ended_reason ?? undefined }); }
        continue;
      }
      if (status === 400) {
        log.warn(`[PackClock] tick refused as malformed (${body?.message ?? 'no message'}) — dropped`);
        pending.shift();
        continue;
      }
      if (status === 401 || status === 403) {
        // The key itself is refused. A finished pack says so; anything else
        // (a cancelled plan, a bad key) is not ours to handle, but there is
        // nothing left to meter on it either way.
        const ended = body?.reason === 'pack_ended' || body?.error === 'subscription_inactive';
        pending = pending.filter((t) => t.key !== tick.key);
        if (ended) { packEnded({ reason: body?.pack_ended_reason ?? undefined }); continue; }
        log.warn(`[PackClock] key refused (${status} ${body?.error ?? ''}) — clock off for this key`);
        notPackKey = tick.key;
        if (meeting?.key === tick.key) { stopTimer(); meeting = null; }
        continue;
      }
      // 429, 5xx, anything else: transient. Keep it; the next minute retries.
      log.warn(`[PackClock] tick answered ${status} — kept for the next minute`);
      return;
    }
  }

  function flush(): Promise<void> {
    if (sending) return sending;
    sending = drain().finally(() => { sending = null; });
    return sending;
  }

  function onTimer(): void {
    if (!meeting) return;
    accrue(deps.now());
    void flush();
  }

  return {
    /** A meeting went live. No key (or a trial) → nothing to meter. */
    meetingStarted(): void {
      if (meeting) { accrue(deps.now()); stopTimer(); meeting = null; }
      const key = deps.getApiKey();
      if (!key) return;
      if (notPackKey !== null && notPackKey !== key) notPackKey = null;
      if (notPackKey === key) return;
      endedReported = false;
      meeting = {
        id: deps.newMeetingId(),
        key,
        seq: 0,
        since: deps.now(),
        carryMs: 0,
        cancelTimer: () => {},
      };
      meeting.cancelTimer = deps.every(onTimer, TICK_INTERVAL_MS);
      // Leftovers from an earlier meeting go out now, not a minute from now.
      if (pending.length > 0) void flush();
    },

    /** The meeting stopped: bill the last partial minute and send. */
    meetingEnded(): Promise<void> {
      if (!meeting) return pending.length > 0 ? flush() : Promise.resolve();
      accrue(deps.now());
      stopTimer();
      meeting = null;
      return flush();
    },

    /** The system is going to sleep: bill up to now, then stop accruing. */
    suspend(): void {
      if (!meeting || meeting.since === null) return;
      accrue(deps.now());
      meeting.since = null;
    },

    /** The system woke: accrue again from now. Sleep time is never billed. */
    resume(): void {
      if (!meeting || meeting.since !== null) return;
      meeting.since = deps.now();
    },

    /** Test and diagnostics view. */
    snapshot() {
      return {
        live: meeting !== null,
        suspended: meeting !== null && meeting.since === null,
        meetingId: meeting?.id ?? null,
        nextSeq: meeting?.seq ?? null,
        pending: pending.map((t) => ({ ...t.body })),
      };
    },
  };
}
