import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

// Issue #301: "❌ STT Error: invalid_key_format" shown raw to the user when
// pressing Answer after STT fails. The fix uses sttErrorMapper.categorizeSttError
// to surface the human-readable title+body instead of the raw error code.

test('sttErrorMapper maps invalid_key_format to a user-friendly auth message', () => {
  const source = read('src/lib/sttErrorMapper.ts');
  assert.match(source, /invalid_key_format/, 'sttErrorMapper must handle invalid_key_format');
  assert.match(source, /Authentication Failed|auth/, 'invalid_key_format must map to auth category');
});

test('NativelyInterface uses sttErrorMapper for the chat-message STT error', () => {
  const source = read('src/components/NativelyInterface.tsx');

  // The static import must be present (Fix 1 from issue #301)
  assert.match(
    source,
    /import\s*\{[^}]*categorizeSttError[^}]*\}\s*from\s*['"]\.\.\/lib\/sttErrorMapper['"]/,
    'categorizeSttError must be statically imported in NativelyInterface.tsx',
  );

  // The chat message must NOT contain the raw error code pattern
  assert.doesNotMatch(
    source,
    /❌ STT Error: \$\{sttUserError\}/,
    'Chat message must not expose raw sttUserError — use categorizeSttError instead',
  );

  // The chat message must use the categorized title
  assert.match(
    source,
    /errCat\.title/,
    'Chat message must use errCat.title from categorizeSttError',
  );
  assert.match(
    source,
    /errCat\.body/,
    'Chat message must use errCat.body from categorizeSttError',
  );
});

test('sttErrorMapper auth category covers all NativelyPro fatal error codes', () => {
  const source = read('src/lib/sttErrorMapper.ts');
  // These are the fatal codes NativelyProSTT emits that cause state='failed'
  assert.match(source, /invalid_key_format/, 'must map invalid_key_format');
  assert.match(source, /auth_timeout/, 'must map auth_timeout');
  assert.match(source, /invalid_key|invalid api|authentication/, 'must map auth patterns');
  assert.match(source, /trial_expired/, 'must map trial_expired');
});

test('sttErrorMapper maps trial_expired to a user-friendly Trial Expired message', () => {
  const source = read('src/lib/sttErrorMapper.ts');
  assert.match(source, /Trial Expired/, 'must have Trial Expired title');
  assert.match(source, /trial has ended|Upgrade your plan/, 'must give upgrade guidance');
});

// Since 2026-10-21 every site shares one gate, onnxMacSupport.ts: macOS 13.3
// (Darwin 22.4), the minos of onnxruntime-node 1.22.0's macOS binaries, and one
// sentence. Its version logic is tested in
// electron/audio/__tests__/WhisperQueueAndAutoLanguage2026_10_21.test.mjs; here
// each site must still use it.
const SHARED_GATE = /onnxRuntimeSupportedOnThisMac\(\)/;

test('LocalWhisperSTT emits a friendly error for ONNX symbol-not-found crash (macOS 12)', () => {
  const source = read('electron/audio/LocalWhisperSTT.ts');
  // The fix must detect the ONNX dlopen symbol-error and surface a friendly message
  assert.match(
    source,
    /Symbol not found|to_chars|libonnxruntime/,
    'LocalWhisperSTT must detect the ONNX libc++ symbol-not-found error',
  );
  assert.match(source, /ONNX_MAC_UNSUPPORTED_MESSAGE/, 'LocalWhisperSTT must show the shared macOS version sentence');
  const gate = read('electron/audio/whisper/onnxMacSupport.ts');
  assert.match(gate, /macOS 13\.3 or later/);
});

test('modelManager marks all local Whisper models as error on macOS 12 (Darwin 21)', () => {
  const source = read('electron/audio/whisper/modelManager.ts');
  assert.match(source, SHARED_GATE, 'modelManager must gate on the shared ONNX macOS check');
  assert.match(source, /errorMessage: ONNX_MAC_UNSUPPORTED_MESSAGE/, 'modelManager must surface the macOS version requirement');
});

function extractHandlerBody(source, handlerName) {
  const idx = source.indexOf(`'${handlerName}'`);
  assert.ok(idx >= 0, `${handlerName} handler must exist`);
  const nextHandler = source.indexOf('safeHandle(', idx + 1);
  return source.slice(idx, nextHandler === -1 ? source.length : nextHandler);
}

test('local-whisper-start-download blocks download on macOS 12', () => {
  // `local-whisper-start-download` delegates to LocalModelDownloadService,
  // which carries the gate.
  const source = read('electron/ipcHandlers.ts');
  const handler = extractHandlerBody(source, 'local-whisper-start-download');
  assert.match(handler, /LocalModelDownloadService/, 'handler must delegate to LocalModelDownloadService');
  const service = read('electron/services/LocalModelDownloadService.ts');
  assert.match(service, SHARED_GATE, 'the download service must check the shared ONNX macOS gate');
  assert.match(service, /return ONNX_MAC_UNSUPPORTED_MESSAGE;/, 'the download service must surface the macOS version error');
});

test('local-whisper-preload IPC blocks preload on macOS 12', () => {
  const source = read('electron/ipcHandlers.ts');
  const handler = extractHandlerBody(source, 'local-whisper-preload');
  assert.match(handler, SHARED_GATE, 'handler must check the shared ONNX macOS gate');
  assert.match(handler, /error: ONNX_MAC_UNSUPPORTED_MESSAGE/, 'handler must surface the macOS version error');
});
