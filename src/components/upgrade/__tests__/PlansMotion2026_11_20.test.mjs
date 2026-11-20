// 2026-11-20: the paywall -> plans hand-off and the startup card's second
// step used to be hard cuts. They go through PlansSwap now, and the plans page
// gives press / hover / label feedback. Guards the motion rules, not pixels.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const swap = read('../PlansSwap.tsx');
const plans = read('../UnlockProPlans.tsx');
const toaster = read('../../onboarding/PlansToaster.tsx');
const pi = read('../../ProfileIntelligenceSettings.tsx');
const modes = read('../../../../premium/src/ModesSettings.tsx');

test('every paywall hand-off goes through PlansSwap, forward in and back out', () => {
  for (const [name, code] of [['PI', pi], ['Modes', modes]]) {
    assert.ok(code.includes('<PlansSwap swapKey="plans" direction={1}>'), `${name}: plans arrive forward`);
    assert.ok(code.includes('<PlansSwap swapKey="gate" direction={-1}>'), `${name}: the gate returns from the other side`);
    assert.equal((code.match(/<PlansSwap /g) || []).length, (code.match(/<\/PlansSwap>/g) || []).length, `${name}: balanced`);
  }
  assert.ok(toaster.includes('<PlansSwap swapKey={step} direction={1}>'));
});

test('PlansSwap: smooth-out curve, page-slide tokens, overlap not wait, reduced motion kept', () => {
  assert.ok(swap.includes('[0.22, 1, 0.36, 1]'));
  const code = swap.replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /ease-in|easeIn|transition:\s*all/);
  assert.ok(swap.includes('const DURATION = 0.25;') && swap.includes('const TRAVEL = 8;') && swap.includes('const BLUR = 3;'), 'the page-slide tokens: 250 ms, 8 px, 3 px');
  assert.ok(swap.includes('useReducedMotion') && swap.includes('{ opacity: 0 }'), 'reduced motion is opacity only');
  assert.ok(swap.includes('mode="popLayout"') && !swap.includes('mode="wait"'), 'the pages overlap: no empty beat between them');
  assert.match(swap, /opacity: 1,\s*transform: `translate3d\(\$\{-dir/, 'the leaving page stays opaque while it recedes');
  assert.ok(swap.includes('initial={mounted.current ? enter : false}'), 'first paint is not animated, a return is');
});

test('plans page: press scale, card lift, label crossfade; nothing animates "all" or from scale(0)', () => {
  assert.ok(plans.includes("'scale(0.97)'"), 'pressed pill gives');
  assert.ok(plans.includes("'translate3d(0, -3px, 0)'"), 'hovered card lifts');
  assert.ok(plans.includes('<AnimatePresence mode="popLayout" initial={false}>'), 'CTA label crossfades');
  assert.doesNotMatch(plans, /transition:\s*[`'"]all/);
  assert.doesNotMatch(plans, /scale\(0\)/);
  // The press handlers must not replace the hover handlers they sit beside.
  const pressProps = plans.slice(plans.indexOf('const pressProps'), plans.indexOf('// A checkout that opened'));
  assert.doesNotMatch(pressProps, /onBlur|onMouseEnter|onMouseLeave|onFocus/);
});
