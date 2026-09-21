// 2026-09-22. "I have Ultra, I entered my API key, the plan shows — but Pro never
// turned on." Production evidence (natively-api, 2026-09-19 04:50 → 09-20 18:28 UTC):
// /v1/pro/verify answered 503 to 25 of 25 requests for ~38 hours. The key-save
// handler stores the key FIRST and calls LicenseManager.activateWithApiKey ONCE; on
// a 5xx it console.logs and reports success. Nothing ever tried again — not at
// startup, not when /v1/usage later came back with a Pro-capable plan — and the
// Save button is disabled for a saved key, so the customer could not retry either.
// A reinstall on Windows keeps %APPDATA%: key still there, licence still absent.
//
// The reconciler is the missing retry. It is pure (every dependency injected) so
// both platform branches are exercised by the same tests: nothing here touches an
// OS API, the filesystem or Electron.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createProEntitlementReconciler, PRO_CAPABLE_PLANS } from '../ProEntitlementReconciler.ts';

const KEY = 'natively_sk_' + 'a'.repeat(40);

function world(over = {}) {
  const timers = [];
  const calls = { plan: 0, activate: 0, activated: 0, status: [] };
  let premium = over.premium ?? false;
  let now = 1_000_000;
  const planAnswers = [...(over.plans ?? [{ ok: true, plan: 'ultra' }])];
  const activateAnswers = [...(over.activations ?? [{ success: true }])];
  const take = (arr) => (arr.length > 1 ? arr.shift() : arr[0]);
  const r = createProEntitlementReconciler({
    getApiKey: () => ('key' in over ? over.key : KEY),
    isTrialKey: (k) => k === '__trial__',
    isPremium: () => premium,
    fetchPlan: async () => { calls.plan++; const a = take(planAnswers); if (a instanceof Error) throw a; return a; },
    activate: async () => { calls.activate++; const a = take(activateAnswers); if (a instanceof Error) throw a; if (a.success) premium = true; return a; },
    onActivated: () => { calls.activated++; },
    onStatus: (s) => calls.status.push(s.state),
    schedule: (fn, ms) => { const t = { fn, ms, cancelled: false }; timers.push(t); return () => { t.cancelled = true; }; },
    now: () => now,
    log: { log() {}, warn() {} },
  });
  return {
    r, calls, timers,
    advance: (ms) => { now += ms; },
    fireNext: async () => { const t = timers.find((x) => !x.cancelled && !x.fired); assert.ok(t, 'no retry was scheduled'); t.fired = true; now += t.ms; await t.fn(); return t.ms; },
    pending: () => timers.filter((x) => !x.cancelled && !x.fired).length,
  };
}

describe('the case that reached support', () => {
  test('key saved, no licence, server healthy again → Pro is activated without the user doing anything', async () => {
    const w = world();
    assert.equal(await w.r.run('startup'), 'activated');
    assert.equal(w.calls.activate, 1);
    assert.equal(w.calls.activated, 1, 'windows must be told so the UI flips to Pro');
    assert.equal(w.pending(), 0);
  });

  test('a 503 on verify is retried with backoff until it works — it used to be tried once, ever', async () => {
    const w = world({ activations: [{ success: false, status: 503, error: 'x' }, { success: false, status: 503, error: 'x' }, { success: true }] });
    assert.equal(await w.r.run('startup'), 'retrying');
    const d1 = await w.fireNext(), d2 = await w.fireNext();
    assert.ok(d1 >= 20_000 && d2 > d1, `backoff must grow: ${d1} → ${d2}`);
    assert.equal(w.calls.activate, 3);
    assert.equal(w.calls.activated, 1);
    assert.equal(w.pending(), 0, 'and it stops once Pro is on');
  });

  test('a network failure (no status at all) is transient too', async () => {
    const w = world({ activations: [{ success: false, error: 'Could not reach server. Please try again.' }, { success: true }] });
    assert.equal(await w.r.run('startup'), 'retrying');
    await w.fireNext();
    assert.equal(w.calls.activated, 1);
  });

  test('/v1/usage itself failing is transient — the plan is unknown, not absent', async () => {
    const w = world({ plans: [{ ok: false, status: 503 }, new Error('ENOTFOUND'), { ok: true, plan: 'pro' }] });
    assert.equal(await w.r.run('startup'), 'retrying');
    await w.fireNext(); await w.fireNext();
    assert.equal(w.calls.activate, 1, 'activation is only attempted once the plan is known to include Pro');
    assert.equal(w.calls.activated, 1);
  });

  test('retries are bounded — a permanently broken server is not polled forever', async () => {
    const w = world({ activations: [{ success: false, status: 503 }] });
    await w.r.run('startup');
    let n = 0; while (w.pending() && n < 50) { await w.fireNext(); n++; }
    assert.ok(n >= 5 && n <= 12, `a handful of spaced retries per session, got ${n}`);
    assert.equal(w.r.snapshot().state, 'gave_up');
    // …but a later real signal (the user opens Settings and usage loads) starts over.
    w.advance(60 * 60_000);
    assert.equal(await w.r.run('usage-ok'), 'retrying');
  });
});

describe('it must never make things worse', () => {
  test('Pro already on → no network call at all', async () => {
    const w = world({ premium: true });
    assert.equal(await w.r.run('startup'), 'not_needed');
    assert.equal(w.calls.plan + w.calls.activate, 0);
  });

  test('no key, or the trial sentinel → nothing to reconcile', async () => {
    for (const key of [undefined, '', '__trial__']) {
      const w = world({ key });
      assert.equal(await w.r.run('startup'), 'not_needed');
      assert.equal(w.calls.plan + w.calls.activate, 0);
    }
  });

  test('a standard plan is a final answer: one usage call, never a verify, never a retry', async () => {
    const w = world({ plans: [{ ok: true, plan: 'standard' }] });
    assert.equal(await w.r.run('startup'), 'no_entitlement');
    assert.equal(w.calls.activate, 0, 'most keys are standard — they must not each cost a verify per launch');
    assert.equal(w.pending(), 0);
  });

  test('a key the server REFUSES is final — and the reconciler never tears anything down', async () => {
    const w = world({ plans: [{ ok: false, status: 401, keyRejected: true }] });
    assert.equal(await w.r.run('startup'), 'key_rejected');
    assert.equal(w.pending(), 0);
  });

  test('a protected lifetime licence (skipped) is final', async () => {
    const w = world({ activations: [{ success: false, skipped: true }] });
    assert.equal(await w.r.run('startup'), 'skipped');
    assert.equal(w.pending(), 0);
  });

  test('single-flight: five triggers at once are one attempt', async () => {
    const w = world();
    const out = await Promise.all(Array.from({ length: 5 }, () => w.r.run('usage-ok')));
    assert.equal(w.calls.activate, 1);
    assert.equal(new Set(out).size, 1);
  });

  test('a burst of triggers while retrying does not defeat the backoff', async () => {
    const w = world({ activations: [{ success: false, status: 503 }] });
    await w.r.run('startup');
    for (let i = 0; i < 10; i++) { w.advance(1_000); await w.r.run('usage-ok'); }
    assert.equal(w.calls.activate, 1, 'opening Settings ten times in ten seconds is still one attempt');
  });

  test('stop() cancels the pending retry (key cleared, app quitting)', async () => {
    const w = world({ activations: [{ success: false, status: 503 }] });
    await w.r.run('startup');
    w.r.stop();
    assert.equal(w.pending(), 0);
  });

  test('a throwing dependency is contained and counts as transient', async () => {
    const w = world({ activations: [new Error('native module exploded'), { success: true }] });
    assert.equal(await w.r.run('startup'), 'retrying');
    await w.fireNext();
    assert.equal(w.calls.activated, 1);
  });
});

test('a caller that already knows the plan passes it in — no second /v1/usage', async () => {
  const w = world();
  assert.equal(await w.r.run('usage-ok', { plan: 'max' }), 'activated');
  assert.equal(w.calls.plan, 0);
  const std = world();
  assert.equal(await std.r.run('usage-ok', { plan: 'standard' }), 'no_entitlement');
  assert.equal(std.calls.plan + std.calls.activate, 0);
});

test('the plan set matches the server (natively-api lib/plans.js PRO_PLANS)', () => {
  assert.deepEqual([...PRO_CAPABLE_PLANS].sort(), ['max', 'pro', 'ultra']);
});

test('status is reported so the settings page can say what is happening', async () => {
  const w = world({ activations: [{ success: false, status: 503 }, { success: true }] });
  await w.r.run('startup'); await w.fireNext();
  assert.deepEqual(w.calls.status.filter((s, i, a) => a[i - 1] !== s), ['checking', 'retrying', 'checking', 'activated']);
});
