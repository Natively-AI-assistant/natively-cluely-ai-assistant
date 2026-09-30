// src/lib/__tests__/copyText.test.mjs
//
// Every copy button in Natively routes through copyText. The reason is the
// Windows overlay: it is WS_EX_NOACTIVATE and never a focused document, and
// `navigator.clipboard.writeText` rejects with NotAllowedError unless the
// document is focused — so the direct calls these replaced silently did nothing
// there while working fine on macOS. The main-process bridge has no focus
// requirement, so it must be tried FIRST, with navigator.clipboard kept only for
// contexts that have no bridge (the standalone *Harness.html pages,
// natively-browser).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { copyText } from '../copyText.ts';

const setup = ({ bridge, nav } = {}) => {
  const calls = { bridge: [], nav: [] };
  globalThis.window = {
    electronAPI: bridge
      ? { clipboardWriteText: async (t) => { calls.bridge.push(t); return bridge(t); } }
      : {},
  };
  // Node ships a getter-only global `navigator`, so plain assignment throws.
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      clipboard: nav === null ? undefined : { writeText: async (t) => { calls.nav.push(t); return nav?.(t); } },
    },
    configurable: true,
    writable: true,
  });
  return calls;
};

afterEach(() => {
  delete globalThis.window;
  delete globalThis.navigator;
});

test('the main-process bridge is used when present, and navigator is left alone', async () => {
  const calls = setup({ bridge: () => ({ success: true }), nav: () => {} });
  await copyText('hello');
  assert.deepEqual(calls.bridge, ['hello']);
  assert.deepEqual(calls.nav, [], 'a working bridge must not also hit navigator.clipboard.');
});

test('falls back to navigator.clipboard with no bridge (harness pages, natively-browser)', async () => {
  const calls = setup({ nav: () => {} });
  await copyText('hello');
  assert.deepEqual(calls.nav, ['hello']);
});

test('falls back when the bridge reports failure', async () => {
  const calls = setup({ bridge: () => ({ success: false }), nav: () => {} });
  await copyText('hello');
  assert.deepEqual(calls.bridge, ['hello']);
  assert.deepEqual(calls.nav, ['hello'], 'a refused bridge write must still try the renderer path.');
});

test('rejects when nothing could copy — callers rely on this to skip their "Copied!" state', async () => {
  setup({ nav: null });
  await assert.rejects(copyText('hello'));
});

test('non-string input is coerced, never passed through raw', async () => {
  const calls = setup({ bridge: () => ({ success: true }) });
  await copyText(undefined);
  await copyText(42);
  assert.deepEqual(calls.bridge, ['', '42']);
});
