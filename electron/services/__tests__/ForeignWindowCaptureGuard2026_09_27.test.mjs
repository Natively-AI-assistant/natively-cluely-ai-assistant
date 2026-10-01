// Undetectable mode for windows setContentProtection cannot reach: file
// pickers, message boxes, tooltips, popups. See
// electron/services/foreignWindowCaptureGuard.ts and
// native-module/src/capture_exclusion.rs. Pure scheduling logic; the native
// sweep is faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIALOG_SWEEP_MS,
  IDLE_SWEEP_MS,
  createForeignWindowCaptureGuard,
  wrapAsyncDialogs,
} from '../foreignWindowCaptureGuard.ts';

function rig({ undetectable = true, native = true } = {}) {
  const calls = [];
  const timers = new Map();
  let nextId = 1;
  const state = { undetectable };
  const own = [Buffer.alloc(8, 1)];
  const guard = createForeignWindowCaptureGuard({
    native: () => (native ? { setForeignWindowsCaptureExcluded: (excluded, handles) => { calls.push({ excluded, handles }); return 1; } } : {}),
    ownHandles: () => own,
    isUndetectable: () => state.undetectable,
    setInterval: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    clearInterval: (id) => { timers.delete(id); },
  });
  const tick = (ms) => { for (const t of timers.values()) if (t.ms === ms) t.fn(); };
  return { guard, calls, timers, state, own, tick };
}

test('Undetectable on: sweeps now, then on the idle interval, passing the BrowserWindows as own', () => {
  const { guard, calls, timers, own, tick } = rig();
  guard.sync(true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { excluded: true, handles: own });
  assert.deepEqual([...timers.values()].map((t) => t.ms), [IDLE_SWEEP_MS]);
  tick(IDLE_SWEEP_MS);
  assert.equal(calls.length, 2);
  guard.sync(true); // idempotent: still one idle timer
  assert.equal(timers.size, 1);
});

test('Undetectable off: stops the idle sweep and restores once', () => {
  const { guard, calls, timers, state } = rig();
  guard.sync(true);
  state.undetectable = false;
  guard.sync(false);
  assert.equal(timers.size, 0);
  assert.equal(calls.filter((c) => !c.excluded).length, 1);
  assert.equal(calls.at(-1).excluded, false);
});

test('with Undetectable off a dialog starts no fast timer', async () => {
  const { guard, timers } = rig({ undetectable: false });
  let resolve;
  const result = guard.around(() => new Promise((r) => { resolve = r; }));
  assert.equal(timers.size, 0);
  resolve('done');
  assert.equal(await result, 'done');
});

test('turning Undetectable off mid-dialog restores, and the dialog timer then stops', async () => {
  const { guard, calls, timers, state, tick } = rig();
  guard.sync(true);
  let resolve;
  const result = guard.around(() => new Promise((r) => { resolve = r; }));
  state.undetectable = false;
  guard.sync(false);
  const before = calls.length;
  tick(DIALOG_SWEEP_MS); // still ticking until the dialog settles, but excludes nothing
  assert.equal(calls.length, before);
  resolve(1);
  await result;
  assert.equal(timers.size, 0);
});

test('with Undetectable off nothing is ever excluded', async () => {
  const { guard, calls, tick } = rig({ undetectable: false });
  guard.sync(false);
  await guard.around(async () => 'picked');
  tick(DIALOG_SWEEP_MS);
  assert.equal(calls.filter((c) => c.excluded).length, 0);
});

test('a dialog is swept as soon as it opens, then every 16ms until it settles', async () => {
  const { guard, calls, timers, tick } = rig();
  let resolve;
  const opened = [];
  const result = guard.around(() => { opened.push('open'); return new Promise((r) => { resolve = r; }); });
  // The sweep ran synchronously, right after open() returned.
  assert.deepEqual(opened, ['open']);
  assert.equal(calls.length, 1);
  assert.ok([...timers.values()].some((t) => t.ms === DIALOG_SWEEP_MS));
  tick(DIALOG_SWEEP_MS);
  assert.equal(calls.length, 2);
  resolve({ canceled: true });
  assert.deepEqual(await result, { canceled: true });
  assert.ok(![...timers.values()].some((t) => t.ms === DIALOG_SWEEP_MS));
});

test('overlapping dialogs share one fast timer, kept until the last closes', async () => {
  const { guard, timers } = rig();
  let r1; let r2;
  const a = guard.around(() => new Promise((r) => { r1 = r; }));
  const b = guard.around(() => new Promise((r) => { r2 = r; }));
  const fast = () => [...timers.values()].filter((t) => t.ms === DIALOG_SWEEP_MS).length;
  assert.equal(fast(), 1);
  r1(1); await a;
  assert.equal(fast(), 1);
  r2(2); await b;
  assert.equal(fast(), 0);
});

test('a dialog that rejects still stops its timer and rethrows', async () => {
  const { guard, timers } = rig();
  await assert.rejects(guard.around(() => Promise.reject(new Error('boom'))), /boom/);
  assert.equal(timers.size, 0);
});

test('an older native binary without the function is a quiet no-op', async () => {
  const { guard, calls } = rig({ native: false });
  guard.sync(true);
  assert.equal(guard.sweep(), 0);
  assert.equal(await guard.around(async () => 7), 7);
  assert.equal(calls.length, 0);
});

test('wrapAsyncDialogs routes the async dialogs once and keeps their results', async () => {
  const { guard, calls } = rig();
  const seen = [];
  const dialog = {
    showOpenDialog: async (...args) => { seen.push(['open', args]); return { canceled: false, filePaths: ['/a b/c.pdf'] }; },
    showSaveDialog: async () => ({ canceled: true }),
    showMessageBox: async () => ({ response: 1 }),
    showMessageBoxSync: () => 0,
  };
  const syncBefore = dialog.showMessageBoxSync;
  wrapAsyncDialogs(dialog, guard);
  wrapAsyncDialogs(dialog, guard); // idempotent
  const res = await dialog.showOpenDialog('parent', { properties: ['openFile'] });
  assert.deepEqual(res.filePaths, ['/a b/c.pdf']);
  assert.deepEqual(seen, [['open', ['parent', { properties: ['openFile'] }]]]);
  assert.equal(calls.length, 1); // one sweep, not two layers of wrapping
  assert.equal((await dialog.showMessageBox()).response, 1);
  assert.equal(dialog.showMessageBoxSync, syncBefore);
});
