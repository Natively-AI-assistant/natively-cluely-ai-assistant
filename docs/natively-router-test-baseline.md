# Test baseline for the interaction-router campaign

Recorded 2026-09-04 at campaign base commit `330717e5`, before any campaign change. The replay harness becomes the merge gate from PR 6 onward, and it will run against a suite that is already red in four places. Those four are recorded here so a later run can tell a regression from the baseline it inherited.

The rule this exists to serve: a regression is an identical failing NAME that was passing at this baseline, or a new failing name. A failing count alone proves nothing.

## Known-red at base

| Suite | File | Failing | Of |
|---|---|---|---|
| services | `electron/services/__tests__/ModeRetrievalConfidence.test.mjs` | 1 | 7 |
| services | `electron/services/__tests__/IntelligenceEngineCandidateSanitizerFallback.test.mjs` | 3 | 5 |

Failing test names, verbatim:

```
flag OFF (default): result has NO confidence field — legacy shape preserved
a bare stock refusal on a candidate-voice answer gets a deterministic fallback, not shipped raw (A9 repro)
a candidate-voice answer with real content plus an assistant-meta tail is still just stripped, not fully replaced
a real, substantive candidate-voice answer is never touched by the fallback branch
```

## Green at base

`electron/llm/__tests__/**` runs 3917 tests with 0 failures and 17 skipped.

`electron/services/__tests__/**` runs 3693 tests with 3654 passing, 4 failing and 35 skipped. The four are the ones above.

## How this was established

The failures reproduce with every campaign change reverted to its base version. The procedure was to check the touched files out at `330717e5`, rebuild, and rerun the two files. Counts were identical with and without the campaign changes, which is what distinguishes an inherited red from a regression.

One method note, because it cost time and will cost it again. A `git worktree` at the base commit is NOT a valid baseline in this repo. Worktrees do not populate submodules, so `premium/` is empty there, `electron/services/resolveCompanySearchProvider.ts` fails to resolve its imports, and the whole build fails. That produces an all-red run that looks like a catastrophic baseline and is an artefact of the worktree. Revert files in the real tree instead.

## Not investigated

Neither failure is in a path this campaign touches, and Phase 1 changes no behaviour, so neither was diagnosed. `ModeRetrievalConfidence` sits in the retrieval-confidence area an unrelated reranker workstream was active in on 2026-09-04. If either is fixed before PR 6, update this file rather than leaving the gate calibrated against a stale baseline.

## Update 2026-09-06

All four baseline failures pass after merging `origin/main` (`2ca22d1e`) into the campaign branch. Main's `308f3610` and `f1801b85` changed the refusal path those tests exercise. The known-red count for the wide suite is now zero from this campaign's side.

Main carries 24 failures of its own on the same date, all from PR #547 (Antigravity OAuth): `anyVisionProviderAvailable` in `LLMHelper.ts` calls `AntigravityService.getStatus()` outside its try block, and the CredentialsManager stubs in `DisabledProviderRouting2026_08_01`, `OutboundBoundaryUniversality2026_08_01`, `ProviderDataScopeOutbound2026_08_01` and `ScreenUnderstandingModeEnforcement2026_08_01` have no `getAntigravityOAuthTokens`. Verified identical on a clean `origin/main` build. Not touched by this campaign.
