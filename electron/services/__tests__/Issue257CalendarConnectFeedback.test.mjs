// Regression test for issue #257: when calendar auth failed, the main process
// returned { success: false, error }, but both renderer entry points ignored the
// error and reset the button to idle. Users experienced this as an unresponsive
// "Connect Calendar" button.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('calendar connect error formatter separates user denial from Google test-user blocking', () => {
    const source = read('src/lib/calendarConnectError.ts');
    const i18nSource = read('src/i18n.tsx');

    assert.match(source, /access_denied/, 'formatter must recognize Google OAuth access_denied failures');
    assert.match(source, /authorization was cancelled/, 'access_denied must be shown as a declined consent prompt');
    assert.match(source, /status=403/, 'formatter must recognize blocked Google OAuth exchange failures');
    assert.match(source, /test user/, 'blocked Google OAuth exchange failures must mention the current test-user limitation');
    assert.match(source, /Could not connect Google Calendar/, 'formatter must provide a fallback connection failure message');
    assert.match(source, /translate\(DEFAULT_CALENDAR_CONNECT_ERROR\)/, 'known calendar failures must use the active UI translator');
    assert.match(i18nSource, /Google Calendar authorization timed out/, 'calendar failure translations must be registered');
});

test('launcher calendar button surfaces calendarConnect failure instead of silently idling', () => {
    const source = read('src/components/ui/ConnectCalendarButton.tsx');

    assert.match(source, /getCalendarConnectErrorMessage/, 'launcher button must import the shared formatter');
    assert.match(source, /const \[connectError,\s*setConnectError\]/, 'launcher button must keep visible error state');
    assert.match(source, /setConnectError\(getCalendarConnectErrorMessage\(res\.error,\s*t\)\)/, 'success=false result must set localized visible error text');
    assert.match(source, /setConnectError\(getCalendarConnectErrorMessage\(err,\s*t\)\)/, 'thrown errors must set localized visible error text');
    assert.match(source, /connectError &&/, 'launcher button must render the error below the button');
    assert.match(source, /<p role="alert"/, 'launcher errors must be announced to assistive technology');
});

test('settings calendar tab surfaces calendarConnect failure instead of silently idling', () => {
    const source = read('src/components/SettingsOverlay.tsx');

    assert.match(source, /getCalendarConnectErrorMessage/, 'settings must import the shared formatter');
    assert.match(source, /const \[calendarError,\s*setCalendarError\]/, 'settings must keep visible calendar error state');
    assert.match(source, /setCalendarError\(getCalendarConnectErrorMessage\(res\.error,\s*t\)\)/, 'success=false result must set localized visible error text');
    assert.match(source, /setCalendarError\(getCalendarConnectErrorMessage\(e,\s*t\)\)/, 'thrown errors must set localized visible error text');
    assert.match(source, /calendarError &&/, 'settings must render the error below the button');
    assert.match(source, /<div role="alert"/, 'settings errors must be announced to assistive technology');
});
