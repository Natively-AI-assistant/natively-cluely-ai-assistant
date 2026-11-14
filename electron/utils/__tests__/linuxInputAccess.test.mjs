import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { linuxInputAccessHelp } = require(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist-electron/electron/utils/linuxInputAccess.js'));

test('ok needs no help', () => {
    assert.equal(linuxInputAccessHelp('ok'), null);
});

test('permission-denied recommends the narrow udev rule first, then the group with its risk', () => {
    const t = linuxInputAccessHelp('permission-denied', 'ada');
    assert.ok(t.indexOf('udev') < t.indexOf('usermod'), 'udev rule is presented first');
    assert.match(t, /usermod -aG input ada/);
    assert.match(t, /EVERY process.*keylogger-equivalent/s);
    assert.match(t, /never runs these commands or uses sudo/);
    assert.match(t, /log out/i);
});

test('no-devices and unknown states each get their own message', () => {
    assert.match(linuxInputAccessHelp('no-devices'), /No keyboard device/);
    assert.match(linuxInputAccessHelp('missing'), /missing from this build/);
});
