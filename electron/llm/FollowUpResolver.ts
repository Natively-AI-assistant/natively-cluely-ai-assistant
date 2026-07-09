// electron/llm/FollowUpResolver.ts
//
// Resolves a SHORT BARE follow-up in the live transcript ("And SQL?", "What
// about complexity?", "Why?", "How so?", "And that project?") into a full,
// answerable question + the answer type it should inherit from the prior turn.
//
// The transcript extractor already resolves demonstrative follow-ups that name a
// topic ("how is IT developed?" → project "Natively"). This resolver covers the
// HARDER bare fragments that carry almost no signal on their own and MUST inherit
// the prior question's subject/answer-type to route correctly — otherwise they
// fall through to general_meeting/unknown and (worse) can pull the wrong context.
//
// It is deterministic and fast (regex + light token reuse) — no LLM. It returns
// `resolved.confidence === 0` when the fragment is not a recognisable follow-up,
// so the caller keeps the extractor's original routing.

import type { AnswerType } from './AnswerPlanner';

export interface FollowUpContext {
  /** The latest (possibly bare) interviewer fragment, lowercased is fine. */
  latestQuestion: string;
  /** The previous INTERVIEWER question (the one this fragment riffs on). */
  previousQuestion?: string;
  /** The answer type the previous turn was planned as, if known. */
  previousAnswerType?: AnswerType;
  /** A project/entity already on the table (from the extractor's followUpTarget). */
  lastEntity?: string;
  /** A skill already on the table (e.g. "Python" from "rate your Python"). */
  lastSkill?: string;
}

export interface ResolvedFollowUp {
  resolvedQuestion: string;
  resolvedAnswerType?: AnswerType;
  resolvedEntity?: string;
  resolvedSkill?: string;
  confidence: number; // 0 = not a follow-up we can resolve
  reason: string;
}

const NONE: ResolvedFollowUp = { resolvedQuestion: '', confidence: 0, reason: 'not_a_followup' };

// ── Context-free bare follow-up handling (release 2026-06-07c) ──────────────
// A bare follow-up ("why?", "and?", "continue", "what about it?") that has NO
// resolvable prior context must NOT fall through to unknown/general (where the LLM
// can self-identify as "an AI assistant" or randomly dump the profile). Detect the
// bare-fragment shape deterministically; when the caller confirms there's no prior
// context, emit a safe, mode-appropriate CLARIFICATION request instead.

/** Pure bare-follow-up fragments that carry no standalone meaning. */
const BARE_FOLLOWUP_RE = /^(?:ok(?:ay)?,?\s*|so,?\s*|hmm,?\s*|right,?\s*|well,?\s*|and,?\s*|but,?\s*)*(?:why|why not|how so|how come|how|and|and\?|so|that|this|it|what about (?:it|that|this)|what about|continue|go on|carry on|keep going|tell me more|more|explain|expand|elaborate|can you (?:expand|elaborate|explain|go on)|go deeper|in more detail|then\??)[\s?.!]*$/i;

/**
 * Short "addend" phrases that request an enhancement to the prior answer — a code
 * example, a diagram, an analogy — rather than asking a new standalone question.
 * E.g. "with code?", "with a code example?", "with an example?", "show code?",
 * "include code?", "can you add code?", "with code please". These carry zero
 * standalone meaning and MUST be resolved against the prior answer in context.
 *
 * Guard: no stronger standalone cue ("write", "implement", "solve", etc.) so a
 * genuine "write code for X" does not accidentally match.
 */
const ADDEND_RE = /^(?:with|show|include|add|using|also\s+(?:show|add|include))\b[^.?!]{0,40}?\b(?:code(?:\s+(?:example|snippet|sample|for\s+that|for\s+it|please|too))?|example|snippet|an?\s+example|a\s+(?:code\s+)?(?:example|snippet))\s*[?.!]?\s*$/i;

export type FollowUpSurface = 'manual' | 'what_to_answer' | 'meeting' | 'lecture' | 'interview' | 'sales' | 'coding';

/**
 * Is `question` a bare follow-up fragment that cannot stand on its own? This is the
 * SHAPE test only — it does NOT decide whether prior context exists (the caller
 * knows that). Used to gate the context-free clarification fallback.
 */
export function isBareFollowUp(question: string): boolean {
  const q = lc(question);
  if (!q) return false;
  const words = q.replace(/[?.!,]/g, '').split(/\s+/).filter(Boolean);
  if (words.length > 6) return false; // a real, self-contained question
  return BARE_FOLLOWUP_RE.test(q) || ADDEND_RE.test(q);
}

// ── Refinement / editing follow-ups (task Phase 8, bug #3) ──────────────────────
// "make that shorter", "make it more confident", "remove the exaggeration", "give me
// the final spoken version", "shorten it", "rewrite that", "say it differently". These
// carry CONTENT WORDS (so they are NOT bare) but they OPERATE ON the prior answer — they
// make no sense without it. The manual path previously only injected conversation memory
// for BARE follow-ups, so these refinements dumped a fresh full answer (the real bug:
// "make that shorter" re-listed the whole profile). This detector lets the caller pull
// the prior turn for them too.
//
// Two shapes:
//  (a) "<edit verb> it/that/this …"  — operate on the referenced prior answer.
//  (b) a known standalone refinement ("shorten it", "the final version", "more confident").
const EDIT_VERB = '(?:make|keep|shorten|lengthen|expand|trim|cut|condense|tighten|rewrite|reword|rephrase|redo|simplify|soften|punch up|polish|clean up|fix|improve|remove|drop|delete|add|emphasi[sz]e|change|adjust|tweak|reduce|summari[sz]e|say|phrase|give me|turn (?:it|that|this) into)';
const REFINEMENT_RE = new RegExp(
  // (a) edit verb anywhere, with an "it/that/this/the <noun>" object or a comparative.
  `^(?:ok(?:ay)?,?\\s*|so,?\\s*|and,?\\s*|now,?\\s*|also,?\\s*)*${EDIT_VERB}\\b`,
  'i',
);
// Comparative/qualitative refinements that imply "than the prior answer".
const REFINEMENT_COMPARATIVE_RE = /\b(shorter|longer|briefer|tighter|punchier|simpler|clearer|more\s+\w+|less\s+\w+|the\s+(?:final|spoken|short|long|concise|polished|natural)\s+version|in\s+(?:one|two|three)\s+(?:line|lines|sentence|sentences)|as\s+bullets?|spoken version|final version)\b/i;
// Must reference the PRIOR ANSWER — a demonstrative pronoun, OR "the <answer-noun>" from a
// small allowlist of things an answer IS (NOT a generic "the <any noun>", which would treat
// a brand-new imperative like "add caching to the payment service" or "fix the bug in the
// auth handler" as a refinement — code-review HIGH 2026-06-15). A comparative edit also
// qualifies (it inherently means "vs the previous answer").
const PRIOR_PRONOUN_RE = /\b(it|that|this|those|them)\b/i;
const PRIOR_NOUN_RE = /\bthe\s+(answer|response|reply|intro|introduction|version|wording|phrasing|tone|exaggeration|claim|sentence|paragraph|opening|closing|ending|last\s+(?:line|part|bit|sentence)|first\s+(?:line|part|bit|sentence)|part|bit|pitch|summary|bullet|bullets|list|story|hook|point|points|wording)\b/i;
const refersPrior = (q: string): boolean => PRIOR_PRONOUN_RE.test(q) || PRIOR_NOUN_RE.test(q);

/**
 * Is `question` a REFINEMENT/editing follow-up that operates on the prior answer
 * ("make that shorter", "remove the exaggeration", "give me the final spoken version")?
 * SHAPE test only (the caller confirms a prior turn exists). Bounded to short messages
 * so a long, self-contained instruction is never mistaken for a refinement.
 */
export function isRefinementFollowUp(question: string): boolean {
  const q = lc(question);
  if (!q) return false;
  const words = q.replace(/[?.!,]/g, '').split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 9) return false;
  const hasEditVerb = REFINEMENT_RE.test(q);
  const hasComparative = REFINEMENT_COMPARATIVE_RE.test(q);
  // A refinement is: an edit verb that refers to the prior answer, OR a comparative/
  // version request (which inherently means "vs the previous answer").
  if (hasEditVerb && (refersPrior(q) || hasComparative)) return true;
  if (hasComparative && refersPrior(q)) return true;
  // Standalone comparative with no object but clearly relative ("shorter please",
  // "more confident", "the final version").
  if (hasComparative && words.length <= 5) return true;
  return false;
}

/**
 * A follow-up that should resolve against this session's prior turn — either a bare
 * fragment ("why?", "continue") OR a refinement/edit ("make that shorter"). Convenience
 * union for the manual conversation-memory gate.
 */
export function isSameSessionFollowUp(question: string): boolean {
  return isBareFollowUp(question) || isRefinementFollowUp(question);
}

/**
 * A safe, mode-appropriate clarification for a bare follow-up with NO resolvable
 * prior context. NEVER says "I'm Natively / an AI assistant", never dumps profile,
 * never refuses — it asks for the missing topic. Deterministic; no LLM.
 */
export function buildContextFreeClarification(surface?: FollowUpSurface): string {
  switch (surface) {
    case 'what_to_answer':
      return 'I need the previous question or topic to answer that — what was just asked?';
    case 'meeting':
      return "I don't have enough prior meeting context to resolve that follow-up — which point do you mean?";
    case 'lecture':
      return 'Which part of the lecture should I expand on?';
    case 'sales':
      return 'Which point should I expand on — the objection, the pricing, or something else?';
    case 'interview':
      return 'Could you clarify which question you want me to answer?';
    case 'coding':
      return 'Which part of the problem or solution should I expand on?';
    case 'manual':
    default:
      return 'Can you clarify what you want me to explain?';
  }
}

/**
 * Resolve a follow-up, returning a CLARIFICATION when it's a bare fragment with no
 * usable prior context. This is the caller-facing wrapper around `resolveFollowUp`:
 *   1. Try the normal single-prior-turn resolution.
 *   2. If that fails AND the fragment is bare AND there's no prior context, return a
 *      `context_free_clarification` result (confidence 1, a safe clarification text).
 *   3. Otherwise return NONE (caller keeps the extractor's routing).
 *
 * `hasPriorContext` is whatever the caller can establish: a previous interviewer
 * question, a last entity/skill, or a session-memory hit. When true we never emit a
 * clarification (the normal resolver already had its chance).
 */
export function resolveFollowUpOrClarify(
  ctx: FollowUpContext & { surface?: FollowUpSurface; hasPriorContext?: boolean },
): ResolvedFollowUp & { isClarification?: boolean; clarificationText?: string } {
  const normal = resolveFollowUp(ctx);
  const hasPrior = ctx.hasPriorContext
    || !!lc(ctx.previousQuestion)
    || !!ctx.lastEntity
    || !!ctx.lastSkill;
  // A HIGH-confidence resolution (>=0.7) always wins — it found a concrete answer.
  if (normal.confidence >= 0.7) return normal;
  // No prior context + a bare fragment → clarify, even if the resolver produced a
  // LOW-confidence guess (e.g. "what about data?" → a weak skill topic-shift). With
  // nothing to anchor to, a clarification is safer than a guessed topic.
  if (isBareFollowUp(ctx.latestQuestion) && !hasPrior) {
    const clarificationText = buildContextFreeClarification(ctx.surface);
    return {
      resolvedQuestion: clarificationText,
      resolvedAnswerType: 'unknown_answer',
      confidence: 1,
      reason: 'context_free_clarification',
      isClarification: true,
      clarificationText,
    };
  }
  // Otherwise keep whatever the normal resolver produced (a low-confidence guess WITH
  // prior context, or NONE).
  return normal;
}

const EXPAND_RE = /^(?:ok(?:ay)?,?\s*|so,?\s*|hmm,?\s*|right,?\s*)*(?:why|how so|how come|can you (?:expand|elaborate|go deeper)|expand|elaborate|tell me more|go on|continue|in more detail)\b[\s?.!]*$/i;
// "and <skill>?" / "what about <skill>?" — a topic shift to a new skill/tech.
const TOPIC_SHIFT_RE = /\b(?:and|what about|how about|what's your|and your)\s+([a-z0-9+#.\- ]{2,30}?)\s*\??$/i;

// Skill/tech tokens we recognise inside a topic-shift fragment.
const SKILL_TOKEN_RE = /\b(python|sql|java(?:script)?|typescript|react|node(?:\.?js)?|c\+\+|go(?:lang)?|rust|aws|gcp|azure|docker|kubernetes|graphql|rest|fastapi|django|flask|spring|pandas|numpy|spark|hadoop|tableau|power\s?bi|excel|tensorflow|pytorch|coding|backend|frontend|full[\s-]?stack|data|analytics|databases?|dashboards?|machine learning|ml|statistics?)\b/i;

const lc = (s?: string) => (s || '').trim().toLowerCase();

/** Did the previous turn establish a skill rating / skill experience subject? */
function prevWasSkill(ctx: FollowUpContext): boolean {
  const t = lc(ctx.previousQuestion);
  return ctx.previousAnswerType === 'skill_experience_answer'
    || ctx.previousAnswerType === 'skills_answer'
    || /\b(rate|out of (?:10|ten)|how (?:good|comfortable|proficient)|have you used|experience with|how have you used)\b/.test(t);
}
function prevWasCoding(ctx: FollowUpContext): boolean {
  return ctx.previousAnswerType === 'coding_question_answer' || ctx.previousAnswerType === 'dsa_question_answer'
    || /\b(solve|implement|write (?:code|a|the)|two sum|binary search|reverse|palindrome|leetcode)\b/.test(lc(ctx.previousQuestion));
}
function prevWasProject(ctx: FollowUpContext): boolean {
  return ctx.previousAnswerType === 'project_answer' || ctx.previousAnswerType === 'project_followup_answer'
    || !!ctx.lastEntity || /\bproject|built|developed|natively\b/.test(lc(ctx.previousQuestion));
}
function prevWasJdFit(ctx: FollowUpContext): boolean {
  return ctx.previousAnswerType === 'jd_fit_answer' || /\bfit|hire|role|why (?:this|you)|data analyst\b/.test(lc(ctx.previousQuestion));
}
function prevWasTechnicalConcept(ctx: FollowUpContext): boolean {
  return ctx.previousAnswerType === 'technical_concept_answer'
    || ctx.previousAnswerType === 'system_design_answer'
    || ctx.previousAnswerType === 'debugging_question_answer'
    || /\b(explain|what is|how does|difference between|bfs|dfs|deadlock|complexity|rest|graphql|index)\b/.test(lc(ctx.previousQuestion));
}

// A project DRILL-IN: a short fragment that asks HOW/WHY/WHAT about a project
// already on the table ("how is it developed?", "how was it built?", "that
// project?", "what stack?", "your role?"). Resolves to project_followup on the
// resolved entity (the prior turn's project).
const PROJECT_DRILLIN_RE = /^(?:ok(?:ay)?,?\s*|so,?\s*|and,?\s*)*(?:how (?:is|was|are|were) (?:it|that|this)|how (?:is|was) (?:it|that) (?:developed|built|made|designed|implemented)|that project|the project|what (?:stack|backend|database|tech)|your role|why did you build|how did you (?:build|make|optimi[sz]e))\b/i;

export function resolveFollowUp(ctx: FollowUpContext): ResolvedFollowUp {
  const q = lc(ctx.latestQuestion);
  if (!q) return NONE;
  // Long, self-contained questions are not bare follow-ups.
  const wordCount = q.split(/\s+/).filter(Boolean).length;
  if (wordCount > 8) return NONE;

  // 1. TOPIC SHIFT to a new skill/tech: "And SQL?", "what about Python?".
  const shift = q.match(TOPIC_SHIFT_RE);
  if (shift) {
    const skillRaw = shift[1].trim();
    const skillMatch = skillRaw.match(SKILL_TOKEN_RE);
    if (skillMatch && prevWasSkill(ctx)) {
      const skill = skillMatch[0];
      // Inherit the EXACT prior framing (rating vs experience) with the new skill.
      const wasRating = /\brate|out of (?:10|ten)|scale\b/.test(lc(ctx.previousQuestion));
      return {
        resolvedQuestion: wasRating ? `Rate your ${skill} skills out of 10.` : `What is your experience with ${skill}?`,
        resolvedAnswerType: 'skill_experience_answer',
        resolvedSkill: skill,
        confidence: 0.9,
        reason: 'topic_shift_skill',
      };
    }
    // "what about data?" after a JD-fit/role discussion → still a fit question.
    if (/\b(data|analytics|stakeholders?|metrics?)\b/.test(skillRaw) && prevWasJdFit(ctx)) {
      return {
        resolvedQuestion: `How does my ${skillRaw} experience fit this role?`,
        resolvedAnswerType: 'jd_fit_answer',
        confidence: 0.7,
        reason: 'topic_shift_jdfit',
      };
    }
    // "what about <skill>?" with a recognised skill but unclear prior → skill experience.
    if (skillMatch) {
      return {
        resolvedQuestion: `What is your experience with ${skillMatch[0]}?`,
        resolvedAnswerType: 'skill_experience_answer',
        resolvedSkill: skillMatch[0],
        confidence: 0.6,
        reason: 'topic_shift_skill_weak',
      };
    }
  }

  // 1b. PROJECT DRILL-IN: "how is it developed?", "that project?", "what stack?",
  //     "your role?" — about the project already on the table.
  if (PROJECT_DRILLIN_RE.test(q) && (ctx.lastEntity || prevWasProject(ctx))) {
    return {
      resolvedQuestion: ctx.lastEntity
        ? `${ctx.latestQuestion.replace(/\b(it|that|this)\b/i, ctx.lastEntity).trim()}`.replace(/\?*$/, '?')
        : 'Can you go deeper on that project?',
      resolvedAnswerType: 'project_followup_answer',
      resolvedEntity: ctx.lastEntity,
      confidence: 0.85,
      reason: 'project_drillin',
    };
  }

  // 2. EXPAND on the prior answer: "Why?", "How so?", "Can you expand?".
  if (EXPAND_RE.test(q)) {
    if (prevWasCoding(ctx)) {
      // "what about complexity?" / "why?" after a coding answer → coding/technical
      // follow-up, profile STILL forbidden.
      const aboutComplexity = /\bcomplexity\b/.test(q);
      return {
        resolvedQuestion: aboutComplexity
          ? `What is the time and space complexity of the previous solution?`
          : `Can you explain the previous solution in more detail?`,
        resolvedAnswerType: 'technical_concept_answer',
        confidence: 0.8,
        reason: 'expand_coding',
      };
    }
    if (prevWasProject(ctx)) {
      return {
        resolvedQuestion: ctx.lastEntity
          ? `Can you expand on ${ctx.lastEntity}?`
          : `Can you expand on that project?`,
        resolvedAnswerType: 'project_followup_answer',
        resolvedEntity: ctx.lastEntity,
        confidence: 0.75,
        reason: 'expand_project',
      };
    }
    if (prevWasJdFit(ctx)) {
      return { resolvedQuestion: `Can you expand on why you fit this role?`, resolvedAnswerType: 'jd_fit_answer', confidence: 0.7, reason: 'expand_jdfit' };
    }
    if (prevWasTechnicalConcept(ctx)) {
      // "Explain BFS." → "How so?" / "Why?" — expand the CONCEPT, profile still
      // forbidden. Use the prior question as the topic.
      return {
        resolvedQuestion: ctx.previousQuestion ? `Can you explain that in more detail: ${ctx.previousQuestion}` : 'Can you explain that in more detail?',
        resolvedAnswerType: 'technical_concept_answer',
        confidence: 0.7,
        reason: 'expand_technical',
      };
    }
    if (ctx.previousAnswerType) {
      return { resolvedQuestion: ctx.previousQuestion ? `Can you expand on: ${ctx.previousQuestion}` : `Can you expand on that?`, resolvedAnswerType: ctx.previousAnswerType, confidence: 0.6, reason: 'expand_inherit' };
    }
  }

  // 3. "what about complexity?" without an EXPAND lead but after coding.
  if (/\bcomplexity\b/.test(q) && prevWasCoding(ctx)) {
    return { resolvedQuestion: `What is the time and space complexity of the previous solution?`, resolvedAnswerType: 'technical_concept_answer', confidence: 0.8, reason: 'complexity_followup' };
  }

  // 4. "where?" / "where have you used it?" after a SKILL/experience probe — asks for
  //    concrete experience evidence for the skill on the table.
  if (/^(?:and\s+)?where\b[\s?.!]*$|^where have (?:you|i) used (?:it|that|this)\b/.test(q) && (prevWasSkill(ctx) || ctx.lastSkill || prevWasProject(ctx))) {
    const skill = ctx.lastSkill;
    return {
      resolvedQuestion: skill ? `Where have you used ${skill}?` : `Where have you applied that?`,
      resolvedAnswerType: 'skill_experience_answer',
      resolvedSkill: skill,
      confidence: 0.8,
      reason: 'where_skill_evidence',
    };
  }

  // 5. "how are you improving it?" / "how do you improve that?" after a weakness /
  //    behavioral turn — continues the behavioral story (self-improvement).
  if (/^how (?:are|do) (?:you|i) (?:improv|work|address|fix|develop|get better)\w*\b/.test(q)
    && (ctx.previousAnswerType === 'behavioral_interview_answer'
        || /\b(weakness|struggle|challenge|difficult|conflict|fail)\b/.test(lc(ctx.previousQuestion)))) {
    return {
      resolvedQuestion: `How are you improving on that?`,
      resolvedAnswerType: 'behavioral_interview_answer',
      confidence: 0.75,
      reason: 'behavioral_improvement_followup',
    };
  }

  return NONE;
}
