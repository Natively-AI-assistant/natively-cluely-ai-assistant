// A startup demotion is not permanent for the session (2026-09-11).
//
// Measured on a phone-hotspot network: the pinned natively provider failed
// 2/3 startup probes, the resolver fell through to the bundled model, and the
// whole session ran 384-d MiniLM — every persisted voyage-4 vector stranded,
// every reference-file query lexical, "the meeting notes weren't retrieved for
// this turn". A MID-SESSION promotion re-probes its primary every minute and
// demotes when it answers; a STARTUP demotion had no such path.

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import os from 'node:os';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
// The bundled LocalEmbeddingProvider reads electron's `app` at construction;
// under plain node `require('electron')` is the binary path. Give it an app.
const require = createRequire(import.meta.url);
const electronId = require.resolve('electron');
require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: { app: { isPackaged: false, getAppPath: () => root, getPath: () => os.tmpdir() } } };
const { EmbeddingProviderResolver } = await import(pathToFileURL(
  path.resolve(root, 'dist-electron/electron/rag/EmbeddingProviderResolver.js')).href);

const pinnedNatively = { embeddingMode: 'manual', embeddingProvider: 'natively', nativelyApiKey: 'nk_test_key_1234567890' };

function withProbe(outcomeByName) {
  const original = EmbeddingProviderResolver.probeAvailable;
  EmbeddingProviderResolver.probeAvailable = mock.fn(async (provider) => outcomeByName[provider.name] ?? 'transient');
  return () => { EmbeddingProviderResolver.probeAvailable = original; };
}

describe('resolveWithDemotion names the pinned provider that failed transiently', () => {
  test('pinned natively, transient failure → bundled model now, natively handed back for re-probing', async () => {
    const restore = withProbe({ natively: 'transient' });
    try {
      const r = await EmbeddingProviderResolver.resolveWithDemotion(pinnedNatively);
      assert.equal(r.provider.name, 'local');
      assert.equal(r.demotedPinned?.name, 'natively', 'the pinned provider is returned so the pipeline can re-probe it');
    } finally { restore(); }
  });
  test('pinned natively, PERMANENT auth failure → nothing to wait for', async () => {
    const restore = withProbe({ natively: 'permanent' });
    try {
      const r = await EmbeddingProviderResolver.resolveWithDemotion(pinnedNatively);
      assert.equal(r.provider.name, 'local');
      assert.equal(r.demotedPinned, null);
    } finally { restore(); }
  });
  test('pinned natively, available → selected, nothing demoted', async () => {
    const restore = withProbe({ natively: 'available' });
    try {
      const r = await EmbeddingProviderResolver.resolveWithDemotion(pinnedNatively);
      assert.equal(r.provider.name, 'natively');
      assert.equal(r.demotedPinned, null);
    } finally { restore(); }
  });
  test('auto mode (nothing pinned) never hands a provider back', async () => {
    const restore = withProbe({ natively: 'transient' });
    try {
      const r = await EmbeddingProviderResolver.resolveWithDemotion({ embeddingMode: 'auto', nativelyApiKey: 'nk_test_key_1234567890' });
      assert.equal(r.provider.name, 'local');
      assert.equal(r.demotedPinned, null);
    } finally { restore(); }
  });
  test('resolve() is unchanged for every existing caller', async () => {
    const restore = withProbe({ natively: 'available' });
    try {
      const p = await EmbeddingProviderResolver.resolve(pinnedNatively);
      assert.equal(p.name, 'natively');
    } finally { restore(); }
  });
});

describe('the pipeline re-probes a startup-demoted pinned provider (source pins)', () => {
  const src = fs.readFileSync(path.resolve(root, 'electron/rag/EmbeddingPipeline.ts'), 'utf8');
  test('initialization reads the demotion and schedules the re-probe', () => {
    assert.match(src, /const resolution = await EmbeddingProviderResolver\.resolveWithDemotion\(config\);/);
    const block = src.slice(src.indexOf('if (resolution.demotedPinned)'), src.indexOf('// Check for previous embedding-SPACE mismatches'));
    assert.match(block, /this\.schedulePrimaryReprobe\(pinned\)/, 'the interval re-probe is armed');
    assert.match(block, /setTimeout\(\(\) => \{ void this\.reprobePrimaryOnce\(pinned\); \}, BOOT_REPROBE_FIRST_DELAY_MS\)/, 'an early first probe runs too');
  });
  test('the first probe lands before the deferred auto re-index would start', () => {
    const m = src.match(/export const BOOT_REPROBE_FIRST_DELAY_MS = (\d[\d_]*);/);
    assert.ok(m, 'BOOT_REPROBE_FIRST_DELAY_MS is declared');
    const rag = fs.readFileSync(path.resolve(root, 'electron/rag/RAGManager.ts'), 'utf8');
    const d = rag.match(/AUTO_REINDEX_DEFER_MS = (\d[\d_]*);/);
    assert.ok(d, 'AUTO_REINDEX_DEFER_MS is declared');
    assert.ok(Number(m[1].replace(/_/g, '')) < Number(d[1].replace(/_/g, '')), 'first re-probe < auto-reindex defer');
  });
  test('the interval and the early probe share one restore routine', () => {
    assert.match(src, /private async reprobePrimaryOnce\(primary: IEmbeddingProvider\): Promise<boolean>/);
    assert.match(src, /setInterval\(\(\) => \{ void this\.reprobePrimaryOnce\(primary\); \}, PRIMARY_REPROBE_INTERVAL_MS\)/);
  });
});
