// electron/intelligence/context-os/assistantClaimsPrecedenceCheck.ts
//
// Phase 6 Slice 7 (context-rebuild, 05_MIGRATION_PLAN.md Slice 7 item 1,
// RC8): the read-side precedence check that has never existed for
// assistant_claims. DatabaseManager.getVerifiedAssistantClaims/
// markAssistantClaimContradicted (and this file's own module,
// assistantClaims.ts's claimReusableAsEvidence/claimContradictedByEvidence)
// are write-only today — built, persisted, but with ZERO production
// callers on the read side (confirmed by grep before writing this file).
//
// This closes the specific gap target arch §7 names as the "fifth check":
// before a candidate-specific answer commits, check whether it restates a
// claim already marked `contradicted` from an earlier turn. (The
// complementary "can cite a verified one" case is a permission grant,
// already covered by the existing claimReusableAsEvidence gate — this
// function's job is the safety violation, not the reuse grant.)
//
// BUILT STANDALONE, NOT WIRED into any live generation path in this pass:
// the manual-chat commit point (ipcHandlers.ts's `finalText` convergence,
// ~line 4185) and the WTA commit point (IntelligenceEngine.ts's
// runWhatShouldISay, ~line 3590) are both large, delicate, already-dense
// sequences of guard blocks: touching them without a documented
// live-Electron trace campaign — this codebase's own established
// promotion bar (see contextOsEnabled's 2026-07-18 precedent, and Slices
// 2/3/4's identical deferral reasoning for consequential live-path
// changes) — would be exactly the kind of unverified, hard-to-reverse risk
// an autonomous unsupervised pass should not take. The
// assistantClaimsEnforcement flag (dev/test-only default) exists so a
// future pass can wire this in shadow-only (observe/log) before ever
// blocking a real answer.

export interface ContradictedClaimRow {
  claim_id: string;
  claim_text: string;
  contradicted_by_claim_id?: string | null;
}

export interface AssistantClaimsPrecedenceVerdict {
  /** True when the draft answer substantially restates a contradicted claim. */
  restatesContradictedClaim: boolean;
  /** The contradicted claim's id, when restatesContradictedClaim is true. */
  matchedClaimId?: string;
}

function normalizeForOverlap(s: string): string[] {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4);
}

/**
 * Does a draft answer substantially restate any previously-contradicted
 * assistant claim? Conservative on purpose, mirroring
 * verifyClaimAgainstEvidence's overlap threshold and rationale in
 * assistantClaims.ts: the cost of a false positive (blocking a legitimate
 * answer that happens to share vocabulary with a stale claim) is why this
 * ships behind a dev/test-only flag rather than unconditionally.
 */
export function checkAssistantClaimsPrecedence(
  draftAnswer: string,
  contradictedClaims: ContradictedClaimRow[],
): AssistantClaimsPrecedenceVerdict {
  const answerWords = new Set(normalizeForOverlap(draftAnswer));
  if (answerWords.size === 0 || contradictedClaims.length === 0) {
    return { restatesContradictedClaim: false };
  }

  for (const claim of contradictedClaims) {
    const claimWords = normalizeForOverlap(claim.claim_text);
    if (claimWords.length === 0) continue;
    const covered = claimWords.filter((w) => answerWords.has(w)).length;
    if (covered / claimWords.length >= 0.6) {
      return { restatesContradictedClaim: true, matchedClaimId: claim.claim_id };
    }
  }

  return { restatesContradictedClaim: false };
}
