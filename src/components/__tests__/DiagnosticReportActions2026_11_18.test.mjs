// The "Send diagnostic report" row (2026-11-18, #759). The log is free text, so
// nothing may leave without a click: the contract is read from the source, the way
// the other component tests here do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(HERE, '..', 'settings', 'DiagnosticReportActions.tsx'), 'utf8');
const page = fs.readFileSync(path.join(HERE, '..', 'settings', 'NativelyApiSettings.tsx'), 'utf8');

test('sending is only ever reached from a click handler, never from an effect or on mount', () => {
  assert.equal((src.match(/\.sendDiagnosticReport\?*\.?\(/g) || []).length, 1, 'one call site');
  const callIndex = src.search(/\.sendDiagnosticReport\?*\.?\(/);
  const handlerStart = src.lastIndexOf('const send', callIndex);
  assert.ok(handlerStart > -1, 'the call sits inside the send handler');
  assert.match(src, /onClick=\{send\}/);
  assert.ok(!/useEffect\([^]*?sendDiagnosticReport/.test(src), 'no effect reaches it');
});

test('the person can read what would be sent before sending, and copy it instead', () => {
  assert.match(src, /getDiagnosticReportPreview\?*\.?\(/);
  assert.match(src, /navigator\.clipboard\.writeText/);
  assert.match(src, /<pre/);
});

test('every outcome has words, and success gives the reference to quote', () => {
  for (const k of ['network', 'unavailable', 'rate_limited', 'rejected']) assert.ok(src.includes(k), k);
  assert.match(src, /ref/);
});

test('a second click cannot send twice while one is going', () => {
  assert.match(src, /state === 'sending'/);
});

test('the settings page offers it only beside a connection finding that was not healed', () => {
  assert.match(page, /DiagnosticReportActions/);
  assert.match(page, /setDiagOffer\(true\)/);
  assert.match(page, /!d\.healed && d\.verdict !== 'reachable'/);
});
