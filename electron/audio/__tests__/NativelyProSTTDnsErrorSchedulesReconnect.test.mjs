import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(__dirname, '../NativelyProSTT.ts');
const source = readFileSync(sourcePath, 'utf8');

function sourceWindow(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `could not locate ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `could not locate ${endMarker} after ${startMarker}`);
  return source.slice(start, end);
}

test('DNS WebSocket error schedules reconnect without waiting for close event', () => {
  const errorBody = sourceWindow("ws.on('error'", "ws.on('close'");

  assert.ok(/this\.isDnsFailure\s*=\s*err\.code\s*===\s*['"]ENOTFOUND['"]\s*\|\|\s*err\.code\s*===\s*['"]EAI_AGAIN['"]/.test(errorBody), 'BUG: DNS errors must be classified explicitly.');
  assert.ok(/this\.emit\(\s*['"]error['"]\s*,\s*err\s*\)/.test(errorBody), 'BUG: DNS errors must still emit status to main process.');
  assert.ok(/if\s*\(\s*this\.isDnsFailure\s*&&\s*this\.isActive\s*\)\s*{\s*this\.scheduleReconnect\(\s*\)\s*;\s*}/.test(errorBody), 'BUG: DNS errors must schedule reconnect directly; close may not be enough after ws reaches CLOSED.');
});

test('scheduleReconnect is idempotent while a reconnect timer exists', () => {
  const methodMatch = /private\s+scheduleReconnect\s*\(\s*\)\s*:\s*void\s*{([\s\S]*?)\n    }/.exec(source);
  assert.ok(methodMatch, 'could not locate scheduleReconnect method');

  assert.ok(/if\s*\(\s*!this\.isActive\s*\|\|\s*this\.reconnectTimer\s*\)\s*return\s*;/.test(methodMatch[1]), 'BUG: scheduleReconnect must ignore duplicate scheduling from error+close events.');
});

test('close handler clears the stale closed WebSocket reference', () => {
  const closeBody = sourceWindow("ws.on('close'", 'private scheduleReconnect');

  assert.ok(/if\s*\(\s*this\.ws\s*===\s*ws\s*\)\s*this\.ws\s*=\s*null\s*;/.test(closeBody), 'BUG: closed sockets must not remain as this.ws while retry timer is pending.');
});
