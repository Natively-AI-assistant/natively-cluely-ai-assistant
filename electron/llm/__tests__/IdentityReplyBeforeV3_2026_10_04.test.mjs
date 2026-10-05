// "what model are you ?" typed during a meeting (2026-10-04) reached the model:
// the canned identity reply sat after the V3 answer block's return, so with V3
// on it never ran. The reply came back as the hidden-configuration refusal.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const { resolveUnambiguousAssistantProbe, resolveIdentityProbe } = await import(pathToFileURL(
  path.resolve(root, 'dist-electron/electron/llm/manualIdentityRouting.js')).href);

describe('probes that are about the assistant whatever is loaded', () => {
  test('the exact string stored for that session', () => {
    assert.equal(resolveUnambiguousAssistantProbe('what model are you ?'), "I'm Natively, an AI assistant.");
  });

  for (const q of ['what model are you?', 'are you ChatGPT?', 'which AI are you', 'what is natively?', 'are you an ai']) {
    test(`"${q}" gets the assistant line`, () => {
      assert.equal(resolveUnambiguousAssistantProbe(q), "I'm Natively, an AI assistant.");
    });
  }

  test('creator questions get the creator line', () => {
    assert.equal(resolveUnambiguousAssistantProbe('who made you?'), 'I was developed by Evin John.');
  });
});

describe('questions that may be about the user are left to the answer path', () => {
  for (const q of ['who are you?', 'introduce yourself', "what's your name?", 'tell me who you are']) {
    test(`"${q}" is not short-circuited`, () => {
      assert.equal(resolveUnambiguousAssistantProbe(q), null);
      // …and the legacy decision for them is unchanged.
      assert.equal(resolveIdentityProbe(q, true).kind, 'candidate_fast_path');
      assert.equal(resolveIdentityProbe(q, false).kind, 'assistant_reply');
    });
  }

  for (const q of ['what model should I use for this dataset?', 'Name.', 'hi', '']) {
    test(`"${q}" is not an identity probe`, () => {
      assert.equal(resolveUnambiguousAssistantProbe(q), null);
    });
  }
});

describe('wiring', () => {
  const src = fs.readFileSync(path.resolve(root, 'electron/ipcHandlers.ts'), 'utf8');
  test('the short-circuit sits inside the V3 branch, before the V3 prompt is built', () => {
    const v3Branch = src.indexOf('if (!callerOwnsPrompt && isContextIntelligenceV3Enabled()) {');
    const probe = src.indexOf('resolveUnambiguousAssistantProbe(message)');
    const build = src.indexOf("const { buildV3Prompt } = require('./context-intelligence/orchestration/engine-bridge');");
    assert.ok(v3Branch > 0 && probe > v3Branch && build > probe, 'probe must run after the V3 gate and before buildV3Prompt');
  });

  test('the reply is sent, recorded and logged without a model call', () => {
    const at = src.indexOf('function replyWithAssistantIdentity(');
    assert.ok(at > src.indexOf("safeHandle('gemini-chat-stream', _geminiChatStreamHandler);"), 'defined after the handler, so the handler\'s own stream events stay the first in the file');
    const body = src.slice(at, at + 2600);
    assert.match(body, /event\.sender\.send\('gemini-stream-token', reply, \{ streamId \}\)/);
    assert.match(body, /event\.sender\.send\('gemini-stream-done', \{ finalText: reply, streamId \}\)/);
    assert.match(body, /addAssistantMessage\?\.\(reply, undefined, 'manual_chat'\)/);
    assert.match(body, /recordAnswerSummary\(v3ConversationSessionId\(appState, senderId\), reply, undefined, message\)/);
    assert.ok(!/streamChat|buildV3Prompt/.test(body), 'no model call');
  });

  test('a skill turn or an attached screen is never hijacked', () => {
    const at = src.indexOf('resolveUnambiguousAssistantProbe(message)');
    const guard = src.lastIndexOf("if (!skillPromptBlock && !imagePaths?.length && typeof message === 'string') {", at);
    assert.ok(guard > 0 && at - guard < 400, 'the same guard as the legacy probe must wrap the pre-V3 probe');
  });
});
