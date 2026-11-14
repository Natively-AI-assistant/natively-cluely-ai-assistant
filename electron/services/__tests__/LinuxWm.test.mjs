// Linux compositor adapters: pure parsers on fixture output, adapter logic on an
// injected exec. Sway/Hyprland are fixture-only (not run on those compositors).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const d = (p) => require(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist-electron/electron/services/linuxWm', p));
const { detectWm, createLinuxWm, withExecutable } = d('index.js');
const { parseKwinJournal, aotScript, dumpScript, BROWSER_CLASS } = d('kwin.js');
const { parseSwayTree, createSwayWm } = d('sway.js');
const { parseHyprClients, createHyprlandWm } = d('hyprland.js');

test('detectWm: per-compositor env, other OSes and GNOME have none', () => {
    assert.equal(detectWm('linux', { HYPRLAND_INSTANCE_SIGNATURE: 'x' }), 'hyprland');
    assert.equal(detectWm('linux', { SWAYSOCK: '/run/s' }), 'sway');
    assert.equal(detectWm('linux', { XDG_CURRENT_DESKTOP: 'KDE' }), 'kwin');
    assert.equal(detectWm('linux', { XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' }), null);
    assert.equal(detectWm('darwin', { XDG_CURRENT_DESKTOP: 'KDE' }), null);
    assert.equal(detectWm('win32', { SWAYSOCK: '/x' }), null);
    assert.equal(createLinuxWm('linux', { XDG_CURRENT_DESKTOP: 'GNOME' }, async () => null), null);
});

test('kwin: journal line with the nonce parses; other nonces and junk do not', () => {
    const json = JSON.stringify([{ pid: 12, title: 'Meet - abc', cls: 'brave-browser' }, { pid: 0, title: 'x', cls: 'y' }]);
    const text = `noise\nNATIVELY_WM other [{"pid":1}]\nNATIVELY_WM abc123 ${json}\n`;
    assert.deepEqual(parseKwinJournal(text, 'abc123'), [{ pid: 12, owner: 'brave-browser', title: 'Meet - abc' }]);
    assert.equal(parseKwinJournal(text, 'zzz'), null);
    assert.equal(parseKwinJournal('NATIVELY_WM abc123 {not json', 'abc123'), null);
});

test('kwin: scripts embed values as JSON (no injection through a title)', () => {
    const s = aotScript(42.9, 'a"); evil(); ("');
    assert.ok(s.includes('w.pid === 42 '));
    assert.ok(s.includes(JSON.stringify('a"); evil(); ("')));
    assert.ok(dumpScript('n1').includes('NATIVELY_WM n1 '));
});

const SWAY = JSON.stringify({ id: 1, nodes: [{ id: 2, nodes: [
    { id: 3, pid: 111, name: 'Zoom Meeting', app_id: null, window_properties: { class: 'zoom' }, nodes: [] },
    { id: 4, pid: 222, name: 'Natively', app_id: 'natively', nodes: [] }], floating_nodes: [] }], floating_nodes: [{ id: 5, pid: 333, name: 'pip', app_id: 'firefox' }] });

test('sway: tree flattened, xwayland class used, floating included', () => {
    assert.deepEqual(parseSwayTree(SWAY).map((w) => [w.pid, w.owner, w.title]),
        [[111, 'zoom', 'Zoom Meeting'], [222, 'natively', 'Natively'], [333, 'firefox', 'pip']]);
    assert.equal(parseSwayTree('nope'), null);
});

test('sway: always-on-top targets con_id of the exact pid+title, argv only', async () => {
    const calls = [];
    const wm = createSwayWm(async (argv) => { calls.push(argv); return argv.includes('get_tree') ? SWAY : ''; });
    assert.equal(await wm.setAlwaysOnTop(222, 'Natively'), true);
    assert.deepEqual(calls.at(-1), ['swaymsg', '[con_id=4] floating enable, sticky enable']);
    assert.equal(await wm.setAlwaysOnTop(222, 'other title'), false);
});

const HYPR = JSON.stringify([
    { address: '0xa', pid: 10, title: 'Natively', class: 'natively', mapped: true, hidden: false, floating: false, pinned: false },
    { address: '0xb', pid: 11, title: 'ghost', class: 'x', mapped: false },
    { address: '0xc', pid: 12, title: 'Natively', class: 'natively', mapped: true, floating: true, pinned: true }]);

test('hyprland: unmapped clients dropped; pin only when needed', async () => {
    assert.deepEqual(parseHyprClients(HYPR).map((w) => w.pid), [10, 12]);
    const calls = [];
    const wm = createHyprlandWm(async (argv) => { calls.push(argv.join(' ')); return argv[1] === 'clients' ? HYPR : 'ok'; });
    assert.equal(await wm.setAlwaysOnTop(10, 'Natively'), true);
    assert.deepEqual(calls.slice(1), ['hyprctl dispatch setfloating address:0xa', 'hyprctl dispatch pin address:0xa']);
    calls.length = 0;
    assert.equal(await wm.setAlwaysOnTop(12, 'Natively'), true);
    assert.equal(calls.length, 1); // already floating + pinned: no toggle
});

test('withExecutable: adds path/owner from /proc, keeps the window when unreadable', () => {
    assert.deepEqual(withExecutable({ pid: 5, owner: 'cls', title: 't' }, () => '/opt/zoom/zoom'), { pid: 5, owner: 'zoom', title: 't', path: '/opt/zoom/zoom' });
    assert.deepEqual(withExecutable({ pid: 5, owner: 'cls', title: 't' }, () => { throw new Error('x'); }), { pid: 5, owner: 'cls', title: 't' });
});

test('kwin: the journal dump carries titles only for browsers', () => {
    assert.ok(dumpScript('n1').includes('browser.test(w.resourceClass) ? w.caption : ""'));
    for (const c of ['brave-browser', 'firefox', 'Google-chrome', 'chromium']) assert.ok(BROWSER_CLASS.test(c), c);
    for (const c of ['org.kde.konsole', 'code', 'org.keepassxc.KeePassXC', 'zoom']) assert.ok(!BROWSER_CLASS.test(c), c);
});

test('window poller reads on demand, not on a timer', async () => {
    const { startWindowPoller } = d('index.js');
    let reads = 0, t = 0;
    const wm = { name: 'kwin', listWindows: async () => { reads++; return [{ pid: 1, owner: 'x', title: 'y' }]; }, setAlwaysOnTop: async () => true };
    const p = startWindowPoller(wm, 10_000, () => t);
    assert.equal(reads, 0, 'nothing runs until asked');
    assert.equal(p.get(), null);
    await new Promise((r) => setImmediate(r));
    assert.equal(reads, 1);
    assert.equal(p.get().length, 1);
    t = 5_000; p.get(); await new Promise((r) => setImmediate(r));
    assert.equal(reads, 1, 'fresh enough');
    t = 10_000; p.get(); await new Promise((r) => setImmediate(r));
    assert.equal(reads, 2, 'stale: one refresh');
    p.stop(); t = 99_000; p.get(); await new Promise((r) => setImmediate(r));
    assert.equal(reads, 2, 'stopped');
});

test('pinTitle makes a per-call unique title that keeps the visible text', () => {
    const { pinTitle } = d('types.js');
    const a = pinTitle('Natively', 'aa'), b = pinTitle('Natively', 'bb');
    assert.notEqual(a, b);
    assert.ok(a.startsWith('Natively'));
});
