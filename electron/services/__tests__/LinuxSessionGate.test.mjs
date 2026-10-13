import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gatePath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/platform/linuxSessionGate.js',
);

const ENV_KEYS = ['XDG_SESSION_TYPE', 'WAYLAND_DISPLAY', 'DISPLAY'];

function saveEnv() {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(saved) {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

function withEnv(overrides, fn) {
  const saved = saveEnv();
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    restoreEnv(saved);
  }
}

async function loadGate() {
  return import(pathToFileURL(gatePath).href);
}

describe('detectDisplaySession (ADR 0001)', () => {
  afterEach(() => {
    // Tests set env inline; no shared state between tests.
  });

  test('detects supported X11 session when XDG_SESSION_TYPE=x11 and DISPLAY is set', async () => {
    if (process.platform !== 'linux') return;
    const { detectDisplaySession } = await loadGate();
    const session = withEnv(
      { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0', WAYLAND_DISPLAY: undefined },
      () => detectDisplaySession(),
    );
    assert.equal(session.sessionType, 'x11');
    assert.equal(session.isSupported, true);
    assert.match(session.reason, /X11/i);
  });

  test('treats DISPLAY without explicit Wayland session as X11-compatible', async () => {
    if (process.platform !== 'linux') return;
    const { detectDisplaySession } = await loadGate();
    const session = withEnv(
      { DISPLAY: ':1', XDG_SESSION_TYPE: undefined, WAYLAND_DISPLAY: undefined },
      () => detectDisplaySession(),
    );
    assert.equal(session.sessionType, 'x11');
    assert.equal(session.isSupported, true);
  });

  test('marks native Wayland without DISPLAY as unsupported', async () => {
    if (process.platform !== 'linux') return;
    const { detectDisplaySession } = await loadGate();
    const session = withEnv(
      {
        XDG_SESSION_TYPE: 'wayland',
        WAYLAND_DISPLAY: 'wayland-0',
        DISPLAY: undefined,
      },
      () => detectDisplaySession(),
    );
    assert.equal(session.sessionType, 'wayland');
    assert.equal(session.isSupported, false);
    assert.match(session.reason, /Wayland/i);
    assert.match(session.reason, /X11/i);
  });

  test('treats XWayland (Wayland session with DISPLAY) as supported X11-compatible', async () => {
    if (process.platform !== 'linux') return;
    const { detectDisplaySession } = await loadGate();
    const session = withEnv(
      {
        XDG_SESSION_TYPE: 'wayland',
        WAYLAND_DISPLAY: 'wayland-0',
        DISPLAY: ':0',
      },
      () => detectDisplaySession(),
    );
    assert.equal(session.sessionType, 'x11');
    assert.equal(session.isSupported, true);
    assert.match(session.reason, /XWayland/i);
  });

  test('rejects session with no DISPLAY', async () => {
    if (process.platform !== 'linux') return;
    const { detectDisplaySession } = await loadGate();
    const session = withEnv(
      { DISPLAY: undefined, XDG_SESSION_TYPE: undefined, WAYLAND_DISPLAY: undefined },
      () => detectDisplaySession(),
    );
    assert.equal(session.isSupported, false);
    assert.match(session.reason, /DISPLAY/i);
  });

  test('treats xorg session alias as supported X11 (negative: unknown type with DISPLAY)', async () => {
    if (process.platform !== 'linux') return;
    const { detectDisplaySession } = await loadGate();
    const session = withEnv(
      { XDG_SESSION_TYPE: 'xorg', DISPLAY: ':0', WAYLAND_DISPLAY: undefined },
      () => detectDisplaySession(),
    );
    assert.equal(session.sessionType, 'x11');
    assert.equal(session.isSupported, true);
  });

  test('non-linux platform is always supported (gate is Linux-only)', async () => {
    const { detectDisplaySession } = await loadGate();
    if (process.platform === 'linux') {
      // Simulate non-linux by checking the early-return contract via saved platform
      // is not mockable without re-import; assert documented behavior on darwin CI skip.
      return;
    }
    const session = detectDisplaySession();
    assert.equal(session.isSupported, true);
    assert.equal(session.sessionType, 'unknown');
  });
});
