// src/lib/__tests__/PhoneMirrorStatusMerge2026_09_22.test.mjs
//
// Settings → Sync → "Allow LAN access" → confirm the dialog → the toggle snaps
// back OFF and the Enable row reads "On — port undefined · bound to undefined
// (loopback only)". Same after Enable Phone Mirror flips the server on.
//
// Why: the launcher window only receives the small flag subset of a
// `phone-mirror:status` broadcast ({ running, enabled, clients,
// extensionConnected } — see the onStatusChange listener in ipcHandlers.ts,
// kept small on purpose for software-composited Windows boxes). But
// PhoneMirrorSettings is mounted INSIDE the launcher (SettingsOverlay), holds
// the full PhoneMirrorInfo it got from get-info / the set-lan reply, and
// replaced that whole object with the subset on every broadcast. The debounced
// broadcast lands ~150 ms after the IPC reply, so the correct snapshot was
// visible for one frame and then port/bindAddress/exposeOnLan/URLs vanished.
//
// The merge is pure and platform-agnostic; it runs identically on macOS and
// Windows (CLAUDE.md).

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  isPartialPhoneMirrorStatus,
  mergePhoneMirrorStatus,
} from '../phoneMirrorStatusMerge.mjs';

/** Full snapshot as phone-mirror:get-info / set-lan return it. */
const full = (over = {}) => ({
  running: true,
  enabled: true,
  exposeOnLan: true,
  port: 4123,
  loopbackUrl: 'http://127.0.0.1:4123/?t=abc',
  primaryUrl: 'http://192.168.1.20:4123/?t=abc',
  lanUrls: ['http://192.168.1.20:4123/?t=abc'],
  token: 'abc',
  extToken: 'ext',
  qrDataUrl: 'data:image/png;base64,QR',
  clients: 0,
  extensionConnected: false,
  bindAddress: '0.0.0.0',
  ...over,
});

/** The launcher-side flag subset, exactly as ipcHandlers.ts builds it. */
const launcherSubset = (over = {}) => ({
  running: true,
  enabled: true,
  clients: 0,
  extensionConnected: false,
  ...over,
});

describe('isPartialPhoneMirrorStatus', () => {
  test('the launcher flag subset is partial', () => {
    assert.equal(isPartialPhoneMirrorStatus(launcherSubset()), true);
  });

  test('a full snapshot is not partial', () => {
    assert.equal(isPartialPhoneMirrorStatus(full()), false);
  });

  test('a stopped-server snapshot (port 0, loopback) is still a full snapshot', () => {
    assert.equal(
      isPartialPhoneMirrorStatus(
        full({ running: false, port: 0, bindAddress: '127.0.0.1', primaryUrl: null, qrDataUrl: null }),
      ),
      false,
    );
  });

  test('non-objects are treated as partial (nothing to take from them)', () => {
    assert.equal(isPartialPhoneMirrorStatus(null), true);
    assert.equal(isPartialPhoneMirrorStatus(undefined), true);
    assert.equal(isPartialPhoneMirrorStatus('running'), true);
  });
});

describe('mergePhoneMirrorStatus — the bug from the 2026-09-22 recording', () => {
  test('a launcher subset after the LAN restart keeps port / bindAddress / exposeOnLan', () => {
    // set-lan replied with the full LAN snapshot; 150 ms later the debounced
    // broadcast arrives as the launcher subset (extension not yet reconnected).
    const prev = full();
    const next = mergePhoneMirrorStatus(prev, launcherSubset({ extensionConnected: false }));
    assert.equal(next.port, 4123);
    assert.equal(next.bindAddress, '0.0.0.0');
    assert.equal(next.exposeOnLan, true);
    assert.equal(next.primaryUrl, prev.primaryUrl);
    assert.equal(next.qrDataUrl, prev.qrDataUrl);
    assert.equal(next.token, prev.token);
    assert.equal(next.extToken, prev.extToken);
    assert.deepEqual(next.lanUrls, prev.lanUrls);
  });

  test('a launcher subset still applies the flags it does carry', () => {
    const prev = full({ clients: 0, extensionConnected: false });
    const next = mergePhoneMirrorStatus(prev, launcherSubset({ clients: 1, extensionConnected: true }));
    assert.equal(next.clients, 1);
    assert.equal(next.extensionConnected, true);
    assert.equal(next.port, 4123, 'flag update must not wipe the rest');
  });

  test('a launcher subset that changes nothing returns the same object (no re-render)', () => {
    const prev = full({ clients: 2, extensionConnected: true });
    const next = mergePhoneMirrorStatus(prev, launcherSubset({ clients: 2, extensionConnected: true }));
    assert.equal(next, prev);
  });

  test('a subset carrying running:false flips the row to Off without inventing fields', () => {
    const prev = full();
    const next = mergePhoneMirrorStatus(prev, launcherSubset({ running: false, enabled: false }));
    assert.equal(next.running, false);
    assert.equal(next.enabled, false);
    assert.equal(next.bindAddress, '0.0.0.0', 'stale but defined until the full snapshot lands');
  });

  test('undefined flags inside a subset never overwrite known values', () => {
    const prev = full({ clients: 3 });
    const next = mergePhoneMirrorStatus(prev, { running: true, clients: undefined });
    assert.equal(next.clients, 3);
  });

  test('unknown keys in a broadcast are ignored', () => {
    const prev = full();
    const next = mergePhoneMirrorStatus(prev, launcherSubset({ bogus: 1 }));
    assert.equal('bogus' in next, false);
  });
});

describe('mergePhoneMirrorStatus — full snapshots keep the previous contract', () => {
  test('a full snapshot with a new QR / URL / token replaces the state', () => {
    const prev = full();
    const incoming = full({ token: 'rotated', primaryUrl: 'http://192.168.1.20:4123/?t=rotated', qrDataUrl: 'data:QR2' });
    assert.equal(mergePhoneMirrorStatus(prev, incoming), incoming);
  });

  test('a full snapshot that only differs in fields the UI does not key on keeps prev', () => {
    // Same short-circuit the component had before: identical qr/url/tokens/
    // running/clients/extensionConnected → keep prev so React skips the render.
    const prev = full();
    const incoming = full({ lanUrls: [...prev.lanUrls, 'http://10.0.0.5:4123/?t=abc'] });
    assert.equal(mergePhoneMirrorStatus(prev, incoming), prev);
  });

  test('a full snapshot flipping running replaces the state', () => {
    const prev = full();
    const incoming = full({ running: false, port: 0, bindAddress: '127.0.0.1', primaryUrl: null, qrDataUrl: null, token: null, extToken: null });
    assert.equal(mergePhoneMirrorStatus(prev, incoming), incoming);
  });

  test('a non-object broadcast keeps prev', () => {
    const prev = full();
    assert.equal(mergePhoneMirrorStatus(prev, null), prev);
    assert.equal(mergePhoneMirrorStatus(prev, undefined), prev);
  });
});
