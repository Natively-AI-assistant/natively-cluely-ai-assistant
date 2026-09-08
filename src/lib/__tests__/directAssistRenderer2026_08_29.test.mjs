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

test('provider_switch is handled before the terminal-sequence guard and relabels the answer card verbatim', () => {
  // The provider_switch member must exist locally (mirroring
  // electron/direct-assist/types.ts, preload.ts and src/types/electron.d.ts
  // field for field) or the listener switch below is dead code.
  assert.match(
    interfaceSource,
    /type: 'provider_switch';[\s\S]{0,220}from: \{ provider: string; model: string \};[\s\S]{0,80}to: \{ provider: string; model: string \};[\s\S]{0,80}reason: string;/,
  );

  const listener = section(
    'window.electronAPI.onDirectAssistEvent((event: DirectAssistRendererEvent) => {',
    'const beginDirectAssist = useCallback(async ({',
  );
  const deltaStart = listener.indexOf("if (event.type === 'delta') {");
  const switchStart = listener.indexOf("if (event.type === 'provider_switch') {");
  const terminalGuard = listener.indexOf('if (event.sequence < active.lastSequence) return;');
  assert.ok(deltaStart >= 0 && switchStart > deltaStart, 'provider_switch must be handled after delta');
  assert.ok(terminalGuard > switchStart, 'provider_switch must be handled BEFORE the terminal-sequence guard');

  const switchBlock = listener.slice(switchStart, terminalGuard);
  // Not terminal, and its sequence (always 0, pre-commit only) must never
  // reach active.lastSequence — a delta-counter snapshot is not a slot of
  // its own. Reaching the terminal guard below with sequence 0 would read as
  // a stale terminal event against the -1 initial value and settle the
  // whole request as "Request cancelled."
  assert.doesNotMatch(switchBlock, /active\.lastSequence\s*=/);
  // No provider-label mapping table: render the ids verbatim.
  assert.match(switchBlock, /event\.from\.provider/);
  assert.match(switchBlock, /event\.to\.provider/);
  assert.doesNotMatch(switchBlock, /providerLabel\(/);
  // Lands on the answer card (active.placeholderId), not the question card —
  // the label the user is reading must be the provider that actually
  // answered.
  assert.match(switchBlock, /message\.id === placeholderId/);
  assert.match(switchBlock, /fallbackNotice: noticeText/);

  assert.match(interfaceSource, /fallbackNotice\?: string;/);
  assert.match(
    interfaceSource,
    /msg\.role === 'system' && msg\.fallbackNotice[\s\S]{0,320}\{msg\.fallbackNotice\}/,
  );
});

test('the question card distinguishes context that was shortened from context that was dropped', () => {
  // "reference files omitted" and "reference files shortened to fit" mean very
  // different things to someone judging whether an answer used their document.
  assert.match(interfaceSource, /shortenedFields\?: string\[\]/);
  assert.match(
    interfaceSource,
    /type: 'start';[^}]*trimmedFields: string\[\]; shortenedFields\?: string\[\]/,
  );
  const notice = section("{t('Context trimmed')}", '</div>');
  assert.match(notice, /msg\.shortenedFields/);
  assert.match(notice, /shortened to fit/);
  assert.match(notice, /omitted \(over context limit\)/);
  assert.match(
    interfaceSource,
    /event\.trimmedFields\?\.length \|\| event\.shortenedFields\?\.length/,
    'a start event carrying only shortenedFields must still stamp the card',
  );
});

test('the history write records the screenshots the turn was sent with, after the tray is cleared', () => {
  // beginDirectAssist snapshots the paths onto the in-flight request because
  // every submit handler calls setAttachedContext([]) immediately after
  // dispatch — by the time the done branch runs, component state has none.
  assert.match(interfaceSource, /interface ActiveDirectAssistRequest \{[\s\S]{0,400}?imagePaths: string\[\];/);
  assert.match(interfaceSource, /imagePaths: imagePaths \? \[\.\.\.imagePaths\] : \[\],/);
  assert.match(interfaceSource, /interface DirectAssistHistoryTurn \{[\s\S]{0,500}?imagePaths\?: string\[\];/);

  const doneBranch = section("const completedTurns: DirectAssistHistoryTurn[]", 'directAssistHistoryRef.current = completedTurns');
  assert.match(doneBranch, /role: 'user',\s*content: active\.currentRequest,\s*\.\.\.\(active\.imagePaths\.length \? \{ imagePaths: active\.imagePaths \} : \{\}\)/);

  // Still the only history write, and still only on a successful terminal.
  assert.equal((interfaceSource.match(/directAssistHistoryRef\.current = completedTurns/g) ?? []).length, 1);
});

test('every Direct surface hands beginDirectAssist its attachments, or that surface loses screenshots', () => {
  // The history write can only record what the caller passed. A surface that
  // omits imagePaths still dispatches the screenshot on ITS turn and looks
  // fine, then silently cannot answer about it two turns later — the exact
  // failure this contract exists to prevent, and one no builder-level test
  // can see. Typed submit, What-to-Say, and the STT/screenshot path.
  const callSites = interfaceSource.match(/await beginDirectAssist\(\{[\s\S]*?\n\s*\}\);/g) ?? [];
  assert.equal(callSites.length, 3, 'a new Direct surface must be added to this check');
  for (const callSite of callSites) {
    assert.match(
      callSite,
      /imagePaths: currentAttachments\.map\(\(attachment\) => attachment\.path\)/,
      `a beginDirectAssist call site does not forward its attachments:\n${callSite}`,
    );
  }
});
