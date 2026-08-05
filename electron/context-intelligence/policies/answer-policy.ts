// electron/context-intelligence/policies/answer-policy.ts
//
// The ONE user-facing grounding control (§6).
//
// WHAT THIS REPLACES
// Today a user is asked to pick a Knowledge Source: Resume, JD, reference files,
// Profile Intelligence, Combined, Automatic. That control is an architectural
// workaround — it asks the user to compensate for a source decision the system
// could not make. The shadow run showed exactly why it existed: the legacy
// source decision is a pure function of the MODE and never looks at the
// question, so SOMETHING had to be user-steerable.
//
// With mode policy authorizing sources, classification determining required
// ones, and retrieval selecting relevant evidence, the only thing genuinely left
// to a user is FALLBACK — what should happen when the references do not cover
// the question. That is a real product decision. Which retriever ran is not.
//
// So the whole selector collapses to two options, and neither of them mentions
// retrieval:
//
//     Answer policy
//     ○ Use references when relevant
//     ○ Only answer from references
//
// See docs/context-intelligence-v3/05_MODE_POLICY_SPEC.md and §6 of the brief.

import type { GroundingPolicy } from '../contracts/types';
import { resolveModePolicy, isModeId, type ModeId } from './mode-policy-registry';

/** The only two values a normal user ever sets. */
export type AnswerPolicy = 'use_references_when_relevant' | 'only_answer_from_references';

export const ANSWER_POLICY_LABELS: Record<AnswerPolicy, string> = {
  use_references_when_relevant: 'Use references when relevant',
  only_answer_from_references: 'Only answer from references',
};

/**
 * Map the user-facing choice onto the internal grounding policy.
 *
 * Deliberately NOT a 1:1 exposure of GroundingPolicy. `OPEN_KNOWLEDGE` and
 * `ASK_BEFORE_FALLBACK` are internal states — the first is a mode default, the
 * second is unsuitable for a live meeting — and surfacing them would put
 * internal architecture back in front of the user, which is the thing being
 * removed.
 */
export function groundingFor(policy: AnswerPolicy): GroundingPolicy {
  return policy === 'only_answer_from_references' ? 'STRICT_SOURCE_ONLY' : 'SOURCE_FIRST';
}

export interface ResolveAnswerPolicyInput {
  modeId: string;
  /** The user's explicit choice for this mode, when they have made one. */
  userChoice?: AnswerPolicy | null;
  /**
   * Developer diagnostic override. §6 requires that if one exists it must be
   * disabled for normal users, clearly marked, and never persisted as
   * production state — so it is passed per-call and never read from settings.
   */
  diagnosticOverride?: GroundingPolicy | null;
}

export interface ResolvedAnswerPolicy {
  groundingPolicy: GroundingPolicy;
  /** What the toggle should render as. */
  answerPolicy: AnswerPolicy;
  source: 'diagnostic_override' | 'user_choice' | 'mode_default';
  /** True when the mode's own default is strict and the control should be
   *  presented as already-strict rather than as a free choice. */
  modeIsStrictByDefault: boolean;
}

/**
 * Resolve grounding for a turn.
 *
 * Precedence: diagnostic override > explicit user choice > mode default.
 *
 * A user choice can only ever move between the two exposed options. It cannot
 * reach OPEN_KNOWLEDGE, and it cannot authorize a source — modes authorize
 * sources, and no toggle may widen that.
 */
export function resolveAnswerPolicy(input: ResolveAnswerPolicyInput): ResolvedAnswerPolicy {
  const modeId: ModeId = isModeId(input.modeId) ? input.modeId : 'general';
  const mode = resolveModePolicy(modeId);
  const modeIsStrictByDefault = mode.groundingPolicy === 'STRICT_SOURCE_ONLY';

  if (input.diagnosticOverride) {
    return {
      groundingPolicy: input.diagnosticOverride,
      answerPolicy: input.diagnosticOverride === 'STRICT_SOURCE_ONLY'
        ? 'only_answer_from_references' : 'use_references_when_relevant',
      source: 'diagnostic_override',
      modeIsStrictByDefault,
    };
  }

  if (input.userChoice) {
    return {
      groundingPolicy: groundingFor(input.userChoice),
      answerPolicy: input.userChoice,
      source: 'user_choice',
      modeIsStrictByDefault,
    };
  }

  return {
    groundingPolicy: mode.groundingPolicy,
    answerPolicy: modeIsStrictByDefault
      ? 'only_answer_from_references'
      : 'use_references_when_relevant',
    source: 'mode_default',
    modeIsStrictByDefault,
  };
}

/**
 * Should the control be shown at all?
 *
 * Only where choosing has a real consequence — i.e. the mode authorizes
 * reference files. Offering "only answer from references" in a mode with no
 * reference files is a control that can only make things worse.
 */
export function shouldOfferAnswerPolicyControl(modeId: string): boolean {
  const id: ModeId = isModeId(modeId) ? modeId : 'general';
  return resolveModePolicy(id).allowedSourceTypes.includes('REFERENCE_FILE');
}

/**
 * Terms that must never appear in user-facing grounding UI.
 *
 * §6: "Do not expose internal retrieval architecture." Asserted by test so the
 * rule is enforced rather than merely documented — the old selector drifted into
 * exposing exactly these.
 */
export const FORBIDDEN_UI_TERMS = [
  'retriev', 'embedding', 'vector', 'rag', 'chunk', 'bm25', 'rerank',
  'knowledge source', 'profile intelligence', 'okf', 'index',
] as const;
