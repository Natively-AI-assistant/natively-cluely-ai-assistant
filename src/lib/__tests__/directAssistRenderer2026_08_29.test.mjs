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

// Strip `//` line comments so wording assertions ("must never claim X") test
// what the code actually DOES, not what an adjacent comment happens to say
// while explaining it.
function stripLineComments(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
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
  const legacyTransport = body.indexOf('streamGeminiChat(');
  assert.ok(directBranch >= 0 && legacyTransport > directBranch, 'Direct branch must precede the legacy chat transport');
  assert.doesNotMatch(body, /ragQueryLive/, 'typed chat has no RAG pre-flight (issue #552) — V3 carries meeting evidence');
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

test('provider_switch is handled before the terminal-sequence guard and words the notice as an attempt, never an outcome', () => {
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
  // Lands on the answer card (active.placeholderId), not the question card.
  assert.match(switchBlock, /message\.id === placeholderId/);
  assert.match(switchBlock, /fallbackNotice: noticeText/);

  // CASE 1 (finding, worse-than-reported half): provider_switch fires when a
  // rung is OPENED, not when it answers — so at this point the target
  // provider has produced zero tokens. The notice text built here must read
  // as an attempt in flight, never assert that anyone answered. This is the
  // regression guard for "answered by" being asserted a rung too early.
  assert.match(switchBlock, /const noticeText = `\$\{event\.from\.provider\}[^`]*\$\{event\.to\.provider\}[^`]*`;/);
  assert.doesNotMatch(
    stripLineComments(switchBlock),
    /answered/i,
    'provider_switch must never claim an outcome — only done may',
  );

  // CASE 2 (A -> B -> C multi-switch): main queues switches and drains them
  // back to back before the first delta, so the renderer can process
  // switch(A->B) then switch(B->C) with B never having answered. Because
  // this handler is the ONLY place fallbackNotice is set before 'done', and
  // it is proven above to never contain "answered", no number of queued
  // switches processed back to back can ever leave an intermediate provider
  // credited with an answer it didn't give.
  assert.match(switchBlock, /active\.hasSwitched = true;/);

  assert.match(interfaceSource, /fallbackNotice\?: string;/);
  assert.match(
    interfaceSource,
    /msg\.role === 'system' && msg\.fallbackNotice[\s\S]{0,320}\{msg\.fallbackNotice\}/,
  );
});

test('start captures the ORIGINAL provider selection before any switch can overwrite it', () => {
  const startBlock = section(
    "if (event.type === 'start') {",
    "if (event.type === 'delta') {",
  );
  assert.match(startBlock, /active\.originalProvider = event\.provider;/);

  // ActiveDirectAssistRequest must carry originalProvider/hasSwitched so the
  // final notice can be built without restructuring the reducer.
  assert.match(
    interfaceSource,
    /interface ActiveDirectAssistRequest \{[\s\S]{0,900}?originalProvider\?: string;[\s\S]{0,200}?hasSwitched\?: boolean;/,
  );

  // 'start' is the ONLY writer of active.originalProvider in the whole file.
  // On an A -> B -> C walk this is what guarantees the final notice still
  // names A (the user's real choice) rather than whichever rung a later
  // switch opened.
  const originalProviderWrites = (interfaceSource.match(/active\.originalProvider\s*=\s*event\.provider/g) || []).length;
  assert.equal(originalProviderWrites, 1, 'active.originalProvider must be written exactly once, from start');
});

test("done upgrades the notice to an outcome ONLY when a switch occurred, naming the original selection and the actual answerer", () => {
  const doneBlock = section(
    "if (event.type === 'done') {",
    "if (event.type === 'error') {",
  );

  const noAnswerReturn = doneBlock.indexOf('return;');
  const upgradeGuard = doneBlock.indexOf('if (active.hasSwitched && active.originalProvider)');
  assert.ok(noAnswerReturn >= 0 && upgradeGuard > noAnswerReturn,
    'the empty-answer early return must precede the upgrade so a failed/empty done cannot upgrade the notice');

  // CASE 1 & CASE 2's resolving half: the upgrade is gated on hasSwitched —
  // a request that never switched must never grow a fallbackNotice out of
  // thin air at done.
  const upgradeBlock = doneBlock.slice(upgradeGuard, doneBlock.indexOf('// The ONLY Direct history write'));
  assert.match(upgradeBlock, /finalNoticeText = `\$\{active\.originalProvider\}[^`]*answered by \$\{event\.provider\}[^`]*`;/);
  // Must name the ORIGINAL selection (active.originalProvider, unaffected by
  // intermediate switches) and the ACTUAL answerer (done's own event.provider,
  // not a switch's event.to.provider snapshot).
  assert.doesNotMatch(upgradeBlock, /event\.to\.provider/);
  assert.match(upgradeBlock, /message\.id === finalPlaceholderId/);

  // "answered by" may appear literally nowhere else in the listener — it is
  // the one and only place a Direct Assist notice is permitted to claim an
  // outcome.
  const listener = section(
    'window.electronAPI.onDirectAssistEvent((event: DirectAssistRendererEvent) => {',
    'const beginDirectAssist = useCallback(async ({',
  );
  const answeredByLiterals = (listener.match(/`\$\{[^`]*answered by[^`]*`/g) || []).length;
  assert.equal(answeredByLiterals, 1, 'exactly one template literal in the listener may assert "answered by"');
});

test('CASE 3 — a ladder that switches then fails entirely never leaves an "answered by" notice', () => {
  const doneBlock = section(
    "if (event.type === 'done') {",
    "if (event.type === 'error') {",
  );
  // Empty/failed done: settleDirectAssistIncomplete runs and returns BEFORE
  // the hasSwitched upgrade is reachable (proven by the ordering assertion
  // above), so the message keeps whatever attempt-worded fallbackNotice a
  // prior provider_switch left — never an "answered by" — and settle itself
  // does not fabricate one.
  const emptyAnswerBranch = doneBlock.slice(0, doneBlock.indexOf('// Content actually arrived'));
  assert.match(emptyAnswerBranch, /if \(!answer\) \{/);
  assert.doesNotMatch(stripLineComments(emptyAnswerBranch), /fallbackNotice/);

  const errorBlock = section(
    "if (event.type === 'error') {",
    'activeDirectAssistRef.current = null;\n      settleDirectAssistIncomplete(active, \'Request cancelled.\');',
  );
  // The error path (ladder exhausted, or any unrecognized/terminal fallthrough)
  // must not touch fallbackNotice at all — it only ever settles the answer
  // text/streaming state, leaving the last attempt-worded notice in place.
  assert.doesNotMatch(stripLineComments(errorBlock), /fallbackNotice/);

  const settleFn = section(
    'const settleDirectAssistIncomplete = useCallback((',
    "window.electronAPI.onDirectAssistEvent((event: DirectAssistRendererEvent) => {",
  );
  assert.doesNotMatch(stripLineComments(settleFn), /fallbackNotice/, 'settleDirectAssistIncomplete must never write fallbackNotice');
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
