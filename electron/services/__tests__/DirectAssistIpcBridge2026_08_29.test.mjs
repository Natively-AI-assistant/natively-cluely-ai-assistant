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
    /referenceContext: request\.referenceContext/,
    'referenceContext must be server-computed, not passed through from the renderer',
  );
  assert.match(streamBlock, /ModesManager\.getInstance\(\)[\s\S]{0,20}\.getReferenceFiles\(/);
  assert.match(streamBlock, /\n\s*referenceContext,\n/);
  assert.match(streamBlock, /getFormattedContext\??\.?\(180\)/);
  assert.match(streamBlock, /\n\s*meetingTranscript,\n/);
});
