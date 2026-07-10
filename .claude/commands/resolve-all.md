---
description: Autopilot bulk issue resolver for Natively — triage every open issue, resolve the cheap ones, queue the expensive ones, and stay within Claude usage limits across multiple sessions. Resumable.
argument-hint: [optional: filter like "label:bug" or "easy" or count like "5"]
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# Natively Issue Resolver — Bulk Mode

Process the open issues on the Natively repo in a single autopilot run, with strict usage-limit discipline.

`$ARGUMENTS` is optional and controls scope:
- empty → process all open issues, easiest first
- a number (`5`) → process at most that many issues this run
- `easy` → only issues with `good-first-issue` / `easy` / `documentation` labels
- a `gh issue list` filter (`label:bug`, `label:audio`, `assignee:@me`) → narrow the queue

If `$ARGUMENTS` is unparseable, default to "process all, easiest first, stop on usage signal".

---

## Why this command exists

You can't just run `/resolve` in a loop — every issue burns audit, code-reading, reproduction, and verification budget. A 50-issue repo would torch a Pro/Max plan in one sitting and leave you blocked when something urgent comes up. This command:

1. Triages all open issues *cheaply* first (one API call, no reproduction)
2. Sorts them by estimated cost (docs/typo → cheap, native audio bug → expensive)
3. Resolves cheap ones in batches with hard budget caps per issue
4. Persists progress to disk so the next run picks up where this one stopped
5. Stops voluntarily before hitting Claude's actual usage limit, not after

The output is a queue file Evun can inspect, plus N branches with staged fixes. No issue is silently skipped — every one ends in `RESOLVED`, `NEEDS_HUMAN`, `NEEDS_MORE_INFO`, `UNREPRODUCIBLE`, or `DEFERRED`.

---

## Hard rules

1. **Never push, never merge, never open a PR.** Evun handles all remote operations.
2. **Never modify the `premium/` submodule** — auto-defer any issue that points there.
3. **Never commit secrets** from issue attachments. Redact API keys, tokens, JWTs in all output and logs.
4. **One branch per issue.** Branches are staged, not pushed. Naming: `fix/issue-<n>-<slug>`.
5. **Working tree must be clean** when this command starts. Refuse to run if dirty.
6. **No issue gets a fake fix.** If reproduction fails, mark `UNREPRODUCIBLE` and move on — never invent a fix to pad the count.
7. **Resumable, not destructive.** All state lives in `$QUEUE_DIR`. The command can be killed and re-run; it picks up from the queue.
8. **Stop voluntarily before being stopped.** Watch for usage-limit signals (see Phase 5) and exit cleanly with state preserved.

---

## Phase 0 — Setup and pre-flight

```bash
set -e
ORIGINAL_DIR="$(pwd)"
ORIGINAL_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
TIMESTAMP=$(date +%s)
QUEUE_DIR="/tmp/natively-resolve-all"   # persistent across runs, intentionally not timestamped
RUN_LOG="$QUEUE_DIR/runs/run-${TIMESTAMP}.log"
mkdir -p "$QUEUE_DIR/runs" "$QUEUE_DIR/triage" "$QUEUE_DIR/results"

# Refuse to run on a dirty working tree
if [ -n "$(git status --porcelain)" ]; then
  echo "BLOCKED: working tree is dirty. Commit or stash before running /resolve-all."
  exit 1
fi

git fetch origin --quiet
echo "$ORIGINAL_BRANCH" > "$QUEUE_DIR/original-branch"
```

If `$QUEUE_DIR/queue.json` already exists from a previous run, this is a **resume**. Skip Phase 1 (triage already done), load the queue, and jump to Phase 4 to continue processing the next pending issue. Otherwise it's a fresh run — proceed.

---

## Phase 1 — Pull and triage every open issue (cheap, one pass)

The whole point of triage: spend ~30 seconds on every issue to decide whether it's worth spending real budget on. Don't read code, don't reproduce — just classify.

```bash
# Fetch every open issue with comments and labels
gh issue list --state open --limit 200 --json number,title,labels,author,createdAt,updatedAt,comments,assignees,body \
  > "$QUEUE_DIR/triage/all-issues.json"

# If $ARGUMENTS narrows the scope, filter here
# (e.g. for "easy", filter to labels containing good-first-issue / docs / easy)
```

For each issue, produce a triage record. **Do not read any code. Do not download attachments yet.** Just classify from the issue text:

```
ISSUE #<n>: <title>
LABELS: <list>
AGE: <days since createdAt>
COMMENTS: <count>

CATEGORY: <one of>
  - DOCS:        readme/docs/typo/spelling/grammar
  - CONFIG:      env var, settings, .env.example mismatch, package script
  - UI_TWEAK:    text change, color, padding, label
  - SHALLOW_BUG: clear stack trace, single file, no platform/native involvement
  - DEEP_BUG:    audio, native module, stealth, IPC, multi-window, race condition
  - PROVIDER:    new STT/LLM provider integration
  - QUESTION:    user is asking, not reporting a bug
  - DUPLICATE:   appears to duplicate another open issue (cite #)
  - STALE:       no activity for 90+ days, possibly resolved
  - PREMIUM:     points to Pro features / premium submodule
  - INSUFFICIENT: no env, no logs, no reproduction steps

ESTIMATED_COST: CHEAP | MEDIUM | EXPENSIVE | SKIP
  CHEAP:     DOCS, CONFIG, UI_TWEAK, QUESTION, DUPLICATE, STALE
  MEDIUM:    SHALLOW_BUG, INSUFFICIENT (just needs a comment back)
  EXPENSIVE: DEEP_BUG, PROVIDER
  SKIP:      PREMIUM (auto-defer)

CONFIDENCE_REPRODUCIBLE: HIGH | MEDIUM | LOW | NONE
  Based on whether the issue includes: env, version, steps, logs, screenshots.

ACTION:
  - RESOLVE_CHEAP:    docs/config/UI fix Claude can do quickly
  - COMMENT_AND_CLOSE: question, duplicate, stale → draft a comment, don't fix
  - REQUEST_INFO:     INSUFFICIENT → draft a comment asking for the missing pieces
  - DEFER:            EXPENSIVE or PREMIUM → leave for /resolve <n> or human
```

Save all triage records to `$QUEUE_DIR/triage/triage.json`.

Build the processing queue, sorted CHEAP → MEDIUM → EXPENSIVE, with PREMIUM/DEFER excluded:

```
$QUEUE_DIR/queue.json:
[
  { "issue": 12, "category": "DOCS",        "action": "RESOLVE_CHEAP",     "status": "PENDING" },
  { "issue": 47, "category": "DUPLICATE",   "action": "COMMENT_AND_CLOSE", "status": "PENDING" },
  { "issue": 23, "category": "CONFIG",      "action": "RESOLVE_CHEAP",     "status": "PENDING" },
  { "issue": 31, "category": "SHALLOW_BUG", "action": "RESOLVE_CHEAP",     "status": "PENDING" },
  { "issue": 19, "category": "INSUFFICIENT","action": "REQUEST_INFO",      "status": "PENDING" },
  { "issue": 88, "category": "DEEP_BUG",    "action": "DEFER",             "status": "DEFERRED" },
  { "issue": 102,"category": "PREMIUM",     "action": "DEFER",             "status": "DEFERRED" }
]
```

Print a one-screen triage summary so Evun can see what's about to happen:

```
TRIAGE COMPLETE: 47 open issues
  RESOLVE_CHEAP:     18  (docs, config, UI tweaks, shallow bugs)
  COMMENT_AND_CLOSE: 6   (3 duplicates, 2 stale, 1 question)
  REQUEST_INFO:      4   (insufficient detail)
  DEFER:             19  (12 deep bugs, 4 provider integrations, 3 premium)

Estimated this run: 18 resolves + 10 comments = ~28 issues to process.
Issues sorted cheapest-first to maximize throughput before usage limits hit.
```

---

## Phase 2 — Per-issue budget caps

Set a hard ceiling on how much work each issue gets. If an issue hits the ceiling, mark it `BUDGET_EXCEEDED → DEFERRED` and move on — don't sink the whole run into one stubborn bug.

| Category    | Budget                                           |
|-------------|--------------------------------------------------|
| DOCS        | 1 file edit, 1 typecheck, no test                |
| CONFIG      | 2 file edits, 1 typecheck, 1 lint                |
| UI_TWEAK    | 3 file edits, typecheck + lint                   |
| SHALLOW_BUG | 5 file edits, full verify ladder, ≤ 1 retry      |
| QUESTION    | draft comment only, no code                      |
| DUPLICATE   | draft comment with link to canonical issue       |
| STALE       | draft comment asking if still relevant           |
| INSUFFICIENT| draft comment listing what's missing             |

If a SHALLOW_BUG turns out to need a Rust change, native module rebuild, or touches > 5 files → it's actually a DEEP_BUG. Reclassify on the fly: change status to `DEFERRED`, write a note explaining why, move on.

---

## Phase 3 — Process the queue

Loop over `$QUEUE_DIR/queue.json` in order. For each PENDING issue:

```bash
for ISSUE in $(jq -r '.[] | select(.status == "PENDING") | .issue' "$QUEUE_DIR/queue.json"); do
  # 1. Check the stop signals (Phase 5) before starting each issue
  check_usage_signals_and_maybe_exit

  # 2. Update status to IN_PROGRESS in queue.json
  jq "(.[] | select(.issue == $ISSUE) | .status) = \"IN_PROGRESS\"" \
    "$QUEUE_DIR/queue.json" > "$QUEUE_DIR/queue.json.tmp" && mv "$QUEUE_DIR/queue.json.tmp" "$QUEUE_DIR/queue.json"

  # 3. Process based on action
  case "$ACTION" in
    RESOLVE_CHEAP)      run_inline_resolve "$ISSUE" "$CATEGORY" ;;
    COMMENT_AND_CLOSE)  draft_comment "$ISSUE" "$CATEGORY" ;;
    REQUEST_INFO)       draft_info_request "$ISSUE" ;;
  esac

  # 4. Update queue with result
  update_queue_with_result "$ISSUE" "$RESULT"  # RESOLVED | DEFERRED | COMMENTED | UNREPRODUCIBLE
done
```

### 3a. RESOLVE_CHEAP path

This is a stripped-down version of `/resolve` for issues we already triaged as cheap:

1. **Fetch the issue body and *only* the attachments referenced in the body** (skip comments unless the body refers to them). Saves an API call and reading time.
2. **Read the inferred file** based on category — DOCS issues touch `README.md` / `docs/`; CONFIG touches `.env.example` / `package.json` (read-only) / settings code; UI_TWEAK touches `renderer/`.
3. **Make the edit.** Single file when possible, two max.
4. **Verify lightly** — `tsc --noEmit` for code changes, no build for docs. Don't run `npm run dist` for cheap fixes; that's the expensive step.
5. **Stage on a branch** — `git checkout -b fix/issue-<n>-<slug> && git add -A && git commit -m "..."`
6. **Return to original branch** so the next iteration starts clean: `git checkout "$ORIGINAL_BRANCH"`

If during step 3 it turns out the fix isn't actually cheap (multiple files, native module, etc.) → revert any changes, mark issue `DEFERRED` with reason `RECLASSIFIED_AS_DEEP`, move on. Don't sink budget here.

### 3b. COMMENT_AND_CLOSE path

For QUESTION / DUPLICATE / STALE. No code, just a draft comment saved to `$QUEUE_DIR/results/issue-<n>-comment.md` for Evun to review and post.

Draft format:
- **DUPLICATE:** "This appears to duplicate #<canonical>. Closing in favor of that one — please continue the discussion there."
- **STALE:** "This issue has been quiet for <n> days. If it's still affecting you on Natively v<latest>, please add a comment with a current log so we can take another look. Otherwise we'll close it in a week."
- **QUESTION:** Direct answer based on the README / docs, with a doc link. Don't fix anything.

### 3c. REQUEST_INFO path

For INSUFFICIENT. Draft a comment listing exactly what's missing — OS + version, Natively version, provider stack, full log file, exact reproduction steps. Save to `$QUEUE_DIR/results/issue-<n>-comment.md`.

Format the request as a checkbox list so the reporter can fill it in:
```
Thanks for reporting! To investigate, we need a bit more detail:

- [ ] OS and version (e.g. macOS 14.5 Apple Silicon, Windows 11 23H2)
- [ ] Natively version (Settings → About)
- [ ] Which LLM and STT providers are configured
- [ ] Full log file from <path/to/log>
- [ ] Steps to reproduce (numbered, including what you click and what you see)
- [ ] A screenshot or screen recording if it's a UI issue
```

Tailor the list — only ask for what's actually missing from the issue.

---

## Phase 4 — Persistence and resume

After every issue, write the queue back to disk. If the command is killed (Ctrl-C, terminal closed, usage limit hit), state survives:

```bash
# After processing each issue, queue.json reflects:
{
  "issue": 31,
  "status": "RESOLVED",        # or DEFERRED, COMMENTED, UNREPRODUCIBLE, BUDGET_EXCEEDED
  "branch": "fix/issue-31-windows-shortcut-symbols",
  "comment_path": null,        # or "/tmp/natively-resolve-all/results/issue-19-comment.md"
  "completed_at": "2026-05-03T11:42:00Z",
  "duration_seconds": 87,
  "notes": "Single-line fix in src/electron/shortcuts.ts; verify ladder green."
}
```

On next invocation, if `$QUEUE_DIR/queue.json` exists with `PENDING` entries, **the command resumes** instead of re-triaging. Tell Evun:

```
Resuming previous run. 12 of 28 issues remaining.
Last completed: #47 (RESOLVED) at 11:42:00
```

Evun can manually delete `$QUEUE_DIR` to force a fresh triage.

---

## Phase 5 — Usage-limit awareness (the part that matters most)

You don't have a direct API to query the user's remaining usage budget. You also don't know exactly what plan tier this is running on. So instead, use **soft signals** plus **explicit budget controls**:

### Hard ceiling per run

Cap each run at a configurable max (default: process at most 15 RESOLVE_CHEAP + 10 COMMENT_AND_CLOSE per invocation, regardless of queue length). If `$ARGUMENTS` specified a number, use that instead.

When the cap is hit:
```
HARD CEILING REACHED: processed 25 issues this run.
Queue state preserved. Run /resolve-all again to continue.
Remaining: 12 PENDING, 19 DEFERRED.
```

### Soft signals to check between issues

Between every issue, check for these signs that you're approaching a usage limit, and exit cleanly if any fire:

1. **Time elapsed** — if more than 60 minutes have passed since the run started, stop. Long sessions are usage-heavy and the user probably stepped away.
2. **Tool errors with rate-limit characteristics** — if a recent tool call returned an error mentioning `rate_limit`, `usage_limit`, `quota`, or `429`, stop immediately, don't retry.
3. **Context bloat** — if the running summary of work-done in this run is approaching the context window limit, stop. (Concrete signal: if you've handled more than 20 issues, dump the summary to disk and stop.)

When a soft signal fires:
```
USAGE SIGNAL DETECTED (<which one>): pausing run.
Queue state preserved at $QUEUE_DIR/queue.json.
Run /resolve-all again later to resume.
```

### Voluntary checkpointing

After every 5 issues processed, write a checkpoint summary to `$QUEUE_DIR/runs/run-<ts>.checkpoint.md`:

```
Run started: 11:00:00
Issues processed this run: 5
  ✅ RESOLVED: #12, #23, #31
  💬 COMMENTED: #47 (duplicate)
  ⚠️ DEFERRED: #19 (reclassified as deep)
Branches created: fix/issue-12-readme-typo, fix/issue-23-env-default, fix/issue-31-shortcut-windows
Time elapsed: 14 minutes
Remaining queue: 23 PENDING, 19 DEFERRED
```

This way if you're cut off mid-issue, the last good state is at most 5 issues old.

---

## Phase 6 — Final report

When the run ends — by completing the queue, hitting the hard ceiling, or detecting a stop signal — produce one report. Save to `$QUEUE_DIR/runs/run-<ts>.report.md` and print to stdout.

```markdown
## 🤖 Bulk Issue Resolution Report (Claude Code)

**Run:** <ISO timestamp range>
**Status:** <COMPLETED | PAUSED_USAGE | PAUSED_HARD_CEILING | INTERRUPTED>
**Triaged:** <total open issues>
**Processed this run:** <count>
**Resumable:** Yes / No (if PENDING items remain in queue)

### Summary
| Outcome | Count | Examples |
|---|---|---|
| ✅ Resolved (branch staged) | <n> | #12, #23, #31, ... |
| 💬 Comment drafted | <n> | #47 (duplicate), #88 (stale) |
| 📝 Info requested | <n> | #19, #62 |
| ⚠️ Unreproducible | <n> | #44 |
| 🛑 Deferred (needs human) | <n> | #102, #115, ... |
| ❌ Budget exceeded (reclassified) | <n> | #77 |

### Resolved branches (ready to push)
- `fix/issue-12-readme-typo` — typo in README installation section
- `fix/issue-23-env-default` — `DEFAULT_MODEL` env var was read but never written
- `fix/issue-31-shortcut-windows` — `Cmd+K` symbol shown on Windows About panel
- ...

To push and open PRs in batch:
\`\`\`bash
for branch in $(git branch --list 'fix/issue-*' | tr -d ' '); do
  issue=$(echo "$branch" | grep -oE 'issue-[0-9]+' | grep -oE '[0-9]+')
  git push -u origin "$branch"
  gh pr create --base main --head "$branch" \\
    --title "fix: $(git log -1 --pretty=%s "$branch" | sed 's/^fix: //')" \\
    --body "Resolves #$issue"
done
\`\`\`

### Comments drafted (ready to post)
- #47 → `$QUEUE_DIR/results/issue-47-comment.md` (duplicate of #12)
- #88 → `$QUEUE_DIR/results/issue-88-comment.md` (stale check-in)
- #19 → `$QUEUE_DIR/results/issue-19-comment.md` (info request)

To post a drafted comment:
\`\`\`bash
gh issue comment <n> --body-file "$QUEUE_DIR/results/issue-<n>-comment.md"
\`\`\`

### Deferred for /resolve or human review
| Issue | Reason | Suggested next step |
|---|---|---|
| #102 | PREMIUM submodule | Triage manually — Pro tier |
| #88 | DEEP_BUG: native audio | Run `/resolve 88` for full investigation |
| #77 | Reclassified mid-fix (touched 8 files) | Run `/resolve 77` |
| ... | | |

### ⚠️ Secrets noticed across triaged issues
<List redacted matches with issue numbers, or "None.">

### Usage signal that ended the run (if applicable)
<e.g. "Hit 60-minute time cap" / "Tool returned rate_limit error on issue #45" / "Hard ceiling of 25 issues reached" / "Queue empty">

### Resume next time
\`\`\`
/resolve-all
\`\`\`
The queue at `$QUEUE_DIR/queue.json` will be picked up. <N> PENDING items remain.

To start fresh instead:
\`\`\`bash
rm -rf $QUEUE_DIR
\`\`\`

---
*Generated by Claude Code autopilot bulk mode. All branches local. Evun pushes / posts when ready.*
```

---

## Phase 7 — Cleanup (always runs)

```bash
cd "$ORIGINAL_DIR"
git checkout "$ORIGINAL_BRANCH" --quiet 2>/dev/null || true

# Don't delete $QUEUE_DIR — it's what makes resumption work
echo "Queue: $QUEUE_DIR/queue.json"
echo "Reports: $QUEUE_DIR/runs/"
```

---

## Quick reference: when /resolve-all is the wrong tool

Use `/resolve <n>` instead of `/resolve-all` when:

- You're chasing one specific high-priority bug.
- The issue requires reading > 3 source files to understand.
- The issue has 20+ comments (long discussion needs careful reading, not bulk processing).
- The issue is a security report — never bulk-process security issues, ever.
- You want full reproduction with native module builds and runtime traces.

`/resolve-all` is for sweeping the long tail. The dozens of "typo in README", "env var ignored", "tooltip wrong on Windows", "duplicate of #12", "OP never replied" issues that accumulate on any active repo. Cheap, mechanical, but worth doing.

The mental model: `/resolve` is a surgeon, `/resolve-all` is a janitor. Don't ask the janitor to do surgery.
