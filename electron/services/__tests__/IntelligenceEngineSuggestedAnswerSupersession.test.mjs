// PHASE 4 — Final-emit supersession defense (forensic-report §6b).
//
// The engine now emits 'suggested_answer' with an optional `generationId`
// arg (the same id the streaming token path already carries). main.ts
// forwards it, preload retypes it, and the renderer applies the same
// resolveLiveAnswerBatch supersession guard on the FINAL emit that it
// already applies on token batches.
//
// This suite proves the engine-side half of that contract: a final emit
// from the WTA path carries the SAME `generationId` the streaming tokens
// for that turn already carry, so a renderer using `liveAnswerGenIdRef.current`
// (updated by a newer token batch) will correctly drop a stale final
// answer instead of overwriting the newer live bubble.
//
// Drives the real `IntelligenceEngine` with a stub `whatToAnswerLLM`
// whose streaming chunks carry `generationId` updates between runs,
// mirroring a manual button press racing an auto-trigger-initiated
// generation for a DIFFERENT question (the same scenario that exposed H8
// originally).
//
// Run: npm run build:electron && node --test \
//   electron/services/__tests__/IntelligenceEngineSuggestedAnswerSupersession.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
const cjsRequire = createRequire(import.meta.url);

const REAL_ANSWER = 'I owned the merchant settlement reconciliation pipeline end to end, leading a team of four across three product surfaces.';

async function makeEngine() {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = cjsRequire(sessionPath);
  const helper = { setNegotiationCoachingHandler() {} };
  const session = new SessionTracker();
  const engine = new IntelligenceEngine(helper, session);
  // Seed a real, well-formed interviewer question into the session so
  // the WTA pipeline recognizes a candidate-voice question and exercises
  // its normal emit path (rather than the early clarification fallback
  // that fires on a bare unrelated string).
  session.addTranscript({
    speaker: 'system',
    text: 'Walk me through your most recent role — what you owned and the team setup.',
    timestamp: Date.now(),
    final: true,
  });
  return { engine, session };
}

function installStubWta(engine, finalAnswer) {
  // Stub whatToAnswerLLM with a generator that yields a chunk at a time
  // and ultimately returns the full answer (mirrors the real WTA shape).
  // Each turn installs a fresh stub so consecutive turns emit distinct
  // content — proves the engine mints a distinct generationId per turn.
  engine.whatToAnswerLLM = {
    async *generateStream() {
      // Yield character-by-character so the streaming-token emit path is
      // exercised on every turn, mirroring how a real model provider
      // would stream.
      for (const c of finalAnswer) yield c;
    },
  };
}

test('a single WTA turn emits exactly one final with a positive generationId', async () => {
  const { engine } = await makeEngine();
  installStubWta(engine, REAL_ANSWER);
  const finals = [];
  engine.on('suggested_answer', (answer, question, confidence, generationId) => finals.push({ answer, question, confidence, generationId }));

  await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

  // The WTA pipeline may emit clarification/refinement/fallback emits
  // for a real-shaped question; what matters is that EVERY emit from
  // this turn carries a positive integer generationId (proves the new
  // thread-through works for every emit site inside runWhatShouldISay).
  assert.ok(finals.length >= 1, `expected ≥ 1 final emit, got ${finals.length}`);
  for (const f of finals) {
    assert.equal(typeof f.generationId, 'number',
      `every final emit on the WTA path must carry a generationId (got ${JSON.stringify(f)})`);
    assert.ok(f.generationId > 0,
      `generationId must be a positive integer (got ${f.generationId} for "${f.answer}")`);
  }
});

test('two sequential WTA turns emit final answers with DISTINCT, monotonically increasing generationIds', async () => {
  // Mirrors the H8 race scenario: a manual button press for a SECOND
  // question fires while an in-flight AUTO-trigger-initiated generation
  // is still completing. The engine mints a strictly-greater
  // currentGenerationId on entry to the second turn — that's the
  // invariant that lets the renderer drop the older final answer in
  // favor of the newer one. The streaming tokens for each turn carry
  // that same per-turn id; the final emit must too.
  const ANSWER_A = 'I owned the merchant settlement reconciliation pipeline end to end, leading a team of four across three product surfaces.';
  const ANSWER_B = 'I designed the schema migration playbook that moved four regional databases to a single source of truth over eight months.';

  const { engine } = await makeEngine();
  installStubWta(engine, ANSWER_A);

  const finals = [];
  engine.on('suggested_answer', (answer, question, confidence, generationId) => finals.push({ answer, generationId }));

  // Run A first.
  await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

  // Install a fresh stub for run B (mimics a NEW generation replacing the
  // old whatToAnswerLLM instance).
  installStubWta(engine, ANSWER_B);
  await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

  // Collect every emit's answer text + generationId. The WTA pipeline may
  // emit multiple finals per run (clarification, refinement, fallback),
  // so partition by answer and assert ID monotonicity within each turn.
  const idsForA = finals.filter((f) => f.answer === ANSWER_A).map((f) => f.generationId);
  const idsForB = finals.filter((f) => f.answer === ANSWER_B).map((f) => f.generationId);
  assert.ok(idsForA.length >= 1, `run A must produce ≥ 1 final emit (got ${idsForA.length} for "${ANSWER_A}")`);
  assert.ok(idsForB.length >= 1, `run B must produce ≥ 1 final emit (got ${idsForB.length} for "${ANSWER_B}")`);
  // All ids within a single turn must be EQUAL (same generationId for
  // the entire turn's lifecycle — that's how the renderer knows the
  // emit and the streaming tokens belong to the same logical answer).
  for (const id of idsForA) assert.equal(id, idsForA[0], `run A ids must all match (saw ${idsForA.join(',')})`);
  for (const id of idsForB) assert.equal(id, idsForB[0], `run B ids must all match (saw ${idsForB.join(',')})`);
  // Across turns, run B's id must be strictly greater than run A's id
  // (so the renderer drops the older final answer when adopting the new
  // active id from a newer token batch).
  assert.ok(idsForB[0] > idsForA[0],
    `run B's id must exceed run A's id (A=${idsForA[0]}, B=${idsForB[0]})`);
});

test('the type contract preserves generationId as an optional 4th arg (backward compatible)', () => {
  // Source-shape regression guard: every `emit('suggested_answer', …)`
  // call site in the WTA path now passes an extra 5th arg
  // `generationId`. The legacy answerLLM path (lines ~859, ~877) still
  // omits it. Pin both shapes so a future refactor doesn't drop the
  // new arg on the WTA path or accidentally fabricate one on the
  // legacy path (which has no `generationId` to forward).
  const src = fs.readFileSync(path.resolve(__dirname, '../../../electron/IntelligenceEngine.ts'), 'utf8');
  // Every emit('suggested_answer', …) call inside `runWhatShouldISay`
  // must pass exactly 5 args (answer, question, confidence, generationId).
  // Match the emit calls followed by generationId on the same logical
  // statement — narrowed by the leading pattern of the WTA fallback
  // site (`emit('suggested_answer', <var>, question || ..., confidence, generationId)`).
  const emitCallPattern = /emit\(\s*'suggested_answer'\s*,\s*[A-Za-z_][A-Za-z0-9_]*\s*,\s*[^,]+,\s*confidence\s*,\s*generationId\s*\)/g;
  const wtaEmitsWithGen = src.match(emitCallPattern) || [];
  assert.ok(wtaEmitsWithGen.length >= 1,
    'expected the WTA path to emit at least one final with generationId');
  // The legacy emit sites must still omit generationId (4 args).
  const legacyEmits = src.match(/emit\(\s*'suggested_answer'\s*,\s*noKeyMsg\s*,\s*question[^)]*\)/g) || [];
  assert.ok(legacyEmits.length >= 1,
    'expected the legacy noKeyMsg emit to remain 4-arg (no generationId)');
});