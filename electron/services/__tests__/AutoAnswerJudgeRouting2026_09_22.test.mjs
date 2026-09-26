import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.resolve(repoRoot, rel), 'utf8');

// The Auto Answer judge is a yes/no JSON verdict on ~2k tokens. Live telemetry
// (2026-09-22, an OpenAI-only user on gpt-5.6-luna): with no Gemini key the
// judge fell into generateContentStructured, whose OpenAI rung takes the
// CURRENT chat model — so the classification ran on the heaviest model
// configured: 1.4 s median, 2.5 s p90 (= the deadline), 41 of 83 calls
// superseded mid-flight and paid for nothing. Groq and DeepSeek had no judge
// rung at all, so a Groq-only user got the regex fallback ("only a trailing
// '?' fires"). LLMHelper cannot be instantiated outside Electron, so these are
// source-level guards on the ladder's shape.

const LLM = read('electron/LLMHelper.ts');
const judgeStart = LLM.indexOf('public async generateJudgeVerdict(');
const judgeEnd = LLM.indexOf('public async generateContentStructured(', judgeStart);
const JUDGE = LLM.slice(judgeStart, judgeEnd);

describe('generateJudgeVerdict ladder', () => {
  test('exists and is bounded', () => {
    assert.ok(judgeStart > 0 && judgeEnd > judgeStart, 'generateJudgeVerdict precedes generateContentStructured');
  });

  test('every provider gets an explicit judge rung: Gemini flash-lite, Groq, OpenAI, DeepSeek, Claude', () => {
    assert.match(JUDGE, /GEMINI_FLASH_LITE_MODEL/);
    assert.match(JUDGE, /this\.groqClient/);
    assert.match(JUDGE, /this\.createGroqCompletion\(/);
    assert.match(JUDGE, /OPENAI_JUDGE_MODEL/);
    assert.match(JUDGE, /this\.deepseekClient/);
    assert.match(JUDGE, /this\.claudeClient\.messages\.create\(/);
  });

  test('the judge never borrows the chat model: no currentModelId, no generateWithOpenai/Claude/Deepseek helpers inside the ladder', () => {
    assert.doesNotMatch(JUDGE, /currentModelId/);
    assert.doesNotMatch(JUDGE, /this\.generateWithOpenai\(/);
    assert.doesNotMatch(JUDGE, /this\.generateWithClaude\(/);
    assert.doesNotMatch(JUDGE, /this\.generateWithDeepseek\(/);
  });

  // Chosen by judgeEval.mjs on 146 labeled real-meeting candidates, not by
  // size: gpt-5.4-mini was faster but lost 3-7 of 19 real asks; gpt-5.5 caught
  // 14/19 (the old chat-model path 12-13/19) at p50 1.4 s vs 2.0 s. A change
  // here must come with a fresh eval run — this pins the measured choice.
  test('the OpenAI judge model is the MEASURED one, with the eval recorded beside it', () => {
    assert.equal(LLM.match(/const OPENAI_JUDGE_MODEL = "([^"]+)"/)?.[1], 'gpt-5.5');
    const block = LLM.slice(LLM.indexOf('// Auto Answer judge on the OpenAI rung'), LLM.indexOf('const OPENAI_JUDGE_MODEL'));
    assert.match(block, /recall 14\/19/, 'the eval result that justifies it sits next to the constant');
  });

  test('no unmeasured small tier is substituted on the Claude rung', () => {
    assert.match(JUDGE, /model: CLAUDE_MODEL,/);
    assert.doesNotMatch(JUDGE, /haiku/i);
  });

  test('every rung honours the outbound data-scope policy and its rate limiter', () => {
    for (const provider of ['gemini', 'groq', 'openai', 'deepseek', 'claude']) {
      assert.match(JUDGE, new RegExp(`assertOutboundScopes\\('${provider}'`), `${provider} rung asserts outbound scopes`);
      assert.match(JUDGE, new RegExp(`rateLimiters\\.${provider}\\.acquire\\(\\)`), `${provider} rung acquires its limiter`);
    }
  });

  test('the DeepSeek rung switches thinking off (the API default is ON)', () => {
    // DeepSeek defaults to thinking enabled / effort high; the reasoning runs
    // before any content, and in a 256-token verdict budget it can consume
    // everything, returning empty content — the rung silently falls through.
    const at = JUDGE.indexOf('this.deepseekClient.chat.completions.create(');
    assert.ok(at > 0);
    assert.match(JUDGE.slice(at, at + 700), /\.\.\.DEEPSEEK_NO_THINKING,/);
    assert.match(LLM, /const DEEPSEEK_NO_THINKING = \{ thinking: \{ type: 'disabled' as const \} \}/);
  });

  test('the structured ladder is the LAST resort, after every small rung', () => {
    const last = JUDGE.lastIndexOf('this.generateContentStructured(');
    const claudeRung = JUDGE.indexOf('this.claudeClient.messages.create(');
    assert.ok(claudeRung > 0 && last > claudeRung, 'falls through only after the Claude rung');
    assert.equal((JUDGE.match(/this\.generateContentStructured\(/g) || []).length, 1);
  });

  test('a superseded verdict aborts the rung in flight: the signal reaches every provider call', () => {
    assert.match(JUDGE, /opts: \{ signal\?: AbortSignal \}/);
    assert.match(JUDGE, /abortSignal: signal/, 'Gemini');
    assert.ok((JUDGE.match(/\{ signal \}/g) || []).length >= 4, 'Groq, OpenAI, DeepSeek and Claude pass the signal');
  });
});

describe('main.ts host wiring', () => {
  test('the controller signal is forwarded to generateJudgeVerdict', () => {
    const MAIN = read('electron/main.ts');
    assert.match(MAIN, /judgeCandidate: async \(req, signal\) =>/);
    assert.match(MAIN, /generateJudgeVerdict\(buildJudgePrompt\(req\), \{ signal \}\)/);
  });
});
