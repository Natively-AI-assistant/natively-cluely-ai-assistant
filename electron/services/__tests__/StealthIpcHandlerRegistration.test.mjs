// Regression test for the stealth-tap IPC registration helper introduced in
// the fix for the PR #250 senior-review m1 finding.
//
// Context — what bug we are guarding against:
//   electron/main.ts registers six `stealth-tap:*` IPC channels at app.ready.
//   Electron's `ipcMain.handle(channel, fn)` throws "Attempted to register a
//   second handler for '<channel>'" when the same channel is registered twice.
//   In normal production startup this never fires, but two real paths can:
//     • Single-instance second-launch — when a second invocation hits the
//       existing process, our `second-instance` handler runs but `app.ready`
//       has already fired; in dev HMR setups the registration block has been
//       observed to re-execute via the requestSingleInstanceLock path.
//     • Manual `app.emit('ready')` during integration testing or future
//       service-bootstrap refactors.
//   When the duplicate throw propagates, the renderer's `stealthTapAvailable()`
//   invoke rejects, `isCgEventTapAvailableRef` silently stays at its safe-false
//   default, and the chat input quietly stops gating stealth typing — the
//   exact silent-failure mode PR #250 set out to eliminate.
//
//   The m1 fix wraps every registration in `registerStealthHandler(channel, fn)`
//   which prepends `ipcMain.removeHandler(channel)`. This test documents the
//   *pattern*: any wrapper following the remove-then-handle shape must remain
//   idempotent under repeated calls.
//
// Why a pattern test, not an import-from-main test:
//   electron/main.ts has heavy load-time side effects (creates the
//   StealthKeyboardManager, opens windows, wires the singleton lock, etc.)
//   and cannot be imported from a node:test runner without an Electron
//   process. We mirror the helper's structure against a fake ipcMain so the
//   contract is exercised at the logic level. If a future contributor drops
//   the `removeHandler` line in main.ts, this test still passes locally —
//   that's by design; the test guards the *shape* of the helper, the
//   structural test below guards the *call sites*.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function makeFakeIpc() {
  const handlers = new Map();
  return {
    handlers,
    removeHandler(channel) {
      handlers.delete(channel);
    },
    handle(channel, fn) {
      // Faithfully mirrors Electron's real throw on duplicate registration.
      if (handlers.has(channel)) {
        throw new Error(
          `Attempted to register a second handler for '${channel}'`,
        );
      }
      handlers.set(channel, fn);
    },
  };
}

function makeRegister(ipc) {
  // Mirrors electron/main.ts line ~433 registerStealthHandler.
  return (channel, fn) => {
    ipc.removeHandler(channel);
    ipc.handle(channel, fn);
  };
}

test('registerStealthHandler pattern is idempotent across re-registration', () => {
  const ipc = makeFakeIpc();
  const register = makeRegister(ipc);

  // First registration succeeds.
  register('stealth-tap:available', () => true);
  assert.equal(ipc.handlers.size, 1);
  assert.equal(ipc.handlers.get('stealth-tap:available')(), true);

  // Second registration — without removeHandler this would throw the exact
  // Electron error string above. With the helper, it must succeed and the
  // newer handler must win.
  assert.doesNotThrow(() =>
    register('stealth-tap:available', () => false),
  );
  assert.equal(ipc.handlers.size, 1);
  assert.equal(
    ipc.handlers.get('stealth-tap:available')(),
    false,
    'second registration must replace the first handler, not silently keep the old one',
  );
});

test('registerStealthHandler pattern handles all six stealth-tap channels independently', () => {
  // The six channels live in two platform branches (darwin / non-darwin) in
  // main.ts. Each branch registers the same set of names, so under the
  // single-instance race both branches could potentially try to write the
  // same name. Confirm the helper keeps channel scope correct.
  const channels = [
    'stealth-tap:available',
    'stealth-tap:open-settings',
    'stealth-tap:stop',
    'stealth-tap:start',
    'stealth-tap:should-auto-engage',
    'stealth-tap:refresh-ime',
  ];
  const ipc = makeFakeIpc();
  const register = makeRegister(ipc);

  // First pass — simulate darwin branch.
  for (const channel of channels) {
    register(channel, () => `darwin:${channel}`);
  }
  assert.equal(ipc.handlers.size, channels.length);

  // Second pass — simulate the non-darwin branch firing on the same process
  // (it can't on a single boot, but a second app.ready would). Must not throw.
  for (const channel of channels) {
    assert.doesNotThrow(() => register(channel, () => `nondarwin:${channel}`));
  }
  assert.equal(ipc.handlers.size, channels.length);
  for (const channel of channels) {
    assert.equal(
      ipc.handlers.get(channel)(),
      `nondarwin:${channel}`,
      `${channel} must hold the most recently registered handler`,
    );
  }
});

test('raw ipcMain.handle pattern (without removeHandler) DOES throw — confirms our fake matches Electron semantics', () => {
  // Negative control: if anyone "simplifies" the helper by dropping
  // removeHandler, the fake ipc throws — matching real Electron. This keeps
  // the test honest: the idempotency assertion above is meaningful only
  // because the underlying handle() actually rejects duplicates.
  const ipc = makeFakeIpc();
  ipc.handle('stealth-tap:available', () => true);
  assert.throws(
    () => ipc.handle('stealth-tap:available', () => false),
    /Attempted to register a second handler/,
  );
});

// ── Structural assertions on the real electron/main.ts ──
//
// The pattern test above guards behaviour; these assertions ensure the
// production call sites actually USE the helper. If someone re-introduces a
// bare ipcMain.handle('stealth-tap:…') call, this fails and surfaces it.

test('every stealth-tap:* registration in main.ts goes through registerStealthHandler', () => {
  const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');

  // Make sure the helper exists and prepends removeHandler.
  const helper = main.match(
    /const registerStealthHandler = \([\s\S]*?\) => \{[\s\S]*?ipcMain\.removeHandler\([\s\S]*?ipcMain\.handle\([\s\S]*?\};/,
  );
  assert.ok(
    helper,
    'registerStealthHandler helper missing or no longer calls removeHandler before handle — this is the m1 contract',
  );

  // Find every line that registers a stealth-tap channel via the bare
  // ipcMain.handle path. There should be zero.
  const bareHandles = [
    ...main.matchAll(/ipcMain\.handle\(['"]stealth-tap:[^'"]+['"]/g),
  ];
  assert.deepEqual(
    bareHandles.map((m) => m[0]),
    [],
    'No stealth-tap channel may be registered via bare ipcMain.handle — use registerStealthHandler so a duplicate app.ready does not throw',
  );

  // And there must be at least the six expected helper call sites per platform
  // branch (12 total across darwin + non-darwin branches).
  const helperCalls = [
    ...main.matchAll(/registerStealthHandler\(['"]stealth-tap:[^'"]+['"]/g),
  ];
  assert.ok(
    helperCalls.length >= 12,
    `expected at least 12 registerStealthHandler('stealth-tap:*') call sites (6 per platform branch), found ${helperCalls.length}`,
  );
});
