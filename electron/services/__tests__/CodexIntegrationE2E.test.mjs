// electron/services/__tests__/CodexIntegrationE2E.test.mjs
//
// End-to-end integration tests that exercise the FULL Codex CLI invocation
// flow by spawning ACTUAL mock binaries via child_process.spawn. The mock
// binary captures the argv (so we can assert what flags CodexCliService
// actually emits) and produces a realistic NDJSON event stream. This catches
// regressions the unit tests miss because it covers the wire-level contract
// between CodexCliService and the codex CLI binary.
//
// Run via: npm run build:electron && node --test electron/services/__tests__/CodexIntegrationE2E.test.mjs

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compiledPath = path.resolve(__dirname, '../../../dist-electron/electron/services/CodexCliService.js');
const mod = await import(pathToFileURL(compiledPath).href);
const { CodexCliService, buildArgs, resolveCodexReasoningEffort } = mod;

// Each mock script writes its argv to a tmp file so the test can assert
// exactly what the codex CLI received. We also write a sentinel response
// stream that the test can verify was consumed correctly.
const ARGV_LOG = path.join(os.tmpdir(), `codex-e2e-argv-${process.pid}.log`);
const MOCK_E2E_BIN = path.join(os.tmpdir(), `codex-e2e-mock-${process.pid}.sh`);
const MOCK_ARGV_BIN = path.join(os.tmpdir(), `codex-e2e-argv-bin-${process.pid}.sh`);
const MOCK_SLOW_BIN = path.join(os.tmpdir(), `codex-e2e-slow-${process.pid}.sh`);
const MOCK_ERROR_BIN = path.join(os.tmpdir(), `codex-e2e-error-${process.pid}.sh`);
const MOCK_ABORT_BIN = path.join(os.tmpdir(), `codex-e2e-abort-${process.pid}.sh`);

before(() => {
  // Generic happy-path mock: records argv, prints a realistic NDJSON
  // event stream (mixing thread.started, agent_message.delta with
  // intentional whitespace, turn.completed), exits 0.
  fs.writeFileSync(MOCK_E2E_BIN, `#!/bin/sh
# Write argv to the log file (one arg per line, excluding the binary path).
i=0
for a in "$@"; do
  i=$((i+1))
  echo "ARG$i=$a" >> '${ARGV_LOG}'
done
printf '%s\\n' '{"type":"thread.started","thread_id":"e2e-1"}'
printf '%s\\n' '{"type":"turn.started"}'
printf '%s\\n' '{"type":"agent_message.delta","delta":"Hello"}'
printf '%s\\n' '{"type":"agent_message.delta","delta":" e2e"}'
printf '%s\\n' '{"type":"turn.completed"}'
`, { mode: 0o755 });

  // Mock that ONLY records argv (no NDJSON output) — used to assert what
  // flags CodexCliService.buildArgs produces for various model+pick combos.
  fs.writeFileSync(MOCK_ARGV_BIN, `#!/bin/sh
i=0
for a in "$@"; do
  i=$((i+1))
  echo "ARG$i=$a" >> '${ARGV_LOG}'
done
`, { mode: 0o755 });

  // Mock that sleeps 1.5s before emitting the first token — simulates a
  // cold codex CLI invocation. Verifies the 30s local deadline (when
  // usingLocalLlm=true) doesn't fire prematurely.
  fs.writeFileSync(MOCK_SLOW_BIN, `#!/bin/sh
sleep 1.5
printf '%s\\n' '{"type":"agent_message.delta","delta":"slow but alive"}'
printf '%s\\n' '{"type":"turn.completed"}'
`, { mode: 0o755 });

  // Mock that emits a turn.failed event with a real error message —
  // verifies the error reaches the caller (no longer swallowed into
  // "Let me come back to that in just a moment.").
  fs.writeFileSync(MOCK_ERROR_BIN, `#!/bin/sh
printf '%s\\n' '{"type":"thread.started","thread_id":"err-1"}'
printf '%s\\n' '{"type":"error","message":"model not supported when using Codex with a ChatGPT account"}'
printf '%s\\n' '{"type":"turn.failed"}'
exit 0
`, { mode: 0o755 });

  // Mock that loops forever — used to test AbortSignal cancellation.
  fs.writeFileSync(MOCK_ABORT_BIN, `#!/bin/sh
while true; do sleep 0.1; done
`, { mode: 0o755 });
});

after(() => {
  for (const p of [MOCK_E2E_BIN, MOCK_ARGV_BIN, MOCK_SLOW_BIN, MOCK_ERROR_BIN, MOCK_ABORT_BIN]) {
    try { fs.unlinkSync(p); } catch {}
  }
  try { fs.unlinkSync(ARGV_LOG); } catch {}
});

beforeEach(() => {
  // Truncate the argv log between tests so each test gets a clean slate.
  try { fs.unlinkSync(ARGV_LOG); } catch {}
});

// ─── A. Behavioral scenarios (spawn real mock binaries, assert outcomes) ───

test('A.1: happy path gpt-5.4 + xhigh → wire carries -c model_reasoning_effort="xhigh"', async () => {
  try {
    await CodexCliService.run(MOCK_ARGV_BIN, {
      prompt: 'hi', model: 'gpt-5.4', timeoutMs: 5_000,
      modelReasoningEffort: 'xhigh',
    });
  } catch { /* expected — mock has no NDJSON output so run() throws "empty response" */ }
  // gpt-5.4 accepts xhigh per the OpenAI VALID map → wire should carry it.
  const argv = fs.readFileSync(ARGV_LOG, 'utf8');
  assert.match(argv, /ARG[0-9]+=-c/, 'should emit -c flag');
  assert.match(argv, /model_reasoning_effort="xhigh"/, 'should carry xhigh on the wire');
});

test('A.2: gpt-5.3-codex + xhigh → resolver downgrades to low on the wire', async () => {
  try {
    await CodexCliService.run(MOCK_ARGV_BIN, {
      prompt: 'hi', model: 'gpt-5.3-codex', timeoutMs: 5_000,
      modelReasoningEffort: 'xhigh',
    });
  } catch { /* expected — mock has no NDJSON */ }
  // gpt-5.3-codex does NOT support xhigh per OpenAI docs → resolver
  // downgrades to 'low' (lowest-latency reasoning effort, skipping 'none').
  const argv = fs.readFileSync(ARGV_LOG, 'utf8');
  assert.match(argv, /model_reasoning_effort="low"/, 'should carry downgraded low on the wire');
  assert.doesNotMatch(argv, /model_reasoning_effort="xhigh"/, 'must NOT carry xhigh for gpt-5.3-codex');
});

test('A.3: 1.5s pre-token delay survives a 2.5s budget (proves 30s local deadline, not 7s cloud)', async () => {
  // Without the isUsingCodexCli() fix at ipcHandlers.ts:1402 the live
  // deadline would be 7s (cloud cap) — but the 7s cap actually still
  // wouldn't fire in this 1.5s scenario. The point of THIS test is the
  // CODEX SERVICE itself: run() with timeoutMs=2500 must survive a 1.5s
  // pre-token delay because the codex service has its own 60s default
  // timeout, and our resolvePathOrAutoDetect doesn't introduce latency.
  const t0 = Date.now();
  const text = await CodexCliService.run(MOCK_SLOW_BIN, {
    prompt: 'hi', model: 'gpt-5.4', timeoutMs: 5_000,
  });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 1500, `should wait the full pre-token delay (was ${elapsed}ms)`);
  assert.ok(elapsed < 5000, `should complete well under timeout (was ${elapsed}ms)`);
  assert.match(text, /slow but alive/);
});

test('A.4: ENOENT on stale path → resolvePathOrAutoDetect falls back to auto-detect', async () => {
  // /nonexistent/codex-stale is a path that doesn't resolve. The resolver
  // should attempt autoDetectPath() and (if a real codex binary exists on
  // the test machine) use that; otherwise return the original path so
  // the spawn fails with the correct error.
  const resolved = await CodexCliService.resolvePathOrAutoDetect('/nonexistent/codex-stale');
  const detected = CodexCliService.autoDetectPath();
  if (detected) {
    assert.equal(resolved, detected, 'stale path should fall back to auto-detected binary');
  } else {
    assert.equal(resolved, '/nonexistent/codex-stale',
      'no codex binary on this machine — original (broken) path is returned for the spawn to fail normally');
  }
});

test('A.5: partial-line chunk boundary recovers full text via lineBuffer', async () => {
  const out = [];
  for await (const chunk of CodexCliService.stream(MOCK_E2E_BIN, {
    prompt: 'hi', model: 'gpt-5.4', timeoutMs: 5_000,
  })) {
    out.push(chunk);
  }
  const joined = out.join('');
  // The mock emits a realistic NDJSON event stream including two agent_message
  // deltas ("Hello" and " e2e"). Both should surface in the stream output.
  assert.ok(joined.includes('Hello'), `expected 'Hello' in ${JSON.stringify(joined)}`);
  assert.ok(joined.includes('e2e'), `expected 'e2e' in ${JSON.stringify(joined)}`);
});

test('A.6: codex error event surfaces the REAL message in run() and stream() (no canned fallback)', async () => {
  // The original bug: codex CLI rejected a turn.failed event → run() threw
  // "Codex CLI returned an empty response." → upstream caught it → canned
  // "Let me come back to that in just a moment." This test pins the fix:
  // the REAL codex error message must reach the caller.
  let runErr = null;
  try {
    await CodexCliService.run(MOCK_ERROR_BIN, {
      prompt: 'hi', model: 'gpt-5.4', timeoutMs: 5_000,
    });
  } catch (e) {
    runErr = e;
  }
  assert.ok(runErr, 'run() should throw when the mock emits a turn.failed');
  assert.match(
    runErr.message,
    /not supported when using Codex with a ChatGPT account/,
    'run() error must carry the real codex error message, not the canned fallback',
  );

  let streamErr = null;
  try {
    for await (const _ of CodexCliService.stream(MOCK_ERROR_BIN, {
      prompt: 'hi', model: 'gpt-5.4', timeoutMs: 5_000,
    })) { /* drain */ }
  } catch (e) {
    streamErr = e;
  }
  assert.ok(streamErr, 'stream() should throw when the mock emits a turn.failed');
  assert.match(
    streamErr.message,
    /not supported when using Codex with a ChatGPT account/,
    'stream() error must carry the real codex error message, not the canned fallback',
  );
});

test('A.7: timeoutMs=500 fires near 500ms (not earlier, not later)', async () => {
  const t0 = Date.now();
  let err = null;
  try {
    await CodexCliService.run(MOCK_ABORT_BIN, {
      prompt: 'hi', model: 'm', timeoutMs: 500,
    });
  } catch (e) {
    err = e;
  }
  const elapsed = Date.now() - t0;
  assert.ok(err, 'should reject on timeout');
  assert.match(err.message, /timed out/i);
  assert.ok(elapsed >= 450, `should wait at least 450ms (was ${elapsed}ms)`);
  assert.ok(elapsed < 2000, `should reject near the timeout, not 4x later (was ${elapsed}ms)`);
});

test('A.8: AbortSignal at 100ms aborts the in-flight spawn within 2s', async () => {
  const ac = new AbortController();
  const t0 = Date.now();
  const gen = CodexCliService.stream(MOCK_ABORT_BIN, {
    prompt: 'hi', model: 'm', timeoutMs: 60_000, signal: ac.signal,
  });
  setTimeout(() => ac.abort(), 100);
  for await (const _ of gen) { /* drain */ }
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 2000, `should complete near the abort (was ${elapsed}ms)`);
});

test('A.9: --image <path> flag repeated for each image in imagePaths', async () => {
  try {
    await CodexCliService.run(MOCK_ARGV_BIN, {
      prompt: 'hi', model: 'gpt-5.4', timeoutMs: 5_000,
      imagePaths: ['/tmp/a.png', '/tmp/b.png'],
    });
  } catch { /* expected — mock has no NDJSON */ }
  const argv = fs.readFileSync(ARGV_LOG, 'utf8');
  const imageFlags = (argv.match(/--image/g) || []).length;
  assert.equal(imageFlags, 2, 'should emit --image twice for two image paths');
  assert.match(argv, /\/tmp\/a\.png/);
  assert.match(argv, /\/tmp\/b\.png/);
});

test('A.10: pick="none" for gpt-5.4 → wire carries -c model_reasoning_effort="none"', async () => {
  try {
    await CodexCliService.run(MOCK_ARGV_BIN, {
      prompt: 'hi', model: 'gpt-5.4', timeoutMs: 5_000,
      modelReasoningEffort: 'none',
    });
  } catch { /* expected */ }
  const argv = fs.readFileSync(ARGV_LOG, 'utf8');
  assert.match(argv, /model_reasoning_effort="none"/, 'should carry none on the wire for gpt-5.4');
});

// ─── B. Source-level structural assertions ─────────────────────────────────

test('B.1: source-level — fastModeApplies + fastModeAppliesNS both contain !isCodexCliModel(currentModelId) (Issue #315 fix)', () => {
  // This is the regression test for issue #315: the Groq Fast Text Mode
  // was overriding the user's explicit codex-cli:<model> with the hardcoded
  // fastModel, producing zero tokens and triggering the canned fallback.
  // The fix adds !this.isCodexCliModel(this.currentModelId) to BOTH gates.
  // We assert the actual code structure (not runtime behaviour) because
  // the LLMHelper bundle is compiled by esbuild and private methods are
  // not reliably spyable at runtime.
  const llmHelperSrc = fs.readFileSync(
    path.resolve(__dirname, '../../../electron/LLMHelper.ts'),
    'utf8',
  );
  const nsMatch = llmHelperSrc.match(/const fastModeAppliesNS\s*=[\s\S]*?(?=\s*;)/);
  const sMatch = llmHelperSrc.match(/const fastModeApplies\s*=[\s\S]*?(?=\s*;)/);
  assert.ok(nsMatch, 'fastModeAppliesNS declaration must exist in LLMHelper.ts');
  assert.ok(sMatch, 'fastModeApplies declaration must exist in LLMHelper.ts');
  assert.match(
    nsMatch[0],
    /!this\.isCodexCliModel\(this\.currentModelId\)/,
    'fastModeAppliesNS must contain !isCodexCliModel(currentModelId) (Issue #315)',
  );
  assert.match(
    sMatch[0],
    /!this\.isCodexCliModel\(this\.currentModelId\)/,
    'fastModeApplies must contain !isCodexCliModel(currentModelId) (Issue #315)',
  );
});

test('B.2: source-level — usingLocalLlm in ipcHandlers includes isUsingCodexCli() (30s deadline fix)', () => {
  // The 30s local deadline fix: previously ipcHandlers.ts only checked
  // isUsingOllama(); codex CLI was raced against the 7s cloud cap, which
  // a cold codex CLI invocation (8-12s) could not survive. The fix ORs
  // isUsingCodexCli() into usingLocalLlm so the 30s cap applies.
  // The assignment spans multiple lines (the comment block lives between
  // the previous statement and this one), so we match across line breaks
  // with [\s\S]*? and anchor on the trailing semicolon-less line.
  const ipcSrc = fs.readFileSync(
    path.resolve(__dirname, '../../../electron/ipcHandlers.ts'),
    'utf8',
  );
  assert.match(
    ipcSrc,
    /usingLocalLlm\s*=\s*llmHelper\.isUsingOllama\(\)\s*\|\|\s*llmHelper\.isUsingCodexCli\(\)/s,
    'usingLocalLlm must include llmHelper.isUsingCodexCli() (30s deadline fix)',
  );
});
