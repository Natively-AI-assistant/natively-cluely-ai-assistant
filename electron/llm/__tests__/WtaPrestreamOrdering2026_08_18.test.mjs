// electron/llm/__tests__/WtaPrestreamOrdering2026_08_18.test.mjs
//
// WTA audit 2026-08-18 (.audit/wta-audit.md F5/F6/F7): the two parallel
// pre-stream kicks were issued BEFORE question extraction and follow-up
// resolution, so:
//   F5 — mode/document retrieval was queried with the whole preparedTranscript
//        (both `query` and `transcript` slots) and answerType=undefined, so
//        with multiple questions in the window retrieval could fetch evidence
//        for the wrong one;
//   F6 — classifyIntent ran on the raw lastInterviewerTurn, never on the
//        resolved standalone question that drives the prompt;
//   F7 — the long-range lexical recall block was prepended to
//        preparedTranscript AFTER the retrieval prefetch had already captured
//        the pre-recall value, so recalled context never reached retrieval.
//
// Fix: both kicks move AFTER the (fully synchronous, sub-10ms) extraction +
// follow-up-resolution block, query on the resolved question, and pass a
// provisional answerType. They still run in PARALLEL with the expensive
// stages (profile grounding, generation prep) — the W5 overlap invariant in
// WtaParallelPrestream.test.mjs (kick < grounding await < intent join) is
// unchanged and still enforced there.
//
// Source-level pins (same convention as WtaParallelPrestream.test.mjs):
// these fail if the kicks are moved back above extraction or the query
// reverts to the transcript blob.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engineSrc = readFileSync(path.resolve(__dirname, '../../IntelligenceEngine.ts'), 'utf8');

describe('F5/F6/F7: pre-stream kicks run on the RESOLVED question, after extraction+resolution', () => {
  const kickIntent = engineSrc.indexOf('const intentPromise = classifyIntent(');
  const kickMode = engineSrc.indexOf('const modeContextPromise: Promise<string>');
  const extraction = engineSrc.indexOf('const extractedQuestion = extractLatestQuestion(');
  const resolutionDone = engineSrc.indexOf("trace.mark('latest_question_extracted'");
  const groundingAwait = engineSrc.indexOf('await withTimeout(orchestrator.processQuestion(');
  const intentJoin = engineSrc.indexOf('const intentResult = await intentPromise');

  test('kicks are AFTER question extraction and follow-up resolution', () => {
    assert.ok(extraction > 0 && resolutionDone > extraction, 'sanity: extraction precedes resolution mark');
    assert.ok(kickIntent > resolutionDone,
      `intent kick (${kickIntent}) must follow the resolution mark (${resolutionDone})`);
    assert.ok(kickMode > resolutionDone,
      `mode-retrieval kick (${kickMode}) must follow the resolution mark (${resolutionDone})`);
  });

  test('kicks still OVERLAP the expensive stages (kick < grounding await < intent join)', () => {
    assert.ok(kickIntent < groundingAwait && groundingAwait < intentJoin,
      `expected kick(${kickIntent}) < grounding(${groundingAwait}) < join(${intentJoin})`);
    assert.ok(kickMode < groundingAwait, 'mode retrieval must still overlap grounding');
  });

  test('F6: classifyIntent receives the resolved question, not the raw last turn', () => {
    const kickBlock = engineSrc.slice(kickIntent, kickIntent + 400);
    assert.match(kickBlock,
      /classifyIntent\(\s*question \|\| extractedQuestion\.latestQuestion \|\| lastInterviewerTurn/,
      'intent must classify the same resolved-question expression the plan uses');
  });

  test('F5: mode retrieval is queried with the resolved question (transcript-blob fallback only)', () => {
    assert.match(engineSrc, /const wtaPrefetchQuery =/);
    const q = engineSrc.indexOf('const wtaPrefetchQuery =');
    assert.ok(q > resolutionDone && q < kickMode, 'query is derived after resolution, before the kick');
    assert.match(engineSrc,
      /buildRetrievedActiveModeContextBlockHybrid\(\s*wtaPrefetchQuery,\s*preparedTranscript,/,
      'query slot = resolved question; transcript slot = prepared window');
  });

  test('F5: the prefetch passes a provisional answerType instead of undefined', () => {
    assert.match(engineSrc, /const wtaPrefetchAnswerType/);
    assert.match(engineSrc,
      /buildRetrievedActiveModeContextBlockHybrid\(\s*wtaPrefetchQuery,\s*preparedTranscript,\s*1800,\s*wtaPrefetchAnswerType,/);
  });

  test('F7: the kicks sit AFTER the long-range recall prepend, so retrieval sees recalled context', () => {
    const recallPrepend = engineSrc.indexOf('preparedTranscript = `${recall.block}');
    assert.ok(recallPrepend > 0, 'sanity: recall prepend exists');
    assert.ok(kickMode > recallPrepend,
      `mode-retrieval kick (${kickMode}) must follow the recall prepend (${recallPrepend})`);
  });
});
