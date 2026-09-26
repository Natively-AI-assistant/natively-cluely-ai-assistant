// The card inputs notice quota mid-session (toaster policy Phase 3, spec §6
// row 18). Usage was read only at launch and on credential / licence /
// extension changes, so a Pro user who crossed 80 % during the day never met
// the Max/Ultra card before a relaunch. The launcher re-reads the inputs when
// it regains focus, at most every 5 minutes (main caches /usage for 60 s).
//
// More triggers mean more overlapping refreshes, and one that includes the
// /usage network call can land after a newer one: only the latest refresh may
// write (final review minor #8, folded in here).
//
// Source assertions: App's effect is not unit-renderable here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(here, '..', '..', 'App.tsx'), 'utf8');
const effect = app.slice(app.indexOf('const refreshCardInputsRef'), app.indexOf('}, [isLauncherWindow, isDefault]);', app.indexOf('const refreshCardInputsRef')));

test('the launcher re-reads the card inputs on focus, at most every 5 minutes', () => {
  assert.ok(app.includes('const CARD_INPUTS_FOCUS_REFRESH_MS = 5 * 60_000;'));
  assert.ok(effect.includes("window.addEventListener('focus', onFocus);"));
  assert.ok(effect.includes("window.removeEventListener('focus', onFocus);"), 'and lets go on unmount');
  assert.ok(effect.includes('if (now - lastFocusRefresh < CARD_INPUTS_FOCUS_REFRESH_MS) return;'));
});

test('only the latest refresh writes', () => {
  assert.ok(effect.includes('const mine = ++refreshSeq;'));
  assert.ok(effect.includes('if (disposed || mine !== refreshSeq) return;'));
});
