// summarizeUpdateDownload — tells differential from full update downloads in the log.
//
// Numbers are real: 793052970 is the 2.9.0 arm64 updater ZIP, and 448.2 MB is what
// electron-updater's own downloadPlanBuilder computed for a 2.8.8 -> 2.9.0
// differential against the published 2.8.8 ZIP (2026-09-22). The helper is
// platform-independent (the same event shape drives the macOS ZIP and the Windows
// NSIS installer), so a Windows installer size is exercised too.
//
// Imports the compiled bundle, like the other electron/update tests.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { summarizeUpdateDownload } = await import(
  pathToFileURL(path.resolve(__dirname, '../../dist-electron/electron/update/updateDownloadSummary.js')).href
);

test('macOS ZIP: progress total below the file size is a differential download', () => {
  const s = summarizeUpdateDownload(448_200_000, 793_052_970);
  assert.equal(s.kind, 'differential');
  assert.equal(s.message, 'differential download: fetched 448.2 MB of 793.1 MB (57%)');
});

test('Windows NSIS installer: progress total equal to the file size is a full download', () => {
  const s = summarizeUpdateDownload(890_812_552, 890_812_552);
  assert.equal(s.kind, 'full');
  assert.match(s.message, /^full download: 890\.8 MB/);
});

test('missing progress (no events) or unreadable file is reported as unknown, never guessed', () => {
  assert.equal(summarizeUpdateDownload(null, 793_052_970).kind, 'unknown');
  assert.equal(summarizeUpdateDownload(448_200_000, null).kind, 'unknown');
  assert.equal(summarizeUpdateDownload(undefined, undefined).message, 'download finished (fetched=?, file=?)');
  assert.equal(summarizeUpdateDownload(0, 10).kind, 'unknown');
});
