// test/harness-longsession/lib/run-script.cjs
//
// Shared timeline-driving runner for the Phase 2 harness scripts (A/B/C).
// Loads a script JSON (test/harness-longsession/scripts/*.json), feeds every
// timeline segment into the REAL rolling-transcript store via
// lib/bootstrap.cjs's feedSegment (same code path STT output uses), and at
// each `__PRESS__` marker invokes the REAL answer-button handler
// (IntelligenceEngine.runWhatShouldISay). Dumps a full per-press trace file
// (extracted question, complete final prompt composition, answer, latency)
// to traces2/harness-<scriptId>-press-<pressId>.txt, and returns the raw
// press results for the grading layer (grading/gates.mjs, invoked from the
// .mjs entrypoints since the grader needs top-level await for the LLM judge).
'use strict';

const path = require('path');
const fs = require('fs');
const {
  REPO_ROOT,
  bootstrap,
  installTraceCapture,
  feedSegment,
  pressAnswerButton,
} = require('./bootstrap.cjs');

const TRACES_DIR = path.join(REPO_ROOT, 'traces2');

function parseTimeToMinutes(t) {
  const m = /^(\d+):(\d+):(\d+)$/.exec(t);
  if (!m) throw new Error(`Bad timestamp: ${t}`);
  return Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 60;
}

function fmtPressDump(scriptId, entry, result) {
  const L = [];
  const W = (s = '') => L.push(s);
  const press = entry.press;
  W(`=== HARNESS PRESS DUMP — ${scriptId} / ${press.id} (${press.label}) — t=${entry.t} ===`);
  W(`Canonical question (annotated): "${press.canonicalQuestion}"`);
  W(`Expected facts: ${JSON.stringify(press.expectedFacts || [])}`);
  W(`Long-range recall: ${Boolean(press.longRangeRecall)}   Injection case: ${Boolean(press.isInjectionCase)}`);
  W(`Real wall-clock latency: ${result.latencyRealMs?.toFixed(1)}ms  (first token: ${result.firstTokenRealMs !== null ? result.firstTokenRealMs.toFixed(1) + 'ms' : 'n/a'})`);
  W('');
  const qLine = result.traceLines.find((l) => l.line.includes('question_extracted'));
  if (qLine) {
    W('--- [TRACE:LONGCTX] question_extracted ---');
    W(qLine.line);
  } else {
    W('--- [TRACE:LONGCTX] question_extracted: NOT FOUND ---');
  }
  W('');
  const pLine = result.traceLines.find((l) => l.line.includes('prompt_assembled'));
  if (pLine) {
    W('--- [TRACE:LONGCTX] prompt_assembled ---');
    W(pLine.line);
  } else {
    W('--- [TRACE:LONGCTX] prompt_assembled: NOT FOUND ---');
  }
  W('');
  W('--- Raw model answer ---');
  W(result.answer === null ? '(null — no answer emitted)' : result.answer);
  if (result.threw) {
    W('');
    W('--- THREW ---');
    W(result.threw);
  }
  W('');
  W('--- ALL captured [TRACE:LONGCTX] lines for this press ---');
  for (const l of result.traceLines) W(l.line);
  return L.join('\n') + '\n';
}

function extractTraceField(traceLines, tag, field) {
  const line = traceLines.find((l) => l.line.includes(tag));
  if (!line) return null;
  try {
    const parsed = JSON.parse(line.line.replace(`[TRACE:LONGCTX] ${tag} `, ''));
    return field ? parsed[field] : parsed;
  } catch {
    return null;
  }
}

/**
 * Runs one script end-to-end. `setupFn(ctx)` is called once after bootstrap
 * (before feeding the timeline) to do script-specific fixture wiring (resume/
 * JD ingestion for A/C, mode reference-file ingestion for B). Returns
 * { scriptId, pressResults: [{ press, t, answer, threw, latencyRealMs,
 * firstTokenRealMs, extractedQuestion, traceLines }], promptSizeOverTime }.
 */
async function runScript(scriptPath, opts = {}) {
  const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
  const ctx = await bootstrap({ withKnowledgeStack: true, tmpPrefix: `harness-${script.id}-` });
  const traceCapture = installTraceCapture();

  if (typeof opts.setupFn === 'function') {
    await opts.setupFn(ctx);
  }

  fs.mkdirSync(TRACES_DIR, { recursive: true });

  const pressResults = [];
  const promptSizeOverTime = [];
  let lastMinute = 0;
  const lastMinuteRef = { value: 0 };

  for (const entry of script.timeline) {
    const targetMinute = parseTimeToMinutes(entry.t);
    ctx.advanceClockToMinute(targetMinute, lastMinuteRef);
    lastMinute = targetMinute;

    if (entry.channel && entry.text !== '__PRESS__') {
      feedSegment(ctx.session, entry);
      continue;
    }

    if (!entry.press) continue; // safety: a literal '__PRESS__' text without a press block is a script bug, skip
    const press = entry.press;
    traceCapture.log(`\n[run-script] === PRESS ${press.id} (${press.label}) at t=${entry.t} (sim minute ${targetMinute.toFixed(2)}) ===`);
    const result = await pressAnswerButton(ctx.engine, traceCapture, {});
    const extractedQuestion = extractTraceField(result.traceLines, 'question_extracted', 'latestQuestion');
    const promptComposition = extractTraceField(result.traceLines, 'prompt_assembled', null);

    const pressResult = {
      press,
      t: entry.t,
      minute: targetMinute,
      answer: result.answer,
      threw: result.threw,
      latencyRealMs: result.latencyRealMs,
      firstTokenRealMs: result.firstTokenRealMs,
      extractedQuestion,
      promptComposition,
      traceLines: result.traceLines,
    };
    pressResults.push(pressResult);
    if (promptComposition) {
      promptSizeOverTime.push({
        pressId: press.id,
        minute: targetMinute,
        userMessageChars: promptComposition.userMessageChars,
        systemPromptChars: promptComposition.systemPromptChars,
        totalTokensUsedByAssembler: promptComposition.totalTokensUsedByAssembler,
      });
    }

    const dump = fmtPressDump(script.id, entry, result);
    const outPath = path.join(TRACES_DIR, `harness-${script.id}-press-${press.id}.txt`);
    fs.writeFileSync(outPath, dump);
    traceCapture.log(`[run-script] wrote ${outPath}`);
    traceCapture.log(`[run-script] answer preview: ${(result.answer || '(null)').slice(0, 200)}`);
  }

  try { fs.rmSync(ctx.tmpUserData, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  traceCapture.restore();

  return { scriptId: script.id, scriptName: script.name, pressResults, promptSizeOverTime };
}

module.exports = { runScript, parseTimeToMinutes };
