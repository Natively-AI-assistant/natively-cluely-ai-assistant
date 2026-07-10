// electron/llm/sourceOwnership.ts
//
// Custom-Mode Source Disambiguation (2026-07-06).
//
// THE single place that answers, per turn: "given the active mode's SOURCE
// AUTHORITY, which source owns the ambiguous nouns in this question, and is the
// user's profile allowed to answer it AT ALL?"
//
// This exists because the leak reported in
// docs/CUSTOM_MODE_SOURCE_AMBIGUITY_INVESTIGATION.md is a source-ownership
// failure: the deterministic profile fast-path was gated by a brittle
// answer-type check (`answerType !== 'lecture_answer'`) that missed the five
// OTHER document answer shapes, so "What are the four main phases of the
// project?" (→ list_answer) leaked "My project Natively…" over the uploaded
// file.
//
// The resolver is intentionally GENERAL and PURE:
//   - It reads `contract.sourceAuthority` (already resolved by the
//     SourceArbiter from the active MODE — not from the question's wording), so
//     the decision follows the mode's contract, not per-entity/per-thesis
//     keyword lists.
//   - `explicitProfileAsk` detects only the GENERIC first-person-possessive
//     SHAPE ("my resume", "my project", "from my background") — it never looks
//     for a specific project name. It answers "did the user claim ownership?",
//     not "did they mention Natively?".
//   - No document terms, no company names, no question strings are hardcoded.
//
// Consumed by: the manual gemini-chat-stream fast-path gate, the OKF
// profile-evidence gate, the phone-mirror path, and the WTA path — so every
// answer producer shares ONE ownership decision.

import type { CustomModeExecutionContract } from './customModeExecutionContract';

export type SourceOwner =
  | 'reference_files'
  | 'profile'
  | 'transcript'
  | 'mixed'
  | 'unknown';

export type ProfilePolicyLike = 'required' | 'allowed' | 'forbidden';

export interface SourceOwnershipDecision {
  /** Which source owns the ambiguous nouns in this question, this turn. */
  owner: SourceOwner;
  /** May the deterministic profile fast-path / profile evidence run this turn? */
  profileAllowed: boolean;
  /** Did the user explicitly claim ownership ("my resume / my project / from my …")? */
  explicitProfileAsk: boolean;
  /**
   * True when the mode's authority forbids profile BUT the user explicitly asked
   * a profile question — the caller should emit a source-honest clarification /
   * offer-to-switch line instead of either leaking the profile OR giving an odd
   * "not in the document" refusal.
   */
  shouldClarifyInsteadOfProfile: boolean;
  /** Machine-readable reason for telemetry/logs (no raw content). */
  reason: string;
}

export interface ResolveSourceOwnershipInput {
  question: string;
  contract: Pick<CustomModeExecutionContract, 'sourceAuthority'>;
  /** The AnswerPlan's per-answer-type profile policy (the built-in-mode fallback). */
  profileContextPolicy: ProfilePolicyLike;
  answerType: string;
  /** Whether the user actually has structured profile facts loaded. */
  hasProfileFacts?: boolean;
}

// ── Explicit ownership shape (GENERAL — never an entity name) ────────────────
//
// Matches a first-person possessive over a profile-ish noun: "my resume",
// "your project", "from my background", "my skills", "our experience". The
// second-person "your" is included because in a rehearsal/interview surface the
// user addresses themselves as "you". This detects the SHAPE of a profile claim,
// not any specific project/company.
const EXPLICIT_PROFILE_POSSESSIVE_RE =
  /\b(?:my|mine|our|your)\b[\s\w-]{0,40}\b(?:resume|cv|profile|projects?|portfolio|experience|background|skills?|education|career|work\s+history|job\s+description|jd)\b/i;
// "from my resume", "on my cv", "in my profile", "according to my background".
const EXPLICIT_PROFILE_PREPOSITIONAL_RE =
  /\b(?:from|on|in|per|according\s+to|based\s+on|using)\s+(?:my|mine|our)\b[\s\w-]{0,20}\b(?:resume|cv|profile|projects?|portfolio|experience|background|skills?|education|career)\b/i;

/** Does the question explicitly claim first-person ownership of profile material? */
export function isExplicitProfileAsk(question: string): boolean {
  const q = String(question || '');
  return EXPLICIT_PROFILE_POSSESSIVE_RE.test(q) || EXPLICIT_PROFILE_PREPOSITIONAL_RE.test(q);
}

/**
 * Resolve which source owns this turn and whether the profile may answer it.
 *
 * The authority comes from the MODE (contract.sourceAuthority). The question's
 * wording only affects `explicitProfileAsk`, which upgrades a forbidden-profile
 * turn from a silent block into a clarify-and-offer-to-switch response.
 */
export function resolveSourceOwnership(input: ResolveSourceOwnershipInput): SourceOwnershipDecision {
  const { question, contract, profileContextPolicy } = input;
  const authority = contract?.sourceAuthority ?? 'ask_if_ambiguous';
  const explicitProfileAsk = isExplicitProfileAsk(question);
  const hasProfileFacts = input.hasProfileFacts !== false; // default optimistic; caller narrows

  switch (authority) {
    case 'reference_files_only':
    case 'reference_files_plus_transcript': {
      // Uploaded material owns ambiguous nouns. Profile is never the source.
      // An explicit "my resume/project" ask → clarify + offer to switch, so the
      // user gets a source-honest answer instead of a leak OR an odd refusal.
      return {
        owner: 'reference_files',
        profileAllowed: false,
        explicitProfileAsk,
        shouldClarifyInsteadOfProfile: explicitProfileAsk,
        reason: explicitProfileAsk
          ? `${authority}:explicit_profile_ask_clarify`
          : `${authority}:reference_files_owner`,
      };
    }
    case 'reference_files_primary': {
      // Real-custom-mode-repair: unlike `reference_files_only`, this
      // authority explicitly ALLOWS a switch — an explicit "my resume/
      // project" ask grants the profile for THIS turn (mode default stays
      // reference_files for the next turn, per ModeSourceContract semantics
      // in docs/context-os/real-custom-mode-repair/05_PRODUCT_SOURCE_POLICY.md).
      return {
        owner: explicitProfileAsk && hasProfileFacts ? 'profile' : 'reference_files',
        profileAllowed: explicitProfileAsk && hasProfileFacts,
        explicitProfileAsk,
        shouldClarifyInsteadOfProfile: explicitProfileAsk && !hasProfileFacts,
        reason: explicitProfileAsk
          ? (hasProfileFacts ? `${authority}:explicit_profile_switch_granted` : `${authority}:explicit_profile_ask_no_facts_clarify`)
          : `${authority}:reference_files_owner`,
      };
    }
    case 'profile_only': {
      return {
        owner: 'profile',
        profileAllowed: true,
        explicitProfileAsk,
        shouldClarifyInsteadOfProfile: false,
        reason: 'profile_only:profile_owner',
      };
    }
    case 'profile_plus_transcript': {
      // Profile is a valid owner; transcript may also. Treat this as mixed so
      // downstream prompt/memory gates know neither source class should silently
      // override the other.
      return {
        owner: 'mixed',
        profileAllowed: true,
        explicitProfileAsk,
        shouldClarifyInsteadOfProfile: false,
        reason: 'profile_plus_transcript:mixed_owner_profile_allowed',
      };
    }
    case 'transcript_only': {
      return {
        owner: 'transcript',
        profileAllowed: false,
        explicitProfileAsk,
        // Transcript mode with an explicit profile ask: clarify rather than
        // dump the résumé into a meeting.
        shouldClarifyInsteadOfProfile: explicitProfileAsk,
        reason: explicitProfileAsk
          ? 'transcript_only:explicit_profile_ask_clarify'
          : 'transcript_only:transcript_owner',
      };
    }
    case 'general_mixed': {
      const profileAllowed = profileContextPolicy !== 'forbidden' && hasProfileFacts;
      return {
        owner: profileAllowed ? 'mixed' : 'unknown',
        profileAllowed,
        explicitProfileAsk,
        shouldClarifyInsteadOfProfile: false,
        reason: `${authority}:defer_to_answer_plan_policy(${profileContextPolicy})`,
      };
    }
    case 'ask_if_ambiguous':
    default: {
      const profileAllowed = profileContextPolicy !== 'forbidden' && hasProfileFacts;
      return {
        owner: profileAllowed ? 'profile' : 'unknown',
        profileAllowed,
        explicitProfileAsk,
        shouldClarifyInsteadOfProfile: false,
        reason: `${authority}:defer_to_answer_plan_policy(${profileContextPolicy})`,
      };
    }
  }
}

// ── Source-honest clarification line ────────────────────────────────────────
//
// Emitted when `shouldClarifyInsteadOfProfile` is true. General wording — names
// the active source class ("uploaded material" / "this meeting"), never a
// specific document or project. Kept deterministic so it never itself leaks.
export function buildSourceSwitchClarification(owner: SourceOwner): string {
  if (owner === 'transcript') {
    return "This mode answers from the current conversation, not your saved profile. Switch to a profile or interview mode and I'll answer from your résumé.";
  }
  if (owner === 'mixed') {
    return "This mode has multiple possible sources, so I need a clearer source before using your résumé for that.";
  }
  // reference_files / unknown (default)
  return "This mode only answers from your uploaded material, so I'm not pulling from your résumé here. Switch to a profile or interview mode and I'll answer about your own projects and experience.";
}
