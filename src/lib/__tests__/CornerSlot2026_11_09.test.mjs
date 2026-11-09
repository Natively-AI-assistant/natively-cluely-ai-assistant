// L5 (2026-11-09): one notice in the launcher's bottom-right corner at a time.
//
// The meeting offer, the update toast, the quota notice, the trial meter, the
// Hindsight notice and the provider-change notice were each fixed to the same
// corner (GenieModal placement="bottom-right", or a fixed bottom-right
// wrapper), with no stacking, so two at once were drawn over each other. Each
// now asks the corner slot; the highest asking is shown, the rest wait.
//
// Run: node --test src/lib/__tests__/CornerSlot2026_11_09.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORNER_PRIORITY, createCornerSlot } from '../cornerSlot.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

// The trial meter is last (review fix 2026-11-09 b): it is a status that is
// up on Home for the whole trial, not a passing notice, so above the others
// it hid the Hindsight notice and the provider notice's Reindex all trial.
test('the priority: meeting offer > update > quota > hindsight > provider notice > trial meter', () => {
  assert.deepEqual([...CORNER_PRIORITY], ['meeting_offer', 'update', 'quota', 'hindsight', 'provider_notice', 'trial_meter']);
});

test('a running trial does not starve the passing notices; the meter returns when they clear', () => {
  const slot = createCornerSlot();
  slot.request('trial_meter');
  assert.equal(slot.holder(), 'trial_meter');
  slot.request('provider_notice');
  assert.equal(slot.holder(), 'provider_notice', 'the Reindex notice is shown during a trial');
  slot.request('hindsight');
  assert.equal(slot.holder(), 'hindsight');
  slot.release('hindsight');
  assert.equal(slot.holder(), 'provider_notice');
  slot.release('provider_notice');
  assert.equal(slot.holder(), 'trial_meter', 'the meter is back');
});

test('only the highest asking is shown; a lower one waits and comes back', () => {
  const slot = createCornerSlot();
  slot.request('quota');
  assert.equal(slot.holder(), 'quota');
  slot.request('meeting_offer');
  assert.equal(slot.holder(), 'meeting_offer', 'a call detected takes the corner');
  slot.request('provider_notice');
  assert.equal(slot.holder(), 'meeting_offer');
  slot.release('meeting_offer');
  assert.equal(slot.holder(), 'quota', 'the quota notice was waiting, not lost');
  slot.release('quota');
  assert.equal(slot.holder(), 'provider_notice');
  slot.release('provider_notice');
  assert.equal(slot.holder(), null);
});

test('a lower notice never takes the corner from a higher one', () => {
  const slot = createCornerSlot();
  slot.request('update');
  slot.request('quota');
  slot.request('hindsight');
  assert.equal(slot.holder(), 'update');
});

test('request and release are idempotent; listeners hear only real changes', () => {
  const slot = createCornerSlot();
  let calls = 0;
  const off = slot.subscribe(() => { calls += 1; });
  slot.request('quota');
  slot.request('quota');
  slot.request('hindsight');
  assert.equal(calls, 1, 'quota took the corner once; hindsight waits silently');
  slot.release('hindsight');
  slot.release('hindsight');
  assert.equal(calls, 1);
  slot.release('quota');
  assert.equal(calls, 2);
  off();
  slot.request('quota');
  assert.equal(calls, 2, 'unsubscribed');
});

test('an unknown notice is refused', () => {
  assert.throws(() => createCornerSlot().request('banner_from_nowhere'));
});

// ── Every bottom-right notice takes part (source-level: they need a DOM) ──
const read = (rel) => fs.readFileSync(path.resolve(here, '..', '..', rel), 'utf8');
const participants = [
  ['components/MeetingOfferToast.tsx', "useCornerSlot('meeting_offer', !!offer)", /open=\{corner\.show\}/],
  ['components/UpdateBanner.tsx', "useCornerSlot('update', isVisible && minimized)", /isOpen=\{corner\.show\}/],
  ['components/NativelyQuotaBanner.tsx', "useCornerSlot('quota', visible)", /open=\{corner\.show\}/],
  ['components/trial/TrialMeterToaster.tsx', "useCornerSlot('trial_meter', wantsOpen)", /const open = corner\.show;/],
  ['components/HindsightStatusBanner.tsx', "useCornerSlot('hindsight', wantsCorner)", /const open = corner\.show;/],
  ['components/ProviderChangeNotice.tsx', "useCornerSlot('provider_notice', props.open)", /const \{ show: open, displaced \} = useCornerSlot\('provider_notice', props\.open\);/],
];
for (const [file, ask, shows] of participants) {
  test(`${file} asks the corner and shows only while it holds it`, () => {
    const src = read(file);
    assert.ok(src.includes(ask), ask);
    assert.match(src, shows);
  });
}

// Review fix (2026-11-09 b): pushed out by a higher notice, the provider notice
// leaves at once, like the others (closeInstantly), instead of sliding out
// while the incoming one pours in.
test('ProviderChangeNotice leaves at once when displaced', () => {
  const src = read('components/ProviderChangeNotice.tsx');
  assert.match(src, /if \(displaced\) \{ setEntered\(false\); setMounted\(false\); return; \}/);
});

test('MeetingOfferToast keeps its own logic: only its open flag goes through the slot', () => {
  const src = read('components/MeetingOfferToast.tsx');
  assert.match(src, /const start = \(\) => \{\s*if \(!offer\) return;/);
  assert.match(src, /const notNow = \(\) => \{\s*if \(!offer\) return;/);
  assert.match(src, /getMeetingOffer\?\.\(\)/);
});
