// PHASE 2 BASELINE — output artifacts + answer diversity characterization.
// Pins current behavior of the real answerPolish.ts (cleanAnswerArtifacts,
// AnswerDiversityGuard, compressToSpeakable) so Phase 5 can harden without regressing.
// Encodes the prompt's "specific bugs to prevent": empty "*" bullets, repeated
// scaffold labels, repeated opening sentences.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanAnswerArtifacts,
  AnswerDiversityGuard,
  compressToSpeakable,
  isSameAsk,
} from '../../../../dist-electron/electron/llm/answerPolish.js';

describe('PHASE2 baseline — empty bullet artifacts', () => {
  test('lone "*" bullet lines are removed', () => {
    const out = cleanAnswerArtifacts('Here is my answer.\n*\nReal point follows.\n*');
    assert.doesNotMatch(out, /^\s*\*\s*$/m, 'no lone bullet line should survive');
    assert.match(out, /Real point follows/);
  });

  test('repeated/dangling markers and punctuation-only bullets removed', () => {
    for (const bad of ['Answer\n- -\nx', 'Answer\n• .\nx', 'Answer text *']) {
      const out = cleanAnswerArtifacts(bad);
      assert.doesNotMatch(out, /^\s*[-*•+][ \t]*[.,:;]*\s*$/m);
    }
  });

  test('code fences are never touched', () => {
    const code = 'Do this:\n```js\nconst x = [1,2];\n// * not a bullet\n```\nDone.';
    const out = cleanAnswerArtifacts(code);
    assert.match(out, /const x = \[1,2\];/);
    assert.match(out, /\/\/ \* not a bullet/);
  });
});

describe('PHASE2 baseline — answer diversity guard', () => {
  test('flags a repeated opening sentence across DIFFERENT asks', () => {
    const guard = new AnswerDiversityGuard();
    const opener = 'I bring a strong mix of engineering and product sense to the table.';
    guard.record(`${opener} I shipped Natively.`, 'jd_fit_answer', 'why should we hire you?');
    const verdict = guard.check(`${opener} I led the data team.`, 'experience_answer', 'what is your experience?');
    assert.equal(verdict.repeated, true);
    assert.equal(verdict.reason, 'same_first_sentence');
  });

  test('flags reused scaffold-label template across different asks', () => {
    const guard = new AnswerDiversityGuard();
    const tmpl = 'The Honest Gap: x\nWhy It\'s Manageable: y\nHow I\'d Close It: z';
    guard.record(tmpl, 'gap_analysis_answer', 'where are you weak?');
    const verdict = guard.check('The Honest Gap: a\nWhy It\'s Manageable: b\nHow I\'d Close It: c', 'gap_analysis_answer', 'what do you need to improve?');
    assert.equal(verdict.repeated, true);
    assert.equal(verdict.reason, 'same_scaffold');
  });

  test('does NOT flag the same ask phrased differently (legit repeat)', () => {
    const guard = new AnswerDiversityGuard();
    const a = 'My main skills are TypeScript, Python, and React.';
    guard.record(a, 'skills_answer', 'what are your main skills?');
    const verdict = guard.check(a, 'skills_answer', 'what are your technical skills?');
    assert.equal(verdict.repeated, false, 'synonymous asks may legitimately repeat');
  });

  test('isSameAsk recognizes synonymous phrasings', () => {
    assert.equal(isSameAsk('what are your main skills', 'what are your technical skills'), true);
    assert.equal(isSameAsk('what are your projects', 'what is your education'), false);
  });
});

describe('PHASE2 baseline — speakable compression strips labels', () => {
  test('compressToSpeakable removes scaffold labels and empty bullets', () => {
    const templated = 'Direct Answer: I fit well.\nMatching Experience: 5 years.\n*\nWhy This Role: growth.';
    const out = compressToSpeakable(templated);
    assert.doesNotMatch(out, /Direct Answer:|Matching Experience:|Why This Role:/);
    assert.doesNotMatch(out, /^\s*\*\s*$/m);
    assert.match(out, /I fit well/);
  });
});
