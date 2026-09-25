/**
 * TrialUnlocksProSurfaces2026_09_25.test.mjs
 *
 * Activating the free trial left both Pro managers locked.
 *
 *   • Profile Intelligence hardcoded `const [isTrialActive] = useState(false)`,
 *     so `hasProfileAccess = isPremium || isTrialActive` could never be true for
 *     a trial user — every surface in the panel showed the Unlock-Pro gate even
 *     though main's own `isProOrTrialActive()` would have served all of them.
 *   • Modes already took the flag as a prop, but App only ever learned about a
 *     trial by reading the local token ON MOUNT. A trial claimed mid-session
 *     (settings card or promo toaster) never reached `activeTrial`, so the prop
 *     stayed false — and the countdown banner never appeared either.
 *
 * Source-level (`node --test`, no JSX renderer in this repo — see
 * TrialPromoToaster.test.mjs for the same constraint). The main-process half of
 * this fix is executed for real in
 * electron/services/__tests__/TrialActivationRuntimeSync2026_09_25.test.mjs.
 *
 * Run: node --test src/components/__tests__/TrialUnlocksProSurfaces2026_09_25.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(__dirname, rel), 'utf8');
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const app = read('../../App.tsx');
const appCode = stripComments(app);
const pi = read('../ProfileIntelligenceSettings.tsx');
const piCode = stripComments(pi);
// Private submodule: fork PRs build without it (Build Smoke's "core" scope), so
// the one assertion that reads it skips there instead of failing the file.
const MODES_PATH = resolve(__dirname, '../../../premium/src/ModesSettings.tsx');
const modesCode = existsSync(MODES_PATH) ? stripComments(readFileSync(MODES_PATH, 'utf8')) : null;
const overlay = read('../NativelyInterface.tsx');
const overlayCode = stripComments(overlay);

// The body of a `window.electronAPI?.xxx?.(cb)` subscription in App.tsx. Sliced
// to the matching close brace rather than the first `});` — an inner
// `setActiveTrial({ … });` carries that token and would cut the body in half,
// hiding exactly the lines these tests are here to check.
function handlerBody(marker) {
  const start = appCode.indexOf(marker);
  assert.ok(start >= 0, `subscription not found: ${marker}`);
  const open = appCode.indexOf('{', appCode.indexOf('=>', start));
  let depth = 0;
  for (let i = open; i < appCode.length; i++) {
    if (appCode[i] === '{') depth++;
    else if (appCode[i] === '}' && --depth === 0) return appCode.slice(open, i + 1);
  }
  throw new Error(`unbalanced callback body for ${marker}`);
}

describe('Profile Intelligence takes the trial flag from App', () => {
  test('isTrialActive is a prop, not local state pinned to false', () => {
    assert.ok(
      /isTrialActive\?\s*:\s*boolean/.test(piCode),
      'ProfileIntelligenceSettings must declare isTrialActive in its props type',
    );
    assert.ok(
      !/\[\s*isTrialActive\s*(,[^\]]*)?\]\s*=\s*useState/.test(piCode),
      'isTrialActive must not come from local state again — that is the bug (it was pinned to false)',
    );
  });

  test('access is granted by a licence OR a trial', () => {
    assert.ok(
      /const\s+hasProfileAccess\s*=\s*isPremium\s*\|\|\s*isTrialActive/.test(piCode),
      'the panel-wide gate must accept a trial',
    );
  });

  test('every gated surface reads that one flag, not isPremium directly', () => {
    // A surface re-deriving the gate from isPremium alone would re-open the bug
    // on that surface only, which is exactly how it would come back.
    const gatedProps = piCode.match(/hasAccess=\{[^}]*\}/g) ?? [];
    assert.ok(gatedProps.length > 0, 'expected the gated sub-cards to take a hasAccess prop');
    for (const prop of gatedProps) {
      assert.equal(
        prop,
        'hasAccess={hasProfileAccess}',
        `a gated surface bypasses the shared gate: ${prop}`,
      );
    }
  });
});

describe('App owns the trial flag and hands it to both managers', () => {
  test('Modes still receives it', () => {
    assert.ok(
      /<ModesSettings[\s\S]{0,400}?isTrialActive=\{!!activeTrial\}/.test(appCode),
      'ModesSettings must keep receiving isTrialActive',
    );
  });

  test('Profile Intelligence now receives it too', () => {
    assert.ok(
      /<ProfileIntelligenceSettings[\s\S]{0,400}?isTrialActive=\{!!activeTrial\}/.test(appCode),
      'ProfileIntelligenceSettings must receive isTrialActive — without it the panel defaults to locked',
    );
  });

  test('ModesSettings honours the prop it is given', { skip: modesCode === null && 'premium submodule not checked out' }, () => {
    assert.ok(
      /const\s+hasProAccess\s*=\s*isPremium\s*\|\|\s*isTrialActive/.test(modesCode),
      'the premium submodule must keep gating on licence-or-trial',
    );
  });
});

describe('A trial claimed mid-session reaches App without a relaunch', () => {
  test('App subscribes to trial-started', () => {
    assert.ok(
      /onTrialStarted\?\.\(/.test(appCode),
      'App must subscribe to onTrialStarted; reading the local token on mount alone misses a trial started later',
    );
  });

  test('the handler sets activeTrial from the event payload', () => {
    const handler = handlerBody('onTrialStarted?.(');
    assert.ok(handler.includes('setActiveTrial('), 'the event must set activeTrial — that is what both managers read');
    assert.ok(handler.includes('data?.expiresAt'), 'the countdown needs the expiry carried by the event');
  });

  test('the subscription is torn down with the others', () => {
    assert.ok(
      /removeTrialStartedListener/.test(appCode) &&
        appCode.match(/removeTrialStartedListener/g).length >= 2,
      'the listener must be both created and removed',
    );
  });

  test('the status poll starts for a mid-session trial, and only once', () => {
    const handler = handlerBody('onTrialStarted?.(');
    assert.ok(
      /if\s*\(!trialPollId\)/.test(handler),
      'the poll must be guarded — a second interval would be the only thing watching for expiry, twice',
    );
    assert.ok(handler.includes('setInterval(checkTrial'), 'a trial started mid-session must poll for its own expiry');
  });

  test('trial-ended stops the poll it started', () => {
    const ended = handlerBody('onTrialEnded?.(');
    assert.ok(
      ended.includes('clearInterval(trialPollId)'),
      'ending the trial must stop the poll, or it keeps hitting /v1/trial/status forever',
    );
  });
});

describe("the overlay's model chip can name the managed route", () => {
  // The other half of "the meeting overlay still says Gemini". Once the trial
  // moves the model to 'natively', sendModelChanged makes the chip re-read —
  // but LLMHelper.getCurrentModelDisplayName() returns that id VERBATIM, so the
  // chip's displayName branch is skipped (displayName === the id) and it used to
  // fall through to `return m` and render a lowercase "natively".
  test('the chip has a natively branch', () => {
    assert.ok(
      /m === 'natively'\)\s*return\s*'Natively API'/.test(overlayCode),
      "the chip must name 'natively' — with no branch it renders the raw lowercase id",
    );
  });

  test('that branch sits ABOVE the displayName fallback, which cannot name it', () => {
    const branch = overlayCode.indexOf("m === 'natively'");
    const displayNameFallback = overlayCode.indexOf('currentModelDisplayName && currentModelDisplayName !== m');
    assert.ok(branch >= 0 && displayNameFallback >= 0, 'both branches must exist in the chip');
    assert.ok(
      branch < displayNameFallback,
      'ordering matters here the same way it does for the LiteLLM and 9Router branches above it',
    );
  });

  test('it matches what the picker and the settings rows already call it', () => {
    const picker = read('../ui/ModelSelector.tsx');
    assert.ok(
      picker.includes("id: 'natively', name: 'Natively API'"),
      'the chip label must stay in step with the model picker',
    );
  });
});
