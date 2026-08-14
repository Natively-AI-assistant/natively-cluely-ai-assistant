import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sliceSafeHandleBlock, findSafeHandle } from './ipcTestUtils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

/**
 * ISSUE 1 (P0): Raw STT API Keys returned to renderer
 *
 * The get-stored-credentials IPC handler returns raw STT API keys (Deepgram,
 * ElevenLabs, OpenAI, Groq, Azure, IBM, Soniox) as plaintext strings to the
 * renderer. These keys are stored in renderer state and used to pre-populate
 * input fields, exposing them in the DOM/memory.
 *
 * Fix: Replace raw key values with masked versions (e.g., "sk-...abcd" format).
 * The hasSttGroqKey boolean already tells UI if key exists — no raw key needed.
 */
test('get-stored-credentials IPC does not return raw STT API keys', () => {
  const source = read('electron/ipcHandlers.ts');

  // Find the get-stored-credentials handler (single or double quotes)
  const handlerMatch = source.match(/safeHandle\(['"]get-stored-credentials['"]/);
  assert.ok(handlerMatch && handlerMatch.index !== undefined, 'get-stored-credentials handler should exist');

  // Extract just this handler (until the next safeHandle)
  const handlerStart = handlerMatch.index;
  const searchFrom = handlerStart + handlerMatch[0].length;
  const nextRel = source.slice(searchFrom).search(/safeHandle\(['"]/);
  const handlerEnd = nextRel === -1 ? source.length : searchFrom + nextRel;
  const handler = source.slice(handlerStart, handlerEnd);

  // STT keys should be boolean-only or masked, NOT raw key values
  // The problematic pattern is: sttGroqKey: creds.groqSttApiKey || ''
  // This returns the raw API key to the renderer

  // Check that raw credential access is NOT returned directly
  assert.doesNotMatch(handler, /sttGroqKey:\s*creds\.(groqSttApiKey|openAiSttApiKey|deepgramApiKey|elevenLabsApiKey|azureApiKey|ibmWatsonApiKey|sonioxApiKey)\s*\|\|/);
  assert.doesNotMatch(handler, /sttOpenaiKey:\s*creds\.(groqSttApiKey|openAiSttApiKey|deepgramApiKey|elevenLabsApiKey|azureApiKey|ibmWatsonApiKey|sonioxApiKey)\s*\|\|/);
  assert.doesNotMatch(handler, /sttDeepgramKey:\s*creds\.(groqSttApiKey|openAiSttApiKey|deepgramApiKey|elevenLabsApiKey|azureApiKey|ibmWatsonApiKey|sonioxApiKey)\s*\|\|/);
  assert.doesNotMatch(handler, /sttElevenLabsKey:\s*creds\.(groqSttApiKey|openAiSttApiKey|deepgramApiKey|elevenLabsApiKey|azureApiKey|ibmWatsonApiKey|sonioxApiKey)\s*\|\|/);
  assert.doesNotMatch(handler, /sttAzureKey:\s*creds\.(groqSttApiKey|openAiSttApiKey|deepgramApiKey|elevenLabsApiKey|azureApiKey|ibmWatsonApiKey|sonioxApiKey)\s*\|\|/);
  assert.doesNotMatch(handler, /sttIbmKey:\s*creds\.(groqSttApiKey|openAiSttApiKey|deepgramApiKey|elevenLabsApiKey|azureApiKey|ibmWatsonApiKey|sonioxApiKey)\s*\|\|/);
  assert.doesNotMatch(handler, /sttSonioxKey:\s*creds\.(groqSttApiKey|openAiSttApiKey|deepgramApiKey|elevenLabsApiKey|azureApiKey|ibmWatsonApiKey|sonioxApiKey)\s*\|\|/);

  // Verify that boolean flags still exist (to tell UI if key is present)
  assert.match(handler, /hasSttGroqKey:/);
  assert.match(handler, /hasSttOpenaiKey:/);
  assert.match(handler, /hasDeepgramKey:/);
  assert.match(handler, /hasElevenLabsKey:/);
  assert.match(handler, /hasAzureKey:/);
  assert.match(handler, /hasIbmWatsonKey:/);
  assert.match(handler, /hasSonioxKey:/);

  // If stt*Key fields are returned at all, they must be masked (e.g., "sk-...abcd" or empty string)
  // The correct pattern is: sttGroqKey: masked(creds.groqSttApiKey) or just omit the field entirely
  const rawKeyAssignments = handler.match(/stt(Groq|Openai|Deepgram|ElevenLabs|Azure|Ibm|Soniox)Key:\s*creds\.\w+\s*\|\|/g);
  if (rawKeyAssignments) {
    assert.fail(`Found raw STT key assignments: ${rawKeyAssignments.join(', ')}. These return API keys to the renderer.`);
  }
});

test('error fallback in get-stored-credentials does not return raw STT keys', () => {
  const source = read('electron/ipcHandlers.ts');

  const handlerStart = source.search(/safeHandle\(['"]get-stored-credentials['"]/);
  assert.ok(handlerStart >= 0, 'get-stored-credentials handler should exist');

  // Find the catch block that returns the error fallback object
  const catchBlock = source.indexOf('} catch (error: any) {', handlerStart);
  assert.ok(catchBlock >= 0, 'catch block should exist');

  const catchEnd = source.indexOf('});', catchBlock);
  const errorFallback = source.slice(catchBlock, catchEnd + 3);

  // Error fallback should NOT contain raw STT keys (non-empty strings)
  // Empty strings (sttGroqKey: '') are safe and acceptable
  assert.doesNotMatch(errorFallback, /stt(Groq|Openai|Deepgram|ElevenLabs|Azure|Ibm|Soniox)Key:\s*creds\.\w+/);
});

test('renderer settings overlay does not rely on raw STT keys from IPC', () => {
  const settingsOverlay = read('src/components/SettingsOverlay.tsx');

  // The renderer should use hasSttGroqKey (boolean) to know if a key exists,
  // not the raw key value for security

  // The problematic pattern is: if (creds.sttGroqKey) setSttGroqKey(creds.sttGroqKey)
  // This would accept and use a raw key if one were returned

  // Check that the renderer uses boolean flags for key presence
  assert.match(settingsOverlay, /hasStoredSttGroqKey/);
  assert.match(settingsOverlay, /hasStoredSttOpenaiKey/);
  assert.match(settingsOverlay, /hasStoredDeepgramKey/);
});

test('STT key fields in IPC response follow masked or boolean-only pattern', () => {
  const source = read('electron/ipcHandlers.ts');
  const handler = sliceSafeHandleBlock(source, 'get-stored-credentials');

  // Count stt*Key field assignments
  const keyFieldMatches = handler.match(/stt(Groq|Openai|Deepgram|ElevenLabs|Azure|Ibm|Soniox)Key:/g) || [];

  // If stt*Key fields are returned, they must NOT be raw creds access
  // Valid patterns: masked version, empty string, OR field not returned at all (rely on has* flag)
  const rawAccessMatches = handler.match(/stt\w+Key:\s*creds\.\w+Key\s*\|\|/g) || [];

  if (keyFieldMatches.length > 0 && rawAccessMatches.length > 0) {
    assert.fail(`Found ${rawAccessMatches.length} raw STT key returns in get-stored-credentials. Keys must be masked or omitted.`);
  }
});