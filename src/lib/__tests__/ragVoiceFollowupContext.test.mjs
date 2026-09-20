// src/lib/__tests__/ragVoiceFollowupContext.test.mjs
// Issue #552 regression tests:
// 1. Spoken voice follow-ups during meetings must preserve chat conversation context.
// 2. handleAnswerNow guards ragQueryLive when prior chat messages exist and query is a follow-up.
// 3. Conversation context from messages is included in prompt/dispatch.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.resolve(repoRoot, rel), 'utf8');

describe('Issue #552 Voice Path RAG Pre-flight Context Preservation', () => {
  test('handleAnswerNow in NativelyInterface.tsx guards ragQueryLive for follow-ups', () => {
    const src = read('src/components/NativelyInterface.tsx');
    const answerNowFn = src.slice(
      src.indexOf('const handleAnswerNow = async () => {'),
      src.indexOf('const handleSendMessage = async () => {')
    );

    assert.ok(answerNowFn, 'handleAnswerNow must exist');
    // Must check for prior chat / follow-up before calling ragQueryLive
    assert.match(
      answerNowFn,
      /isFollowUpAsk|isSpokenFollowUp|hasPriorChat/,
      'handleAnswerNow must check if spoken question is a follow-up before RAG pre-flight'
    );
    assert.match(
      answerNowFn,
      /buildConversationContextFromMessages\s*\(\s*messages\s*\)/,
      'handleAnswerNow must build conversation context from messages'
    );
  });
});
