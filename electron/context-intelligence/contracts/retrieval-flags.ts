// electron/context-intelligence/contracts/retrieval-flags.ts
//
// Kill switches for the 2026-08-28 reference-retrieval repair (docs/retrieval-handoff).
//
// WHY A SECOND FLAG MODULE RATHER THAN `intelligenceFlags`
// `electron/context-intelligence/` has, deliberately, NO dependency on the
// intelligence flag registry — grep it: `isIntelligenceFlagEnabled` appears
// zero times in the whole subsystem. That is not an accident of history. 20 of
// the 62 flags in that registry resolve differently in dev/test than in
// production via `isInternalDevTestContext`, and `contracts/flag.ts`'s header
// records what that split cost: composePrompt built, tested, and never executed
// for a user; assistantClaims enforced in tests and off in production; the OKF
// provenance layer inert in every shipped build. Adding this subsystem's first
// registry import — to ship a *fix for a production-only failure* — would be
// the same mistake wearing a different hat.
//
// So this module copies `flag.ts`'s discipline instead of its neighbours':
//   • one literal default per flag, read the same way in every environment;
//   • no `isInternalDevTestContext`, no NODE_ENV branch, nothing to inherit;
//   • an env var as the operator kill switch, both directions.
//
// WHY THE DEFAULTS ARE ON
// Each flag guards a defect with a reproduction in docs/retrieval-handoff and a
// test in this directory asserting the FIXED behaviour. Shipping them off would
// mean the suites pin a behaviour users never get — the F5 pattern above, again.
// The env var is the rollback, and it needs no release.
//
// WHY THIS IS NOT `flag.ts` ITSELF
// `flag.ts` is the V3 pipeline switch: off means the legacy engine. These are
// narrower — each one reverts a single decision inside a V3 that stays on. A
// caller that wants everything back at once still has NATIVELY_CONTEXT_INTELLIGENCE_V3=0.
//
// See docs/retrieval-handoff/03-FIX-PLAN.md

const truthy = (v: string | undefined): boolean => {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'on' || s === 'yes' || s === 'enabled';
};

const falsy = (v: string | undefined): boolean => {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === '0' || s === 'false' || s === 'off' || s === 'no' || s === 'disabled';
};

export interface RetrievalFlagSpec {
  env: string;
  /**
   * The default when the env var says nothing. A plain boolean, ALWAYS — a
   * thunk here would re-open the environment-sensitivity this module exists to
   * keep out, so the type deliberately does not allow one.
   */
  default: boolean;
  /** One line, for the completion report and for whoever finds this later. */
  why: string;
}

export const RETRIEVAL_FLAGS = {
  /** T2 — `sync`/`standup`/`candidate` matched as bare nouns and misrouted the turn. */
  classifierTokenFraming: {
    env: 'NATIVELY_RETRIEVAL_CLASSIFIER_TOKEN_FRAMING',
    default: true,
    why: 'RC2: bare `sync`/`standup` claimed the transcript and bare `candidate` claimed identity',
  },
  /** T1 — a user's own reference file may evidence their skill/employment claims. */
  referenceFilesEvidenceUserClaims: {
    env: 'NATIVELY_RETRIEVAL_REFERENCE_FILES_EVIDENCE_USER_CLAIMS',
    default: true,
    why: 'RC1: REFERENCE_FILE was authoritative for no USER_* claim, so every second-person question lost the file',
  },
  /** T5 — a bare follow-up regains the source pools its referent's own turn used. */
  followUpSourceContinuity: {
    env: 'NATIVELY_RETRIEVAL_FOLLOWUP_SOURCE_CONTINUITY',
    default: true,
    why: 'RC3: the unclaimed-retrieval fallback excluded identity pools from resolved follow-ups too',
  },
  /** T7 — referent resolution compares the turn's scope before reusing a topic. */
  referentScopeCheck: {
    env: 'NATIVELY_RETRIEVAL_REFERENT_SCOPE_CHECK',
    default: true,
    why: 'RC6: resolveReference never compared state.scopeId, so the first turn after a scope change used a stale topic',
  },
} as const satisfies Record<string, RetrievalFlagSpec>;

export type RetrievalFlagKey = keyof typeof RETRIEVAL_FLAGS;

export interface RetrievalFlagOverrides {
  /** Injectable for tests — avoids mutating process.env. */
  env?: Record<string, string | undefined>;
}

/**
 * Is this fix enabled?
 *
 * Resolution order — note there is no environment-sensitive branch anywhere:
 *   1. explicit env var (either direction)
 *   2. the flag's one literal default
 */
export function isRetrievalFixEnabled(key: RetrievalFlagKey, overrides: RetrievalFlagOverrides = {}): boolean {
  const spec = RETRIEVAL_FLAGS[key];
  const raw = (overrides.env ?? process.env)[spec.env];
  if (truthy(raw)) return true;
  if (falsy(raw)) return false;
  return spec.default;
}
