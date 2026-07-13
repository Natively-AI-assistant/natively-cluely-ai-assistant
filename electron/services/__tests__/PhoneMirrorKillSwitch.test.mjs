import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(here, '..', '..');
const mainSource = fs.readFileSync(path.join(electronRoot, 'main.ts'), 'utf8');
const serviceSource = fs.readFileSync(path.join(electronRoot, 'services', 'PhoneMirrorService.ts'), 'utf8');

test('PhoneMirror diagnostic kill switch guards only startup', () => {
  const startAt = mainSource.indexOf('PhoneMirrorService.getInstance()\n      .start');
  const flagAt = mainSource.indexOf("process.env.NATIVELY_DISABLE_PHONE_MIRROR === '1'");

  assert.ok(flagAt >= 0, 'expected NATIVELY_DISABLE_PHONE_MIRROR startup guard');
  assert.ok(startAt > flagAt, 'expected guard to precede PhoneMirror auto-start');
  assert.match(mainSource, /NATIVELY_DISABLE_PHONE_MIRROR=1 → PhoneMirror WS server NOT started this run/);
});

test('PhoneMirror service port behavior remains unchanged', () => {
  assert.match(serviceSource, /const DEFAULT_PORT = 4123;/);
  assert.match(serviceSource, /const PORT_PROBE_RANGE = 12;/);
});
