// electron/services/__tests__/PageCaptureFallbackNotice2026_08_18.test.mjs
//
// Cmd/Ctrl+Shift+Y (general:capture-dom) falls back to a screenshot when the
// browser-extension page capture fails — previously SILENTLY, so the user just
// saw "Screenshot attached" and reported the hotkey as broken (2026-08-18).
// These tests pin the reason → user-notice mapping that main.ts now sends to
// the overlay, including the machine reasons that actually flow over the
// capture channel:
//   - main.ts's own 'browser extension not connected'
//   - PhoneMirrorService.requestDomCapture: 'no-extension' | 'timeout' | 'send-failed'
//   - the extension's capture-ack error: outcome kind ('needs-host-permission')
//     or message ('No active tab', 'Cannot capture browser/internal pages', …)
// Regression pin: main.ts used to grep only Chrome's RAW error wording for the
// grant-this-site hint, which the extension never sends (it sends the outcome
// kind 'needs-host-permission') — that literal must map to the actionable hint.
//
// Pure module — loaded from dist-electron per repo test convention.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync as fsReadFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const fsReadFile = (p) => fsReadFileSync(p, 'utf8');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../../');
const mod = await import(
  pathToFileURL(
    path.resolve(root, 'dist-electron/electron/services/pageCaptureFallback.js'),
  ).href
);
const { describePageCaptureFallback, describeDoubleCaptureFailure, PAGE_CAPTURE_FALLBACK_CHANNEL } = mod;

describe('describePageCaptureFallback', () => {
  test('extension not connected (main.ts literal) → not-connected with pairing guidance', () => {
    const n = describePageCaptureFallback('browser extension not connected');
    assert.equal(n.kind, 'not-connected');
    assert.match(n.detail, /Pair it in Settings/i);
  });

  test("requestDomCapture 'no-extension' → not-connected", () => {
    assert.equal(describePageCaptureFallback('no-extension').kind, 'not-connected');
  });

  test("extension outcome kind 'needs-host-permission' → grant-this-site hint (regression pin)", () => {
    const n = describePageCaptureFallback('needs-host-permission');
    assert.equal(n.kind, 'needs-host-permission');
    assert.match(n.detail, /extension icon/i);
    assert.match(n.detail, /grant/i);
  });

  test("Chrome's raw host-permission wordings also → needs-host-permission", () => {
    for (const raw of [
      'Cannot access contents of url "https://example.com/". Extension manifest must request permission to access this host.',
      'Missing host permission for the tab',
    ]) {
      assert.equal(describePageCaptureFallback(raw).kind, 'needs-host-permission', raw);
    }
  });

  test("requestDomCapture 'timeout' → timeout", () => {
    const n = describePageCaptureFallback('timeout');
    assert.equal(n.kind, 'timeout');
    assert.match(n.detail, /did not respond/i);
  });

  test('extension capture messages about missing/internal tabs → no-tab', () => {
    assert.equal(describePageCaptureFallback('No active tab').kind, 'no-tab');
    assert.equal(
      describePageCaptureFallback('Cannot capture browser/internal pages').kind,
      'no-tab',
    );
  });

  test('unknown reasons → generic error notice carrying the raw reason', () => {
    const n = describePageCaptureFallback('send-failed');
    assert.equal(n.kind, 'error');
    assert.match(n.detail, /send-failed/);
  });

  test('empty/undefined reason still yields a coherent notice', () => {
    for (const r of ['', undefined, null]) {
      const n = describePageCaptureFallback(r);
      assert.equal(n.kind, 'error');
      assert.equal(n.reason, 'unknown');
      assert.ok(n.label.length > 0);
    }
  });

  test('every notice names the screenshot fallback so the pill explains what the user saw', () => {
    for (const r of ['no-extension', 'needs-host-permission', 'timeout', 'No active tab', 'weird']) {
      const n = describePageCaptureFallback(r);
      assert.match(n.label, /screenshot/i, `label for ${r}`);
      assert.match(n.detail, /screenshot/i, `detail for ${r}`);
    }
  });
});

describe('describeDoubleCaptureFailure', () => {
  test('never claims a screenshot was attached (review fix: notice sent only after success)', () => {
    const n = describeDoubleCaptureFailure('no-extension', new Error('Screen capture failed'));
    assert.equal(n.kind, 'error');
    assert.match(n.label, /nothing was attached/i);
    assert.doesNotMatch(n.detail, /was attached instead/i);
    assert.match(n.detail, /Screen capture failed/);
  });

  test('carries the actionable hint for the underlying DOM failure', () => {
    const host = describeDoubleCaptureFailure('needs-host-permission', 'denied');
    assert.match(host.detail, /extension icon/i);
    const pair = describeDoubleCaptureFailure('no-extension', 'denied');
    assert.match(pair.detail, /Settings → Sync/);
  });
});

describe('remediation copy names real UI surfaces', () => {
  test("settings path is 'Settings → Sync' (the actual tab label), not the nonexistent 'Phone Mirror' entry", () => {
    for (const r of ['no-extension', 'timeout']) {
      const n = describePageCaptureFallback(r);
      assert.doesNotMatch(n.detail, /Phone Mirror/, r);
    }
    assert.match(describePageCaptureFallback('no-extension').detail, /Settings → Sync → Browser Extension/);
  });

  test('host-permission copy is browser-agnostic (Chrome/Edge/Arc all supported)', () => {
    assert.doesNotMatch(describePageCaptureFallback('needs-host-permission').detail, /Chrome/);
  });
});

describe('IPC channel contract', () => {
  test('channel constant is the literal preload subscribes to', () => {
    assert.equal(PAGE_CAPTURE_FALLBACK_CHANNEL, 'page-capture-fallback');
  });
});

// Source-level wiring guard: the notice is only useful if every hop stays
// connected. Kept to structural facts (imports / identifiers), not formatting.
describe('main → preload → overlay wiring', () => {
  const read = (p) => fsReadFile(path.resolve(root, p));

  test('main.ts sends the notice from the capture-dom fallback branch', () => {
    const src = read('electron/main.ts');
    assert.match(src, /from ["']\.\/services\/pageCaptureFallback["']/);
    assert.match(src, /describePageCaptureFallback\(domFailureReason\)/);
    assert.match(src, /PAGE_CAPTURE_FALLBACK_CHANNEL,\s*fallbackNotice/);
    // Review fixes: the notice must target the OVERLAY window (the only one
    // that mounts the listener — getMainWindow() is the launcher in launcher
    // mode), and the double-failure path must send its own truthful notice.
    assert.match(src, /getOverlayWindow\?\.\(\)\s*\?\?\s*this\.getMainWindow\(\)/);
    // Pin updated 2026-08-19 (code review): the double-failure notice now
    // takes the USER's platform, because its closing screenshot-permission
    // hint used to name macOS Screen Recording unconditionally — sending
    // Windows users to a pane that does not exist (CLAUDE.md forbids
    // cross-platform troubleshooting text). Injected, not read inside the
    // module, so the module stays pure and both branches are testable.
    assert.match(src, /describeDoubleCaptureFailure\(domFailureReason,\s*shotErr,\s*process\.platform\)/);
    // Ordering: the success notice is sent AFTER captureScreenAndProcess() so
    // "a screenshot was attached instead" is only claimed once it's true.
    const branch = src.slice(src.indexOf("describePageCaptureFallback(domFailureReason)"));
    assert.ok(
      branch.indexOf('captureScreenAndProcess()') <
        branch.indexOf('PAGE_CAPTURE_FALLBACK_CHANNEL, fallbackNotice'),
      'success notice must be sent after the screenshot succeeds',
    );
  });

  test('preload exposes onPageCaptureFallback on the shared channel constant', () => {
    const src = read('electron/preload.ts');
    assert.match(src, /onPageCaptureFallback/);
    assert.match(src, /ipcRenderer\.on\(PAGE_CAPTURE_FALLBACK_CHANNEL/);
  });

  test('overlay subscribes and renders the fallback pill', () => {
    const src = read('src/components/NativelyInterface.tsx');
    assert.match(src, /onPageCaptureFallback/);
    assert.match(src, /captureFallback/);
  });

  test('consumed page context is stamped on the question card ("Page attached")', () => {
    // 2026-08-19: the status pill vanishes when the context is consumed, so the
    // chat card itself must show WHICH page fed the answer (mirrors the
    // screenshot thumbnails). Verified live: card reads
    // "Page attached · leetcode.com — Two Sum - LeetCode".
    const src = read('src/components/NativelyInterface.tsx');
    assert.match(src, /capturedMetaRef/);
    assert.match(src, /Page attached/);
    assert.match(src, /m\.id === questionCardId \? \{ \.\.\.m, pageContext: pageMeta \}/);
  });

  test('capture hotkey is ⌘/Ctrl+Y (2026-08-19 rebind), one binding, no ⌘⇧Y leftovers', () => {
    const kb = read('electron/services/KeybindManager.ts');
    assert.match(kb, /'general:capture-dom'[^\n]*accelerator: 'CommandOrControl\+Y'/);
    assert.doesNotMatch(kb, /CommandOrControl\+Shift\+Y/);
    const sc = read('src/hooks/useShortcuts.ts');
    assert.match(sc, /capturePage: \[mod, 'Y'\]/);
  });

  test('one-motion ⌘Y→Enter: started signal wired main → preload → overlay wait', () => {
    const main = read('electron/main.ts');
    assert.match(main, /PAGE_CAPTURE_STARTED_CHANNEL,\s*\{ at: Date\.now\(\) \}/);
    const preload = read('electron/preload.ts');
    assert.match(preload, /ipcRenderer\.on\(PAGE_CAPTURE_STARTED_CHANNEL/);
    const ui = read('src/components/NativelyInterface.tsx');
    assert.match(ui, /onPageCaptureStarted/);
    assert.match(ui, /pendingPageCaptureAtRef/);
  });

  test('screenshot wins over AUTOMATIC page capture (auto-attach gated on no attachments)', () => {
    // 2026-08-19 decision: a screenshot is the user deliberately pointing at
    // something; the JIT auto-attach is a guess about the active tab. With
    // screenshots attached, the auto request must not run (they can describe
    // different content). Manual ⌘⇧Y captures still attach alongside.
    const src = read('src/components/NativelyInterface.tsx');
    assert.match(src, /!hasManualContext && currentAttachments\.length === 0/);
  });
});
