// Regression: Codex CLI + ⌘⇧Enter showed "question is empty" despite a screenshot.
// Screenshots were accepted by LLMHelper then dropped in CodexCliService; WTA also
// sent question=undefined. Scroll-to-bottom then landed on those empty refusals.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

describe('Codex screenshot WTA empty-question regression', () => {
  test('handleWhatToSay sends an explicit on-screen question with screenshots', () => {
    const src = readFileSync(path.join(root, 'src/components/NativelyInterface.tsx'), 'utf8');
    assert.match(
      src,
      /screenshotQuestion[\s\S]*?generateWhatToSay\(\s*screenshotQuestion/,
      'must pass screenshotQuestion instead of undefined when images are attached',
    );
    assert.match(
      src,
      /Answer what is visible on the attached screen/,
      'must instruct the model to answer the visible screen problem',
    );
  });

  test('isFalseNoContentClaim catches the Codex empty-question refusal', () => {
    const src = readFileSync(path.join(root, 'electron/IntelligenceEngine.ts'), 'utf8');
    assert.match(
      src,
      /nothing\\s\+to\\s\+answer\\s\+yet\\s\+because\\s\+the\\s\+question\\s\+is\\s\+empty/,
      'must treat the Codex empty-question refusal as a false no-content claim',
    );
  });
});
