// test/harness-longsession/grading/grade-run.mjs
//
// Applies the G1-G8 gates (gates.mjs) to a single script's pressResults
// (produced by lib/run-script.cjs), returning a per-script scorecard. Called
// by each script entrypoint (scripts/run-script-a.mjs etc.) and by the
// combined-report writer.

import {
  gradeG1QuestionExtraction,
  gradeG2GreetingFailure,
  gradeG3Deterministic,
  gradeG3Judge,
  gradeG4ForbiddenFacts,
  gradeG4Judge,
  gradeG5LongRangeRecall,
  gradeG6Desync,
  gradeG7Injection,
  gradeG8Latency,
} from './gates.mjs';

function aggregate(results) {
  const applicable = results.filter((r) => r.applicable !== false);
  const passCount = applicable.filter((r) => r.pass === true).length;
  const total = applicable.length;
  return {
    total,
    pass: passCount,
    pct: total > 0 ? (100 * passCount) / total : null,
  };
}

/**
 * Grades one script's press results against G1-G8. `sourceContextForPress(pressResult)`
 * returns the grounding-source text to feed the G4 hallucination judge (resume+JD text
 * for Script A/C, reference-PDF excerpt for Script B) — the caller supplies this since
 * the source differs per script.
 */
export async function gradeScriptRun(scriptId, pressResults, sourceContextForPress, opts = {}) {
  const perPress = [];
  const g1s = [];
  const g2s = [];
  const g3dets = [];
  const g3judges = [];
  const g4forbids = [];
  const g4judges = [];
  const g5s = [];
  const g6s = [];
  const g7s = [];

  for (const pr of pressResults) {
    const g1 = gradeG1QuestionExtraction(pr, pr.extractedQuestion);
    const g2 = gradeG2GreetingFailure(pr, pr.answer);
    const g3det = gradeG3Deterministic(pr, pr.answer);
    let g3judge = null;
    if (!opts.skipJudge) {
      g3judge = await gradeG3Judge(pr, pr.answer, { timeoutMs: opts.judgeTimeoutMs });
    }
    const g4forbid = gradeG4ForbiddenFacts(pr, pr.answer);
    let g4judge = null;
    if (!opts.skipJudge) {
      const sourceContext = sourceContextForPress ? sourceContextForPress(pr) : '';
      g4judge = await gradeG4Judge(pr, pr.answer, sourceContext, { timeoutMs: opts.judgeTimeoutMs });
    }
    const g5 = gradeG5LongRangeRecall(pr, pr.answer);
    const g6 = gradeG6Desync(pr, g1, g3det, g3judge);
    const g7 = gradeG7Injection(pr, pr.answer);

    g1s.push(g1); g2s.push(g2); g3dets.push(g3det);
    if (g3judge) g3judges.push(g3judge);
    g4forbids.push(g4forbid);
    if (g4judge) g4judges.push(g4judge);
    g5s.push(g5); g6s.push(g6); g7s.push(g7);

    perPress.push({
      pressId: pr.press.id,
      label: pr.press.label,
      t: pr.t,
      minute: pr.minute,
      answerPreview: (pr.answer || '(null)').slice(0, 300),
      threw: pr.threw,
      latencyRealMs: pr.latencyRealMs,
      firstTokenRealMs: pr.firstTokenRealMs,
      G1: g1, G2: g2, G3_deterministic: g3det, G3_judge: g3judge,
      G4_forbidden: g4forbid, G4_judge: g4judge, G5: g5, G6: g6, G7: g7,
    });
  }

  const g8 = gradeG8Latency(pressResults.map((pr) => ({ t: pr.t, latencyRealMs: pr.latencyRealMs })));

  // G3 combined pass = deterministic pass OR judge pass (judge can upgrade a
  // deterministic near-miss, mirroring llm-judge.mjs's scoreTwoTier
  // philosophy: judge never downgrades, only upgrades).
  const g3Combined = perPress.map((p) => {
    if (p.G3_deterministic.applicable === false) {
      return { applicable: p.G3_judge ? true : false, pass: p.G3_judge ? p.G3_judge.pass : null };
    }
    if (p.G3_deterministic.pass) return { applicable: true, pass: true };
    return { applicable: true, pass: p.G3_judge ? p.G3_judge.pass : false };
  });

  // G4 combined: forbidden-facts hard fail wins; otherwise judge decides
  // (when applicable); absent both signals (no forbidden list AND judge
  // skipped) counts as pass (no evidence of hallucination found).
  const g4Combined = perPress.map((p) => {
    if (p.G4_forbidden.applicable && !p.G4_forbidden.pass) return { applicable: true, pass: false, reason: 'forbidden_fact' };
    if (p.G4_judge) return { applicable: true, pass: p.G4_judge.pass, reason: p.G4_judge.pass ? null : 'judge_unsupported_claim' };
    return { applicable: true, pass: true, reason: null };
  });

  const scorecard = {
    scriptId,
    presses: perPress.length,
    G1_question_extraction: aggregate(g1s),
    G2_greeting_failure: { flaggedCount: g2s.filter((r) => r.flagged).length, total: g2s.length },
    G3_answer_quality: aggregate(g3Combined),
    G4_hallucination: { failCount: g4Combined.filter((r) => !r.pass).length, total: g4Combined.length },
    G5_long_range_recall: aggregate(g5s),
    G6_desync: aggregate(g6s),
    G7_injection: aggregate(g7s),
    G8_latency: g8,
  };

  return { scorecard, perPress };
}
