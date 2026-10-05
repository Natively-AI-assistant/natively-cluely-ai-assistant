// App.tsx wiring for the permissions card's launch state (source-level: App
// needs a DOM and the Electron bridge). The orchestrator side is
// orchestratorClass.test.mjs ("a slow permission check ...").
//
// permsShown is read from localStorage, so it is known at once. It used to be
// pushed only from inside checkPermissions().then(...). On macOS that check can
// take seconds (the Screen Recording probe races a 5 s deadline), while the card
// fires 2 s after the launcher mounts. Until then the orchestrator held its
// default permsShown=false, so a Mac with everything granted got the card on
// launch, and the card, reading the grants itself, said "You're all set".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.resolve(here, '../../../App.tsx'), 'utf8');

function launchBlock() {
  const start = app.indexOf("const permsShown = localStorage.getItem('natively_perms_shown_v1') === '1';");
  assert.notEqual(start, -1, 'the launch block reads permsShown from localStorage');
  const end = app.indexOf('// Donation status', start);
  assert.notEqual(end, -1);
  return app.slice(start, end);
}

test('permsShown reaches the orchestrator before the permission check is awaited', () => {
  const block = launchBlock();
  const push = block.search(/setOrchestratorUserState\(\{\s*permsShown/);
  const check = block.indexOf('maybeCheck()');
  assert.notEqual(push, -1, 'permsShown is pushed');
  assert.notEqual(check, -1, 'the permission check still runs');
  assert.ok(push < check, 'permsShown must not wait for checkPermissions');
});

test('the check result still decides whether a permission needs attention', () => {
  const block = launchBlock();
  const then = block.slice(block.indexOf('maybeCheck()'));
  assert.match(then, /permissionsNeedAttention: permissionsNeedAttention\(p\)/);
});

// localStorage is per origin, and `npm run dev:agent` serves the renderer on a
// fresh port every launch, so an agent instance starts with empty localStorage
// every time while the profile's settings.json still says the card was seen.
// The same holds for any user whose localStorage is lost. The profile flag used
// to be copied into localStorage only, after the launch push had already told
// the orchestrator "never seen", so the card opened and said "You're all set".
test('the profile flag that the card was seen reaches the orchestrator too', () => {
  const start = app.indexOf('// 4. permsShown');
  assert.notEqual(start, -1);
  const seenBranch = app.slice(start, app.indexOf('} else {', start));
  assert.match(seenBranch, /if \(flags\.permsShown\)/);
  assert.match(seenBranch, /setOrchestratorUserState\(\{ permsShown: true \}\)/);
});
