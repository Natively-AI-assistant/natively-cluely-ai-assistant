// electron/llm/turnSourceDecision.ts
//
// Lossless per-turn interpretation of a persisted ModeSourceContract.
// `sourceAuthority` describes the default owner; allowedExplicitSwitches is
// the user's exact permission set for explicit source requests.
//
// This module is the canonical AUTHORITY for "what sources does this
// turn consume" — every answer surface (manual chat, WTA, phone mirror,
// recap/follow-up) reads the resulting decision before any profile/JD/
// reference retrieval runs.
//
// Four invariants this module MUST preserve:
//   1. Selecting a switch that is NOT in allowedExplicitSwitches denies the
//      grant (resolution reason: 'explicit_switch_not_enabled'). Prompt
//      wording never overrides the persisted allowlist.
//   2. An explicit unavailable source (no résumé, no JD) fails closed with
//      'source_unavailable' — not silently downgraded to the default.
//   3. Strict-mode authorities (reference_files_only, plus its transcript
//      variants) act as a hard prison: a profile/JD ask returns owner=clarify
//      so the caller emits a source-honest clarification, not a leak.
//   4. Multi-source comparison ('compare my résumé with the JD') requires
//      EVERY requested family to be granted AND available. A single missing
//      family denies the whole turn so the user gets one coherent answer.
//
// The decision is consulted by:
//   - SourceAuthorityKernel.build (issues capabilities from
//     decision.allowedEvidenceKinds instead of re-deriving owner → caps)
//   - customModeExecutionContract.buildCustomModeExecutionContract
//     (computes allowed/forbidden Sets from decision.allowedEvidenceKinds)
//   - sourceOwnership.resolveSourceOwnership (legacy owner boolean) via
//     adaptTurnSourceDecision
//   - finalPromptValidation.validateFinalPromptEvidence (last provider
//     boundary; checks the rendered prompt contains every required
//     evidence ID)

import type {
  ModeSourceAuthority,
  ModeSourceContract,
  ModeSourceSwitch,
} from '../services/modeSourceContract';

export type TurnSourceOwner =
  | 'reference_files'
  | 'profile'
  | 'transcript'
  | 'mixed'
  | 'clarify'
  | 'unknown';

export type TurnEvidenceKind =
  | 'reference_files'
  | 'profile_resume'
  | 'profile_jd'
  | 'projects'
  | 'live_transcript'
  | 'meeting_rag';

export type TurnSourceDecisionOutcome =
  | 'default'
  | 'explicit_granted'
  | 'explicit_denied'
  | 'source_unavailable';

export type ExplicitSourceSwitch =
  | 'reference_files'
  | 'profile'
  | 'job_description'
  | 'transcript'
  | null;

type RequestedSource = Exclude<ExplicitSourceSwitch, null>;

export interface TurnSourceAvailability {
  hasReferenceFiles: boolean;
  hasProfileFacts: boolean;
  hasJobDescription: boolean;
  hasLiveTranscript: boolean;
  hasMeetingRag: boolean;
}

export interface TurnSourceDecision {
  sourceAuthority: ModeSourceAuthority;
  defaultOwner: ModeSourceContract['defaultOwner'] | null;
  allowedExplicitSwitches: ModeSourceSwitch[];
  /** Compatibility primary request; use explicitRequests for comparisons. */
  explicitRequest: ExplicitSourceSwitch;
  /** Every explicitly named family for comparison/synthesis turns. */
  explicitRequests: RequestedSource[];
  outcome: TurnSourceDecisionOutcome;
  owner: TurnSourceOwner;
  allowedEvidenceKinds: TurnEvidenceKind[];
  requiredEvidenceKinds: TurnEvidenceKind[];
  reasonCode: string;
}

const REFERENCE_AUTHORITIES = new Set<ModeSourceAuthority>([
  'reference_files_only',
  'reference_files_primary',
  'reference_files_plus_transcript',
]);

const STRICT_AUTHORITIES = new Set<ModeSourceAuthority>([
  'reference_files_only',
  'reference_files_plus_transcript',
  'transcript_only',
]);

const uniq = <T>(values: T[]): T[] => [...new Set(values)];

const profileKinds = (): TurnEvidenceKind[] => ['profile_resume', 'projects'];

function legacySwitches(authority: ModeSourceAuthority): ModeSourceSwitch[] {
  // Pre-revision-1 contract had every switch always listed. Keep the legacy
  // shape for the legacy comparison-turn path: a reference_files_primary
  // mode (the most common new authority) historically granted every switch.
  return authority === 'reference_files_primary'
    ? ['profile', 'job_description', 'transcript']
    : [];
}

function result(input: {
  authority: ModeSourceAuthority;
  contract: Pick<ModeSourceContract, 'defaultOwner'> | null;
  switches: ModeSourceSwitch[];
  requests?: RequestedSource[];
  outcome: TurnSourceDecisionOutcome;
  owner: TurnSourceOwner;
  allowed?: TurnEvidenceKind[];
  required?: TurnEvidenceKind[];
  reasonCode: string;
}): TurnSourceDecision {
  const explicitRequests = input.requests ?? [];
  return {
    sourceAuthority: input.authority,
    defaultOwner: input.contract?.defaultOwner ?? null,
    allowedExplicitSwitches: input.switches,
    explicitRequest: explicitRequests[0] ?? null,
    explicitRequests,
    outcome: input.outcome,
    owner: input.owner,
    allowedEvidenceKinds: uniq(input.allowed ?? []),
    requiredEvidenceKinds: uniq(input.required ?? []),
    reasonCode: input.reasonCode,
  };
}

function unavailable(
  authority: ModeSourceAuthority,
  contract: Pick<ModeSourceContract, 'defaultOwner'> | null,
  switches: ModeSourceSwitch[],
  requests: RequestedSource[],
  reasonCode: string,
): TurnSourceDecision {
  return result({
    authority,
    contract,
    switches,
    requests,
    outcome: 'source_unavailable',
    owner: 'clarify',
    reasonCode,
  });
}

function denied(
  authority: ModeSourceAuthority,
  contract: Pick<ModeSourceContract, 'defaultOwner'> | null,
  switches: ModeSourceSwitch[],
  requests: RequestedSource[],
  reasonCode: string,
): TurnSourceDecision {
  return result({
    authority,
    contract,
    switches,
    requests,
    outcome: 'explicit_denied',
    owner: 'clarify',
    reasonCode,
  });
}

function defaultDecision(
  authority: ModeSourceAuthority,
  contract: Pick<ModeSourceContract, 'defaultOwner'> | null,
  availability: TurnSourceAvailability,
  switches: ModeSourceSwitch[],
): TurnSourceDecision {
  if (REFERENCE_AUTHORITIES.has(authority)) {
    if (!availability.hasReferenceFiles) {
      return unavailable(authority, contract, switches, [], 'default_reference_files_unavailable');
    }
    const allowed: TurnEvidenceKind[] = ['reference_files'];
    if (authority === 'reference_files_plus_transcript' && availability.hasLiveTranscript) {
      allowed.push('live_transcript');
      if (availability.hasMeetingRag) allowed.push('meeting_rag');
    }
    return result({
      authority,
      contract,
      switches,
      outcome: 'default',
      owner: 'reference_files',
      allowed,
      required: ['reference_files'],
      reasonCode: `${authority}:default_reference_files`,
    });
  }
  if (authority === 'profile_only' || authority === 'profile_plus_transcript') {
    if (!availability.hasProfileFacts) {
      return unavailable(authority, contract, switches, [], 'default_profile_unavailable');
    }
    const allowed = profileKinds();
    if (availability.hasJobDescription) allowed.push('profile_jd');
    if (authority === 'profile_plus_transcript' && availability.hasLiveTranscript) {
      allowed.push('live_transcript');
    }
    return result({
      authority,
      contract,
      switches,
      outcome: 'default',
      owner: 'profile',
      allowed,
      required: profileKinds(),
      reasonCode: `${authority}:default_profile`,
    });
  }
  if (authority === 'transcript_only') {
    if (!availability.hasLiveTranscript) {
      return unavailable(authority, contract, switches, [], 'default_transcript_unavailable');
    }
    const allowed: TurnEvidenceKind[] = ['live_transcript'];
    if (availability.hasMeetingRag) allowed.push('meeting_rag');
    return result({
      authority,
      contract,
      switches,
      outcome: 'default',
      owner: 'transcript',
      allowed,
      required: ['live_transcript'],
      reasonCode: 'transcript_only:default_transcript',
    });
  }
  // general_mixed + ask_if_ambiguous: no canonical owner. Caller decides.
  return result({
    authority,
    contract,
    switches,
    outcome: 'default',
    owner: 'unknown',
    reasonCode: `${authority}:no_explicit_owner`,
  });
}

/** True iff `source` matches the persisted defaultOwner for this contract. */
function defaultSourceIsAddressable(
  contract: Pick<ModeSourceContract, 'defaultOwner'> | null,
  source: RequestedSource,
): boolean {
  return (source === 'reference_files' && contract?.defaultOwner === 'reference_files')
    || (source === 'profile' && contract?.defaultOwner === 'profile')
    || (source === 'transcript' && contract?.defaultOwner === 'transcript');
}

/**
 * Resolve the canonical per-turn source decision from:
 *  - The persisted ModeSourceContract (the user's exact allowlist)
 *  - The explicit source request(s) parsed from the question text
 *  - The current availability signals (e.g. is a résumé actually loaded?)
 *
 * Returns an outcome + owner + capability set the every downstream consumer
 * (kernel, arbiter, evidence service, prompt validator) must consult
 * before any retrieval or provider dispatch.
 */
export function resolveTurnSourceDecision(input: {
  sourceContract?:
    | Pick<ModeSourceContract, 'defaultOwner' | 'allowedExplicitSwitches' | 'sourceAuthority'>
    | null;
  persistedSourceAuthority?: ModeSourceAuthority | null;
  /** Backward-compatible scalar input. */
  explicitRequest?: ExplicitSourceSwitch;
  /** Every explicitly named family for comparison/synthesis turns. */
  explicitRequests?: RequestedSource[];
  availability: TurnSourceAvailability;
}): TurnSourceDecision {
  const contract = input.sourceContract ?? null;
  const authority = contract?.sourceAuthority ?? input.persistedSourceAuthority ?? 'ask_if_ambiguous';
  const switches = Array.isArray(contract?.allowedExplicitSwitches)
    ? uniq(contract.allowedExplicitSwitches)
    : legacySwitches(authority);
  const requests = uniq(
    input.explicitRequests ?? (input.explicitRequest ? [input.explicitRequest] : []),
  );
  if (requests.length === 0) {
    return defaultDecision(authority, contract, input.availability, switches);
  }

  // Strict-mode prison: in reference_files_only / plus_transcript / transcript_only,
  // a non-reference_files request is always denied — the contract cannot grant
  // profile or JD even on an explicit ask.
  if (
    STRICT_AUTHORITIES.has(authority)
    && !requests.every((source) => source === 'reference_files' && REFERENCE_AUTHORITIES.has(authority))
  ) {
    return denied(authority, contract, switches, requests, `${authority}:strict_mode`);
  }

  for (const source of requests) {
    if (!switches.includes(source) && !defaultSourceIsAddressable(contract, source)) {
      return denied(authority, contract, switches, requests, 'explicit_switch_not_enabled');
    }
    if (
      (source === 'reference_files' && !input.availability.hasReferenceFiles)
      || (source === 'profile' && !input.availability.hasProfileFacts)
      || (source === 'job_description' && !input.availability.hasJobDescription)
      || (source === 'transcript' && !input.availability.hasLiveTranscript)
    ) {
      const reason =
        source === 'reference_files'
          ? 'reference_files_unavailable'
          : source === 'profile'
            ? 'profile_unavailable'
            : source === 'job_description'
              ? 'job_description_unavailable'
              : 'transcript_unavailable';
      return unavailable(authority, contract, switches, requests, reason);
    }
  }

  // Every request survives the strict-mode + allowlist + availability gates.
  // Sum the corresponding evidence kinds.
  const allowed: TurnEvidenceKind[] = [];
  const required: TurnEvidenceKind[] = [];
  for (const source of requests) {
    if (source === 'reference_files') {
      allowed.push('reference_files');
      required.push('reference_files');
    } else if (source === 'profile') {
      allowed.push(...profileKinds());
      required.push(...profileKinds());
    } else if (source === 'job_description') {
      allowed.push('profile_jd');
      required.push('profile_jd');
    } else {
      allowed.push('live_transcript');
      required.push('live_transcript');
      if (input.availability.hasMeetingRag) allowed.push('meeting_rag');
    }
  }

  const owner: TurnSourceOwner =
    requests.length > 1
      ? 'mixed'
      : requests[0] === 'reference_files'
        ? 'reference_files'
        : requests[0] === 'transcript'
          ? 'transcript'
          : 'profile';
  return result({
    authority,
    contract,
    switches,
    requests,
    outcome: 'explicit_granted',
    owner,
    allowed,
    required,
    reasonCode: `explicit_${requests.join('_plus_')}_granted`,
  });
}
