// electron/services/__tests__/CodexIntegrationE2E.test.mjs
//
// Integration tests for the Codex request contract.
//
// HISTORY — READ THIS BEFORE ADDING A SPAWN TEST. The local CLI path is now the
// primary transport and the configured executable receives the generated
// `codex exec` argv. The empty-path HTTP helpers remain only for compatibility
// with older wire-format tests.
//
// The old A-section asserted `-c model_reasoning_effort="xhigh"` CLI flags that
// nothing emits any more. Rather than delete the coverage, the invariants that
// still exist were moved onto the surface that now carries them:
//
//   old A.1/A.2/A.10  reasoning effort on the wire  → body.reasoning.effort
//   old A.9           --image per image path        → input_image content items
//   old A.6           real error, not canned text   → extractCodexError()
//   old A.8           AbortSignal cancels           → pre-flight abort check
//
// The local CLI transport is covered by CodexLocalCliTransport.test.mjs and the
// A.8 argv/path assertion below.
//
// Every assertion here was verified against the real compiled service before
// being written — the effort downgrades and body shape are observed values, not
// assumed ones.
//
// Run via: npm run build:electron && node --test electron/services/__tests__/CodexIntegrationE2E.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compiledPath = path.resolve(__dirname, '../../../dist-electron/electron/services/CodexCliService.js');
const mod = await import(pathToFileURL(compiledPath).href);
const { CodexCliService, resolveCodexReasoningEffort } = mod;

// A 1x1 PNG. Small enough to stay well inside the raw-image floor/ceiling and
// real enough that the encoder produces a genuine data URL.
const ONE_PX_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

// ─── A. Request-contract scenarios (real service, no network) ───────────────

test('A.1: gpt-5.4 + xhigh → request body carries reasoning.effort "xhigh"', async () => {
  assert.equal(resolveCodexReasoningEffort('gpt-5.4', 'xhigh'), 'xhigh',
    'gpt-5.4 accepts xhigh per the OpenAI VALID map');
  const body = await CodexCliService.buildRequestBody({
    prompt: 'hi', model: 'gpt-5.4', modelReasoningEffort: 'xhigh',
  });
  assert.deepEqual(body.reasoning, { effort: 'xhigh', summary: 'auto' });
  // Non-'none' efforts must request the encrypted reasoning items, otherwise
  // the backend streams no reasoning at all and the effort is paid for nothing.
  assert.deepEqual(body.include, ['reasoning.encrypted_content']);
});

test('A.2: gpt-5.3-codex + xhigh → resolver downgrades to "low" (smoking gun)', async () => {
  // The codex-tuned variants reject xhigh. Sending it unchanged made the
  // backend reject the whole turn, which surfaced to the user as a generic
  // failure — this downgrade is what keeps the request valid.
  assert.equal(resolveCodexReasoningEffort('gpt-5.3-codex', 'xhigh'), 'low');
  const body = await CodexCliService.buildRequestBody({
    prompt: 'hi', model: 'gpt-5.3-codex', modelReasoningEffort: 'xhigh',
  });
  assert.equal(body.reasoning.effort, 'low', 'the downgraded value, not the requested one, reaches the wire');
});

test('A.3: gpt-5.4 + none → effort "none" and NO reasoning include', async () => {
  assert.equal(resolveCodexReasoningEffort('gpt-5.4', 'none'), 'none');
  const body = await CodexCliService.buildRequestBody({
    prompt: 'hi', model: 'gpt-5.4', modelReasoningEffort: 'none',
  });
  assert.equal(body.reasoning.effort, 'none');
  assert.equal(body.include, undefined,
    "'none' must not ask for reasoning.encrypted_content — there is no reasoning to return");
});

test('A.4: codex variants reject "none" too and fall back to "low"', async () => {
  // Same family rule as A.2 from the other end of the range: gpt-5-codex has no
  // 'none' tier, so an unguarded pass-through would be rejected by the backend.
  assert.equal(resolveCodexReasoningEffort('gpt-5-codex', 'none'), 'low');
});

test('A.5: each image path becomes its own input_image content item', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-img-'));
  const p1 = path.join(dir, 'a.png');
  const p2 = path.join(dir, 'b.png');
  fs.writeFileSync(p1, ONE_PX_PNG);
  fs.writeFileSync(p2, ONE_PX_PNG);
  try {
    const body = await CodexCliService.buildRequestBody({
      prompt: 'what is on screen?', model: 'gpt-5.4', imagePaths: [p1, p2],
    });
    const content = body.input[0].content;
    assert.deepEqual(
      content.map(c => c.type),
      ['input_text', 'input_image', 'input_image'],
      'the text prompt leads, then ONE input_image per attached path — a single ' +
      'merged image item would lose per-screenshot ordering',
    );
    assert.match(String(content[1].image_url), /^data:image\/[a-z]+;base64,/,
      'images travel as data URLs, not filesystem paths the backend cannot read');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('A.6: a real codex error message reaches the caller (not the canned fallback)', () => {
  // The regression this guards: the actionable backend message was swallowed and
  // replaced with "Let me come back to that in just a moment.", so a user whose
  // account cannot use the selected model had no idea why.
  const raw = [
    '{"type":"error","message":"model not supported when using Codex with a ChatGPT account"}',
    '{"type":"turn.failed"}',
  ].join('\n');
  assert.equal(
    CodexCliService.extractCodexError(raw),
    'model not supported when using Codex with a ChatGPT account',
  );
});

test('A.6b: agent_message deltas concatenate into the final text', () => {
  const raw = [
    '{"type":"agent_message.delta","delta":"Hello"}',
    '{"type":"agent_message.delta","delta":" e2e"}',
    '{"type":"turn.completed"}',
  ].join('\n');
  assert.equal(CodexCliService.extractText(raw), 'Hello e2e');
});

test('A.7: an already-aborted signal is refused before any auth or network work', async () => {
  // Ordering matters: the abort check sits ABOVE the signed-in check, so a
  // cancelled request reports cancellation rather than a misleading
  // "Not signed in to ChatGPT" for a user who is merely signed out AND cancelled.
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => CodexCliService.run('ignored-path', { prompt: 'hi', model: 'gpt-5.4', signal: ac.signal }),
    /aborted before start/,
  );
  await assert.rejects(
    async () => { for await (const _ of CodexCliService.stream('ignored-path', { prompt: 'hi', model: 'gpt-5.4', signal: ac.signal })) { /* drain */ } },
    /aborted before start/,
  );
});

test('A.8: the configured path reaches the local CLI and builds a complete exec command', () => {
  const args = CodexCliService.buildArgs('gpt-5.4', ['/tmp/x.png'], 'read-only', 'fast', 'xhigh');
  assert.equal(args[0], 'exec');
  assert.ok(args.includes('--model'));
  assert.ok(args.includes('gpt-5.4'));
  assert.ok(args.includes('--image'));
  assert.ok(args.includes('/tmp/x.png'));
  assert.ok(args.includes('service_tier="fast"'));
  const src = fs.readFileSync(
    path.resolve(__dirname, '../CodexCliService.ts'),
    'utf8',
  );
  assert.match(src, /spawn\(resolvedPath, args/,
    'the configured Codex executable must receive the generated exec argv');
  assert.match(src, /app-server/,
    'the same executable must provide model discovery through app-server');
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
