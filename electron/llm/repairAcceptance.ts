// electron/llm/repairAcceptance.ts
//
// ONE shared acceptance policy for a regenerated ("repaired") answer, used by
// BOTH answer paths:
//   - the live WTA path   (IntelligenceEngine.runWhatShouldISay)
//   - the manual-chat path (ipcHandlers gemini-chat-stream)
//
// Why this exists (PR #427 §1.4 — "Manual path / WTA path post-processing
// duplicated"): both paths independently decide whether to keep a regeneration,
// and the two copies had already DRIFTED. The WTA path rejected a repair that
// re-leaked an internal artifact and one that was a drastic length downgrade;
// the manual path had NEITHER guard — despite the WTA comment claiming the
// length floor "mirrors the same guard added to ipcHandlers.ts's manual-chat
// regen path". It was never added there, so a manual-chat profile repair that
// came back as a leaked <rewrite_instructions> block was accepted and shipped.
//
// Keeping the policy in one place is what stops that drift recurring. Callers
// still own their own DOMAIN validity re-check (profile evidence, doc-grounded
// validation) and pass the verdict in via `stillInvalid` — this module owns only
// the checks that are identical on both paths.

import { isLeakedAnswerArtifact } from './answerPolish';

/** Minimum characters for a repair to be considered a real answer at all. */
const MIN_REPAIR_CHARS = 5;

/**
 * Only protect against a length downgrade when the ORIGINAL had substantial
 * content worth protecting — a short/empty original has nothing to regress
 * from. (Thresholds carried over verbatim from the WTA guard, 2026-07-23.)
 */
const SUBSTANTIVE_ORIGINAL_CHARS = 150;
const MIN_REPAIR_LENGTH_RATIO = 0.6;

export type RepairRejectionReason =
  | 'too_short'
  | 'leaked_artifact'
  | 'length_downgrade'
  | 'still_invalid';

export interface RepairAcceptanceInput {
  /** The answer the repair would REPLACE. */
  original: string | null | undefined;
  /** The regenerated candidate. */
  repaired: string | null | undefined;
  /**
   * Caller's domain re-check result (profile evidence / doc-grounded / answer
   * relevance). True means the repair still violates the caller's contract.
   */
  stillInvalid?: boolean;
}

export interface RepairAcceptanceVerdict {
  accepted: boolean;
  /** The trimmed repair — what the caller should assign when accepted. */
  text: string;
  reason?: RepairRejectionReason;
}

/**
 * Decide whether a regenerated answer may replace the original.
 *
 * Never throws: acceptance sits on the hot answer path and a crash here would
 * take down an answer the user is already waiting on. Any internal failure
 * falls back to REJECTING the repair, which keeps the original answer — the
 * safe direction, since the original at least passed generation.
 */
export function acceptRepairedAnswer(input: RepairAcceptanceInput): RepairAcceptanceVerdict {
  try {
    const repairedTrim = String(input?.repaired ?? '').trim();
    const originalTrim = String(input?.original ?? '').trim();

    if (repairedTrim.length < MIN_REPAIR_CHARS) {
      return { accepted: false, text: repairedTrim, reason: 'too_short' };
    }

    // A regeneration is at least as exposed to leaking a schema stub / JSON
    // envelope / internal tag block as the original generation was, because the
    // repair prompt is itself the <rewrite_instructions> shape proven to leak.
    if (isLeakedAnswerArtifact(repairedTrim)) {
      return { accepted: false, text: repairedTrim, reason: 'leaked_artifact' };
    }

    if (
      originalTrim.length >= SUBSTANTIVE_ORIGINAL_CHARS
      && repairedTrim.length < originalTrim.length * MIN_REPAIR_LENGTH_RATIO
    ) {
      return { accepted: false, text: repairedTrim, reason: 'length_downgrade' };
    }

    if (input?.stillInvalid) {
      return { accepted: false, text: repairedTrim, reason: 'still_invalid' };
    }

    return { accepted: true, text: repairedTrim };
  } catch {
    return { accepted: false, text: '', reason: 'still_invalid' };
  }
}
