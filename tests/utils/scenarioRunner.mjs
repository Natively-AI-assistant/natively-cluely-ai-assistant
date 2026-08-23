// tests/utils/scenarioRunner.mjs
// Drives a single mode scenario through ModesManager + ModeContextRetriever:
//   1. seed mode with reference files and custom context
//   2. set as active mode
//   3. run the retrieval query
//   4. build the active-mode context block
//   5. return everything the test needs to assert on
//
// We deliberately exercise the LEXICAL retriever (ModeContextRetriever.retrieve)
// rather than the hybrid one, because the hybrid one falls back to the same
// lexical scoring in this test environment (no embedding provider booted). The
// fallback path is covered separately by ModeHybridRetriever.test.mjs.

import { ModeContextRetriever } from '../../dist-electron/electron/services/ModeContextRetriever.js';

/**
 * @param {object} params
 * @param {{ id: string, name: string, templateType: string, customContext: string }} params.mode
 * @param {Array<{ id: string, modeId: string, fileName: string, content: string }>} params.files
 * @param {string} params.query
 * @param {string} [params.transcript]
 * @param {number} [params.tokenBudget]
 * @param {object} [params.options]
 */
export function runScenario({ mode, files, query, transcript, tokenBudget, options }) {
  const retriever = new ModeContextRetriever();
  const result = retriever.retrieve(
    {
      id: mode.id,
      name: mode.name,
      templateType: mode.templateType,
      customContext: mode.customContext ?? '',
      isActive: true,
      createdAt: '2026-05-15T00:00:00.000Z',
    },
    files,
    { query, transcript, tokenBudget, ...(options || {}) }
  );
  return result;
}

/**
 * Builds a mode object that mimics what ModesManager.getActiveMode returns.
 */
export function makeMode(id, templateType, customContext = '') {
  return {
    id,
    name: templateType,
    templateType,
    customContext,
  };
}

/**
 * Wraps content arrays into the ModeReferenceFile shape ModeContextRetriever
 * expects, generating stable IDs.
 */
export function asReferenceFiles(modeId, items) {
  return items.map((item, i) => ({
    id: `ref_${modeId}_${i}`,
    modeId,
    fileName: item.fileName,
    content: item.content,
    createdAt: '2026-05-15T00:00:00.000Z',
  }));
}
