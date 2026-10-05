// Team Meet: ask or propose the check, never narrate access (2026-09-30).
//
// External judge on the I5 dev run: with no record of what was agreed, Team Meet
// answers opened "I don't have anything in front of me…", "What I have is that I
// don't know" (DTEAM-006/021/027/028, judged 8.0-8.3; lexical epistemic 8/40), and
// in a chain the next answers copied the phrase from the user's own prior line.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveV2SystemPrompt } from '../../../dist-electron/electron/llm/promptSystemV2.js';

const prompt = (templateType) => resolveV2SystemPrompt({ action: 'what_to_say', tier: 'cloud', activeMode: { templateType, isCustom: false } });

test('Team Meet asks the settling question or proposes the check, and never describes access', () => {
  const p = prompt('team-meet');
  assert.match(p, /speak like a colleague who simply does not remember it: ask the one question that settles it or propose the quick check/);
  assert.match(p, /Never describe what you have, lack or can see \("in front of me", "I don't have a record", "I can't confirm"\)/);
  assert.match(p, /when asked for your view, give a clearly conditional one rather than none/);
});

test('only Team Meet carries it', () => {
  for (const templateType of ['sales', 'general', 'call-center', 'recruiting', 'looking-for-work', 'lecture']) {
    assert.doesNotMatch(prompt(templateType), /speak like a colleague who simply does not remember it/, templateType);
  }
});
