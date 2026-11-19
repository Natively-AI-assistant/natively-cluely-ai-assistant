// 2026-11-19. The free trial's hardware id, read without the native module.
// Funnel 11-09..19: 23 installs never got a trial because LicenseManager's
// native module gave no id, while the rest of the app worked for them.
//
// The fallback must give EXACTLY the native module's value (SHA-256 of the
// machine-uid crate's id): a machine whose native module loads later must not
// get a second trial. The last test compares the two wherever the native module
// loads, so macOS and Windows CI each check their own branch for real; the
// other tests run both branches on any machine through injected deps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  parseIoregPlatformUuid, parseRegMachineGuid, readMachineId, machineHardwareIdFallback,
  hashMachineId, liveMachineIdDeps,
} from '../machineIdFallback.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const sha = (s) => createHash('sha256').update(s).digest('hex');

const IOREG = [
  '+-o J316sAP  <class IOPlatformExpertDevice, id 0x100000201, registered, matched, active, busy 0 (0 ms), retain 39>',
  '    {',
  '      "IOPlatformSerialNumber" = "XXXXXXXXXX"',
  '      "IOPlatformUUID" = "12345678-ABCD-4EF0-9876-0123456789AB"',
  '    }',
].join('\n');
const REG = '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0\r\n\r\n';

function deps(platform, { out = '', files = {}, env = { SystemRoot: 'C:\\Windows' }, fail = false } = {}) {
  const calls = [];
  return {
    calls,
    platform,
    env,
    execFile: async (file, args, opts) => { calls.push({ file, args, opts }); if (fail) throw new Error('spawn failed'); return out; },
    readFile: async (p) => { if (p in files) return files[p]; throw new Error('ENOENT'); },
  };
}

test('macOS: machine-uid\'s parse of ioreg', () => {
  assert.equal(parseIoregPlatformUuid(IOREG), '12345678-ABCD-4EF0-9876-0123456789AB');
  assert.equal(parseIoregPlatformUuid('nothing here'), null);
});

test('Windows: MachineGuid from reg query', () => {
  assert.equal(parseRegMachineGuid(REG), '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0');
  assert.equal(parseRegMachineGuid('ERROR: The system was unable to find the specified registry key or value.'), null);
});

test('darwin branch runs ioreg by absolute path, no shell, short timeout; hashes like the native module', async () => {
  const d = deps('darwin', { out: IOREG });
  const r = await machineHardwareIdFallback(d);
  assert.deepEqual(r, { hwid: sha('12345678-ABCD-4EF0-9876-0123456789AB'), source: 'ioreg' });
  assert.equal(d.calls[0].file, '/usr/sbin/ioreg');
  assert.deepEqual(d.calls[0].args, ['-rd1', '-c', 'IOPlatformExpertDevice']);
  assert.ok(d.calls[0].opts.timeout <= 5_000);
});

test('win32 branch runs reg.exe from the Windows directory, 64-bit view, hidden', async () => {
  const d = deps('win32', { out: REG });
  const r = await machineHardwareIdFallback(d);
  assert.deepEqual(r, { hwid: sha('0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'), source: 'registry' });
  assert.equal(d.calls[0].file, 'C:\\Windows\\System32\\reg.exe');
  assert.deepEqual(d.calls[0].args, ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64']);
  assert.equal(d.calls[0].opts.windowsHide, true);
  // No Windows directory known: no guess at a path.
  assert.equal(await readMachineId(deps('win32', { out: REG, env: {} })), null);
});

test('linux: dbus machine-id first, then /etc/machine-id', async () => {
  assert.deepEqual(await readMachineId(deps('linux', { files: { '/var/lib/dbus/machine-id': 'aaa\n', '/etc/machine-id': 'bbb\n' } })), { raw: 'aaa', source: 'machine_id_file' });
  assert.deepEqual(await readMachineId(deps('linux', { files: { '/etc/machine-id': 'bbb\n' } })), { raw: 'bbb', source: 'machine_id_file' });
});

test('no id: null, never a host name or a shared default (F-601: strangers on one trial row)', async () => {
  assert.equal(await machineHardwareIdFallback(deps('darwin', { out: 'no uuid' })), null);
  assert.equal(await machineHardwareIdFallback(deps('win32', { fail: true })), null);
  assert.equal(await machineHardwareIdFallback(deps('linux')), null);
  assert.equal(await machineHardwareIdFallback(deps('freebsd')), null, 'an unsupported platform is refused, not routed through another');
  assert.equal(await machineHardwareIdFallback(deps('aix')), null);
});

test('the trial asks LicenseManager, then its own load of the module, then the fallback; refuses with none', () => {
  const src = readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
  const at = src.indexOf('async function startTrialFlow(');
  const body = src.slice(at, at + 6000);
  const lm = body.indexOf('LicenseManager.getInstance().getHardwareId()');
  const own = body.indexOf('loadNativeModule()?.getHardwareId?.()');
  const fb = body.indexOf('machineHardwareIdFallback(liveMachineIdDeps())');
  const refuse = body.indexOf("return { ok: false, error: 'hardware_id_unavailable' }");
  assert.ok(lm > 0 && own > lm && fb > own && refuse > fb, 'order: licence module, own load, fallback, refusal');
  // The sentinel itself is never sent.
  assert.match(body, /own !== 'unavailable'/);
  assert.match(body, /hwidFrom = 'none';/);
});

// Real check: on a machine where the native module loads (macOS and Windows
// CI after build:native, a developer's checkout), the fallback equals it.
const nativeDir = path.join(root, 'native-module');
const bin = existsSync(nativeDir)
  ? (await import('node:fs')).readdirSync(nativeDir).find((f) => f.endsWith('.node') && f.includes(process.platform) && f.includes(process.arch))
  : undefined;
test('the fallback equals the native module\'s getHardwareId() on this machine', { skip: !bin && 'native module not built for this platform' }, async () => {
  const require = createRequire(import.meta.url);
  let native;
  try { native = require(path.join(nativeDir, bin)).getHardwareId(); } catch (e) { return; /* cannot load here: nothing to compare */ }
  const fb = await machineHardwareIdFallback(liveMachineIdDeps());
  assert.ok(fb, 'the fallback read an id');
  // Compared, never printed: the id is this machine's.
  assert.equal(fb.hwid === native, true, `fallback (${fb.source}) differs from the native id`);
  assert.equal(hashMachineId('x'), sha('x'));
});
