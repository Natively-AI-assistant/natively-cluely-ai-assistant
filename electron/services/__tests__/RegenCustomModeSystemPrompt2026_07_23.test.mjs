// Regression tests for the custom mode system-prompt re-injection on repair
// calls (root-cause fix, 2026-07-23).
//
// Root cause: every regen/repair prompt builder in ipcHandlers.ts (manual chat)
// and IntelligenceEngine.ts (WTA doc-grounded repair) passed `undefined` as
// the system prompt arg to streamChat. `skipModeInjection: true` was
// intentionally set so the regen wouldn't trigger a SECOND retrieval
// (strictPrompt already carries the retrieved excerpts inline), but that
// also silently dropped any custom-mode tone/scope/disclaimer instructions
// that WERE present on the initial generation — meaning a regen could come
// back without the persona the user configured. The fix threads the same
// custom-mode system-prompt layer LLMHelper._streamChatInner composes for
// the initial generation call (via the new shared
// appendCustomModeSystemPromptLayer helper) into the regen call sites
// without re-retrieving.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

// ---------------------------------------------------------------------------
// 1. appendCustomModeSystemPromptLayer exists and is exported from
//    documentGroundedPrompt.ts; its composition mirrors the initial-gen path.
// ---------------------------------------------------------------------------

test('documentGroundedPrompt: appendCustomModeSystemPromptLayer is exported', () => {
  const src = read('electron/llm/documentGroundedPrompt.ts');
  assert.match(
    src,
    /export function appendCustomModeSystemPromptLayer\(/,
    'appendCustomModeSystemPromptLayer must be exported so regen call sites can re-apply the custom-mode layer',
  );
});

test('documentGroundedPrompt: appendCustomModeSystemPromptLayer is idempotent when neither modePromptSuffix nor pinnedInstructions are present', () => {
  const src = read('electron/llm/documentGroundedPrompt.ts');
  // When both inputs are empty, the base prompt must be returned unchanged
  // (no spurious wrapper section added). This is the "no custom mode active"
  // branch every non-doc-grounded/non-custom call must take without change.
  // Loosely assert: a guard `if (modePromptSuffix)` precedes a guard
  // `if (pinnedInstructions)` precedes a final `return out;`.
  const modeGuard = src.indexOf('if (modePromptSuffix)');
  const pinGuard = src.indexOf('if (pinnedInstructions)');
  const returnOut = src.indexOf('return out;');
  assert.ok(modeGuard > 0 && pinGuard > modeGuard && returnOut > pinGuard,
    'the helper must only append when there is something to append (idempotent on empty inputs)');
});

// ---------------------------------------------------------------------------
// 2. ipcHandlers.ts (manual chat) wires it into the regen streamChat call.
// ---------------------------------------------------------------------------

test('ipcHandlers: the manual-chat regen streamChat call passes a non-undefined systemPromptOverride', () => {
  const src = read('electron/ipcHandlers.ts');
  assert.match(
    src,
    /llmHelper\.streamChat\(\s*strictPrompt,\s*undefined,\s*undefined,\s*regenSystemPrompt,\s*true,\s*true,\s*\[\]/,
    'the regen call must use the composed regenSystemPrompt, not undefined (the pre-fix regression)',
  );
  assert.match(
    src,
    /appendCustomModeSystemPromptLayer\(\{[\s\S]{0,400}isActiveCustomMode:/,
    'ipcHandlers must call the helper to build regenSystemPrompt',
  );
});

// ---------------------------------------------------------------------------
// 3. IntelligenceEngine.ts (WTA doc-grounded repair) wires it too.
// ---------------------------------------------------------------------------

test('IntelligenceEngine: the WTA doc-grounded repair streamChat call passes a non-undefined systemPromptOverride', () => {
  const src = read('electron/IntelligenceEngine.ts');
  // Match the exact positional arg pattern: (repairPrompt, undefined, undefined, wtaRepairSystemPrompt, true, true, ['reference_files'], signal)
  assert.match(
    src,
    /this\.llmHelper\.streamChat\(\s*repairPrompt,\s*undefined,\s*undefined,\s*wtaRepairSystemPrompt,\s*true,\s*true,\s*\['reference_files'\]/,
    'the WTA doc-grounded repair must use wtaRepairSystemPrompt, not undefined',
  );
  assert.match(
    src,
    /isActiveCustomMode:\s*isCustomMode\(_activeModeRow\)/,
    'the WTA call must invoke isCustomMode() to determine the active-custom-mode flag, consistent with the codebase pattern',
  );
});

test('IntelligenceEngine: HARD_SYSTEM_PROMPT is imported (needed by the new regen layer composition)', () => {
  const src = read('electron/IntelligenceEngine.ts');
  assert.match(
    src,
    /import \{ HARD_SYSTEM_PROMPT \} from '\.\/llm\/prompts'/,
    'HARD_SYSTEM_PROMPT must be imported for the WTA regen layer composition to type-check',
  );
});

// ---------------------------------------------------------------------------
// 4. Pure-function behavior of appendCustomModeSystemPromptLayer itself.
// ---------------------------------------------------------------------------

import os from 'node:os';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const distDir = (() => {
  const bundled = path.resolve(repoRoot, 'dist-electron/electron/llm/documentGroundedPrompt.js');
  if (fs.existsSync(bundled)) return path.resolve(repoRoot, 'dist-electron');
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'modeinjection-dist-'));
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(target, 'node_modules'), 'dir');
  try { execSync(`node node_modules/.bin/tsc -p electron/tsconfig.json --outDir ${target}`, { cwd: repoRoot, stdio: 'pipe' }); } catch { /* expected partial */ }
  return target;
})();
const cjsRequire = createRequire(import.meta.url);
const { appendCustomModeSystemPromptLayer } = cjsRequire(path.resolve(distDir, 'electron/llm/documentGroundedPrompt.js'));

test('appendCustomModeSystemPromptLayer: returns base unchanged with empty inputs', () => {
  const base = 'You are an assistant.';
  const out = appendCustomModeSystemPromptLayer({ baseSystemPrompt: base, modePromptSuffix: '', pinnedInstructions: '' });
  assert.equal(out, base, 'empty inputs must not mutate the base prompt');
});

test('appendCustomModeSystemPromptLayer: appends the ## ACTIVE MODE section when a modePromptSuffix is supplied', () => {
  const out = appendCustomModeSystemPromptLayer({
    baseSystemPrompt: 'You are an assistant.',
    modePromptSuffix: 'Answer concisely and avoid greetings.',
    pinnedInstructions: '',
  });
  assert.match(out, /## ACTIVE MODE/);
  assert.match(out, /Answer concisely/);
});

test('appendCustomModeSystemPromptLayer: appends the ## ACTIVE MODE INSTRUCTIONS section for a custom-mode pinned instructions', () => {
  const out = appendCustomModeSystemPromptLayer({
    baseSystemPrompt: 'You are an assistant.',
    modePromptSuffix: '',
    pinnedInstructions: 'Always respond in Spanish.',
    isActiveCustomMode: true,
  });
  assert.match(out, /## ACTIVE MODE INSTRUCTIONS \(user-configured\)/);
  assert.match(out, /Always respond in Spanish/);
  // isActiveCustomMode=true must inject the custom-mode policy guidance, not
  // the generic one — this is what prevents the regen from falling back to
  // a different behavioral frame than the initial generation.
  assert.match(out, /user-configured custom-mode instructions/);
});