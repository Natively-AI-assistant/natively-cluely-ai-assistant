// Candidate framing ("your" → "my") must not un-make an intro question.
//
// The live grounding path looks the interviewer's question up in the candidate
// profile after toCandidateFraming. Live 2026-09-27 (looking for work): "could
// you walk me through your background" became "…through my background", the
// orchestrator classified it GENERAL (its INTRO_PATTERNS are second-person),
// and the answer was built from two arbitrary résumé nodes: the wrong current
// employer and an invented earlier one. 7 of 24 intro patterns broke this way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = path.resolve(__dirname, '../../../dist-electron');
const { toCandidateFraming } = require(path.join(dist, 'electron/llm/transcriptQuestionExtractor.js'));
const classifierPath = path.join(dist, 'premium/electron/knowledge/IntentClassifier.js');
const premium = fs.existsSync(classifierPath) ? require(classifierPath) : null;

test('every intro pattern is still an INTRO after candidate framing (drift guard)', { skip: !premium && 'premium not built' }, () => {
  const broken = [];
  for (const p of premium.INTRO_PATTERNS) {
    for (const q of [`Could you ${p}?`, `${p[0].toUpperCase()}${p.slice(1)}.`, `So to start, ${p}`]) {
      if (premium.classifyIntent(toCandidateFraming(q)) !== 'intro') broken.push(`${q} → ${toCandidateFraming(q)}`);
    }
  }
  assert.deepEqual(broken, []);
});

test('the live opener stays verbatim', () => {
  const q = "To start, could you walk me through your background and what you're doing today?";
  assert.equal(toCandidateFraming(q), q);
});

test('"what do you do" / "who are you" inside an ordinary question are still framed', () => {
  assert.equal(toCandidateFraming('What do you do when a deploy fails?'), 'What do I do when a deploy fails?');
  assert.match(toCandidateFraming('Who are you working with on the payments team?'), /Who are I working with on the payments team\?|who are I/i);
  assert.equal(toCandidateFraming('Tell me about your biggest project.'), 'Tell me about my biggest project.');
});
