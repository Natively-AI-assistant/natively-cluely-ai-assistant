// electron/llm/sdSessionAuthority.ts
//
// Per-turn SD session authority: arm Requirements gate prepare / phase stamp
// from durable artifact stickiness + Technical Interview mode — not answerType.

import {
  type RequirementsArtifact,
  type SdPhase,
  type GateStatusViewModel,
  type ProjectGateStatusOptions,
  deriveSdPhase,
  projectGateStatusViewModel,
} from './sdRequirementsGate';

export interface SdSessionAuthority {
  sessionOpen: boolean;
  shouldArmGate: boolean;
  sdPhase: SdPhase | undefined;
  problemKey: string | null;
}

export interface DeriveSdSessionAuthorityInput {
  artifact: RequirementsArtifact | null | undefined;
  /** ModesManager templateType id (e.g. 'technical-interview'). */
  modeId: string | null | undefined;
}

/**
 * Derive session-scoped gate arming for this turn.
 * sessionOpen = sticky problemKey already established by a prior SD prepare.
 * shouldArmGate = Technical Interview AND session open.
 * Leaving TI → shouldArmGate false immediately while the artifact may still
 * be frozen on SessionTracker (sessionOpen can remain true until meeting end
 * or new-SD-problem reset).
 */
export function deriveSdSessionAuthority(
  input: DeriveSdSessionAuthorityInput,
): SdSessionAuthority {
  const rawKey = input.artifact?.problemKey ?? null;
  const problemKey =
    typeof rawKey === 'string' && rawKey.trim().length > 0 ? rawKey : null;
  const sessionOpen = problemKey != null;
  const shouldArmGate =
    sessionOpen && input.modeId === 'technical-interview';
  const sdPhase =
    sessionOpen && input.artifact ? deriveSdPhase(input.artifact) : undefined;
  return { sessionOpen, shouldArmGate, sdPhase, problemKey };
}

/**
 * Overlay gate-status projection keyed on shouldArmGate (TI + session open),
 * not per-turn answerType. Non-TI / session-closed → inert (hidden).
 */
export function projectGateStatusUnderAuthority(
  artifact: RequirementsArtifact | null | undefined,
  modeId: string | null | undefined,
  opts: ProjectGateStatusOptions = {},
): GateStatusViewModel {
  const authority = deriveSdSessionAuthority({ artifact, modeId });
  if (!authority.shouldArmGate) {
    return projectGateStatusViewModel(null);
  }
  return projectGateStatusViewModel(artifact, opts);
}
