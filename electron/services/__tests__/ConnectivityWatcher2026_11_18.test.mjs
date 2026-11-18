// What the app does with a failed connection (2026-11-18, #759).
//
// The Pro check says "plan lookup failed: fetch failed" and keeps retrying. This
// watcher notices a failure that looks like the network, asks the diagnosis why,
// tells the person in plain words, reports it (when telemetry is on), and — for
// the one cause the app can undo, a stale OS certificate store — undoes it and
// asks again. Everything it touches is injected, so macOS and Windows run the
// same cases.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createConnectivityWatcher, looksLikeNetworkFailure, settleRetry } from '../connectivityWatcher.ts';
import { dropSystemCertificates, restoreSystemCertificates } from '../../utils/systemCertificates.ts';
import { checkFunnelProps } from '../../../src/lib/funnel/funnelCatalog.mjs';

const stale = { verdict: 'stale_store', heal: 'drop_system_ca', userMessage: 'stale message', report: { reason: 'pro_check', verdict: 'stale_store', tls_builtin: 'ok', tls_merged: 'cert_has_expired' } };
const blocked = { verdict: 'blocked', userMessage: 'blocked message', report: { reason: 'pro_check', verdict: 'blocked', tls_builtin: 'etimedout', tls_merged: 'etimedout' } };

function rig(over = {}) {
  const calls = { diagnose: 0, track: [], notify: [], heal: 0, retry: 0, logs: [] };
  let t = 1_000_000;
  const deps = {
    diagnose: async (reason) => { calls.diagnose++; calls.reason = reason; return blocked; },
    track: (props) => { calls.track.push(props); return 'queued'; },
    notify: (n) => calls.notify.push(n),
    heal: () => { calls.heal++; return true; },
    restore: () => { calls.restore = (calls.restore || 0) + 1; },
    retry: async () => { calls.retry++; return 'activated'; },
    now: () => t,
    log: (m) => calls.logs.push(m),
    ...over,
  };
  return { w: createConnectivityWatcher(deps), calls, advance: (ms) => { t += ms; } };
}

describe('which failures count', () => {
  test('a network error from the Pro check does; a server answer or a refused key does not', () => {
    for (const s of ['plan lookup failed: fetch failed (CERT_HAS_EXPIRED)', 'plan lookup failed: fetch failed', 'plan lookup failed: The operation was aborted due to timeout', 'network error: fetch failed']) {
      assert.equal(looksLikeNetworkFailure(s), true, s);
    }
    for (const s of ['plan lookup answered 503', 'verify answered 502', 'verify did not confirm', 'the server refused the key', undefined, '']) {
      assert.equal(looksLikeNetworkFailure(s), false, String(s));
    }
  });
});

describe('the watcher', () => {
  test('a network failure → diagnosed once, the person is told, the report is sent', async () => {
    const { w, calls } = rig();
    await w.onFailure('pro_check', 'plan lookup failed: fetch failed');
    assert.equal(calls.diagnose, 1);
    assert.equal(calls.reason, 'pro_check');
    assert.deepEqual(calls.notify, [{ verdict: 'blocked', message: 'blocked message', healed: false }]);
    assert.equal(calls.track.length, 1);
    assert.equal(calls.track[0].verdict, 'blocked');
  });

  test('a failure that is not the network does nothing at all', async () => {
    const { w, calls } = rig();
    await w.onFailure('pro_check', 'plan lookup answered 503');
    assert.equal(calls.diagnose, 0);
    assert.equal(calls.notify.length, 0);
  });

  test('with Usage statistics off the person still gets the notice and the heal; the report is simply not accepted', async () => {
    const { w, calls } = rig({ diagnose: async () => stale, track: () => 'disabled' });
    await w.onFailure('pro_check', 'plan lookup failed: fetch failed');
    assert.equal(calls.heal, 1);
    assert.equal(calls.notify.length, 1);
  });

  test('at most one diagnosis per 30 minutes, and never two at once', async () => {
    const { w, calls, advance } = rig();
    await Promise.all([w.onFailure('pro_check', 'plan lookup failed: fetch failed'), w.onFailure('key_saved', 'plan lookup failed: fetch failed')]);
    assert.equal(calls.diagnose, 1, 'two at once');
    await w.onFailure('pro_check', 'plan lookup failed: fetch failed');
    assert.equal(calls.diagnose, 1, 'inside the gap');
    advance(31 * 60_000);
    await w.onFailure('pro_check', 'plan lookup failed: fetch failed');
    assert.equal(calls.diagnose, 2, 'after the gap');
  });

  test('a stale certificate store is undone and the Pro check runs again; healed means it then worked', async () => {
    const { w, calls } = rig({ diagnose: async () => stale });
    await w.onFailure('pro_check', 'plan lookup failed: fetch failed (CERT_HAS_EXPIRED)');
    assert.equal(calls.heal, 1);
    assert.equal(calls.retry, 1);
    assert.equal(calls.track[0].healed, true);
    assert.equal(calls.notify[0].verdict, 'stale_store');
    assert.equal(calls.notify[0].healed, true);
    assert.match(calls.notify[0].message, /worked around it/i);
    assert.doesNotMatch(calls.notify[0].message, /stale message/);
  });

  test('healing that does not help is reported as not healed', async () => {
    const { w, calls } = rig({ diagnose: async () => stale, retry: async () => 'retrying' });
    await w.onFailure('pro_check', 'plan lookup failed: fetch failed');
    assert.equal(calls.track[0].healed, false);
    assert.equal(calls.notify[0].healed, false);
  });

  test('an undo that did not fix it is taken back: the OS certificates other hosts may need come back', async () => {
    const { w, calls } = rig({ diagnose: async () => stale, retry: async () => 'retrying' });
    await w.onFailure('pro_check', 'plan lookup failed: fetch failed');
    assert.equal(calls.restore, 1);
  });

  test('an undo that worked is kept', async () => {
    const { w, calls } = rig({ diagnose: async () => stale });
    await w.onFailure('pro_check', 'plan lookup failed: fetch failed');
    assert.equal(calls.restore, undefined);
  });

  test('an undo that failed is never reported as done', async () => {
    const { w, calls } = rig({ diagnose: async () => ({ ...stale, userMessage: 'blocking the connection' }), retry: async () => 'retrying' });
    await w.onFailure('pro_check', 'plan lookup failed: fetch failed');
    assert.equal(calls.notify[0].message, 'blocking the connection');
    assert.doesNotMatch(calls.notify[0].message, /switched|worked around/i);
  });

  test('a key pasted just now is checked even if an earlier failure used the slot, but not on every keystroke', async () => {
    const { w, calls, advance } = rig();
    await w.onFailure('api_call', 'plan lookup failed: fetch failed');
    await w.onFailure('key_saved', 'plan lookup failed: fetch failed');
    assert.equal(calls.diagnose, 2, 'the key save is not starved by a background failure');
    await w.onFailure('key_saved', 'plan lookup failed: fetch failed');
    assert.equal(calls.diagnose, 2, 'but not twice in a minute');
    advance(61_000);
    await w.onFailure('key_saved', 'plan lookup failed: fetch failed');
    assert.equal(calls.diagnose, 3);
  });

  test('a heal that cannot be done does not retry', async () => {
    const { w, calls } = rig({ diagnose: async () => stale, heal: () => false });
    await w.onFailure('pro_check', 'plan lookup failed: fetch failed');
    assert.equal(calls.retry, 0);
    assert.equal(calls.track[0].healed, false);
  });

  test('a verdict with nothing to heal never touches the certificates', async () => {
    const { w, calls } = rig();
    await w.onFailure('pro_check', 'plan lookup failed: fetch failed');
    assert.equal(calls.heal, 0);
    assert.equal(calls.retry, 0);
  });

  test('every report it sends passes the funnel catalogue', async () => {
    for (const d of [stale, blocked]) {
      const { w, calls } = rig({ diagnose: async () => d });
      await w.onFailure('pro_check', 'plan lookup failed: fetch failed');
      const checked = checkFunnelProps('connect_diag', calls.track[0]);
      assert.equal(checked.ok, true, checked.error);
    }
  });

  test('a diagnosis, report, heal or notice that throws never reaches the caller', async () => {
    for (const over of [
      { diagnose: async () => { throw new Error('x'); } },
      { diagnose: async () => stale, track: () => { throw new Error('x'); } },
      { diagnose: async () => stale, notify: () => { throw new Error('x'); } },
      { diagnose: async () => stale, heal: () => { throw new Error('x'); } },
      { diagnose: async () => stale, retry: async () => { throw new Error('x'); } },
    ]) {
      const { w } = rig(over);
      await assert.doesNotReject(() => w.onFailure('pro_check', 'plan lookup failed: fetch failed'));
    }
  });
});

describe('settleRetry: a server that answers an error still proves the connection works', () => {
  test('retrying because the server said 503 is an answer; retrying because the network failed is not', async () => {
    assert.equal(await settleRetry(async () => 'retrying', async () => false, () => 'plan lookup answered 503'), 'activated');
    assert.equal(await settleRetry(async () => 'gave_up', async () => false, () => 'verify answered 502'), 'activated');
    assert.equal(await settleRetry(async () => 'retrying', async () => false, () => 'plan lookup failed: fetch failed'), 'retrying');
    assert.equal(await settleRetry(async () => 'retrying', async () => false, () => undefined), 'retrying');
  });
});

describe('the build bundles every entry point separately (scripts/build-electron.js, esbuild bundle:true)', () => {
  test('so what the undo remembers is shared between two copies of the module', async () => {
    const A = await import('../../utils/systemCertificates.ts?bundle=a');
    const B = await import('../../utils/systemCertificates.ts?bundle=b');
    assert.notEqual(A.dropSystemCertificates, B.dropSystemCertificates, 'really two copies');
    const set = [];
    const tls = { getCACertificates: (t) => ({ bundled: ['B'], extra: [], default: ['B', 'S1'] })[t], setDefaultCACertificates: (c) => set.push(c) };
    assert.equal(A.dropSystemCertificates({ tls }), true);
    assert.equal(B.restoreSystemCertificates({ tls }), true, 'the other copy can put it back');
    assert.deepEqual(set.at(-1), ['B', 'S1']);
  });
});

describe('restoreSystemCertificates', () => {
  const mk = () => {
    const set = [];
    return { set, tls: { getCACertificates: (t) => ({ bundled: ['B'], extra: [], default: ['B', 'S1', 'S2'] })[t], setDefaultCACertificates: (c) => set.push(c) } };
  };
  test('puts back exactly the list that was in use before the undo', () => {
    const { set, tls } = mk();
    assert.equal(dropSystemCertificates({ tls }), true);
    assert.equal(restoreSystemCertificates({ tls }), true);
    assert.deepEqual(set, [['B'], ['B', 'S1', 'S2']]);
  });
  test('a second undo does not overwrite what to restore', () => {
    const { set, tls } = mk();
    dropSystemCertificates({ tls });
    tls.getCACertificates = (t) => ({ bundled: ['B'], extra: [], default: ['B'] })[t];
    dropSystemCertificates({ tls });
    restoreSystemCertificates({ tls });
    assert.deepEqual(set.at(-1), ['B', 'S1', 'S2']);
  });
  test('with nothing undone there is nothing to restore', () => {
    assert.equal(restoreSystemCertificates({ tls: mk().tls }), false);
  });
});

describe('dropSystemCertificates', () => {
  test('goes back to Node\'s bundled list, plus the extra certificates the user asked for', () => {
    const set = [];
    const tls = { getCACertificates: (t) => ({ bundled: ['B1', 'B2'], extra: ['X1'], default: ['B1', 'B2', 'S1'] })[t], setDefaultCACertificates: (c) => set.push(c) };
    assert.equal(dropSystemCertificates({ tls }), true);
    assert.deepEqual(set, [['B1', 'B2', 'X1']]);
  });
  test('a Node without the API, or one that refuses, answers false and throws nothing', () => {
    assert.equal(dropSystemCertificates({ tls: {} }), false);
    assert.equal(dropSystemCertificates({ tls: { getCACertificates: () => ['A'], setDefaultCACertificates: () => { throw new Error('no'); } } }), false);
  });
});
