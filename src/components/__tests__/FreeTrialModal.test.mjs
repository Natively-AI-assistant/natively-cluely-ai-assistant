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

test('every plan opens its checkout and records the conversion', () => {
  for (const id of ['pdt_0NbFixGmD8CSeawb5qvVl', 'pdt_0NcM6Aw0IWdspbsgUeCLA', 'pdt_0NcM7JElX4Af6LNVFS1Yf', 'pdt_0NcM7rC2kAb69TFKsZnUU']) {
    assert.ok(source.includes(id), `checkout ${id} missing`);
  }
  const handle = source.slice(source.indexOf('const handlePlan'), source.indexOf('const handleByok'));
  assert.ok(handle.includes('convertTrial?.(key)'));
  assert.ok(handle.includes("key === 'standard' && onStandard"), 'Standard still runs its own hook');
  assert.ok(handle.includes('openExternal?.(url)'));
});

test('BYOK wipes, then shows done; a failure returns to the choice with an error', () => {
  const byok = source.slice(source.indexOf('const handleByok'), source.indexOf('const sttMin'));
  assert.ok(byok.indexOf("setStep('wiping')") < byok.indexOf('await onByok()'));
  assert.ok(byok.indexOf('await onByok()') < byok.indexOf("setStep('done')"));
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
