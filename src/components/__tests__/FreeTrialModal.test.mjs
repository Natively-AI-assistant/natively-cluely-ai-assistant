/**
 * FreeTrialModal.test.mjs
 *
 * Source-level tests for the end-of-trial card (`node --test`, no JSX renderer,
 * so the component is read as text): the four checkout paths and BYOK still
 * work, allowances come from the plan catalog, and it follows the toaster
 * family's design contract.
 *
 * Run: node --test src/components/__tests__/FreeTrialModal.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, '../trial/FreeTrialModal.tsx'), 'utf8');
const rendered = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[^\n]*?\/\/[^\n]*$/gm, '');

const urls = readFileSync(resolve(__dirname, '../../config/urls.ts'), 'utf8');
/** The Dodo product id a CHECKOUT_URLS key points at. */
const productOf = (key) => new RegExp(`\\b${key}: 'https://checkout\\.dodopayments\\.com/buy/(pdt_[A-Za-z0-9]+)'`).exec(urls)?.[1];

test('every plan opens its checkout and records the conversion', () => {
  // The links come from config/urls.ts, monthly and yearly, never a product id here.
  assert.doesNotMatch(rendered, /pdt_0N/, 'a product id is hardcoded in the card');
  const expected = {
    apiStandard: 'pdt_0NbFixGmD8CSeawb5qvVl', apiPro: 'pdt_0NcM6Aw0IWdspbsgUeCLA',
    apiMax: 'pdt_0NcM7JElX4Af6LNVFS1Yf', apiUltra: 'pdt_0NcM7rC2kAb69TFKsZnUU',
    apiStandardYearly: 'pdt_0NrMWrUcsLyeGzOKbTBvg', apiProYearly: 'pdt_0NrMWybuENVytnwJcQqPi',
    apiMaxYearly: 'pdt_0NrMWz1alVbZKPXvGjxz2', apiUltraYearly: 'pdt_0NrMWzLKdFcSU6HozUl55',
    packLight: 'pdt_0NrMWztmLVYzyt4L9SQJd', packHeavy: 'pdt_0NrMX0EGK6xaJYhsWRIla',
  };
  for (const [key, id] of Object.entries(expected)) {
    assert.equal(productOf(key), id, `CHECKOUT_URLS.${key}`);
    assert.ok(rendered.includes(`CHECKOUT_URLS.${key}`), `the card never offers CHECKOUT_URLS.${key}`);
  }
  for (const tier of ['Standard', 'Pro', 'Max', 'Ultra']) {
    assert.match(rendered, new RegExp(`url: CHECKOUT_URLS\\.api${tier},\\s*yearlyUrl: CHECKOUT_URLS\\.api${tier}Yearly`), `${tier}: monthly and yearly links`);
  }
  const handle = source.slice(source.indexOf('const handlePlan'), source.indexOf('const handleByok'));
  assert.ok(handle.includes('convertTrial?.(key)'));
  assert.ok(handle.includes("key === 'standard' && onStandard"), 'Standard still runs its own hook');
  // The surface rides along so a purchase can be tied back to this card (funnel).
  assert.ok(handle.includes("openExternal?.(url, { surface: 'trial_card' })"));
});

test('BYOK wipes, then shows done; a failure returns to the choice with an error', () => {
  const byok = source.slice(source.indexOf('const handleByok'), source.indexOf('const sttMin'));
  assert.ok(byok.indexOf("setStep('wiping')") < byok.indexOf('await onByok(opts)'));
  assert.ok(byok.indexOf('await onByok(opts)') < byok.indexOf("setStep('done')"));
  assert.ok(byok.includes('setError(') && byok.includes("setStep('choose')"));
  assert.ok(rendered.includes('role="alert"'));
});

test('tiers read as a multiple of Standard, from the catalog when it has arrived', () => {
  assert.ok(rendered.includes('timesStandard(plans?.[key], plans?.standard) ?? times'));
  assert.ok(rendered.includes('plans?.[key]?.price_usd ?? price'));
  assert.ok(!/\d[\d,]* (AI answers|searches)/.test(rendered), 'no hardcoded allowance copy');
});

test('timesStandard: the smaller ratio, rounded down to the half', () => {
  const fn = source.slice(source.indexOf('function timesStandard'), source.indexOf('function planGist'))
    .replace(/: NativelyPlanLimits \| undefined/g, '')
    .replace(/\): number \| null \{/, ') {');
  const timesStandard = new Function(`${fn}; return timesStandard;`)();
  const std = { ai_tokens: 3e6, transcription_minutes: 300 };
  assert.equal(timesStandard({ ai_tokens: 6.5e6, transcription_minutes: 700 }, std), 2);
  assert.equal(timesStandard({ ai_tokens: 10e6, transcription_minutes: 1000 }, std), 3);
  assert.equal(timesStandard({ ai_tokens: 14e6, transcription_minutes: 1500 }, std), 4.5);
  assert.equal(timesStandard(undefined, std), null);
  assert.equal(timesStandard({ ai_tokens: 1, transcription_minutes: 1 }, undefined), null);
});

test('dialog semantics point at elements that exist', () => {
  assert.ok(rendered.includes("role: 'dialog'") && rendered.includes("'aria-modal': true"));
  assert.ok(rendered.includes("'aria-labelledby': 'trial-end-title'") && rendered.includes('id="trial-end-title"'));
  assert.ok(rendered.includes("'aria-describedby': 'trial-end-desc'") && rendered.includes('id="trial-end-desc"'));
});

test('opens and closes through GenieModal; the done step closes before reporting', () => {
  assert.ok(rendered.includes('<GenieModal') && rendered.includes('open={open}'));
  assert.ok(rendered.includes('keepPictures={false}'), 'usage figures are per-trial, never a kept picture');
  // onDone now reports WHY the card closed. Closing it is not the same as
  // ending the trial: this card is also opened mid-trial from "See your
  // options", where the host must keep the trial alive on a plain dismiss.
  assert.ok(
    rendered.includes("onClosed={() => onDone?.(endedRef.current ? 'byok' : 'dismissed')}"),
    'the close must report whether the trial was actually ended',
  );
  assert.ok(rendered.includes('onClick={() => setOpen(false)}'));
});

test('toaster family: flat ground, hourglass panel, neutral outlined CTA, no glow or blur', () => {
  assert.ok(rendered.includes("background: isLight ? '#F7F8FC' : '#1C1C1E'"));
  assert.ok(source.includes("import timerArt from '../../assets/cards/timer.jpg'"));
  assert.ok(!/#8B5CF6|#7C3AED|#A78BFA|#6D28D9/i.test(rendered), 'no violet left in the chrome');
  assert.ok(!/backdropFilter|backdrop-blur|fm-ring|feTurbulence/.test(rendered), 'no ring, grain or blur');
  assert.ok(!/textTransform:\s*'uppercase'/.test(rendered), 'no tracked-out caps');
  for (const glyph of ['—', '–']) assert.ok(!rendered.includes(glyph), `rendered copy contains ${glyph}`);
});

test('Monthly / Yearly: the shared switch, Monthly by default, yearly price and link', () => {
  assert.ok(rendered.includes("import { BillingCycleSwitch } from '../ui/BillingCycleSwitch';"));
  assert.ok(rendered.includes("useState<BillingCycle>('monthly')"), 'Monthly by default');
  assert.ok(rendered.includes('<BillingCycleSwitch value={cycle} onChange={setCycle}'));
  assert.ok(rendered.includes('const url = yearly ? yearlyUrl : monthlyUrl;'));
  assert.ok(rendered.includes('plans?.[key]?.price_usd_yearly ?? yearlyPrice'), 'the yearly price prefers the catalog too');
  assert.ok(rendered.includes("const per = yearly ? 'yr' : 'mo';"));
  // The main button follows the switch as well.
  assert.ok(rendered.includes("handlePlan('pro', yearly ? CHECKOUT_URLS.apiProYearly : CHECKOUT_URLS.apiPro)"));
});

test('the packs open their checkout on the trial surface and are not reported as a tier choice', () => {
  const pack = source.slice(source.indexOf('const handlePack'), source.indexOf('// Funnel: this card appeared'));
  assert.ok(pack.includes("openExternal?.(url, { surface: 'trial_card' })"));
  // /v1/trial/convert accepts byok / standard / pro / max / ultra only.
  assert.ok(!pack.includes('convertTrial'), 'a pack is not a trial conversion choice');
  assert.ok(rendered.includes('PRO_PACKS.map'));
  assert.ok(rendered.includes('onClick={() => handlePack(PACK_URLS[p.id])}'));
  assert.match(rendered, /PACK_URLS[^=]*= \{ pack_light: CHECKOUT_URLS\.packLight, pack_heavy: CHECKOUT_URLS\.packHeavy \}/);
});
