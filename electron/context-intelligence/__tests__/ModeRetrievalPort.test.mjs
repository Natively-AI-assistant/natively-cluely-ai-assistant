// Phase 6 — the shared mode-retrieval-port factory.
//
// Three surfaces construct the same fail-closed port (manual chat handler, WTA,
// runManualAnswer). The registry it declares decides what evidence a turn may
// see, and two inline copies of that construction is how the tokenizer copies
// drifted — so there is one factory, and this file pins its contract.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { createModeRetrievalPort } = await import(pathToFileURL(path.join(base, 'retrieval/mode-retrieval-port.js')).href);
const { decide } = await import(pathToFileURL(path.join(base, 'orchestration/orchestrator.js')).href);

const decision = decide({
  requestId: 'r1', requestSequence: 1, surface: 'what-to-answer',
  modeId: 'seminar', scope: { userId: 'local' }, sessionId: 's',
  manualQuestion: 'According to the document, what is the discount floor?',
});

const port = (chunks, files = [{ id: 'f1' }]) => createModeRetrievalPort({
  modesManager: { retrieveHybridRaw: async () => ({ chunks }) },
  modeInfo: { id: 'm1' }, files, tokenBudget: 3600, userId: 'local',
});

describe('mode retrieval port', () => {
  test('a declared file is admitted with full provenance', async () => {
    const r = await port([{ sourceId: 'f1', fileName: 'pricing.json', text: 'floor is 17 percent', chunkIndex: 0, score: 0.9 }])
      .retrieve({ decision });
    assert.equal(r.evidence.length, 1);
    const e = r.evidence[0];
    assert.equal(e.sourceType, 'REFERENCE_FILE');
    assert.equal(e.scopeId, 'u:local');
    assert.equal(e.versionId, 'legacy');
    assert.equal(e.retrievedVersionId, 'legacy');
  });

  test('fails CLOSED on a sourceId outside the declared file set', async () => {
    // A stale index row or another mode's file: under the old fail-open opt-ins
    // only the source-type lookup stood in the way. The factory declares
    // type, version AND scope per file precisely so this rejects.
    const r = await port([{ sourceId: 'ROGUE', text: 'leaked', chunkIndex: 0, score: 0.99 }])
      .retrieve({ decision });
    assert.equal(r.evidence.length, 0);
    assert.equal(r.attempts[0].rejections[0].reason, 'UNKNOWN_SOURCE_TYPE');
  });

  test('no mode / no files means no retrieval, not a throw', async () => {
    const p = createModeRetrievalPort({
      modesManager: { retrieveHybridRaw: async () => { throw new Error('must not be called'); } },
      modeInfo: null, files: [], tokenBudget: 3600, userId: 'local',
    });
    const r = await p.retrieve({ decision });
    assert.deepEqual(r.evidence, []);
  });

  test('a userId mismatch between port and turn rejects everything — the trap the factory exists to prevent', async () => {
    const p = createModeRetrievalPort({
      modesManager: { retrieveHybridRaw: async () => ({ chunks: [{ sourceId: 'f1', text: 'x', chunkIndex: 0, score: 0.9 }] }) },
      modeInfo: { id: 'm1' }, files: [{ id: 'f1' }], tokenBudget: 3600, userId: 'someone-else',
    });
    const r = await p.retrieve({ decision });
    assert.equal(r.evidence.length, 0, 'containment requires the SAME userId on registry and turn');
    assert.equal(r.attempts[0].rejections[0].reason, 'OUT_OF_SCOPE');
  });
});
