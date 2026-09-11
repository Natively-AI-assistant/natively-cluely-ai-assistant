// electron/llm/__tests__/StreamReaderCancelUnhandledRejection2026_09_11.test.mjs
//
// Fix pin for a reproducible main-process SELF-TERMINATION.
//
// Symptom (reproduced 2026-09-11 on Windows by driving the real app):
//   Natively exited on its own after ~106s of ordinary use — start a session,
//   then tap the AI action shortcuts in succession (Ctrl+1, Ctrl+2, Ctrl+3 …).
//
// Chain:
//   1. Each new action bumps IntelligenceEngine.currentGenerationId, so the
//      in-flight stream is abandoned ("… stream aborted by new generation").
//   2. runStreamingFallback's `finally` calls ctrl.abort() on EVERY exit path
//      (streamFallbackEngine.ts).
//   3. That rejects the pending body reader. LLMHelper's natively-stream
//      `finally` called `try { reader.cancel(); } catch { }` — and a
//      synchronous try/catch CANNOT catch a promise rejection, so the
//      AbortError escaped to process.on('unhandledRejection').
//   4. main.ts's crash-loop guard terminates the app at
//      UNHANDLED_REJECTION_MAX (5) rejections inside
//      UNHANDLED_REJECTION_WINDOW_MS (60_000) —
//      logged as [CRASH:unhandledRejection-loop-giveup].
//
// One aborted stream == one unhandled rejection, so five quick action
// switches inside a minute were enough to kill the app.
//
// The fix is the idiom already used in CodexCliService.ts and
// OllamaBootstrap.ts: attach a .catch() to reader.cancel().
//
// Run via: node --test electron/llm/__tests__/StreamReaderCancelUnhandledRejection2026_09_11.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

test('LLMHelper: every reader.cancel() is promise-safe (no bare sync try/catch)', () => {
  const source = fs.readFileSync(path.resolve(repoRoot, 'electron/LLMHelper.ts'), 'utf8')
    // Drop line comments — prose about reader.cancel() is not a call site.
    .replace(/^\s*\/\/.*$/gm, '');

  const cancels = source.match(/reader\??\.cancel\(\)[^\n]*/g) ?? [];
  assert.ok(cancels.length > 0, 'LLMHelper.ts must still cancel its stream reader');

  for (const line of cancels) {
    // `await reader.cancel()` inside a try/catch is also safe; so is an
    // explicitly attached .catch(). A bare call is not.
    const awaited = /await\s+reader\??\.cancel\(\)/.test(line);
    const caught = /reader\??\.cancel\(\)\s*\.catch\(/.test(line);
    assert.ok(
      awaited || caught,
      'reader.cancel() returns a Promise that REJECTS when the stream was torn ' +
      'down by an abort. A sync `try { reader.cancel(); } catch {}` does not ' +
      'catch that — the AbortError reaches process.on("unhandledRejection") and ' +
      '5 of them inside 60s trip main.ts\'s unhandledRejection-loop-giveup guard, ' +
      'terminating the app. Use `reader.cancel().catch(() => {})` or await it. ' +
      `Offending line: ${line.trim()}`,
    );
  }
});

test('main.ts crash-loop guard still has the thresholds this fix protects', () => {
  // If these constants move, the blast radius of any future unguarded
  // rejection changes too — keep the pin honest about what it is protecting.
  const main = fs.readFileSync(path.resolve(repoRoot, 'electron/main.ts'), 'utf8');
  assert.match(main, /const UNHANDLED_REJECTION_MAX = \d+/,
    'main.ts must still bound unhandled rejections rather than ignoring them');
  assert.match(main, /terminateAfterFatalError\('unhandledRejection-loop-giveup'/,
    'the give-up path is what turns a stray rejection into a user-visible crash');
});
