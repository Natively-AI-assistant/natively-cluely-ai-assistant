---
description: Autopilot PR review for Natively — audit, dry-run, auto-fix minor issues, test in an isolated temp folder, then apply the PR's file changes to your working tree as uncommitted modifications. No commits, no branch switch, no merge.
argument-hint: <pr-number | branch-name | fork-url#branch>
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# Natively PR Review — Autopilot

Review the pull request, branch, or fork specified by: **$ARGUMENTS**

Run end-to-end with no intermediate prompts. The flow:

1. Clone / worktree the PR into a temp folder, isolated from your working tree
2. Audit it there (security, AI-slop, architectural fit)
3. Auto-fix minor issues there
4. Build + test there
5. **Apply the resulting file changes to your current working tree as uncommitted, unstaged modifications**
6. Generate a report

**No commits. No branch switch. No merge.** The PR's code lands in your working tree exactly as if you had made the edits yourself. You review the changes, build, test, then `git add` and `git commit` yourself when ready. The PR on GitHub is yours to merge separately whenever you choose.

---

## Resolve input

`$ARGUMENTS` is one of:
- A bare number (`158`, `#158`) → PR number, fetch via `pull/<n>/head`.
- A name with a `/` and no protocol (`feature/elevenlabs-realtime`) → branch on origin.
- A URL with `#` (`https://github.com/x/y#branch`) → fork URL + branch.

If `$ARGUMENTS` is empty or unparseable, **and only then**, stop and ask. Otherwise proceed silently.

---

## Role

You are reviewing a pull request for **Natively** — an open-source Electron + TypeScript + Rust desktop AI assistant (AGPL-3.0). The repo uses a **git submodule architecture**: the main repo (`natively-cluely-ai-assistant`) contains the open-source core, and `premium/` is a submodule pointing at the private Pro features repo. PRs ship to real users on macOS and Windows, capture system audio + microphone via a Rust native module, and route through multiple LLM and STT providers.

**Operating mode: autopilot.** Run every phase without stopping for confirmation. Do not ask clarifying questions mid-run. Do not pause between phases. The only human checkpoint is Evun reading the final report and deciding when to commit/push.

---

## Hard rules — never break these, even on autopilot

1. **Never `git checkout`, `git switch`, `git branch`, `git merge`, `git cherry-pick`, `git rebase`, or `git commit` in the user's repo.** All of those are banned in `$ORIGINAL_DIR`. The user's branch state must be byte-identical before and after this command, except for the working-tree files modified in Phase 6.
2. **Never push to remote.** No `git push`, no `gh pr merge`, no force-push, ever.
3. **Never modify the `premium/` submodule contents.** Read-only. If the PR changes the submodule pointer, flag it and stop.
4. **Never commit or echo secrets.** Redact any API key, token, or credential as `<REDACTED>` in all output. Patterns to redact: `sk-`, `AIza`, `gsk_`, `xoxb-`, `BEGIN PRIVATE KEY`, `whsec_`, `pdt_`, anything matching `[A-Za-z0-9_-]{32,}` inside an env value.
5. **Audit before execute.** Phase 1 completes before any `npm install` or build runs *anywhere* (including the temp folder). A malicious PR's `postinstall` script must never execute on an unaudited PR.
6. **Supply-chain abort:** if Phase 1 finds obfuscated code, base64 blobs in source, postinstall scripts fetching from arbitrary URLs, or `curl | sh` patterns — stop, flag `BLOCKER: SUPPLY_CHAIN`, skip Phases 3–6, jump to the report.
7. **Working tree is sacred.** Never touch the user's working tree until Phase 6 (Apply), and only if the verdict allows AND the working tree was clean when the command started.
8. **Cleanup always runs**, even on failure. The temp folder is removed at the end. Logs are preserved in `/tmp` for the user's reference.

---

## Phase 0 — Setup (silent, no confirmation)

Parse `$ARGUMENTS` into one of `pr` / `branch` / `fork`, then:

```bash
set -e
ORIGINAL_DIR="$(pwd)"
ORIGINAL_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
ORIGINAL_HEAD="$(git rev-parse HEAD)"
TIMESTAMP=$(date +%s)
TEMP_DIR="/tmp/natively-pr-review-${TIMESTAMP}"
LOG_DIR="/tmp/natively-pr-${TIMESTAMP}-logs"
mkdir -p "$LOG_DIR"

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

# Use git worktree (faster, shares object DB with main repo) but place it OUTSIDE the user's
# repo path so it can't be confused with their checkout. The temp dir lives in /tmp.
git worktree add "$TEMP_DIR" origin/main --quiet
cd "$TEMP_DIR"

# Initialise the premium submodule read-only — needed for builds, never modified
git submodule update --init --recursive --quiet

# Pull the PR / branch / fork into the temp worktree (pick one based on parsed $ARGUMENTS)
# pr:     git fetch origin "pull/<N>/head:pr-<N>" --quiet && git checkout "pr-<N>" --quiet
# branch: git fetch origin "<BRANCH>:<BRANCH>" --quiet && git checkout "<BRANCH>" --quiet
# fork:   git remote add contributor "<FORK_URL>" && git fetch contributor "<BRANCH>:pr-fork" --quiet && git checkout pr-fork --quiet

# IMPORTANT: every checkout above happens inside $TEMP_DIR (a separate worktree).
# $ORIGINAL_DIR's branch and HEAD never change.

# Re-sync submodule pointer to whatever the PR specifies
git submodule update --recursive --quiet

# Capture artifacts for the audit
git diff origin/main...HEAD                   > "$LOG_DIR/pr.diff"
git diff --stat origin/main...HEAD            > "$LOG_DIR/pr.stat"
git log --oneline origin/main..HEAD           > "$LOG_DIR/pr.commits"
git diff origin/main...HEAD -- .gitmodules    > "$LOG_DIR/submodule-changes.diff"
git submodule status                          > "$LOG_DIR/submodule-status"
```

Record: files changed, lines +/-, commit count, whether the `premium/` submodule pointer moved, whether the user's working tree was clean. Proceed silently.

---

## Phase 1 — Audit (read everything, execute nothing)

Six passes, in order. Each pass produces findings with severity: `BLOCKER` / `MAJOR` / `MINOR`. Each finding records: file, line range, snippet, problem, severity. All audit work happens against the temp folder's checkout — your working tree is not read for diffing or anything else.

### 1.1 Submodule and scope integrity
- Did the PR move the `premium/` submodule pointer? If yes and the PR isn't explicitly a Pro-tier integration → `BLOCKER`. If yes and it is → verify the new pointer is a published commit on the premium repo and the PR description explains why.
- Did the PR add new submodules? `BLOCKER` unless explicitly justified.
- Does the PR touch files inside `premium/` directly? `BLOCKER` — submodule contents are read-only from this repo.
- Read PR description / commit messages. Note stated intent. Compare to the actual diff. Scope creep ("fix typo" PR that also rewrites the embedding pipeline) → `MAJOR`.
- PR description missing entirely → `MAJOR`.

### 1.2 AI-slop and malpractice
Flag any of the following with the exact snippet:

- **Prompt-as-code:** `"do this smartly"`, `"be clever"`, `"figure out the best way"`, `"handle edge cases gracefully"` baked into application logic (not LLM system prompts, where such phrasing is legitimate). → `BLOCKER`.
- **Hallucinated APIs:** imports, types, or method calls that don't exist in the dependency version pinned in `package.json` / `Cargo.toml`. Cross-check Electron, `napi-rs`, `sqlite-vec`, `@deepgram/sdk`, `@anthropic-ai/sdk`, `openai` versions. → `BLOCKER`.
- **Hallucinated config keys:** new env vars or settings that are read but never written, or written but never read. → `MAJOR`.
- **Stub comments left in:** `// TODO: implement`, `// your code here`, `// rest of the logic`, `// ... (continued)`, `/* implementation */` in shipped code. → `MAJOR`.
- **Plagiarism markers:** verbatim blocks lifted from Cluely / Pluely / OpenCluely / other competitors without attribution. Tells: unusual variable names that don't match repo conventions, comment styles that don't match the rest of the file, license headers from other projects. AGPL-3.0 requires license-compatible incoming code. → `BLOCKER`.
- **Fake tests:** `expect(true).toBe(true)`, tests asserting on the mock instead of the function, snapshot tests with no real assertion, tests that import the module under test and never reference it. → `MAJOR`.
- **Padding:** large reformat-only or rename-only diffs with no behaviour change, dressed up as a refactor. → `MAJOR`.
- **Fabricated benchmarks** in PR description ("10x faster", "<100ms latency") with no reproducible script. → `MAJOR`.
- **LLM-voice PR description** ("Here's a comprehensive overhaul that elegantly handles…") with no concrete what/why. → `MINOR` on its own, but combined with other slop signals, escalate.

### 1.3 Security and privacy (Natively-specific)
- **Secret leakage** in the diff (live keys, JWTs, service account JSON, Dodo Payments webhook secrets). Search the diff for the patterns in Hard Rule 4. → `BLOCKER`.
- **Telemetry expansion:** new outbound network calls to domains not already in use. README promises "limited basic telemetry (basic GA4 install tracking, zero user data)." Anything beyond that needs `PRIVACY.md` updated in the same PR. → `BLOCKER` if no privacy doc update.
- **Stealth-mode regressions:** changes that re-add the app to the dock, restore the taskbar icon, expose the real process name during screen sharing, weaken process disguise, or break cross-window state sync. Stealth is a marketed, battle-tested feature. → `BLOCKER`.
- **Audio buffer mishandling:** raw PCM logged to console, written to disk outside `app.getPath('userData')`, or transmitted to any host other than the configured STT provider. → `BLOCKER`.
- **Electron security:** `nodeIntegration: true`, `contextIsolation: false`, `webSecurity: false`, missing `sandbox`, renderer with raw `ipcMain` access. → `BLOCKER`.
- **IPC input validation:** new `ipcMain.handle` channels that take a path/URL and forward to `fs` / `net` without validation (path traversal, SSRF). → `MAJOR`.
- **AGPL compliance:** new dependencies must be AGPL-compatible. Block proprietary, BSL, SSPL, commercial-only licenses. Cross-check the diff's `package.json` changes. → `BLOCKER` for incompatible licenses.
- **Webhook handling:** any change to Dodo Payments webhook code must preserve HMAC-SHA256 verification and the 24h idempotency replay guard. → `BLOCKER` if either is weakened.

### 1.4 Architectural fit
Natively has specific patterns. Deviations are flagged:

- **Provider cascade:** new LLM/STT providers must plug into the existing cascade (chat: Natively API → Gemini fallback; embeddings: OpenAI → Gemini → Ollama → bundled `bge-small-en-v1.5`; STT: per-provider). PRs that bypass the cascade with their own retry logic create drift. → `MAJOR`.
- **Native audio boundary:** Rust ↔ TS audio data must use `napi::Buffer` zero-copy. Flag `Buffer.from(Array.from(...))` or similar copy patterns. → `MAJOR`.
- **Rate limiting:** new outbound API calls must use the existing token-bucket limiter, not their own setTimeout. → `MAJOR`.
- **Premium boundary:** the public mirror must not expose Pro-tier code paths (Resume context, JD awareness, Company research, Negotiation copilot) without the license check. → `BLOCKER`.
- **Sample rate handling:** any audio path change must respect the existing auto-detection (48kHz hardware, resample to 16kHz mono for REST upload). Flag hardcoded sample rates. → `MAJOR`.
- **Two-stage VAD:** silence-processing changes must preserve the adaptive RMS + WebRTC ML VAD pipeline. Single-VAD regression caused real bugs in the past. → `MAJOR`.

### 1.5 Code quality
- New `any`, `as unknown as`, `@ts-ignore`, `@ts-expect-error` without an explanatory comment → `MINOR` each.
- `await` in IPC handlers / main-process functions without try/catch or `.catch()` → `MAJOR`.
- New `setInterval` / WebSocket / audio stream / DB connection without cleanup in `before-quit` or unmount → `MAJOR`.
- Path joins via string concatenation with `/` instead of `path.join` → `MINOR`.
- Shell commands not branched on `process.platform` when they need to be → `MAJOR`.

### 1.6 Tests and docs
- New behaviour without a test → `MAJOR`.
- New env var without README + `.env.example` update → `MINOR`.
- New IPC channel without an entry in `electron.d.ts` → `MAJOR`.
- New user-visible feature without a `CHANGELOG.md` entry → `MINOR`.
- New global shortcut without an update to the shortcuts list → `MINOR`.

---

## Phase 2 — Verdict (silent, computed, no prompt)

Compute verdict from the audit. Decision rules — strict, no negotiation:

- Any `BLOCKER` of type `SUPPLY_CHAIN` / plagiarism / fabricated benchmarks → **`REJECT`**, skip Phases 3–6, jump to the report.
- Any other `BLOCKER` → **`REQUEST_CHANGES`**, skip Phases 3–6, jump to the report.
- Only `MAJOR` issues, ≤ 3 of them, all auto-fixable per Phase 3 rules → **`APPROVE_WITH_FIXES`**.
- More than 3 `MAJOR` issues, or any `MAJOR` not auto-fixable → **`REQUEST_CHANGES`**.
- Only `MINOR` issues → **`APPROVE_WITH_FIXES`**.
- No issues → **`APPROVE`**.

Do not print the verdict yet. It goes in the final report.

**Apply eligibility:** Only verdicts `APPROVE` and `APPROVE_WITH_FIXES` proceed to Phase 6. `REQUEST_CHANGES` and `REJECT` skip applying entirely.

---

## Phase 3 — Auto-fix (only for APPROVE / APPROVE_WITH_FIXES)

Fix what is fixable, **inside the temp folder only**. The fixes are folded into the diff that gets applied in Phase 6 — they don't become separate commits anywhere because the user wants no commits at all.

Rules:

1. Edit files in `$TEMP_DIR` directly. **Do not commit them in the temp folder either.** Phase 6 computes the diff between `origin/main` and the temp folder's working tree, which captures both the PR changes and your fixes in one diff.
2. Do not change the PR's intent — fix only what was flagged.
3. Do not reformat untouched files.
4. Hard ceilings — exceeding any of these aborts the fix and downgrades the verdict to `REQUEST_CHANGES` for that finding:
   - More than 30 lines changed for one fix.
   - File outside the PR's existing diff.
   - Touches the `premium/` submodule.
   - Touches `package.json` / `Cargo.toml` dependency lists (dependency changes need contributor sign-off).
5. After each edit, re-run `npx tsc --noEmit` silently inside `$TEMP_DIR`. If it fails, revert that file (`git checkout -- <file>`) and mark the finding as `REQUEST_CHANGES`.

For `MAJOR` findings outside auto-fix scope, write a comment block in the report describing the required fix. Do not attempt them.

After Phase 3, the temp folder's working tree contains: PR changes + your fixes, all uncommitted.

---

## Phase 4 — Test (executes audited code only, in the temp folder)

Skip entirely if Phase 1 produced a `BLOCKER`. Otherwise run, in order, in `$TEMP_DIR`, capturing all output to `$LOG_DIR/`:

```bash
cd "$TEMP_DIR"

# 1. Clean install
rm -rf node_modules
npm ci 2>&1 | tee "$LOG_DIR/01-install.log"

# 2. Type check
npx tsc --noEmit 2>&1 | tee "$LOG_DIR/02-typecheck.log"

# 3. Lint
npm run lint 2>&1 | tee "$LOG_DIR/03-lint.log" || echo "(no lint script — skipping)"

# 4. Native module build (Rust)
npm run build:native 2>&1 | tee "$LOG_DIR/04-native.log"

# 5. Unit tests
npm test 2>&1 | tee "$LOG_DIR/05-test.log" || echo "(no test script — skipping)"

# 6. Production build (catches what unit tests miss)
npm run dist 2>&1 | tee "$LOG_DIR/06-dist.log"
```

Each step records: pass/fail, time, warnings worth flagging.

If `npm run dist` fails for a reason unrelated to the PR (code signing, network, missing platform tooling on this machine), note it but don't count it against the PR. Look for actual code-related errors in the log tail.

If any step crashes the runner (OOM, network), capture the partial log and continue to the next step rather than aborting.

**Apply gate:** if `tsc --noEmit` or `npm run build:native` fails for code reasons (not environment), downgrade verdict to `REQUEST_CHANGES` and skip Phase 6.

---

## Phase 5 — Manual test plan generation

Generate a 5–10 minute checklist tailored to the PR's surface area. Rules:

- Cover the specific files / features the PR touches, not a generic smoke test.
- Exact shortcut, settings path, or UI flow for each step.
- Expected outcome and visible failure mode.
- Flag steps that need real API keys (Deepgram, ElevenLabs, OpenAI, Dodo, etc.) so Evun can stub or skip.
- Cover macOS and Windows separately if the PR touches platform-branched code (audio, stealth, shortcuts, paths).
- Always include a stealth-mode regression check if the PR touches window / process / shortcut code:
  - `[ ] Toggle stealth mode → app disappears from dock (macOS) / taskbar (Windows)`
  - `[ ] Start a Zoom screen share → process name shows as disguise (Terminal / Activity Monitor / etc.), not "Natively"`
  - `[ ] Cross-window state sync: change setting in Settings, verify Launcher and Overlay reflect it within 1s`
- Always include an audio regression check if the PR touches `native-module/` or `electron/audio*`:
  - `[ ] Start meeting → system audio captured, mic separate, transcription latency visibly < 1s`
  - `[ ] Pause + resume → no duplicate session billing in logs`

Format: GitHub-style checkboxes.

---

## Phase 6 — Apply (working-tree changes only — no commits, no branch switch)

**Skip this phase if** verdict is `REQUEST_CHANGES` or `REJECT`, or if Phase 4 had code-related build failures, or if `WORKTREE_WAS_CLEAN=false`.

Compute the full diff inside the temp folder (PR changes + auto-fixes vs. `origin/main`) and apply it to the user's working tree using `git apply`. **No checkout, no commit, no merge, no cherry-pick.** The user's branch and HEAD do not change. The PR's edits show up as if Evun typed them.

```bash
# 1. Generate the full diff from inside the temp folder.
#    --binary: handle binary files (images, fonts, etc.)
#    Compare against origin/main, which is the PR's base — captures every file change
#    including new files, deletions, renames, and any auto-fixes from Phase 3.
cd "$TEMP_DIR"
git diff --binary origin/main > "$LOG_DIR/integration.patch"

cd "$ORIGINAL_DIR"

# 2. Sanity check before touching anything: confirm we never changed branch or HEAD.
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
CURRENT_HEAD="$(git rev-parse HEAD)"
if [ "$CURRENT_BRANCH" != "$ORIGINAL_BRANCH" ] || [ "$CURRENT_HEAD" != "$ORIGINAL_HEAD" ]; then
  echo "ABORT: branch or HEAD changed unexpectedly — refusing to apply"
  echo "  was: $ORIGINAL_BRANCH @ $ORIGINAL_HEAD"
  echo "  now: $CURRENT_BRANCH @ $CURRENT_HEAD"
  exit 1
fi

# 3. Sanity check: working tree must still be clean (matches what we saw at Phase 0).
CURRENT_STATUS="$(git status --porcelain)"
if [ "$CURRENT_STATUS" != "$(cat $LOG_DIR/original-worktree-status)" ]; then
  echo "APPLY_SKIPPED: working tree changed during review"
  echo "Refusing to apply to avoid clobbering changes."
  echo "Patch saved at: $LOG_DIR/integration.patch"
  echo "Apply manually when ready: git apply --3way $LOG_DIR/integration.patch"
  # jump to Phase 7
fi

# 4. Dry-run the patch to catch any conflict before touching files.
if ! git apply --check "$LOG_DIR/integration.patch" 2>"$LOG_DIR/apply-check.err"; then
  echo "APPLY_SKIPPED: patch does not apply cleanly to current working tree"
  echo "  reason: $(cat $LOG_DIR/apply-check.err)"
  echo "  most likely cause: your local branch has diverged from origin/main in"
  echo "  files this PR also touches"
  echo "Patch saved at: $LOG_DIR/integration.patch"
  echo "Try 3-way merge manually: git apply --3way $LOG_DIR/integration.patch"
  # jump to Phase 7
fi

# 5. Apply for real. No --index, no --cached — files become unstaged modifications,
#    exactly as if Evun edited them in their editor. Nothing is staged. Nothing is committed.
git apply "$LOG_DIR/integration.patch"

# 6. Confirm: branch and HEAD are still byte-identical to where we started.
POST_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
POST_HEAD="$(git rev-parse HEAD)"
if [ "$POST_BRANCH" != "$ORIGINAL_BRANCH" ] || [ "$POST_HEAD" != "$ORIGINAL_HEAD" ]; then
  echo "INVARIANT VIOLATION: branch or HEAD moved during apply — this should be impossible"
  exit 1
fi

# 7. Report what landed.
CHANGED_FILES_COUNT=$(git status --porcelain | wc -l)
echo "APPLIED: $CHANGED_FILES_COUNT file(s) modified in working tree (uncommitted, unstaged)"
echo "Branch:  $ORIGINAL_BRANCH (unchanged)"
echo "HEAD:    $ORIGINAL_HEAD (unchanged)"
echo ""
echo "Review the changes:   git diff"
echo "Discard everything:   git checkout -- .   (or: git apply -R $LOG_DIR/integration.patch)"
echo "Stage for commit:     git add -A"
```

### Why this design

- **`git apply` (not `git am`, not `cherry-pick`)** — `git am` and `cherry-pick` both create commits. `git apply` only modifies files in the working tree. Exactly what you want.
- **No `--index` flag** — that would also stage the changes. Without it, `git status` will show the changes as unstaged ("Changes not staged for commit"). Evun can `git diff` them, edit them, partial-stage with `git add -p`, etc.
- **`--check` first** — never write to the working tree if the patch wouldn't cleanly apply. If your local branch is far from `origin/main` in overlapping files, the report will tell you to use `git apply --3way` manually.
- **Branch invariant checks** — the script asserts at multiple points that `HEAD` and the current branch name haven't moved. Belt and suspenders.
- **Reversible by `git checkout -- .`** — since nothing is committed, discarding the integration is one stock git command. No tags, no branch deletion needed.

### What you see after Phase 6

```bash
$ git status
On branch <your-branch>                    # unchanged
Your branch is up to date with ...

Changes not staged for commit:
  modified:   src/electron/sttHandlers.ts
  modified:   src/electron/audioCoordinator.ts
  new file:   src/electron/providers/elevenlabs.ts
  ...

no changes added to commit
```

Build, run the app, run the manual test plan, then commit yourself if you like the changes — or `git checkout -- .` to throw them away.

---

## Phase 7 — Report

Output as a single Markdown block, paste-ready into the PR comment box. Print to stdout AND save to `$LOG_DIR/report.md`.

```markdown
## 🤖 Automated PR Review (Claude Code)

**Verdict:** <APPROVE | APPROVE_WITH_FIXES | REQUEST_CHANGES | REJECT>
**Branch:** `<branch>` → reviewed against `origin/main`
**Files changed:** <n>  ·  **+<added> / -<removed>**  ·  **<commits> commits**
**Submodule pointer changed:** Yes / No
**Reviewed:** <ISO timestamp>

### TL;DR
<2–3 sentences: what the PR does, whether it does it correctly, the headline finding.>

### 🛑 Blockers
<List with file:line and snippet, or "None.">

### ⚠️ Major issues
<List with file:line and snippet, or "None.">

### 🔧 Auto-fixed in review
<List of what Claude fixed in the temp folder, folded into the patch, or "None.">

### 📝 Minor issues left for contributor
<List, or "None.">

### Test results (run in temp folder, not on your branch)
| Step | Result | Time | Notes |
|---|---|---|---|
| `npm ci` | ✅/❌ | | |
| `tsc --noEmit` | ✅/❌ | | |
| `npm run lint` | ✅/❌/skipped | | |
| `npm run build:native` | ✅/❌ | | |
| `npm test` | ✅/❌/skipped | | |
| `npm run dist` | ✅/❌ | | |

### Manual test plan
<Checklist from Phase 5.>

### Edge cases considered
<Bullet list. Always: empty input, network failure, missing API key, denied OS permission, concurrent invocation, cross-platform paths. Plus PR-specific cases.>

### 📦 Apply status
<Exactly one of:>
- ✅ **Applied to your working tree.** `<N>` file(s) modified, unstaged. Branch `<your-branch>` and HEAD unchanged. Review with `git diff`.
- ⚠️ **Skipped — working tree was dirty when review started.** Patch saved at `<LOG_DIR>/integration.patch`. Apply manually after committing or stashing your work: `git apply --3way <patch-path>`.
- ⚠️ **Skipped — patch did not apply cleanly.** Your local branch has diverged from `origin/main` in overlapping files. Patch saved at `<LOG_DIR>/integration.patch`. Try 3-way merge: `git apply --3way <patch-path>`.
- 🛑 **Skipped — verdict was <REQUEST_CHANGES | REJECT>.** Nothing applied.
- 🛑 **Skipped — build failed in Phase 4.** Nothing applied. See test results above.

### Next steps for Evun
1. Inspect the changes: `git diff` (or `git diff --stat` for an overview).
2. Build and run the manual test plan above (~5 min).
3. If you like it: `git add -A && git commit -m "<your message>"`.
4. To discard the integration entirely: `git checkout -- .` (works because nothing is committed).
5. Patch is also saved at `<LOG_DIR>/integration.patch` — keep it if you want to re-apply later or in a different repo.

### Logs
Full logs at `<LOG_DIR>` (typecheck, lint, native build, tests, dist).
Patch file at `<LOG_DIR>/integration.patch` (always preserved, even if applied).
Temp folder was at `<TEMP_DIR>` — removed automatically in Phase 8.

---
*Generated by Claude Code autopilot. PR is staged in your working tree as uncommitted changes. No branch switch, no commits, no merge. Final commit decision: human only.*
```

---

## Phase 8 — Cleanup (always runs)

```bash
cd "$ORIGINAL_DIR"

# Remove the temp worktree regardless of outcome
git worktree remove --force "$TEMP_DIR" 2>/dev/null || true

# Final invariant check: confirm the user's branch and HEAD are exactly where they started.
FINAL_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
FINAL_HEAD="$(git rev-parse HEAD)"
if [ "$FINAL_BRANCH" != "$ORIGINAL_BRANCH" ] || [ "$FINAL_HEAD" != "$ORIGINAL_HEAD" ]; then
  echo "WARNING: branch or HEAD moved during this run — please report a bug"
  echo "  was: $ORIGINAL_BRANCH @ $ORIGINAL_HEAD"
  echo "  now: $FINAL_BRANCH @ $FINAL_HEAD"
fi

# Always preserve the logs and patch at $LOG_DIR — they're under /tmp and small.
echo "Logs:  $LOG_DIR"
echo "Patch: $LOG_DIR/integration.patch (re-apply with: git apply $LOG_DIR/integration.patch)"
```

---

## Quick reference: AI-slop patterns to reject on sight

- A function called `handleAudioSmartly` that wraps `handleAudio` with a try/catch.
- A comment `// Intelligently determines the best provider based on context` above a hardcoded `if (provider === 'openai')`.
- A new file `utils/cleverHelpers.ts` or `utils/smartUtils.ts`.
- A 200-line "refactor" that renames `getUser` → `fetchUser` across the codebase with no behaviour change.
- A test file that imports the module under test and never references it.
- A README change adding "blazingly fast" / "production-ready" / "enterprise-grade" with nothing backing it.
- A PR description in obvious LLM voice with no concrete what/why.
- Any commit message that's just `Update <filename>` for a non-trivial change.

The test, always: would Evun reading this at 1am the night before a release trust this code? If no, flag it.
