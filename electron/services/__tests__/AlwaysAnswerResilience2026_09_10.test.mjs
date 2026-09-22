// Source-pinned guards for the 2026-09-10 "answer regardless" resilience fixes.
//
// Each of these was measured live with a stalled resolver / hosted route and
// a working Gemini key on file, and each is a one-line regression away from
// silently returning. They pin the SHAPE of the code the live run proved,
// the way ModeUploadHardening pins the upload contract.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf8');

describe('main process DNS', () => {
  test('main.ts installs the resilient lookup and no longer routes natively through c-ares first', () => {
    const main = read('main.ts');
    assert.match(main, /installResilientDnsLookup\(\)/);
    assert.doesNotMatch(main, /dns\.resolve4\(hostname/, 'the unbounded c-ares-first override must not come back');
    assert.doesNotMatch(main, /^dns\.lookup = /m);
  });

  test('the resilient lookup bounds every resolver attempt and caches', () => {
    const src = read('utils/resilientDnsLookup.ts');
    assert.match(src, /DNS_ATTEMPT_TIMEOUT_MS = 2_500/);
    assert.match(src, /DNS_CACHE_TTL_MS = 60_000/);
    assert.match(src, /serving the address from/);
  });
});

describe('natively text race lets a configured spare land', () => {
  const src = read('LLMHelper.ts');
  test('natively gets one attempt when a spare exists', () => {
    assert.match(src, /if \(rung\.id === 'natively'\) rung\.maxAttempts = 1;/);
  });
  test('spares receive the natively-sized first-token budget instead of the 2.5 s text default', () => {
    assert.match(src, /else if \(rung\.ttftTimeoutMs == null\) rung\.ttftTimeoutMs = NATIVELY_TEXT_TTFT_MS;/);
  });
  test('the reshaping is gated on a spare actually existing', () => {
    const i = src.indexOf("if (rung.id === 'natively') rung.maxAttempts = 1;");
    const before = src.slice(Math.max(0, i - 400), i);
    assert.match(before, /if \(textProviders\.length > 1\)/);
  });
});

describe('manual chat never dresses a provider failure as document absence', () => {
  test('the property-refusal substitution is skipped on provider_error_no_answer', () => {
    const src = read('ipcHandlers.ts');
    const i = src.indexOf('propertyRefusalLine = buildInsufficientPropertyAnswer');
    assert.ok(i > 0);
    const guard = src.slice(Math.max(0, i - 1400), i);
    assert.match(guard, /finalGenerationMode !== 'provider_error_no_answer'/);
  });
});

describe('the V3 plan timeout reaches the query embed', () => {
  test('mode-retrieval-port forwards opts.timeoutMs as queryEmbedRetryBudgetMs, not rerankDeadlineMs', () => {
    const src = read('context-intelligence/retrieval/mode-retrieval-port.ts');
    assert.match(src, /queryEmbedRetryBudgetMs: opts\.timeoutMs/);
    assert.doesNotMatch(src, /rerankDeadlineMs: opts\.timeoutMs/);
  });
  test('ModeContextRetriever threads the budget to the hybrid retriever', () => {
    assert.match(read('services/ModeContextRetriever.ts'), /queryEmbedRetryBudgetMs: options\.queryEmbedRetryBudgetMs/);
  });
});

describe('a session reset is a conversation boundary', () => {
  test('IntelligenceManager.reset clears the V3 conversation-state store', () => {
    const src = read('IntelligenceManager.ts');
    const i = src.indexOf('reset(): void {');
    assert.ok(i > 0);
    assert.match(src.slice(i, i + 900), /clearConversationState\(\)/);
  });
});

describe('a manual press answers the user\'s own newer question', () => {
  test('IntelligenceEngine prefers a question-shaped user utterance that came after the other party\'s', () => {
    const src = read('IntelligenceEngine.ts');
    assert.match(src, /question_from_user_utterance/);
    const i = src.indexOf('question_from_user_utterance');
    const block = src.slice(Math.max(0, i - 2600), i);
    assert.match(block, /!isSpeculative && !question\?\.trim\(\)/, 'only on a manual press with no typed question');
    assert.match(block, /what do you mean/, 'a clarification thrown back at the other party keeps the extractor\'s choice');
  });
});

describe('manual chat: the screen port and the request share one session key (2026-09-11)', () => {
  test('ipcHandlers builds the screen port under v3ConversationSessionId, not the raw sender id', () => {
    const src = read('ipcHandlers.ts');
    const i = src.indexOf('.createScreenRetrievalPort({');
    assert.ok(i > 0, 'manual chat builds a screen port');
    const block = src.slice(i, i + 900);
    assert.match(block, /sessionId: v3ConversationKey,/, 'the port scope must equal the request scope or every screen chunk is OUT_OF_SCOPE');
    assert.match(src, /const v3ConversationKey = v3ConversationSessionId\(appState, senderId\);/, 'the request scope the port must match');
    assert.doesNotMatch(block, /sessionId: String\(senderId\)/);
  });
});
