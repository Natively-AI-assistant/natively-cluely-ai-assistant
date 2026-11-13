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

test('permission-denied names the group fix, never asks the app to use sudo itself', () => {
    const t = linuxInputAccessHelp('permission-denied', 'ada');
    assert.match(t, /usermod -aG input ada/);
    assert.match(t, /log out/i);
    assert.match(t, /never runs as root/);
});

test('no-devices and unknown states each get their own message', () => {
    assert.match(linuxInputAccessHelp('no-devices'), /No keyboard device/);
    assert.match(linuxInputAccessHelp('missing'), /missing from this build/);
});
