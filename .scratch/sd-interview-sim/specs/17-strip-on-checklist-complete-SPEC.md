# SPEC 17 — Strip drafts when checklist complete (advance may lag)

**Status:** implemented  
**Parent:** [PRD.md](../PRD.md)  
**Depends on:** SPEC 16  
**Trigger:** Post-#13 smoke (`t2-1dacdca3…`) still `candidate_rewind` — drafts strip offline if gate closed, but live often never reaches `gateClosed`

## Decision

Widen `applySimPostRequirementsAnswerStrip`: when `sdProblemKey` is pinned, strip if:

- `sdPhase === post_requirements` (gate closed), **or**
- `isChecklistComplete(artifact)` even if advance has not fired yet

Still identity when checklist incomplete (early Requirements grilling) and when pin unset (product path).

## Tests

- `SimPostRequirementsAnswerStripTier0`: checklist complete + `gateClosed=false` → strip; incomplete open → identity
