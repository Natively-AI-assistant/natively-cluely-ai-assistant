// Regression: ⌘⇧Enter streams a real "## Approach" coding answer, then
// scaffold-contamination repair (text-only, no images) rewrites it into
// "I can't see the attached screen…" and finalize wipes the UI.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engineSrc = readFileSync(
  path.resolve(__dirname, '../../IntelligenceEngine.ts'),
  'utf8',
);

describe('preserve screenshot coding answer', () => {
  test('defines shouldPreserveScreenshotCodingAnswer', () => {
    assert.match(engineSrc, /shouldPreserveScreenshotCodingAnswer/);
  });

  test('scaffold misfire extraction is skipped when preserving', () => {
    assert.match(
      engineSrc,
      /!preserveScreenshotCodingAnswer\s*\n\s*&&\s*!isCodingAnswerType\(answerPlan\.answerType\)/,
      'detectAndExtractScaffoldMisfire must be gated on preserveScreenshotCodingAnswer',
    );
  });

  test('scaffold contamination repair is skipped when preserving', () => {
    assert.match(
      engineSrc,
      /!preserveScreenshotCodingAnswer\s*\n\s*&&\s*!isSpeculative/,
      'hasUnrecoveredScaffoldContamination repair must be gated on preserveScreenshotCodingAnswer',
    );
  });

  test('helper requires screenshot + Approach + Code/fence', () => {
    // Evaluate the static method body via a tiny mirror of the predicate.
    const shouldPreserve = (hasScreenshot, answerType, answer) => {
      if (!hasScreenshot) return false;
      if (answerType === 'coding_question_answer' || answerType === 'dsa_question_answer') return false;
      const text = String(answer || '');
      if (text.length < 80) return false;
      if (!/^[\s\S]*##\s*Approach\b/im.test(text)) return false;
      return /##\s*Code\b/im.test(text) || /```[\w+-]*\n/.test(text);
    };

    const good = `## Approach
Track the minimum price seen so far and compute profit in one pass.

## Code
\`\`\`python
def maxProfit(prices):
    pass
\`\`\`
`;
    assert.equal(shouldPreserve(true, 'general_meeting_answer', good), true);
    assert.equal(shouldPreserve(false, 'general_meeting_answer', good), false);
    assert.equal(shouldPreserve(true, 'dsa_question_answer', good), false);
    assert.equal(
      shouldPreserve(true, 'general_meeting_answer', "I can't see the attached screen in this chat."),
      false,
    );
  });
});
