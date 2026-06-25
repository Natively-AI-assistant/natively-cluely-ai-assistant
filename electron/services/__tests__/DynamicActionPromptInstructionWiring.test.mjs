import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSafeHandle, sliceSafeHandleBlock } from './ipcTestUtils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('dynamic action accept uses promptInstruction instead of display label/manual submit', () => {
  const source = read('src/components/NativelyInterface.tsx');
  const mountStart = source.indexOf('<DynamicActionBar');
  assert.ok(mountStart >= 0, 'DynamicActionBar should be mounted');
  const mountSource = source.slice(mountStart, source.indexOf('/>', mountStart) + 2);

  assert.match(mountSource, /handleDynamicActionAccept\(action\)/);
  assert.match(source, /await handleWhatToSay\(action\.promptInstruction\)/);
  assert.doesNotMatch(mountSource, /setInputValue\(action\.label\)/);
  assert.doesNotMatch(mountSource, /handleManualSubmitRef\.current/);
});

test('screen-backed dynamic action captures and stages a screenshot before asking', () => {
  const source = read('src/components/NativelyInterface.tsx');
  const handlerStart = source.indexOf('const handleDynamicActionAccept');
  assert.ok(handlerStart >= 0, 'handleDynamicActionAccept should exist');
  const handlerSource = source.slice(handlerStart, source.indexOf('const handleFollowUp', handlerStart));

  assert.match(source, /const dynamicActionAcceptInFlightRef = useRef\(false\)/);
  assert.match(handlerSource, /if \(dynamicActionAcceptInFlightRef\.current\) return/);
  assert.match(handlerSource, /dynamicActionAcceptInFlightRef\.current = true/);
  assert.match(handlerSource, /dynamicActionAcceptInFlightRef\.current = false/);
  assert.match(handlerSource, /actionNeedsScreenCapture\(action\)/);
  assert.match(handlerSource, /captureScreenshotForDynamicAction\(\)/);
  assert.match(handlerSource, /await handleWhatToSay\(action\.promptInstruction\)/);

  const captureStart = source.indexOf('const captureScreenshotForDynamicAction');
  assert.ok(captureStart >= 0, 'captureScreenshotForDynamicAction should exist');
  const captureSource = source.slice(captureStart, handlerStart);
  assert.match(captureSource, /window\.electronAPI\.takeScreenshot\(\)/);
  assert.match(captureSource, /handleScreenshotAttach\(data as \{ path: string; preview: string \}\)/);
});

test('screenshot attach stages pending ref so immediate What To Say forwards image paths', () => {
  const source = read('src/components/NativelyInterface.tsx');
  const attachStart = source.indexOf('const handleScreenshotAttach');
  assert.ok(attachStart >= 0, 'handleScreenshotAttach should exist');
  const attachSource = source.slice(attachStart, source.indexOf('// STT Status listener', attachStart));
  assert.match(attachSource, /pendingCaptureRef\.current = data/);
  assert.match(attachSource, /appendScreenshotAttachment\(prev, data\)/);

  const wtaStart = source.indexOf('const handleWhatToSay');
  assert.ok(wtaStart >= 0, 'handleWhatToSay should exist');
  const wtaSource = source.slice(wtaStart, source.indexOf('const captureScreenshotForDynamicAction', wtaStart));
  assert.match(wtaSource, /const pending = pendingCaptureRef\.current/);
  assert.match(wtaSource, /mergePendingScreenshotAttachment\(attachedContext, pending\)/);
  assert.match(wtaSource, /if \(pending\) pendingCaptureRef\.current = null/);
  assert.match(wtaSource, /currentAttachments\.map\(\(s\) => s\.path\)/);

  const captureShortcutStart = source.indexOf('window.electronAPI.onCaptureAndProcess');
  assert.ok(captureShortcutStart >= 0, 'Capture & Process handler should exist');
  const captureShortcutSource = source.slice(captureShortcutStart, source.indexOf('// Inertial-scroll engine', captureShortcutStart));
  assert.match(captureShortcutSource, /pendingCaptureRef\.current = data/);
  assert.match(captureShortcutSource, /appendScreenshotAttachment\(prev, data\)/);
  assert.doesNotMatch(captureShortcutSource, /prev\.some\(\(s\) => s\.path === data\.path\)/);
});

test('screen-backed action routing uses trigger requiresScreen instead of hardcoded type checks', () => {
  const detector = read('electron/services/dynamic-actions/DynamicActionDetector.ts');
  const engine = read('electron/services/dynamic-actions/DynamicActionEngine.ts');
  const helper = read('src/lib/screenshotAttachment.mjs');
  const actionTypes = read('electron/services/dynamic-actions/DynamicAction.ts');
  const rendererTypes = read('src/types/electron.d.ts');

  const screenTriggerStart = detector.indexOf("type: 'screen_coding_problem'");
  assert.ok(screenTriggerStart >= 0, 'screen coding trigger should exist');
  const screenTriggerSource = detector.slice(screenTriggerStart, detector.indexOf('},', screenTriggerStart) + 2);
  assert.match(screenTriggerSource, /requiresScreen: true/);

  assert.match(engine, /const requiresScreen = Boolean\(trigger\.requiresScreen\)/);
  assert.match(engine, /source: requiresScreen \? 'screen' : 'transcript'/);
  assert.doesNotMatch(engine, /screen_coding_problem/);
  assert.match(helper, /action\.requiresScreen === true/);
  assert.doesNotMatch(helper, /screen_coding_problem/);
  assert.match(actionTypes, /requiresScreen\?: boolean/);
  assert.match(rendererTypes, /requiresScreen\?: boolean/);
});

test('generate-what-to-say IPC forwards promptInstruction option to IntelligenceManager', () => {
  const source = read('electron/ipcHandlers.ts');
  const handlerSource = sliceSafeHandleBlock(source, 'generate-what-to-say');
  assert.ok(findSafeHandle(source, 'generate-what-to-say') >= 0, 'generate-what-to-say handler should exist');

  assert.match(handlerSource, /options\?: \{ promptInstruction\?: string; domContext\?: string; domContextEnvelope\?: unknown \}/);
  assert.match(handlerSource, /promptInstruction:[\s\S]{0,120}typeof options\?\.promptInstruction === 'string'[\s\S]{0,80}options\.promptInstruction[\s\S]{0,40}: undefined/);
  assert.match(handlerSource, /let effectiveDomContext =[\s\S]{0,120}typeof options\?\.domContext === 'string'[\s\S]{0,80}options\.domContext\.substring\(0, DOM_CONTEXT_MAX_CHARS\)[\s\S]{0,40}: undefined/);
  assert.match(handlerSource, /domContext: effectiveDomContext/);
});

test('preload and renderer type expose promptInstruction option on generateWhatToSay', () => {
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  assert.match(preload, /generateWhatToSay:[\s\S]{0,220}options\?: \{ promptInstruction\?: string; domContext\?: string; domContextEnvelope\?: unknown \}/);
  assert.match(preload, /ipcRenderer\.invoke\(['"]generate-what-to-say['"], question, imagePaths, options\)/);
  assert.match(types, /generateWhatToSay:[\s\S]{0,220}options\?: \{ promptInstruction\?: string; domContext\?: string; domContextEnvelope\?: ContextEnvelope \}/);
});
