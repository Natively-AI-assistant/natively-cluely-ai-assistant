import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

function getGenerateMeetingSummaryBody() {
  const src = read('electron/LLMHelper.ts');
  const start = src.indexOf('public async generateMeetingSummary');
  const end = src.indexOf('\n  public async switchToOllama', start);
  assert.notEqual(start, -1, 'generateMeetingSummary exists');
  assert.notEqual(end, -1, 'generateMeetingSummary end marker exists');
  return src.slice(start, end);
}

test('meeting summaries try OpenAI before Gemini fallbacks', () => {
  const body = getGenerateMeetingSummaryBody();
  const openAiAttempt = body.indexOf('Attempting OpenAI for summary');
  // The Gemini cascade starts at Flash-Lite, then Flash, then Pro.
  const geminiCascadeAttempt = body.indexOf('Attempting Gemini Flash-Lite for summary');

  assert.notEqual(openAiAttempt, -1, 'OpenAI summary attempt exists');
  assert.notEqual(geminiCascadeAttempt, -1, 'Gemini fallback cascade still exists');
  assert.ok(openAiAttempt < geminiCascadeAttempt, 'OpenAI is attempted before the Gemini cascade');
  assert.ok(
    body.includes('this.generateWithOpenai(`Context:\\n${context}`, systemPrompt)'),
    'summary path uses the existing OpenAI helper',
  );
});

test('meeting summaries prefer selected OpenAI before Groq and guard Gemini by client', () => {
  const body = getGenerateMeetingSummaryBody();
  const selectedOpenAiCheck = body.indexOf('this.isOpenAiModel(this.currentModelId)');
  const groqAttempt = body.indexOf('Attempting Groq for summary');
  const openAiFallback = body.indexOf('const text = await tryOpenAiSummary();', groqAttempt);
  const geminiFlashLiteAttempt = body.indexOf('Attempting Gemini Flash-Lite for summary');
  const geminiClientGuard = body.lastIndexOf('if (this.client) {', geminiFlashLiteAttempt);

  assert.notEqual(selectedOpenAiCheck, -1, 'selected OpenAI check exists');
  assert.notEqual(groqAttempt, -1, 'Groq fallback exists');
  assert.ok(selectedOpenAiCheck < groqAttempt, 'selected OpenAI is preferred before Groq');
  assert.notEqual(openAiFallback, -1, 'unselected OpenAI is tried after Groq');
  assert.ok(openAiFallback < geminiFlashLiteAttempt, 'OpenAI fallback precedes the Gemini cascade');
  assert.ok(
    geminiClientGuard > openAiFallback && geminiClientGuard < geminiFlashLiteAttempt,
    'the Gemini cascade is skipped when no Gemini client is configured',
  );
});
