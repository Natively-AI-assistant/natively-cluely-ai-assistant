// Linux identities for meeting detection: the executable's file name, with the
// platform injected so this runs on any OS (see MeetingAppsBreadth2026_10_15).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dist = (p) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist-electron/electron/services', p);
const { appOfProcess, isSelf } = require(dist('meetingDetection/meetingApps.js'));

const LINUX = [
    ['/opt/zoom/zoom', 'Zoom', 'meeting'],
    ['/usr/bin/teams-for-linux', 'Microsoft Teams', 'meeting'],
    ['/usr/bin/slack', 'Slack', 'messaging'],
    ['/usr/bin/discord', 'Discord', 'messaging'],
    ['/usr/bin/telegram-desktop', 'Telegram', 'messaging'],
    ['/usr/lib/firefox/firefox', 'Firefox', 'browser'],
    ['/opt/google/chrome/chrome', 'Google Chrome', 'browser'],
    ['/usr/lib/chromium/chromium', 'Google Chrome', 'browser'],
    ['/opt/brave.com/brave/brave', 'Brave', 'browser'],
];

test('linux: known executables resolve to their app', () => {
    for (const [p, name, kind] of LINUX) {
        const app = appOfProcess('linux', { path: p });
        assert.equal(app?.name, name, p);
        assert.equal(app?.kind, kind, p);
    }
});

test('linux: unknown executables and path-less processes are not apps', () => {
    assert.equal(appOfProcess('linux', { path: '/usr/bin/vim' }), null);
    assert.equal(appOfProcess('linux', {}), null);
});

test('linux: our own process is never a meeting', () => {
    const self = { pid: 500, execPath: '/opt/Natively/natively' };
    assert.equal(isSelf('linux', { pid: 500 }, self), true);
    assert.equal(isSelf('linux', { pid: 9, path: '/opt/Natively/natively' }, self), true);
    assert.equal(isSelf('linux', { pid: 9, path: '/usr/bin/slack' }, self), false);
});
