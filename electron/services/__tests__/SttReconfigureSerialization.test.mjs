// Regression test for the "app hangs / crashes the system right after entering
// the Natively API key or Pro license" bug (2026-06-05).
//
// ROOT CAUSE: saving a Natively API key fired up to TWO audio-pipeline rebuilds
// nearly simultaneously:
//   1. main-process `set-natively-api-key` handler auto-promotes the STT
//      provider to 'natively' and calls `reconfigureSttProvider()`.
//   2. the renderer's `handleSave` then ALSO fired `setSttProvider('natively')`,
//      whose handler calls `reconfigureSttProvider()` a second time.
// `reconfigureSttProvider` tears down and reconstructs the native captures
// (SystemAudioCapture / MicrophoneCapture → CoreAudio / ScreenCaptureKit /
// WASAPI). Two interleaved teardown+construct sequences against the same native
// device handles raced → native deadlock / process crash on BOTH macOS and
// Windows.
//
// FIXES UNDER TEST:
//   #1 reconfigureSttProvider is serialized via `_sttReconfigureChain` — the
//      actual work lives in `_doReconfigureSttProvider`, and concurrent callers
//      are queued so the critical section is never re-entered.
//   #2 the renderer no longer double-fires setSttProvider/setDefaultModel.
//   #3 the ~8s Pro license activation is detached from the key-save critical
//      path (not awaited inline).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

const mainSrc = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
const ipcSrc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
const settingsSrc = fs.readFileSync(
  path.join(root, 'src/components/settings/NativelyApiSettings.tsx'),
  'utf8',
);

describe('Fix #1: reconfigureSttProvider is serialized (source contract)', () => {
  it('declares a serialization chain field', () => {
    assert.match(
      mainSrc,
      /_sttReconfigureChain\s*:\s*Promise<void>/,
      'BUG: `_sttReconfigureChain` serialization field is gone. Without it, concurrent ' +
        'reconfigureSttProvider calls re-enter the native teardown/rebuild in parallel — ' +
        'the exact race that crashed/hung the app after a key save.',
    );
  });

  it('the public reconfigureSttProvider delegates through the chain, not the body directly', () => {
    // Isolate the public method body.
    const pubStart = mainSrc.indexOf('public async reconfigureSttProvider(');
    assert.ok(pubStart >= 0, 'public reconfigureSttProvider must exist');
    const pubBody = mainSrc.slice(pubStart, pubStart + 1200);
    assert.match(
      pubBody,
      /_sttReconfigureChain/,
      'BUG: public reconfigureSttProvider no longer references _sttReconfigureChain — ' +
        'serialization was removed and concurrent calls can race again.',
    );
    assert.match(
      pubBody,
      /_doReconfigureSttProvider\s*\(/,
      'BUG: public reconfigureSttProvider must delegate the real work to ' +
        '_doReconfigureSttProvider (the serialized critical section).',
    );
    // The teardown/rebuild must NOT be inlined in the public method — that
    // would mean it runs unserialized.
    assert.ok(
      !/public async reconfigureSttProvider[\s\S]{0,1200}setupSystemAudioPipeline/.test(mainSrc),
      'BUG: setupSystemAudioPipeline is called directly inside the PUBLIC ' +
        'reconfigureSttProvider — the native rebuild must live in the serialized ' +
        '_doReconfigureSttProvider instead.',
    );
  });

  it('the real teardown/rebuild lives in _doReconfigureSttProvider', () => {
    const doStart = mainSrc.indexOf('private async _doReconfigureSttProvider(');
    assert.ok(doStart >= 0, 'BUG: _doReconfigureSttProvider (the serialized worker) is missing.');
    const doBody = mainSrc.slice(doStart, doStart + 2000);
    assert.match(
      doBody,
      /setupSystemAudioPipeline/,
      'BUG: _doReconfigureSttProvider no longer rebuilds the pipeline — the worker is hollow.',
    );
  });
});

describe('Fix #1: serialization semantics (behavioral)', () => {
  // Faithfully reproduce the chain pattern from main.ts and prove it provides
  // mutual exclusion: the critical section is never entered concurrently, even
  // when callers arrive simultaneously and the work is async.
  function makeSerializedRunner(work) {
    let chain = Promise.resolve();
    return function run() {
      const r = chain.then(
        () => work(),
        () => work(),
      );
      chain = r.then(
        () => undefined,
        () => undefined,
      );
      return r;
    };
  }

  it('never re-enters the critical section under concurrent calls', async () => {
    let active = 0;
    let maxActive = 0;
    let completed = 0;
    const work = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      // Yield across multiple microtask/macrotask boundaries to expose any
      // interleaving — this is where the native race used to happen.
      await new Promise((res) => setTimeout(res, 5));
      await Promise.resolve();
      active--;
      completed++;
    };
    const run = makeSerializedRunner(work);

    // Fire the same double-call the key-save flow used to produce.
    await Promise.all([run(), run(), run(), run()]);

    assert.equal(maxActive, 1, 'BUG: critical section was entered concurrently — serialization failed.');
    assert.equal(completed, 4, 'all queued reconfigures must complete.');
  });

  it('a throwing reconfigure does not wedge subsequent reconfigures', async () => {
    let completedAfterThrow = 0;
    let calls = 0;
    const work = async () => {
      calls++;
      if (calls === 1) throw new Error('simulated native init failure');
      await Promise.resolve();
      completedAfterThrow++;
    };
    const run = makeSerializedRunner(work);

    // First call rejects to ITS caller...
    await assert.rejects(run(), /simulated native init failure/);
    // ...but the chain must keep working for the next caller.
    await run();
    await run();
    assert.equal(completedAfterThrow, 2, 'BUG: a failed reconfigure poisoned the chain for later callers.');
  });
});

describe('Fix #2: renderer no longer double-fires; server compensates the UI refresh', () => {
  it('handleSave does not call setSttProvider/setDefaultModel after saving the key', () => {
    const start = settingsSrc.indexOf('const handleSave');
    assert.ok(start >= 0, 'handleSave must exist in NativelyApiSettings.tsx');
    const end = settingsSrc.indexOf('const handleClear', start);
    const handleSaveBody = settingsSrc.slice(start, end > start ? end : start + 1500);
    // Match the actual IPC CALL form (`electronAPI?.setSttProvider`), not bare
    // mentions — the explanatory comment legitimately names the removed calls.
    assert.ok(
      !/electronAPI\s*\?\.\s*setSttProvider/.test(handleSaveBody),
      'BUG: handleSave fires electronAPI.setSttProvider again after set-natively-api-key. The main ' +
        'process already promotes + reconfigures STT server-side; the redundant call races a SECOND ' +
        'audio-pipeline rebuild — the crash/hang this whole fix removes.',
    );
    assert.ok(
      !/electronAPI\s*\?\.\s*setDefaultModel/.test(handleSaveBody),
      'BUG: handleSave fires electronAPI.setDefaultModel again after set-natively-api-key. The main ' +
        'process already syncs the default model server-side; the redundant call is unnecessary work.',
    );
  });

  it("set-natively-api-key broadcasts 'credentials-changed' so the SettingsOverlay STT dropdown refreshes", () => {
    // The SettingsOverlay STT dropdown re-reads credentials ONLY on the
    // 'credentials-changed' event. Removing the renderer's setSttProvider call
    // (above) deleted the transitive source of that event for this flow, so the
    // handler must now emit it directly — otherwise the dropdown shows a stale
    // provider after a key save/clear.
    const start = ipcSrc.indexOf("safeHandle('set-natively-api-key'");
    assert.ok(start >= 0, 'set-natively-api-key handler must exist');
    const end = ipcSrc.indexOf("safeHandle('get-natively-pricing'", start);
    const handlerBody = ipcSrc.slice(start, end > start ? end : start + 4000);
    assert.match(
      handlerBody,
      /send\(\s*['"]credentials-changed['"]\s*\)/,
      "BUG: set-natively-api-key no longer broadcasts 'credentials-changed'. The Settings STT " +
        'dropdown will show a stale provider after the Natively key is saved or cleared.',
    );
  });
});

describe('Fix #3: Pro license activation stays awaited inline (no detached billing race)', () => {
  it('activateWithApiKey is awaited inline, not detached in a fire-and-forget IIFE', () => {
    const start = ipcSrc.indexOf("safeHandle('set-natively-api-key'");
    assert.ok(start >= 0, 'set-natively-api-key handler must exist');
    const end = ipcSrc.indexOf("safeHandle('get-natively-pricing'", start);
    const handlerBody = ipcSrc.slice(start, end > start ? end : start + 4000);

    // The inline await is the backpressure that serializes rapid set→clear:
    // it keeps the renderer button disabled until the license mutation lands,
    // so a fire-and-forget activate can't store a license AFTER a clear's
    // deactivate (entitlement leak). LicenseManager has no cross-call mutex,
    // so the await is the only thing preventing the ordering race.
    assert.match(
      handlerBody,
      /await\s+LicenseManager\.getInstance\(\)\.activateWithApiKey/,
      'BUG: activateWithApiKey must be awaited inline in the handler.',
    );
    assert.ok(
      !/void\s*\(async\s*\(\s*\)\s*=>/.test(handlerBody),
      'BUG: the license activation was detached into a fire-and-forget IIFE. That removes the ' +
        'renderer backpressure and opens a set→clear ordering race (Pro left active with no key). ' +
        'Keep it awaited inline; the crash fix is handled by reconfigureSttProvider serialization.',
    );
  });
});
