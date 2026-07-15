import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(here, '../../ipcHandlers.ts'), 'utf8');

test('manual chat forwards the complete AnswerPlan to the final context injector', () => {
  const handlerStart = source.indexOf('const _geminiChatStreamHandler = async');
  const handlerEnd = source.indexOf("safeHandle('gemini-chat-stream', _geminiChatStreamHandler)", handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'manual stream handler not found');
  const handler = source.slice(handlerStart, handlerEnd);

  assert.match(handler, /answerType:\s*answerPlan\.answerType/);
  assert.match(handler, /requiredContextLayers:\s*answerPlan\.requiredContextLayers/);
  assert.match(handler, /currentQuestion:\s*answerPlan\.question/);
  assert.match(handler, /retrievalQuestion:\s*manualRetrievalQuestion/);
  assert.match(handler, /profileFactIntent:\s*answerPlan\.profileFactIntent/);
  assert.match(handler, /forbiddenContextLayers:\s*answerPlan\.forbiddenContextLayers/);
});

test('manual retrieval uses the resolved antecedent without replacing the current question', () => {
  const handlerStart = source.indexOf('const _geminiChatStreamHandler = async');
  const handlerEnd = source.indexOf("safeHandle('gemini-chat-stream', _geminiChatStreamHandler)", handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);

  assert.match(handler, /manualRetrievalQuestion\s*=\s*answerPlan\.retrievalQuestion/);
  assert.match(handler, /currentQuestion:\s*answerPlan\.question/);
  assert.doesNotMatch(handler, /currentQuestion:\s*manualRetrievalQuestion/);
  assert.match(handler, /buildManualProfileEvidenceRoute\(\{[\s\S]{0,180}question:\s*manualRetrievalQuestion/);
  assert.match(handler, /retrieveProfileEvidence\(\{[\s\S]{0,180}question:\s*manualRetrievalQuestion/);
});
