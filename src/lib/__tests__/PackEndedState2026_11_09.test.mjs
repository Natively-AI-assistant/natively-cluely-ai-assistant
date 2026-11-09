// A Pro pack that runs out is refused like a switched-off key (403
// subscription_inactive). These pin how Plans and the quota banner read that
// refusal, so they say "Hours used up" instead of the last numbers they had.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endedPackFromRefusal, packMeetingBucket } from '../apiPlans.mjs';

const lastPack = {
  plan: 'pack_heavy',
  billing_period: 'pack',
  pack: { plan: 'pack_heavy', seconds_total: 18000, seconds_used: 180, seconds_left: 17820, ends_at: '2026-11-23T00:52:40.866Z', ended: false, ended_reason: null },
};

test('server reason pack_ended: uses the refusal\'s own pack block', () => {
  const r = endedPackFromRefusal({
    ok: false, error: 'subscription_inactive', status: 403, reason: 'pack_ended', pack_ended_reason: 'hours_used',
    pack: { plan: 'pack_heavy', seconds_total: 18000, seconds_used: 18000, seconds_left: 0, ends_at: '2026-11-23T00:52:40.866Z', ended: true, ended_reason: 'hours_used' },
  }, null);
  assert.equal(r.plan, 'pack_heavy');
  assert.equal(r.pack.ended, true);
  assert.equal(r.pack.ended_reason, 'hours_used');
  assert.equal(r.pack.seconds_left, 0);
});

test('a bare subscription_inactive is never an ended pack, even for a pack key', () => {
  // A refunded or revoked pack, or a lapsed plan: "Add hours" would not fix it.
  assert.equal(endedPackFromRefusal({ ok: false, error: 'subscription_inactive', status: 403 }, lastPack), null);
});

test('a pack_ended refusal without a block takes the last known block, marked ended', () => {
  const r = endedPackFromRefusal({ ok: false, error: 'subscription_inactive', reason: 'pack_ended', pack_ended_reason: 'window_closed' }, lastPack);
  assert.equal(r.plan, 'pack_heavy');
  assert.equal(r.pack.ended, true);
  assert.equal(r.pack.ended_reason, 'window_closed');
  assert.equal(r.pack.seconds_total, 18000);
});

test('a lapsed monthly key is not a pack', () => {
  assert.equal(endedPackFromRefusal({ ok: false, error: 'subscription_inactive' }, { plan: 'pro', billing_period: 'monthly', pack: null }), null);
  assert.equal(endedPackFromRefusal({ ok: false, error: 'subscription_inactive' }, null), null);
});

test('network errors, no key and good answers are not an ended pack', () => {
  assert.equal(endedPackFromRefusal({ ok: false, error: 'network_error' }, lastPack), null);
  assert.equal(endedPackFromRefusal({ ok: false, error: 'no_key' }, lastPack), null);
  assert.equal(endedPackFromRefusal({ ok: true, plan: 'pack_heavy' }, lastPack), null);
  assert.equal(endedPackFromRefusal(null, lastPack), null);
});

test('banner: no meeting line under 90% used', () => {
  assert.equal(packMeetingBucket(lastPack.pack), null);
});

test('banner: meeting line from 90% used, with time left', () => {
  const b = packMeetingBucket({ seconds_total: 18000, seconds_used: 16500, seconds_left: 1500, ends_at: '2099-01-01T00:00:00Z' });
  assert.deepEqual(b, { label: 'Meeting time', detail: '25 min left of 5 h', pct: 92 });
});

test('banner: an ended pack always shows, named by why it ended', () => {
  assert.deepEqual(packMeetingBucket({ seconds_total: 18000, seconds_used: 18000, seconds_left: 0, ended: true, ended_reason: 'hours_used' }),
    { label: 'Meeting time', detail: 'Hours used up', pct: 100 });
  assert.deepEqual(packMeetingBucket({ ended: true, ended_reason: 'window_closed', ends_at: '2026-11-01T00:00:00Z' }),
    { label: 'Meeting time', detail: 'Pack ended', pct: 100 });
});

test('banner: not a pack, no line', () => {
  assert.equal(packMeetingBucket(null), null);
});

// 2026-11-09: started after the pack had ended, Plans had no earlier answer and
// built the meters from normalizeQuota({}), which is null for a quota with no
// meters; the card read `quota.ai` and Settings · plans crashed.
test('Plans never builds an ended pack\'s quota from normalizeQuota({})', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../../components/settings/NativelyApiSettings.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes('endedPackFromRefusal(r, usageCache)'), 'the ended-pack fallback is still wired');
  assert.ok(!/normalizeQuota\(\s*\{\s*\}\s*\)/.test(src), 'normalizeQuota({}) is null; the card would crash on quota.ai');
});

// 2026-11-09 review: the meeting clock reports any subscription_inactive key as
// a finished pack (it must still re-check Pro), so a lapsed monthly plan was
// broadcast as 'pack-ended' and the overlay said "Your pack has ended" every
// meeting. Only a reasoned end may reach the windows, and the overlay ignores
// a reasonless one too.
test('pack-ended reaches the windows only with the server\'s reason', async () => {
  const { readFile } = await import('node:fs/promises');
  const wiring = await readFile(new URL('../../../electron/services/packs/packClockWiring.ts', import.meta.url), 'utf8');
  assert.match(wiring, /if \(reason\) broadcast\('pack-ended', \{ reason \}\)/);
  assert.ok(!/broadcast\('pack-ended', \{ reason: reason \?\? null \}\)/.test(wiring), 'no reasonless broadcast');
  const overlay = await readFile(new URL('../../components/NativelyInterface.tsx', import.meta.url), 'utf8');
  assert.match(overlay, /onPackEnded\?\.\(\(\{ reason \}\) => \{ if \(reason\) setPackEndedReason\(reason\); \}\)/);
});

test('a refused usage read drops the cached good answer', async () => {
  const { readFile } = await import('node:fs/promises');
  const ipc = await readFile(new URL('../../../electron/ipcHandlers.ts', import.meta.url), 'utf8');
  assert.match(ipc, /if \(res\.status === 401 \|\| res\.status === 403\) _usageCache\.delete\(key\);/);
});

// A top-up mid-meeting: the clock asks whether the key is live again, and the
// windows drop the ended state when it is.
test('a top-up mid-meeting is wired from the clock to every window', async () => {
  const { readFile } = await import('node:fs/promises');
  const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');
  const wiring = await read('../../../electron/services/packs/packClockWiring.ts');
  assert.match(wiring, /isKeyLive,\s*\n\s*onPackRenewed: packRenewed,/);
  assert.match(wiring, /broadcast\('pack-renewed', \{\}\)/);
  assert.match(wiring, /\/v1\/usage/);
  const preload = await read('../../../electron/preload.ts');
  assert.match(preload, /ipcRenderer\.on\('pack-renewed', sub\)/);
  const overlay = await read('../../components/NativelyInterface.tsx');
  assert.match(overlay, /onPackRenewed\?\.\(\(\) => setPackEndedReason\(null\)\)/);
  const plans = await read('../../components/settings/NativelyApiSettings.tsx');
  assert.match(plans, /onPackRenewed\?\.\(refresh\)/);
});
