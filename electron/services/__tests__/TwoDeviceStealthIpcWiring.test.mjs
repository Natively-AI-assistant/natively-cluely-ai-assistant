/**
 * Ticket 01 — ipcHandlers wires two-device-stealth phone commands.
 * Source-contract style (TrialBackendHardDisable prior art).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const ipc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');

test('phone-command router handles two-device-stealth with session + ack', () => {
  assert.match(ipc, /TwoDeviceStealthSession/);
  assert.match(ipc, /cmd\.type === 'two-device-stealth'/);
  assert.match(ipc, /session\.enter\(host\)/);
  assert.match(ipc, /session\.exit\(host\)/);
  assert.match(ipc, /session\.end\(host\)/);
  assert.match(ipc, /publishAck\(`two-device-stealth:\$\{result\.action\}`/);
  // Host adapter only uses overlay/undetectable/endMeeting — no keybind teardown calls
  const start = ipc.indexOf("cmd.type === 'two-device-stealth'");
  assert.ok(start >= 0);
  const slice = ipc.slice(start, start + 1200);
  assert.doesNotMatch(slice, /KeybindManager\.(getInstance|unregister)/);
  assert.doesNotMatch(slice, /\.unregisterAll\(/);
});
