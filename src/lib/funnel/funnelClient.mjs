// src/lib/funnel/funnelClient.mjs
//
// The funnel queue: record an event now, deliver it when the network allows.
//
// WHY NOT THE USAGE OUTBOX. electron/services/UsageOutbox.ts holds its queue
// until a Natively key exists, because its rows are attributed to a licence. A
// funnel is about the installs that have no key — never tried, tried and left,
// left through their own keys — so it cannot wait for one. These events go to
// POST /v1/telemetry/funnel, which takes no key and identifies the install by
// the random install id alone.
//
// WHAT THIS IS NOT. Not evidence, not billing, not durable to the standard the
// usage outbox is: a small JSON file, bounded, best effort. Losing a funnel
// event costs one data point.
//
// THE RULES IT KEEPS
//   1. Never on a feature's path: track() validates, appends, returns.
//   2. Never throws into a caller.
//   3. Nothing leaves while the user has turned telemetry off, and what was
//      queued before they did is discarded, not sent later.
//   4. Only what the catalogue allows: enums, integers, booleans.
//
// Pure: storage, clock, ids and fetch are all handed in, so this runs under
// plain `node --test` with no Electron.

import { checkFunnelProps, ENTITLEMENTS } from './funnelCatalog.mjs';

export const FUNNEL_QUEUE_MAX = 500;
export const FUNNEL_BATCH = 50;
export const FUNNEL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const FUNNEL_DEDUPE_MS = 2000;

/** Wait after the 1st, 2nd, … failed delivery. Capped at the last entry. */
export const FUNNEL_BACKOFF_MS = Object.freeze([
  30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 20 * 60_000, 30 * 60_000, 60 * 60_000,
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION = /^[0-9A-Za-z.\-+]{1,32}$/;
const PLATFORMS = ['darwin', 'win32', 'linux'];

/** Read a stored queue. Anything unreadable is an empty queue, never a throw. */
export function parseFunnelQueue(text) {
  const empty = { events: [], attempt: 0, nextAttemptAt: 0 };
  if (typeof text !== 'string' || !text) return empty;
  try {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.events)) return empty;
    return {
      events: raw.events.filter((e) => e && typeof e === 'object' && typeof e.event_id === 'string' && typeof e.event_type === 'string'),
      attempt: Number.isInteger(raw.attempt) && raw.attempt >= 0 ? raw.attempt : 0,
      nextAttemptAt: Number.isFinite(raw.nextAttemptAt) ? raw.nextAttemptAt : 0,
    };
  } catch {
    return empty;
  }
}

/**
 * @param {object} deps
 * @param {() => string | null} deps.load   the stored queue text, or null
 * @param {(text: string) => boolean} deps.save
 * @param {typeof fetch} deps.fetchImpl
 * @param {string} deps.endpoint
 * @param {() => number} deps.now
 * @param {() => string} deps.newId           a UUID
 * @param {() => string | undefined} deps.installId
 * @param {() => string | undefined} deps.appVersion
 * @param {string} deps.platform              process.platform, passed in
 * @param {string} [deps.appSessionId]
 * @param {() => boolean} deps.isEnabled      false when the user turned telemetry off
 * @param {() => string | undefined} [deps.getEntitlement]
 * @param {() => number} [deps.random]
 * @param {{ warn: (...a: unknown[]) => void }} [deps.log]
 */
export function createFunnelClient(deps) {
  const log = deps.log || { warn() {} };
  const random = deps.random || Math.random;
  let queue = null;
  let dispatching = false;
  let lastKey = '';
  let lastAt = 0;
  const stats = { tracked: 0, delivered: 0, rejected: 0, dropped: 0, failedAttempts: 0, invalid: 0 };

  const state = () => {
    if (!queue) {
      let text = null;
      try { text = deps.load(); } catch { text = null; }
      queue = parseFunnelQueue(text);
    }
    return queue;
  };
  const persist = () => {
    try { deps.save(JSON.stringify({ v: 1, ...state() })); } catch { /* best effort */ }
  };

  /**
   * Record one event. Returns why it was or was not queued:
   * 'queued' | 'disabled' | 'invalid' | 'no_install' | 'duplicate' | 'error'.
   */
  function track(eventType, props) {
    try {
      if (!deps.isEnabled()) return 'disabled';
      const checked = checkFunnelProps(eventType, props);
      if (!checked.ok) {
        stats.invalid++;
        log.warn(`[Funnel] refused ${String(eventType)}: ${checked.error}`);
        return 'invalid';
      }
      const installId = deps.installId();
      if (typeof installId !== 'string' || !UUID.test(installId)) return 'no_install';

      // The same event with the same properties inside two seconds is one
      // event: a card that re-renders must not report itself per frame.
      const now = deps.now();
      const key = `${eventType}:${JSON.stringify(checked.props)}`;
      if (key === lastKey && now - lastAt < FUNNEL_DEDUPE_MS) return 'duplicate';
      lastKey = key;
      lastAt = now;

      const event = {
        event_id: deps.newId(),
        event_type: eventType,
        client_event_ts: new Date(now).toISOString(),
        install_id: installId.toLowerCase(),
      };
      if (typeof deps.appSessionId === 'string' && UUID.test(deps.appSessionId)) event.app_session_id = deps.appSessionId;
      const version = deps.appVersion();
      if (typeof version === 'string' && VERSION.test(version)) event.app_version = version;
      if (PLATFORMS.includes(deps.platform)) event.platform = deps.platform;
      let entitlement;
      try { entitlement = deps.getEntitlement?.(); } catch { entitlement = undefined; }
      if (ENTITLEMENTS.includes(entitlement)) event.entitlement = entitlement;
      if (Object.keys(checked.props).length) event.props = checked.props;

      const q = state();
      q.events.push(event);
      if (q.events.length > FUNNEL_QUEUE_MAX) {
        stats.dropped += q.events.length - FUNNEL_QUEUE_MAX;
        q.events.splice(0, q.events.length - FUNNEL_QUEUE_MAX);
      }
      stats.tracked++;
      persist();
      return 'queued';
    } catch (e) {
      log.warn('[Funnel] track failed:', e?.message || e);
      return 'error';
    }
  }

  const backoffFor = (attempt) => {
    const base = FUNNEL_BACKOFF_MS[Math.min(Math.max(attempt, 1), FUNNEL_BACKOFF_MS.length) - 1];
    // Jitter, so installs that lost the network together do not return together.
    return base + Math.floor(random() * Math.min(base, 30_000));
  };

  /** Try to deliver one batch. Safe to call from overlapping timers. */
  async function dispatchOnce() {
    if (dispatching) return { sent: 0, skipped: 'in_flight' };
    dispatching = true;
    try {
      const q = state();
      if (!deps.isEnabled()) {
        // Turned off after events were queued: they are discarded, not held
        // for the day the setting changes back.
        if (q.events.length) {
          stats.dropped += q.events.length;
          q.events = [];
          q.attempt = 0;
          q.nextAttemptAt = 0;
          persist();
        }
        return { sent: 0, skipped: 'disabled' };
      }
      const now = deps.now();
      const fresh = q.events.filter((e) => {
        const t = Date.parse(e.client_event_ts);
        return !Number.isFinite(t) || now - t <= FUNNEL_MAX_AGE_MS;
      });
      if (fresh.length !== q.events.length) {
        stats.dropped += q.events.length - fresh.length;
        q.events = fresh;
        persist();
      }
      if (q.events.length === 0) return { sent: 0 };
      if (now < q.nextAttemptAt) return { sent: 0, skipped: 'backoff' };

      // One install per request: the server refuses a request that speaks for
      // several, and a refused request is dropped whole. The id is normally the
      // same for every event, but an install whose id file cannot be written
      // gets a new one each launch, and its queue then holds more than one.
      // Events for the other ids go out on the following ticks.
      const speakingFor = q.events[0].install_id;
      const batch = q.events.filter((e) => e.install_id === speakingFor).slice(0, FUNNEL_BATCH);
      const ids = new Set(batch.map((e) => e.event_id));
      const fail = (reason) => {
        stats.failedAttempts++;
        q.attempt += 1;
        q.nextAttemptAt = deps.now() + backoffFor(q.attempt);
        persist();
        return { sent: batch.length, delivered: 0, failed: reason };
      };

      let res;
      try {
        res = await deps.fetchImpl(deps.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ events: batch }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (e) {
        return fail(e?.name === 'TimeoutError' ? 'timeout' : 'network');
      }

      // 400 / 413: the server refuses this REQUEST and will refuse it the same
      // way forever. Dropping the batch is what keeps the queue from wedging.
      if (res.status === 400 || res.status === 413) {
        q.events = q.events.filter((e) => !ids.has(e.event_id));
        stats.rejected += batch.length;
        q.attempt = 0;
        q.nextAttemptAt = 0;
        persist();
        return { sent: batch.length, delivered: 0, rejected: batch.length };
      }
      // Everything else that is not a success is "not now": 503 while the
      // server's table or flag is not ready, 404 from a server older than this
      // endpoint, 429, 5xx. The events stay.
      if (!res.ok) return fail(`http_${res.status}`);

      let body = null;
      try { body = await res.json(); } catch { /* a 2xx with no readable body still counts as delivered */ }
      const rejectedIds = Array.isArray(body?.rejected_ids) ? body.rejected_ids.filter((id) => ids.has(id)) : [];
      q.events = q.events.filter((e) => !ids.has(e.event_id));
      q.attempt = 0;
      q.nextAttemptAt = 0;
      stats.rejected += rejectedIds.length;
      stats.delivered += batch.length - rejectedIds.length;
      persist();
      return { sent: batch.length, delivered: batch.length - rejectedIds.length, rejected: rejectedIds.length };
    } catch (e) {
      log.warn('[Funnel] dispatch failed:', e?.message || e);
      return { sent: 0, skipped: 'error' };
    } finally {
      dispatching = false;
    }
  }

  return {
    track,
    dispatchOnce,
    pending: () => state().events.length,
    stats: () => ({ ...stats, pending: state().events.length, attempt: state().attempt }),
  };
}
