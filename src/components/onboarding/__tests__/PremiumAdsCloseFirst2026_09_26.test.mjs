// The four premium ads play their close before the host hears about it
// (toaster policy Phase 2, final review #5).
//
// OrchestratedToasterHost returns null the moment a card reports onDismiss,
// which unmounts it mid-genie: the card and scrim just vanished. Every close
// that is not a hand-over (✕, Escape, backdrop, decline, "I'm happy with
// Pro", a Max/Ultra plan) now closes the card first and reports from
// GenieModal's onClosed, the contract SupportToaster and
// BrowserExtensionToaster already follow. Hand-overs to another surface
// (Settings, the Profile/JD manager) stay instant: closeInstantly skips the
// genie there by design.
//
// Source assertions: premium is an optional submodule and its cards are not
// rendered in this suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PREMIUM = resolve(here, '../../../../premium/src');
const skip = !existsSync(PREMIUM) && 'premium not checked out';
const code = (name) => readFileSync(resolve(PREMIUM, `${name}.tsx`), 'utf8');

const ADS = ['ProfileFeatureToaster', 'JDAwarenessToaster', 'MaxUltraUpgradeToaster', 'NativelyApiPromoToaster'];

for (const name of ADS) {
  test(`${name}: a plain close plays the genie, then reports`, { skip }, () => {
    const src = code(name);
    assert.ok(/const handleDismiss = \(\) => \{ stamp\(\); closeThen\(\(\) => onDismiss\(\)\); \};/.test(src), 'handleDismiss closes first');
    assert.ok(src.includes('const closeThen = (report: () => void) => {'), 'one close-then-report helper');
    assert.ok(/onClosed=\{\(\) => \{[^}]*reportClosed\(\)/.test(src), 'reports from GenieModal onClosed');
    // No plain dismiss reaches the host directly.
    assert.equal((src.match(/[^>] onDismiss\(\);/g) || []).length, 0, 'no direct onDismiss()');
  });
}

test('MaxUltraUpgradeToaster: "I\'m happy with Pro" and a plan close first', { skip }, () => {
  const src = code('MaxUltraUpgradeToaster');
  assert.ok(src.includes("const handleHappyWithPro = () => { stamp(); closeThen(() => onDismiss('never')); };"));
  const plan = src.slice(src.indexOf('const handlePlan'), src.indexOf('useEffect(', src.indexOf('const handlePlan')));
  assert.ok(plan.includes("closeThen(() => onDismiss('acted'));"), 'the plan reports once the card has gone');
  assert.ok(plan.indexOf('openExternal') < plan.indexOf('closeThen('), 'checkout opens at once, not after the genie');
});

test('NativelyApiPromoToaster: the decline closes first', { skip }, () => {
  assert.ok(code('NativelyApiPromoToaster').includes("const handleDecline = () => { stamp(); closeThen(() => onDismiss('never')); };"));
});

test('hand-overs stay instant', { skip }, () => {
  assert.ok(code('NativelyApiPromoToaster').includes("setHandingOver(true); onDismiss('acted'); onOpenSettings('natively-api');"));
  assert.ok(code('MaxUltraUpgradeToaster').includes("setHandingOver(true); onDismiss('acted'); onUpgrade();"));
  for (const name of ['ProfileFeatureToaster', 'JDAwarenessToaster']) {
    const act = code(name).slice(code(name).indexOf('const handleAction'));
    assert.ok(act.slice(0, 200).includes("setHandingOver(true);\n    onDismiss('acted');") || act.slice(0, 200).includes("setHandingOver(true);\n        onDismiss('acted');"), name);
  }
});
