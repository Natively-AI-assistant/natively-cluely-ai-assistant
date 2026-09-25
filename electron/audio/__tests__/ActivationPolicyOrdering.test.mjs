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

test('startup never round-trips the activation policy (the round-trip made the duplicate tiles)', () => {
  // History: startup used to clamp to 'accessory' at whenReady and promote to
  // 'regular' after createWindow(), believing the app.setName() rename painted a
  // second tile. Measured on the real build (2026-09-23): packaged bundles are
  // born 'regular', so the clamp made regular→accessory→regular, and together
  // with the setVisibleOnAllWorkspaces DockHide() calls it left 4 Dock tiles at
  // startup and 2 after quit. Without the round-trip (and with
  // skipTransformProcessType) the app shows exactly one tile. app.setName() on
  // macOS only stores a string; it re-registers nothing.
  const ifBlock = extractIfElseBlock('if (isUndetectableOnStartup)');
  assert.ok(
    /app\.dock\.hide\s*\(\s*\)/.test(ifBlock),
    'BUG: stealth whenReady branch must call app.dock.hide().',
  );
  assert.ok(
    !/setActivationPolicy\s*\(\s*['"]accessory['"]\s*\)/.test(mainSource),
    "BUG: setActivationPolicy('accessory') is back — a regular→accessory→regular flip at startup " +
      'is exactly what left duplicate Dock tiles.',
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

test('startup promotion to regular exists exactly once, gated so it can only ADD a missing tile', () => {
  // The dev Electron.app is patched to LSUIElement=1 (born without a tile), so
  // normal mode still needs ONE promotion. It must be skipped in undetectable
  // mode, off macOS, and when the bundle was already born 'regular' (packaged).
  const createWindowIndex = mainSource.indexOf('appState.createWindow()');
  const promoteIndex = mainSource.indexOf("setActivationPolicy('regular')", createWindowIndex);
  assert.ok(
    createWindowIndex >= 0 && promoteIndex >= 0,
    'BUG: startup setActivationPolicy(regular) promotion after createWindow() is missing.',
  );
  assert.equal(
    (mainSource.match(/setActivationPolicy\s*\(\s*['"]regular['"]\s*\)/g) || []).length,
    1,
    'BUG: setActivationPolicy(regular) must appear exactly once (the startup promotion).',
  );
  const promotionRegion = mainSource.slice(createWindowIndex, promoteIndex);
  assert.ok(
    /shouldPromoteToRegularAtStartup\s*\(\s*process\.platform\s*,\s*appState\.getUndetectable\s*\(\s*\)/.test(promotionRegion),
    'BUG: startup promotion must go through shouldPromoteToRegularAtStartup(process.platform, ' +
      'appState.getUndetectable(), …) so stealth never promotes and a live tile is never re-promoted.',
  );
});

test('disguise title writes cannot leave the Dock tile showing in undetectable mode', () => {
  // process.title → libuv _LSApplicationCheckIn → the app is Foreground again,
  // so a hidden tile reappears. _applyDisguise must consult the policy: skip
  // the +200/+1000/+5000ms re-asserts where they unhide the Dock, and re-drive
  // stealth after the one write it has to make (the disguise name is what
  // Activity Monitor shows).
  const body = extractIfElseBlock('private _applyDisguise(');
  assert.ok(
    /planDisguiseTitleWrites\s*\(\s*process\.platform\s*,\s*this\.isUndetectable\s*\)/.test(body),
    'BUG: _applyDisguise must ask planDisguiseTitleWrites(process.platform, this.isUndetectable).',
  );
  const gate = body.indexOf('.scheduleReasserts');
  const firstSchedule = body.indexOf('scheduleUpdate(200)');
  assert.ok(gate >= 0 && firstSchedule > gate,
    'BUG: the process.title re-assert timers must be scheduled only when scheduleReasserts is true.');
  assert.ok(
    /reassertStealthAfterWrite[\s\S]{0,120}this\.reassertUndetectableStealth\s*\(/.test(body),
    'BUG: after a title write in undetectable mode, _applyDisguise must re-drive reassertUndetectableStealth().',
  );
  assert.ok(
    /skipUnchangedWrite[\s\S]{0,80}process\.title\s*===\s*appName/.test(body),
    'BUG: while the Dock must stay hidden, _applyDisguise must not rewrite an unchanged title ' +
      '(the rewrite alone unhides the tile).',
  );
});

test('undetectable startup writes the disguise title BEFORE hiding the Dock tile', () => {
  // Measured: born tile → dock.hide() → title write (Foreground again) → re-hide
  // within ~150ms left a duplicate tile up for the whole session. Writing the
  // title while the born tile is still up, then hiding once, is one transition.
  const ifBlock = extractIfElseBlock('if (isUndetectableOnStartup)');
  const titleIdx = ifBlock.search(/process\.title\s*=\s*disguiseAppName\s*\(/);
  const hideIdx = ifBlock.search(/app\.dock\.hide\s*\(\s*\)/);
  assert.ok(titleIdx >= 0, 'BUG: the undetectable startup branch must write process.title = disguiseAppName(...).');
  assert.ok(hideIdx > titleIdx, 'BUG: the title write must come BEFORE app.dock.hide().');
});

test('a LaunchServices re-open in undetectable mode re-hides the Dock tile', () => {
  // Clicking the pinned Dock icon, `open -a` or Spotlight on the running app
  // makes it a Foreground app BEFORE 'activate' fires (measured: the tile came
  // back ~5 ms before the event and stayed). Skipping dock.show() is not
  // enough — the handler must drive the Dock back to hidden. (PR #595.)
  const start = mainSource.indexOf('app.on("activate"');
  assert.ok(start >= 0, 'activate handler not found');
  const handler = mainSource.slice(start, start + 1400);
  assert.ok(
    /if\s*\(\s*appState\.getUndetectable\(\)\s*\)\s*\{[\s\S]{0,700}appState\.reassertUndetectableStealth\(\)/.test(handler),
    'BUG: the activate handler must call reassertUndetectableStealth() when undetectable.',
  );
});

test('the toggle and startup enforcement loops use the guard-outlasting budget', () => {
  assert.ok(/maxAttempts: number = DOCK_ENFORCE_MAX_ATTEMPTS/.test(mainSource),
    'BUG: _enforceDockState must default to DOCK_ENFORCE_MAX_ATTEMPTS.');
  assert.ok(/\},\s*DOCK_ENFORCE_INTERVAL_MS\)/.test(mainSource), 'BUG: retry interval must be DOCK_ENFORCE_INTERVAL_MS.');
  assert.ok(/reassertUndetectableStealth\(\s*DOCK_ENFORCE_STARTUP_MAX_ATTEMPTS\s*\)/.test(mainSource),
    'BUG: startup convergence must use DOCK_ENFORCE_STARTUP_MAX_ATTEMPTS.');
});
