// The coding contract's second section is "## Technique" (2026-09-29). It was
// "## Technique / Data Structure / Algorithm Used".
//
// Pins: every prompt surface asks for the short heading; answers written with
// EITHER heading validate (stored answers and custom-mode instructions still
// quote the old one); and the short heading still works as a coding-scaffold
// fingerprint, since that is now what a misfired scaffold contains.
//
// Platform: pure string logic, identical on macOS and Windows.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  CODING_CONTRACT,
  CODING_CONTRACT_TINY,
  CODING_SECTIONS,
  validateAnswerStructure,
  detectAndExtractScaffoldMisfire,
} from '../../../dist-electron/electron/llm/index.js';

const OLD = 'Technique / Data Structure / Algorithm Used';

const answerWith = (heading) => [
  '## Approach', '', 'Scan once and remember what we have seen.', '',
  `## ${heading}`, '', 'Hash map.', '',
  '## Code', '', '```python', 'def two_sum(nums, target):', '    seen = {}', '    for i, n in enumerate(nums):',
  '        if target - n in seen:', '            return [seen[target - n], i]', '        seen[n] = i', '```', '',
  '## Dry Run', '', 'nums = [2, 7], target 9: 2 is stored, 7 finds 2, returns [0, 1].', '',
  '## Complexity', '', '- Time Complexity: O(n), because one pass.', '- Space Complexity: O(n), because of the map.', '',
  '## Interviewer Follow-up Points', '', '- Duplicates, and what to return when there is no pair.',
].join('\n');

describe('coding contract: "Technique" heading', () => {
  test('the contract asks for "## Technique", not the old long heading', () => {
    assert.equal(CODING_SECTIONS[1], 'Technique');
    assert.match(CODING_CONTRACT, /^## Technique$/m);
    assert.match(CODING_CONTRACT_TINY, /"## Technique"/);
    assert.ok(!CODING_CONTRACT.includes(OLD) && !CODING_CONTRACT_TINY.includes(OLD));
  });

  test('no prompt surface still names the old heading', () => {
    for (const rel of ['prompts.ts', 'tinyPrompts.ts', 'codingFollowup.ts', 'codeVerification/verifyCodingAnswer.ts', 'codingContract.ts']) {
      const src = fs.readFileSync(path.resolve(process.cwd(), 'electron/llm', rel), 'utf8');
      assert.ok(!src.includes(`## ${OLD}`), `${rel} still asks for "## ${OLD}"`);
    }
  });

  test('an answer with either heading validates with nothing missing', () => {
    for (const heading of ['Technique', OLD]) {
      const r = validateAnswerStructure('dsa_question_answer', answerWith(heading));
      assert.equal(r.ok, true, heading);
      assert.deepEqual(r.missingSections, [], heading);
    }
  });

  test('a repaired answer uses the new heading', () => {
    const r = validateAnswerStructure('dsa_question_answer', 'Use a hash map. ```ts\nconst x = 1;\n```');
    assert.match(r.repaired ?? '', /^## Technique$/m);
    assert.ok(!(r.repaired ?? '').includes(OLD));
  });

  test('a misfired scaffold with the short heading is still recognised and the real answer extracted', () => {
    const raw = [
      '## Approach', 'Frame the candidate\'s range from their seniority.', '',
      '## Technique', 'Behaviour-grounded answer. No DSA needed.', '',
      '## Dry Run', 'Interviewer asks for a range; answer with the band.', '',
      '---', '',
      'I\'m targeting the upper part of the band for this level, and I\'m flexible on how it\'s split between base and equity.',
    ].join('\n');
    const extracted = detectAndExtractScaffoldMisfire('negotiation_answer', raw);
    assert.ok(extracted, 'short-heading scaffold was not recognised');
    assert.match(extracted, /upper part of the band/);
    assert.doesNotMatch(extracted, /## Technique/);
  });
});
