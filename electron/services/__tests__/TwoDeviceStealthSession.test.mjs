// electron/services/__tests__/TwoDeviceStealthSession.test.mjs
//
// Ticket 01 — two-device stealth session via phone command.
// Behavior through TwoDeviceStealthSession + parsePhoneCommand public surfaces.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sessionPath = path.resolve(
  here,
  '../../../dist-electron/electron/services/TwoDeviceStealthSession.js',
);
const commandsPath = path.resolve(
  here,
  '../../../dist-electron/electron/services/phoneMirrorCommands.js',
);

function fakeHost(initial = {}) {
  const state = {
    undetectable: initial.undetectable ?? false,
    overlayVisible: initial.overlayVisible ?? true,
    endMeetingCalls: 0,
    setUndetectableCalls: [],
    hideCalls: 0,
    showCalls: 0,
  };
  return {
    state,
    host: {
      getUndetectable: () => state.undetectable,
      setUndetectable: (on) => {
        state.setUndetectableCalls.push(!!on);
        state.undetectable = !!on;
      },
      isOverlayVisible: () => state.overlayVisible,
      hideOverlay: () => {
        state.hideCalls += 1;
        state.overlayVisible = false;
      },
      showOverlay: () => {
        state.showCalls += 1;
        state.overlayVisible = true;
      },
      endMeeting: async () => {
        state.endMeetingCalls += 1;
      },
    },
  };
}

async function loadSession() {
  return import(pathToFileURL(sessionPath).href);
}

async function loadCommands() {
  return import(pathToFileURL(commandsPath).href);
}

test('enter hides overlay, engages undetectable, keeps session active', async () => {
  const { TwoDeviceStealthSession } = await loadSession();
  const session = new TwoDeviceStealthSession();
  const { host, state } = fakeHost({ undetectable: false, overlayVisible: true });

  const result = session.enter(host);

  assert.equal(result.ok, true);
  assert.equal(result.active, true);
  assert.equal(result.action, 'enter');
  assert.equal(state.undetectable, true);
  assert.equal(state.overlayVisible, false);
  assert.equal(state.hideCalls, 1);
  assert.equal(session.isActive(), true);
  assert.equal(state.endMeetingCalls, 0, 'enter must not end the meeting');
});

test('exit restores prior undetectable + overlay visibility', async () => {
  const { TwoDeviceStealthSession } = await loadSession();
  const session = new TwoDeviceStealthSession();
  const { host, state } = fakeHost({ undetectable: false, overlayVisible: true });

  session.enter(host);
  const result = session.exit(host);

  assert.equal(result.ok, true);
  assert.equal(result.active, false);
  assert.equal(result.action, 'exit');
  assert.equal(state.undetectable, false, 'restore prior undetectable=false');
  assert.equal(state.overlayVisible, true);
  assert.equal(state.showCalls, 1);
  assert.equal(session.isActive(), false);
});

test('exit is noop-safe when not active', async () => {
  const { TwoDeviceStealthSession } = await loadSession();
  const session = new TwoDeviceStealthSession();
  const { host, state } = fakeHost();

  const result = session.exit(host);
  assert.equal(result.ok, true);
  assert.equal(result.action, 'noop');
  assert.equal(state.hideCalls, 0);
  assert.equal(state.showCalls, 0);
});

test('end exits stealth then calls endMeeting', async () => {
  const { TwoDeviceStealthSession } = await loadSession();
  const session = new TwoDeviceStealthSession();
  const { host, state } = fakeHost({ undetectable: true, overlayVisible: true });

  session.enter(host);
  const result = await session.end(host);

  assert.equal(result.ok, true);
  assert.equal(result.action, 'end');
  assert.equal(result.active, false);
  assert.equal(state.endMeetingCalls, 1);
  assert.equal(session.isActive(), false);
});

test('parsePhoneCommand accepts two-device-stealth enter/exit/end', async () => {
  const { parsePhoneCommand } = await loadCommands();
  assert.deepEqual(parsePhoneCommand({ type: 'two-device-stealth', op: 'enter' }), {
    type: 'two-device-stealth',
    op: 'enter',
  });
  assert.deepEqual(parsePhoneCommand({ type: 'two-device-stealth', op: 'exit' }), {
    type: 'two-device-stealth',
    op: 'exit',
  });
  assert.deepEqual(parsePhoneCommand({ type: 'two-device-stealth', op: 'end' }), {
    type: 'two-device-stealth',
    op: 'end',
  });
  assert.equal(parsePhoneCommand({ type: 'two-device-stealth', op: 'nope' }), null);
  assert.equal(parsePhoneCommand({ type: 'two-device-stealth' }), null);
});
