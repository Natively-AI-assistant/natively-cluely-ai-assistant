/**
 * Tickets 02/03 — phone UI stealth controls + USB adb copy in Sync settings.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

test('phone Mirror client exposes enter/exit/end two-device stealth controls', () => {
  const src = fs.readFileSync(
    path.join(root, 'electron/services/phoneMirrorClient.ts'),
    'utf8',
  );
  assert.match(src, /stealthEnterBtn/);
  assert.match(src, /stealthExitBtn/);
  assert.match(src, /stealthEndBtn/);
  assert.match(src, /type: 'two-device-stealth'/);
  assert.match(src, /op: 'enter'|op: op/);
  assert.match(src, /sendTwoDeviceStealth\('enter'\)/);
  assert.match(src, /sendTwoDeviceStealth\('exit'\)/);
  assert.match(src, /sendTwoDeviceStealth\('end'\)/);
});

test('Sync settings lead with iPhone LAN path; Android USB is advanced', () => {
  const src = fs.readFileSync(
    path.join(root, 'src/components/settings/PhoneMirrorSettings.tsx'),
    'utf8',
  );
  assert.match(src, /iPhone/);
  assert.match(src, /Allow LAN/);
  assert.match(src, /Advanced — Android USB/);
  assert.match(src, /adb reverse tcp:\$\{info\.port\} tcp:\$\{info\.port\}/);
  assert.match(src, /info\.loopbackUrl/);
  assert.match(src, /onCopyAdb/);
  assert.doesNotMatch(
    src,
    /USB path \(Android\) — no Allow LAN/,
    'Android USB must not be the headline panel anymore',
  );
});
