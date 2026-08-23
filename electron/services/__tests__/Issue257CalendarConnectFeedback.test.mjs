// Regression test for issue #257: when calendar auth failed, the main process
// returned { success: false, error }, but both renderer entry points ignored the
// error and reset the button to idle. Users experienced this as an unresponsive
// "Connect Calendar" button.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCalendarConnectErrorMessage } from '../../../src/lib/calendarConnectError.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('calendar connect error formatter handles main-process failure shapes', () => {
    const i18nSource = read('src/i18n.tsx');

    assert.equal(
        getCalendarConnectErrorMessage('access_denied'),
        'Google Calendar authorization was cancelled. Approve the consent prompt and try again.',
    );
    assert.equal(
        getCalendarConnectErrorMessage('exchange_failed status=403 access_denied'),
        'This Google account is not an approved test user yet. Contact Natively support, then try again.',
    );
    assert.equal(
        getCalendarConnectErrorMessage('access_denied: App has not completed verification'),
        'This Google account is not an approved test user yet. Contact Natively support, then try again.',
    );
    assert.equal(
        getCalendarConnectErrorMessage("access_denied: The developer hasn't given you access. This app is currently being tested."),
        'This Google account is not an approved test user yet. Contact Natively support, then try again.',
    );
    assert.equal(
        getCalendarConnectErrorMessage(new Error('GOOGLE_CLIENT_ID is not configured')),
        'Google Calendar is not configured for this build. Add a valid OAuth client ID and restart Natively.',
    );
    assert.equal(
        getCalendarConnectErrorMessage('Calendar auth timed out — port released.'),
        'Google Calendar authorization timed out. Try again.',
    );
    assert.equal(
        getCalendarConnectErrorMessage(),
        'Could not connect Google Calendar. Try again or contact Natively support.',
    );
    assert.equal(
        getCalendarConnectErrorMessage('x'.repeat(120)),
        `Could not connect Google Calendar: ${'x'.repeat(77)}...`,
    );
    assert.match(i18nSource, /Google Calendar authorization timed out/, 'calendar failure translations must be registered');
});

test('calendar auth preserves OAuth details and propagates browser launch failures', () => {
    const source = read('electron/services/CalendarManager.ts');

    assert.match(source, /qs\.get\('error_description'\)/, 'OAuth callback details must reach the renderer-facing error mapper');
    assert.match(source, /shell\.openExternal\(authUrl\)\.catch\(/, 'browser launch rejection must be observed');
    assert.match(source, /finish\(\(\) => reject\(err\)\)/, 'browser launch rejection must close the loopback server and reject the auth flow');
});

test('launcher calendar button surfaces calendarConnect failure instead of silently idling', () => {
    const source = read('src/components/ui/ConnectCalendarButton.tsx');

    assert.match(source, /getCalendarConnectErrorMessage/, 'launcher button must import the shared formatter');
    assert.match(source, /const \[connectError,\s*setConnectError\]/, 'launcher button must keep visible error state');
    assert.match(source, /setConnectError\(getCalendarConnectErrorMessage\(res\.error,\s*t\)\)/, 'success=false result must set localized visible error text');
    assert.match(source, /setConnectError\(getCalendarConnectErrorMessage\(err,\s*t\)\)/, 'thrown errors must set localized visible error text');
    assert.match(source, /connectError &&/, 'launcher button must render the error below the button');
    assert.match(source, /<p role="alert"/, 'launcher errors must be announced to assistive technology');
    assert.match(source, /max-h-16[^"]*overflow-y-auto/, 'launcher errors must remain readable inside the fixed-height card');
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
