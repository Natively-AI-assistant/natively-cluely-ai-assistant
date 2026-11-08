// Granola parity (2026-10-16): the macOS-before-14 microphone fallback. With no
// per-process list (micUsers null) but the OS saying the input is live
// (inputInUse), a known meeting app that has a window up is taken as the call.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dist = (p) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist-electron/electron/services', p);
const { detectMeeting } = require(dist('meetingDetection/detectMeeting.js'));

const MAC_SELF = { pid: 1, execPath: '/Applications/Natively.app/Contents/MacOS/Natively' };
const zoomWindow = { pid: 700, owner: 'zoom.us', title: 'Zoom Meeting', path: '/Applications/zoom.us.app/Contents/MacOS/zoom.us' };

describe('macOS < 14 mic fallback', () => {
    test('mic live + a meeting app window up is a call', () => {
        const d = detectMeeting({ platform: 'darwin', micUsers: null, inputInUse: true, windows: () => [zoomWindow], live: [], self: MAC_SELF });
        assert.equal(d?.app, 'Zoom');
        assert.equal(d?.via, 'app');
    });
    test('mic not live, or no meeting window, is not a call', () => {
        assert.equal(detectMeeting({ platform: 'darwin', micUsers: null, inputInUse: false, windows: () => [zoomWindow], live: [], self: MAC_SELF }), null);
        const textEdit = { pid: 9, owner: 'TextEdit', title: 'Untitled', path: '/Applications/TextEdit.app/Contents/MacOS/TextEdit' };
        assert.equal(detectMeeting({ platform: 'darwin', micUsers: null, inputInUse: true, windows: () => [textEdit], live: [], self: MAC_SELF }), null);
    });
    test('an audible meeting tab still wins over the window scan', () => {
        const d = detectMeeting({ platform: 'darwin', micUsers: null, inputInUse: true, windows: () => [zoomWindow], live: [{ key: 'meet:abc-defg-hij', provider: 'meet', via: 'browser', audible: true, seenAt: 1 }], self: MAC_SELF });
        assert.equal(d?.via, 'browser');
        assert.equal(d?.app, 'Google Meet');
    });
    test('without inputInUse the behaviour is exactly as before (null)', () => {
        assert.equal(detectMeeting({ platform: 'darwin', micUsers: null, windows: () => [zoomWindow], live: [], self: MAC_SELF }), null);
    });
});
