// What the user told the app about themselves, for every V3 answer
// (what-to-answer, typed chat, the transcript surfaces, manual answers).
//
// One reader so the four buildV3Prompt call sites cannot drift. Before
// 2026-11-09 they passed About you only; the facts in a mode's Real-time prompt
// and every skill not typed as /name never reached an answer, so a user who
// wrote "I'm from the Philippines" there, or a skill to "answer with my voice
// and my experience", heard an invented background instead.
//
// No platform branches: this is prompt content only. Each read is isolated, so
// a failing source drops just itself and the turn still composes.

import type { AnswerType } from '../llm/AnswerPlanner';

export interface AnswerPersonalContext {
  /** About you (Cue Cards, Pro or trial). '' when unset or without access. */
  userBio: string;
  /** Facts from the active mode's Real-time prompt, gated for this answer type. */
  modeNotes?: string;
  /** Skills switched to "Use in every answer", rendered. */
  standingSkills?: string;
}

export interface AnswerPersonalContextOptions {
  /** The planner's verdict for this turn, when the caller has one. */
  answerType?: AnswerType;
  /** The mode the turn is pinned to (else the active mode). */
  modeId?: string | null;
  /** A skill the user typed as /name this turn: carried separately, so left out here. */
  explicitSkillId?: string | null;
}

export interface PersonalContextBlockOptions {
  /** false when the caller carries the skills in its own slot (Direct Assist's skill field). */
  includeSkills?: boolean;
}

/**
 * The same context as ONE text block, for every path that does not go through
 * the V3 composer: the legacy typed chat V3 falls back to when a provider
 * fails, the legacy What to answer / manual answer prompts, and Direct Assist.
 * Before 2026-11-09 none of them carried any of it, so a provider hiccup or V3
 * switched off silently dropped the user's skill and background.
 *
 * Rendered with the composer's own section builders, so the wording cannot
 * drift between paths, and with the same privacy rule the V3 bridge applies:
 * About you leaves only when the "Profile and history" provider scope allows
 * it (read live — never cached, see readProviderScopePolicy). Order: About
 * you, the mode's notes, the own-words notice that points at them, then the
 * skills (the notice says "below" for those). '' when there is nothing.
 */
export function renderPersonalContextBlock(ctx: AnswerPersonalContext, opts: PersonalContextBlockOptions = {}): string {
  const composer = require('../context-intelligence/generation/prompt-composer') as typeof import('../context-intelligence/generation/prompt-composer');
  let bio = ctx.userBio?.trim() ?? '';
  if (bio) {
    try {
      const scopes = require('../context-intelligence/policies/provider-scope-policy') as typeof import('../context-intelligence/policies/provider-scope-policy');
      if (scopes.isScopeDenied('profile_history', scopes.readProviderScopePolicy())) bio = '';
    } catch {
      // The policy could not be read: fail closed, as for any withheld profile data.
      bio = '';
    }
  }
  const notes = ctx.modeNotes?.trim() ?? '';
  const skills = opts.includeSkills === false ? '' : (ctx.standingSkills?.trim() ?? '');
  return [
    bio ? composer.aboutUserSection(bio) : '',
    notes ? composer.modeNotesSection(notes) : '',
    composer.ownWordsNotice({ bio: Boolean(bio), notes: Boolean(notes), skill: Boolean(skills) }),
    skills ? composer.standingSkillsSection(skills) : '',
  ].filter(Boolean).join('\n\n');
}

/** personalContextForAnswers + renderPersonalContextBlock, for the legacy paths. */
export function personalContextBlockForAnswers(
  opts: AnswerPersonalContextOptions = {},
  blockOpts: PersonalContextBlockOptions = {},
): string {
  try {
    const ctx = personalContextForAnswers(opts);
    // These legacy paths sent a coding / system-design / debugging answer no
    // context at all, on purpose (the plan forbids profile and custom layers
    // there). The mode's notes are already gated by type; About you is too,
    // here, so a solution is not framed by the user's background. The skills
    // still ride: a style skill ("answer in Spanish") applies to code as well.
    const technical = (require('../llm/customContextClassifier') as typeof import('../llm/customContextClassifier')).isSelfFactsForbiddenType(opts.answerType);
    return renderPersonalContextBlock(technical ? { ...ctx, userBio: '' } : ctx, blockOpts);
  } catch {
    return '';
  }
}

export function personalContextForAnswers(opts: AnswerPersonalContextOptions = {}): AnswerPersonalContext {
  const out: AnswerPersonalContext = { userBio: '' };
  try {
    out.userBio = (require('./proAccess') as typeof import('./proAccess')).userBioForAnswers();
  } catch { /* About you unavailable: the turn composes without it */ }
  try {
    const { ModesManager } = require('./ModesManager') as typeof import('./ModesManager');
    const notes = ModesManager.getInstance().getActiveModeUserNotes(opts.answerType, opts.modeId ?? undefined);
    if (notes) out.modeNotes = notes;
  } catch { /* mode notes unavailable */ }
  try {
    const { SkillsManager } = require('./SkillsManager') as typeof import('./SkillsManager');
    const block = SkillsManager.getInstance().getAlwaysOnPromptBlock(opts.explicitSkillId ?? undefined);
    if (block) out.standingSkills = block;
  } catch { /* skills unavailable */ }
  return out;
}
