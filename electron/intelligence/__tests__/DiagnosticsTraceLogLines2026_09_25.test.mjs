// node:test — Settings → Intelligence → Developer options → "Diagnostics trace".
//
// The switch promises: "Logs how each answer was routed, without transcript
// text. For support." An audit on 2026-09-25 found both halves broken:
//   • the [CONTEXT-OS] line wrote the first 80 characters of the question into
//     natively_debug.log (the file support is sent), and
//   • the structured per-answer record went into an in-memory ring nothing in
//     production reads, so turning the switch on produced no routing record a
//     user or support could ever retrieve.
// These tests capture console output — the debug log is the console, patched
// in main.ts — and pin both.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../../../dist-electron');
const cjsRequire = createRequire(import.meta.url);
const co = cjsRequire(path.resolve(distDir, 'electron/intelligence/context-os/index.js'));
const { beginTrace, commitTrace, __resetTraceRing } = await import('../../../dist-electron/electron/intelligence/IntelligenceTrace.js');
const { __resetIntelligenceFlagsCache } = await import('../../../dist-electron/electron/intelligence/intelligenceFlags.js');

const SECRET_QUESTION = 'what did Priya say about the Northwind ledger rollback';

function captureConsole(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => { lines.push(args.map(String).join(' ')); };
  try { fn(); } finally { console.log = orig; }
  return lines;
}

describe('[CONTEXT-OS] log line', () => {
  test('carries a hash and length of the question, never its text', () => {
    const trace = {
      turnId: 't1', surface: 'manual_chat', questionPreview: SECRET_QUESTION.slice(0, 80),
      activeModeId: 'general', sourceAuthority: 'profile_only', sourceOwner: 'profile',
      allowedSources: [], forbiddenSources: [], referentOnlySources: [], usedSources: [], rejectedSources: [],
      evidenceCoverage: { hasDirectEvidence: false, propertySatisfied: false, entityMatched: false, sourceOwnerSatisfied: false, confidence: 0 },
      selectedEvidenceCount: 0, candidateEvidenceCount: 0, finalAction: 'answer',
    };
    const lines = captureConsole(() => co.logContextOsTrace(trace));
    const line = lines.find((l) => l.startsWith('[CONTEXT-OS]'));
    assert.ok(line, 'the line is still written');
    assert.ok(!line.includes('Northwind') && !line.includes('Priya'), 'no question text in the log');
    const json = JSON.parse(line.slice('[CONTEXT-OS] '.length));
    assert.equal(json.questionPreview, undefined);
    assert.match(json.questionHash, /^[0-9a-f]{12}$/);
    assert.equal(json.questionLength, trace.questionPreview.length);
    assert.equal(trace.questionPreview, SECRET_QUESTION.slice(0, 80), 'the in-memory trace is untouched');
  });
});

describe('structured trace reaches the debug log', () => {
  beforeEach(() => {
    process.env.NATIVELY_INTELLIGENCE_TRACE = '1';
    __resetIntelligenceFlagsCache?.();
    __resetTraceRing();
  });
  afterEach(() => {
    delete process.env.NATIVELY_INTELLIGENCE_TRACE;
    __resetIntelligenceFlagsCache?.();
    __resetTraceRing();
  });

  test('a committed trace writes one [IntelligenceTrace] line with routing, no text', () => {
    const t = beginTrace(SECRET_QUESTION);
    assert.equal(t.enabled, true, 'precondition: the switch is on');
    t.setRouting({ answerType: 'factual' })
      .noteContext({ source: 'live_transcript', requested: true, retrieved: true, included: true })
      .noteContext({ source: 'hybrid_rag', requested: true, retrieved: false, included: false });
    const lines = captureConsole(() => commitTrace(t));
    const line = lines.find((l) => l.startsWith('[IntelligenceTrace]'));
    assert.ok(line, 'switch on → a routing line support can find in natively_debug.log');
    assert.ok(!line.includes('Northwind') && !line.includes('Priya'), 'no question text');
    const json = JSON.parse(line.slice('[IntelligenceTrace] '.length));
    assert.deepEqual(json.included, ['live_transcript']);
    assert.deepEqual(json.dropped, ['hybrid_rag']);
    assert.equal(json.queryLength, SECRET_QUESTION.length);
  });

  test('switch off → nothing is written', () => {
    delete process.env.NATIVELY_INTELLIGENCE_TRACE;
    __resetIntelligenceFlagsCache?.();
    const t = beginTrace(SECRET_QUESTION);
    const lines = captureConsole(() => commitTrace(t));
    assert.equal(lines.filter((l) => l.startsWith('[IntelligenceTrace]')).length, 0);
  });
});
