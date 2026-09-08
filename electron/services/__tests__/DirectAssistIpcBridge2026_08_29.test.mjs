import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const ipc = read('electron/ipcHandlers.ts');
const preload = read('electron/preload.ts');
const rendererTypes = read('src/types/electron.d.ts');
const settings = read('electron/services/SettingsManager.ts');

const streamStart = ipc.indexOf("safeHandle('direct-assist-stream'");
const cancelStart = ipc.indexOf("'direct-assist-cancel'", streamStart);
const streamBlock = ipc.slice(streamStart, cancelStart);
const normalizeStart = ipc.indexOf('const normalizeDirectAssistRequest =');
const normalizeEnd = ipc.indexOf('const resolveDirectAssistSkill =', normalizeStart);
const normalizeBlock = ipc.slice(normalizeStart, normalizeEnd);

test('Direct Assist persisted setting defaults off and the operator kill switch is authoritative', () => {
  assert.match(settings, /directAssistEnabled\?: boolean/);
  assert.match(settings, /NATIVELY_DIRECT_ASSIST_KILL_SWITCH/);
  assert.match(settings, /isDirectAssistKilledByOperator\(\): boolean/);
  assert.match(
    settings,
    /getDirectAssistEnabled\(\): boolean \{[\s\S]*isDirectAssistKilledByOperator\(\)[\s\S]*directAssistEnabled === true/,
  );

  assert.match(ipc, /safeHandle\('get-direct-assist-enabled'/);
  assert.match(ipc, /safeHandle\('set-direct-assist-enabled'/);
  assert.match(ipc, /typeof enabled !== 'boolean'/);
  assert.match(ipc, /enabled && settings\.isDirectAssistKilledByOperator\(\)/);
  assert.match(ipc, /settings\.set\('directAssistEnabled', enabled\)/);
});

test('preload and renderer declarations expose one correlated Direct Assist bridge', () => {
  for (const source of [preload, rendererTypes]) {
    assert.match(source, /startDirectAssist/);
    assert.match(source, /cancelDirectAssist/);
    assert.match(source, /onDirectAssistEvent/);
    assert.match(source, /getDirectAssistEnabled/);
    assert.match(source, /setDirectAssistEnabled/);
    assert.match(source, /onDirectAssistEnabledChanged/);
    assert.match(source, /type: 'error'[\s\S]{0,140}partial: boolean/);
    // The 'start' event's trimmedFields field has drifted before (fixed
    // 2026-09-01): electron/direct-assist/types.ts, src/types/electron.d.ts
    // and NativelyInterface.tsx's local DirectAssistRendererEvent were kept
    // in sync while preload.ts's own local duplicate was missed — no compile
    // error, since onDirectAssistEvent forwards the raw IPC object untouched.
    assert.match(source, /type: 'start'[\s\S]{0,140}trimmedFields: string\[\]/);
    // provider_switch mirrors electron/direct-assist/types.ts field for field
    // (from/to/reason), so the renderer is told which provider actually
    // answered whenever the ladder fails over mid-request.
    assert.match(
      source,
      /type: 'provider_switch'[\s\S]{0,220}from: \{ provider: string; model: string \}[\s\S]{0,80}to: \{ provider: string; model: string \}[\s\S]{0,80}reason: string/,
    );
  }
  assert.match(preload, /ipcRenderer\.invoke\('direct-assist-stream', request\)/);
  assert.match(preload, /ipcRenderer\.invoke\('direct-assist-cancel', requestId, source\)/);
  assert.match(preload, /ipcRenderer\.on\('direct-assist-event', subscription\)/);
});

test('Direct Assist dispatch snapshots one exact selection and never enters a legacy answer pipeline', () => {
  assert.ok(streamStart >= 0, 'direct-assist-stream handler must be reachable');
  assert.ok(cancelStart > streamStart, 'direct-assist-cancel handler must follow stream handler');
  assert.match(streamBlock, /getDirectAssistSelection\(\)/);
  assert.match(streamBlock, /new DirectAssistService\(llmHelper\)/);
  assert.equal((streamBlock.match(/service\.stream\(/g) ?? []).length, 1);
  assert.doesNotMatch(
    streamBlock,
    /ragQueryLive|generateWhatToSay|generate-what-to-say|gemini-chat-stream|runWhatShouldISay|planAnswer|IntelligenceEngine/,
  );
});

test('renderer request IDs, sender IDs, and sources isolate supersession and cancellation', () => {
  assert.match(ipc, /directAssistSurfaceKey\s*=\s*\(senderId: number, source: DirectAssistSource\)/);
  assert.match(ipc, /directAssistRequestKey\s*=\s*\(senderId: number, requestId: string\)/);
  assert.match(streamBlock, /const prior = activeDirectAssistBySurface\.get\(surfaceKey\)/);
  assert.match(streamBlock, /if \(prior\) prior\.controller\.abort\(\)/);
  assert.match(streamBlock, /activeDirectAssistByRequest\.set\(requestKey, active\)/);
  assert.match(ipc.slice(cancelStart), /activeDirectAssistByRequest\.get\(directAssistRequestKey\(senderId, requestId\)\)/);
  assert.match(ipc.slice(cancelStart), /active\.source !== source/);
  assert.match(ipc.slice(cancelStart), /active\.controller\.abort\(\)/);
});

test('stream relay enforces correlation, monotonic deltas, and one terminal event', () => {
  assert.match(streamBlock, /streamEvent\.requestId !== request\.requestId/);
  assert.match(streamBlock, /streamEvent\.sequence <= lastSequence/);
  assert.match(streamBlock, /if \(terminalSent\) return/);
  assert.match(streamBlock, /terminalSent = true/);
  assert.match(streamBlock, /INCOMPLETE_STREAM/);
  assert.match(streamBlock, /controller\.signal\.aborted/);
});

test('provider_switch is forwarded in order without being swallowed into the terminal fall-through', () => {
  // Before this, any streamEvent.type other than 'start'/'delta' fell through
  // to `lastSequence = Math.max(...)` and then sendTerminal — so a
  // provider_switch (a mid-stream event, not an end-of-stream one) would have
  // been sent as a TERMINAL event and killed the stream the moment a rung
  // failed over. The forward + continue branch must sit strictly between the
  // 'delta' branch and that generic Math.max/terminal fall-through.
  const deltaAt = streamBlock.indexOf("if (streamEvent.type === 'delta') {");
  const switchAt = streamBlock.indexOf("if (streamEvent.type === 'provider_switch') {");
  const fallThroughAt = streamBlock.indexOf('lastSequence = Math.max(lastSequence, streamEvent.sequence);');
  assert.ok(deltaAt >= 0 && switchAt > deltaAt, 'provider_switch branch must follow the delta branch');
  assert.ok(fallThroughAt > switchAt, 'provider_switch branch must precede the terminal fall-through');

  const switchBlock = streamBlock.slice(switchAt, fallThroughAt);
  assert.match(switchBlock, /sendDirectAssistEvent\(event\.sender, streamEvent\)/);
  assert.match(switchBlock, /continue;/);
  // It must never touch lastSequence: a switch's sequence is a snapshot of
  // the delta counter (always 0), not a slot of its own.
  assert.doesNotMatch(switchBlock, /lastSequence\s*=/);
});

test('main resolves and strips enabled skills, including underscore IDs', () => {
  assert.match(ipc, /\[a-z0-9_-\]\{0,127\}/);
  assert.match(ipc, /SkillsManager\.getInstance\(\)\.getSkill\(requestedSkillId\)/);
  assert.match(ipc, /SKILL_NOT_FOUND/);
  assert.match(ipc, /skill\.enabled === false/);
  assert.match(ipc, /SKILL_DISABLED/);
  assert.match(ipc, /currentRequest = prefix \? \(prefix\[2\] \?\? ''\)\.trim\(\) : request\.currentRequest/);
  assert.match(ipc, /instructions: skill\.instructions/);
});

test('an unresolved text-prefix skill guess falls back to plain text instead of rejecting the request', () => {
  // A leading "/" or "$" word that doesn't resolve to a real skill is ordinary
  // text far more often than an intended skill invocation ("$50 is that a
  // fair price...", "/explain this regex") — only an explicit UI skill
  // selection (skillId) should hard-fail with SKILL_NOT_FOUND on a miss.
  const resolveStart = ipc.indexOf('const resolveDirectAssistSkill =');
  const resolveEnd = ipc.indexOf('\n  safeHandle(', resolveStart);
  const resolveBlock = ipc.slice(resolveStart, resolveEnd);
  assert.ok(resolveStart >= 0 && resolveEnd > resolveStart);
  assert.match(
    resolveBlock,
    /if \(!explicitSkillId\) return \{ currentRequest: request\.currentRequest, skill: null \};\s*\n\s*return \{ error: directAssistError\('SKILL_NOT_FOUND'/,
  );
});

test('attachments and captured page data are validated before Direct Assist dispatch', () => {
  assert.match(ipc, /const DIRECT_ASSIST_MAX_IMAGES = 5/);
  assert.match(ipc, /candidate\.imagePaths\.length > DIRECT_ASSIST_MAX_IMAGES/);
  assert.match(ipc, /validateImagePath\(rendererPath, userDataDir\)/);
  assert.match(ipc, /fs\.realpathSync\.native\(userDataDir\)/);
  assert.match(ipc, /fs\.realpathSync\.native\(rendererPath\)/);
  assert.match(ipc, /isDirectAssistCanonicalPathInsideRoot\(canonicalUserDataDir, canonicalPath\)/);
  assert.match(ipc, /stat\.isFile\(\)/);
  assert.match(ipc, /DIRECT_ASSIST_MAX_IMAGE_BYTES/);
  assert.match(ipc, /sniffDirectAssistImage\(canonicalPath\)/);
  assert.match(ipc, /path\.extname\(canonicalPath\)\.toLowerCase\(\)/);
});

test('canonical containment rejects a symlink or junction that escapes userData', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-ipc-link-'));
  const userData = path.join(tempRoot, 'user-data');
  const outside = path.join(tempRoot, 'outside');
  const link = path.join(userData, 'screenshots-link');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'secret.png'), 'not an image');

  try {
    try {
      fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') {
        t.skip(`symlink creation unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    const canonicalRoot = fs.realpathSync.native(userData);
    const canonicalCandidate = fs.realpathSync.native(path.join(link, 'secret.png'));
    const relative = path.relative(canonicalRoot, canonicalCandidate);
    const isInside = relative !== '..'
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative);
    assert.equal(isInside, false, 'a canonical path outside userData must be rejected');

    const helperStart = ipc.indexOf('function isDirectAssistCanonicalPathInsideRoot');
    const helperEnd = ipc.indexOf('\n}', helperStart);
    const helper = ipc.slice(helperStart, helperEnd + 2);
    assert.match(helper, /path\.relative\(root, candidate\)/);
    assert.match(helper, /relative !== '\.\.'/);
    assert.match(helper, /!relative\.startsWith\(`\.\.\$\{path\.sep\}`\)/);
    assert.match(helper, /!path\.isAbsolute\(relative\)/);

    const canonicalizeAt = ipc.indexOf('fs.realpathSync.native(rendererPath)');
    const containmentAt = ipc.indexOf('isDirectAssistCanonicalPathInsideRoot(canonicalUserDataDir, canonicalPath)');
    const sharedValidationAt = ipc.indexOf('validateImagePath(rendererPath, userDataDir)', containmentAt);
    assert.ok(canonicalizeAt >= 0 && canonicalizeAt < containmentAt);
    assert.ok(containmentAt < sharedValidationAt, 'canonical containment must run before trusting the shared validator');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('IPC normalization does not preempt the selected provider privacy boundary', () => {
  assert.ok(normalizeStart >= 0 && normalizeEnd > normalizeStart);
  assert.doesNotMatch(
    normalizeBlock,
    /providerDataScopes|providerScopes|TRANSCRIPT_BLOCKED_BY_PRIVACY|SCREENSHOT_BLOCKED_BY_PRIVACY/,
    'cloud-send privacy scopes must be enforced after the provider is selected',
  );
});

test('validated scoped fields remain intact for local provider selection and backend enforcement', () => {
  assert.match(normalizeBlock, /referenceContext: candidate\.referenceContext as string \| undefined/);
  assert.match(normalizeBlock, /\n\s*pageContext,\n/);
  assert.match(normalizeBlock, /\n\s*history,\n/);
  assert.match(normalizeBlock, /transcript: candidate\.transcript as string \| undefined/);
  assert.match(normalizeBlock, /\n\s*imagePaths,\n/);

  assert.match(streamBlock, /const directRequest: DirectAssistRequestInput = Object\.freeze/);
  assert.match(streamBlock, /pageContext: request\.pageContext/);
  assert.match(streamBlock, /history: request\.history/);
  assert.match(streamBlock, /transcript: request\.transcript/);
  assert.match(streamBlock, /imagePaths: request\.imagePaths/);
});

test('referenceContext and meetingTranscript are always server-populated, ignoring whatever the renderer sent', () => {
  // The renderer never has to (and today never does) supply these — main
  // reads mode_reference_files and the live session directly, the same raw
  // full-text/full-window sources the legacy WTA path already uses, with no
  // chunking, embedding, or ranking involved.
  assert.doesNotMatch(
    streamBlock,
    /referenceFiles: request\.referenceFiles/,
    'reference files must be server-computed, not passed through from the renderer',
  );
  assert.match(streamBlock, /ModesManager\.getInstance\(\)[\s\S]{0,400}\.getReferenceFiles\(/);
  // STRUCTURED, not pre-rendered: the per-file budget share happens downstream
  // against the real prompt limit, so one oversized attachment cannot starve
  // the rest (allocateDirectAssistReferenceFiles).
  assert.match(streamBlock, /\n\s*referenceFiles,\n/);
  assert.doesNotMatch(
    streamBlock,
    /buildDirectAssistReferenceContext\(/,
    'flattening the files here would re-introduce the first-file-wins starvation',
  );
  // main slices each file before handing it over, so it has to carry the size
  // it sliced FROM — otherwise the TRUNCATED notice understates what is missing.
  assert.match(streamBlock, /totalChars: content\.length/);
  assert.match(streamBlock, /getFormattedContext\??\.?\(180\)/);
  assert.match(streamBlock, /\n\s*meetingTranscript,\n/);
});

test('history attachments are validated by the SAME boundary, but a missing one is skipped instead of rejecting the turn', () => {
  // One resolver, so the containment rules can never diverge between the
  // current turn's attachments and the ones carried from earlier turns.
  const resolverStart = ipc.indexOf('const resolveDirectAssistImagePath =');
  assert.ok(resolverStart >= 0, 'the shared attachment resolver must exist');
  const resolverEnd = ipc.indexOf('const normalizeDirectAssistRequest =', resolverStart);
  const resolver = ipc.slice(resolverStart, resolverEnd);
  assert.match(resolver, /fs\.realpathSync\.native\(rendererPath\)/);
  assert.match(resolver, /isDirectAssistCanonicalPathInsideRoot\(canonicalUserDataDir, canonicalPath\)/);
  assert.match(resolver, /validateImagePath\(rendererPath, userDataDir\)/);
  assert.match(resolver, /sniffDirectAssistImage\(canonicalPath\)/);

  // The current turn still fails the whole request on a bad attachment...
  assert.match(
    normalizeBlock,
    /resolveDirectAssistImagePath\(rendererPath, userDataDir, canonicalUserDataDir\)[\s\S]{0,200}?if \(!resolved\.ok\)[\s\S]{0,120}?directAssistError\('INVALID_ATTACHMENT', resolved\.rejection\)/,
  );
  // ...while a carried one is recorded as absent. An evicted screenshot is the
  // EXPECTED case (ScreenshotHelper unlinks past its 5-deep queue), so failing
  // the request would make follow-up questions worse, not safer.
  assert.match(normalizeBlock, /validated\.set\(rendererPath, resolved\.ok \? resolved\.canonicalPath : null\)/);
  assert.match(normalizeBlock, /imageCount: turn\.imagePaths\.length/);

  // Bounded sync IO: main must not walk 64 turns x 5 images of realpath +
  // stat + header read when only DIRECT_ASSIST_MAX_IMAGES can be dispatched.
  assert.match(normalizeBlock, /let validationBudget = Math\.max\(0, DIRECT_ASSIST_MAX_IMAGES - \(/);
  assert.match(normalizeBlock, /for \(let i = rawTurns\.length - 1; i >= 0 && validationBudget > 0; i -= 1\)/);
});

test('carried screenshots travel as their own dispatch field, never merged into the current turn', () => {
  const builder = read('electron/direct-assist/requestBuilder.ts');
  const service = read('electron/direct-assist/DirectAssistService.ts');
  const llm = read('electron/LLMHelper.ts');

  // Separate field end to end: the text that explains each carried image lives
  // in <recent_transcript>, and LLMHelper strips that block when the transcript
  // scope is denied — merging the images in the builder would leave them behind.
  assert.match(builder, /historyImagePaths: Object\.freeze\(\s*selectCarriedHistoryImages\(parts\.history, request\.imagePaths\.length\)\.paths,\s*\)/);
  assert.match(service, /historyImagePaths: prepared\.historyImagePaths/);
  assert.match(llm, /deniedScopes\.includes\('transcript'\) \|\| deniedScopes\.includes\('screenshots'\)[\s\S]{0,120}carriedImagePaths = \[\]/);
});

test('Direct Assist transcribes its own screenshot AFTER the answer, never before it', () => {
  // Direct Assist has no vision pre-pass by design — one dispatch with nothing
  // in front of it. So the transcription runs off the terminal event: the user
  // already has their answer, and this exists purely so a follow-up two turns
  // later has text to read once ScreenshotHelper has unlinked the image.
  // Without it Direct Assist could only carry BYTES, which die with the file.
  const doneAt = streamBlock.indexOf("if (streamEvent.type === 'done')");
  const sendAt = streamBlock.indexOf('sendTerminal(', doneAt);
  const describeAt = streamBlock.indexOf('transcribeScreenForMemory', doneAt);
  assert.ok(doneAt >= 0 && sendAt > doneAt, 'terminal event must be reachable');
  assert.ok(describeAt > sendAt,
    'the transcription must run AFTER sendTerminal, or it delays the answer it exists to outlive');

  // The SHARED helper, not a fourth inline copy — Direct Assist, what-to-answer
  // and the typed path all transcribe the same way or they drift.
  const helper = read('electron/services/screen/screenTranscription.ts');
  // Skipped entirely when these exact bytes are already described. The cache is
  // the point: a re-captured screen costs nothing.
  assert.match(helper, /if \(cached\?\.description\) return cached\.description;/);
  // Reaches the extraction prompt. Every pre-existing call site passed an action
  // that took the "answer concisely" branch instead.
  assert.match(helper, /userAction: 'transcribe'/);
  // ONE policy, never a third policy: a transcription is still a screenshot
  // leaving the device.
  assert.match(helper, /localOnly: settings\.getScreenUnderstandingMode\(\) === 'private_vision'/);
  assert.match(helper, /allowScreenshots: providerScopes\.screenshots !== false/);
});
