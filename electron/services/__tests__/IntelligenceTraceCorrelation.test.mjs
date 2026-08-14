// electron/services/__tests__/IntelligenceTraceCorrelation.test.mjs
//
// MEDIUM (audit finding #9) — IntelligenceTrace carried no correlation ids, so an
// answer could not be joined across the IPC boundary, the engine trace, and the
// PiLatencyTrace. setCorrelation() adds requestId/sessionId/meetingId/surface/
// modeId/retryCount/aborted/errorCategory — ids only, never raw content. This
// verifies the fields land on the record, are length-bounded markers, and that a
// no-op trace (flag off) silently ignores the call (backward compatible).
//
// Run under the Electron ABI so the import graph resolves like production:
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test <file>

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Enable the trace BEFORE importing the module (flag is read at beginTrace()).
process.env.NATIVELY_INTELLIGENCE_TRACE = 'on';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tracePath = path.resolve(__dirname, '../../../dist-electron/electron/intelligence/IntelligenceTrace.js');
const { beginTrace } = await import(pathToFileURL(tracePath).href);

describe('IntelligenceTrace.setCorrelation (audit finding #9)', () => {
  test('records correlation ids on the trace record', () => {
    const trace = beginTrace('what is your experience with react?');
    assert.equal(trace.enabled, true, 'trace must be enabled with the flag on');
    trace.setCorrelation({
      requestId: 'pi_1700000000000_7',
      sessionId: '42',
      meetingId: 'meeting-abc',
      surface: 'manual',
      modeId: 'sales',
      retryCount: 2,
      aborted: false,
      errorCategory: 'none',
    });
    const rec = trace.toRecord();
    assert.equal(rec.requestId, 'pi_1700000000000_7');
    assert.equal(rec.sessionId, '42');
    assert.equal(rec.meetingId, 'meeting-abc');
    assert.equal(rec.surface, 'manual');
    assert.equal(rec.modeId, 'sales');
    assert.equal(rec.retryCount, 2);
    assert.equal(rec.aborted, false);
    assert.equal(rec.errorCategory, 'none');
    // Privacy: the query itself is only ever a hash, never raw text.
    assert.doesNotMatch(JSON.stringify(rec), /experience with react/i, 'raw query must never appear in the record');
    assert.ok(rec.queryHash && rec.queryHash.length <= 12);
  });

  test('partial correlation only sets provided fields', () => {
    const trace = beginTrace('q');
    trace.setCorrelation({ requestId: 'r1', surface: 'what_to_answer' });
    const rec = trace.toRecord();
    assert.equal(rec.requestId, 'r1');
    assert.equal(rec.surface, 'what_to_answer');
    assert.equal(rec.sessionId, undefined);
    assert.equal(rec.meetingId, undefined);
  });

  test('over-long ids are bounded to a marker length', () => {
    const trace = beginTrace('q');
    const huge = 'x'.repeat(500);
    trace.setCorrelation({ requestId: huge, sessionId: huge, surface: huge, modeId: huge, errorCategory: huge });
    const rec = trace.toRecord();
    assert.ok(rec.requestId.length <= 64);
    assert.ok(rec.sessionId.length <= 64);
    assert.ok(rec.surface.length <= 24);
    assert.ok(rec.modeId.length <= 40);
    assert.ok(rec.errorCategory.length <= 32);
  });

  test('setCorrelation is chainable and never throws on junk input', () => {
    const trace = beginTrace('q');
    assert.doesNotThrow(() => {
      trace.setCorrelation({ retryCount: NaN, aborted: undefined })
           .setRouting({ answerType: 'identity_answer' })
           .setCorrelation({ requestId: '' });
    });
  });
});

describe('IntelligenceTrace.setCorrelation on the NO-OP trace (flag off semantics)', () => {
  test('NOOP trace ignores setCorrelation and returns itself', async () => {
    // Re-import with the flag OFF to get the NOOP from beginTrace.
    const prev = process.env.NATIVELY_INTELLIGENCE_TRACE;
    process.env.NATIVELY_INTELLIGENCE_TRACE = 'off';
    try {
      const trace = beginTrace('q');
      assert.equal(trace.enabled, false);
      const ret = trace.setCorrelation({ requestId: 'r' });
      assert.equal(ret, trace, 'chainable no-op');
      assert.equal(trace.toRecord(), null, 'no-op trace produces no record');
    } finally {
      process.env.NATIVELY_INTELLIGENCE_TRACE = prev;
    }
  });
});
