// #742: any short deictic question over any attached image was promoted to a
// `solve` coding turn, and the repeat-press directive ("NO new question ...
// the COMPLETE solution") went with it, because `solve` is also
// detectCodingShape's default. In the interview sim, "So, looking at this,
// what would you change?" over an architecture diagram went out with the
// three-section coding contract and that directive.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/', p)).href;
const { isPromotedScreenCodingTurn, isImageCodingAsk, isScreenOnlyAsk, isRepeatPressAsk } = await import(dist('codingPromptSignals.js'));
const { detectCodingShape, namesCodingShape } = await import(dist('codingShape.js'));

const overImage = (question) => isPromotedScreenCodingTurn({ alreadyCoding: false, question, hasImages: true, screenText: undefined });

describe('an image no longer promotes a question that has its own subject', () => {
  for (const q of [
    'So, looking at this, what would you change?',
    'What stands out to you on this dashboard?',
    "So what's the main risk here?",
    'Is this a remote role?',
  ]) {
    test(`not promoted: "${q}"`, () => {
      assert.equal(overImage(q), false);
      assert.equal(isImageCodingAsk(q), false);
    });
  }
});

describe('an image still promotes a press about the screen or about code', () => {
  for (const q of [
    '', 'solve this', 'how do I do this?', 'What should I say?', 'What should I say about this?',
    'How do I answer this', 'What about this', 'whats the answer here', 'what goes here',
    'explain this', "what's the complexity of this?", 'fix this', "what's wrong here?",
    'can you code this up', 'what would you change in this code?', 'give me a hint for this one',
  ]) {
    test(`promoted: "${q}"`, () => assert.equal(overImage(q), true));
  }
});

test('captured TEXT still needs a structural code template (unchanged)', () => {
  const stub = 'class Solution:\n    def twoSum(self, nums, target):\n        pass';
  assert.equal(isPromotedScreenCodingTurn({ alreadyCoding: false, question: 'So, looking at this, what would you change?', hasImages: false, screenText: stub }), true);
  assert.equal(isPromotedScreenCodingTurn({ alreadyCoding: false, question: 'what would you change?', hasImages: false, screenText: 'Q3 pipeline: 42 deals' }), false);
});

describe('the repeat-press directive goes only to a press with no question of its own', () => {
  test('blind press and screen-only words get it', () => {
    for (const q of ['', 'solve this', 'What should I say?', 'how do I do this', 'whats the answer here']) {
      assert.equal(isRepeatPressAsk(q, detectCodingShape(q)), true, q);
    }
  });
  test('a real question whose shape fell through to the solve default does not', () => {
    const q = 'what would you change in this code?';
    assert.equal(detectCodingShape(q), 'solve', 'precondition: the default shape');
    assert.equal(namesCodingShape(q), false);
    assert.equal(isRepeatPressAsk(q, detectCodingShape(q)), false);
  });
  test('a narrower shape never gets it', () => {
    assert.equal(isRepeatPressAsk('explain this', detectCodingShape('explain this')), false);
  });
  test('isScreenOnlyAsk keeps the deictic word cap and retrospective guard', () => {
    assert.equal(isScreenOnlyAsk('how did that go'), false);
    assert.equal(isScreenOnlyAsk('what about this one here now so what do I do with this question'), false);
  });
});
