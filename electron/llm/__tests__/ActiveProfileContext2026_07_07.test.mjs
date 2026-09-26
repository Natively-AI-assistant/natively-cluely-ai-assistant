// node:test — ActiveProfileContext canonical read model (2026-07-07).
// Verifies the pure projection over the orchestrator's active resume/JD:
// provenance (sourceId/documentHash), presence flags, and PII-free summary.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { buildActiveProfileContext, summarizeActiveProfileContext, hashStructured } =
  await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/ActiveProfileContext.js')).href);

const orchestrator = () => ({
  activeResume: { id: 31, source_uri: 'resume.pdf', created_at: '2026-07-05', structured_data: { identity: { name: 'Jordan Vale' } } },
  activeJD: { id: 32, source_uri: 'jd.pdf', created_at: '2026-07-07', structured_data: { title: 'Data Platform Engineer', requirements: ['SQL'] } },
});

describe('buildActiveProfileContext', () => {
  test('projects active resume + JD with provenance', () => {
    const ctx = buildActiveProfileContext(orchestrator());
    assert.equal(ctx.activeResume?.sourceId, 31);
    assert.equal(ctx.activeJD?.sourceId, 32);
    assert.ok(ctx.activeResume?.documentHash?.length > 0);
    assert.ok(ctx.activeJD?.documentHash?.length > 0);
    assert.equal(ctx.activeJD?.structured.title, 'Data Platform Engineer');
  });

  test('missing JD is omitted, never throws', () => {
    const ctx = buildActiveProfileContext({ activeResume: orchestrator().activeResume, activeJD: null });
    assert.ok(ctx.activeResume);
    assert.equal(ctx.activeJD, undefined);
  });

  test('null orchestrator → empty context, no throw', () => {
    assert.doesNotThrow(() => buildActiveProfileContext(null));
    assert.deepEqual(buildActiveProfileContext(null), {});
  });

  test('document with no structured_data is omitted', () => {
    const ctx = buildActiveProfileContext({ activeResume: { id: 5, structured_data: null }, activeJD: undefined });
    assert.equal(ctx.activeResume, undefined);
  });

  test('hash is stable for identical content, differs on change', () => {
    const a = hashStructured({ x: 1, y: [2, 3] });
    const b = hashStructured({ x: 1, y: [2, 3] });
    const c = hashStructured({ x: 1, y: [2, 4] });
    assert.equal(a, b);
    assert.notEqual(a, c);
  });
});

describe('summarizeActiveProfileContext', () => {
  test('returns IDs + hashes + presence flags only (PII-free)', () => {
    const s = summarizeActiveProfileContext(buildActiveProfileContext(orchestrator()));
    assert.equal(s.activeResumeId, 31);
    assert.equal(s.activeJDId, 32);
    assert.equal(typeof s.activeJDHash, 'string');
    assert.equal(s.hasCustomContext, false);
    assert.equal(s.hasPersona, false);
    // No raw content leaks into the summary.
    assert.ok(!JSON.stringify(s).includes('Data Platform Engineer'));
    assert.ok(!JSON.stringify(s).includes('Jordan Vale'));
  });
});
