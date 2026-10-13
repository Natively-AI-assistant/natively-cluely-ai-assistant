// Behavioral integration tests for Linux wiring that main.ts performs at startup
// and meeting start — without importing main.ts (heavy side effects at load).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const platformDir = path.resolve(__dirname, '../../../dist-electron/electron/platform');

async function loadPlatformModule(name) {
  return import(pathToFileURL(path.join(platformDir, `${name}.js`)).href);
}

const ENV_KEYS = ['XDG_SESSION_TYPE', 'WAYLAND_DISPLAY', 'DISPLAY'];

function withEnv(overrides, fn) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

describe('Linux startup and meeting-start integration', () => {
  test('unsupported session triggers limited-features capture disable flag', async () => {
    if (process.platform !== 'linux') return;
    const { detectDisplaySession } = await loadPlatformModule('linuxSessionGate');
    const { shouldDisableLinuxCaptureOnLimitedContinue } =
      await loadPlatformModule('linuxMeetingGate');

    const session = withEnv(
      {
        XDG_SESSION_TYPE: 'wayland',
        WAYLAND_DISPLAY: 'wayland-0',
        DISPLAY: undefined,
      },
      () => detectDisplaySession(),
    );
    assert.equal(shouldDisableLinuxCaptureOnLimitedContinue(session), true);
  });

  test('supported X11 session does not disable capture on continue', async () => {
    if (process.platform !== 'linux') return;
    const { detectDisplaySession } = await loadPlatformModule('linuxSessionGate');
    const { shouldDisableLinuxCaptureOnLimitedContinue } =
      await loadPlatformModule('linuxMeetingGate');

    const session = withEnv(
      { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0', WAYLAND_DISPLAY: undefined },
      () => detectDisplaySession(),
    );
    assert.equal(shouldDisableLinuxCaptureOnLimitedContinue(session), false);
  });

  test('meeting start blocks system audio when capture disabled or session unsupported', async () => {
    if (process.platform !== 'linux') return;
    const { detectDisplaySession } = await loadPlatformModule('linuxSessionGate');
    const { shouldBlockLinuxSystemAudioAtMeetingStart } =
      await loadPlatformModule('linuxMeetingGate');
    const { formatPermissionMessage } = await loadPlatformModule('permissionMessages');

    const unsupported = withEnv(
      {
        XDG_SESSION_TYPE: 'wayland',
        WAYLAND_DISPLAY: 'wayland-0',
        DISPLAY: undefined,
      },
      () => detectDisplaySession(),
    );
    assert.equal(shouldBlockLinuxSystemAudioAtMeetingStart(false, unsupported), true);

    const supported = withEnv(
      { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0', WAYLAND_DISPLAY: undefined },
      () => detectDisplaySession(),
    );
    assert.equal(shouldBlockLinuxSystemAudioAtMeetingStart(true, supported), true);
    assert.equal(shouldBlockLinuxSystemAudioAtMeetingStart(false, supported), false);

    const sessionMessage = formatPermissionMessage('linux-session-unsupported');
    assert.doesNotMatch(sessionMessage, /System Settings/);
    assert.match(sessionMessage, /X11|Xorg/i);

    const pulseMessage = formatPermissionMessage('screen-recording-denied');
    assert.match(pulseMessage, /PulseAudio|PipeWire/i);
  });

  test('supported X11 session clears stale linux capture disabled flag', async () => {
    if (process.platform !== 'linux') return;
    const { detectDisplaySession } = await loadPlatformModule('linuxSessionGate');
    const { shouldBlockLinuxSystemAudioAtMeetingStart } =
      await loadPlatformModule('linuxMeetingGate');

    const session = withEnv(
      { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0', WAYLAND_DISPLAY: undefined },
      () => detectDisplaySession(),
    );
    assert.equal(session.isSupported, true);
    // Stale flag from a prior "Continue with limited features" click must not block X11.
    assert.equal(shouldBlockLinuxSystemAudioAtMeetingStart(true, session), true);
    assert.equal(shouldBlockLinuxSystemAudioAtMeetingStart(false, session), false);
  });

  test('system-audio recovery surfaces structured Linux native error codes', async () => {
    const {
      surfaceLinuxSystemAudioError,
      formatPermissionMessage,
      LINUX_SYSTEM_AUDIO_ERROR_CODES,
    } = await loadPlatformModule('permissionMessages');
    const surfaced = surfaceLinuxSystemAudioError(
      new Error(LINUX_SYSTEM_AUDIO_ERROR_CODES.STREAM_CONNECT_FAILED),
    );
    assert.equal(surfaced.message, formatPermissionMessage('linux-audio-server-missing'));
  });

  test('compositor warning callback fires once per session when not composited', async () => {
    const compositor = await loadPlatformModule('x11Compositor');
    compositor.resetCompositorWarningStateForTests();

    const warnings = [];
    compositor.setCompositorWarningCallback((info) => {
      warnings.push(info);
    });

    compositor.maybeEmitCompositorWarning({ isComposited: false, compositorName: null });
    compositor.maybeEmitCompositorWarning({ isComposited: false, compositorName: null });

    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].isComposited, false);

    compositor.resetCompositorWarningStateForTests();
    compositor.setCompositorWarningCallback(null);
  });

  test('compositor warning is suppressed when compositor is active', async () => {
    const compositor = await loadPlatformModule('x11Compositor');
    compositor.resetCompositorWarningStateForTests();

    const warnings = [];
    compositor.setCompositorWarningCallback((info) => warnings.push(info));
    compositor.maybeEmitCompositorWarning({ isComposited: true, compositorName: 'picom' });

    assert.equal(warnings.length, 0);
    compositor.resetCompositorWarningStateForTests();
    compositor.setCompositorWarningCallback(null);
  });
});
