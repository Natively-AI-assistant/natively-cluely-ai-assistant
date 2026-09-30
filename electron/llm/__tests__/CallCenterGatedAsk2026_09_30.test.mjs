// Call Center: a gated ask gets the rule, then the verification (2026-09-30).
//
// External judge on the I5 dev run: DCC-018/027/028/029 answered a refund or
// credit demand by repeating the identity checklist and never said what the
// refund, replacement or goodwill rule is ("repeats verification without
// explaining the $20 limit"). Replayed with this clause, the same prompts state
// the 30-day refund / warranty-replacement rule and the $20-per-12-months
// goodwill cap, then ask for the verification needed to act.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveV2SystemPrompt } from '../../../dist-electron/electron/llm/promptSystemV2.js';

const cc = () => resolveV2SystemPrompt({ action: 'what_to_say', tier: 'cloud', activeMode: { templateType: 'call-center', isCustom: false } });

test('the Call Center mode answers a gated ask with the rule and then the verification', () => {
  const p = cc();
  assert.match(p, /Identity checks, refunds, credits, resets and escalation follow only the procedure the context states/);
  assert.match(p, /answer the ask in the same reply: say what the context's rule for it is in general terms \(the window, the limit, the condition, who must approve\), then ask for exactly what the procedure needs to act on it/);
  assert.match(p, /stating the rule is not a promise that it applies to them/);
});

test('only the Call Center mode carries it', () => {
  for (const templateType of ['sales', 'general', 'team-meet', 'recruiting', 'looking-for-work']) {
    const p = resolveV2SystemPrompt({ action: 'what_to_say', tier: 'cloud', activeMode: { templateType, isCustom: false } });
    assert.doesNotMatch(p, /stating the rule is not a promise/, templateType);
  }
});
