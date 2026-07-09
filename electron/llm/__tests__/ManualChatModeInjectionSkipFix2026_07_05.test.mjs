// electron/llm/__tests__/ManualChatModeInjectionSkipFix2026_07_05.test.mjs
//
// Profile Intelligence production-fix ROUND 2 (2026-07-05,
// docs/investigations/pi-production-fix-round2-progress.md, RC1 + RC2).
//
// Root cause: electron/LLMHelper.ts's _streamChatInner re-derived
// `isUniversalOverride` (the flag that skips the ACTIVE MODE system-prompt
// injection for manual-chat's CHAT_MODE_PROMPT) from the LIVE
// `systemPromptOverride` variable AFTER the knowledge-intercept block had
// already REASSIGNED it to the profile-grounding system prompt (whenever
// `knowledgeResult.systemPromptInjection` was truthy — i.e. on almost every
// profile-grounded manual answer). Since `systemPromptOverride` was no
// longer `=== CHAT_MODE_PROMPT` by the time the check ran, `isUniversalOverride`
// was ALWAYS false for these answers, so the active mode's FULL system prompt
// (e.g. MODE_LOOKING_FOR_WORK_PROMPT, ~42.8k chars) got appended on top —
// including its "Nothing actionable right now." no-op escape hatch (RC1,
// live-WTA-only instruction that should never reach manual chat) and its
// JD-fit/pivot-selling framing (RC2, which steered profile_fact/
// skill_experience answers into unsolicited Data-Analyst-fit pivots that
// never answered the actual question).
//
// Fix: capture `callerOriginallyPassedUniversalOverride` ONCE at function
// entry, before any reassignment, and use that captured value for the
// ACTIVE MODE injection skip decision.
//
// Requires: npm run build:electron.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const llmHelperSrc = readFileSync(path.resolve(__dirname, '../../LLMHelper.ts'), 'utf8');

describe('RC1/RC2 fix — mode-injection skip survives the knowledge-intercept reassignment', () => {
  test('within _streamChatInner, callerOriginallyPassedUniversalOverride is captured before that function\'s own knowledge-intercept reassignment', () => {
    const fnStart = llmHelperSrc.indexOf('private async * _streamChatInner(');
    assert.ok(fnStart !== -1, '_streamChatInner must exist');
    // Scope to this function only — LLMHelper.ts has a SIBLING reassignment
    // site in the non-streaming chat() path (~line 2124) that predates this
    // one in raw file order; searching the whole file would find that one
    // instead and produce a false failure.
    const fnBody = llmHelperSrc.slice(fnStart);
    const captureIdx = fnBody.indexOf('const callerOriginallyPassedUniversalOverride');
    const knowledgeReassignIdx = fnBody.indexOf('systemPromptOverride = `${CORE_IDENTITY}\\n${EXECUTION_CONTRACT}\\n\\n${knowledgeResult.systemPromptInjection}`;');
    assert.ok(captureIdx !== -1, 'capture must exist inside _streamChatInner');
    assert.ok(knowledgeReassignIdx !== -1, 'the known reassignment site must exist inside _streamChatInner');
    assert.ok(captureIdx < knowledgeReassignIdx, 'capture must happen BEFORE the reassignment that broke the identity check');
  });

  test('the ACTIVE MODE injection guard uses the captured flag, not a fresh re-derivation from the (possibly mutated) systemPromptOverride', () => {
    assert.match(llmHelperSrc, /const isUniversalOverride = callerOriginallyPassedUniversalOverride;/);
  });

  test('the captured flag checks the SAME universal-override prompt set as before (no narrowing)', () => {
    const block = llmHelperSrc.slice(
      llmHelperSrc.indexOf('const callerOriginallyPassedUniversalOverride'),
      llmHelperSrc.indexOf('const callerOriginallyPassedUniversalOverride') + 900,
    );
    for (const name of [
      'UNIVERSAL_SYSTEM_PROMPT', 'UNIVERSAL_ANSWER_PROMPT', 'UNIVERSAL_WHAT_TO_ANSWER_PROMPT',
      'UNIVERSAL_RECAP_PROMPT', 'UNIVERSAL_FOLLOWUP_PROMPT', 'UNIVERSAL_FOLLOW_UP_QUESTIONS_PROMPT',
      'UNIVERSAL_ASSIST_PROMPT', 'CHAT_MODE_PROMPT', 'TINY_PROMPTS_SET',
    ]) {
      assert.ok(block.includes(name), `capture set must still reference ${name}`);
    }
  });
});
