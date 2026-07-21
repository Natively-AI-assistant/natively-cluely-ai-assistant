import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../../electron/main.ts');
const mainSource = readFileSync(mainPath, 'utf8');

function extractIfElseBlock(needle) {
  const idx = mainSource.indexOf(needle);
  assert.ok(idx >= 0, `could not locate ${needle}`);
  let i = mainSource.indexOf('{', idx);
  let depth = 1;
  i++;
  while (i < mainSource.length && depth > 0) {
    const ch = mainSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  // continue into the following `else { ... }` block if present
  const afterIf = mainSource.slice(i, i + 50);
  if (/^\s*else\s*\{/.test(afterIf)) {
    const elseStart = mainSource.indexOf('{', i);
    depth = 1;
    let j = elseStart + 1;
    while (j < mainSource.length && depth > 0) {
      const ch = mainSource[j];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      j++;
    }
    return mainSource.slice(idx, j);
  }
  return mainSource.slice(idx, i);
}

test('non-stealth cold launch stays on accessory until the disguised window is painted', () => {
  const ifBlock = extractIfElseBlock('if (isUndetectableOnStartup)');
  assert.ok(
    /setActivationPolicy\s*\(\s*['"]accessory['"]\s*\)/.test(ifBlock),
    'BUG: non-stealth whenReady branch must move to accessory, not regular, before window creation.',
  );
  assert.ok(
    !/setActivationPolicy\s*\(\s*['"]regular['"]\s*\)/.test(ifBlock),
    'BUG: non-stealth whenReady branch must not promote to regular before the disguised name/icon is painted.',
  );
  assert.ok(
    /app\.dock\.hide\s*\(\s*\)/.test(ifBlock),
    'BUG: stealth whenReady branch must call app.dock.hide().',
  );

  const whenReadyIndex = mainSource.indexOf('await app.whenReady()');
  const disguiseIndex = mainSource.indexOf('appState.applyInitialDisguise();');
  const createWindowIndex = mainSource.indexOf('appState.createWindow()');
  const promoteIndex = mainSource.indexOf("setActivationPolicy('regular')", disguiseIndex);

  assert.ok(whenReadyIndex >= 0 && disguiseIndex >= 0 && createWindowIndex >= 0 && promoteIndex >= 0,
    'could not locate expected startup landmarks');

  assert.ok(whenReadyIndex < disguiseIndex, 'sanity: whenReady before applyInitialDisguise');
  assert.ok(disguiseIndex < createWindowIndex, 'sanity: applyInitialDisguise before createWindow');
  assert.ok(
    createWindowIndex < promoteIndex,
    'BUG: setActivationPolicy(regular) must run AFTER appState.createWindow() so the dock tile and window appear together.',
  );

  const pre = mainSource.slice(whenReadyIndex, createWindowIndex);
  assert.ok(
    !/setActivationPolicy\s*\(\s*['"]regular['"]\s*\)/.test(pre),
    'BUG: setActivationPolicy(regular) must not be invoked before appState.createWindow().',
  );

  const promotionRegion = mainSource.slice(createWindowIndex, promoteIndex + 200);
  assert.ok(
    /process\.platform\s*===\s*['"]darwin['"][\s\S]*!\s*appState\.getUndetectable\s*\(\s*\)/.test(promotionRegion),
    'BUG: post-window promotion must be gated on darwin && !undetectable so stealth mode never promotes to regular.',
  );
});

test('runtime setDisguise applies the rename WITHOUT churning activation policy', () => {
  // Runtime disguise switching must NOT bracket the rename in accessory→regular.
  // The dual-dock-icon bug is a STARTUP-only phenomenon (born tile → rename →
  // LaunchServices re-registration races a 2nd tile), already handled by
  // LSUIElement + the one-shot startup promotion. At runtime the app owns one
  // stable 'regular' tile and app.setName() updates it in place. The old runtime
  // bracket round-tripped activation policy, which deactivates the whole app for
  // a tick — the always-on-top overlay/launcher windows leave the foreground
  // layer and snap back, producing a visible disappear/reappear flicker on every
  // disguise switch. The bracket has been removed; this test locks that in so it
  // is not "helpfully" reintroduced.
  const body = extractIfElseBlock('public setDisguise(');

  // It must still actually apply the disguise.
  assert.ok(
    body.includes('_applyDisguise(mode)'),
    'sanity: setDisguise must call _applyDisguise(mode).',
  );

  // And it must NOT touch activation policy — neither accessory nor regular.
  // A runtime accessory→regular round-trip is exactly the flicker we removed.
  assert.ok(
    !/setActivationPolicy\s*\(/.test(body),
    'BUG: runtime setDisguise must not call setActivationPolicy() — the accessory→regular ' +
    'round-trip deactivates the app and causes a visible disappear/reappear flicker on every ' +
    'disguise switch. Startup handles the dual-tile case; runtime renames in place.',
  );
});

test('startup promotion to regular still exists exactly once (runtime bracket removal did not touch it)', () => {
  // Guard against over-removal: the STARTUP accessory→regular promotion is the
  // load-bearing half of the dual-tile fix and must survive, gated on
  // darwin && !undetectable, after createWindow().
  const createWindowIndex = mainSource.indexOf('appState.createWindow()');
  const promoteIndex = mainSource.indexOf("setActivationPolicy('regular')", createWindowIndex);
  assert.ok(
    createWindowIndex >= 0 && promoteIndex >= 0,
    'BUG: startup setActivationPolicy(regular) promotion after createWindow() is missing.',
  );
  const promotionRegion = mainSource.slice(createWindowIndex, promoteIndex + 200);
  assert.ok(
    /process\.platform\s*===\s*['"]darwin['"][\s\S]*!\s*appState\.getUndetectable\s*\(\s*\)/.test(promotionRegion),
    'BUG: startup promotion must stay gated on darwin && !undetectable so stealth never promotes.',
  );
});
