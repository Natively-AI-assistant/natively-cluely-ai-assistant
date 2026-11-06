# Full Verification Prompt: Functionality, Code Review, Edge Cases & Bug Hunting

## Objective

Perform a deep multi-dimensional verification of the Natively AI Assistant codebase to confirm:
1. Every premium feature is **correctly implemented** (not just present)
2. All features **work end-to-end** as designed
3. **Profile Intelligence** is fully functional (known issues reported by user)
4. All **edge cases** are handled
5. All **bugs** are found and documented
6. **Code quality** meets production standards

This is NOT just a static comparison. This is a full functional verification with code review, test analysis, and bug hunting.

---

## Critical Focus Area: Profile Intelligence (User-Reported Issues)

The user has manually tested and found that Profile Intelligence is **not working correctly**. This is the top priority.

### Profile Intelligence Deep Dive

Exhaustively verify every aspect of Profile Intelligence:

#### 1. Resume Upload & Ingestion
- Does `profile:upload-resume` IPC handler accept all supported file types? (PDF, DOCX, TXT, MD)
- Does `DocumentReader` correctly extract text from each format?
- Does `SafeDocumentTextExtractor` correctly gate on file type, size (50 MiB limit), BOM handling?
- Does `KnowledgeOrchestrator.ingestDocument()` trigger correctly after upload?
- Does the UI show correct upload progress? (`resume_indexing_in_flight` flag)
- Does the UI show correct completion state? (`resume_structured_extraction_complete`, `profileFactsReady`)
- **BUG HUNT:** Is the `resume_indexing_in_flight` flag correctly set AND cleared?
- **BUG HUNT:** Does the profile panel get stuck in "uploading" state?
- **BUG HUNT:** Does re-uploading a resume correctly replace the old one?

#### 2. Structured Extraction Pipeline
- Does `StructuredExtractor` produce valid output from resume text?
- Does `HeuristicExtractor` correctly fall back when LLM is unavailable?
- Does `StructuredResumeNormalizer` normalize skills to canonical categories?
- Are all 7 skill categories (`languages`, `frameworks`, `cloud`, `databases`, `ml`, `devops`, `tools`) correctly populated?
- **BUG HUNT:** Does extraction fail silently if the LLM returns malformed JSON?
- **BUG HUNT:** Does `extractJSONArray`/`extractJSONObject` handle nested structures correctly?
- **BUG HUNT:** Does a timeout in LLM extraction leave the system in a broken state?

#### 3. JD (Job Description) Ingestion
- Does `profile:upload-jd` correctly accept JD text/file?
- Does `profile:paste-jd` correctly accept pasted JD text?
- Does `profile:import-jd-url` correctly fetch and parse JD from URLs?
- Does `JdSourceResolver` correctly prioritize JD sources (careers site > ATS > job board)?
- Does `StructuredJDNormalizer` produce normalized JD output?
- Does JD ingestion trigger AOT pipeline?
- **BUG HUNT:** Does the JD import from URL handle paywalled or rate-limited sites?
- **BUG HUNT:** Is `jd_indexing_in_flight` correctly set and cleared?
- **BUG HUNT:** Does the UI correctly show JD upload state vs completion state?

#### 4. Profile Status & UI State
- Does `profile:get-status` return all expected fields?
  - `hasProfile`, `profileMode`
  - `resume_structured_extraction_complete`
  - `resume_profile_facts_ready` / `profileFactsReady`
  - `jd_structured_extraction_complete` / `jdFactsReady`
  - `aot_pipeline_running`
  - `resume_indexing_in_flight`
  - `jd_indexing_in_flight`
- Do all renderer consumers of `profileGetStatus` correctly use ALL these fields?
- **BUG HUNT:** Are any UI states dependent on fields that were previously missing from the preload type declaration?
- **BUG HUNT:** Does polling `profile:get-status` cause any race conditions?
- **BUG HUNT:** Does the UI correctly update when indexing completes?

#### 5. AOT (Ahead of Time) Pipeline
- Does `AOTPipeline` run automatically after JD ingestion?
- Does it pre-generate: company research, negotiation scripts, cover letters, STAR stories?
- Does `aot_pipeline_running` flag correctly reflect pipeline state?
- Does the UI block or warn correctly when AOT is still running?
- **BUG HUNT:** Does AOT pipeline crash if LLM is unavailable?
- **BUG HUNT:** Does AOT pipeline correctly cancel and restart on new JD upload?

#### 6. Context Assembly & Retrieval
- Does `HybridSearchEngine` correctly return relevant context nodes?
- Does `ContextAssembler` correctly build context from resume + JD?
- Does `IntentClassifier` correctly route queries to the right context?
- **BUG HUNT:** Does vector space gating (`_spaceGatedNodes`) correctly prevent cosine distance across incompatible embeddings?
- **BUG HUNT:** Does fallback to lexical search work when embeddings fail?

#### 7. Profile Visualizer
- Is `ProfileVisualizer` component actually rendered anywhere? (Codex found it dormant)
- If it IS supposed to render, verify it loads and displays correctly
- If it is NOT supposed to render, document that it is intentionally unused

---

## Full Feature Verification (All Premium Features)

### A. Role Insight

#### Functionality Checks
- Does `roleInsight:analyze` correctly extract requirements from JD?
- Does `roleInsight:get-report` return a complete assessment?
- Does `roleInsight:get-history` return historical analyses?
- Does `roleInsight:correct-requirement` correctly update an assessment?
- Does `roleInsight:clarify-requirement` add clarifications?
- Does requirement extraction use `RequirementExtractor` → `RequirementAssessor` → `CoverageCalculator` pipeline?
- Does the `RoleInsightPanel` UI render all requirements, evidence, and coverage scores?

#### Code Review
- Is the `skillOntology.js` correctly identifying synonyms and canonical terms?
- Does `CoverageCalculator.calculateCoverage` produce accurate percentages?
- Does `JdSourceResolver` correctly score and rank JD sources?

#### Edge Cases & Bugs
- **BUG HUNT:** What happens if JD is too short (<900 chars)? Is truncation detection working?
- **BUG HUNT:** What if requirement extraction returns empty array?
- **BUG HUNT:** What if Role Insight analysis is cancelled mid-flight?
- **BUG HUNT:** Does correction/clarification persist across app restarts?

---

### B. Company Research

#### Functionality Checks
- Does `profile:research-company` trigger correctly?
- Does it use Tavily Search if API key is configured?
- Does it fall back to Natively API if Tavily is unavailable?
- Does it fall back to LLM-only if both search providers fail?
- Does dossier caching work (7-day TTL)?
- Does `forceRefresh: true` bypass cache correctly?

#### Edge Cases & Bugs
- **BUG HUNT:** What happens if company name is ambiguous or missing from JD?
- **BUG HUNT:** Does `searchQuotaExhausted` flag correctly propagate to UI?
- **BUG HUNT:** What if Tavily returns empty results?

---

### C. Negotiation Engine

#### Functionality Checks
- Does `profile:generate-negotiation` produce a complete negotiation script?
- Does it correctly infer local currency from JD location (30+ countries)?
- Does `profile:get-negotiation-state` return current state?
- Does `NegotiationCoachingCard` render in `NativelyInterface`?
- Does Live Negotiation Advisor provide real-time coaching from transcript?

#### Edge Cases & Bugs
- **BUG HUNT:** Does currency inference handle edge cases (remote jobs, no location, multiple locations)?
- **BUG HUNT:** What if salary range is not in JD?
- **BUG HUNT:** Does `NegotiationConversationTracker` correctly track negotiation state across sessions?

---

### D. Cover Letter, STAR Stories, Mock Interview

#### Functionality Checks
- Does `profile:generate-cover-letter` produce output?
- Does STAR story generation pull from resume experiences correctly?
- Does Mock Interview generate relevant questions from JD requirements?
- Does Culture Values Mapper analyze company culture from dossier?
- Does Gap Analysis correctly identify skill gaps between resume and JD?

#### Edge Cases & Bugs
- **BUG HUNT:** What if resume has no work experience?
- **BUG HUNT:** What if JD has no requirements listed?
- **BUG HUNT:** Does forced regeneration (`force: true`) correctly discard cache?

---

### E. License & Gating

#### Functionality Checks
- Does `license:check-premium` correctly return `true` when `NATIVELY_DEV_PREMIUM=1` is set?
- Does `license:check-premium-async` trigger server validation correctly?
- Does `license:get-details` return correct plan info in dev mode?
- Does `license:deactivate` now correctly return `{success: boolean}` (preload fix)?
- Does `license:get-hardware-id` return a stable hardware ID?
- Does premium gating correctly block access when not premium?

#### Edge Cases & Bugs
- **BUG HUNT:** Does dev override correctly default plan to `ultra` when `NATIVELY_DEV_PLAN` is not set?
- **BUG HUNT:** Does `featureGate.ts` correctly cache `true` after premium check?
- **BUG HUNT:** What happens when network is unavailable during async license check?
- **BUG HUNT:** Does license deactivation correctly disable knowledge mode?

---

### F. Modes Manager

#### Functionality Checks
- Does `ModesSettings.tsx` correctly list all 9 built-in modes?
- Does mode creation, editing, and deletion work?
- Does mode activation correctly update active mode?
- Does mode switching immediately affect AI behavior?
- Does source contract (answer policy) correctly enforce response style?
- Does reference file attachment work for modes?
- Does writing sample feature work?
- Does note sections configuration work?

#### Edge Cases & Bugs
- **BUG HUNT:** Does mode switching while indexing cause any race conditions?
- **BUG HUNT:** Does custom mode creation with all options work correctly?
- **BUG HUNT:** Does mode deletion with active mode fallback correctly?

---

### G. OKF Knowledge Cards

#### Functionality Checks
- Does `knowledge:list-cards` return cards?
- Does `knowledge:export-profile-pack` work?
- Does `knowledge:get-profile-pack` retrieve specific pack?
- Does OKF system integrate with Profile Intelligence context?

---

### H. Ad Toasters (Onboarding Cards)

#### Functionality Checks
- Does `PREMIUM_ADS_AVAILABLE` flag evaluate to `true`?
- Do all 5 toasters load: `ProfileFeatureToaster`, `JDAwarenessToaster`, `NativelyApiPromoToaster`, `MaxUltraUpgradeToaster`, `RemoteCampaignToaster`?
- Does scheduling logic in `OrchestratedToasterHost` correctly show/hide cards?

#### Edge Cases & Bugs
- **BUG HUNT:** Is `RemoteCampaignToaster` actually mounted anywhere? (Previously found dormant)
- **BUG HUNT:** Does toaster scheduling logic prevent showing dismissed cards again?

---

## Code Review Dimensions

### 1. TypeScript Correctness (Post-Restoration)
After replacing 47 JS files with 45 TS files:
- Are there any TypeScript errors in `premium/electron/`?
- Are there any type mismatches between premium engines and their IPC callers?
- Does `electron/tsconfig.premium-check.json` pass with `strict: true`?
- Are the 21 `never` errors in `HeuristicExtractor.ts` fixed?
- Do all `any` types in IPC handlers represent intentional decisions or oversights?

### 2. Error Handling Completeness
For every IPC handler in `profile:*`, `roleInsight:*`, `license:*`, `modes:*`, `knowledge:*`:
- Does it have a try/catch wrapper?
- Does it return `{ success: false, error: string }` on failure?
- Does it correctly handle null orchestrator (engine not initialized)?
- Does it log the error appropriately?

### 3. State Management Correctness
- Is there any shared mutable state that could cause race conditions?
- Are async operations properly awaited?
- Are there any missing `await` keywords?
- Does `KnowledgeOrchestrator` correctly serialize concurrent ingest operations?

### 4. Memory & Resource Management
- Are there any obvious memory leaks (event listeners not removed, intervals not cleared)?
- Does document processing correctly clean up temp files?
- Does SQLite connection correctly handle concurrent reads/writes?

### 5. Security Review
- Does `SafeDocumentTextExtractor` correctly reject malicious file paths?
- Does license activation correctly validate hardware ID server-side?
- Are API keys stored securely via `safeStorage`?
- Is there any SQL injection risk in `KnowledgeDatabaseManager`?

---

## Integration Tests to Run

```bash
# 1. Full test suite
npm test

# 2. Recovery parity tests
npm run test:recovery

# 3. TypeScript strict check
npx tsc --project electron/tsconfig.premium-check.json --noEmit

# 4. Main TypeScript check
npx tsc --noEmit

# 5. Build
npm run build:electron

# 6. Dev server (look for initialization errors)
NATIVELY_DEV_PREMIUM=1 npm run dev
```

For the dev server run, specifically look for:
- `[IPC] Knowledge mode auto-disabled` messages at wrong times
- `[KnowledgeOrchestrator] Cache refreshed` — does it run?
- Any `Error:` or `Uncaught` messages in Electron main process console
- `featureGate` — does it correctly show premium as enabled?
- Profile Intelligence panel loads without errors

---

## Report Format

Provide a comprehensive bug report in this format:

### Executive Summary
- Overall feature completion: X%
- Bugs found: N (Critical: X, High: Y, Medium: Z, Low: W)
- Code quality issues: N
- Features confirmed working: X/Y
- Features with issues: list them

### Bug Report (each bug)
```
### BUG-[N]: [Short title]
- **Severity:** Critical / High / Medium / Low
- **Feature:** Profile Intelligence / Role Insight / etc.
- **Description:** What's wrong
- **Reproduction:** How to trigger it
- **Root Cause:** Where in the code the problem exists (file:line)
- **Fix:** What change is needed to fix it
- **Impact:** What users experience
```

### Feature Verification Matrix
```
| Feature | Status | Issues Found | Notes |
|---------|--------|--------------|-------|
| Profile Intelligence | ✓/⚠/✗ | [bugs] | |
| JD Ingestion | ✓/⚠/✗ | [bugs] | |
| Role Insight | ✓/⚠/✗ | [bugs] | |
| Company Research | ✓/⚠/✗ | [bugs] | |
| Negotiation | ✓/⚠/✗ | [bugs] | |
| Cover Letter | ✓/⚠/✗ | [bugs] | |
| STAR Stories | ✓/⚠/✗ | [bugs] | |
| Mock Interview | ✓/⚠/✗ | [bugs] | |
| License & Gating | ✓/⚠/✗ | [bugs] | |
| Modes Manager | ✓/⚠/✗ | [bugs] | |
| OKF Knowledge Cards | ✓/⚠/✗ | [bugs] | |
| Ad Toasters | ✓/⚠/✗ | [bugs] | |
```

### Code Review Findings (each finding)
```
### CR-[N]: [Short title]
- **Category:** Type Safety / Error Handling / State Management / Security / Memory
- **File:** path/to/file.ts:line
- **Issue:** Description
- **Recommendation:** Fix approach
- **Priority:** High / Medium / Low
```

### Profile Intelligence Deep Dive
Dedicated section with:
- Exact cause of reported "Profile Intelligence not working correctly"
- Step-by-step data flow trace of what happens when user uploads resume
- Where the flow breaks or produces incorrect results
- Specific fix required

### Integration Issues
- Any features that work individually but break when used together
- State conflicts between features
- Ordering dependencies (e.g., must have resume before JD)

### Critical Paths That Need Immediate Fixes
Prioritized list of things to fix RIGHT NOW before the app can be shipped

---

## Important Notes

- **Codebase:** `/Users/shubhampandey/testing/natively-cluely-ai-assistant`
- **Recovered Source:** `/Users/shubhampandey/Desktop/Natively-Recovered-Source`
- **Dev flag:** `NATIVELY_DEV_PREMIUM=1` to enable premium features
- **Dev plan:** `NATIVELY_DEV_PLAN=ultra` for full plan access
- **This is NOT read-only** — if you find a simple bug with a clear fix, fix it. For complex bugs, document and report.
- **Profile Intelligence is the top priority** — user has confirmed it doesn't work correctly
- Save the report as `FUNCTIONALITY_VERIFICATION_REPORT.md` in the project root
- Run all validation commands and include their output in the report
