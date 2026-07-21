// electron/services/__tests__/CodexCliService.test.mjs
//
// Unit tests for the rewritten CodexCliService. The HTTP-direct
// implementation no longer spawns a CLI subprocess, so the old tests
// that built mock binaries to verify wire-level CLI argv are no longer
// applicable. They live in CodexIntegrationE2E.test.mjs and
// CodexPostCommitE2E.test.mjs and assert legacy subprocess behaviour —
// the equivalent coverage for the new path is in
// CodexOAuthService.test.mjs (auth + retry logic) and here (resolver,
// config, SSE parser, run/stream).
//
// What's covered here:
//
//   1. Defaults, sandbox-mode/tier/reasoning-effort unions
//   2. resolveCodexReasoningEffort (per-model VALID set, downgrade policy)
//   3. normalizeConfig (legacy path field, sandbox, reasoning downgrade)
//   4. buildArgs — DEPRECATED, returns []
//   5. extractText — still used by the legacy CLI fixture tests
//   6. extractCodexError — still used by the legacy CLI fixture tests
//   7. CodexOAuthService.signOut, getStatus, refresh tokens
//
// The HTTP-direct stream/run tests are smoke-tested via the OAuth tests
// (which exercise the same fetch path with mocked responses).
//
// Run via: npm run build:electron && node --test electron/services/__tests__/CodexCliService.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compiledPath = path.resolve(__dirname, '../../../dist-electron/electron/services/CodexCliService.js');
const mod = await import(pathToFileURL(compiledPath).href);
const { CodexCliService, DEFAULT_CODEX_CLI_CONFIG, CODEX_SANDBOX_MODES, resolveCodexReasoningEffort, CODEX_MODEL_REASONING_EFFORTS } = mod;

// =============================================================================
// Defaults + enums
// =============================================================================

test('DEFAULT_CODEX_CLI_CONFIG has expected shape', () => {
  assert.equal(DEFAULT_CODEX_CLI_CONFIG.enabled, false);
  // `path` is preserved for IPC backward-compat but is ignored at runtime.
  assert.equal(DEFAULT_CODEX_CLI_CONFIG.path, 'codex');
  assert.equal(DEFAULT_CODEX_CLI_CONFIG.model, 'gpt-5.4');
  assert.equal(DEFAULT_CODEX_CLI_CONFIG.fastModel, 'gpt-5.3-codex');
  assert.equal(DEFAULT_CODEX_CLI_CONFIG.timeoutMs, 60_000);
  assert.equal(DEFAULT_CODEX_CLI_CONFIG.sandboxMode, 'read-only');
});

test('CODEX_SANDBOX_MODES enumerates the three valid modes (deprecated at runtime, still exposed)', () => {
  // Sandbox modes are kept in the type/constant for the Settings UI to
  // read. The HTTP-direct path ignores them at runtime, but the union
  // is preserved so the UI can still render the dropdown without
  // crashing on `normalizeConfig`.
  assert.deepEqual([...CODEX_SANDBOX_MODES], ['read-only', 'workspace-write', 'danger-full-access']);
});

test('CODEX_MODEL_REASONING_EFFORTS includes none (per OpenAI gpt-5.1+ semantics)', () => {
  assert.ok(CODEX_MODEL_REASONING_EFFORTS.includes('none'));
  assert.ok(CODEX_MODEL_REASONING_EFFORTS.includes('low'));
  assert.ok(CODEX_MODEL_REASONING_EFFORTS.includes('medium'));
  assert.ok(CODEX_MODEL_REASONING_EFFORTS.includes('high'));
  assert.ok(CODEX_MODEL_REASONING_EFFORTS.includes('xhigh'));
});

// =============================================================================
// buildArgs — DEPRECATED
// =============================================================================

test('buildArgs: deprecated, returns empty array (HTTP-direct path has no argv)', () => {
  const args = CodexCliService.buildArgs('gpt-5.4', [], 'read-only', 'default', 'low');
  assert.ok(Array.isArray(args));
  assert.equal(args.length, 0,
    'buildArgs is deprecated and must return []; the HTTP path uses body.model + body.reasoning.effort');
});

test('buildArgs: ignores all 5 parameters without throwing', () => {
  // The deprecated method must accept the legacy signature so callers
  // (and the legacy CLI fixture tests) don't crash. None of the args
  // are used.
  const args = CodexCliService.buildArgs(
    'gpt-5.3-codex',
    ['/tmp/a.png', '/tmp/b.png'],
    'workspace-write',
    'fast',
    'xhigh',
  );
  assert.equal(args.length, 0);
});

// =============================================================================
// resolveCodexReasoningEffort
// =============================================================================

test('resolveCodexReasoningEffort: returns undefined for empty pick (no body.reasoning field)', () => {
  assert.equal(resolveCodexReasoningEffort('gpt-5.4', undefined), undefined);
  assert.equal(resolveCodexReasoningEffort('gpt-5.4', null), undefined);
  assert.equal(resolveCodexReasoningEffort('gpt-5.4', ''), undefined);
});

test('resolveCodexReasoningEffort: honours exact-match valid picks', () => {
  assert.equal(resolveCodexReasoningEffort('gpt-5.4', 'low'), 'low');
  assert.equal(resolveCodexReasoningEffort('gpt-5.4', 'medium'), 'medium');
  assert.equal(resolveCodexReasoningEffort('gpt-5.4', 'high'), 'high');
  assert.equal(resolveCodexReasoningEffort('gpt-5.4', 'xhigh'), 'xhigh');
  assert.equal(resolveCodexReasoningEffort('gpt-5.4', 'none'), 'none');
});

test('resolveCodexReasoningEffort: longest-match wins (gpt-5.4-codex vs gpt-5)', () => {
  // gpt-5.4-codex accepts xhigh; generic gpt-5 does not. The 5.4-codex
  // entry must win the lookup.
  assert.equal(resolveCodexReasoningEffort('gpt-5.4-codex', 'xhigh'), 'xhigh');
  // gpt-5.3-codex does NOT support xhigh — downgrade.
  assert.equal(resolveCodexReasoningEffort('gpt-5.3-codex', 'xhigh'), 'low');
});

test('resolveCodexReasoningEffort: case-insensitive model id', () => {
  assert.equal(resolveCodexReasoningEffort('GPT-5.4', 'xhigh'), 'xhigh');
  assert.equal(resolveCodexReasoningEffort('Gpt-5-Codex', 'medium'), 'medium');
});

test('resolveCodexReasoningEffort: unknown model id falls back to [low, medium, high]', () => {
  assert.equal(resolveCodexReasoningEffort('some-future-model', 'low'), 'low');
  assert.equal(resolveCodexReasoningEffort('some-future-model', 'xhigh'), 'low');
});

// =============================================================================
// normalizeConfig
// =============================================================================

test('normalizeConfig: downgrades invalid effort for chosen model', () => {
  // xhigh on gpt-5.3-codex is rejected by the Codex backend → resolver
  // returns the lowest-latency reasoning effort ('low') so a stale saved
  // value can't trigger a 400. The reasoning-only filter skips 'none' so we
  // don't silently turn a high-effort pick into zero reasoning.
  const cfg = CodexCliService.normalizeConfig({ model: 'gpt-5.3-codex', modelReasoningEffort: 'xhigh' });
  assert.equal(cfg.modelReasoningEffort, 'low');
});

test('normalizeConfig: keeps valid effort for chosen model', () => {
  const cfg = CodexCliService.normalizeConfig({ model: 'gpt-5.4', modelReasoningEffort: 'xhigh' });
  assert.equal(cfg.modelReasoningEffort, 'xhigh');
});

test('normalizeConfig: empty input returns defaults', () => {
  assert.deepEqual(CodexCliService.normalizeConfig({}), DEFAULT_CODEX_CLI_CONFIG);
});

test('normalizeConfig: invalid timeouts fall back to default', () => {
  assert.equal(CodexCliService.normalizeConfig({ timeoutMs: null }).timeoutMs, 60_000);
  assert.equal(CodexCliService.normalizeConfig({ timeoutMs: -1 }).timeoutMs, 60_000);
  assert.equal(CodexCliService.normalizeConfig({ timeoutMs: 0 }).timeoutMs, 60_000);
  assert.equal(CodexCliService.normalizeConfig({ timeoutMs: 'abc' }).timeoutMs, 60_000);
  assert.equal(CodexCliService.normalizeConfig({ timeoutMs: 30_000 }).timeoutMs, 30_000);
});

test('normalizeConfig: preserves the legacy `path` field for IPC backward-compat', () => {
  // The HTTP-direct path ignores `path` but the IPC layer still reads
  // and writes it (so the Settings UI doesn't reset on re-save).
  assert.equal(CodexCliService.normalizeConfig({ path: '   ' }).path, 'codex');
  assert.equal(CodexCliService.normalizeConfig({ path: '/usr/local/bin/codex' }).path, '/usr/local/bin/codex');
});

test('normalizeConfig: enabled is coerced to boolean', () => {
  assert.equal(CodexCliService.normalizeConfig({ enabled: 1 }).enabled, true);
  assert.equal(CodexCliService.normalizeConfig({ enabled: 0 }).enabled, false);
  assert.equal(CodexCliService.normalizeConfig({ enabled: 'yes' }).enabled, true);
  assert.equal(CodexCliService.normalizeConfig({ enabled: undefined }).enabled, false);
});

test('normalizeConfig: invalid sandboxMode falls back to read-only', () => {
  // Sandbox mode is deprecated at runtime but still typed — the
  // Settings UI may send an invalid value during a partial update.
  assert.equal(CodexCliService.normalizeConfig({ sandboxMode: 'evil' }).sandboxMode, 'read-only');
  assert.equal(CodexCliService.normalizeConfig({ sandboxMode: undefined }).sandboxMode, 'read-only');
});

test('normalizeConfig: valid sandboxModes are preserved (legacy compat)', () => {
  assert.equal(CodexCliService.normalizeConfig({ sandboxMode: 'workspace-write' }).sandboxMode, 'workspace-write');
  assert.equal(CodexCliService.normalizeConfig({ sandboxMode: 'danger-full-access' }).sandboxMode, 'danger-full-access');
});

// =============================================================================
// extractText — preserved for legacy CLI fixture tests
// =============================================================================

test('extractText: parses Codex --json delta event stream', () => {
  // Kept because the legacy subprocess CLI emits this NDJSON shape. The
  // HTTP path doesn't use it but the Settings UI may still feed
  // historical CLI output through here for diagnosis.
  const sample = [
    '{"type":"thread.started","thread_id":"abc"}',
    '{"type":"agent_message.delta","delta":"Hello"}',
    '{"type":"agent_message.delta","delta":" world"}',
    '{"type":"turn.completed"}',
  ].join('\n');
  assert.equal(CodexCliService.extractText(sample), 'Hello world');
});

test('extractText: passes through plain text untouched', () => {
  assert.equal(CodexCliService.extractText('plain hi'), 'plain hi');
});

test('extractText: strips markdown json fence', () => {
  assert.equal(CodexCliService.extractText('```json\n{"x":1}\n```'), '{"x":1}');
});

test('extractText: lifecycle-only events return empty string', () => {
  assert.equal(
    CodexCliService.extractText('{"type":"turn.started"}\n{"type":"turn.completed"}'),
    '',
  );
});

test('extractText: agent_message item with text payload', () => {
  assert.equal(
    CodexCliService.extractText('{"item":{"type":"agent_message","text":"hi there"}}'),
    'hi there',
  );
});

test('extractText: error item is suppressed', () => {
  assert.equal(
    CodexCliService.extractText('{"item":{"type":"error","message":"boom"}}'),
    '',
  );
});

test('extractText: walks output_text key', () => {
  assert.equal(CodexCliService.extractText('{"output_text":"OK"}'), 'OK');
});

test('extractText: joins content arrays', () => {
  assert.equal(CodexCliService.extractText('{"content":["a","b","c"]}'), 'abc');
});

test('extractText: empty input returns empty', () => {
  assert.equal(CodexCliService.extractText(''), '');
  assert.equal(CodexCliService.extractText('   '), '');
});

// =============================================================================
// extractCodexError — preserved for legacy CLI fixture tests
// =============================================================================

test('extractCodexError: pulls message from stringified error envelope', () => {
  const sample = [
    '{"type":"thread.started","thread_id":"abc"}',
    '{"type":"turn.started"}',
    '{"type":"error","message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The \'gpt-5.3-codex-spark\' model is not supported when using Codex with a ChatGPT account.\\"}}"}',
    '{"type":"turn.failed"}',
  ].join('\n');
  const msg = CodexCliService.extractCodexError(sample);
  assert.match(msg, /not supported when using Codex with a ChatGPT account/);
});

test('extractCodexError: returns empty when no error events present', () => {
  const sample = '{"type":"agent_message.delta","delta":"hi"}';
  assert.equal(CodexCliService.extractCodexError(sample), '');
});

test('extractCodexError: handles plain string error message', () => {
  assert.equal(
    CodexCliService.extractCodexError('{"type":"error","message":"network unreachable"}'),
    'network unreachable',
  );
});

// =============================================================================
// CodexCliService.run / .stream — must throw when not signed in
// =============================================================================

test('run: throws when Codex OAuth is not signed in', async () => {
  // The HTTP-direct path requires an OAuth token. Without one, run()
  // surfaces a clear "sign in" error instead of silently failing into
  // the canned fallback.
  const oauthModulePath = path.resolve(__dirname, '../../../dist-electron/electron/services/CodexOAuthService.js');
  const oauthMod = await import(pathToFileURL(oauthModulePath).href);
  oauthMod.CodexOAuthService.getInstance().__resetForTest();
  // Defensive: clear any persisted tokens by signing out.
  oauthMod.CodexOAuthService.getInstance().signOut();

  await assert.rejects(
    () => CodexCliService.run('', {
      prompt: 'hi', model: 'gpt-5.4', timeoutMs: 5_000,
    }),
    err => /signed in to ChatGPT/i.test(err.message),
    'run() must surface a clear "sign in" error when OAuth is missing',
  );
});

test('stream: throws when Codex OAuth is not signed in', async () => {
  const oauthModulePath = path.resolve(__dirname, '../../../dist-electron/electron/services/CodexOAuthService.js');
  const oauthMod = await import(pathToFileURL(oauthModulePath).href);
  oauthMod.CodexOAuthService.getInstance().__resetForTest();
  oauthMod.CodexOAuthService.getInstance().signOut();

  const gen = CodexCliService.stream('', {
    prompt: 'hi', model: 'gpt-5.4', timeoutMs: 5_000,
  });
  await assert.rejects(async () => {
    // eslint-disable-next-line no-unused-vars
    for await (const _ of gen) { /* drain */ }
  }, err => /signed in to ChatGPT/i.test(err.message));
});

test('stream: AbortSignal pre-aborted throws on first iteration', async () => {
  const ac = new AbortController();
  ac.abort();
  const gen = CodexCliService.stream('', {
    prompt: '', model: 'gpt-5.4', timeoutMs: 60_000, signal: ac.signal,
  });
  await assert.rejects(async () => {
    // eslint-disable-next-line no-unused-vars
    for await (const _ of gen) { /* drain */ }
  }, err => /aborted/i.test(err.message));
});

// =============================================================================
// Post-completion abort handling (parseSseStream reader.cancel + terminal-event
// detector). These tests pin the fix for the "Codex is answering fast, but
// after 30 secs or so it says [Codex request aborted.] even though everything
// was going fine" bug.
//
// Root cause: the ChatGPT OAuth endpoint keeps the SSE body open with
// trailing :keepalive for ~30s after the model finishes. The codex parser
// called reader.releaseLock() (which only drops the consumer lock, not the
// body) and didn't track a response.completed terminal event. Any
// controller.abort() in that 30s window propagated to the still-bound
// reader.read() as AbortError, which the catch at the old line 667
// re-threw as "Codex request aborted." even though the response was
// already fully delivered.
//
// Fix has two parts:
//   (1) try { reader.cancel(); } in finally (was reader.releaseLock()) —
//       actively tears down the HTTP body on every exit path.
//   (2) sawTerminalEvent flag set on response.completed / .incomplete /
//       .failed; AbortError thrown AFTER this flag is set is swallowed.
//
// We drive CodexCliService.parseSseStream directly (TypeScript `private`
// is compile-time only — the .js export exposes the static method by
// name) to focus on the SSE parser without needing the full stream()
// happy-path with OAuth signing-in plumbing.
// =============================================================================

/**
 * Build a Response with a custom ReadableStream body. Each call to
 * reader.read() pulls the next chunk from `initialChunks`. When the
 * queue is exhausted, the next reader.read() blocks (parks) until one
 * of: `pushChunk(s)`, `closeCleanly()`, or `abortBody()`. `abortBody()`
 * causes the pending reader.read() to reject with DOMException
 * AbortError — exactly what happens in the real bug when ChatGPT OAuth
 * keeps the body open past response.completed and the outer controller
 * fires abort().
 */
function makeControllableSseResponse(initialChunks = []) {
  const encoder = new TextEncoder();
  const queue = initialChunks.map((s) => encoder.encode(s));
  let closed = false;
  let aborted = false;
  const waiters = [];
  const stream = new ReadableStream({
    pull(controller) {
      if (aborted) {
        controller.error(new DOMException('aborted', 'AbortError'));
        return;
      }
      if (closed) {
        controller.close();
        return;
      }
      if (queue.length > 0) {
        const next = queue.shift();
        controller.enqueue(next);
        return;
      }
      // No data available and not closed/aborted — block until the test
      // drives the next state transition.
      return new Promise((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
    },
    cancel() {
      aborted = true;
      for (const w of waiters.splice(0)) w.reject(new DOMException('aborted', 'AbortError'));
    },
  });
  const response = new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
  function pushChunk(s) {
    queue.push(encoder.encode(s));
    if (waiters.length > 0) {
      const w = waiters.shift();
      w.resolve();
    }
  }
  function closeCleanly() {
    closed = true;
    while (waiters.length > 0) {
      const w = waiters.shift();
      w.resolve();
    }
  }
  function abortBody() {
    aborted = true;
    while (waiters.length > 0) {
      const w = waiters.shift();
      w.reject(new DOMException('aborted', 'AbortError'));
    }
  }
  return { response, pushChunk, closeCleanly, abortBody };
}

test('parseSseStream: post-response.completed AbortError does NOT throw "Codex request aborted."', async () => {
  // The fix's primary symptom: the model finishes, all deltas flushed,
  // response.completed event arrives — then ~30s later the outer
  // controller.abort() fires and the still-bound reader.read() rejects
  // with AbortError. We used to re-throw that as "Codex request aborted.";
  // now we swallow it and exit the generator cleanly.
  //
  // Drive parseSseStream directly (it's a static method on the class,
  // accessible at runtime via the compiled module even though TS marks
  // it private — privacy is compile-time only). This avoids needing
  // the full stream() happy-path with OAuth signing-in plumbing.
  const ctrl = makeControllableSseResponse([
    'data: {"type":"response.output_text.delta","delta":"Hello "}\n\n',
    'data: {"type":"response.output_text.delta","delta":"world"}\n\n',
    'data: {"type":"response.completed","response":{}}\n\n',
  ]);
  const collected = [];
  // parseSseStream(response, signal). TypeScript-private is erased at
  // compile time, so the .js export exposes the static method by name.
  const parseSseStream = mod.CodexCliService.parseSseStream;
  assert.equal(typeof parseSseStream, 'function', 'parseSseStream must be reachable as a static method');
  const gen = parseSseStream.call(mod.CodexCliService, ctrl.response, new AbortController().signal);
  const drain = (async () => {
    for await (const delta of gen) collected.push(delta);
    return collected;
  })();
  drain.catch(() => {}); // attach a no-op catch so any rejection isn't unhandled
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(collected.join(''), 'Hello world',
    'both deltas should be delivered before the post-completion abort');
  // Simulate the 30s-late cleanup.
  ctrl.abortBody();
  // Drain must complete WITHOUT throwing.
  const result = await drain;
  assert.deepEqual(result, ['Hello ', 'world'],
    'drain completed cleanly — no "Codex request aborted." thrown post-completion');
});

test('parseSseStream: pre-completion AbortError surfaces as "Codex request aborted."', async () => {
  // Regression guard — the OLD behavior (pre-completion abort surfaces as
  // "Codex request aborted.") must be preserved. Pre-completion aborts
  // are the IPC handler's signal that supersession / user-cancel
  // happened before any token was delivered, and the renderer's
  // fallback chain is the right path from there.
  //
  // We simulate "pre-completion abort" by aborting the body BEFORE any
  // terminal event arrives. The parser's reader.read() rejects with
  // AbortError, the catch converts it to "Codex request aborted.", and
  // the generator surfaces that error to the caller. Use a pre-aborted
  // AbortSignal as the parser's signal so the parser's own `if
  // (signal.aborted)` guard at line 610 fires — that's the canonical
  // "user-cancelled-before-any-token" path.
  const ctrl = makeControllableSseResponse([
    'data: {"type":"response.output_text.delta","delta":"Hi"}\n\n',
  ]);
  const parseSseStream = mod.CodexCliService.parseSseStream;
  // Pre-aborted signal — parser will throw on first iteration.
  const ac = new AbortController();
  ac.abort();
  const gen = parseSseStream.call(mod.CodexCliService, ctrl.response, ac.signal);
  const collected = [];
  const drainResult = (async () => {
    for await (const delta of gen) collected.push(delta);
    return { ok: true, collected };
  })().catch((e) => ({ ok: false, error: e }));
  const final = await drainResult;
  assert.equal(final.ok, false, 'pre-completion abort must surface as an error');
  assert.match(final.error.message, /Codex request aborted/,
    'pre-completion abort must throw "Codex request aborted." — preserves supersession / cancel path');
});

test('parseSseStream: response.incomplete is treated as terminal (post-completion AbortError swallowed)', async () => {
  // response.incomplete is a real Responses-API terminal — the model
  // declared it gave up (length cap, content filter, etc.) and the
  // deltas up to that point are the response. The post-completion
  // swallow must apply to it, too.
  const ctrl = makeControllableSseResponse([
    'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
    'data: {"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}\n\n',
  ]);
  const collected = [];
  const parseSseStream = mod.CodexCliService.parseSseStream;
  const gen = parseSseStream.call(mod.CodexCliService, ctrl.response, new AbortController().signal);
  const drain = (async () => {
    for await (const delta of gen) collected.push(delta);
    return collected;
  })();
  drain.catch(() => {});
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(collected.join(''), 'partial');
  ctrl.abortBody();
  const result = await drain;
  assert.deepEqual(result, ['partial']);
});

test('parseSseStream: response.failed with non-transient error SURFACES, not swallowed', async () => {
  // response.failed sets terminalError — even though sawTerminalEvent
  // is also true. The terminalError throw must win over the
  // post-completion swallow. This test pins the priority: a real
  // failure is more important than a benign cleanup.
  const ctrl = makeControllableSseResponse([
    'data: {"type":"response.output_text.delta","delta":"oops"}\n\n',
    'data: {"type":"response.failed","response":{"error":{"message":"upstream model error"}}}\n\n',
  ]);
  let caughtError = null;
  const parseSseStream = mod.CodexCliService.parseSseStream;
  const gen = parseSseStream.call(mod.CodexCliService, ctrl.response, new AbortController().signal);
  const drain = (async () => {
    // eslint-disable-next-line no-unused-vars
    for await (const _ of gen) { /* drain */ }
  })();
  drain.catch((e) => { caughtError = e; });
  await new Promise((r) => setTimeout(r, 30));
  try {
    await drain;
  } catch (e) {
    caughtError = e;
  }
  assert.ok(caughtError, 'response.failed with non-transient error must throw');
  assert.match(caughtError.message, /upstream model error/,
    'response.failed error message must surface verbatim');
});

test('parseSseStream: source uses reader.cancel() (NOT releaseLock) in finally — fix pin', () => {
  // Source-level pin to catch any refactor that reverts the fix.
  //
  // ANCHOR STRATEGY: search for the unique signature of parseSseStream
  // (the only static method in the file with that exact name), then
  // from there find the parseSseStream-scoped `} finally {` block.
  // We do NOT use `source.indexOf('} finally {')` because that's the
  // first occurrence in the file (which is stream()'s finally at line
  // ~327), and a refactor that moved reader.cancel() there but removed
  // it from parseSseStream's finally would silently pass a fragile
  // anchor on the wrong finally block.
  //
  // Inside parseSseStream's finally block:
  //   - reader.cancel() MUST appear (actively tears down the HTTP body)
  //   - reader.releaseLock() MUST NOT appear (releases the lock but
  //     leaves the body open on the server)
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../../electron/services/CodexCliService.ts'),
    'utf8',
  );
  const parseSseIdx = source.indexOf('parseSseStream(response: Response, signal: AbortSignal)');
  assert.ok(parseSseIdx > 0,
    'parseSseStream method signature must still exist in CodexCliService.ts');
  const afterMethodStart = source.slice(parseSseIdx);
  const finallyIdx = afterMethodStart.indexOf('} finally {');
  assert.ok(finallyIdx > 0,
    'parseSseStream must still have a `} finally {` block after the catch that swallows the post-completion AbortError');
  // parseSseStream is the LAST method in the class — slice to EOF
  // captures only this method's body, no dilution from later code.
  const finallySlice = afterMethodStart.slice(finallyIdx);
  assert.match(finallySlice, /reader\.cancel\(\)/,
    'parseSseStream\'s finally must call reader.cancel() — fix for the 30s post-completion abort');
  assert.doesNotMatch(finallySlice, /reader\.releaseLock\(\)/,
    'parseSseStream\'s finally must NOT call reader.releaseLock() — releases the lock but leaves the body open on the server');
});

test('parseSseStream: clean close (done: true without response.completed) — drain completes cleanly', async () => {
  // Pins the new `done: true → sawTerminalEvent = true` behavior
  // introduced in commit 05db8ca. Unlike the earlier post-terminal-event
  // test, AbortError CANNOT be injected after closeCleanly() — the
  // parser loop has already exited, there is no pending reader.read()
  // for an abort to reject. So this test asserts what is actually
  // falsifiable: the clean-close path delivers all queued deltas and
  // returns without throwing.
  //
  // HONEST CAVEAT (per senior code-review of 05db8ca): the original
  // commit message described a causal chain ("done:true then AbortError
  // from controller.abort") that JS event-loop semantics don't permit —
  // once reader.read() resolves with done:true, there is no further
  // pending read() to be rejected. This test therefore cannot prove
  // the user's specific live-log scenario is fixed; the companion
  // source-pin test at the bottom of this file pins the structural
  // change that commit 05db8ca made.
  //
  // Regression guard for the second flavor of the user's bug. The
  // first fix (commit 250ac39) only swallowed AbortError AFTER the
  // parser saw response.completed / .incomplete / .failed. But
  // chatgpt.com sometimes CLOSES the body cleanly (`done: true`) AFTER
  // the final delta WITHOUT emitting a response.completed event — the
  // user observed this exact pattern in live logs (21107ms first
  // call succeeded cleanly, then a follow-up supersession triggered
  // AbortError on the completed stream).
  //
  // Without THIS fix, `done: true` exits the parser loop without
  // setting sawTerminalEvent, and any AbortError that fires AFTER the
  // clean close (e.g., from a subsequent controller.abort()) hits
  // the catch with sawTerminalEvent=false and propagates as
  // "Codex request aborted." even though the response was delivered
  // in full.
  const ctrl = makeControllableSseResponse([
    'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
    'data: {"type":"response.output_text.delta","delta":" world"}\n\n',
  ]);
  const parseSseStream = mod.CodexCliService.parseSseStream;
  const collected = [];
  const gen = parseSseStream.call(mod.CodexCliService, ctrl.response, new AbortController().signal);
  const drain = (async () => {
    for await (const delta of gen) collected.push(delta);
    return collected;
  })().catch((e) => ({ thrown: true, error: e }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(collected.join(''), 'Hello world',
    'both deltas should deliver before the body closes');
  ctrl.closeCleanly();
  const result = await drain;
  assert.ok(!result?.thrown,
    `clean close (done: true, no response.completed) must NOT throw — got ${JSON.stringify(result)}`);
  assert.deepEqual(result, ['Hello', ' world'],
    'all deltas must survive a clean close path');
});

test('parseSseStream: reader.read() AbortError mid-stream (no terminal event yet) surfaces "Codex request aborted."', async () => {
  // Regression guard for the OTHER half of the catch's predicate: the
  // pre-completion surface. Test #2 covers the `if (signal.aborted)`
  // guard at line 620 (signal-driven abort). THIS test covers the
  // `await reader.read()` rejection path — what fires when the user's
  // outer controller.abort() reaches the still-parked SSE reader
  // BEFORE any response.completed is seen.
  //
  // The original "Codex is answering fast, but after 30s it says
  // request aborted" bug was the inverse (abort AFTER response.completed
  // was swallowed). This test pins the symmetrical guard: an abort
  // that arrives BEFORE the terminal event must STILL surface as
  // "Codex request aborted." so the IPC handler's supersession path
  // continues to work.
  const ctrl = makeControllableSseResponse([
    'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
  ]);
  const parseSseStream = mod.CodexCliService.parseSseStream;
  const collected = [];
  const gen = parseSseStream.call(mod.CodexCliService, ctrl.response, new AbortController().signal);
  const drain = (async () => {
    for await (const delta of gen) collected.push(delta);
    return collected;
  })().catch((e) => ({ ok: false, error: e }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(collected.join(''), 'Hello',
    'first delta should deliver before the abort fires');
  // Abort the body BEFORE any terminal event has been pushed.
  ctrl.abortBody();
  const result = await drain;
  assert.equal(result.ok, false,
    'mid-stream AbortError (no terminal event yet) MUST surface as an error');
  assert.match(result.error.message, /Codex request aborted/,
    'mid-stream abort must produce exactly "Codex request aborted." — preserves the supersession/cancel surface');
});

test('parseSseStream: stream emits :keepalive comment after response.completed (high-fidelity chatgpt.com simulation)', async () => {
  // The real ChatGPT OAuth backend sends `:keepalive` SSE comments
  // every few seconds for ~30s after response.completed. The parser
  // must ignore the keepalive (parses, sets sawTerminalEvent on the
  // preceding response.completed, breaks the loop) and continue to
  // swallow the late AbortError. This is the EXACT byte sequence the
  // user-observed bug produces.
  const ctrl = makeControllableSseResponse([
    'data: {"type":"response.output_text.delta","delta":"partial "}\n\n',
    'data: {"type":"response.output_text.delta","delta":"answer"}\n\n',
    'data: {"type":"response.completed","response":{}}\n\n',
    ':keepalive-1\n\n',
    ':keepalive-2\n\n',
  ]);
  const parseSseStream = mod.CodexCliService.parseSseStream;
  const collected = [];
  const gen = parseSseStream.call(mod.CodexCliService, ctrl.response, new AbortController().signal);
  const drain = (async () => {
    for await (const delta of gen) collected.push(delta);
    return collected;
  })();
  drain.catch(() => {}); // attach a no-op catch to absorb unhandled-rejection warnings
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(collected.join(''), 'partial answer',
    'deltas and the response.completed terminal event must yield BEFORE the keepalive lines');
  // Simulate the 30s-late controller.abort() that hits the
  // still-open body. Even with two :keepalive lines already in flight,
  // the parser must stay silent on the post-completion AbortError.
  ctrl.abortBody();
  const result = await drain;
  assert.deepEqual(result, ['partial ', 'answer'],
    'drain completed cleanly with :keepalive lines in the stream — no "Codex request aborted." thrown');
});

test('parseSseStream: source-pin — done: true sets sawTerminalEvent=true (commit 05db8ca)', () => {
  // Falsifiable source-pin for the `done: true → sawTerminalEvent = true`
  // change introduced in commit 05db8ca. This is the ONLY test that
  // catches a revert of the source change — the behavioral test above
  // (clean close path) would pass even with the revert because the
  // clean close path was already not throwing; the structural change
  // is what enables any future AbortError fired via a different code
  // path (e.g., async reader cancellation during unwinding) to be
  // correctly classified as post-completion cleanup.
  //
  // See senior code-review of 05db8ca for the analysis that prompted
  // this pin.
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../../electron/services/CodexCliService.ts'),
    'utf8',
  );
  const parseSseIdx = source.indexOf('parseSseStream(response: Response, signal: AbortSignal)');
  assert.ok(parseSseIdx > 0,
    'parseSseStream method signature must still exist in CodexCliService.ts');
  const methodBody = source.slice(parseSseIdx);
  // Locate the 'if (done)' branch that handles clean body close.
  // Find the first `if (done)` AFTER the parser's `signal.aborted` check.
  const signalAbortIdx = methodBody.indexOf("if (signal.aborted)");
  assert.ok(signalAbortIdx > 0, 'signal.aborted guard must still exist');
  const afterSignalAbort = methodBody.slice(signalAbortIdx);
  const doneBranchIdx = afterSignalAbort.search(/if\s*\(\s*done\s*\)/);
  assert.ok(doneBranchIdx > 0, '`if (done)` branch must still exist in parseSseStream');
  // 800 chars is enough to span the entire `if (done) { ... break; }` block
  // including the sawTerminalEvent assignment, multi-line comment, and break.
  const doneBranchSnippet = afterSignalAbort.slice(doneBranchIdx, doneBranchIdx + 800);
  assert.match(doneBranchSnippet, /sawTerminalEvent\s*=\s*true/,
    '`if (done)` branch must set sawTerminalEvent = true so the catch swallows post-clean-close aborts — commit 05db8ca fix');
});

// =============================================================================
// Idle-timeout: the deadlineTimer RESETS on every delta (wall-clock fix)
// =============================================================================
//
// Root cause of the production "Codex request aborted." bug (2026-07-01):
// The user had codexCliTimeoutMs=30000 persisted. The first call completed
// in <30s; the second call (larger sysPrompt, reasoning model) took >30s
// total. The old code started a setTimeout(30s) at stream() entry and
// NEVER reset it — so even a healthy streaming response was guillotined
// at the 30s wall-clock mark. The fix converts the timer to an IDLE timer
// that resets on every yielded delta. This source-pin verifies the fix.

test('stream(): source uses resetDeadline() on each yielded delta — idle-timer fix pin', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../../electron/services/CodexCliService.ts'),
    'utf8',
  );
  // stream() starts with `public static async *stream(`
  const streamMethodIdx = source.indexOf('public static async *stream(');
  assert.ok(streamMethodIdx > 0, 'stream() method must still exist in CodexCliService.ts');
  // 3000 chars: enough to span the full method body including the for-await loop.
  const streamBody = source.slice(streamMethodIdx, streamMethodIdx + 3000);

  // The fix: resetDeadline must be defined and called inside the for-await loop.
  assert.match(streamBody, /resetDeadline\s*=\s*\(\)\s*=>/,
    'stream() must define resetDeadline as an idle-timer reset function');
  assert.match(streamBody, /resetDeadline\(\)/,
    'stream() must call resetDeadline() — idle-timer must reset on each delta (wall-clock abort fix)');

  // resetDeadline must be called inside the `for await` loop, before/alongside yield delta.
  const forAwaitIdx = streamBody.indexOf('for await (const delta of deltas)');
  assert.ok(forAwaitIdx > 0, 'stream() must still have a `for await` loop over deltas');
  const loopBody = streamBody.slice(forAwaitIdx, forAwaitIdx + 200);
  assert.match(loopBody, /resetDeadline\(\)/,
    'resetDeadline() must be called inside the for-await loop body — not outside it');
});

