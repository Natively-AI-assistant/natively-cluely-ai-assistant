# Mode audit harness

Answers: **for each mode, can an uploaded reference file actually evidence a turn?**

These scripts **execute the real production policy functions** (`decide`, `classifyTurn`, `resolveModePolicy`, `sourceTypeForFile`, `authorityOf`, `defaultSourceContractForNewMode`) rather than reasoning about them from source. That distinction matters: the first pass of this investigation reached a wrong conclusion by trusting a stale docblock, so these numbers are executed, not read.

Read-only — nothing here is imported by the app and no production code is modified.

```bash
cd experiments/mode-audit
npx esbuild reachability.ts --bundle --platform=node --format=cjs --outfile=/tmp/r.cjs && node /tmp/r.cjs
```

| Script | Question it answers |
|---|---|
| `reachability.ts` | Of 8 realistic interview questions, how many actually reach the reference file in each of the 9 modes? (the headline 2/8 vs 4/8 numbers) |
| `name-collisions.ts` | Which plausible product/feature names get misrouted away from reference files by the classifier's meeting vocabulary? |
| `per-mode-matrix.ts` | Per mode: contract seed, `forceDocumentGrounding`, what an uploaded `.md` is stamped as, and per-question verdict with the drop reason |

**Reading the drop reasons.** They mirror the real filter order in `electron/context-intelligence/retrieval/legacy-retrieval-port.ts`:
- `NO_RETRIEVAL` — the claim's authoritative sources are not in the mode's allowlist, so `shouldRetrieve` is false and nothing is queried at all.
- `PLANNED_TYPE_FILTER` — retrieval ran, but the plan targeted other source types, so the file's chunks were dropped before scoring (`:143`).
- `CLAIM_AUTHORITY` — the file's type is not authoritative for the claim this turn needs (`:144-146`).

**Caveat.** These model the *decision layer* only — whether evidence is admitted. They say nothing about ranking quality once admitted (that is what `experiments/chunk-sweep/` measures). A question can be `OK` here and still fail because the right chunk did not rank in top-K.
