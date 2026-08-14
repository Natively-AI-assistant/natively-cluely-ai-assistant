import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

async function loadRouter() {
  const routerPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/ProviderRouter.js');
  return import(pathToFileURL(routerPath).href);
}

test('embeddings scope denial routes through Ollama before bundled local fallback', () => {
  const src = read('electron/rag/EmbeddingProviderResolver.ts');

  assert.match(src, /error instanceof ProviderScopeError/);
  assert.match(src, /\[ScopeFallback\] embeddings denied for cloud; routing to Ollama/);
  assert.match(src, /candidates\.push\(new OllamaEmbeddingProvider/);
  assert.match(src, /const local = new LocalEmbeddingProvider\(\)/);
});

test('embeddings scope denial gracefully uses bundled local embeddings when Ollama is unavailable', () => {
  const src = read('electron/rag/EmbeddingProviderResolver.ts');

  assert.match(src, /\[ScopeFallback\] embeddings denied; Ollama unavailable, using bundled local embedding model/);
  assert.match(src, /return local/);
});

test('transcript scope denial routes full context to Ollama when available', () => {
  const src = read('electron/LLMHelper.ts');

  assert.match(src, /deniedOutboundScopes\.includes\('transcript'\)/);
  assert.match(src, /this\.logScopeFallback\(scope, ollamaAvailable \? 'routing' : 'omitting'\)/);
  assert.match(src, /return await this\.callOllama\(combinedMessages\.gemini, imagePaths, undefined\)/);
  assert.match(src, /yield\* this\.streamWithOllama\(message, context/);
});

test('transcript scope denial omits transcript from cloud calls when Ollama is unavailable', () => {
  const src = read('electron/LLMHelper.ts');

  assert.match(src, /shouldOmitContext = deniedOutboundScopes\.some\(scope => scope === 'transcript' \|\| scope === 'reference_files' \|\| scope === 'profile_history' \|\| scope === 'post_call_summary'\)/);
  assert.match(src, /cloudContext = shouldOmitContext \? undefined : context/);
  assert.match(src, /const cloudCombinedMessages = \{/);
  assert.match(src, /return await this\.generateWithCodexCli\(cloudUserContent/);
  assert.match(src, /return await this\.generateWithGroq\(cloudUserContent/);
  assert.match(src, /return await this\.chatWithCurl\(cloudUserContent/);
  assert.match(src, /shouldOmitContext \? "" : context \|\| ""/);
});

test('LLMHelper infers auxiliary context and embedded message scopes before cloud routing', () => {
  const src = read('electron/LLMHelper.ts');

  assert.match(src, /inferContextScopes\(context\?: string\): ProviderDataScope\[\]/);
  assert.match(src, /inferEmbeddedMessageScopes\(message\?: string\): ProviderDataScope\[\]/);
  assert.match(src, /<reference_file\|<active_mode_retrieved_context\|mode_retrieval/);
  assert.match(src, /<meeting_history\|USER-PROVIDED PERSONA CONTEXT\|<user_context\|<candidate_\|<active_mode_custom_instructions/);
  assert.match(src, /<post_call_summary\|meeting summary\|silent meeting summarizer\|silent meeting note-taker/);
  assert.match(src, /stripDeniedScopedBlocksFromMessage\(message, deniedOutboundScopes\)/);
});

test('routeLLMProviders keeps Ollama available when cloud scopes are denied', async () => {
  const { routeLLMProviders, routeWithScopeFallback, hasLocalFallbackAvailable } = await loadRouter();

  assert.equal(hasLocalFallbackAvailable(['llama3.2']), true);
  assert.equal(hasLocalFallbackAvailable([]), false);

  const attempts = routeLLMProviders({
    capability: 'chat',
    availability: { hasOpenAI: true, hasGroq: true, hasGemini: true, hasOllama: true },
    models: { ollama: 'llama3.2' },
    dataScopes: ['transcript'],
    scopePolicy: { transcript: false },
  });

  assert.equal(attempts.find(a => a.provider === 'openai')?.status, 'unavailable');
  assert.equal(attempts.find(a => a.provider === 'openai')?.unavailableReason, 'disabled');
  assert.equal(attempts.find(a => a.provider === 'ollama')?.status, 'available');
  assert.deepEqual(routeWithScopeFallback({
    capability: 'chat',
    availability: { hasOllama: true },
    dataScopes: ['transcript'],
    scopePolicy: { transcript: false },
  }), routeLLMProviders({
    capability: 'chat',
    availability: { hasOllama: true },
    dataScopes: ['transcript'],
    scopePolicy: { transcript: false },
  }));
});

test('WhatToAnswerLLM document-grounded mode fails closed when reference_files scope is denied and local fallback unavailable', () => {
  const src = read('electron/llm/WhatToAnswerLLM.ts');

  assert.match(src, /DOCUMENT_GROUNDING_SCOPE_DENIED_MESSAGE/);
  assert.match(src, /documentGroundedCustomModeActive = activeModeGroundingInfo\?\.documentGroundedCustomModeActive === true/);
  assert.match(src, /if \(forceDocumentGrounding\) \{\s*yield DOCUMENT_GROUNDING_SCOPE_DENIED_MESSAGE;\s*return;\s*\}/);
});

test('MeetingPersistence post_call_summary denial falls back to local summary path', () => {
  const meetingPersistence = read('electron/MeetingPersistence.ts');
  const llmHelper = read('electron/LLMHelper.ts');

  assert.match(meetingPersistence, /\[ScopeFallback\] post_call_summary denied for cloud; routing to Ollama/);
  assert.match(llmHelper, /getDeniedDataScopes\(\['post_call_summary'\], this\.getProviderScopePolicy\(\)\)/);
  assert.match(llmHelper, /this\.logScopeFallback\('post_call_summary', ollamaAvailable \? 'routing' : 'omitting'\)/);
  assert.match(llmHelper, /this\.callOllama\(`Context:\\n\$\{context\}`/);
});
