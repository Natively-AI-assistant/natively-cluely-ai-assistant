# Fix Remaining Issues — Codex Implementation Prompt

## Context

The previous implementation task completed successfully:
- ✓ 45 TypeScript files restored from recovered source
- ✓ Preload types fixed (profile:get-status, license:deactivate)
- ✓ Recovery tests pass: 13/13 (5 pass, 8 skipped)

## Remaining Issues to Fix

### Issue 1: Entitlement Wiring Test Failure (`npm test` exits 1)

**What:** A test in the entitlement wiring suite fails because it was written for older code that predates the current `devPremiumOverride` implementation.

**What to do:**
1. Find the failing test:
```bash
npm test 2>&1 | grep -A 30 "entitlement\|proEntitlement"
```
2. Read the test file to understand what it expects vs what current code does
3. Update the test assertions to match the current `devPremiumOverride`-based implementation
4. Do NOT change the production code — only update the test expectations
5. Verify the test passes after update

**Key files to check:**
- `electron/services/__tests__/` — look for entitlement/pro access test files
- `electron/services/proEntitlementWiring.ts` — current implementation
- `electron/services/devPremiumOverride.ts` — the override that was added

---

### Issue 2: Retrieval Ranking Test Failure (`npm test` exits 1)

**What:** A retrieval ranking test has an assertion mismatch — likely because the TypeScript restoration changed a subtle behavior or constant.

**What to do:**
1. Find the failing test:
```bash
npm test 2>&1 | grep -A 30 "retrieval\|ranking"
```
2. Read the test to understand what's being asserted
3. Check if the recovered TypeScript source changed any ranking logic, constants, or thresholds compared to the compiled JS that was replaced
4. If the TS source is the correct behavior: update the test to match
5. If the test expectation is correct: fix the production code to match the original JS behavior
6. Verify the test passes

---

### Issue 3: HeuristicExtractor.ts — 21 `never` Property Errors

**What:** The recovered `premium/electron/knowledge/HeuristicExtractor.ts` has 21 TypeScript errors where properties are typed as `never`. This is blocking enabling `strict: true` in `electron/tsconfig.premium-check.json`.

**What to do:**
1. Run the premium type check to see exact errors:
```bash
npx tsc --project electron/tsconfig.premium-check.json --noEmit 2>&1 | head -60
```

2. Open `premium/electron/knowledge/HeuristicExtractor.ts` and fix each `never` error. Common causes:
   - Discriminated union not narrowed properly
   - Array/object type inferred as `never[]` or `never`
   - Return type mismatch
   - Incompatible intersection types

3. For each `never` error, the fix is usually one of:
   - Add explicit type annotation: `const x: string[] = []` instead of `const x = []`
   - Narrow the type with a type guard
   - Fix incorrect interface property types

4. After all 21 errors are fixed, enable strict mode:
   - Open `electron/tsconfig.premium-check.json`
   - Change `"strict": false` → `"strict": true`

5. Run again to verify zero errors:
```bash
npx tsc --project electron/tsconfig.premium-check.json --noEmit
```

---

## Validation After All Fixes

Run in this order:

```bash
# 1. TypeScript check (should be zero errors, strict mode enabled)
npx tsc --project electron/tsconfig.premium-check.json --noEmit

# 2. Main TypeScript check
npx tsc --noEmit

# 3. Recovery tests (should be 5 pass, 8 skipped — no failures)
npm run test:recovery

# 4. Full test suite (should exit 0 — no failures)
npm test

# 5. Build
npm run build:electron
```

All five must pass before marking complete.

---

## Git & PR

After all tests pass:

```bash
git add .
git commit -m "fix: resolve test failures and enable strict mode in premium typecheck

- Update entitlement wiring test to match devPremiumOverride implementation
- Fix retrieval ranking test assertion to match restored TS behavior
- Fix 21 'never' type errors in HeuristicExtractor.ts
- Enable strict: true in electron/tsconfig.premium-check.json
- All tests pass: npm test exits 0, 13/13 recovery tests pass

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"

gh pr create \
  --title "fix: resolve test failures and enable strict premium typecheck" \
  --body "Completes the TypeScript restoration work.

## Changes
- Fix entitlement wiring test to reflect current devPremiumOverride implementation
- Fix retrieval ranking test assertion
- Fix 21 never property errors in HeuristicExtractor.ts
- Enable strict: true in electron/tsconfig.premium-check.json

## Validation
- npm test: exits 0 (all tests pass)
- npm run test:recovery: 13/13 (5 pass, 8 skipped)
- npx tsc --noEmit: zero errors
- npx tsc --project electron/tsconfig.premium-check.json --noEmit: zero errors, strict mode

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Success Criteria

- [ ] `npm test` exits 0 (zero test failures)
- [ ] `npm run test:recovery` passes (5 pass, 0 fail, 8 skipped)
- [ ] `npx tsc --noEmit` zero errors
- [ ] `npx tsc --project electron/tsconfig.premium-check.json --noEmit` zero errors with `strict: true`
- [ ] PR created and pushed
