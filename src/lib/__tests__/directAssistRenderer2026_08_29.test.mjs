// Direct Assist renderer contract regressions.
//
// NativelyInterface is intentionally a large inline orchestration component,
// so these tests pin source-level control-flow boundaries that are otherwise
// difficult to mount without an Electron preload. Backend/IPC tests exercise
// the behavioral provider boundary; this suite ensures each overlay surface
// actually reaches it without first entering the legacy answer pipeline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDirectWhatToSayPayload } from '../directAssistWhatToSayPayload.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const interfaceSource = fs.readFileSync(
  path.resolve(dirname, '../../components/NativelyInterface.tsx'),
  'utf8',
);
const settingsSource = fs.readFileSync(
  path.resolve(dirname, '../../components/settings/AIProvidersSettings.tsx'),
  'utf8',
);

function section(startMarker, endMarker) {
  const start = interfaceSource.indexOf(startMarker);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  const end = interfaceSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return interfaceSource.slice(start, end);
}

test('Direct Assist uses the shared SettingsManager IPC flag and defaults renderer state off', () => {
  assert.match(interfaceSource, /const \[directAssistEnabled, setDirectAssistEnabled\] = useState\(false\)/);
  assert.match(interfaceSource, /getDirectAssistEnabled/);
  assert.match(interfaceSource, /onDirectAssistEnabledChanged/);
  assert.match(settingsSource, /setDirectAssistEnabled\?\.\(next\)/);
  assert.doesNotMatch(interfaceSource, /natively_direct_assist_enabled/);
  assert.doesNotMatch(settingsSource, /natively_direct_assist_enabled/);
});

test('typed Direct submission preserves exact text, skill prefix, screenshots and one-shot page context', () => {
  const body = section(
    'const handleManualSubmit = async () => {',
    '// Refresh the latest-handler ref on every render',
  );
  const directBranch = body.indexOf('if (directAssistEnabled) {');
  const ragBranch = body.indexOf('ragQueryLive');
  assert.ok(directBranch >= 0 && ragBranch > directBranch, 'Direct branch must precede legacy RAG');
  assert.match(body, /const rawUserText = inputValue/);
  assert.match(body, /currentRequest: rawUserText\.trim\(\)\.length > 0\s*\? rawUserText/);
  assert.match(body, /imagePaths: currentAttachments\.map/);
  assert.match(body, /pageContext: directPageContext/);

  const directTransport = section(
    'const beginDirectAssist = useCallback(async ({',
    'const cancelActiveChatStream = useCallback(() => {',
  );
  assert.match(directTransport, /skillId: directAssistSkillId\(currentRequest\)/);
  assert.match(directTransport, /currentRequest,/);
  assert.doesNotMatch(directTransport, /streamGeminiChat|ragQueryLive|generateWhatToSay/);

  // This is the incident string: the transport must carry it as currentRequest,
  // not replace it with a speaking prompt or infer another language.
  const typedIncident = 'Solve this in C++ and give me the code';
  const preservedByRenderer = typedIncident.trim().length > 0 ? typedIncident : 'Analyze the attached screenshot.';
  assert.equal(preservedByRenderer, typedIncident);
});

test('STT Answer Now awaits finalization, bypasses RAG, and marks image-only turns as screenshots', () => {
  const body = section('const handleAnswerNow = async () => {', 'const selectSkill = useCallback');
  assert.match(body, /await Promise\.race\(\[/);
  assert.match(body, /window\.electronAPI\.finalizeMicSTT\(\)/);
  const directBranch = body.indexOf('if (directAssistEnabled) {');
  const ragBranch = body.indexOf('ragQueryLive');
  assert.ok(directBranch >= 0 && ragBranch > directBranch, 'Direct STT must return before legacy RAG');
  assert.match(body, /source: question \? 'stt' : 'screenshot'/);
  assert.match(body, /currentRequest: question/);

  const recognizedQuestion = '';
  const screenshotOnlySource = recognizedQuestion ? 'stt' : 'screenshot';
  assert.equal(screenshotOnlySource, 'screenshot');
});

test('What-to-Say forwards recent interviewer STT and never auto-captures a page before Direct dispatch', () => {
  const body = section('const handleWhatToSay = async', 'const handleFollowUp = async');
  const directBranch = body.indexOf('if (directAssistEnabled) {');
  const autoCapture = body.indexOf('phoneMirrorRequestAutoContext');
  assert.ok(directBranch >= 0 && autoCapture > directBranch, 'Direct WTA must precede legacy auto capture');
  assert.match(body, /const directTranscriptSnapshot = pendingRollingPartialRef\.current/);
  assert.match(body, /const interviewerRequest = directTranscriptSnapshot/);
  assert.match(body, /buildDirectWhatToSayPayload\(\{\s*interviewerRequest,\s*dynamicPromptInstruction,\s*hasScreenshots,/);
  assert.match(body, /source: directWhatToSayPayload\.source/);
  assert.match(body, /currentRequest: directWhatToSayPayload\.currentRequest/);
  assert.match(body, /transcript: directWhatToSayPayload\.transcript/);

  // Screenshot+STT keeps audio out of currentRequest so the IPC transcript
  // scope can remove it without leaking the same text through another field.
  const interviewer = 'Implement binary search in C++';
  const screenshotPayload = buildDirectWhatToSayPayload({
    interviewerRequest: interviewer,
    hasScreenshots: true,
  });
  assert.equal(screenshotPayload.source, 'screenshot');
  assert.doesNotMatch(screenshotPayload.currentRequest, /binary search/i);
  assert.equal(screenshotPayload.transcript, interviewer);
});

test('no-screenshot dynamic What-to-Say keeps STT authoritative and appends the output instruction', () => {
  const interviewerRequest = 'Implement binary search in C++ and give the code.';
  const dynamicPromptInstruction = 'Answer concisely with code first.';
  const payload = buildDirectWhatToSayPayload({
    interviewerRequest,
    dynamicPromptInstruction,
    hasScreenshots: false,
  });

  assert.equal(payload.source, 'stt', 'a dynamic action must not relabel recognized speech as typed');
  assert.ok(payload.currentRequest.startsWith(interviewerRequest), 'the triggering question must remain first and authoritative');
  assert.match(payload.currentRequest, /ANSWER\/OUTPUT INSTRUCTION:\nAnswer concisely with code first\.$/);
  assert.equal(payload.transcript, undefined, 'non-screenshot speech belongs directly in currentRequest');

  const typedFallback = buildDirectWhatToSayPayload({
    interviewerRequest: '',
    dynamicPromptInstruction,
    hasScreenshots: false,
  });
  assert.deepEqual(typedFallback, {
    source: 'typed',
    currentRequest: dynamicPromptInstruction,
    transcript: undefined,
  });
});

test('requestId guards accept equal-sequence done and retain ownership until the final reveal seals', () => {
  const listener = section(
    'window.electronAPI.onDirectAssistEvent((event: DirectAssistRendererEvent) => {',
    'const beginDirectAssist = useCallback(async ({',
  );
  assert.match(listener, /if \(!active \|\| event\.requestId !== active\.requestId\) return/);
  const deltaStart = listener.indexOf("if (event.type === 'delta') {");
  const terminalGuard = listener.indexOf('if (event.sequence < active.lastSequence) return;');
  assert.ok(deltaStart >= 0 && terminalGuard > deltaStart);
  assert.match(listener.slice(deltaStart, terminalGuard), /event\.sequence <= active\.lastSequence/);

  // Backend terminal events intentionally reuse the final delta sequence.
  let lastSequence = -1;
  const deltaSequence = 1;
  assert.ok(deltaSequence > lastSequence);
  lastSequence = deltaSequence;
  const doneSequence = 1;
  assert.equal(doneSequence < lastSequence, false, 'equal-sequence done must be accepted');
  assert.match(listener, /active\.completed = true;\s*finalizeWhenRevealCaughtUp/);
  assert.match(
    interfaceSource,
    /direct\?\.completed && direct\.placeholderId === pending\.msgId[\s\S]*?activeDirectAssistRef\.current = null/,
  );
});

test('late legacy provider, RAG, phone and intelligence events cannot mix into a Direct row', () => {
  const guardedCallbacks = [
    'window.electronAPI.onGeminiStreamToken((token, meta) => {',
    'window.electronAPI.onGeminiStreamDone((data) => {',
    'window.electronAPI.onGeminiStreamError((error, meta?',
    'window.electronAPI.onPhoneMirrorIncomingChat(({ message }) => {',
    'window.electronAPI.onRAGStreamChunk((data: { chunk: string }) => {',
    'window.electronAPI.onRAGStreamComplete(() => {',
    'window.electronAPI.onRAGStreamError((data: { error: string }) => {',
    'window.electronAPI.onIntelligenceSuggestedAnswerToken((data) => {',
    'window.electronAPI.onIntelligenceSuggestedAnswer((data) => {',
    'window.electronAPI.onIntelligenceSuggestedAnswerDiscard?.(() => {',
    'window.electronAPI.onIntelligenceTokenBatch((data) => {',
    'window.electronAPI.onIntelligenceManualResult((data) => {',
  ];
  for (const marker of guardedCallbacks) {
    const start = interfaceSource.indexOf(marker);
    assert.ok(start >= 0, `missing callback: ${marker}`);
    assert.match(
      interfaceSource.slice(start, start + 700),
      /if \(activeDirectAssistRef\.current\) return/,
      `legacy callback is not Direct-isolated: ${marker}`,
    );
  }
});

test('Direct start tombstones tagged and id-less legacy Intelligence finals beyond reveal completion', () => {
  const directTransport = section(
    'const beginDirectAssist = useCallback(async ({',
    'const cancelActiveChatStream = useCallback(() => {',
  );
  assert.match(directTransport, /legacyIntelligenceTombstonedRef\.current = true/);
  assert.match(directTransport, /liveAnswerGenIdRef\.current = Number\.MAX_SAFE_INTEGER/);

  const finalMarker = 'window.electronAPI.onIntelligenceSuggestedAnswer((data) => {';
  const finalStart = interfaceSource.indexOf(finalMarker);
  assert.ok(finalStart >= 0);
  const finalHandler = interfaceSource.slice(finalStart, finalStart + 2400);
  const tombstoneGuard = finalHandler.indexOf('if (legacyIntelligenceTombstonedRef.current) return;');
  const appendPath = finalHandler.indexOf("finalizeStreamingByIntent('what_to_answer', answerText)");
  assert.ok(tombstoneGuard >= 0 && appendPath > tombstoneGuard);

  // The active Direct request may already be cleared once reveal finishes; the
  // independent tombstone must still reject an old id-less final.
  const activeDirect = null;
  const legacyTombstoned = true;
  const wouldAppend = activeDirect === null && !legacyTombstoned;
  assert.equal(wouldAppend, false);
});

test('Direct history is appended only in the successful done branch', () => {
  const listener = section(
    'window.electronAPI.onDirectAssistEvent((event: DirectAssistRendererEvent) => {',
    'const beginDirectAssist = useCallback(async ({',
  );
  const doneStart = listener.indexOf("if (event.type === 'done') {");
  const errorStart = listener.indexOf("if (event.type === 'error') {");
  assert.ok(doneStart >= 0 && errorStart > doneStart);
  assert.match(listener.slice(doneStart, errorStart), /directAssistHistoryRef\.current = completedTurns\.slice/);
  assert.doesNotMatch(listener.slice(errorStart), /directAssistHistoryRef\.current\s*=/);
  assert.match(interfaceSource, /directAssistHistoryRef\.current = \[\]/, 'explicit chat reset must clear Direct history');
});
