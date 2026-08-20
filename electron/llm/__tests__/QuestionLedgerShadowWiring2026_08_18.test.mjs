// electron/llm/__tests__/QuestionLedgerShadowWiring2026_08_18.test.mjs
//
// WTA audit Phase 2 wiring: the QuestionLedger runs SHADOW-ONLY behind the
// default-OFF `questionLedgerShadow` flag — fed from the live transcript
// path, consulted only for an observe-only parity trace at WTA press time
// (the same pattern LiveTranscriptBrain uses). Zero behavior change while
// the flag is off; even when on, the ledger must never influence the answer.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engineSrc = readFileSync(path.resolve(__dirname, '../../IntelligenceEngine.ts'), 'utf8');

describe('flag', () => {
  test('questionLedgerShadow exists and defaults OFF', async () => {
    const { isIntelligenceFlagEnabled } = await import(
      pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/intelligence/intelligenceFlags.js')).href
    );
    delete process.env.NATIVELY_QUESTION_LEDGER_SHADOW;
    assert.equal(isIntelligenceFlagEnabled('questionLedgerShadow'), false, 'shadow must be opt-in');
    // registry pin: the key is declared with default: false
    const flagsSrc = readFileSync(path.resolve(__dirname, '../../intelligence/intelligenceFlags.ts'), 'utf8');
    assert.match(flagsSrc, /questionLedgerShadow: \{ env: 'NATIVELY_QUESTION_LEDGER_SHADOW', setting: 'questionLedgerShadowEnabled', default: false \}/);
  });
});

describe('wiring (source pins)', () => {
  test('handleTranscript feeds the ledger on final segments, gated by the flag', () => {
    const feed = engineSrc.indexOf("isIntelligenceFlagEnabled('questionLedgerShadow')");
    assert.ok(feed > 0, 'flag consulted in the engine');
    assert.match(engineSrc, /questionLedgerShadow\.ingestInterviewerTurn\(/);
    assert.match(engineSrc, /questionLedgerShadow\.ingestCandidateTurn\(/);
    // punctuation provenance (F9) rides into the ledger
    assert.match(engineSrc, /ingestInterviewerTurn\(\{[^}]*punctuationSource/s);
  });

  test('runWhatShouldISay records an observe-only parity trace, never included', () => {
    assert.match(engineSrc, /source: 'question_ledger_shadow', trustLevel: 'low'/);
    const block = engineSrc.slice(
      engineSrc.indexOf("source: 'question_ledger_shadow'") - 600,
      engineSrc.indexOf("source: 'question_ledger_shadow'") + 900,
    );
    assert.match(block, /included: false/, 'ledger output must never enter the answer path');
    assert.match(block, /ledger_(parity|divergence)/, 'divergence vs parity is what shadow mode measures');
  });

  test('the parity trace runs AFTER follow-up resolution (compares the FINAL question)', () => {
    const resolutionDone = engineSrc.indexOf("trace.mark('latest_question_extracted'");
    const parity = engineSrc.indexOf("source: 'question_ledger_shadow'");
    assert.ok(parity > resolutionDone, 'parity must compare against the resolved question');
  });
});
