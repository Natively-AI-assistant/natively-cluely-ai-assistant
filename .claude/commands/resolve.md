---
description: Autopilot issue resolver for Natively — fetch the issue, understand it fully (text, screenshots, logs, env), reproduce it in an isolated temp folder, fix it there, verify the fix, then apply the fix to your working tree as uncommitted modifications. No branch switch, no commit, no push.
argument-hint: <issue-number>
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# Natively Issue Resolver — Autopilot

Resolve the GitHub issue specified by: **$ARGUMENTS**

Run end-to-end. Eight phases:

1. **Fetch** the issue (body, comments, labels, attachments, screenshots, logs)
2. **Understand** the bug — what's reported, what's the expected behaviour, what's the user's environment
3. **Reproduce** the bug in an isolated temp folder to confirm it's real
4. **Fix** the bug there at the right layer (not the symptom)
5. **Verify** the fix — same reproduction now succeeds, nothing else regressed
6. **Apply** the fix to your working tree as uncommitted, unstaged file changes
7. **Report** what was done and what's pending
8. **Cleanup** the temp folder

**No branch switch. No commit. No push. No PR creation.** The fix shows up in your working tree as if you typed it yourself. You review with `git diff`, build, test, and commit when you're ready — or `git checkout -- .` to discard it.

---

## Resolve input

`$ARGUMENTS` is the GitHub issue number (`42`, `#42`, or a full URL like `https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant/issues/42`).

If `$ARGUMENTS` is empty or unparseable, **and only then**, stop and ask. Otherwise proceed silently.

---

## Role

You are debugging a real bug report on **Natively** — an open-source Electron + TypeScript + Rust desktop AI assistant (AGPL-3.0). Real users on real machines (macOS Apple Silicon, macOS Intel, Windows 10/11) hit this bug and took the time to file an issue. They deserve a real fix, not a workaround that masks the symptom.

The repo uses a git submodule architecture: open-source core in this repo, `premium/` submodule for Pro features. Audio capture is Rust via `napi-rs`. Transcription is multi-provider (Deepgram, Google STT, Groq, OpenAI Whisper, ElevenLabs, Soniox, Azure, IBM). LLM routing cascades through Natively API → Gemini fallback. Local RAG uses SQLite + `sqlite-vec`. Stealth mode hides from dock and disguises process names.

**Operating mode: autopilot.** Run every phase end-to-end. The only stops are: (a) the issue can't be reproduced (Phase 3 fail) → escalate to Evun with diagnostic info; (b) the fix would touch the `premium/` submodule → escalate; (c) the fix would require a breaking API change or a new dependency → escalate; (d) the working tree was dirty when the command started → save the patch and stop without applying.

---

## Hard rules — never break these

1. **Never `git checkout`, `git switch`, `git branch`, `git merge`, `git cherry-pick`, `git rebase`, or `git commit` in the user's repo.** All of those are banned in `$ORIGINAL_DIR`. The user's branch and HEAD must be byte-identical before and after this command, except for the working-tree files modified in Phase 6.
2. **Never push to remote.** No `git push`, no `gh issue close`, no PR creation. Evun handles all remote operations.
3. **Never modify the `premium/` submodule contents.** If the fix lives there, stop and report.
4. **Never commit or echo secrets** from issue attachments. Issues frequently contain leaked API keys in pasted logs — redact every match of `sk-`, `AIza`, `gsk_`, `xoxb-`, `BEGIN PRIVATE KEY`, `whsec_`, `pdt_`, JWT patterns, and anything matching `[A-Za-z0-9_-]{32,}` inside an env value or URL. If you find live secrets in an issue, flag them in the report so Evun can rotate.
5. **Never fix the symptom if you can find the cause.** A `try/catch` that swallows the error is not a fix. A null check that hides a real null-flow bug is not a fix. If you genuinely cannot find the root cause, say so explicitly in the report rather than papering over it.
6. **Never invent a reproduction.** If you can't reproduce the bug in the temp folder, that is the answer — don't fabricate a "I think this might be the issue" fix and ship it.
7. **Working tree is sacred.** All bug investigation and fix work happens in `$TEMP_DIR` (a separate worktree under `/tmp`). The user's working tree is untouched until Phase 6, and only if it was clean when the command started.
8. **No AI-slop in your own fix.** No `// intelligently handle this`, no `handleErrorSmartly`, no `// rest of the logic`. Code you write must pass the same review bar as the PR review autopilot.

---

## Phase 0 — Setup

```bash
set -e
ORIGINAL_DIR="$(pwd)"
ORIGINAL_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
ORIGINAL_HEAD="$(git rev-parse HEAD)"
TIMESTAMP=$(date +%s)
ISSUE_NUM="<parsed from $ARGUMENTS>"
TEMP_DIR="/tmp/natively-issue-${ISSUE_NUM}-${TIMESTAMP}"
LOG_DIR="/tmp/natively-issue-${ISSUE_NUM}-${TIMESTAMP}-logs"
ASSETS_DIR="$LOG_DIR/assets"
mkdir -p "$LOG_DIR" "$ASSETS_DIR"

# Snapshot user state — we'll verify nothing changed at cleanup
echo "$ORIGINAL_BRANCH" > "$LOG_DIR/original-branch"
echo "$ORIGINAL_HEAD"   > "$LOG_DIR/original-head"
git status --porcelain  > "$LOG_DIR/original-worktree-status"

# Was the working tree clean when we started? Determines whether Phase 6 can apply.
if [ -z "$(cat $LOG_DIR/original-worktree-status)" ]; then
  WORKTREE_WAS_CLEAN=true
else
  WORKTREE_WAS_CLEAN=false
fi

git fetch origin --quiet

# Use git worktree (faster than fresh clone, shares object DB) but place it OUTSIDE the
# user's repo path so it can't be confused with their checkout. Temp dir lives in /tmp.
git worktree add "$TEMP_DIR" origin/main --quiet

# Initialise the premium submodule read-only — needed for builds, never modified
cd "$TEMP_DIR"
git submodule update --init --recursive --quiet
cd "$ORIGINAL_DIR"
```

If `WORKTREE_WAS_CLEAN=false`, **continue anyway** — we still want to investigate and produce a patch. Phase 6 will save the patch to disk and skip the apply step, telling you to apply it manually after committing/stashing your work.

---

## Phase 1 — Fetch the issue

Use `gh` CLI. If `gh` isn't available, fall back to `curl` with the GitHub API.

```bash
# Pull the issue + all comments as JSON
gh issue view "$ISSUE_NUM" --json number,title,body,labels,state,author,createdAt,comments,assignees \
  > "$LOG_DIR/issue.json"

# Save the human-readable form too
gh issue view "$ISSUE_NUM" > "$LOG_DIR/issue.txt"

# Download every attachment (images, logs, gif demos) referenced in the issue body and comments.
# GitHub attachment URLs look like:
#   https://github.com/user-attachments/assets/<uuid>
#   https://user-images.githubusercontent.com/<id>/<file>
#   https://github.com/<owner>/<repo>/assets/<id>/<filename>
grep -oE 'https://(github\.com/user-attachments/assets|user-images\.githubusercontent\.com|github\.com/[^/]+/[^/]+/assets)/[A-Za-z0-9/_.-]+' \
  "$LOG_DIR/issue.json" \
  | sort -u \
  | while read -r url; do
      filename="$ASSETS_DIR/$(basename "$url")"
      curl -sL "$url" -o "$filename" || echo "FAILED: $url"
    done

ls -la "$ASSETS_DIR/" > "$LOG_DIR/attachments.txt"
```

Now extract the structured signal from the issue:

- **Title and body** — what does the user say is broken?
- **Steps to reproduce** — copy verbatim. If missing, note it and infer from the body.
- **Expected vs actual** — what should happen vs what does.
- **Environment** — OS (macOS Apple Silicon / Intel / Windows version), Natively version, LLM provider, STT provider, Node version. Flag if missing.
- **Attached logs** — read every log file. Look for the actual error message and stack trace, not just the user's description of it.
- **Attached screenshots / GIFs** — read them. They often show UI state the user didn't describe in words.
- **Comments** — the original report is often refined in comments. A maintainer may have already partially diagnosed it. Read every comment.
- **Labels** — `bug`, `audio`, `stealth`, `windows`, `macos`, `transcription`, `crash`, etc. give you a fast pointer to the subsystem.

Produce a structured understanding block, saved to `$LOG_DIR/understanding.md`:

```
ISSUE #<n>: <title>

REPORTED BY: @<user>  ·  STATE: <open/closed>  ·  AGE: <days>
LABELS: <list>

USER ENVIRONMENT:
  OS: <macOS 14.5 Apple Silicon | Windows 11 23H2 | unknown>
  Natively version: <2.0.9 | unknown>
  Provider stack: <Gemini + Deepgram | Ollama + Whisper | unknown>
  Other: <Node version, hardware, etc.>

REPRODUCTION STEPS (verbatim from user):
  1. ...
  2. ...

EXPECTED:
  <what user expects>

ACTUAL:
  <what user sees>

KEY ERROR (from logs/screenshots):
  <exact stack trace or error message — verbatim, redacted for secrets>

ATTACHMENTS:
  - <filename> (<size>): <one-line summary of what it shows>

COMMENTS WORTH READING:
  - @<user> at <timestamp>: <one-line summary>

INFERRED SUBSYSTEM:
  <e.g. "audio capture (native-module/), Windows-only" or "STT routing in src/electron/stt/">

CONFIDENCE: HIGH | MEDIUM | LOW that this is reproducible
```

If `CONFIDENCE: LOW`, that is itself a finding — note what's missing (no logs, no env, vague description) so Evun can ask the reporter for more.

---

## Phase 2 — Understand the code (read inside $TEMP_DIR only)

Before touching anything, read the relevant code paths in the temp folder. Use the inferred subsystem to scope the search:

```
Audio bugs:        native-module/  electron/audio*.ts  src/audio/
Transcription:     src/electron/stt/  electron/sttHandlers.ts
LLM routing:       src/electron/ai/  electron/aiCoordinator.ts
Stealth/windows:   electron/main.ts  electron/windows/  src/stealth/
RAG/memory:        src/electron/rag/  src/electron/db/
Webhooks/payments: src/electron/payments/  electron/dodoWebhook.ts
UI:                renderer/  src/renderer/
Settings:          electron/settings*.ts  src/electron/store.ts
```

Read until you can answer:

- Which function actually fails for the user's input?
- What does the failure path do — throw, return null, log silently, deadlock?
- Is this code platform-specific? (Many bugs are Windows-only or macOS-only.)
- Is there a recent change to this code? `cd $TEMP_DIR && git log -p --since='30 days ago' <file>` — bugs reported now are often regressions from recent commits.
- Are there existing tests for this path? If yes, why didn't they catch it?

Save your reading notes to `$LOG_DIR/code-understanding.md`. Do not start fixing yet.

**Stop and escalate** if the relevant code lives entirely in `premium/`. Add a note to the report with the diagnosis and skip to Phase 7.

---

## Phase 3 — Reproduce (inside $TEMP_DIR)

A bug fix without a reproduction is a guess. Build a minimal reproduction in the temp folder *before* writing the fix.

Three reproduction strategies. Pick whichever the bug allows, in this order:

### 3a. Unit-test reproduction (best)

If the bug is in a pure function or a module with mockable dependencies, write a test that exercises the user's reported input and asserts the buggy behaviour.

```bash
cd "$TEMP_DIR"
# Create a reproduction test file under the existing test layout.
# Keep it in the same place a real fix would put it — that test will become part of the patch.
npx jest <path-to-test> --runInBand 2>&1 | tee "$LOG_DIR/repro-test-before.log"
```

Expected: the test **fails** with the same error the user reported. That's a confirmed reproduction.

If the test passes when it should fail → your reproduction is wrong, not the bug. Re-read the issue and the code. Don't proceed.

### 3b. Integration / build-level reproduction

If the bug only manifests when the whole app builds or when modules wire together (e.g. IPC, native module boundary, multi-window state), reproduce by running the actual build steps that trigger it inside the temp folder:

```bash
cd "$TEMP_DIR"
npm ci 2>&1 | tee "$LOG_DIR/repro-install.log"
npx tsc --noEmit 2>&1 | tee "$LOG_DIR/repro-typecheck.log"
npm run build:native 2>&1 | tee "$LOG_DIR/repro-native.log"
npm run dist 2>&1 | tee "$LOG_DIR/repro-dist.log"
```

Confirm the same error appears in your output as in the user's logs. Diff the messages — they should match in the meaningful part.

### 3c. Runtime reproduction (manual / by inspection)

Some bugs only appear at runtime — wrong UI state, audio not capturing, stealth mode showing in dock. You can't run Electron interactively here, so:

- Read the code path and trace it on paper. Confirm by inspection that the user's input flows to the failure they describe.
- Construct a unit test or integration test that covers the relevant slice (Phase 3a fallback).
- If genuinely runtime-only and not test-coverable, document this in the report — Evun will need to verify the fix manually after applying it.

### Reproduction outcomes

After Phase 3, one of:

- ✅ **Reproduced via unit test.** Save the failing test output to `$LOG_DIR/repro-test.failing.txt` for the audit trail. The test file itself stays in the temp folder and becomes part of the patch in Phase 6.
- ✅ **Reproduced via build/runtime logs.** Save matching log diff to `$LOG_DIR/repro-match.txt`.
- ⚠️ **Could not reproduce.** Stop. Skip Phases 4–6, jump to Phase 7 with verdict `NEEDS_MORE_INFO` — produce a comment for the reporter asking for the specific missing details.

---

## Phase 4 — Fix (inside $TEMP_DIR only)

Now and only now, write the fix. **All edits happen in the temp folder.** The user's working tree is not touched.

### Principles

- **Fix at the cause, not the call site.** If a function returns `undefined` because its caller passes the wrong arg, fix the caller. If the caller is right and the function should handle the input, fix the function. Don't add a defensive check at every call site.
- **Smallest correct change.** A 5-line fix that solves the bug is better than a 200-line refactor that also solves it. Refactors are separate work.
- **Preserve existing behaviour for all other inputs.** Run mental diffs: who else calls this function? What inputs do they send? Will my change break them?
- **Match the existing style of the file.** Naming, error handling pattern, log format. The fix should be invisible in style review.
- **Native module changes are expensive.** Touching `native-module/` Rust code triggers a rebuild and may differ across macOS/Windows. Avoid if a TS-side fix is correct.
- **Cross-platform.** If the bug is Windows-only or macOS-only, branch on `process.platform`. Don't apply a Windows fix to the macOS path.

### Off-limits in autopilot

These automatically escalate to Evun (skip Phases 5–6 with verdict `NEEDS_HUMAN`, but still produce the diagnosis in the report):

- Fix requires modifying `package.json` / `Cargo.toml` (new dep or version bump).
- Fix requires modifying the `premium/` submodule.
- Fix changes the IPC contract (signatures of `ipcMain.handle` channels) in a way that requires renderer-side updates — too easy to break consumers we can't see.
- Fix changes a public type exported from `electron.d.ts` or a top-level config schema.
- Fix touches the Dodo Payments webhook signature/idempotency code — pricing-critical, human review only.
- Fix touches stealth-mode core (process disguise, dock hiding) — marketed feature, human review only.

### Write the fix

Edit the relevant files in `$TEMP_DIR`. **Do not commit them** — the fix lives in the temp folder's working tree, uncommitted. Phase 6 will diff this against `origin/main` to produce the patch.

After each edit:

```bash
cd "$TEMP_DIR"
npx tsc --noEmit 2>&1 | tee -a "$LOG_DIR/fix-typecheck.log"
```

If typecheck fails, fix or revert before continuing. Don't pile error onto error.

If you added a regression test in Phase 3a, it stays in the temp folder and becomes part of the patch. A bug + a test that catches it = the right outcome.

Save your one-line description of the fix to `$LOG_DIR/fix-summary.txt`. Save a longer rationale (why this fix, what alternatives you considered, what trade-offs) to `$LOG_DIR/fix-rationale.md`.

---

## Phase 5 — Verify (inside $TEMP_DIR)

Run the full test ladder in the temp folder. The fix is real only if all of these hold.

```bash
cd "$TEMP_DIR"

# 1. The reproduction now passes (the bug is gone)
npx jest <repro-test-path> --runInBand 2>&1 | tee "$LOG_DIR/verify-repro.log"

# 2. Type check
npx tsc --noEmit 2>&1 | tee "$LOG_DIR/verify-typecheck.log"

# 3. Lint
npm run lint 2>&1 | tee "$LOG_DIR/verify-lint.log" || echo "(no lint script)"

# 4. Native module build (if Rust touched)
npm run build:native 2>&1 | tee "$LOG_DIR/verify-native.log"

# 5. Full unit test suite — make sure nothing else broke
npm test 2>&1 | tee "$LOG_DIR/verify-test.log" || echo "(no test script)"

# 6. Production build
npm run dist 2>&1 | tee "$LOG_DIR/verify-dist.log"
```

Record pass/fail for each step.

**Failure handling:**

- If the reproduction test still fails → the fix doesn't work. Go back to Phase 4. **Do not produce a patch for a non-working fix.**
- If type/build/lint fails → fix or revert.
- If a previously-passing test now fails → your fix broke something else. Go back to Phase 4 and find a less invasive fix, or escalate to Evun with verdict `REGRESSION_RISK` if you can't.
- If `npm run dist` fails for environmental reasons (signing, network) — note it but don't block. Look at the log tail for actual code errors.

If everything passes, the fix is verified. Proceed.

---

## Phase 6 — Apply the fix to the working tree (no commit, no branch switch)

**Skip this phase if:**
- Verdict is `NEEDS_MORE_INFO`, `NEEDS_HUMAN`, `UNREPRODUCIBLE`, or `REGRESSION_RISK` — there's nothing to apply.
- Phase 5 had code-related failures.
- `WORKTREE_WAS_CLEAN=false` — the user has uncommitted work; we save the patch but don't apply it.

Compute the full diff inside the temp folder (regression test + fix) and apply it to the user's working tree using `git apply`. **No checkout, no commit, no merge, no cherry-pick.** The user's branch and HEAD do not change.

```bash
# 1. Generate the full patch from inside the temp folder.
#    --binary handles binary files (images, fonts).
#    Compare against origin/main to capture every change including new files & deletions.
cd "$TEMP_DIR"
git diff --binary origin/main > "$LOG_DIR/fix.patch"

cd "$ORIGINAL_DIR"

# 2. Always preserve the patch — even if we can't auto-apply, Evun gets the artifact.
echo "Patch saved at: $LOG_DIR/fix.patch"

# 3. Sanity check: confirm we never moved branch or HEAD during the run.
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
CURRENT_HEAD="$(git rev-parse HEAD)"
if [ "$CURRENT_BRANCH" != "$ORIGINAL_BRANCH" ] || [ "$CURRENT_HEAD" != "$ORIGINAL_HEAD" ]; then
  echo "ABORT: branch or HEAD changed unexpectedly — refusing to apply"
  echo "  was: $ORIGINAL_BRANCH @ $ORIGINAL_HEAD"
  echo "  now: $CURRENT_BRANCH @ $CURRENT_HEAD"
  exit 1
fi

# 4. Sanity check: working tree must still match what we saw at Phase 0.
CURRENT_STATUS="$(git status --porcelain)"
if [ "$CURRENT_STATUS" != "$(cat $LOG_DIR/original-worktree-status)" ]; then
  echo "APPLY_SKIPPED: working tree changed during investigation"
  echo "Refusing to apply to avoid clobbering changes."
  echo "Apply manually when ready: git apply --3way $LOG_DIR/fix.patch"
  # jump to Phase 7
fi

# 5. If working tree was dirty at start, skip apply but keep the patch.
if [ "$WORKTREE_WAS_CLEAN" != "true" ]; then
  echo "APPLY_SKIPPED: working tree was dirty when run started"
  echo "Apply manually after committing/stashing your work:"
  echo "  git apply --3way $LOG_DIR/fix.patch"
  # jump to Phase 7
fi

# 6. Dry-run the patch to catch any conflict before touching files.
if ! git apply --check "$LOG_DIR/fix.patch" 2>"$LOG_DIR/apply-check.err"; then
  echo "APPLY_SKIPPED: patch does not apply cleanly to current working tree"
  echo "  reason: $(cat $LOG_DIR/apply-check.err)"
  echo "  most likely cause: your local branch has diverged from origin/main in"
  echo "  files this fix also touches"
  echo "Try 3-way merge manually: git apply --3way $LOG_DIR/fix.patch"
  # jump to Phase 7
fi

# 7. Apply for real. No --index, no --cached — files become unstaged modifications,
#    exactly as if Evun edited them in their editor. Nothing is staged. Nothing is committed.
git apply "$LOG_DIR/fix.patch"

# 8. Confirm: branch and HEAD are still byte-identical to where we started.
POST_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
POST_HEAD="$(git rev-parse HEAD)"
if [ "$POST_BRANCH" != "$ORIGINAL_BRANCH" ] || [ "$POST_HEAD" != "$ORIGINAL_HEAD" ]; then
  echo "INVARIANT VIOLATION: branch or HEAD moved during apply — should be impossible"
  exit 1
fi

# 9. Report what landed.
CHANGED_FILES_COUNT=$(git status --porcelain | wc -l)
echo "APPLIED: $CHANGED_FILES_COUNT file(s) modified in working tree (uncommitted, unstaged)"
echo "Branch:  $ORIGINAL_BRANCH (unchanged)"
echo "HEAD:    $ORIGINAL_HEAD (unchanged)"
echo ""
echo "Review the changes:   git diff"
echo "Discard everything:   git checkout -- .   (or: git apply -R $LOG_DIR/fix.patch)"
echo "Stage for commit:     git add -A"
```

### Why this design

- **`git apply` (not `git am`, not `cherry-pick`, not `merge`)** — those create commits or move HEAD. `git apply` only modifies files in the working tree.
- **No `--index` flag** — that would also stage the changes. Without it, `git status` shows the changes as unstaged ("Changes not staged for commit"). Evun can `git diff` them, edit them, partial-stage with `git add -p`.
- **`--check` first** — never write to the working tree if the patch wouldn't cleanly apply. If your local has diverged from `origin/main` in overlapping files, the report tells you to use `git apply --3way` manually.
- **Branch invariant checks** — the script asserts at multiple points that `HEAD` and the current branch name haven't moved. Belt and suspenders.
- **Reversible by `git checkout -- .`** — since nothing is committed, discarding the fix is one stock git command.

### What you see after Phase 6

```bash
$ git status
On branch <your-branch>                    # unchanged
Your branch is up to date with ...

Changes not staged for commit:
  modified:   src/electron/sttHandlers.ts
  new file:   src/electron/__tests__/issue-42-repro.test.ts
  ...

no changes added to commit
```

Build, run the app, run the manual test below, then commit yourself if you like the changes — or `git checkout -- .` to throw them away.

---

## Phase 7 — Report

Single Markdown block, paste-ready. Print to stdout AND save to `$LOG_DIR/report.md`.

```markdown
## 🤖 Automated Issue Resolution (Claude Code)

**Issue:** #<n> — <title>
**Verdict:** <RESOLVED | NEEDS_MORE_INFO | NEEDS_HUMAN | UNREPRODUCIBLE | REGRESSION_RISK>
**Reviewed:** <ISO timestamp>

### TL;DR
<2 sentences: what was broken, what the fix does (or what's blocking).>

### Understanding
- **Reported environment:** <OS, Natively version, provider stack>
- **Subsystem:** <native audio | STT routing | stealth mode | etc.>
- **Root cause:** <one paragraph — the actual cause, not the symptom>
- **Why it wasn't caught:** <missing test? recent regression? platform-specific?>

### Reproduction
- **Method:** <unit test | build log | runtime trace>
- **Confirmed:** ✅ / ⚠️ Could not reproduce
- **Evidence:** <path to log or test that demonstrates the original failure>

### Fix
- **Files changed:** <list>
- **Lines:** +<n> / -<n>
- **Approach:** <one paragraph rationale>
- **Alternatives considered:** <bullets — what else could have worked, why this one>
- **Regression test added:** Yes (`<path>`) / No (<reason>)

### Verification (run in temp folder)
| Check | Result | Notes |
|---|---|---|
| Reproduction now passes | ✅/❌ | |
| `tsc --noEmit` | ✅/❌ | |
| `npm run lint` | ✅/❌/skipped | |
| `npm run build:native` | ✅/❌/skipped | |
| `npm test` (full suite) | ✅/❌/skipped | |
| `npm run dist` | ✅/❌/env-issue | |

### 📦 Apply status
<Exactly one of:>
- ✅ **Applied to your working tree.** `<N>` file(s) modified, unstaged. Branch `<your-branch>` and HEAD unchanged. Review with `git diff`.
- ⚠️ **Skipped — working tree was dirty when run started.** Patch saved at `<LOG_DIR>/fix.patch`. Apply manually after committing or stashing your work: `git apply --3way <patch-path>`.
- ⚠️ **Skipped — patch did not apply cleanly.** Your local branch has diverged from `origin/main` in overlapping files. Patch saved at `<LOG_DIR>/fix.patch`. Try 3-way merge: `git apply --3way <patch-path>`.
- 🛑 **Skipped — verdict was <NEEDS_MORE_INFO | NEEDS_HUMAN | UNREPRODUCIBLE | REGRESSION_RISK>.** Nothing applied. See diagnosis above.
- 🛑 **Skipped — verification failed in Phase 5.** Nothing applied.

### Manual test for Evun (~2 min)
<Tailored checklist exercising the specific bug path. Examples:>
- [ ] Trigger the original repro steps from the issue → bug should not occur.
- [ ] Run platform-specific check on <macOS/Windows> if the fix branched on `process.platform`.
- [ ] If the fix touched audio/stealth/webhook code, run the regression check from the PR review autopilot.

### Edge cases considered
<Bullet list. Always: empty input, network failure, missing API key, denied OS permission, concurrent invocation, cross-platform paths. Plus issue-specific cases.>

### ⚠️ Secrets noticed in the issue
<List redacted matches Evun should rotate, or "None.">

### Next steps for Evun
1. Review the changes: `git diff` (or `git diff --stat` for an overview).
2. Build and run the manual test above (~2 min).
3. If you like it: `git add -A && git commit -m "fix: <summary>. Resolves #<n>"`.
4. To discard: `git checkout -- .` (works because nothing is committed).
5. The patch at `<LOG_DIR>/fix.patch` is preserved — re-apply later with `git apply <path>` or share it.

### Logs
Full logs at `<LOG_DIR>` (understanding, code reading, repro, fix rationale, verify).
Patch at `<LOG_DIR>/fix.patch` (always preserved, even if applied).
Issue attachments at `<LOG_DIR>/assets/`.
Temp folder at `<TEMP_DIR>` — removed in Phase 8.

---
*Generated by Claude Code autopilot. Fix is staged in your working tree as uncommitted changes. No branch switch, no commits, no push. Final commit decision: human only.*
```

### Verdict-specific report variants

- **`NEEDS_MORE_INFO`** (Phase 3 couldn't reproduce, issue missing details): Include a draft comment for the reporter asking for the specific missing pieces (full crash log, OS version, provider config, exact reproduction steps). Save to `$LOG_DIR/draft-comment.md`.
- **`NEEDS_HUMAN`** (fix landed in off-limits territory): Include the diagnosis and the proposed fix as a code block in the report (not applied), and the reason it's escalated.
- **`UNREPRODUCIBLE`** (steps followed but bug doesn't appear): Include a draft comment saying so, with the reproduction attempt logs attached, asking the reporter to verify on the latest version or share more env detail.
- **`REGRESSION_RISK`** (fix worked but broke something else): Include both the fix attempt and the regression it caused, escalate to Evun for a less invasive approach.

---

## Phase 8 — Cleanup (always runs)

```bash
cd "$ORIGINAL_DIR"

# Remove the temp worktree regardless of outcome
git worktree remove --force "$TEMP_DIR" 2>/dev/null || true

# Final invariant check: the user's branch and HEAD are exactly where they started.
FINAL_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
FINAL_HEAD="$(git rev-parse HEAD)"
if [ "$FINAL_BRANCH" != "$ORIGINAL_BRANCH" ] || [ "$FINAL_HEAD" != "$ORIGINAL_HEAD" ]; then
  echo "WARNING: branch or HEAD moved during this run — please report a bug"
  echo "  was: $ORIGINAL_BRANCH @ $ORIGINAL_HEAD"
  echo "  now: $FINAL_BRANCH @ $FINAL_HEAD"
fi

# Always preserve the logs, patch, and issue attachments at $LOG_DIR.
echo "Logs:        $LOG_DIR"
echo "Patch:       $LOG_DIR/fix.patch (re-apply with: git apply $LOG_DIR/fix.patch)"
echo "Attachments: $LOG_DIR/assets/"
```

Don't delete `$LOG_DIR` — Evun may want to see the issue attachments, the original logs, the fix rationale, or re-apply the patch later.

---

## Quick reference: what a real fix looks like vs what to escalate

**Real fix (autopilot can produce a patch):**
- A `setInterval` not cleared on window close → add `clearInterval` in the cleanup handler.
- A path used `+` instead of `path.join`, breaks on Windows → use `path.join`.
- A WebSocket missing the `encoding=linear16` query param causes immediate close → add the param.
- A `Math.ceil` over-bills users for short sessions → switch to `Math.round` with a 30s minimum.
- A null-check missing on a Settings value during first-run → add the null-check, default to the documented value.

**Escalate (write the diagnosis, don't produce a patch):**
- "The fix is to upgrade `electron` from 28 to 30." → dependency change.
- "Stealth mode is showing the dock icon on macOS 15." → stealth core, marketed feature.
- "The webhook signature check has a timing-attack hole." → payments-critical.
- "We should rewrite the embedding cascade." → out of scope for an issue resolver.
- "I can't tell what's wrong, the logs cut off mid-stack-trace." → not enough info, draft a comment asking for more.

The test, always: would Evun, looking at this `git diff` cold, understand exactly what was broken, what changed, and why? If no, the rationale section in the report isn't strong enough — strengthen it.
