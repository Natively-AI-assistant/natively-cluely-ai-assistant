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

// Terms whose owner depends entirely on the active source authority. In
// general/ambiguous modes a question containing one of these has no canonical
// owner → clarify. Mirrors the ambiguous-term table in the current-state
// report §17.2 (deictic pronouns included).
const AMBIGUOUS_SOURCE_TERM_RE =
  /\b(project|system|model|dataset|method|phase|stage|result|experiment|hardware|software|company|role|experience|current|latest|this|that|it)\b/i;

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
      case 'reference_files_plus_transcript':
        return input.hasReferenceFiles ? 'reference_files' : 'clarify';

      case 'profile_only':
      case 'profile_plus_transcript':
        return input.hasProfileFacts ? 'profile' : 'clarify';

      case 'transcript_only':
        return input.hasLiveTranscript ? 'transcript' : 'clarify';

      case 'general_mixed':
      case 'ask_if_ambiguous':
      default:
        // No single canonical universe. A question over an ambiguous term has
        // no owner → ask instead of guessing (Scenario C).
        return AMBIGUOUS_SOURCE_TERM_RE.test(input.question) ? 'clarify' : 'unknown';
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
