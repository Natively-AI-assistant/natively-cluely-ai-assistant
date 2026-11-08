// Granola parity (2026-10-16): follow the meeting app's microphone. The
// decision is pure; this covers which device is chosen and when a switch is
// made. The native device name (MicUser.deviceName) is injected.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dist = (p) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist-electron/electron/services', p);
const { meetingAppInputDevice, deviceToFollow } = require(dist('meetingDetection/followMicDevice.js'));

const MAC_SELF = { pid: 1, execPath: '/Applications/Natively.app/Contents/MacOS/Natively' };
const zoom = (deviceName) => ({ pid: 700, bundleId: 'us.zoom.xos', path: '/Applications/zoom.us.app/Contents/MacOS/zoom.us', deviceName });
const chromeHelper = (deviceName) => ({ pid: 910, bundleId: 'com.google.Chrome.helper', path: '/Applications/Google Chrome.app/Contents/Frameworks/x/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper', deviceName });

describe('meetingAppInputDevice', () => {
    test('returns the call app\'s device by name', () => {
        assert.equal(meetingAppInputDevice('darwin', [zoom('Jabra Evolve 65')], MAC_SELF), 'Jabra Evolve 65');
    });
    test('a meeting app wins over a browser', () => {
        assert.equal(meetingAppInputDevice('darwin', [chromeHelper('MacBook Pro Microphone'), zoom('Jabra Evolve 65')], MAC_SELF), 'Jabra Evolve 65');
    });
    test('our own process is ignored; a device-less or unknown process yields null', () => {
        assert.equal(meetingAppInputDevice('darwin', [{ pid: 1, path: '/Applications/Natively.app/Contents/MacOS/Natively', deviceName: 'X' }], MAC_SELF), null);
        assert.equal(meetingAppInputDevice('darwin', [zoom('')], MAC_SELF), null);
        assert.equal(meetingAppInputDevice('darwin', [zoom(null)], MAC_SELF), null);
        assert.equal(meetingAppInputDevice('darwin', null, MAC_SELF), null);
        assert.equal(meetingAppInputDevice('darwin', [{ pid: 9, path: '/Applications/TextEdit.app/x', deviceName: 'Y' }], MAC_SELF), null);
    });
    test('Windows reports no device name, so the result is null (feature inert)', () => {
        const WIN_SELF = { pid: 1, execPath: 'C\\\\Natively.exe' };
        assert.equal(meetingAppInputDevice('win32', [{ path: 'C\\\\Zoom\\\\bin\\\\Zoom.exe' }], WIN_SELF), null);
    });
});

describe('deviceToFollow', () => {
    const base = { enabled: true, userPinned: false, currentDeviceId: 'default', target: 'Jabra Evolve 65' };
    test('switches to the target when on, not pinned, and different from now', () => {
        assert.equal(deviceToFollow(base), 'Jabra Evolve 65');
    });
    test('does nothing when off, when the user pinned a device, or with no target', () => {
        assert.equal(deviceToFollow({ ...base, enabled: false }), null);
        assert.equal(deviceToFollow({ ...base, userPinned: true }), null);
        assert.equal(deviceToFollow({ ...base, target: null }), null);
    });
    test('does not switch to the device already in use (case-insensitive)', () => {
        assert.equal(deviceToFollow({ ...base, currentDeviceId: 'jabra evolve 65' }), null);
    });
});
