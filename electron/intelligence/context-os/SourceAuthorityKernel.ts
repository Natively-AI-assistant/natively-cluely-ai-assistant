// electron/intelligence/context-os/SourceAuthorityKernel.ts
//
// Context OS (Phase 3) — the deterministic kernel that converts
// (mode source authority × question × plan) into a TurnContextContract.
//
// Design invariants (source-authority-architect review contract):
//   1. AnswerType is NOT source ownership — the kernel takes answerShape only.
//   2. The MODE's sourceAuthority decides the default knowledge universe. The
//      kernel consumes the SAME `sourceAuthority` the legacy
//      buildCustomModeExecutionContract computes, so the two systems agree by
//      construction (no second arbiter to drift).
//   3. Every source entering a prompt must hold a capability from here.
//   4. Prior assistant answers are referent_only by default — never evidence.
//   5. Custom mode prompts are instruction-only, never evidence.
//   6. Profile persona is style-only.
//   7. JD is granted separately from resume (role requirements ≠ candidate claims).
//   8. Hindsight requires provenance before evidence; today it is at most
//      referent_only in mixed/transcript turns and forbidden elsewhere.
//   9. Browser/DOM/screen are untrusted; no capability by default.
//  10. Ambiguous general-mode questions resolve to sourceOwner='clarify'.
//
// The kernel is PURE: no LLMHelper, no SessionTracker, no DB. All inputs are
// passed by the caller. Deterministic — no Date.now()/randomness in decisions
// (turnId is identity only, never a decision input).

import { randomUUID } from 'crypto';
import type {
  AnswerShape,
  ConflictPolicy,
  EnforcementMode,
  SourceAuthority,
  SourceCapability,
  SourceKind,
  SourceOwner,
  TrustLevel,
  TurnContextContract,
  TurnSurface,
  VoicePerspective,
} from './types';
import { ALL_SOURCE_KINDS } from './sourceKinds';
import { detectRequestedProperty } from './requestedPropertyDetector';

export interface BuildTurnContractInput {
  surface: TurnSurface;
  question: string;
  activeModeId: string | null;
  activeModeName?: string | null;
  /** From buildCustomModeExecutionContract(...).sourceAuthority — the MODE decides. */
  sourceAuthority: SourceAuthority;
  answerShape: AnswerShape;
  voicePerspective: VoicePerspective;
  enforcement: EnforcementMode;
  hasReferenceFiles: boolean;
  hasProfileFacts: boolean;
  hasLiveTranscript: boolean;
  /** Explicit user source override ("answer from my resume instead"). */
  userExplicitSource?: 'reference_files' | 'profile' | 'transcript' | null;
}

// Nouns that can NAME a thing owned by a specific source universe (uploaded
// document / profile / meeting). In a general/ambiguous mode a question over
// one of these is clarified ONLY when >=2 universes actually exist (the primary
// H1 guard in resolveSourceOwner). This list keeps the source-owned NOUNS but
// drops the bare deictics/adjectives `this|that|it|current|latest` (H1 fix,
// code-review 2026-07-10) — those fire on ordinary general-knowledge questions
// ("what is the LATEST React version?", "how does IT work?") which, combined
// with the >=2-universe gate, would still wrongly clarify. Source-owned nouns
// like project/dataset/experiment only clarify when the ambiguity is real.
const AMBIGUOUS_SOURCE_TERM_RE =
  /\b(project|dataset|method|methodology|phase|stage|experiment|hardware|software|company|role|experience|deadline|model|system|result)\b/i;

// Explicit FIRST-PERSON-POSSESSIVE profile ask. "my best project", "my skills",
// "do I have X experience", "my résumé", "am I a good fit". The possessive/
// self-reference DISAMBIGUATES the owner to the candidate profile — so even in a
// general_mixed/ambiguous authority with a live transcript present, this must NOT
// clarify: "my project" is unambiguously the candidate's project, not the
// meeting's. Fixes the false-clarify on profile-mode questions (final
// verification 2026-07-11). SHAPE only — never an entity/company name.
const EXPLICIT_SELF_PROFILE_RE =
  /\b(?:my|mine|our)\b[\s\w-]{0,40}\b(?:resume|cv|profile|projects?|portfolio|experience|background|skills?|education|career|work\s+history|strengths?|weakness(?:es)?)\b|\b(?:do|have|am|are|was|is)\s+i\b[\s\w-]{0,40}\b(?:experience|worked|know|built|good\s+fit|qualified|suitable|fit\s+for)\b|\bwhy\s+(?:am\s+i|i\s+am)\b|\bwhat\s+are\s+my\b|\bwhat\s+is\s+my\b|\b(?:am|why\s+am)\s+i\s+(?:suitable|a\s+good\s+fit|qualified|fit)\b|\bsuitable\s+for\s+(?:this|the)\s+role\b/i;

/** Is this an explicit first-person-possessive ask about the candidate's own profile? */
export function isExplicitSelfProfileAsk(question: string): boolean {
  return EXPLICIT_SELF_PROFILE_RE.test(String(question || ''));
}

function trustLevelFor(sourceKind: SourceKind): TrustLevel {
  switch (sourceKind) {
    case 'system_instruction':
      return 'system';
    case 'mode_reference_file':
    case 'mode_reference_chunk':
    case 'okf_document_card':
      return 'user_uploaded';
    case 'profile_resume':
    case 'profile_project':
    case 'profile_jd':
    case 'profile_persona':
    case 'okf_profile_card':
      return 'profile_verified';
    case 'custom_profile_notes':
      return 'profile_unverified';
    case 'live_transcript':
    case 'meeting_rag_chunk':
      return 'transcript_observed';
    case 'browser_dom':
      return 'browser_untrusted';
    case 'screen_context':
      return 'screen_untrusted';
    case 'prior_assistant_message':
    case 'prior_assistant_claim':
      return 'assistant_generated';
    case 'hindsight_memory':
      return 'memory_unverified';
    case 'custom_mode_prompt':
      return 'user_uploaded';
    default:
      return 'memory_unverified';
  }
}

function isPiiKind(sourceKind: SourceKind): boolean {
  return sourceKind === 'profile_resume'
    || sourceKind === 'profile_project'
    || sourceKind === 'profile_jd'
    || sourceKind === 'profile_persona'
    || sourceKind === 'okf_profile_card'
    || sourceKind === 'custom_profile_notes';
}

function capability(
  sourceKind: SourceKind,
  authority: SourceCapability['authority'],
  reason: string,
  scopeId: string | null = null,
): SourceCapability {
  return {
    sourceKind,
    scopeId,
    authority,
    permissions: {
      retrieve: authority !== 'forbidden',
      quote: authority === 'evidence',
      useAsEvidence: authority === 'evidence',
      useForReferentResolution: authority === 'referent_only' || authority === 'evidence',
      writeBackToMemory: false,
    },
    trustLevel: trustLevelFor(sourceKind),
    pii: isPiiKind(sourceKind),
    issuedBy: 'SourceAuthorityKernel',
    reason,
  };
}

export class SourceAuthorityKernel {
  build(input: BuildTurnContractInput): TurnContextContract {
    const requestedProperty = detectRequestedProperty(input.question);
    const sourceOwner = this.resolveSourceOwner(input);

    const allowedSources = sourceOwner === 'clarify'
      ? this.baseInstructionCapabilities()
      : this.issueCapabilities(input, sourceOwner);
    const allowedKinds = new Set(allowedSources.map((s) => s.sourceKind));

    const forbiddenSources = ALL_SOURCE_KINDS.filter((s) => !allowedKinds.has(s));

    const referentOnlySources = allowedSources
      .filter((s) => s.authority === 'referent_only')
      .map((s) => s.sourceKind);

    return {
      turnId: randomUUID(),
      surface: input.surface,
      activeModeId: input.activeModeId,
      activeModeName: input.activeModeName ?? null,
      answerShape: input.answerShape,
      sourceOwner,
      requestedProperty,
      voicePerspective: input.voicePerspective,
      allowedSources,
      forbiddenSources,
      referentOnlySources,
      conflictPolicy: this.conflictPolicyFor(input.sourceAuthority),
      memoryReadPolicy: {
        // Hindsight is at most a secondary layer for profile/transcript/mixed
        // owners; NEVER for reference_files (doc-grounded strict isolation).
        allowHindsight:
          sourceOwner === 'profile' || sourceOwner === 'transcript' || sourceOwner === 'mixed',
        // Invariant 4: prior assistant facts are never readable by default.
        allowPriorAssistantFacts: false,
        allowPriorAssistantReferents: true,
      },
      memoryWritePolicy: {
        allowAssistantMessage: true,
        allowVerifiedClaims: true,
        allowUnverifiedClaims: false,
      },
      enforcement: input.enforcement,
      reason: `sourceAuthority=${input.sourceAuthority}; requestedProperty=${requestedProperty}`,
    };
  }

  // ── Source owner resolution ────────────────────────────────────────────────

  private resolveSourceOwner(input: BuildTurnContractInput): SourceOwner {
    // An explicit user source reference beats the mode default only when the
    // MODE's authority does not strictly forbid that source. In a strict
    // reference-file or transcript mode, an explicit "my resume" ask must
    // CLARIFY (source-honest switch offer, matching the legacy resolver's
    // shouldClarifyInsteadOfProfile) — never silently grant the profile.
    // `reference_files_primary` is the one authority that explicitly ALLOWS a
    // profile switch (unlike `reference_files_only`/`_plus_transcript`, which
    // must clarify instead of silently granting it) — see
    // docs/context-os/real-custom-mode-repair/05_PRODUCT_SOURCE_POLICY.md.
    const strictNonProfileMode = input.sourceAuthority === 'reference_files_only'
      || input.sourceAuthority === 'reference_files_plus_transcript'
      || input.sourceAuthority === 'transcript_only';
    if (input.userExplicitSource === 'profile') {
      if (strictNonProfileMode) return 'clarify';
      return input.hasProfileFacts ? 'profile' : 'clarify';
    }
    if (input.userExplicitSource === 'reference_files') {
      return input.hasReferenceFiles ? 'reference_files' : 'clarify';
    }
    // 'transcript' as explicit source keeps the mode-driven resolution below —
    // the legacy contract already folds it into reference_files_plus_transcript.

    switch (input.sourceAuthority) {
      case 'reference_files_only':
      case 'reference_files_primary':
      case 'reference_files_plus_transcript':
        return input.hasReferenceFiles ? 'reference_files' : 'clarify';

      case 'profile_only':
      case 'profile_plus_transcript':
        return input.hasProfileFacts ? 'profile' : 'clarify';

      case 'transcript_only':
        return input.hasLiveTranscript ? 'transcript' : 'clarify';

      case 'general_mixed':
      case 'ask_if_ambiguous':
      default: {
        // An explicit first-person-possessive profile ask ("my best project",
        // "what are my skills", "do I have K8s experience") is UNAMBIGUOUS: the
        // possessive names the candidate's own profile. Resolve to profile (when
        // facts exist) — never clarify. Fixes false-clarify on profile-mode
        // questions (final verification 2026-07-11).
        if (input.hasProfileFacts && isExplicitSelfProfileAsk(input.question)) {
          return 'profile';
        }
        // Clarify ONLY when the ambiguity is REAL: the question names a
        // source-owned thing AND at least TWO source universes actually exist
        // for it to be ambiguous BETWEEN (H1 fix, code-review 2026-07-10).
        // With zero or one universe there is nothing to disambiguate — answer
        // normally. This stops false-clarify on ordinary general-knowledge
        // questions.
        const universeCount = (input.hasReferenceFiles ? 1 : 0)
          + (input.hasProfileFacts ? 1 : 0)
          + (input.hasLiveTranscript ? 1 : 0);
        if (universeCount >= 2 && AMBIGUOUS_SOURCE_TERM_RE.test(input.question)) {
          return 'clarify';
        }
        return 'unknown';
      }
    }
  }

  // ── Capability issuance ────────────────────────────────────────────────────

  /** Instructions always flow; facts never do without an owner. */
  private baseInstructionCapabilities(): SourceCapability[] {
    return [
      capability('system_instruction', 'instruction', 'system instruction is always allowed'),
      capability('custom_mode_prompt', 'instruction', 'mode prompt may shape behavior, not facts'),
    ];
  }

  private issueCapabilities(
    input: BuildTurnContractInput,
    sourceOwner: SourceOwner,
  ): SourceCapability[] {
    const caps: SourceCapability[] = this.baseInstructionCapabilities();

    if (sourceOwner === 'reference_files') {
      caps.push(capability('mode_reference_file', 'evidence', 'reference files own this turn', input.activeModeId));
      caps.push(capability('mode_reference_chunk', 'evidence', 'reference chunks own this turn', input.activeModeId));
      caps.push(capability('okf_document_card', 'evidence', 'document OKF cards support reference file answers', input.activeModeId));
      if (input.hasLiveTranscript) {
        // In reference_files_plus_transcript the transcript is a peer evidence
        // source; in reference_files_only it may only resolve pronouns.
        const transcriptAuthority = input.sourceAuthority === 'reference_files_plus_transcript'
          ? 'evidence' as const
          : 'referent_only' as const;
        caps.push(capability('live_transcript', transcriptAuthority,
          transcriptAuthority === 'evidence'
            ? 'mode grants transcript as peer evidence'
            : 'transcript can resolve pronouns only'));
      }
      caps.push(capability('prior_assistant_message', 'referent_only', 'prior assistant can resolve references only'));
      return caps;
    }

    if (sourceOwner === 'profile') {
      caps.push(capability('profile_resume', 'evidence', 'profile owns this turn'));
      caps.push(capability('profile_project', 'evidence', 'profile projects own this turn'));
      caps.push(capability('okf_profile_card', 'evidence', 'profile OKF cards support profile answer'));
      // Invariant 7: the JD proves ROLE REQUIREMENTS, not candidate claims —
      // granted as evidence but validators must keep role_requirement facts
      // out of candidate_experience claims (Phase 5/13).
      caps.push(capability('profile_jd', 'evidence', 'JD supports role-fit framing; JD facts are role requirements, never candidate claims'));
      caps.push(capability('profile_persona', 'style', 'persona is style only'));
      caps.push(capability('custom_profile_notes', 'evidence', 'custom notes are user-provided weak profile context'));
      if (input.hasLiveTranscript) {
        caps.push(capability('live_transcript', 'referent_only', 'transcript provides the interviewer question, not candidate facts'));
      }
      caps.push(capability('prior_assistant_message', 'referent_only', 'prior assistant can resolve references only'));
      return caps;
    }

    if (sourceOwner === 'transcript') {
      caps.push(capability('live_transcript', 'evidence', 'transcript owns this turn'));
      caps.push(capability('meeting_rag_chunk', 'evidence', 'meeting RAG supports transcript turn', input.activeModeId));
      caps.push(capability('prior_assistant_message', 'referent_only', 'prior assistant can resolve references only'));
      return caps;
    }

    if (sourceOwner === 'mixed') {
      // Strict mixed: profile answers candidate-side questions; transcript
      // provides question context. Mixed does NOT mean "everything".
      caps.push(capability('profile_resume', 'evidence', 'profile can answer candidate-side question'));
      caps.push(capability('profile_project', 'evidence', 'profile project evidence allowed'));
      caps.push(capability('profile_jd', 'evidence', 'JD supports target-role framing only'));
      caps.push(capability('profile_persona', 'style', 'persona is style only'));
      if (input.hasLiveTranscript) {
        caps.push(capability('live_transcript', 'evidence', 'transcript is a peer source in mixed ownership'));
      }
      caps.push(capability('prior_assistant_message', 'referent_only', 'prior assistant can resolve references only'));
      return caps;
    }

    // sourceOwner === 'unknown' (general mode, unambiguous question): keep the
    // grants conservative — profile only when facts exist, transcript as
    // referent. Screen/browser/Hindsight/prior-claims stay ungranted.
    if (input.hasProfileFacts) {
      caps.push(capability('profile_resume', 'evidence', 'general mode: profile facts available'));
      caps.push(capability('profile_project', 'evidence', 'general mode: profile projects available'));
      caps.push(capability('profile_persona', 'style', 'persona is style only'));
    }
    if (input.hasLiveTranscript) {
      caps.push(capability('live_transcript', 'referent_only', 'general mode: transcript for context only'));
    }
    caps.push(capability('prior_assistant_message', 'referent_only', 'prior assistant can resolve references only'));
    return caps;
  }

  private conflictPolicyFor(sourceAuthority: SourceAuthority): ConflictPolicy {
    switch (sourceAuthority) {
      case 'reference_files_only':
      case 'reference_files_primary':
      case 'reference_files_plus_transcript':
        return 'reference_files_win';
      case 'profile_only':
      case 'profile_plus_transcript':
        return 'profile_wins';
      case 'transcript_only':
        return 'transcript_wins';
      default:
        return 'ask_clarification';
    }
  }
}

/**
 * The clarification the assistant asks when sourceOwner === 'clarify' in a
 * general/ambiguous mode (Scenario C). Deterministic — never contains any
 * entity, document, or profile content, so it can never itself leak.
 */
export function buildAmbiguousSourceClarification(): string {
  return 'Do you mean the project in your uploaded document, your profile/resume project, or the project discussed in the meeting?';
}

/**
 * Source-aware clarification (Phase 4): only offers the universes that actually
 * exist this turn. `available` is derived from the same has* signals the kernel
 * used, so we never offer "the meeting" when there is no transcript or "your
 * resume" when no profile is loaded. Deterministic; carries no entity content.
 */
export function buildSourceClarification(available: {
  hasReferenceFiles: boolean;
  hasProfileFacts: boolean;
  hasLiveTranscript: boolean;
}): string {
  const options: string[] = [];
  if (available.hasReferenceFiles) options.push('the project in your uploaded document');
  if (available.hasProfileFacts) options.push('your profile/resume project');
  if (available.hasLiveTranscript) options.push('the project discussed in the meeting');

  if (options.length <= 1) {
    // Only one (or zero) plausible source — nothing to disambiguate. Ask a
    // generic, source-honest clarification without inventing options.
    return 'Which project do you mean? Point me at the specific source and I\'ll answer from it.';
  }
  if (options.length === 2) {
    return `Do you mean ${options[0]}, or ${options[1]}?`;
  }
  return `Do you mean ${options.slice(0, -1).join(', ')}, or ${options[options.length - 1]}?`;
}
