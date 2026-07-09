// Regression test for the "Natively icon appears in the dock after Stop meeting
// (in undetectable mode)" bug.
//
// Symptom: with undetectable mode ON, starting a meeting then pressing Stop
// SOMETIMES revealed the app's dock tile — breaking stealth.
//
// Root cause: endMeeting() swaps the visible window overlay→launcher via
// setWindowMode('launcher') → WindowHelper.switchToLauncher(), which does
// launcherWindow.show() + .focus(). The launcher is a REGULAR macOS window (no
// `type: 'panel'`, no skipTaskbar — unlike the overlay NSPanel), so the
// activating show re-activates the app as a foreground app; macOS re-registers
// it and re-shows the dock tile that app.dock.hide() had suppressed. Nothing
// re-asserted stealth after the show, so the tile stuck. It is INTERMITTENT
// because macOS asynchronously coalesces and sometimes drops dock/activation
// calls, so whether the tile stayed depended on timing.
//
// Fix: switchToLauncher() now re-asserts stealth at the single choke point every
// launcher show funnels through — calling appState.reassertUndetectableStealth()
// when on darwin AND undetectable. That routes through the SAME self-verifying
// _enforceDockState() loop the toggle path uses: it polls app.dock.isVisible()
// (the OS ground truth) and re-applies dock.hide() + content protection until
// reality matches intent, so a dropped/late dock op cannot defeat it.
//
// Strategy:
//  (1) Source-contract assertions pinning the guard in switchToLauncher() and
//      the reassertUndetectableStealth() method wiring — so a refactor that
//      drops either fails CI loudly. These fail against the pre-fix source.
//  (2) A behavioral model of _enforceDockState's convergence proving that even
//      when the first hide() is "dropped" by the OS, the poll-and-retry loop
//      still drives the settled dock state to hidden.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../../electron/main.ts');
const whPath = path.resolve(__dirname, '../../../electron/WindowHelper.ts');
const mainSource = readFileSync(mainPath, 'utf8');
const whSource = readFileSync(whPath, 'utf8');

function extractMethodBody(source, methodName) {
  const re = new RegExp(`(?:public|private|protected)\\s+(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*(?::[^{]*)?\\{`);
  const m = re.exec(source);
  assert.ok(m, `could not locate ${methodName}`);
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, `unbalanced braces in ${methodName}`);
  return source.slice(start, i - 1);
}

// ─── (1) SOURCE CONTRACT ────────────────────────────────────────────────────

test('switchToLauncher() re-asserts stealth after the activating show', () => {
  const body = extractMethodBody(whSource, 'switchToLauncher');
  assert.ok(
    /reassertUndetectableStealth\s*\(/.test(body),
    'BUG: switchToLauncher() must call appState.reassertUndetectableStealth() — the launcher is a regular (non-panel) window whose show()+focus() re-activates the app and reveals the dock tile in undetectable mode. This is the single choke point every launcher show funnels through, so the guard must live here.',
  );
  assert.ok(
    /process\.platform\s*===\s*['"]darwin['"]/.test(body) &&
      /getUndetectable\s*\(\s*\)/.test(body),
    'BUG: the stealth re-assert in switchToLauncher() must be gated on darwin + getUndetectable() so it is a no-op on Windows/Linux and when the user is not in undetectable mode.',
  );
});

test('the stealth re-assert runs AFTER the launcher show/focus (so it corrects the reveal, not before it)', () => {
  const body = extractMethodBody(whSource, 'switchToLauncher');
  const lastShowIdx = body.lastIndexOf('.show()');
  const reassertIdx = body.search(/reassertUndetectableStealth\s*\(/);
  assert.ok(lastShowIdx >= 0, 'sanity: switchToLauncher() must show the launcher.');
  assert.ok(reassertIdx >= 0, 'sanity: switchToLauncher() must re-assert stealth.');
  assert.ok(
    reassertIdx > lastShowIdx,
    'BUG: reassertUndetectableStealth() must run AFTER launcherWindow.show()/focus(); re-asserting before the activating show is the wrong order — the show is what reveals the tile, so the correction has to follow it.',
  );
});

test('reassertUndetectableStealth() drives the self-verifying dock loop and is a safe no-op off-stealth', () => {
  const body = extractMethodBody(mainSource, 'reassertUndetectableStealth');
  assert.ok(
    /process\.platform\s*!==\s*['"]darwin['"]\s*\)\s*return/.test(body),
    'reassertUndetectableStealth() must early-return off darwin.',
  );
  assert.ok(
    /!this\.isUndetectable\s*\)\s*return/.test(body),
    'reassertUndetectableStealth() must early-return when not undetectable (never reveal/hide the dock for a non-stealth user).',
  );
  assert.ok(
    /reassertAllContentProtection\s*\(\s*\)/.test(body),
    'reassertUndetectableStealth() must re-assert content protection — the activation-policy flip can reset each window sharingType.',
  );
  assert.ok(
    /_enforceDockState\s*\(\s*true\s*,/.test(body),
    'BUG: reassertUndetectableStealth() must drive the self-verifying _enforceDockState(true, …) loop — a bare app.dock.hide() is unreliable because macOS coalesces/drops dock calls. The poll-until-it-sticks loop is what makes this "never fail".',
  );
});

test('applyInitialUndetectableState() (startup convergence) still routes through the shared re-assert', () => {
  const body = extractMethodBody(mainSource, 'applyInitialUndetectableState');
  assert.ok(
    /reassertUndetectableStealth\s*\(/.test(body),
    'applyInitialUndetectableState() must delegate to reassertUndetectableStealth() so startup and launcher-show paths share one hardened implementation.',
  );
});

// ─── (1b) BYPASS-PATH GUARD ─────────────────────────────────────────────────
// The central stealth re-assert lives in switchToLauncher(), so every launcher
// show that funnels through it is protected. But the `settings:open-tab` IPC
// handler shows the launcher DIRECTLY (launcherWin.showInactive()/show()),
// bypassing switchToLauncher() and therefore the central re-assert. It is
// reachable in undetectable mode from the renderer (openSettingsTab: keybinds
// link in NativelyInterface, api tab from the onboarding toaster).
//
// This bypass is now CLOSED with two layers of defense in the undetectable arm,
// both pinned below:
//   (a) it uses the NON-activating showInactive() (never show()+focus()), so it
//       does not foreground the app in the first place; and
//   (b) it STILL calls reassertUndetectableStealth() afterward — because even a
//       non-activating show can make macOS re-register a regular (non-panel)
//       window and reveal the hidden dock tile. The re-assert drives the same
//       self-verifying _enforceDockState() loop, so a reveal is corrected
//       against the OS ground truth. Dropping either layer is a stealth leak.

const ipcPath = path.resolve(__dirname, '../../../electron/ipcHandlers.ts');
const ipcSource = readFileSync(ipcPath, 'utf8');

function extractHandlerBody(source, channel) {
  const re = new RegExp(`safeHandle\\(\\s*['"]${channel.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}['"]`);
  const m = re.exec(source);
  assert.ok(m, `could not locate safeHandle('${channel}')`);
  // Walk forward to the first '{' that opens the handler function body.
  let i = source.indexOf('{', m.index);
  assert.ok(i >= 0, `no body brace for ${channel}`);
  let depth = 1;
  i++;
  const start = i;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, `unbalanced braces in ${channel} handler`);
  return source.slice(start, i - 1);
}

test("settings:open-tab bypass: undetectable branch uses non-activating showInactive() AND re-asserts stealth", () => {
  const body = extractHandlerBody(ipcSource, 'settings:open-tab');
  // Sanity: this handler shows the launcher directly (the bypass).
  assert.ok(
    /getLauncherWindow\s*\(\s*\)/.test(body) && /getUndetectable\s*\(\s*\)/.test(body),
    'sanity: settings:open-tab shows the launcher directly and branches on getUndetectable().',
  );
  // Split the handler on the getUndetectable() branch; the truthy (undetectable)
  // arm must use showInactive(), must NOT call the focus()-activating show, and
  // must re-assert stealth to correct any dock reveal (this path bypasses the
  // central switchToLauncher() re-assert).
  const undIdx = body.search(/getUndetectable\s*\(\s*\)/);
  const elseIdx = body.indexOf('else', undIdx);
  const undetectableArm = elseIdx >= 0 ? body.slice(undIdx, elseIdx) : body.slice(undIdx);
  assert.ok(
    /showInactive\s*\(\s*\)/.test(undetectableArm),
    'BUG: settings:open-tab in undetectable mode must show the launcher via the NON-activating showInactive() — an activating show() re-foregrounds the app, revealing the dock tile.',
  );
  assert.ok(
    !/\.focus\s*\(\s*\)/.test(undetectableArm),
    'BUG: settings:open-tab must NOT call launcherWin.focus() in undetectable mode — focus() re-activates the app and reveals the dock tile.',
  );
  assert.ok(
    /reassertUndetectableStealth\s*\(/.test(undetectableArm),
    'BUG: settings:open-tab in undetectable mode must call appState.reassertUndetectableStealth() after showInactive() — this handler bypasses switchToLauncher()\'s central re-assert, so without its own re-assert a dock reveal from the direct show has nothing to correct it. This closes the last launcher-show bypass.',
  );
});

// ─── (2) BEHAVIORAL CONVERGENCE MODEL ───────────────────────────────────────
// Faithful model of _enforceDockState: it reads app.dock.isVisible() (OS ground
// truth) and re-applies hide() until the OS reports hidden, retrying on a timer.
// The key property under test: even if the FIRST hide() is dropped by the OS
// (dock still visible), the loop converges the settled state to hidden.

function makeFlakyDock({ dropFirstNHides }) {
  let visible = true;      // start visible — the leak state after an activating show
  let hideCalls = 0;
  return {
    isVisible: () => visible,
    hide: () => {
      hideCalls++;
      // Simulate macOS dropping the first N hide() calls (the intermittency).
      if (hideCalls > dropFirstNHides) visible = false;
    },
    show: () => { visible = true; },
    get hideCalls() { return hideCalls; },
  };
}

// Minimal re-implementation of the enforce loop's convergence contract.
function enforceDockHiddenLoop(dock, { wantUndetectable, maxAttempts }) {
  let attempt = 0;
  while (attempt < maxAttempts) {
    const currentlyHidden = !dock.isVisible();
    const shouldApply = wantUndetectable ? !currentlyHidden : currentlyHidden;
    if (shouldApply) {
      if (wantUndetectable) dock.hide();
      else dock.show();
    }
    if (!dock.isVisible() === wantUndetectable) {
      // settled — matches intent
      return { settledHidden: !dock.isVisible(), attempts: attempt + 1 };
    }
    attempt++;
  }
  return { settledHidden: !dock.isVisible(), attempts: attempt };
}

test('convergence: a dropped first hide() still ends with the dock HIDDEN (intermittency defeated)', () => {
  const dock = makeFlakyDock({ dropFirstNHides: 1 });
  const res = enforceDockHiddenLoop(dock, { wantUndetectable: true, maxAttempts: 10 });
  assert.equal(res.settledHidden, true, 'the loop must converge the dock to hidden even when the OS drops the first hide().');
  assert.ok(dock.hideCalls >= 2, 'the loop must retry hide() after observing the dock still visible.');
});

test('convergence: even several dropped hides converge before the retry budget is exhausted', () => {
  const dock = makeFlakyDock({ dropFirstNHides: 4 });
  const res = enforceDockHiddenLoop(dock, { wantUndetectable: true, maxAttempts: 10 });
  assert.equal(res.settledHidden, true, 'with a generous retry budget the loop still wins against a bursty OS.');
});

test('a single fire-and-forget hide() would leave the tile visible — proving the loop is load-bearing', () => {
  // This models the OLD behavior (what a naive fix would do): one hide(), no
  // verification. If the OS drops it, the tile stays — exactly the bug.
  const dock = makeFlakyDock({ dropFirstNHides: 1 });
  dock.hide(); // dropped
  assert.equal(dock.isVisible(), true, 'sanity: a single dropped hide() leaves the dock visible — which is why the self-verifying loop (not a bare hide) is required.');
});
