# Profile Intelligence: Deep Investigation & Fix Prompt

## Mission

Profile Intelligence is **not working correctly** (user-confirmed). Your job is to:
1. Find exactly what's broken
2. Fix every bug you find
3. Confirm the fixes work via code review and tests

This is NOT read-only. Fix what you find.

---

## Context

- **Project:** `/Users/shubhampandey/testing/natively-cluely-ai-assistant`
- **Recovered Source:** `/Users/shubhampandey/Desktop/Natively-Recovered-Source/recovered/source/natively-3.1.0/premium/electron/`
- **Dev flag:** `NATIVELY_DEV_PREMIUM=1 NATIVELY_DEV_PLAN=ultra`
- **Branch:** `premium` (all 45 TS source files already restored, preload types already fixed)

---

## Step 1: Run the app and observe Profile Intelligence

```bash
cd /Users/shubhampandey/testing/natively-cluely-ai-assistant
NATIVELY_DEV_PREMIUM=1 NATIVELY_DEV_PLAN=ultra npm run dev
```

Watch the main process console output for:
- Any `Error:` or `Uncaught` messages
- `[KnowledgeOrchestrator]` initialization messages
- `[IPC] Knowledge mode` messages
- `featureGate` premium check results
- Any crash or rejection during startup

---

## Step 2: Trace the Profile Intelligence data flow

Profile Intelligence works through this pipeline:

```
User uploads resume
  → profile:upload-resume IPC
  → KnowledgeOrchestrator.ingestDocument()
  → DocumentReader (extract text)
  → StructuredExtractor (LLM extraction)
  → HeuristicExtractor (fallback if LLM fails)
  → StructuredResumeNormalizer (normalize skills)
  → KnowledgeDatabaseManager (store)
  → profile:get-status returns updated flags
```

For each stage, verify:

### A. KnowledgeOrchestrator initialization

File: `premium/electron/knowledge/KnowledgeOrchestrator.ts`

- Does it initialize correctly when `NATIVELY_DEV_PREMIUM=1`?
- Does `electron/ipcHandlers.ts` correctly call `KnowledgeOrchestrator` after license check passes?
- Is there any place where `knowledgeOrchestrator` is null/undefined when IPC handlers try to use it?
- **BUG HUNT:** Search for `knowledgeOrchestrator()` and `getKnowledgeOrchestrator()` calls — are they all correctly guarded?

```bash
grep -n "knowledgeOrchestrator\|KnowledgeOrchestrator\|knowledge mode" electron/ipcHandlers.ts | head -60
```

### B. profile:upload-resume IPC handler

```bash
grep -n "profile:upload-resume\|upload-resume\|uploadResume" electron/ipcHandlers.ts
```

- Does the handler exist?
- Does it call `KnowledgeOrchestrator.ingestDocument()`?
- Does it correctly set `resume_indexing_in_flight` before and after?
- Does it correctly handle errors and clear the in-flight flag even on failure?

### C. profile:get-status IPC handler

```bash
grep -n "profile:get-status\|profileGetStatus\|get-status" electron/ipcHandlers.ts | head -20
```

Read the full handler (it's around line 18455). Verify it returns ALL of these fields:
```
hasProfile
profileMode
name
role
totalExperienceYears
resume_structured_extraction_complete
resume_profile_facts_ready / profileFactsReady
jd_structured_extraction_complete / jdFactsReady
aot_pipeline_running
resume_indexing_in_flight
jd_indexing_in_flight
extractionMode
```

**BUG HUNT:** Are any fields missing, returning `undefined`, or computing incorrectly?

### D. DocumentReader

File: `premium/electron/knowledge/DocumentReader.ts`

- Does it support PDF, DOCX, TXT, MD?
- Are the dependencies for PDF/DOCX extraction installed in `package.json`?
- Does it handle large files (>50MB) correctly?

```bash
grep -n "pdf\|docx\|DocumentReader" premium/electron/knowledge/DocumentReader.ts | head -30
```

### E. StructuredExtractor + HeuristicExtractor

File: `premium/electron/knowledge/StructuredExtractor.ts`

- Does it call an LLM to extract structured data?
- Which LLM provider does it use? Is that provider initialized?
- Does it fall back to `HeuristicExtractor` on failure?

```bash
grep -n "llm\|LLM\|claude\|openai\|provider" premium/electron/knowledge/StructuredExtractor.ts | head -30
```

**CRITICAL BUG HUNT:** 
- Does `StructuredExtractor` require an API key or LLM connection to work?
- If the user has no API key configured, does extraction fail silently?
- Is there a code path where extraction "succeeds" with empty output?

### F. Profile state flags — the most likely bug

The preload type for `profile:get-status` was recently fixed to include all fields. But the **renderer components** may still not be reading the new fields.

```bash
grep -rn "profileGetStatus\|profile:get-status\|profileMode\|hasProfile\|resume_indexing_in_flight\|profileFactsReady" src/ --include="*.tsx" --include="*.ts" | head -40
```

**BUG HUNT:** Are there renderer components that check `profileFactsReady` but were written when the preload only returned 5 fields? They may be in a permanent "loading" or "not ready" state.

### G. KnowledgeDatabaseManager

File: `premium/electron/knowledge/KnowledgeDatabaseManager.ts`

```bash
grep -n "better-sqlite3\|sqlite\|Database\|createTable\|init" premium/electron/knowledge/KnowledgeDatabaseManager.ts | head -20
```

- Does it correctly initialize the SQLite database?
- Does it use `app.getPath('userData')` for the DB path?
- Is `better-sqlite3` installed and built for the current Electron version?

```bash
ls node_modules/better-sqlite3 2>/dev/null && echo "PRESENT" || echo "MISSING"
```

---

## Step 3: Check the premium feature gate

```bash
grep -n "featureGate\|premium\|NATIVELY_DEV_PREMIUM\|license:check-premium\|knowledgeMode" electron/ipcHandlers.ts | head -40
```

**CRITICAL:** Is knowledge mode / profile intelligence gated correctly on `NATIVELY_DEV_PREMIUM=1`? Is there any code that disables it even with the dev flag?

```bash
grep -rn "knowledge mode auto-disabled\|disableKnowledge\|setKnowledgeMode.*false" electron/ --include="*.ts" | head -20
```

---

## Step 4: Check UI renderer

```bash
grep -rn "ProfileIntelligence\|ProfilePanel\|profile-panel\|upload.*resume\|resume.*upload" src/ --include="*.tsx" | head -20
```

- Does the Profile Intelligence UI component exist and render?
- Does it correctly subscribe to `profile:get-status`?
- Does it poll for status updates after upload?

---

## Step 5: Run TypeScript check

```bash
npx tsc --project electron/tsconfig.premium-check.json --noEmit 2>&1 | head -40
npx tsc --noEmit 2>&1 | grep -i "profile\|knowledge\|orchestrator" | head -20
```

---

## Step 6: Run existing tests

```bash
npm test 2>&1 | tail -30
```

---

## Fix Priority

After investigation, fix in this order:

1. **Any initialization failure** — if KnowledgeOrchestrator doesn't start, nothing works
2. **LLM provider wiring** — if StructuredExtractor can't reach an LLM and doesn't fall back gracefully
3. **Status flag bugs** — if profile:get-status returns wrong/missing fields
4. **UI state bugs** — if renderer components don't correctly use the status flags
5. **Database initialization** — if SQLite DB setup fails

---

## Report Format

After investigation and fixes, provide:

### Root Cause Summary
- What specifically is broken in Profile Intelligence
- File:line references for each bug

### Bugs Fixed
For each fix:
```
BUG: [description]
File: path/to/file.ts:line
Root cause: [what was wrong]
Fix applied: [what you changed]
```

### Bugs NOT Fixed (need more info)
List anything you found but couldn't fix without user input (e.g., missing API key, missing config)

### Validation
```bash
# Commands you ran to confirm fixes
```

### What Still Needs Physical Testing
List any behavior that requires running the app UI to verify

---

## Success Criteria

- `npm test` exits 0
- `npx tsc --noEmit` exits 0  
- `npx tsc --project electron/tsconfig.premium-check.json --noEmit` exits 0
- Profile Intelligence IPC handlers all handle errors gracefully
- `profile:get-status` returns all required status fields
- KnowledgeOrchestrator initializes without errors with `NATIVELY_DEV_PREMIUM=1`
