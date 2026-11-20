// 2026-11-20: leaving the startup Plans card shows the $5 Light pack once, as
// "Start smaller". It must stay honest: no struck price, no sale, no urgency.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const toaster = fs.readFileSync(new URL('../PlansToaster.tsx', import.meta.url), 'utf8');
const plans = fs.readFileSync(new URL('../../upgrade/UnlockProPlans.tsx', import.meta.url), 'utf8');
const exitTier = plans.slice(plans.indexOf('function buildExitTier'), plans.indexOf("/** The website's CTA arrow"));

test('the first way out shows the exit card, the second really closes', () => {
  const fn = toaster.slice(toaster.indexOf('const handleDismiss'), toaster.indexOf('// A checkout opened'));
  assert.ok(fn.includes("if (step === 'plans') { setStep('exit'); return; }"));
  assert.ok(fn.includes('closeThen(() => onDismiss())'));
  assert.ok(toaster.includes("if (isOpen) setStep('plans');"), 'a reopened card starts on the plans');
  assert.ok(toaster.includes('variant="exit"'));
});

test('the exit card is the Light pack alone, from the same checkout, and not worded as a discount', () => {
  assert.ok(exitTier.includes("id: 'pack_light'") && exitTier.includes('url: CHECKOUT_URLS.packLight'));
  assert.ok(exitTier.includes('was: null'), 'no struck price');
  const noComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(noComments(exitTier + toaster), /\b(sale|off|discount|limited|last chance|hurry|only today|expires?)\b/i);
});

test('the exit variant hides the pricing-page link and fits one card', () => {
  assert.ok(plans.includes('{!exit && <motion.p'));
  assert.ok(plans.includes('repeat(${tiers.length}, 1fr)'));
});
