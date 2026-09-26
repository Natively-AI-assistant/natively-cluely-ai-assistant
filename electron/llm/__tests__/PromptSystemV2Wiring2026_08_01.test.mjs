// electron/llm/__tests__/PromptSystemV2Wiring2026_08_01.test.mjs
//
// Prompt System v2 — WIRING invariants (source assertions, the repo's
// established pattern for pinning call-site structure). Guards:
//   1. every legacy action LLM consults resolveV2SystemPrompt with the right
//      action id and keeps its legacy constant as the ?? fallback,
//   2. LLMHelper treats a v2-composed prompt as a universal override and never
//      stacks the legacy ## ACTIVE MODE template on top of it,
//   3. the [[NO_ACTION]] sentinel is suppressed at every sink: manual-chat
//      first paint, manual-chat persistence, WTA sentinel detection,
//      SessionTracker storage, and the phone-mirror surface,
//   4. the flag is registered default-OFF.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

const llmHelperSrc = read('../../LLMHelper.ts');
const ipcSrc = read('../../ipcHandlers.ts');
const engineSrc = read('../../IntelligenceEngine.ts');
const sessionSrc = read('../../SessionTracker.ts');
const phoneSrc = read('../../services/PhoneMirrorService.ts');
const flagsSrc = read('../../intelligence/intelligenceFlags.ts');
const meetingSrc = read('../../MeetingPersistence.ts');

describe('action LLMs consult the v2 resolver with the correct action', () => {
  const cases = [
    ['../AssistLLM.ts', 'assist', 'UNIVERSAL_ASSIST_PROMPT'],
    ['../AnswerLLM.ts', 'answer', 'UNIVERSAL_ANSWER_PROMPT'],
    ['../WhatToAnswerLLM.ts', 'what_to_say', 'UNIVERSAL_WHAT_TO_ANSWER_PROMPT'],
    ['../ClarifyLLM.ts', 'clarify', 'CLARIFY_MODE_PROMPT'],
    ['../BrainstormLLM.ts', 'brainstorm', 'BRAINSTORM_MODE_PROMPT'],
    ['../FollowUpLLM.ts', 'followup', 'UNIVERSAL_FOLLOWUP_PROMPT'],
    ['../FollowUpQuestionsLLM.ts', 'follow_up_questions', 'UNIVERSAL_FOLLOW_UP_QUESTIONS_PROMPT'],
    ['../RecapLLM.ts', 'recap', 'UNIVERSAL_RECAP_PROMPT'],
    ['../CodeHintLLM.ts', 'code_hint', 'CODE_HINT_PROMPT'],
  ];
  for (const [rel, action, legacyConstant] of cases) {
    test(`${path.basename(rel)} → action '${action}' with legacy fallback ${legacyConstant}`, () => {
      const src = read(rel);
      assert.match(src, /import\s*\{[^}]*resolveV2SystemPrompt[^}]*\}\s*from\s*["']\.\/promptSystemV2["']/,
        `${rel}: missing resolveV2SystemPrompt import`);
      assert.ok(src.includes(`action: '${action}'`), `${rel}: does not request action '${action}'`);
      assert.ok(src.includes(legacyConstant), `${rel}: legacy fallback constant removed prematurely`);
      // The v2 resolver must be a soft override (?? legacy), never a hard replacement.
      const idx = src.indexOf('resolveV2SystemPrompt({');
      assert.ok(idx > -1 && src.slice(idx, idx + 1400).includes('??'),
        `${rel}: v2 resolver is not nullish-chained to the legacy fallback`);
    });
  }

  test('WhatToAnswerLLM skips the ## ACTIVE MODE suffix when the v2 base is active', () => {
    const src = read('../WhatToAnswerLLM.ts');
    assert.match(src, /modePromptSuffix\s*&&\s*!v2BasePrompt/,
      'the legacy mode suffix must not stack on a v2-composed base');
  });
});

describe('LLMHelper compatibility hooks', () => {
  test('a v2-composed prompt counts as a universal override (streaming path)', () => {
    assert.match(llmHelperSrc, /callerOriginallyPassedUniversalOverride = callerPassedV2Prompt \|\|/,
      'v2 prompts must inherit the universal-override skip (else the 23–45k mode template stacks on top)');
  });

  test('mode-template suffix is gated off for v2 bases on BOTH injection sites', () => {
    assert.match(llmHelperSrc, /modePromptSuffix && !callerPassedV2Prompt/,
      'streaming suffix append must check callerPassedV2Prompt');
    assert.match(llmHelperSrc, /modePromptSuffix && !v2BasePromptActive/,
      'non-streaming suffix append must check v2BasePromptActive');
  });

  test('resolveLocalSystemPrompt downgrades a v2 cloud prompt to the v2 LOCAL composition', () => {
    assert.match(llmHelperSrc, /getV2PromptDescriptor[\s\S]{0,600}buildSystemPromptV2\(\{ \.\.\.desc, tier: 'local' \}\)/,
      'tiny-tier fallback must recompose the same route with the local core, not concatenate cores');
  });

  test('prompt-cache prewarm warms the v2 base when the flag is on', () => {
    assert.match(llmHelperSrc, /prewarmBase[\s\S]{0,400}resolveV2SystemPrompt\(\{ action: 'answer'/,
      'prewarm must prime the same prefix the live path sends');
  });

  test('legacy provider personalities collapse to one v2 base on streamChatWithGemini', () => {
    assert.match(llmHelperSrc, /v2StreamBase \?\? HARD_SYSTEM_PROMPT/);
    assert.match(llmHelperSrc, /v2StreamBase \?\? GROQ_SYSTEM_PROMPT/);
    assert.match(llmHelperSrc, /v2StreamBase \?\? OPENAI_SYSTEM_PROMPT/);
    assert.match(llmHelperSrc, /v2StreamBase \?\? CLAUDE_SYSTEM_PROMPT/);
  });
});

describe('manual chat (ipcHandlers) — sentinel can never paint or persist', () => {
  test('manual chat + phone chat resolve their base prompt through resolveManualChatBasePrompt', () => {
    assert.match(ipcSrc, /function resolveManualChatBasePrompt/);
    assert.ok((ipcSrc.match(/resolveManualChatBasePrompt\(llmHelper/g) || []).length >= 3,
      'expected the handler, regen, and phone-chat sites to use the shared resolver');
  });

  test('sendChunkGated holds the first chars until the buffer cannot be the sentinel', () => {
    assert.match(ipcSrc, /let sentinelHold = true;/);
    assert.match(ipcSrc, /_couldBeNoAction\(deferredBuffer\)/,
      'streaming gate must hold a possible sentinel instead of painting it');
    assert.match(ipcSrc, /_stripNoAction\(deferredBuffer\)/,
      'a misfired sentinel prefix must be stripped before painting');
  });

  test('an exact sentinel response is substituted and marked do-not-store', () => {
    assert.match(ipcSrc, /no_action_sentinel_suppressed/,
      'post-stream substitution with a do_not_store write decision is required');
    assert.match(ipcSrc, /\(deferFirstPaint \|\| sentinelHold\) && deferredBuffer\.length > 0 && !finalText/,
      'residual held tokens must flush via finalText at stream end');
  });
});

describe('WTA / engine — sentinel recognition and stream gating', () => {
  test('isNonAnswerSentinel recognizes the v2 sentinel via shouldSuppressModelOutput', () => {
    assert.match(engineSrc, /isNonAnswerSentinel\(answer: string\): boolean \{[\s\S]{0,800}shouldSuppressModelOutput/,
      'the WTA discard/substitution branches must fire on [[NO_ACTION]] too');
  });

  test('the WTA safe-prefix emit strips a misfired leading sentinel', () => {
    assert.match(engineSrc, /stripLeadingNoActionSentinel\(visiblePrefix\)/);
  });
});

describe('persistence + phone surface backstops', () => {
  test('SessionTracker.addAssistantMessage refuses to store the sentinel', () => {
    assert.match(sessionSrc, /addAssistantMessage\([\s\S]{0,8000}shouldSuppressModelOutput\(text\)/,
      'the one storage chokepoint (contextItems/fullTranscript/history/DB) must reject the sentinel');
  });

  test('PhoneMirrorService suppresses the sentinel on done and assistant-message publishes', () => {
    assert.match(phoneSrc, /publishDone\([\s\S]{0,700}shouldSuppressModelOutput/,
      'publishDone must not record/broadcast the sentinel');
    assert.match(phoneSrc, /publishAssistantMessage\([\s\S]{0,700}shouldSuppressModelOutput/,
      'publishAssistantMessage must not record/broadcast the sentinel');
  });
});

describe('turn-composer production wiring (buildTurnContentV2)', () => {
  test('WTA dispatches V3 > v2 envelope > legacy packet, in that order', () => {
    const src = read('../WhatToAnswerLLM.ts');
    assert.match(src, /_v3p\?\.user \?\? _v2TurnUser \?\? packet\.userMessage/,
      'the v2 envelope must sit between V3 substitution and the legacy packet');
  });

  test('WTA envelope stands down for V3-owned and Context-OS-governed turns and requires an extracted question', () => {
    const src = read('../WhatToAnswerLLM.ts');
    assert.match(src, /v2BasePrompt && !_v3p && !cogGovernedTurn && answerPlan\?\.question\?\.trim\(\)/,
      'envelope gate must require v2 base, no V3, no governance, and a question');
    assert.match(src, /cogGovernedTurn = true;/, 'governance must set the stand-down flag');
  });

  test('WTA envelope preserves the screen-OCR injection-redaction posture', () => {
    const src = read('../WhatToAnswerLLM.ts');
    assert.match(src, /hasPromptInjection\(escapeUserContent\(screenText\)\)[\s\S]{0,120}INJECTION_REDACTION_MESSAGE/,
      'screen text entering the envelope must keep the assembler redaction');
  });

  test('WTA pinned instructions ride the v2 SYSTEM prompt, not the envelope', () => {
    const src = read('../WhatToAnswerLLM.ts');
    assert.match(src, /customInstructions: pinnedModeInstructions \|\| undefined/,
      'pinned mode instructions must be passed to resolveV2SystemPrompt');
  });

  test('LLMHelper chokepoint wraps ONLY the plain branch, against the LIVE prompt, with double-wrap and coding gates', () => {
    assert.match(llmHelperSrc, /isV2ComposedPrompt\(systemPromptOverride\)[\s\S]{0,220}!hasV2TurnEnvelope\(message\)[\s\S]{0,220}isCodingAnswerType/,
      'chokepoint gates missing');
    assert.match(llmHelperSrc, /buildAssembledTurnContentV2\(\{ assembledContext: combinedContext, currentTurn: message \}\)/,
      'chokepoint must use the assembled-context envelope');
    // Transport normalization mirrors the governed path.
    assert.match(llmHelperSrc, /if \(v2Turn\) \{[\s\S]{0,200}message = userContent;[\s\S]{0,200}context = undefined;/,
      'enveloped turns must normalize message/context for legacy transports');
  });

  test('FollowUpLLM composes the refinement envelope from the unmodified resolved prompt', () => {
    const src = read('../FollowUpLLM.ts');
    assert.match(src, /isV2ComposedPrompt\(prompt\)/);
    assert.match(src, /kind: 'other', content: previousAnswer, source: 'previous_answer'/);
    assert.ok(src.includes('PREVIOUS ANSWER:\\n'), 'legacy fallback shape must remain');
  });
});

describe('universal coding contract — every surface resolves its signals through ONE module', () => {
  // 2026-08-18: each surface used to compute `codingTask` with its own inline
  // `isCodingAnswerType(...)` expression, which was fine while the signal was a
  // single boolean and became a drift hazard the moment the contract needed a
  // SHAPE ('dsa' vs 'impl'), an explicit user format request, and a
  // supplied-template flag as well. `resolveCodingPromptSignals` is now the one
  // producer; these pins fail when a surface is added or reverted to a hand-rolled
  // boolean. See .audit/coding-template-audit-2026-08-18.md.
  const SURFACES = [
    ['../../ipcHandlers.ts', 3],       // V3 personaBase, manual chat base prompt, phone chat
    ['../../LLMHelper.ts', 2],         // _streamChatInner + chatWithGemini
    ['../../IntelligenceEngine.ts', 3],// V3 personaBase + both validator stand-downs
    ['../WhatToAnswerLLM.ts', 1],
    ['../AnswerLLM.ts', 1],
  ];

  for (const [rel, expected] of SURFACES) {
    test(`${path.basename(rel)} resolves coding signals through the shared resolver`, () => {
      const src = read(rel);
      const hits = (src.match(/resolveCodingPromptSignals\(/g) || []).length;
      assert.equal(hits, expected, `${rel}: expected ${expected} resolveCodingPromptSignals call(s), got ${hits}`);
    });
  }

  test('no surface hand-rolls the coding boolean beside the resolver', () => {
    // The old shape, pinned NEGATIVELY: a reintroduced inline boolean would
    // silently ship a coding turn with no contract shape and no format request.
    assert.doesNotMatch(llmHelperSrc, /codingTask: \(\(\) => \{ try \{ const \{ isCodingAnswerType \}/);
    assert.doesNotMatch(read('../WhatToAnswerLLM.ts'), /codingTask: isCodingAnswerType\(answerPlan\?\.answerType as AnswerType\)/);
    assert.doesNotMatch(read('../AnswerLLM.ts'), /codingTask: !!\(answerPlan && isCodingAnswerType\(answerPlan\.answerType\)\)/);
  });

  test('the live path passes the explicit format contract to the repair layer', () => {
    // Prompt-only would be undone: with no contract argument
    // validateAnswerStructure force-injects the six sections back into a
    // "code only" answer. Manual chat has always passed it; the live path did not.
    assert.match(engineSrc, /validateAnswerStructure\(\s*answerPlan\.answerType, fullAnswer, liveExplicitCodingContract,?\s*\)/);
    // Resolved through the SHARED resolver, not detectExplicitCodingContract
    // directly, so the repair layer stands down on exactly the formats the prompt
    // asked for (the continuation-only ones are gated on a prior coding turn).
    assert.match(engineSrc, /const liveExplicitCodingContract = require\('\.\/llm\/codingPromptSignals'\)\.resolveCodingPromptSignals\(/);
  });
});

describe('flag + meeting surfaces', () => {
  test('promptSystemV2 flag is registered with env NATIVELY_PROMPT_SYSTEM_V2, default TRUE (promoted 2026-08-02)', () => {
    assert.match(flagsSrc, /promptSystemV2: \{ env: 'NATIVELY_PROMPT_SYSTEM_V2', setting: 'promptSystemV2Enabled', default: true \}/);
    assert.ok(flagsSrc.includes('NATIVELY_PROMPT_SYSTEM_V2=0'), 'kill-switch note missing from the promotion comment');
  });

  test('meeting title generation consults the v2 title action; summary JSON keeps its schema prompt', () => {
    assert.match(meetingSrc, /resolveV2SystemPrompt\(\{ action: 'title'/,
      'title path must use the provider-neutral v2 contract');
    // The structured-summary prompt is DELIBERATELY untouched: its JSON shape
    // (overview/keyPoints/actionItems + mode note sections) is coupled to the
    // deterministic parser in MeetingPersistence. Guard that it still exists.
    assert.ok(meetingSrc.includes('"keyPoints": ['), 'summary JSON schema prompt must be preserved');
  });

  test('follow-up email uses the v2 contract with the legacy pair as fallback', () => {
    assert.match(ipcSrc, /v2EmailPrompt \?\? FOLLOWUP_EMAIL_PROMPT/);
    assert.match(ipcSrc, /v2EmailPrompt \?\? GROQ_FOLLOWUP_EMAIL_PROMPT/);
  });
});
