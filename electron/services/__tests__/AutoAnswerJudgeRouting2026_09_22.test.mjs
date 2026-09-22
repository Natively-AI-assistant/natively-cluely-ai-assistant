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

  test('every provider gets a SMALL-tier rung: Gemini flash-lite, Groq, OpenAI mini, DeepSeek, Claude Haiku', () => {
    assert.match(JUDGE, /GEMINI_FLASH_LITE_MODEL/);
    assert.match(JUDGE, /this\.groqClient/);
    assert.match(JUDGE, /this\.createGroqCompletion\(/);
    assert.match(JUDGE, /OPENAI_JUDGE_MODEL/);
    assert.match(JUDGE, /this\.deepseekClient/);
    assert.match(JUDGE, /CLAUDE_JUDGE_MODEL/);
  });

  test('the judge never borrows the chat model: no currentModelId, no generateWithOpenai/Claude/Deepseek helpers inside the ladder', () => {
    assert.doesNotMatch(JUDGE, /currentModelId/);
    assert.doesNotMatch(JUDGE, /this\.generateWithOpenai\(/);
    assert.doesNotMatch(JUDGE, /this\.generateWithClaude\(/);
    assert.doesNotMatch(JUDGE, /this\.generateWithDeepseek\(/);
  });

  test('the judge tiers are the small models, not the chat defaults', () => {
    const openai = LLM.match(/const OPENAI_JUDGE_MODEL = "([^"]+)"/)?.[1];
    const claude = LLM.match(/const CLAUDE_JUDGE_MODEL = "([^"]+)"/)?.[1];
    assert.ok(openai && /mini|nano/.test(openai), `OPENAI_JUDGE_MODEL must be a mini/nano tier (got ${openai})`);
    assert.ok(claude && /haiku/.test(claude), `CLAUDE_JUDGE_MODEL must be a Haiku tier (got ${claude})`);
    assert.notEqual(openai, LLM.match(/const OPENAI_MODEL = "([^"]+)"/)?.[1]);
    assert.notEqual(claude, LLM.match(/const CLAUDE_MODEL = "([^"]+)"/)?.[1]);
  });

  test('every rung honours the outbound data-scope policy and its rate limiter', () => {
    for (const provider of ['gemini', 'groq', 'openai', 'deepseek', 'claude']) {
      assert.match(JUDGE, new RegExp(`assertOutboundScopes\\('${provider}'`), `${provider} rung asserts outbound scopes`);
      assert.match(JUDGE, new RegExp(`rateLimiters\\.${provider}\\.acquire\\(\\)`), `${provider} rung acquires its limiter`);
    }
  });

  test('the structured ladder is the LAST resort, after every small rung', () => {
    const last = JUDGE.lastIndexOf('this.generateContentStructured(');
    assert.ok(last > JUDGE.indexOf('CLAUDE_JUDGE_MODEL'), 'falls through only after the Claude rung');
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
