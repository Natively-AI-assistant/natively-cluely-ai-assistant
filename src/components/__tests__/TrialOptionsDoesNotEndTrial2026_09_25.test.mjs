/**
 * TrialOptionsDoesNotEndTrial2026_09_25.test.mjs
 *
 * "See your options" on the ACTIVE-trial card in Plans & Billing ended the trial
 * on the spot, with minutes still on the clock.
 *
 * It opened FreeTrialModal — the POST-trial card. Three things then happened, in
 * this order of severity:
 *
 *   1. `handleTrialDone` ran `setTrialState(null)` on EVERY close. GenieModal's
 *      `onClosed` fires for a dismissal exactly as it does after a wipe, so
 *      closing the card removed the active-trial card and its countdown. The
 *      trial was still live server-side (the API only refuses a trial once
 *      `converted_to === 'byok'`), but the app no longer showed one.
 *   2. The card said "Natively trial ended" / "That was the trial." while the
 *      trial was running.
 *   3. The choose step had NO dismissal — no close control and no backdrop
 *      handler. The only exits were a plan tile (opens a browser tab, card
 *      stays) and "Use my own API keys", which really does end the trial. There
 *      was no way to look at the options and go back.
 *
 * The expired path must be untouched: that card is terminal on purpose.
 *
 * Run: node --test src/components/__tests__/TrialOptionsDoesNotEndTrial2026_09_25.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(__dirname, rel), 'utf8');
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const modal = stripComments(read('../trial/FreeTrialModal.tsx'));
const settings = stripComments(read('../settings/NativelyApiSettings.tsx'));
const app = stripComments(read('../../App.tsx'));

describe('closing the options card does not end the trial', () => {
  test('the host only clears its trial state on a deliberate BYOK exit', () => {
    const fn = settings.slice(
      settings.indexOf('const handleTrialDone'),
      settings.indexOf('};', settings.indexOf('const handleTrialDone')) + 2,
    );
    assert.ok(fn.includes("reason === 'byok'"), 'the host must branch on WHY the card closed');
    assert.ok(
      /if\s*\(reason === 'byok'\)\s*setTrialState\(null\)/.test(fn),
      'setTrialState(null) must be reached only by the byok branch — unconditionally is the bug',
    );
    assert.ok(fn.includes('setShowTrialModal(false)'), 'the card still closes either way');
  });

  test('the modal reports which of the two happened', () => {
    assert.ok(
      modal.includes("onClosed={() => onDone?.(endedRef.current ? 'byok' : 'dismissed')}"),
      'onClosed fires for both a wipe and a dismissal, so it has to say which',
    );
    assert.ok(
      /endedRef\.current = true;\s*setStep\('done'\)/.test(modal),
      'only a COMPLETED onByok may mark the trial ended — a failed wipe returns to the choose step',
    );
  });

  test('a failed BYOK does not report the trial as ended', () => {
    const handler = modal.slice(modal.indexOf('const handleByok'), modal.indexOf('};', modal.indexOf('const handleByok')));
    const ended = handler.indexOf('endedRef.current = true');
    const katch = handler.indexOf('catch');
    assert.ok(ended >= 0 && katch >= 0 && ended < katch, 'the flag is set in the try, after await onByok()');
    assert.ok(
      !handler.slice(katch).includes('endedRef.current = true'),
      'the catch branch must leave the trial alive',
    );
  });
});

describe('the card tells the truth while the trial is running', () => {
  test('it takes the expiry as an opt-in prop', () => {
    assert.ok(/activeTrialExpiresAt\?\s*:\s*string/.test(modal), 'the active variant must be opt-in');
    assert.ok(modal.includes('const isActiveTrial = !!activeTrialExpiresAt'), 'one flag drives every variant branch');
  });

  test('no "trial ended" copy while minutes remain', () => {
    for (const [dead, live] of [
      ["'Natively trial ended'", "'Natively free trial'"],
      ["'That was the trial.'", "'Your options.'"],
    ]) {
      assert.ok(modal.includes(dead), `the expired copy ${dead} must survive for the expired card`);
      assert.ok(modal.includes(live), `the live trial needs its own copy, not ${dead}`);
      assert.ok(
        new RegExp(`isActiveTrial \\?\\s*${live.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*${dead.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(modal),
        `${live} and ${dead} must be the two arms of one isActiveTrial choice`,
      );
    }
  });

  test('the countdown comes from the one shared clock, not a second copy', () => {
    assert.ok(
      modal.includes("import { useTrialRemaining } from './useTrialRemaining'"),
      'the modal reads the same hook the active-trial card does',
    );
    assert.ok(
      settings.includes("import { useTrialRemaining } from '../trial/useTrialRemaining'"),
      'the settings panel imports it too — it may not keep a private copy, or the two clocks drift',
    );
    assert.ok(
      !/function useTrialRemaining/.test(settings),
      'the local definition must be gone; NativelyApiSettings imports FreeTrialModal, so the modal cannot import back',
    );
  });

  test('the BYOK button says it ends the trial', () => {
    assert.ok(
      /isActiveTrial \? 'End trial, use my own keys' : 'Use my own API keys'/.test(modal),
      'the one deliberate way to end a live trial must name what it does',
    );
  });
});

describe('there is a way out that is not "end my trial"', () => {
  test('a close control, on the choose step only', () => {
    assert.ok(
      /isActiveTrial && step === 'choose' &&/.test(modal),
      'the dismissal is scoped: mid-wipe there is nothing to cancel, and the done step has its own button',
    );
    assert.ok(modal.includes('aria-label="Close"'), 'the control must be reachable by name');
    assert.ok(modal.includes('onClick={dismiss}'), 'and it must actually close the card');
  });

  test('the backdrop dismisses too, but only while the trial is live', () => {
    assert.ok(
      modal.includes('onBackdropClick={isActiveTrial ? dismiss : undefined}'),
      'the expired card stays terminal — undefined, not a handler',
    );
  });
});

describe('the expired path is untouched', () => {
  test('the settings host passes the expiry only while the trial is active', () => {
    assert.ok(
      /activeTrialExpiresAt=\{trialState\.active \? trialState\.expiresAt : undefined\}/.test(settings),
      'an expired trialState must leave the prop undefined',
    );
  });

  test("App's expiry modal never opts in", () => {
    const mount = app.slice(app.indexOf('<FreeTrialModal'), app.indexOf('/>', app.indexOf('<FreeTrialModal')));
    assert.ok(mount.length > 0, "App's FreeTrialModal mount not found");
    assert.ok(
      !mount.includes('activeTrialExpiresAt'),
      'the post-expiry card is deliberately terminal and must keep the original shape',
    );
  });
});

describe('the panel follows main when main ends the trial', () => {
  // Buying (a real key stored) and the BYOK exit both end the trial in MAIN.
  // This panel kept its own trialState, so it went on rendering "Free trial
  // active" with a live countdown beside the key that had just superseded it.
  test('it subscribes to trial-ended', () => {
    assert.ok(
      /onTrialEnded\?\.\(/.test(settings),
      'the panel cannot rely on its own handlers alone — main ends the trial on paths this panel does not drive',
    );
  });

  test('and drops the trial state AND its poll', () => {
    const start = settings.indexOf('onTrialEnded?.(');
    const open = settings.indexOf('{', settings.indexOf('=>', start));
    let depth = 0, body = '';
    for (let i = open; i < settings.length; i++) {
      if (settings[i] === '{') depth++;
      else if (settings[i] === '}' && --depth === 0) { body = settings.slice(open, i + 1); break; }
    }
    assert.ok(body.includes('setTrialState(null)'), 'the active-trial card must go');
    assert.ok(
      body.includes('clearInterval(trialPollRef.current)'),
      'and its 15s status poll with it, or it keeps hitting /v1/trial/status for a trial that is over',
    );
  });
});
