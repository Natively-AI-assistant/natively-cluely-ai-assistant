// electron/llm/sessionFollowupResolver.ts
//
// Bridges SessionMemory (long-range, mode-aware, time-aware entity memory) with the
// single-prior-turn FollowUpResolver (release 2026-06-07c). This is the piece that
// resolves "what was the hardest part of THAT PROJECT?" at minute 62 back to a
// project mentioned at minute 1 — something the transcript-window resolver alone
// cannot do.
//
// Flow for a follow-up turn:
//   1. Build a SessionMemory from the session's prior turns (caller supplies the
//      entity notes — extraction stays in the transcript layer).
//   2. If the current question references an entity by demonstrative ("that
//      project", "there", "it", "that company"), recall the salient same-kind item
//      from memory (respecting mode boundaries + corrections + decay).
//   3. Hand the recalled entity to resolveFollowUpOrClarify as `lastEntity`, so the
//      normal resolver produces a concrete, correctly-routed question.
//   4. If nothing recalls AND it's a bare fragment, the clarification fallback fires.
//
// Pure + deterministic. No LLM. The caller owns entity extraction + the memory store.

import { resolveFollowUpOrClarify, type FollowUpSurface } from './FollowUpResolver';
import type { ResolvedFollowUp } from './FollowUpResolver';
import { SessionMemory, type MemoryMode, type MemoryItemKind } from './SessionMemory';
import type { AnswerType } from './AnswerPlanner';

// Demonstrative references that point at a remembered entity of a given kind.
const PROJECT_REF_RE = /\b(that|this|the|your earlier|your first|the previous)\s+(project|app|product|thing you built|system|one|example|internship|company|role)\b|\bthe one you mentioned\b|\bthe (first|second|last) one\b|\byour earlier (example|project|one)\b|\b(it|that|there)\b/i;
const COMPANY_REF_RE = /\b(that|this|the)\s+(company|customer|client|account|prospect)\b|\bthey\b|\bthem\b/i;
const SKILL_REF_RE = /\b(that|that one|in that)\b/i; // "how strong are you in that?" after a skill
const TOPIC_REF_RE = /\b(that|this|there|that concept|that topic|the same|the key idea|that idea)\b/i;
const PERSON_REF_RE = /\b(that|who)\b/i;

export interface SessionFollowupInput {
  /** The current (possibly bare/demonstrative) question. */
  latestQuestion: string;
  /** The immediately-prior interviewer/speaker question, if any. */
  previousQuestion?: string;
  /** The prior turn's planned answer type, if known. */
  previousAnswerType?: AnswerType;
  /** A skill already on the table (e.g. "FastAPI" from "have you used FastAPI?"). */
  lastSkill?: string;
  /** Current session time (seconds) for decay. */
  now: number;
  /** Active mode (gates which memory kinds are visible). */
  mode: MemoryMode;
  /** Surface (for the clarification text). */
  surface?: FollowUpSurface;
  /** The session's memory store (caller-populated from prior turns). */
  memory: SessionMemory;
  /** The kind of entity the follow-up is most likely about (caller hint). When
   *  omitted we infer from the prior answer type / question demonstratives. */
  expectedKind?: MemoryItemKind;
  /** The user EXPLICITLY crossed a mode boundary ("have you used this in Natively?"). */
  explicitCrossMode?: boolean;
}

export interface SessionFollowupResult extends ResolvedFollowUp {
  isClarification?: boolean;
  clarificationText?: string;
  /** The entity recalled from long-range memory (if any). */
  recalledEntity?: string;
  /** Age of the recalled entity (seconds) — for telemetry / scoring by context-age. */
  recalledAgeSeconds?: number;
  /** Where the resolution came from. */
  resolvedVia: 'session_memory' | 'prior_turn' | 'clarification' | 'none';
}

/** Infer the memory kind a demonstrative follow-up most likely refers to. */
function inferKind(input: SessionFollowupInput): MemoryItemKind | null {
  if (input.expectedKind) return input.expectedKind;
  const q = (input.latestQuestion || '').toLowerCase();
  const prev = input.previousAnswerType;
  // A SKILL-proficiency probe ("how strong/good/proficient are you in/at that?",
  // "rate that out of 10") is unambiguously about the skill on the table, even right
  // after a project turn — so it must win over the project rules below. (Excludes the
  // generic status follow-up "how is that going?", which is not a proficiency probe —
  // code-review 2026-06-08.)
  if (/\bhow (?:strong|good|proficient|skilled|comfortable|experienced) are you (?:in|at|with)\b|\brate (?:that|it|your)\b.*\b(?:out of|skill)|\bhow (?:is|are) (?:that|your) skill\b/.test(q)) return 'skill';
  // "who owns / who is responsible / who is taking / what is the action item" → a
  // meeting decision/owner.
  if (/\bwho (owns|is responsible|is taking|has|will (do|own|handle))\b|\bwho'?s (the )?owner\b|\baction items?\b|\bwho owns (that|it|the)\b/.test(q)) return 'decision';
  // "why is it your best?" / "why is that your best project?" → the best PROJECT.
  if (/\b(your|the) best (project|one)\b|\bwhy is (it|that) your best\b|\bis (it|that) your best\b/.test(q)) return 'project';
  if (PROJECT_REF_RE.test(q) && (prev === 'project_answer' || prev === 'project_followup_answer' || prev === 'project_about_answer' || /project|built|that project|hardest part|tech stack|architecture/.test(q))) return 'project';
  if (COMPANY_REF_RE.test(q)) return 'company';
  if (prev === 'skill_experience_answer' || prev === 'skills_answer') return 'skill';
  if (prev === 'technical_concept_answer' || prev === 'lecture_answer') return 'topic';
  // "explain that (with an example)" / "give an example of that" → the lecture/tech
  // TOPIC on the table (covers lecture follow-ups where prev wasn't yet typed).
  if (/\b(explain|give (me )?an example of|elaborate on|expand on|tell me more about) (that|this|it)\b/.test(q)) return 'topic';
  if (prev === 'general_meeting_answer') return 'decision';
  // "the hardest part of that", "your role in that" → a project drill-in.
  if (/\b(hardest part|your role|the role|tech stack|architecture)\b.*\b(that|it|there)\b|\b(that|it|there)\b/.test(q) && /\bhardest|role|stack|architecture|build|part\b/.test(q)) return 'project';
  // default: a generic "that project" assumption is the most common interview case
  if (/\bthat project|\bthere\b|\bthe project\b/.test(q)) return 'project';
  return null;
}

/**
 * Resolve a follow-up using BOTH long-range session memory and the single-prior-turn
 * resolver. Recall a remembered entity when the question references one
 * demonstratively, then let the normal resolver produce the concrete question.
 */
export function resolveSessionFollowup(input: SessionFollowupInput): SessionFollowupResult {
  const kind = inferKind(input);
  let recalledEntity: string | undefined;
  let recalledAgeSeconds: number | undefined;

  if (kind) {
    const recall = input.memory.recall({
      now: input.now,
      kind,
      mode: input.mode,
      explicitCrossMode: input.explicitCrossMode,
    });
    if (recall.item) {
      recalledEntity = recall.item.value;
      recalledAgeSeconds = recall.ageSeconds;
    }
  }

  // LONG-RANGE DIRECT RESOLUTION: when memory recalled an entity AND the question
  // demonstratively references that kind ("that project", "there", "it", "that
  // company"), substitute the demonstrative with the recalled entity and route on its
  // kind. This handles self-contained-but-referential follow-ups ("what was the
  // hardest part of THAT PROJECT?") that the bare-fragment resolver doesn't cover.
  if (recalledEntity && kind) {
    const refRe = kind === 'project' ? PROJECT_REF_RE
      : kind === 'company' ? COMPANY_REF_RE
      : kind === 'skill' ? SKILL_REF_RE
      : kind === 'topic' ? TOPIC_REF_RE
      : kind === 'person' ? PERSON_REF_RE
      // a decision/owner follow-up ("who owns that?", "who owns the follow-up?") —
      // any of these reference the meeting decision on the table.
      : kind === 'decision' ? /\bwho (owns|is|has|will)\b|\bthat\b|\bthe (follow[- ]?up|migration|task|action item)\b/i
      : null;
    if (refRe && refRe.test(input.latestQuestion)) {
      const at: AnswerType =
        kind === 'project' ? 'project_followup_answer'
        : kind === 'skill' ? 'skill_experience_answer'
        : kind === 'topic' ? 'technical_concept_answer'
        : kind === 'company' || kind === 'person' || kind === 'decision' ? 'general_meeting_answer'
        : 'project_followup_answer';
      // Replace ONLY THE FIRST demonstrative phrase with the entity, exactly once, so
      // we never double-substitute or mangle grammar (code-review 2026-06-07c). Ordered
      // most-specific-first; the first pattern that matches wins and we stop.
      const SUBSTITUTIONS: Array<[RegExp, string]> = [
        [/\bthe one you mentioned( earlier)?\b/i, recalledEntity],
        [/\byour earlier (example|project|one)\b/i, recalledEntity],
        [/\bthe (first|second|last) one\b/i, recalledEntity],
        // "the architecture/stack/role/part of that <noun>" → "... of <entity>"
        [/\b(that|this|the)\s+(project|app|product|system|company|customer|client|account|prospect|concept|topic|one|internship|role)\b/i, recalledEntity],
        [/\bthe key idea (there|here)?\b/i, `the key idea of ${recalledEntity}`],
        // "the architecture/stack/role/part ... there" → "... of <entity>"
        [/\b(architecture|stack|backend|frontend|role|part|design|tech|team|hardest part)\s+(there|here)\b/i, `$1 of ${recalledEntity}`],
        // bare pronoun fallback
        [/\b(it|that|there)\b/i, recalledEntity],
      ];
      let resolvedQuestion = input.latestQuestion;
      for (const [re, rep] of SUBSTITUTIONS) {
        if (re.test(resolvedQuestion)) { resolvedQuestion = resolvedQuestion.replace(re, rep); break; }
      }
      // Tidy: collapse an accidental "X X" (entity already present) and fix "the <Entity>"
      // → "<Entity>" for proper nouns, then normalize trailing punctuation.
      resolvedQuestion = resolvedQuestion
        .replace(new RegExp(`\\b${recalledEntity}\\s+${recalledEntity}\\b`, 'gi'), recalledEntity)
        .replace(/\?*\s*$/, '?')
        .replace(/\s{2,}/g, ' ')
        .trim();
      return {
        resolvedQuestion,
        resolvedAnswerType: at,
        resolvedEntity: recalledEntity,
        confidence: 0.85,
        reason: 'session_memory_entity',
        recalledEntity,
        recalledAgeSeconds,
        resolvedVia: 'session_memory',
      };
    }
  }

  const resolved = resolveFollowUpOrClarify({
    latestQuestion: input.latestQuestion,
    previousQuestion: input.previousQuestion,
    previousAnswerType: input.previousAnswerType,
    lastSkill: input.lastSkill,
    lastEntity: recalledEntity,
    surface: input.surface,
    // We HAVE prior context if memory recalled an entity OR a prior turn exists — so
    // the clarification only fires when truly nothing is available.
    hasPriorContext: Boolean(recalledEntity) || Boolean((input.previousQuestion || '').trim()),
  });

  let resolvedVia: SessionFollowupResult['resolvedVia'] = 'none';
  if (resolved.isClarification) resolvedVia = 'clarification';
  else if (recalledEntity && (resolved.resolvedEntity === recalledEntity || resolved.confidence > 0)) resolvedVia = 'session_memory';
  else if (resolved.confidence > 0) resolvedVia = 'prior_turn';

  return { ...resolved, recalledEntity, recalledAgeSeconds, resolvedVia };
}
