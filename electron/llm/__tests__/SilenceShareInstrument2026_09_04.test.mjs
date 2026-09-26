// electron/llm/__tests__/SilenceShareInstrument2026_09_04.test.mjs
//
// Phase 1b of the interaction-router campaign. The routing audit
// (docs/natively-current-routing-map.md) could not report what share of live
// WTA generations end in a silence string, because the decision is made by the
// cloud LLM after a full generation rather than by a pre-check. This guards the
// instrument that measures it.
//
// Two properties are worth protecting, and they fail differently:
//
//   1. PRIVACY. The new 'silenced' marker must survive scrubTelemetry, and the
//      payload must still drop anything content-shaped. Tested behaviourally
//      against the COMPILED module, so it exercises the real allowlist.
//
//   2. RATE, NOT COUNT. The emit must fire for BOTH outcomes at one point. If a
//      later edit moves it inside the sentinel branch, the ring silently starts
//      yielding an unanchored count and every share computed from it is wrong
//      while still looking plausible. That is the regression this pins.
//
// Property 2 needs a source assertion, since runWhatShouldISay cannot be driven
// without a live engine. It is written to survive comment drift: it anchors on
// executable syntax only, never on prose, and never on a line number.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const { scrubTelemetry } = await import(
  pathToFileURL(path.join(repoRoot, 'dist-electron/electron/llm/piTelemetry.js')).href
);

describe('Phase 1b silence-share instrument', () => {
  test('the silenced marker survives scrubbing, with its companion markers', () => {
    const out = scrubTelemetry({
      silenced: true,
      surface: 'speculative',
      mode: 'team-meet',
      answerType: 'general_meeting_answer',
      reason: 'prompted',
    });
    assert.equal(out.silenced, true, "'silenced' must be allow-listed or the instrument records nothing");
    assert.equal(out.surface, 'speculative');
    assert.equal(out.mode, 'team-meet');
    assert.equal(out.answerType, 'general_meeting_answer');
    assert.equal(out.reason, 'prompted');
  });

  test('the answered outcome survives too, so the ring yields a rate', () => {
    const out = scrubTelemetry({ silenced: false, surface: 'manual', reason: 'answered' });
    assert.equal(out.silenced, false, 'false must be preserved, not dropped as falsy');
    assert.equal(out.reason, 'answered');
  });

  test('scrubbing still drops content even under the new key set', () => {
    const out = scrubTelemetry({
      silenced: true,
      question: 'what was your CGPA at university',
      rawAnswer: 'Nothing actionable right now.',
      transcript: 'a long verbatim transcript line',
    });
    assert.equal(out.silenced, true);
    assert.equal('question' in out, false, 'question text must never reach telemetry');
    assert.equal('rawAnswer' in out, false, 'answer text must never reach telemetry');
    assert.equal('transcript' in out, false, 'transcript text must never reach telemetry');
  });

  test('the emit fires for BOTH outcomes, not only inside the sentinel branch', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'electron/IntelligenceEngine.ts'), 'utf8');

    const emitIdx = src.indexOf("piTelemetry.emit('wta_turn_silence_outcome'");
    assert.ok(emitIdx > -1, 'the silence-share instrument must exist in runWhatShouldISay');

    // The emit must sit BEFORE the sentinel branch consumes fullAnswer. Anchor
    // on the branch's executable text, and take the LAST occurrence before the
    // emit vs the FIRST after it, so an added earlier guard cannot fake a pass.
    const branch = 'if (IntelligenceEngine.isNonAnswerSentinel(fullAnswer)) {';
    const branchAfter = src.indexOf(branch, emitIdx);
    assert.ok(branchAfter > -1, 'the sentinel branch must still follow the instrument');

    // Nothing between the emit and the branch may open a new block that would
    // put the emit inside a conditional: the emit's own try/catch is the only
    // wrapper permitted, and it must close before the branch opens.
    const between = src.slice(emitIdx, branchAfter);
    assert.ok(
      /catch\s*\{[^}]*\}\s*$/.test(between.trim()),
      'the emit must be wrapped only by its own try/catch and closed before the sentinel branch',
    );

    // Both outcomes must be reachable: the payload has to carry the computed
    // boolean, not a literal true.
    const payload = src.slice(emitIdx, emitIdx + 600);
    assert.match(payload, /silenced:\s*_silenced\b/, 'silenced must carry the computed outcome, not a literal');
    assert.doesNotMatch(payload, /silenced:\s*true\b/, 'a literal true would make the ring a count, not a rate');
  });

  test('the instrument cannot fail a live turn', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'electron/IntelligenceEngine.ts'), 'utf8');
    const emitIdx = src.indexOf("piTelemetry.emit('wta_turn_silence_outcome'");
    assert.ok(emitIdx > -1, 'the instrument must exist');

    // Anchor the window on executable code, not prose, and count UNMATCHED
    // `try {` rather than comparing last-index positions. The naive comparison
    // is wrong here: the mode lookup has its own inner try/catch, so the last
    // `catch` legitimately sits after the last `try {` while the emit is still
    // inside the outer try. That heuristic reported a false failure on correct
    // code, which is the documented hazard of source-assertion tests in this
    // repo (docs note: 2026-08-15).
    const anchor = src.lastIndexOf('silenceViaNormalizer = true;', emitIdx);
    assert.ok(anchor > -1, 'the normalizer flag must be set before the instrument');
    const between = src.slice(anchor, emitIdx);
    const opens = (between.match(/\btry\s*\{/g) || []).length;
    const closes = (between.match(/\bcatch\b/g) || []).length;
    assert.ok(opens - closes >= 1, `the emit must sit inside an unclosed try (opens=${opens}, closes=${closes})`);
  });

  test('observe-only: no branch reads the outcome', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'electron/IntelligenceEngine.ts'), 'utf8');
    // `_silenced` may be computed and emitted. It must never gate anything, or
    // Phase 1b stops being a no-behaviour-change PR.
    const uses = src.match(/_silenced/g) || [];
    assert.equal(uses.length, 3, `_silenced must appear exactly 3 times (declare, ternary, emit); found ${uses.length}`);
    assert.doesNotMatch(src, /if\s*\(\s*_silenced\s*\)/, '_silenced must not gate a branch');
  });
});
