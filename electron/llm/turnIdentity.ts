// electron/llm/turnIdentity.ts
//
// Phase 6 Slice 1 (context-rebuild, docs/context-rebuild/05_MIGRATION_PLAN.md
// "Slice 1 — Stable turn and stream lifecycle"): a formal (TurnId, AttemptId)
// identity, replacing the ad hoc per-sender `streamId` supersession check
// (`ipcHandlers.ts`'s `_chatStreamsBySender` map) with a shared, testable
// predicate and a SessionTracker-level write guard.
//
// Gated by the `turnIdentityV2` flag (dev/test-only until a documented
// promotion decision, mirroring `ragConfidenceGate`/`okfHybridRetrieval`'s
// rollout precedent) — both identity schemes run in PARALLEL until then.
// This module defines only the identity types and the one shared predicate;
// it does not decide when a new attempt is minted or how the old `streamId`
// counter is retired — those remain call-site concerns.

import { randomUUID } from 'crypto';

/**
 * Identifies a logical question/turn — stable across retries of the SAME
 * question (a regen/repair attempt keeps its turn's `turnId`, but mints a
 * new `attemptId`).
 */
export type TurnId = string;

/**
 * Identifies one specific generation attempt. Attempt ids are minted from a
 * single globally-monotonic counter (the existing `_chatStreamId` counter in
 * ipcHandlers.ts, retyped as `AttemptId` — this module does not mint them),
 * so a superseding attempt always has a strictly larger id than the one it
 * supersedes. That guarantee is what makes plain equality (not ordering)
 * sufficient for `isCurrentAttempt` below: at most one attempt can ever be
 * "current" for a given holder at a time.
 */
export type AttemptId = number;

export interface TurnIdentity {
  turnId: TurnId;
  attemptId: AttemptId;
}

/** Mint a new TurnId at a renderer-submit / WTA-classify entry point. */
export function mintTurnId(): TurnId {
  return randomUUID();
}

/**
 * The one shared predicate every "is this still the current attempt, or has
 * it been superseded" guard site should call. Replaces repeated
 * `_chatStreamsBySender.get(senderId)?.streamId !== myStreamId` comparisons
 * with a single, named, independently-testable check — stated honestly (per
 * the Phase 4 target-arch review's correction) as one predicate called at
 * many distinct sites, not a single chokepoint those sites collapse into.
 */
export function isCurrentAttempt(
  currentAttemptId: AttemptId | null | undefined,
  attemptId: AttemptId,
): boolean {
  return currentAttemptId === attemptId;
}
