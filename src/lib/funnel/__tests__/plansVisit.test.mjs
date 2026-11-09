// plans_visit: one Plans & Billing visit, summed up when it leaves view
// (added 2026-11-09). The tracker is pure apart from the clock and sender it
// is given, so every rule is checked here without a window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlansVisitTracker, isCheckoutUrl, PLANS_VISIT_SECONDS_MAX } from '../plansVisit.mjs';

const CHECKOUT = 'https://checkout.dodopayments.com/buy/pdt_0NrMWztmLVYzyt4L9SQJd';
const TERMS = 'https://natively.software/nativelyapi/t&c';
import { checkFunnelProps } from '../funnelCatalog.mjs';

function rig() {
  let t = 0;
  const sent = [];
  const tracker = createPlansVisitTracker({ now: () => t, send: (p) => sent.push(p) });
  return { tracker, sent, advance: (ms) => { t += ms; } };
}

test('a visit with nothing done reports the bare minimum, and passes the catalogue', () => {
  const { tracker, sent, advance } = rig();
  tracker.start('sidebar');
  advance(3_400);
  const props = tracker.end();
  assert.deepEqual(props, {
    from: 'sidebar', seconds: 3, saw_api_plans: false, saw_packs: false, saw_pro: false, saw_bottom: false,
    plan_cards: 0, saw_max_ultra: false, rail_scrolled: false, cycle_switched: false, checkouts: 0, refund_opened: false,
  });
  assert.deepEqual(sent, [props]);
  assert.equal(checkFunnelProps('plans_visit', props).ok, true);
});

test('what was seen and touched is all counted, once, and passes the catalogue', () => {
  const { tracker, advance } = rig();
  tracker.start('link');
  tracker.cycle('monthly');
  tracker.seen('api_plans'); tracker.seen('api_plans'); tracker.seen('packs'); tracker.seen('pro'); tracker.seen('bottom');
  tracker.seen('nonsense');
  tracker.card('standard'); tracker.card('pro'); tracker.card('pro'); tracker.card('ultra'); tracker.card('mega');
  tracker.railScrolled();
  tracker.cycleSwitched('yearly');
  tracker.opened(CHECKOUT); tracker.opened(CHECKOUT); tracker.opened(TERMS);
  tracker.refundOpened();
  advance(61_000);
  const props = tracker.end();
  assert.deepEqual(props, {
    from: 'link', seconds: 61, saw_api_plans: true, saw_packs: true, saw_pro: true, saw_bottom: true,
    plan_cards: 3, saw_max_ultra: true, rail_scrolled: true, cycle_switched: true, checkouts: 2, refund_opened: true,
    cycle: 'yearly',
  });
  assert.equal(checkFunnelProps('plans_visit', props).ok, true);
});

test('only a press on the switch to a new value counts as switching', () => {
  const { tracker } = rig();
  // The page moves a yearly subscriber to Yearly by itself: not a switch.
  tracker.start('sidebar');
  tracker.cycle('monthly'); tracker.cycle('yearly'); tracker.cycle('weekly');
  let props = tracker.end();
  assert.equal(props.cycle, 'yearly');
  assert.equal(props.cycle_switched, false);
  // Pressing the value it already shows is not a switch either.
  tracker.start('sidebar');
  tracker.cycle('yearly'); tracker.cycleSwitched('yearly'); tracker.cycleSwitched('weekly');
  props = tracker.end();
  assert.equal(props.cycle_switched, false);
  // Pressing the other value is.
  tracker.start('sidebar');
  tracker.cycle('monthly'); tracker.cycleSwitched('yearly');
  props = tracker.end();
  assert.equal(props.cycle, 'yearly');
  assert.equal(props.cycle_switched, true);
});

test('only Dodo checkout links count as checkouts', () => {
  assert.equal(isCheckoutUrl(CHECKOUT), true);
  assert.equal(isCheckoutUrl(TERMS), false);
  assert.equal(isCheckoutUrl('https://heynatively.com/pricing'), false);
  assert.equal(isCheckoutUrl('not a url'), false);
  assert.equal(isCheckoutUrl(undefined), false);
});

test('time stops while the window is hidden, and is capped', () => {
  const { tracker, advance } = rig();
  tracker.start('sidebar');
  advance(10_000);
  tracker.visibility(false);
  advance(600_000);
  tracker.visibility(true);
  advance(5_000);
  assert.equal(tracker.end().seconds, 15);

  tracker.start('sidebar', { visible: false });
  advance(30_000);
  tracker.visibility(true);
  advance(2_000);
  assert.equal(tracker.end().seconds, 2);

  tracker.start('sidebar');
  advance(10 * 3_600_000);
  assert.equal(tracker.end().seconds, PLANS_VISIT_SECONDS_MAX);
});

test('nothing is recorded or sent outside a visit, and a visit is sent once', () => {
  const { tracker, sent } = rig();
  tracker.seen('packs'); tracker.opened(CHECKOUT); tracker.cycleSwitched('yearly');
  assert.equal(tracker.end(), null);
  tracker.start('sidebar');
  assert.equal(tracker.active, true);
  tracker.end();
  assert.equal(tracker.end(), null);
  assert.equal(tracker.active, false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].saw_packs, false);
  assert.equal(sent[0].checkouts, 0);
});

test('starting a visit while one is open sends the open one first', () => {
  const { tracker, sent } = rig();
  tracker.start('sidebar');
  tracker.seen('packs');
  tracker.start('link');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].from, 'sidebar');
  assert.equal(sent[0].saw_packs, true);
  assert.equal(tracker.end().saw_packs, false);
});

test('parts on screen are asked to report again at every start', () => {
  const { tracker } = rig();
  let calls = 0;
  const off = tracker.onStart(() => { calls += 1; tracker.seen('api_plans'); });
  tracker.start('sidebar');
  assert.equal(tracker.end().saw_api_plans, true);
  off();
  tracker.start('sidebar');
  assert.equal(tracker.end().saw_api_plans, false);
  assert.equal(calls, 1);
});

test('a sender that throws never breaks the page', () => {
  const tracker = createPlansVisitTracker({ now: () => 0, send: () => { throw new Error('bridge gone'); } });
  tracker.start('sidebar');
  assert.doesNotThrow(() => tracker.end());
});
