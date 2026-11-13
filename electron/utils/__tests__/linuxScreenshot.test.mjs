import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { linuxCaptureCommands, captureLinuxScreenshot, isWaylandSession } = require(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist-electron/electron/utils/linuxScreenshot.js'));

test('wayland full-screen leads with grim, X11 never lists it', () => {
    assert.equal(linuxCaptureCommands('/o.png', false, true)[0][0], 'grim');
    assert.ok(!linuxCaptureCommands('/o.png', false, false).some((c) => c[0] === 'grim'));
});

test('interactive uses region flags and skips grim', () => {
    const cmds = linuxCaptureCommands('/o.png', true, true);
    assert.ok(!cmds.some((c) => c[0] === 'grim'));
    assert.deepEqual(cmds.find((c) => c[0] === 'spectacle'), ['spectacle', '-b', '-n', '-r', '-o', '/o.png']);
});

test('falls through missing tools and tools that write nothing', async () => {
    const tried = [];
    const run = async (c) => {
        tried.push(c[0]);
        if (c[0] === 'grim') { const e = new Error('x'); e.code = 'ENOENT'; throw e; }
    };
    let wrote = false;
    await captureLinuxScreenshot('/o.png', false, {
        wayland: true, run: async (c) => { await run(c); if (c[0] === 'gnome-screenshot') wrote = true; },
        exists: () => wrote,
    });
    assert.deepEqual(tried, ['grim', 'spectacle', 'gnome-screenshot']);
});

test('reports every failure when nothing works', async () => {
    await assert.rejects(
        captureLinuxScreenshot('/o.png', false, { wayland: false, run: async () => {}, exists: () => false }),
        /No screenshot tool worked.*spectacle: no file written/);
});

test('session detection', () => {
    assert.equal(isWaylandSession({ XDG_SESSION_TYPE: 'wayland' }), true);
    assert.equal(isWaylandSession({ XDG_SESSION_TYPE: 'x11', WAYLAND_DISPLAY: 'w0' }), false);
    assert.equal(isWaylandSession({}), false);
});
