// electron/llm/__tests__/CustomContextLanguageList2026_11_15.test.mjs
//
// Issue #740: the custom-context fact "Python 7 years (main), Java 3, some Go"
// was cut to "Java 3" on coding and technical turns (the clause rescue kept it as
// an "instruction"), and the prompt said "Write ALL code in Java" against a user
// whose main language is Python. A language NAME is a rule only on its own; as an
// item of a list, or cut out of a fact, it is part of the fact.
// Pure modules, no platform branch: the same on macOS and Windows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REPO = path.resolve(__dirname, '../../..');
const { classifyCustomContext, selectCustomContextForAnswer } = require(path.join(REPO, 'dist-electron/electron/llm/customContextClassifier.js'));
const { analyzeUserInstructions, renderResolvedInstructionLines } = require(path.join(REPO, 'dist-electron/electron/llm/userInstructionContract.js'));

const codingTurnInstructions = (raw, answerType = 'coding_question_answer') =>
  selectCustomContextForAnswer(classifyCustomContext(raw), answerType).included.map(c => c.text).join('\n');
const codeLanguageLine = (text) => renderResolvedInstructionLines(analyzeUserInstructions(text)).find(l => /CODE LANGUAGE/.test(l)) ?? null;

for (const answerType of ['coding_question_answer', 'technical_concept_answer']) {
  test(`a skills fact is not cut into a language rule (${answerType})`, () => {
    for (const raw of [
      'Python 7 years (main), Java 3, some Go',
      'Senior backend engineer.\nPython 7 years (main), Java 3, some Go\nKeep answers short.',
      'Java 17, Spring Boot 3, Kafka',
    ]) {
      const delivered = codingTurnInstructions(raw, answerType);
      assert.doesNotMatch(delivered, /(^|\n)Java \d+(\n|$)/, `${JSON.stringify(raw)} delivered ${JSON.stringify(delivered)}`);
      assert.equal(codeLanguageLine(delivered), null, `${JSON.stringify(raw)} bound a language`);
    }
  });
}

test('a list of languages binds none of them', () => {
  for (const text of ['Python, Java 8, Go', 'Skills: Python, Java 8, Go', 'Python 7 years (main), Java 3, some Go']) {
    assert.equal(analyzeUserInstructions(text).bindsProgrammingLanguage, false, text);
  }
});

test('a language rule still binds', () => {
  for (const [text, lang] of [
    ['Java 8', 'Java'],
    ['java', 'Java'],
    ['TypeScript, not JavaScript', 'TypeScript'],
    ['Use Java 17 for code.', 'Java'],
    ['Python 7 years (main), Java 3, some Go.\nAlways write code in Python.', 'Python'],
  ]) {
    const a = analyzeUserInstructions(text);
    assert.equal(a.programmingLanguage, lang, text);
    assert.match(codeLanguageLine(text) ?? '', new RegExp(`Write ALL code in ${lang.replace('+', '\\+')}`), text);
  }
  assert.match(codingTurnInstructions('Use Java 17 for code.'), /Use Java 17 for code\./);
});
