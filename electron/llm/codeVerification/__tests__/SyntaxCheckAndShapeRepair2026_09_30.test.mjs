// electron/llm/codeVerification/__tests__/SyntaxCheckAndShapeRepair2026_09_30.test.mjs
//
// 1. Compile-only JavaScript syntax check (syntaxCheck.ts): valid / invalid
//    snippets, errors nested inside functions, ES-module and top-level-await
//    snippets that are valid JS, JSX reported as skipped (not an error), and
//    proof that nothing is EXECUTED. Plus the observe-only reporter and its
//    wiring on both surfaces (hotkey What-to-Answer, typed chat V3 + legacy).
// 2. Coding repairs follow the turn's shape: the SQL correction no longer
//    demands six sections unless the shape is 'full', the chat truncation
//    regeneration passes the turn's shape, and the legacy repeat-press
//    directive only rides a 'solve' turn.
//
// node:vm compile + fake runners + source reads — identical on macOS and Windows.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkJavaScriptSyntax, checkFencedJavaScriptSyntax,
} from '../../../../dist-electron/electron/llm/codeVerification/syntaxCheck.js';
import { observeAnswerJsSyntax } from '../../../../dist-electron/electron/llm/codeVerification/syntaxCheckReport.js';
import { verifyCodingAnswer, repairFormatInstruction } from '../../../../dist-electron/electron/llm/codeVerification/verifyCodingAnswer.js';
import { buildCodingContractPrompt } from '../../../../dist-electron/electron/llm/codingFollowup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const SRC = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n');

describe('checkJavaScriptSyntax (compile only)', () => {
  test('valid script', () => {
    assert.deepEqual(checkJavaScriptSyntax('function twoSum(nums, t) {\n  const m = new Map();\n  return [];\n}'), { ok: true, mode: 'script' });
  });
  test('invalid: unbalanced brace', () => {
    const r = checkJavaScriptSyntax('function f() {\n  return 1;\n');
    assert.equal(r.ok, false);
    assert.match(r.message, /Unexpected end of input/);
  });
  test('invalid: bad token inside a NESTED function body is still caught (lazy parse)', () => {
    const r = checkJavaScriptSyntax('function outer() {\n  function inner() {\n    let x = ;\n  }\n  return inner;\n}');
    assert.equal(r.ok, false);
    assert.equal(r.line, 3);
  });
  test('ES module import/export is valid JavaScript, not an error', () => {
    const code = "import { useState } from 'react';\nexport default function add(a, b) { return a + b; }\nexport const k = 1;";
    assert.deepEqual(checkJavaScriptSyntax(code), { ok: true, mode: 'module' });
  });
  test('an error in a module snippet is still reported', () => {
    const r = checkJavaScriptSyntax("import x from 'y';\nexport function f( { return 1 }");
    assert.equal(r.ok, false);
  });
  test('top-level await is valid', () => {
    assert.deepEqual(checkJavaScriptSyntax("const r = await fetch('https://x');\nconsole.log(r.status);"), { ok: true, mode: 'async' });
  });
  test('JSX in a js fence is skipped, not flagged', () => {
    assert.deepEqual(checkJavaScriptSyntax('function App() {\n  return <div className="a">hi</div>;\n}'), { ok: null, skipped: 'jsx' });
  });
  test('empty code is skipped', () => {
    assert.deepEqual(checkJavaScriptSyntax('   \n'), { ok: null, skipped: 'empty' });
  });
  test('NOTHING executes: a snippet that would set a global and throw leaves no trace', () => {
    delete globalThis.__syntaxCheckRan;
    const r = checkJavaScriptSyntax('globalThis.__syntaxCheckRan = true;\nthrow new Error("ran");');
    assert.deepEqual(r, { ok: true, mode: 'script' });
    assert.equal(globalThis.__syntaxCheckRan, undefined);
  });
});

describe('checkFencedJavaScriptSyntax', () => {
  test('counts only js/javascript fences; python and ts are ignored', () => {
    const answer = [
      '## Code', '```python', 'def f(:', '```',
      '```javascript', 'const a = 1;', '```',
      '```js', 'const b = ;', '```',
      '```ts', 'const c: number = 1;', '```',
    ].join('\n');
    const s = checkFencedJavaScriptSyntax(answer);
    assert.equal(s.blocks, 2);
    assert.equal(s.valid, 1);
    assert.equal(s.invalid, 1);
    assert.equal(s.firstError.block, 2);
    assert.equal(s.firstError.line, 1);
  });
  test('an unterminated fence at the end is still checked', () => {
    assert.equal(checkFencedJavaScriptSyntax('```js\nfunction f() {').invalid, 1);
  });
  test('no fences', () => {
    assert.deepEqual(checkFencedJavaScriptSyntax('Just prose.'), { blocks: 0, valid: 0, invalid: 0, skipped: 0 });
  });
});

describe('observeAnswerJsSyntax (observe-only reporter)', () => {
  test('null when the answer has no JavaScript fence', () => {
    assert.equal(observeAnswerJsSyntax('```python\nprint(1)\n```', 'what_to_answer'), null);
    assert.equal(observeAnswerJsSyntax('', 'manual_chat_v3'), null);
  });
  test('summary when it has one', () => {
    const s = observeAnswerJsSyntax('Here:\n```js\nconst = 2;\n```', 'manual_chat_v3');
    assert.equal(s.invalid, 1);
  });
  test('wired on both surfaces, after the answer is final, never assigned back', () => {
    const ipc = SRC('electron/ipcHandlers.ts');
    const engine = SRC('electron/IntelligenceEngine.ts');
    assert.match(ipc, /observeAnswerJsSyntax\(finalText, 'manual_chat_v3'\)/);
    assert.match(ipc, /observeAnswerJsSyntax\(finalText \?\? fullResponse, 'manual_chat_legacy'\)/);
    assert.match(engine, /observeAnswerJsSyntax\(finalWtaAnswer, 'what_to_answer'\)/);
    assert.ok(engine.indexOf("observeAnswerJsSyntax(finalWtaAnswer") > engine.indexOf("this.emit('suggested_answer', finalWtaAnswer"), 'after the final emit');
    for (const src of [ipc, engine]) assert.doesNotMatch(src, /=\s*observeAnswerJsSyntax\([^)]*\)\s*\.\s*(?:text|answer)/);
  });
  test('the checker never runs code (no run* call in the module)', () => {
    const mod = SRC('electron/llm/codeVerification/syntaxCheck.ts');
    assert.doesNotMatch(mod, /\.run(?:InThisContext|InContext|InNewContext)\(|\beval\(|new Function\(/);
  });
});

describe('coding repairs follow the turn shape', () => {
  test('repairFormatInstruction: six sections only for full', () => {
    assert.match(repairFormatInstruction('full'), /six-section/);
    for (const shape of ['solve', 'code', 'debug', 'optimize', 'explain', undefined, null]) {
      assert.doesNotMatch(repairFormatInstruction(shape), /six/, String(shape));
      assert.match(repairFormatInstruction(shape), /SAME format and sections as your previous answer/);
    }
  });

  const sqlAnswer = [
    '```sql', 'SELECT name FROM users;', '```',
    '<verification_spec>',
    JSON.stringify({ language: 'sql', sql: { schema: ['CREATE TABLE users (name TEXT)'], seeds: ["INSERT INTO users VALUES ('a')"], expected: [{ name: 'b' }] } }),
    '</verification_spec>',
  ].join('\n');
  const runSqlFail = async () => ({ case: { input: [], expected: [] }, status: 'fail', stdout: '', actual: [{ name: 'a' }], ms: 1 });

  for (const [shape, sixSections] of [['solve', false], ['code', false], [undefined, false], ['full', true]]) {
    test(`SQL correction prompt for shape ${shape}: six sections ${sixSections ? 'kept' : 'not demanded'}`, async () => {
      let prompt = '';
      await verifyCodingAnswer({
        answer: sqlAnswer,
        question: 'names of users',
        codingShape: shape,
        runSql: runSqlFail,
        languageAvailable: async () => true,
        correct: async (p) => { prompt = p; return ''; },
      });
      assert.ok(prompt, 'a correction was requested');
      assert.equal(/six-section/.test(prompt), sixSections, prompt);
    });
  }

  test('chat truncation regeneration and meta-reply retry ask for the turn shape, not six sections', () => {
    const ipc = SRC('electron/ipcHandlers.ts');
    assert.equal((ipc.match(/: buildCodingContractPrompt\(null, \{ codingShape: manualCodingShape \}\);/g) || []).length, 2);
    assert.match(ipc, /: manualCodingShape === 'full'\s*\? 'Output the full solution NOW in one fenced code block with the six-section coding format\./);
    assert.doesNotMatch(ipc, /: buildCodingContractPrompt\(null\);/);
    // What that contract says for a non-full shape vs a full one.
    assert.doesNotMatch(buildCodingContractPrompt(null, { codingShape: 'solve' }), /Every heading is mandatory/);
    assert.match(buildCodingContractPrompt(null, { codingShape: 'full' }), /Every heading is mandatory/);
  });

  test('chat + hotkey verification pass the shape to the correction', () => {
    assert.match(SRC('electron/ipcHandlers.ts'), /answer: verifyTarget,\s*question: message,\s*codingShape: manualCodingShape,/);
    const engine = SRC('electron/IntelligenceEngine.ts');
    assert.match(engine, /verificationCancellationToken\.signal,[\s\S]{0,300}detectCodingShape\(answerPlan\.question\),\s*\)/);
    assert.match(engine, /screenText,\s*codingShape,/);
  });

  test('legacy repeat-press directive only rides a solve turn, and no longer demands the full section shape', () => {
    const wta = SRC('electron/llm/WhatToAnswerLLM.ts');
    assert.match(wta, /if \(promotedScreenCodingTurn && codingSignals\.codingShape === 'solve'\) \{/);
    assert.doesNotMatch(wta, /full section shape/);
  });
});
