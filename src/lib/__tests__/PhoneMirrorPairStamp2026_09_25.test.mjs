// src/lib/__tests__/PhoneMirrorPairStamp2026_09_25.test.mjs
//
// Settings → Sync → the extension is connected → Re-pair → click "Connect to
// Natively" in the extension popup → the card keeps saying "Waiting for
// extension" and counts down the whole 60 s window.
//
// Why: the countdown ended only on the extensionConnected false → true edge. A
// Re-pair keeps the same persisted token and the same open socket, so /pair
// succeeded and NOTHING the status carried changed. The service now stamps
// `extPairedAt` on a successful /pair; it has to survive the launcher's flag
// subset (merge) and end the window only when it is newer than the arm.
//
// Pure and platform-agnostic; runs identically on macOS and Windows.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { extensionPairingSatisfied, mergePhoneMirrorStatus } from '../phoneMirrorStatusMerge.mjs';

const full = (over = {}) => ({
  running: true,
  enabled: true,
  exposeOnLan: false,
  port: 4123,
  loopbackUrl: 'http://127.0.0.1:4123/?t=abc',
  primaryUrl: 'http://127.0.0.1:4123/?t=abc',
  lanUrls: [],
  token: 'abc',
  extToken: 'ext',
  qrDataUrl: 'data:image/png;base64,QR',
  clients: 0,
  extensionConnected: true,
  extPairedAt: 0,
  bindAddress: '127.0.0.1',
  ...over,
});

describe('extPairedAt survives both status shapes', () => {
  test('the launcher flag subset lays a new stamp over the held snapshot', () => {
    const prev = full({ extPairedAt: 1000 });
    const next = mergePhoneMirrorStatus(prev, { running: true, enabled: true, clients: 0, extensionConnected: true, extPairedAt: 2000 });
    assert.notEqual(next, prev);
    assert.equal(next.extPairedAt, 2000);
    assert.equal(next.port, 4123, 'the subset must not wipe the snapshot');
  });

  test('a full snapshot that only moves the stamp is not short-circuited', () => {
    const prev = full({ extPairedAt: 1000 });
    const next = mergePhoneMirrorStatus(prev, full({ extPairedAt: 2000 }));
    assert.equal(next.extPairedAt, 2000);
  });

  test('an identical snapshot still keeps prev (no extra render)', () => {
    const prev = full({ extPairedAt: 2000 });
    assert.equal(mergePhoneMirrorStatus(prev, full({ extPairedAt: 2000 })), prev);
  });
});

describe('extensionPairingSatisfied', () => {
  const armedAt = 5000;

  test('Re-pair: connected all along, stamp after the arm → satisfied', () => {
    assert.equal(extensionPairingSatisfied({ extensionConnected: true, extPairedAt: 5003 }, armedAt), true);
  });

  test('a stamp from an EARLIER pairing does not end a new window', () => {
    assert.equal(extensionPairingSatisfied({ extensionConnected: true, extPairedAt: 4000 }, armedAt), false);
  });

  test('paired but the socket is not up yet → keep waiting', () => {
    assert.equal(extensionPairingSatisfied({ extensionConnected: false, extPairedAt: 5003 }, armedAt), false);
  });

  test('no stamp (older desktop build, or never paired) → false', () => {
    assert.equal(extensionPairingSatisfied({ extensionConnected: true }, armedAt), false);
    assert.equal(extensionPairingSatisfied({ extensionConnected: true, extPairedAt: 0 }, 0), false);
    assert.equal(extensionPairingSatisfied(null, armedAt), false);
  });
});
