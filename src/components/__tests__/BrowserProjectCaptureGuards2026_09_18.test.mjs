import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const interfaceSource = fs.readFileSync(path.resolve(here, '../NativelyInterface.tsx'), 'utf8');
const panelSource = fs.readFileSync(path.resolve(here, '../BrowserProjectPanel.tsx'), 'utf8');

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test('project capture and refresh both reject an empty file selection', () => {
  const capture = section(
    interfaceSource,
    'const captureBrowserProject = useCallback',
    '/**\n   * BROWSER DOM CONTEXT INTEGRATION',
  );
  assert.match(capture, /if \(selectedPaths\.length === 0\)/);
  assert.doesNotMatch(capture, /if \(!refresh && selectedPaths\.length === 0\)/);

  const actions = section(panelSource, "<div className={`mt-2 grid gap-1.5", '</div>\n    </div>');
  const disabledForEmptySelection = /disabled=\{busy \|\| selectedFiles\.length === 0\}/g;
  assert.equal(
    [...actions.matchAll(disabledForEmptySelection)].length,
    2,
    'both Capture selected and Refresh changed must be disabled with no selected files',
  );
});

test('Ctrl/Cmd+Y to Enter covers MV3 wake plus the 12 second capture deadline', () => {
  assert.match(interfaceSource, /const MANUAL_PAGE_CAPTURE_DEADLINE_MS = 14_000/);
  const whatToSay = section(
    interfaceSource,
    'const handleWhatToSay = async',
    'const handleFollowUp = async',
  );
  assert.match(whatToSay, /const waitDeadline = pendingAt \+ MANUAL_PAGE_CAPTURE_DEADLINE_MS/);
  assert.match(whatToSay, /pendingPageCaptureAtRef\.current === pendingAt/);
  assert.match(whatToSay, /const manualCaptureStillPending = pendingPageCaptureAtRef\.current !== null/);
  assert.match(
    whatToSay,
    /if \(!hasManualContext && !manualCaptureStillPending && currentAttachments\.length === 0\)/,
  );

  const waitAt = whatToSay.indexOf('const pendingAt = pendingPageCaptureAtRef.current');
  const directBranchAt = whatToSay.indexOf('if (directAssistEnabled)');
  const directConsumeAt = whatToSay.indexOf('const directPageContext = consumeDirectPageContext()');
  assert.ok(waitAt >= 0, 'manual capture wait must exist');
  assert.ok(directBranchAt > waitAt, 'manual capture wait must finish before Direct Assist branches');
  assert.ok(directConsumeAt > directBranchAt, 'Direct Assist must consume context after the wait');
});

test('the first successful capture exposes Refresh changed without requiring another scan', () => {
  const capture = section(
    interfaceSource,
    'const captureBrowserProject = useCallback',
    '/**\n   * BROWSER DOM CONTEXT INTEGRATION',
  );
  assert.match(capture, /setProjectPicker\(\(current\) => current \? \{ \.\.\.current, refreshAvailable: true \} : current\)/);

  const pendingAt = capture.indexOf('const captureStartedAt = beginExplicitPageCapture()');
  const requestAt = capture.indexOf('phoneMirrorCaptureProject?.({');
  assert.ok(pendingAt >= 0, 'overlay project capture must mark manual context as pending');
  assert.ok(requestAt > pendingAt, 'pending state must be visible before the async capture request');
  assert.match(capture, /if \(pendingPageCaptureAtRef\.current === captureStartedAt\)/);
  assert.match(capture, /if \(!result\?\.ok\) \{\s*clearPendingCapture\(\)/);
  assert.match(capture, /if \(result\.unchanged\) \{\s*clearPendingCapture\(\)/);
  assert.match(capture, /catch \(error\) \{\s*clearPendingCapture\(\)/);
});

test('a new explicit capture retires stale context before becoming pending', () => {
  const beginCapture = section(
    interfaceSource,
    'const beginExplicitPageCapture = useCallback',
    'const openTabPicker = useCallback',
  );
  const clearDomAt = beginCapture.indexOf("lastCapturedDOM = ''");
  const clearEnvelopeAt = beginCapture.indexOf('capturedEnvelopeRef.current = null');
  const clearMetaAt = beginCapture.indexOf('capturedMetaRef.current = null');
  const clearPillAt = beginCapture.indexOf('setPageContext(null)');
  const pendingAt = beginCapture.indexOf('pendingPageCaptureAtRef.current = startedAt');
  for (const clearAt of [clearDomAt, clearEnvelopeAt, clearMetaAt, clearPillAt]) {
    assert.ok(clearAt >= 0 && clearAt < pendingAt, 'old context must be retired before new pending state');
  }

  const startedEffect = section(
    interfaceSource,
    '// Track in-flight',
    '// Auto-expire the fallback notice',
  );
  assert.match(startedEffect, /onPageCaptureStarted\?\.\(\(\) => \{\s*beginExplicitPageCapture\(\)/);
});

test('a new scan retires the previous picker and connection lease before discovery', () => {
  const scan = section(
    interfaceSource,
    'const scanBrowserProject = useCallback',
    'const applyBrowserProjectPreset = useCallback',
  );
  const clearPickerAt = scan.indexOf('setProjectPicker(null)');
  const discoverAt = scan.indexOf('phoneMirrorDiscoverProject?.()');

  assert.ok(clearPickerAt >= 0, 'scan must clear the previous picker and its lease');
  assert.ok(discoverAt > clearPickerAt, 'the previous picker must be cleared before async discovery');

  const beforeDiscovery = scan.slice(0, discoverAt);
  assert.match(beforeDiscovery, /setProjectBusy\(true\)/);
  assert.match(beforeDiscovery, /setProjectPicker\(null\)/);

  const unsuccessfulDiscovery = section(
    scan,
    'if (!result?.ok || !result.project || !result.connectionLease)',
    'const readablePaths =',
  );
  assert.doesNotMatch(
    unsuccessfulDiscovery,
    /setProjectPicker\(/,
    'failed discovery must not restore stale capture actions',
  );
});
