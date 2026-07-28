# Phase 1 failure reproductions

Deterministic reproductions of the §7.9 failure list.

**These files are deliberately OUTSIDE every CI test glob.** They assert the
*desired* (post-fix) behaviour, so they **FAIL against the current codebase** —
that is the point. They are evidence, not regression tests.

`npm test` globs cover `electron/**/__tests__/`; `test:lib` covers
`src/lib/**/__tests__/`. Nothing here matches either, so CI is unaffected.

## Running

```bash
node --test docs/context-intelligence-v3/repro/
```

Expected at Phase 1: **failures**. Each failure is a reproduced defect.

When a defect is fixed in Phase 4, move its file into the matching real
`__tests__/` directory so it becomes a permanent regression guard (§28: "add
tests preventing those patterns from returning").

## Index

| File | §7.9 # | Failure | Bucket |
|------|--------|---------|--------|
| `repro-07-stale-answer-overwrite.test.mjs` | 7 | Correct answer replaced by "not found" / clarification | A |
