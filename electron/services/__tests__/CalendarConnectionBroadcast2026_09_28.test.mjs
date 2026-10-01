// Disconnecting in Settings › Calendar left the Launcher card on "Calendar
// linked / see upcoming events" (2026-09-28): CalendarManager emitted
// connection-changed, but nothing told the windows. Drives the REAL compiled
// broadcaster against a fake manager and windows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const compiled = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist-electron/electron/services/calendar/calendarConnectionBroadcast.js');
const { broadcastCalendarConnection, CALENDAR_CONNECTION_CHANNEL } = require(compiled);

function rig(initiallyConnected) {
    const manager = Object.assign(new EventEmitter(), { getConnectionStatus: () => ({ connected: initiallyConnected }) });
    const sent = [];
    const win = (destroyed = false) => ({ isDestroyed: () => destroyed, webContents: { send: (...args) => sent.push(args) } });
    const windows = [win(), win(), win(true)];
    broadcastCalendarConnection(manager, () => windows);
    return { manager, sent };
}

test('a disconnect reaches every live window', () => {
    const { manager, sent } = rig(true);
    manager.emit('connection-changed', false);
    assert.deepEqual(sent, [[CALENDAR_CONNECTION_CHANNEL, false], [CALENDAR_CONNECTION_CHANNEL, false]]);
});

test('a connect made elsewhere (Settings) reaches the Launcher', () => {
    const { manager, sent } = rig(false);
    manager.emit('connection-changed', true);
    assert.equal(sent.length, 2);
    assert.equal(sent[0][1], true);
});

test('a token refresh re-announcing "connected" sends nothing', () => {
    const { manager, sent } = rig(true);
    manager.emit('connection-changed', true);
    manager.emit('connection-changed', true);
    assert.equal(sent.length, 0);
    manager.emit('connection-changed', false);
    manager.emit('connection-changed', true);
    assert.deepEqual(sent.map(([, c]) => c), [false, false, true, true]);
});
