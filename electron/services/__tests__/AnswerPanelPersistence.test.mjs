import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitStreamingFlush } from '../../../src/lib/streamingTokenQueue.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativelyInterfacePath = path.resolve(
  __dirname,
  '../../../src/components/NativelyInterface.tsx',
);
const source = readFileSync(nativelyInterfacePath, 'utf8');

test('native audio transcript handler does not reset answer messages', () => {
  const handlerStart = source.indexOf('onNativeAudioTranscript((transcript)');
  assert.ok(handlerStart >= 0, 'onNativeAudioTranscript handler should exist');

  const handlerEnd = source.indexOf('onSuggestionProcessingStart', handlerStart);
  assert.ok(handlerEnd > handlerStart, 'handler block should be bounded');

  const handlerBlock = source.slice(handlerStart, handlerEnd);
  assert.doesNotMatch(handlerBlock, /setMessages\s*\(\s*\[\s*\]\s*\)/);
  assert.doesNotMatch(handlerBlock, /setMessages\s*\(\s*\(\)\s*=>\s*\[\s*\]\s*\)/);
});

test('intelligence listeners are not tied to isExpanded', () => {
  assert.match(source, /deps must NOT include isExpanded/);
  assert.doesNotMatch(
    source,
    /\},\s*\[isExpanded\]\s*\);\s*\n\s*\/\/ Stable mount-only effect for screenshot listeners/,
  );
  assert.match(source, /answerPanelPinned/);
  assert.match(source, /applyRollingPartialPreview/);
});

test('answer panel stays visible while pinned; rolling transcript uses persistence helpers', () => {
  assert.match(source, /const showAnswerPanel\s*=/);
  assert.match(source, /shouldSuppressRollingTranscript/);
  assert.match(source, /shouldShowRollingTranscriptBar/);
  assert.match(source, /const showRollingTranscriptBar\s*=/);
  assert.match(source, /hasActiveSystemAnswer/);
  assert.match(source, /answerPanelPinned/);
  assert.match(source, /\{showAnswerPanel &&/);
  assert.match(source, /\{showRollingTranscriptBar \?/);
});

test('code visibility check does not collapse shell while answer panel pinned', () => {
  const checkStart = source.indexOf('const checkCodeVisibility = useCallback');
  assert.ok(checkStart >= 0, 'checkCodeVisibility should exist');
  const checkEnd = source.indexOf('// Re-check after every messages update', checkStart);
  assert.ok(checkEnd > checkStart, 'checkCodeVisibility block should be bounded');
  const block = source.slice(checkStart, checkEnd);
  assert.match(block, /if \(!container\)/);
  assert.match(block, /answerPanelPinnedRef\.current/);
});

test('streaming handoff keeps text visible after flushToken', () => {
  const renderStart = source.indexOf('const renderMessageText = useCallback');
  assert.ok(renderStart >= 0, 'renderMessageText should exist');
  const renderEnd = source.indexOf('// We use a ref to hold the latest handlers', renderStart);
  assert.ok(renderEnd > renderStart, 'renderMessageText block should be bounded');
  const block = source.slice(renderStart, renderEnd);
  assert.match(block, /Handoff gap after flushToken/);
  assert.match(block, /msg\.text/);
});

test('queueToken pins answer panel for answer intents on first token', () => {
  assert.match(source, /ANSWER_PANEL_INTENTS/);
  assert.match(source, /ANSWER_PANEL_INTENTS\.has\(intent\)/);
  assert.match(source, /pinAnswerPanelRef\.current\(\)/);
});

test('queueToken only flushes prior stream when intent changes', () => {
  assert.match(source, /shouldFlushPreviousStream/);
  assert.match(source, /streamingIntentRef/);
  const queueStart = source.indexOf('const queueToken = useCallback');
  assert.ok(queueStart >= 0, 'queueToken should exist');
  const queueEnd = source.indexOf('const registerStreamingNode = useCallback', queueStart);
  assert.ok(queueEnd > queueStart, 'queueToken block should be bounded');
  const block = source.slice(queueStart, queueEnd);
  assert.doesNotMatch(
    block,
    /if\s*\(\s*streamingMsgIdRef\.current\s*!==\s*null\s*&&\s*streamingTextRef\.current\s*\)/,
    'must not flush on every token of the same stream',
  );
});

test('clarify flow does not clear messages in source', () => {
  assert.match(source, /finalizeStreamingByIntentMessages/);
  assert.match(source, /prepareIntelligenceStreamPlaceholderMessages/);
  const clarifyHandler = source.indexOf("onIntelligenceClarify((data)");
  assert.ok(clarifyHandler >= 0, 'onIntelligenceClarify handler should exist');
  const clarifyBlockEnd = source.indexOf('onIntelligenceManualResult', clarifyHandler);
  assert.ok(clarifyBlockEnd > clarifyHandler);
  const clarifyBlock = source.slice(clarifyHandler, clarifyBlockEnd);
  assert.doesNotMatch(clarifyBlock, /setMessages\s*\(\s*\[\s*\]\s*\)/);
  assert.match(clarifyBlock, /finalizeStreamingByIntent\('clarify'/);
});

test('prepareIntelligenceStreamPlaceholder uses single append-only setMessages', () => {
  const start = source.indexOf('const prepareIntelligenceStreamPlaceholder = useCallback');
  assert.ok(start >= 0);
  const end = source.indexOf('const displayMessages = useMemo', start);
  assert.ok(end > start);
  const block = source.slice(start, end);
  assert.match(block, /prepareIntelligenceStreamPlaceholderMessages/);
  assert.doesNotMatch(block, /setMessages\s*\(\s*\[\s*\]\s*\)/);
});

test('commitStreamingFlush finalizes streaming rows with isStreaming false (RC-C)', () => {
  const rows = [
    { id: 'ph-1', role: 'system', text: '', intent: 'what_to_answer', isStreaming: true },
  ];
  const next = commitStreamingFlush(rows, 'ph-1', 'Buffered answer text');
  assert.equal(next.length, 1);
  assert.equal(next[0].text, 'Buffered answer text');
  assert.equal(next[0].isStreaming, false);
});

test('handleWhatToSay prepares what_to_answer placeholder before generateWhatToSay (Fix 1)', () => {
  const start = source.indexOf('const handleWhatToSay = async');
  assert.ok(start >= 0, 'handleWhatToSay should exist');
  const end = source.indexOf('const handleClarify', start);
  assert.ok(end > start, 'handleWhatToSay block should be bounded');
  const block = source.slice(start, end);
  const placeholderIdx = block.indexOf("prepareIntelligenceStreamPlaceholder('what_to_answer')");
  const invokeIdx = block.indexOf('generateWhatToSay');
  assert.ok(placeholderIdx >= 0, 'must pre-wire what_to_answer placeholder');
  assert.ok(invokeIdx >= 0, 'must invoke generateWhatToSay');
  assert.ok(
    placeholderIdx < invokeIdx,
    'placeholder must be prepared before generateWhatToSay IPC',
  );
});
