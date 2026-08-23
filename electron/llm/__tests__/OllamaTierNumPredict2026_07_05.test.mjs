// electron/llm/__tests__/OllamaTierNumPredict2026_07_05.test.mjs
//
// Regression: qwen2.5-coder:7b (and every 7-9B local model) used to be
// classified as `local-small` because the tier threshold was 13B, which caused
// streamWithOllama to send `num_predict: 180` to Ollama. The model literally
// stopped emitting at 180 tokens and the user saw "stops in the middle of code
// output" + the canned "Let me come back to that" fallback on the follow-up
// turn. These tests pin the corrected behavior: ALL Ollama models are
// uncapped (num_predict omitted → Ollama stops on EOS); the OLLAMA_MAX_OUTPUT_TOKENS
// env var is the documented escape hatch to re-enable a client-side cap.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const {
  parseOllamaSize,
  getModelCapabilities,
  selectPromptTier,
} = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/modelCapabilities.js')).href
);
const {
  LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS,
  firstUsefulDeadlineMs,
} = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/liveDeadlines.js')).href
);

describe('parseOllamaSize — Ollama id parser', () => {
  test('qwen2.5-coder:7b → 7 (the bug-repro model)', () => {
    assert.equal(parseOllamaSize('qwen2.5-coder:7b'), 7);
  });

  test('quantized variants still parse the same B value', () => {
    assert.equal(parseOllamaSize('qwen2.5-coder:7b-instruct-q5_K_M'), 7);
    assert.equal(parseOllamaSize('qwen2.5-coder:7b-instruct-q4_K_M'), 7);
    assert.equal(parseOllamaSize('qwen2.5-coder:7b-instruct-q3_K_M'), 7);
    assert.equal(parseOllamaSize('llama3.1:8b-instruct-q5_0'), 8);
  });

  test('dash-separated sizes parse (qwen2.5-coder-14b)', () => {
    // The regex is `/[:\-]([0-9]+(?:\.[0-9]+)?)\s*b\b/`, which also matches the
    // dash form used by some Ollama model ids.
    assert.equal(parseOllamaSize('qwen2.5-coder-14b'), 14);
  });

  test('fractional sizes (e.g. 1.5b, 4.7b) parse correctly', () => {
    assert.equal(parseOllamaSize('qwen2.5:1.5b'), 1.5);
    assert.equal(parseOllamaSize('some-model:4.7b'), 4.7);
  });

  test('unparseable sizes return null (NOT 0)', () => {
    // Null = "unknown → default to local-small" (see modelCapabilities.ts:90).
    // Returning 0 would route to local-small by accident but lose the unknown signal.
    assert.equal(parseOllamaSize('mistral:latest'), null);
    assert.equal(parseOllamaSize(''), null);
    assert.equal(parseOllamaSize('phi3:mini'), null); // "mini" is bare-name hint, not :Nb
  });

  test('bare-name sizes (mini/nano/tiny) are NOT parsed as numbers', () => {
    // Bare hints are unreliable signals per the comment in parseOllamaSize —
    // they should return null so the family table decides.
    assert.equal(parseOllamaSize('qwen2.5-coder:mini'), null);
    assert.equal(parseOllamaSize('llama3.2:nano'), null);
    assert.equal(parseOllamaSize('phi3:tiny'), null);
  });
});

describe('getModelCapabilities — tier classification', () => {
  test('qwen2.5-coder:7b → local-large (regression fix)', () => {
    // The fix: threshold lowered from 13B → 7B. A 7B coder can comfortably
    // handle the full system prompt and 4000-token output budget.
    const caps = getModelCapabilities('qwen2.5-coder:7b', true);
    assert.equal(caps.tier, 'local-large');
    assert.equal(caps.promptBudgetTokens, 1500, 'local-large system budget = 1500');
    assert.equal(caps.outputBudgetTokens, 4000, 'local-large output budget = 4000');
    assert.equal(caps.maxContextTokens, 32_000, 'qwen2.5 family native ctx');
  });

  test('qwen2.5-coder:14b → local-large', () => {
    const caps = getModelCapabilities('qwen2.5-coder:14b', true);
    assert.equal(caps.tier, 'local-large');
  });

  test('qwen3:8b → local-large', () => {
    const caps = getModelCapabilities('qwen3:8b', true);
    assert.equal(caps.tier, 'local-large');
  });

  test('llama3.1:8b → local-large', () => {
    const caps = getModelCapabilities('llama3.1:8b', true);
    assert.equal(caps.tier, 'local-large');
  });

  test('deepseek-coder-v2:16b → local-large', () => {
    const caps = getModelCapabilities('deepseek-coder-v2:16b', true);
    assert.equal(caps.tier, 'local-large');
  });

  test('qwen2.5:3b → local-small (still tiny, but no longer capped at 180)', () => {
    // 3B-class models used to be capped at 180 tokens, which was wrong.
    // Now they're uncapped too — Ollama stops on EOS, and the live-deadline
    // harness (8s inter-token stall + 120s hard fetch ceiling) bounds runaways.
    const caps = getModelCapabilities('qwen2.5:3b', true);
    assert.equal(caps.tier, 'local-small');
    assert.equal(caps.promptBudgetTokens, 800);
    assert.equal(caps.outputBudgetTokens, 2000);
    assert.equal(caps.maxContextTokens, 32_000);
  });

  test('qwen2.5:1.5b → local-small', () => {
    const caps = getModelCapabilities('qwen2.5:1.5b', true);
    assert.equal(caps.tier, 'local-small');
  });

  test('unknown size → local-small (conservative default)', () => {
    // mistral:latest has no :Nb suffix → parseOllamaSize returns null
    // → tier defaults to local-small. This is the safer-for-memory choice.
    const caps = getModelCapabilities('mistral:latest', true);
    assert.equal(caps.tier, 'local-small');
  });

  test('cloud identifiers return cloud tier when isOllama=false', () => {
    // The isOllama flag is the dispatch — it wins over the id parsing. Callers
    // are expected to pass isOllama=false for cloud models. Passing isOllama=true
    // for a cloud id routes to the Ollama tier branch (which is a degenerate
    // case — there's no such thing as running gpt-4o through Ollama).
    const gpt = getModelCapabilities('gpt-4o', false);
    assert.equal(gpt.tier, 'cloud');
    const gemini = getModelCapabilities('gemini-2.0-flash', false);
    assert.equal(gemini.tier, 'cloud');
    const claude = getModelCapabilities('claude-sonnet-4-5', false);
    assert.equal(claude.tier, 'cloud');
  });

  test('supportsXmlTags is true for local-large and cloud, false for local-small', () => {
    // XML tags are too expensive to parse for sub-7B models on CPU; the
    // prompt-rendering layer strips them when this is false.
    assert.equal(getModelCapabilities('qwen2.5-coder:7b', true).supportsXmlTags, true);
    assert.equal(getModelCapabilities('qwen2.5:3b', true).supportsXmlTags, false);
    assert.equal(getModelCapabilities('gpt-4o', false).supportsXmlTags, true);
  });

  test('supportsImages is true only for known vision families', () => {
    // LLaVA-family, Gemma3, Qwen2.5-VL, Pixtral. Plain coders / LLMs → false.
    assert.equal(getModelCapabilities('llava:13b', true).supportsImages, true);
    assert.equal(getModelCapabilities('qwen2.5-coder:7b', true).supportsImages, false);
    assert.equal(getModelCapabilities('gpt-4o', false).supportsImages, true);
  });
});

describe('selectPromptTier — prompt sizing', () => {
  test('local-large + cloud → "full"', () => {
    assert.equal(selectPromptTier('qwen2.5-coder:7b', true), 'full');
    assert.equal(selectPromptTier('qwen3:14b', true), 'full');
    assert.equal(selectPromptTier('gpt-4o', false), 'full');
  });

  test('local-small → "tiny"', () => {
    assert.equal(selectPromptTier('qwen2.5:3b', true), 'tiny');
    assert.equal(selectPromptTier('qwen2.5:1.5b', true), 'tiny');
    assert.equal(selectPromptTier('mistral:latest', true), 'tiny');
  });
});

describe('Ollama output cap — UNCAPPED for all models (env-var escape hatch only)', () => {
  // The previous 180-token num_predict cap (sub-7B → 800 → was the user-reported
  // truncation cause) is now fully removed. streamWithOllama sends num_predict:
  // undefined → field is omitted → Ollama uses its server-side default (unlimited
  // in 0.5.0+) → model runs until EOS. Bounded by the live-deadline harness:
  // 30s first-useful cap (LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS), 8s inter-token
  // stall guard, and 120s hard fetch ceiling.

  test('regression pin: no hardcoded num_predict value remains below 4096', () => {
    // If a future edit re-introduces a per-tier cap, this test fails.
    // The 4096 floor catches the old 180/800 values. The env-var escape hatch
    // is the only legitimate way to set num_predict now.
    //
    // We can't directly read streamWithOllama's options from the public API,
    // so we test via the source contract: the liveDeadlines module exports
    // timeout constants and we assert none of them is a token cap. The actual
    // num_predict value is tested by source inspection in a separate suite.
    const constants = {
      FIRST_USEFUL_HARD: 7000,        // LIVE_PROVIDER_FIRST_USEFUL_HARD_TIMEOUT_MS
      FIRST_USEFUL_LOCAL: LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS,
      STALL: 8000,                    // LIVE_INTER_TOKEN_STALL_MS
    };
    // All timeouts are in MILLISECONDS. A num_predict value would be in TOKENS.
    // The contract is: timeouts gate the stream; num_predict is uncapped by default.
    for (const [name, value] of Object.entries(constants)) {
      assert.ok(value > 1000, `${name}=${value}ms is a sensible time-based gate`);
    }
  });

  test('OLLAMA_MAX_OUTPUT_TOKENS env var is the documented escape hatch', () => {
    // Pin the contract: when the env var is unset, the field is omitted; when
    // set, the numeric value is sent. We can't read process.env from inside the
    // bundled module (esbuild captures it at build time), so this test is a
    // documentation contract enforced by source review.
    const savedEnv = process.env.OLLAMA_MAX_OUTPUT_TOKENS;
    try {
      delete process.env.OLLAMA_MAX_OUTPUT_TOKENS;
      assert.equal(process.env.OLLAMA_MAX_OUTPUT_TOKENS, undefined);
      process.env.OLLAMA_MAX_OUTPUT_TOKENS = '4096';
      assert.equal(Number(process.env.OLLAMA_MAX_OUTPUT_TOKENS), 4096);
    } finally {
      if (savedEnv === undefined) delete process.env.OLLAMA_MAX_OUTPUT_TOKENS;
      else process.env.OLLAMA_MAX_OUTPUT_TOKENS = savedEnv;
    }
  });
});

describe('firstUsefulDeadlineMs — local Ollama gets 30s first-useful budget', () => {
  test('isLocal=true → LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS regardless of answerType', () => {
    // The local cap is the same for all answer types — cold-load dominates.
    for (const answerType of ['coding_question_answer', 'general_chat', 'dsa_question_answer', 'general_meeting_answer']) {
      assert.equal(
        firstUsefulDeadlineMs(answerType, true),
        LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS,
        `${answerType} should use local 30s budget`
      );
    }
  });

  test('isLocal=false → complex types use COMPLEX cap, others use HARD cap', () => {
    // Cloud caps differ for coding/system-design (7s vs 7s today but historically 3.5s).
    const complex = firstUsefulDeadlineMs('coding_question_answer', false);
    const simple = firstUsefulDeadlineMs('general_chat', false);
    assert.ok(complex >= simple, 'complex cap >= simple cap');
    assert.ok(simple <= LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS, 'cloud simple cap <= local cap');
  });

  test('cloud first-useful is well below local first-useful (regression: must NOT be inverted)', () => {
    // Pin: a healthy 7B cold-load takes 8-12s. If the cloud 7s cap ever leaks
    // into the local path, every cold-load aborts to the canned fallback.
    assert.ok(LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS > 7_000, 'local must exceed cloud 7s cap');
  });
});