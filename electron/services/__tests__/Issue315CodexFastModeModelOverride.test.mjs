// Regression test for issue #315: Groq Fast Text Mode overrides the user's
// explicitly selected Codex CLI model (e.g. codex-cli:gpt-5.4 → hardcoded
// gpt-5.3-codex via fastModel), producing zero tokens and triggering the canned
// "Let me come back to that in just a moment." fallback.
//
// Root cause: fastModeApplies / fastModeAppliesNS gated only on
// codexCliConfig.enabled, so any user with codex enabled was routed through the
// fast-mode codex path which calls getSelectedCodexCliModel(fastMode=true),
// unconditionally returning codexCliConfig.fastModel regardless of currentModelId.
//
// Fix: add !isCodexCliModel(currentModelId) to both gates so a user who
// explicitly picks a codex-cli:* model falls through to the explicit codex
// block (getSelectedCodexCliModel(false)) which honours the sub-model in
// currentModelId.
//
// These are source-level structural assertions (same pattern as
// Issue252WindowsAudioBanner.test.mjs) — the LLMHelper bundle is compiled by
// esbuild and private methods are not reliably spyable at runtime.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

const src = fs.readFileSync(path.join(root, 'electron/LLMHelper.ts'), 'utf8');

// Extract just the fastModeAppliesNS declaration (non-streaming path).
const nsMatch = src.match(/const fastModeAppliesNS\s*=[\s\S]*?(?=\s*;)/);
assert.ok(nsMatch, 'fastModeAppliesNS declaration must exist in LLMHelper.ts');
const nsDecl = nsMatch[0];

// Extract just the fastModeApplies declaration (streaming path).
const sMatch = src.match(/const fastModeApplies\s*=[\s\S]*?(?=\s*;)/);
assert.ok(sMatch, 'fastModeApplies declaration must exist in LLMHelper.ts');
const sDecl = sMatch[0];

test('issue #315: non-streaming fast-mode gate excludes codex-cli model selections', () => {
  assert.match(
    nsDecl,
    /!this\.isCodexCliModel\(this\.currentModelId\)/,
    'fastModeAppliesNS must contain !isCodexCliModel(currentModelId) to prevent fast-mode ' +
    'from overriding an explicitly selected codex-cli:* model with the hardcoded fastModel',
  );
});

test('issue #315: streaming fast-mode gate excludes codex-cli model selections', () => {
  assert.match(
    sDecl,
    /!this\.isCodexCliModel\(this\.currentModelId\)/,
    'fastModeApplies must contain !isCodexCliModel(currentModelId) to prevent fast-mode ' +
    'from overriding an explicitly selected codex-cli:* model with the hardcoded fastModel',
  );
});

test('issue #315: getSelectedCodexCliModel exists and handles fastMode=false with codex-cli: prefix', () => {
  // Verify the fix fallthrough target is still correct: getSelectedCodexCliModel(false)
  // with a "codex-cli:MODEL" id must extract MODEL (not return fastModel).
  const fnMatch = src.match(/private getSelectedCodexCliModel[\s\S]*?(?=\n  private |\n  public )/);
  assert.ok(fnMatch, 'getSelectedCodexCliModel must exist in LLMHelper.ts');
  const fnBody = fnMatch[0];
  // When fastMode=false and currentModelId starts with "codex-cli:", the function must
  // slice the prefix (not return fastModel). The correct pattern is slice("codex-cli:".length).
  assert.match(
    fnBody,
    /slice\("codex-cli:"\.length\)|slice\(10\)/,
    'getSelectedCodexCliModel must extract the sub-model from "codex-cli:MODEL" when fastMode=false',
  );
  // Confirm fastMode=true path returns fastModel (must still work for non-codex-selected users).
  assert.match(
    fnBody,
    /fastMode.*fastModel|if\s*\(fastMode\)/,
    'getSelectedCodexCliModel must still return fastModel when fastMode=true (used for non-codex-selected users)',
  );
});

test('issue #315: isCodexCliModel correctly identifies both bare and sub-model codex ids', () => {
  const fnMatch = src.match(/private isCodexCliModel[\s\S]*?(?=\n  private |\n  public )/);
  assert.ok(fnMatch, 'isCodexCliModel must exist in LLMHelper.ts');
  const fnBody = fnMatch[0];
  // Must match "codex-cli" exactly.
  assert.match(fnBody, /"codex-cli"/, 'isCodexCliModel must match the bare "codex-cli" model id');
  // Must match "codex-cli:" prefixed ids (codex-cli:gpt-5.4, codex-cli:gpt-5.5, etc.).
  assert.match(fnBody, /startsWith\("codex-cli:"\)/, 'isCodexCliModel must match "codex-cli:*" sub-model ids via startsWith');
});

test('issue #315: explicit codex block exists at fallthrough point in streaming path', () => {
  // After fast-mode is bypassed, the streaming path must have a block that fires for
  // isCodexCliModel + codexCliConfig.enabled and calls streamWithCodexCli.
  // This is the block that correctly calls getSelectedCodexCliModel(false).
  // The signature uses "public async * streamChat(" (space before *).
  const idx = src.search(/public async \* streamChat\(/);
  assert.notEqual(idx, -1, 'streamChat generator method must exist in LLMHelper.ts');
  const streamChatSection = src.slice(idx);
  assert.ok(
    streamChatSection.includes('isCodexCliModel(this.currentModelId)') &&
    streamChatSection.includes('streamWithCodexCli'),
    'streamChat must have an explicit codex-cli block after the fast-mode gate that calls streamWithCodexCli',
  );
});

test('issue #315: explicit codex block exists at fallthrough point in non-streaming path', () => {
  // Same check for chatWithGemini / non-streaming path.
  const chatSection = src.slice(src.indexOf('public async chatWithGemini('));
  assert.match(
    chatSection,
    /isCodexCliModel\(this\.currentModelId\)[\s\S]{0,200}generateWithCodexCli/,
    'chatWithGemini must have an explicit codex-cli block after the fast-mode gate that calls generateWithCodexCli',
  );
});
