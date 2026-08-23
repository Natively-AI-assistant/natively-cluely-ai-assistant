// electron/llm/wtaSystemPrompt.ts
//
// PR #429 Bug 003 — skill injection was silently dropped on the WTA surface
// whenever Context Intelligence V3 was active (default ON since 2026-07-30).
//
// WhatToAnswerLLM builds `finalPromptOverride` as
//   activeSkill ? `${basePrompt}\n\n## ACTIVE SKILL\n${activeSkill.promptBlock}` : basePrompt
// so that override is the ONLY carrier of the skill block. The system prompt was
// then composed as:
//
//     const _wtaSystemPrompt = _v3p?.system ?? finalPromptOverride;
//
// With V3 in effect `_v3p` is always defined, so `??` never falls through and
// the skill block was discarded on every turn. The user selected a skill, the
// UI showed it active, and the model never saw a word of it.
//
// The two inputs are not interchangeable — V3's system prompt is a different,
// governed composition, not a superset of the legacy one — so the fix is to
// APPEND the skill to whichever base actually rides the turn rather than to
// pick one and lose the other.

/** The active-skill shape WhatToAnswerLLM already threads through its options. */
export interface ActiveSkillLike {
    id: string;
    name: string;
    promptBlock: string;
}

/** Heading the legacy path uses; kept identical so the model sees one convention. */
export const ACTIVE_SKILL_HEADING = '## ACTIVE SKILL';

/**
 * Compose the WTA system prompt so an active skill survives V3.
 *
 * - No V3 prompt  -> the legacy override verbatim. It already contains the
 *   skill block (WhatToAnswerLLM built it that way), so appending again would
 *   duplicate it.
 * - V3 prompt, no skill -> exactly the V3 prompt. Byte-identical to the old
 *   behaviour, which is what keeps this change inert for non-skill turns.
 * - V3 prompt + skill -> V3 prompt with the skill block appended.
 */
export function composeWtaSystemPrompt(
    v3SystemPrompt: string | null | undefined,
    legacyPromptOverride: string,
    activeSkill?: ActiveSkillLike | null,
): string {
    if (!v3SystemPrompt) return legacyPromptOverride;
    if (!activeSkill?.promptBlock) return v3SystemPrompt;
    return `${v3SystemPrompt}\n\n${ACTIVE_SKILL_HEADING}\n${activeSkill.promptBlock}`;
}
