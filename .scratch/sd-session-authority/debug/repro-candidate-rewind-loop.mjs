#!/usr/bin/env node
// .scratch/sd-session-authority/debug/repro-candidate-rewind-loop.mjs
//
// Tight feedback loop for diagnosing-bugs: replay failed T2 FULL_RAW corpus
// through prepare + post-stream strip (IE product/sim path) and assert the
// digest would be free of candidate_rewind.
//
// RED = late Requirements Draft still present after strip (user smoke symptom).
//
// Run:
//   npm run build:electron && node .scratch/sd-session-authority/debug/repro-candidate-rewind-loop.mjs
//
// Optional:
//   CORPUS=traces/sd-interview-sim/t2-04a5ef62-….json node …

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distLlm = path.join(repoRoot, 'dist-electron/electron/llm');

const CORPUS =
  process.env.CORPUS ||
  path.join(
    repoRoot,
    'traces/sd-interview-sim/t2-1506ae32-d267-40ae-9c2e-8e7914760e29.json',
  );

const DRAFT_RE =
  /\*\*Functional Requirements:?\*\*|Requirements Draft:|Here is the current draft of our requirements/i;

const gate = await import(pathToFileURL(path.join(distLlm, 'sdRequirementsGate.js')).href);
const live = await import(pathToFileURL(path.join(distLlm, 'sdRequirementsLive.js')).href);
const { detectReviewTags } = await import(
  pathToFileURL(path.join(repoRoot, 'scripts/lib/sd-interview-sim/digest.js')).href
);

const bundle = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));
const prompt =
  process.env.SD_INTERVIEW_SIM_T2_PROMPT ||
  'Design a URL shortener like Bitly.';
const TI = 'technical-interview';

let artifact = null;
const rewritten = [];
const log = [];

/**
 * Replay matches current IE gate entry with T2 pin seed:
 * - sdProblemKeyPin seeds sticky identity in TI when artifact has no key
 * - prepare then runs on GM under shouldArmGate
 * - SPEC 13 candidateFillTexts fill from *prior* assistant speech (IE uses
 *   last-3 assistants already in context — never the answer being stripped)
 * - post-stream strip clears late Requirements Draft once requirements-done
 */
for (const turn of bundle.turns || []) {
  if (turn.role === 'interviewer') {
    const prepared = live.prepareSdRequirementsForAnswerPlan({
      answerPlan: {
        answerType: 'general_meeting_answer',
        forbiddenContextLayers: [],
      },
      artifact,
      problemQuestion: prompt,
      interviewerTexts: [String(turn.text || '')],
      modeId: TI,
      sdProblemKeyPin: prompt,
    });
    artifact = prepared.artifact;
    rewritten.push(turn);
    continue;
  }

  if (turn.role !== 'assistant') {
    rewritten.push(turn);
    continue;
  }

  // Strip first (product: artifact reflects prior fills only).
  const stripped = live.applySimPostRequirementsAnswerStrip(String(turn.text || ''), {
    sdProblemKey: prompt,
    artifact,
    modeId: TI,
  });

  // Then absorb this answer into the artifact for subsequent turns.
  const filled = live.prepareSdRequirementsForAnswerPlan({
    answerPlan: {
      answerType: 'general_meeting_answer',
      forbiddenContextLayers: [],
    },
    artifact,
    problemQuestion: prompt,
    interviewerTexts: [],
    candidateFillTexts: [String(turn.text || '')],
    modeId: TI,
    sdProblemKeyPin: prompt,
  });
  artifact = filled.artifact;

  const phase = artifact ? gate.deriveSdPhase(artifact) : null;
  const complete = artifact ? gate.isChecklistComplete(artifact) : false;
  log.push({
    idx: turn.idx,
    hadDraft: DRAFT_RE.test(turn.text || ''),
    stillHasDraft: DRAFT_RE.test(stripped),
    phase,
    complete,
    gateClosed: artifact?.gateClosed === true,
    problemKey: artifact?.problemKey ?? null,
    fills: filled.fills?.map((f) => f.id) || [],
  });

  rewritten.push({ ...turn, text: stripped });
}

const outBundle = { ...bundle, turns: rewritten };
const tags = detectReviewTags(outBundle);
const late = log.filter((row) => {
  const assistants = log;
  const mid = Math.floor(assistants.length / 2);
  return assistants.indexOf(row) >= mid;
});

console.log(
  JSON.stringify(
    {
      corpus: path.relative(repoRoot, CORPUS),
      finalPhase: artifact ? gate.deriveSdPhase(artifact) : null,
      checklistComplete: artifact ? gate.isChecklistComplete(artifact) : false,
      gateClosed: artifact?.gateClosed === true,
      problemKey: artifact?.problemKey ?? null,
      tagsAfterStripReplay: tags,
      lateDraftSurvivors: late.filter((r) => r.stillHasDraft).map((r) => r.idx),
      sample: log.slice(0, 4),
      sampleLate: late.slice(0, 4),
    },
    null,
    2,
  ),
);

assert.equal(
  tags.includes('candidate_rewind'),
  false,
  `expected no candidate_rewind after prepare+strip replay; got tags=${JSON.stringify(tags)} lateSurvivors=${JSON.stringify(
    late.filter((r) => r.stillHasDraft).map((r) => r.idx),
  )}`,
);

console.log('PASS: candidate_rewind cleared after prepare+strip replay');
