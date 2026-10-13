import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  buildOverlayUserContextBlock,
  OVERLAY_CONTEXT_MAX_CHARS,
} from '../context/overlayUserContext.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('buildOverlayUserContextBlock wraps trimmed text in user_context tags', () => {
  assert.equal(
    buildOverlayUserContextBlock('  Role: PM at Acme  '),
    '<user_context>\nRole: PM at Acme\n</user_context>',
  );
  assert.equal(buildOverlayUserContextBlock(''), '');
  assert.equal(buildOverlayUserContextBlock('   '), '');
});

test('overlay context is injected into streamChat and PromptAssembler paths', () => {
  const llmSource = fs.readFileSync(path.resolve(__dirname, '../../LLMHelper.ts'), 'utf8');
  const assemblerSource = fs.readFileSync(
    path.resolve(__dirname, '../context/PromptAssembler.ts'),
    'utf8',
  );
  const ipcSource = fs.readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');

  assert.match(llmSource, /buildOverlayUserContextBlock\(this\.overlayContext\)/);
  assert.match(assemblerSource, /overlayContext\?: string/);
  assert.match(assemblerSource, /overlay_user_context/);
  assert.match(ipcSource, /overlay:save-context/);
  assert.match(ipcSource, /OVERLAY_CONTEXT_MAX_CHARS/);
  assert.equal(OVERLAY_CONTEXT_MAX_CHARS, 32000);
});

// 2026-10-13: the limit went 8k -> 32k. The assembler fits everything into one
// token budget, so every caller must add the overlay context's size to it; with
// the flat budget a full-size context was cut to ~6.7k chars and the raise did
// nothing.
test('a full-size overlay context survives whole, with the question, when its size is budgeted', () => {
  const require = createRequire(import.meta.url);
  const dist = path.resolve(__dirname, '../../../dist-electron/electron');
  const { PromptAssembler } = require(path.join(dist, 'services/context/PromptAssembler.js'));
  const { estimateTokens } = require(path.join(dist, 'llm/modelCapabilities.js'));
  // Numbered lines, so the tail is unique and a truncated copy cannot contain it.
  let overlay = '';
  for (let i = 0; overlay.length < OVERLAY_CONTEXT_MAX_CHARS - 40; i++) overlay += `Note ${i}: background detail.\n`;
  const tail = overlay.trim().slice(-60);
  const question = 'Interviewer: which nut is also called the Queensland nut?';
  const assemble = (tokenBudget) => new PromptAssembler().assemble({ transcript: question, overlayContext: overlay, tokenBudget }).userMessage;

  assert.ok(!assemble(2000).includes(tail), 'flat budget: the end of the context is cut (why the budget must grow)');
  const budgeted = assemble(2000 + estimateTokens(buildOverlayUserContextBlock(overlay)));
  assert.ok(budgeted.includes(question), 'question survives');
  assert.ok(budgeted.includes(tail), 'the whole context survives, end included');
});

test('every assembler caller and Direct Assist carry the overlay context with its own budget', () => {
  const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
  assert.match(read('../../llm/WhatToAnswerLLM.ts'), /estimateTokens\(buildOverlayUserContextBlock\(requestSnapshot\?\.interviewBundle\?\.overlayContext\)\)/);
  for (const f of ['../../llm/RestateLLM.ts', '../../llm/LookupLLM.ts']) {
    assert.match(read(f), /tokenBudget: \d+ \+ estimateTokens\(buildOverlayUserContextBlock\(interviewCtx\.overlayContext\)\)/, f);
  }
  assert.match(read('../../ipcHandlers.ts'), /manualContext: \[appState\.getIntelligenceManager\(\)\.getOverlayContext\(\)/);
});
