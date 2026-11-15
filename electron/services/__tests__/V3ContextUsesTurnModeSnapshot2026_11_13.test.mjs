/**
 * The live V3 answer reads the turn's t0 mode and files, not the live mode
 * (pipeline forensics 2026-11-13, F-CTX-11).
 *
 * runWhatShouldISay snapshots the mode at t0 so a mode switch that lands while
 * the turn is parked at an await cannot split one answer across two modes. The
 * V3 retrieval context was the one reader left out: v3ModeRetrievalContext()
 * re-read ModesManager live, so the plan came from the old mode and the files
 * and policy from the new one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(__dirname, '../../IntelligenceEngine.ts'), 'utf8');

test('runWhatShouldISay hands its t0 mode and files to the V3 context', () => {
    const start = src.indexOf('async runWhatShouldISay(');
    const end = src.indexOf('\n    async ', start + 10);
    const body = src.slice(start, end > start ? end : undefined);
    assert.match(body, /this\.v3ModeRetrievalContext\(_screenPortText, \{ modeInfo: snapshotModeInfo, referenceFiles: snapshotReferenceFiles \}\)/,
        'the WTA V3 build must pass the t0 snapshot');
    assert.doesNotMatch(body, /this\.v3ModeRetrievalContext\(_screenPortText\)/, 'no live-mode read left on this path');
});

test('with a snapshot, the context names the snapshot mode even after a switch', async () => {
    const { IntelligenceEngine } = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js')).href);
    const fakeThis = { llmHelper: { getKnowledgeOrchestrator: () => null } };
    const snap = { modeInfo: { id: 'mode-before-switch', name: 'Before switch', templateType: 'general' }, referenceFiles: [] };
    const ctx = IntelligenceEngine.prototype.v3ModeRetrievalContext.call(fakeThis, undefined, snap);
    assert.ok(ctx, 'context builds from the snapshot');
    assert.equal(ctx.modeUniqueId, 'mode-before-switch');
    assert.equal(ctx.modeName, 'Before switch');
});
