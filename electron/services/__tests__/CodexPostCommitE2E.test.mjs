// electron/services/__tests__/CodexPostCommitE2E.test.mjs
//
// POST-COMMIT end-to-end verification of the 7 codex CLI fixes (commit 9da85ee).
// Spawns ACTUAL mock codex binaries (child_process.spawn) that behave like
// the real codex CLI in several scenarios: cold start, error event, full
// event stream, image passthrough, and per-model reasoning downgrade.
//
// Each mock writes its argv to a tmp file so we can prove the wire-level
// contract — what flags CodexCliService actually emits to the codex binary.
//
// Run: npm run build:electron && node --test electron/services/__tests__/CodexPostCommitE2E.test.mjs

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compiledPath = path.resolve(__dirname, '../../../dist-electron/electron/services/CodexCliService.js');
const mod = await import(pathToFileURL(compiledPath).href);
const { CodexCliService } = mod;

// Tmp paths for the mock binaries + their argv log.
const PID = process.pid;
const ARGV_LOG = path.join(os.tmpdir(), `codex-postcommit-argv-${PID}.log`);

const MOCK_SLOW_8S_BIN     = path.join(os.tmpdir(), `codex-postcommit-slow8-${PID}.sh`);
const MOCK_IMAGE_BIN       = path.join(os.tmpdir(), `codex-postcommit-image-${PID}.sh`);
const MOCK_ERROR_BIN       = path.join(os.tmpdir(), `codex-postcommit-error-${PID}.sh`);
const MOCK_FULLSTREAM_BIN  = path.join(os.tmpdir(), `codex-postcommit-fullstream-${PID}.sh`);
const MOCK_ARGV_BIN        = path.join(os.tmpdir(), `codex-postcommit-argv-${PID}.sh`);

before(() => {
  // A) Slow codex — sleeps 8s then emits one delta + completed. Proves
  //    the codex service timeout (60_000 default) is independent of the
  //    7s cloud / 30s local live-deadline at ipcHandlers.ts:1402.
  fs.writeFileSync(MOCK_SLOW_8S_BIN, `#!/bin/sh
# Write argv to log (per-arg line).
i=0
for a in "$@"; do
  i=$((i+1))
  echo "ARG$i=$a" >> '${ARGV_LOG}'
done
sleep 8
printf '%s\\n' '{"type":"agent_message.delta","delta":"survived 8s cold start"}'
printf '%s\\n' '{"type":"turn.completed"}'
`, { mode: 0o755 });

  // B) Image-passthrough codex — captures argv, emits a tiny stream.
  fs.writeFileSync(MOCK_IMAGE_BIN, `#!/bin/sh
i=0
for a in "$@"; do
  i=$((i+1))
  echo "ARG$i=$a" >> '${ARGV_LOG}'
done
printf '%s\\n' '{"type":"agent_message.delta","delta":"ok"}'
printf '%s\\n' '{"type":"turn.completed"}'
`, { mode: 0o755 });

  // C) Error-event codex — emits a real codex error with a distinctive
  //    message; tests regression of "Let me come back to that".
  fs.writeFileSync(MOCK_ERROR_BIN, `#!/bin/sh
printf '%s\\n' '{"type":"thread.started","thread_id":"e-1"}'
printf '%s\\n' '{"type":"error","message":"custom codex failure 0xBEEF: model not supported for this account"}'
printf '%s\\n' '{"type":"turn.failed"}'
exit 0
`, { mode: 0o755 });

  // D) Full-stream codex — emits the realistic NDJSON event stream
  //    (thread.started + 4 deltas + completed), proves the happy path
  //    end-to-end (the stream() async generator yields concatenated text).
  // Note: CodexCliService.extractText trims each delta, so we use
  //    trailing-words (no internal spaces) to verify the join order.
  fs.writeFileSync(MOCK_FULLSTREAM_BIN, `#!/bin/sh
printf '%s\\n' '{"type":"thread.started","thread_id":"fs-1"}'
printf '%s\\n' '{"type":"turn.started"}'
printf '%s\\n' '{"type":"agent_message.delta","delta":"Codex"}'
printf '%s\\n' '{"type":"agent_message.delta","delta":"live"}'
printf '%s\\n' '{"type":"agent_message.delta","delta":"verification"}'
printf '%s\\n' '{"type":"agent_message.delta","delta":"works"}'
printf '%s\\n' '{"type":"turn.completed"}'
`, { mode: 0o755 });

  // G) Argv-only capture mock — no NDJSON output, just records argv.
  //    Used for the smoking-gun wire-level reasoning-effort test.
  fs.writeFileSync(MOCK_ARGV_BIN, `#!/bin/sh
i=0
for a in "$@"; do
  i=$((i+1))
  echo "ARG$i=$a" >> '${ARGV_LOG}'
done
`, { mode: 0o755 });
});

after(() => {
  for (const p of [MOCK_SLOW_8S_BIN, MOCK_IMAGE_BIN, MOCK_ERROR_BIN, MOCK_FULLSTREAM_BIN, MOCK_ARGV_BIN]) {
    try { fs.unlinkSync(p); } catch {}
  }
  try { fs.unlinkSync(ARGV_LOG); } catch {}
});

beforeEach(() => {
  try { fs.unlinkSync(ARGV_LOG); } catch {}
});

// ─── A. Slow cold-start mock (8s pre-token delay) ────────────────────────────
test('A: 8s cold-start mock survives a 60_000ms service timeout (Codex service deadline is independent of live-deadline)', async () => {
  const t0 = Date.now();
  const text = await CodexCliService.run(MOCK_SLOW_8S_BIN, {
    prompt: 'hi', model: 'gpt-5.4', timeoutMs: 60_000,
  });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 7500, `should wait the full 8s pre-token delay (was ${elapsed}ms)`);
  assert.ok(elapsed < 30_000, `should complete well under the 60s service timeout (was ${elapsed}ms)`);
  assert.match(text, /survived 8s cold start/);
});

// ─── B. Image passthrough ────────────────────────────────────────────────────
test('B: --image <path> flag is emitted for EACH image in imagePaths', async () => {
  try {
    await CodexCliService.run(MOCK_IMAGE_BIN, {
      prompt: 'describe', model: 'gpt-5.4', timeoutMs: 5_000,
      imagePaths: ['/tmp/x.png', '/tmp/y.png'],
    });
  } catch { /* may throw if mock doesn't emit agent_message; that's fine */ }
  const argv = fs.readFileSync(ARGV_LOG, 'utf8');
  const imageCount = (argv.match(/--image/g) || []).length;
  assert.equal(imageCount, 2, 'should emit --image twice for two image paths');
  // The argv log is one arg per line, so --image and its path land on
  // separate lines. We assert they're consecutive ARG entries.
  assert.match(argv, /ARG10=--image\nARG11=\/tmp\/x\.png/, '--image /tmp/x.png must be consecutive args');
  assert.match(argv, /ARG12=--image\nARG13=\/tmp\/y\.png/, '--image /tmp/y.png must be consecutive args');
});

// ─── C. Real error message surfaces (regression of canned fallback) ──────────
test('C: real codex error message reaches the caller (not the canned fallback)', async () => {
  let runErr = null;
  try {
    await CodexCliService.run(MOCK_ERROR_BIN, {
      prompt: 'hi', model: 'gpt-5.4', timeoutMs: 5_000,
    });
  } catch (e) { runErr = e; }
  assert.ok(runErr, 'run() should throw on a codex error event');
  assert.match(
    runErr.message,
    /0xBEEF/,
    'run() error must carry the REAL codex message, not the canned fallback. Got: ' + runErr.message,
  );
  assert.doesNotMatch(
    runErr.message,
    /empty response/i,
    'must NOT be the canned "empty response" fallback',
  );

  let streamErr = null;
  try {
    for await (const _ of CodexCliService.stream(MOCK_ERROR_BIN, {
      prompt: 'hi', model: 'gpt-5.4', timeoutMs: 5_000,
    })) { /* drain */ }
  } catch (e) { streamErr = e; }
  assert.ok(streamErr, 'stream() should throw on a codex error event');
  assert.match(
    streamErr.message,
    /0xBEEF/,
    'stream() error must carry the REAL codex message, not the canned fallback. Got: ' + streamErr.message,
  );
});

// ─── D. Full NDJSON event stream happy path ──────────────────────────────────
test('D: full agent_message.delta stream yields the concatenated text via stream()', async () => {
  const chunks = [];
  for await (const chunk of CodexCliService.stream(MOCK_FULLSTREAM_BIN, {
    prompt: 'hi', model: 'gpt-5.4', timeoutMs: 5_000,
  })) {
    chunks.push(chunk);
  }
  const joined = chunks.join('');
  // 4 deltas in the mock → 4 yields. The exact chunk-split is an
  // implementation detail of the line-buffer loop; what matters is that
  // the concatenation recovers the full text in order. extractText trims
  // each delta, so trailing/internal whitespace inside individual deltas
  // is lost — we assert on the stripped concatenation.
  assert.ok(joined.startsWith('Codex'), `expected start with "Codex" in ${JSON.stringify(joined)}`);
  assert.ok(joined.includes('live'), `expected "live" in ${JSON.stringify(joined)}`);
  assert.ok(joined.includes('verification'), `expected "verification" in ${JSON.stringify(joined)}`);
  assert.ok(joined.endsWith('works'), `expected end with "works" in ${JSON.stringify(joined)}`);
  // Concatenation order matters: all 4 deltas in the order they were emitted.
  assert.equal(joined, 'Codexliveverificationworks',
    `expected exact concatenation of all 4 deltas, got ${JSON.stringify(joined)}`);
});

// ─── E. Source-level: usingLocalLlm includes isUsingCodexCli() ───────────────
test('E: source-level — usingLocalLlm in ipcHandlers includes isUsingCodexCli() (30s deadline fix)', () => {
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

// ─── F. Source-level: both fastModeApplies gates exclude codex-cli: picks ────
test('F: source-level — fastModeApplies AND fastModeAppliesNS both contain !isCodexCliModel(currentModelId) (Issue #315)', () => {
  const llmHelperSrc = fs.readFileSync(
    path.resolve(__dirname, '../../../electron/LLMHelper.ts'),
    'utf8',
  );
  const nsMatch = llmHelperSrc.match(/const fastModeAppliesNS\s*=[\s\S]*?(?=\s*;)/);
  const sMatch  = llmHelperSrc.match(/const fastModeApplies\s*=[\s\S]*?(?=\s*;)/);
  assert.ok(nsMatch, 'fastModeAppliesNS declaration must exist in LLMHelper.ts');
  assert.ok(sMatch,  'fastModeApplies declaration must exist in LLMHelper.ts');
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

// ─── G. Wire-level: resolver downgrade reaches the spawn argv ────────────────
test('G.1: gpt-5.4 + xhigh → wire carries -c model_reasoning_effort="xhigh" (no downgrade for 5.4)', async () => {
  try {
    await CodexCliService.run(MOCK_ARGV_BIN, {
      prompt: 'hi', model: 'gpt-5.4', timeoutMs: 5_000,
      modelReasoningEffort: 'xhigh',
    });
  } catch { /* mock has no NDJSON → run() throws "empty response", expected */ }
  const argv = fs.readFileSync(ARGV_LOG, 'utf8');
  assert.match(argv, /-c/, 'should emit the -c flag');
  assert.match(argv, /model_reasoning_effort="xhigh"/,
    'gpt-5.4 + xhigh should pass through unchanged on the wire');
  assert.doesNotMatch(argv, /model_reasoning_effort="low"/,
    'must NOT downgrade xhigh for gpt-5.4 (it accepts xhigh)');
});

test('G.2: gpt-5.3-codex + xhigh → resolver downgrades to "low" on the wire (smoking-gun)', async () => {
  try {
    await CodexCliService.run(MOCK_ARGV_BIN, {
      prompt: 'hi', model: 'gpt-5.3-codex', timeoutMs: 5_000,
      modelReasoningEffort: 'xhigh',
    });
  } catch { /* expected */ }
  const argv = fs.readFileSync(ARGV_LOG, 'utf8');
  assert.match(argv, /model_reasoning_effort="low"/,
    'gpt-5.3-codex does NOT accept xhigh → wire MUST carry downgraded "low"');
  assert.doesNotMatch(argv, /model_reasoning_effort="xhigh"/,
    'must NOT carry xhigh for gpt-5.3-codex (the binary would reject it)');
});

test('G.3: gpt-5-codex + none → resolver downgrades to "low" (codex variants reject "none")', async () => {
  try {
    await CodexCliService.run(MOCK_ARGV_BIN, {
      prompt: 'hi', model: 'gpt-5-codex', timeoutMs: 5_000,
      modelReasoningEffort: 'none',
    });
  } catch { /* expected */ }
  const argv = fs.readFileSync(ARGV_LOG, 'utf8');
  assert.match(argv, /model_reasoning_effort="low"/,
    'gpt-5-codex does NOT accept "none" → wire MUST carry downgraded "low"');
  assert.doesNotMatch(argv, /model_reasoning_effort="none"/,
    'must NOT carry "none" for gpt-5-codex (the binary would reject it)');
});
