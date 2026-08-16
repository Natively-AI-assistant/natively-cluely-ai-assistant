// Regression test for PR #429 Bug 003: skill injection silently ignored when
// Context Intelligence V3 is active (default ON since 2026-07-30).
//
// Two independent drop sites, one per surface:
//
//  1. WTA overlay (WhatToAnswerLLM.ts): the system prompt was composed as
//     `_v3p?.system ?? finalPromptOverride`. With V3 active `_v3p` is always
//     defined, so `finalPromptOverride` — the only carrier of the
//     `## ACTIVE SKILL` block — was silently discarded.
//
//  2. Manual chat (ipcHandlers.ts): the V3 short-circuit owns the turn end to
//     end and consumed only the raw `message`, but the /skill-name prefix
//     parsing lived ~500 lines later on the legacy path. Under V3 the prefix
//     leaked to the model as literal text and the skill instructions were
//     never injected anywhere.
//
// ─── STATUS 2026-08-16 ───────────────────────────────────────────────────────
// Surface 1 (WTA) is FIXED: composeWtaSystemPrompt now appends the skill to
// whichever base rides the turn. It is inert on non-skill turns (V3 prompt with
// no skill returns byte-identically), which is why it was safe to land.
//
// Surface 2 (manual chat) is STILL OPEN and its three tests below still fail.
// Facts, so whoever picks it up does not have to re-derive them:
//
//   * Both sites are in the same `gemini-chat` handler (registered ~offset
//     41456). The V3 short-circuit is at ~50356; `skillPrefixMatch` is parsed
//     at ~85936 — i.e. ~35k characters AFTER the branch that already returned.
//   * Under V3 (default ON since 2026-07-30) a "/humanize rewrite this" turn
//     therefore sends the literal "/humanize " text to the model and injects no
//     skill instructions at all.
//   * The dependencies of the 3,148-char skill block (`message`, `context`,
//     `SkillsManager`, `event`, `myStreamId` @48288) are ALL available before
//     the V3 branch, so the relocation is mechanically possible. This is a
//     scoping call, not a blocker.
//
// Deliberately NOT auto-fixed. Hoisting the parse changes what EVERY read of
// `message` between offsets 48288 and 85936 sees — raw today, stripped after.
// One consequence is already known and written up below (the legacy identity
// probe must gate on !skillPromptBlock, or "/humanize who are you" answers with
// the canned identity reply and drops the skill). The rest are not enumerable
// by grep — `message` is a parameter name used throughout the handler — and the
// failures would be behavioural on the primary user surface, which a
// source-scanning suite does not catch.
//
// Note also that `skillParseIdx < v3EntryIdx` below pins SOURCE OFFSETS. Any
// occurrence of the string `skillPrefixMatch` earlier in the file satisfies it,
// including one that fixes nothing. Make the behaviour right and verify it by
// exercising manual chat; do not let this assertion define "done".

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeWtaSystemPrompt } from '../../../dist-electron/electron/llm/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// ---------------------------------------------------------------------------
// 1. WTA surface — behavioral contract of the system-prompt composition
// ---------------------------------------------------------------------------
describe('composeWtaSystemPrompt (WTA surface)', () => {
  const skill = { id: 'humanize-ai-text', name: 'Humanize AI Text', promptBlock: '<active_skill>rewrite naturally</active_skill>' };

  test('V3 system + active skill → skill block is appended, V3 system preserved', () => {
    const out = composeWtaSystemPrompt('V3 SYSTEM PROMPT', 'LEGACY OVERRIDE', skill);
    assert.ok(out.startsWith('V3 SYSTEM PROMPT'), 'V3 system prompt must lead');
    assert.ok(out.includes(skill.promptBlock), 'skill promptBlock must be present');
  });

  test('V3 system + no skill → exactly the V3 system prompt (no behavior change)', () => {
    assert.equal(composeWtaSystemPrompt('V3 SYSTEM PROMPT', 'LEGACY OVERRIDE', undefined), 'V3 SYSTEM PROMPT');
    assert.equal(composeWtaSystemPrompt('V3 SYSTEM PROMPT', 'LEGACY OVERRIDE', null), 'V3 SYSTEM PROMPT');
  });

  test('no V3 prompt → legacy override verbatim, with or without skill', () => {
    assert.equal(composeWtaSystemPrompt(undefined, 'LEGACY OVERRIDE', skill), 'LEGACY OVERRIDE');
    assert.equal(composeWtaSystemPrompt(null, 'LEGACY OVERRIDE', undefined), 'LEGACY OVERRIDE');
  });

  test('WhatToAnswerLLM wires the composition helper at the _wtaSystemPrompt site', () => {
    const source = read('electron/llm/WhatToAnswerLLM.ts');
    assert.match(source, /_wtaSystemPrompt = composeWtaSystemPrompt\(/,
      '_wtaSystemPrompt must be built via composeWtaSystemPrompt so activeSkill survives V3');
    assert.doesNotMatch(source, /_wtaSystemPrompt = _v3p\?\.system \?\? finalPromptOverride/,
      'the raw ??-discard pattern must be gone');
  });
});

// ---------------------------------------------------------------------------
// 2. Manual-chat surface — skill parse must precede the V3 short-circuit and
//    the composed V3 system prompt must carry the skill block
// ---------------------------------------------------------------------------
describe('manual-chat V3 short-circuit honors /skill prefixes', () => {
  test('skill prefix parsing occurs BEFORE the V3 short-circuit', () => {
    const source = read('electron/ipcHandlers.ts');
    const skillParseIdx = source.indexOf('skillPrefixMatch');
    const v3EntryIdx = source.indexOf('isContextIntelligenceV3Enabled()');
    assert.ok(skillParseIdx !== -1 && v3EntryIdx !== -1, 'both sites must exist');
    assert.ok(skillParseIdx < v3EntryIdx,
      'skill prefix must be parsed before the V3 branch so V3 sees the stripped query and the skill block');
  });

  test('V3 stream sends a system prompt that includes skillPromptBlock when set', () => {
    const source = read('electron/ipcHandlers.ts');
    assert.match(source, /skillPromptBlock\s*\?\s*`\$\{composed\.system\}[\s\S]{0,40}\$\{skillPromptBlock\}`/,
      'the V3 system prompt must append skillPromptBlock when a skill is active');
  });

  test('legacy context injection site still exists (non-V3 path unchanged)', () => {
    const source = read('electron/ipcHandlers.ts');
    assert.match(source, /context = context \? `\$\{skillPromptBlock\}\\n\\n\$\{context\}` : skillPromptBlock/,
      'legacy skill-into-context injection must remain for the non-V3 path');
  });

  // Code-review follow-up (2026-08-05): hoisting the parse above V3 means the
  // legacy identity-probe now sees the STRIPPED message. Pre-hoist, the probe
  // ran on the raw "/humanize who are you", which its fully-anchored regexes
  // (manualIdentityRouting.ts ^...$) could never match — skill turns were
  // structurally immune to probe hijacking. The probe must therefore be
  // skipped whenever a skill is active, or "/humanize who are you" on the
  // legacy path answers with the canned identity reply and drops the skill.
  test('legacy identity probe is skipped when a skill is active', () => {
    const source = read('electron/ipcHandlers.ts');
    assert.match(source, /if \(!skillPromptBlock && !imagePaths\?\.length && typeof message === 'string'\) \{/,
      'the identity-probe gate must include !skillPromptBlock so skill turns bypass the probe');
  });
});
