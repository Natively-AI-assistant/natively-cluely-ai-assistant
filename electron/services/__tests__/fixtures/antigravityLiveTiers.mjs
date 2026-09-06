// Captured verbatim from three consecutive live sign-ins on 2026-09-06.
// Shared by AntigravityService.test.mjs and AntigravityTierEligibility.test.mjs
// so the two can never drift apart — this is a record of what Google actually
// returned, not a fixture anyone should tune to make a test pass.
//
// Every OTHER onboarding fixture in the suite is idealised —
//   { allowedTiers: [{ id: 'chosen-tier', isDefault: true }] }
// a shape Google does not send — which is how 17 green tests sat on top of a
// sign-in that failed 100% of the time.
//
// `UNSUPPORTED_CLIENT` is a statement about the CLIENT, not the account. PR 547's
// author reports sign-in working when the PR was opened (2026-09-04), which is
// consistent with Google revoking free-tier eligibility for this client since.
// No mocked test can see a change like that; only the opt-in live check can.
export const LIVE_LOAD_CODE_ASSIST = Object.freeze({
  currentTier: null,
  allowedTiers: [{ id: 'standard-tier', isDefault: true, userDefinedCloudaicompanionProject: true }],
  ineligibleTiers: [{ tierId: 'free-tier', reasonCode: 'UNSUPPORTED_CLIENT' }],
});
