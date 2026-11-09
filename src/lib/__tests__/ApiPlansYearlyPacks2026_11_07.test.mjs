// src/lib/__tests__/ApiPlansYearlyPacks2026_11_07.test.mjs
//
// The Plans tab sells yearly API plans (10x monthly, allowance still refills
// monthly) and two one-time Pro packs (hours OR days, whichever runs out
// first). These pin the figures, the checkout links, the odometer's three
// digits, and how a pack or yearly key reads in the usage card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  API_PLAN_PRICES, PRO_PACKS, YEARLY_MONTHS_FREE,
  apiPlanLabel, apiPlanPrice, formatMeetingTime, isPackPlan, packStatus,
} from '../apiPlans.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(__dirname, '..', '..', rel), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const urls = read('config/urls.ts');
const settings = read('components/settings/NativelyApiSettings.tsx');
const settingsCode = stripComments(settings);

test('yearly is ten months of the monthly price on every tier', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(API_PLAN_PRICES).map(([k, v]) => [k, [v.monthly, v.yearly]])),
    { standard: [8, 80], pro: [15, 150], max: [25, 250], ultra: [35, 350] },
  );
  for (const v of Object.values(API_PLAN_PRICES)) assert.equal(v.yearly, v.monthly * 10);
  assert.equal(YEARLY_MONTHS_FREE, 2);
  assert.equal(apiPlanPrice('pro', 'monthly'), '$15');
  assert.equal(apiPlanPrice('ultra', 'yearly'), '$350');
  assert.equal(apiPlanPrice('nope', 'yearly'), null);
});

test('the packs match the server catalog: Light $5 2 h / 7 d, Heavy $10 5 h / 14 d', () => {
  assert.deepEqual(PRO_PACKS.map((p) => [p.id, p.name, p.price, p.hours, p.days]), [
    ['pack_light', 'Light pack', 5, 2, 7],
    ['pack_heavy', 'Heavy pack', 10, 5, 14],
  ]);
});

test('plan names: packs read as "Light pack" / "Heavy pack", the rest capitalised', () => {
  assert.equal(apiPlanLabel('pack_light'), 'Light pack');
  assert.equal(apiPlanLabel('pack_heavy'), 'Heavy pack');
  assert.equal(apiPlanLabel('PACK_HEAVY'), 'Heavy pack');
  assert.equal(apiPlanLabel('pro'), 'Pro');
  assert.equal(apiPlanLabel('ultra'), 'Ultra');
  assert.equal(apiPlanLabel(''), null);
  assert.equal(apiPlanLabel(undefined), null);
  assert.equal(isPackPlan('pack_light'), true);
  assert.equal(isPackPlan('pro'), false);
  assert.equal(isPackPlan(null), false);
});

test('meeting time rounds down to the minute and never shows seconds', () => {
  assert.equal(formatMeetingTime(7200), '2 h');
  assert.equal(formatMeetingTime(4800), '1 h 20 min');
  assert.equal(formatMeetingTime(2759), '45 min');
  assert.equal(formatMeetingTime(59), '0 min');
  assert.equal(formatMeetingTime(-5), '0 min');
  assert.equal(formatMeetingTime(null), '0 min');
});

test('packStatus reads the server packView fields (seconds_*, ends_at, ended)', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  const live = packStatus({
    plan: 'pack_light', seconds_total: 7200, seconds_used: 1800, seconds_left: 5400,
    ends_at: '2026-11-14T12:00:00Z', ended: false, ended_reason: null,
  }, now);
  assert.equal(live.ended, false);
  assert.equal(live.secondsLeft, 5400);
  assert.equal(live.usedPercent, 25);
  assert.equal(live.endsAt, '2026-11-14T12:00:00.000Z');

  // A cached response can outlive the pack: the date alone ends it.
  const lapsed = packStatus({ seconds_total: 7200, seconds_left: 5400, ends_at: '2026-11-01T00:00:00Z', ended: false }, now);
  assert.equal(lapsed.ended, true);
  assert.equal(lapsed.endedReason, 'window_closed');

  const usedUp = packStatus({ seconds_total: 7200, seconds_used: 7200, seconds_left: 0, ends_at: '2026-11-14T12:00:00Z' }, now);
  assert.equal(usedUp.ended, true);
  assert.equal(usedUp.endedReason, 'hours_used');
  assert.equal(usedUp.usedPercent, 100);

  // Hours column absent on the server (migration 031): judged on the date alone.
  const dateOnly = packStatus({ seconds_total: null, seconds_used: null, seconds_left: null, ends_at: '2026-11-14T12:00:00Z', ended: false }, now);
  assert.equal(dateOnly.hoursKnown, false);
  assert.equal(dateOnly.ended, false);
  assert.equal(packStatus(null), null);
});

test('the six new checkout links live in CHECKOUT_URLS under their own names', () => {
  const expected = {
    apiStandardYearly: 'pdt_0NrMWrUcsLyeGzOKbTBvg',
    apiProYearly: 'pdt_0NrMWybuENVytnwJcQqPi',
    apiMaxYearly: 'pdt_0NrMWz1alVbZKPXvGjxz2',
    apiUltraYearly: 'pdt_0NrMWzLKdFcSU6HozUl55',
    packLight: 'pdt_0NrMWztmLVYzyt4L9SQJd',
    packHeavy: 'pdt_0NrMX0EGK6xaJYhsWRIla',
    apiStandard: 'pdt_0NbFixGmD8CSeawb5qvVl',
    apiPro: 'pdt_0NcM6Aw0IWdspbsgUeCLA',
    apiMax: 'pdt_0NcM7JElX4Af6LNVFS1Yf',
    apiUltra: 'pdt_0NcM7rC2kAb69TFKsZnUU',
  };
  for (const [key, id] of Object.entries(expected)) {
    assert.match(urls, new RegExp(`\\b${key}: 'https://checkout\\.dodopayments\\.com/buy/${id}'`), `${key} -> ${id}`);
  }
});

test('the Plans tab reads every checkout link from CHECKOUT_URLS, none hardcoded', () => {
  assert.doesNotMatch(settingsCode, /pdt_0N/, 'a Dodo product id is hardcoded in NativelyApiSettings');
  for (const tier of ['Standard', 'Pro', 'Max', 'Ultra']) {
    assert.ok(settingsCode.includes(`url: CHECKOUT_URLS.api${tier},`), `${tier} monthly`);
    assert.ok(settingsCode.includes(`yearlyUrl: CHECKOUT_URLS.api${tier}Yearly,`), `${tier} yearly`);
  }
  assert.ok(settingsCode.includes('CHECKOUT_URLS.packLight') && settingsCode.includes('CHECKOUT_URLS.packHeavy'));
  assert.ok(settingsCode.includes('const checkoutUrl = yearly ? plan.yearlyUrl : plan.url;'));
});

test('Monthly is the default; a yearly key opens on Yearly and only matches Yearly', () => {
  assert.match(settingsCode, /usageCache\?\.billing_period === 'yearly' \? 'yearly' : 'monthly'/);
  assert.match(settingsCode, /keyCycle === billingCycle/);
  // The switch is Hourly | Monthly | Yearly (2026-11-10): Monthly and Yearly
  // still set billingCycle and tell plans_visit the person switched; Hourly
  // shows the packs in the plans' place.
  assert.match(settingsCode, /<BillingCycleSwitch value=\{plansView\} onChange=\{choosePlansView\} options=\{PLANS_VIEWS\} showNote=\{false\} align="start" \/>/);
  assert.match(settingsCode, /plansVisit\.cycleSwitched\(next\);\s*setBillingCycle\(next\);/);
  assert.match(settingsCode, /const \[packsView, setPacksView\] = useState<boolean>\(\(\) => isPackPlan\(usageCache\?\.plan\)\)/);
  assert.match(settingsCode, /\{packsView \? \([\s\S]*?<ProPacks [\s\S]*?\) : \([\s\S]*?<PlanRail>/);
  const views = stripComments(read('components/ui/BillingCycleSwitch.tsx'));
  assert.match(views, /\{ id: 'hourly', label: 'Hourly' \},\s*\.\.\.BILLING_CYCLES/);
  const sw = stripComments(read('components/ui/BillingCycleSwitch.tsx'));
  assert.match(sw, /role="radiogroup"[\s\S]*?aria-label="Billing"/);
  assert.ok(sw.includes('surface-switch'), "Overlay's two-way switch, not a new control");
  assert.ok(settingsCode.includes("{yearly ? '/ year' : '/ month'}"));
});

test('the odometer takes three-digit prices: $150, $250, $350', () => {
  const src = settings.slice(settings.indexOf('const reelDollars'), settings.indexOf('function RollingPrice'))
    .replace('(label: string): number | null', '(label)');
  const reelDollars = new Function(`${src}; return reelDollars;`)();
  assert.equal(reelDollars('$8'), 8);
  assert.equal(reelDollars('$35'), 35);
  assert.equal(reelDollars('$150'), 150);
  assert.equal(reelDollars('$350'), 350);
  assert.equal(reelDollars('$1000'), null);
  assert.equal(reelDollars('$9.99'), null);
  const roll = settings.slice(settings.indexOf('function RollingPrice'), settings.indexOf('const TIER_SWAP_EASE'));
  assert.ok(roll.includes('Math.floor(shown / 100)'), 'a hundreds reel');
  assert.ok(roll.includes('Math.floor(shown / 10) % 10'), 'the tens reel is the tens digit, not shown / 10');
  assert.ok(roll.includes('leading(shown >= 100, hundreds'), 'the hundreds reel collapses under $100');
  assert.ok(roll.includes('leading(shown >= 10, tens'), 'the tens reel collapses under $10');
});

test('a pack key shows its time left and use-by date, never a monthly reset', () => {
  assert.match(settingsCode, /\{keyIsPack \? \(\s*<SectionLabel[\s\S]*?'Use by'[\s\S]*?Pack usage\s*<\/SectionLabel>/);
  assert.ok(settingsCode.includes('<PackMeetingTime status={keyPack} />'));
  assert.ok(settingsCode.includes("' · renews yearly'"), 'a yearly key says it renews yearly');
  assert.ok(settingsCode.includes('apiPlanLabel(usageData?.plan)'), 'the key badge uses the pack-aware label');
});

test('the managed speech-to-text option is named for the API plan, not the Pro licence', () => {
  const stt = read('config/stt.constants.ts');
  const block = stt.slice(stt.indexOf('natively: {'));
  assert.match(block, /name: 'Natively API',/);
  assert.doesNotMatch(stt, /Natively Pro \(Managed\)/);
});
