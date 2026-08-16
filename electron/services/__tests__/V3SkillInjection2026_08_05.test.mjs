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
// ─── RESOLVED 2026-08-16 ─────────────────────────────────────────────────────
// Both surfaces are fixed.
//
// WTA: composeWtaSystemPrompt appends the skill to whichever base rides the
// turn, instead of `_v3p?.system ?? finalPromptOverride` discarding it. Inert on
// non-skill turns.
//
// Manual chat: the /skill parse was hoisted above the V3 short-circuit — but
// only the PARSE. `message` is still mutated at the ORIGINAL boundary, so every
// reader in between (identity probe, source-switch resolution, error logs)
// still sees the user's literal input exactly as before; the hoisted block
// assigns to `skillStrippedMessage` and the V3 branch reads that. The identity
// probe additionally gates on !skillPromptBlock, making an immunity that was
// previously incidental (its anchored regexes could not match a "/skill ..."
// prefix) explicit, so it survives a future regex relaxation.
//
// Note the `skillParseIdx < v3EntryIdx` assertion below still pins SOURCE
// OFFSETS and is satisfiable by an occurrence that fixes nothing. It is not
// what makes this correct — the deferred-mutation split is.

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
