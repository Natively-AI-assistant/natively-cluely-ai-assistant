#!/bin/bash
# Apply the two uncommitted modes-review hunks (MEDIUM #1 + LOW #8) to electron/main.ts.
# Idempotent — detects already-applied state and skips cleanly.
# Revert with:  cd <repo> && git checkout HEAD -- electron/main.ts
#
# These two hunks are part of the modes senior-review fix that landed in c5d9232.
# They reference `ModesManager.getModesWithRetryEligibleFiles()` which was added
# in c5d9232 — make sure that commit is present before applying.
#
# Companion ipcHandlers.ts hunks (MEDIUM #1 upload-handler retry kick) were
# already shipped in b3ace73 (the hindsight round-6 audit) and do NOT need
# re-application.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

F=electron/main.ts
APPLIED=0
SKIPPED=0

# ── Hunk 1: change `private scheduleModeReferenceIndexRetry()` to `public`
#            and insert 3 comment lines explaining the exposure.
if grep -q "public scheduleModeReferenceIndexRetry" "$F"; then
    echo "hunk-1: already applied (skipping)"
    SKIPPED=$((SKIPPED+1))
else
    python3 - <<'PY'
import sys
path = "electron/main.ts"
src = open(path).read()
needle = "  private scheduleModeReferenceIndexRetry(): void {"
replacement = (
    "  // Public so the reference-file upload IPC handler can kick a retry for a\n"
    "  // file that landed in 'failed'/'lexical_only' during the embedder warm-up\n"
    "  // window (the boot-time scheduler only sees files that existed at start).\n"
    "  public scheduleModeReferenceIndexRetry(): void {"
)
if needle not in src:
    print("ERROR: hunk-1 anchor not found (working tree diverged).", file=sys.stderr)
    sys.exit(1)
src = src.replace(needle, replacement, 1)
open(path, "w").write(src)
PY
    echo "hunk-1: applied (private → public + 3-line comment)"
    APPLIED=$((APPLIED+1))
fi

# ── Hunk 2: replace the inner for-loop with the LOW #8 broadcast pruning.
if grep -q "getModesWithRetryEligibleFiles()" "$F"; then
    echo "hunk-2: already applied (skipping)"
    SKIPPED=$((SKIPPED+1))
else
    python3 - <<'PY'
import sys
path = "electron/main.ts"
src = open(path).read()
old = (
    "      await modesManager.retryAllLexicalOnlyFiles().catch(() => { /* logged inside */ });\n"
    "      for (const mode of modesManager.getModes()) {\n"
    "        this.broadcast('mode-file-index-status', { modeId: mode.id, phase: 'done' });\n"
    "      }"
)
new = (
    "      await modesManager.retryAllLexicalOnlyFiles().catch(() => { /* logged inside */ });\n"
    "      // Capture which modes actually had retry-eligible files BEFORE the retry,\n"
    "      // so we only nudge those renderers to re-fetch status (LOW #8) instead of\n"
    "      // broadcasting a no-op 'done' to every mode on every pipeline-ready event.\n"
    "      const affectedModeIds: string[] = modesManager.getModesWithRetryEligibleFiles();\n"
    "      for (const modeId of affectedModeIds) {\n"
    "        this.broadcast('mode-file-index-status', { modeId, phase: 'done' });\n"
    "      }"
)
if old not in src:
    print("ERROR: hunk-2 anchor not found (working tree diverged).", file=sys.stderr)
    sys.exit(1)
src = src.replace(old, new, 1)
open(path, "w").write(src)
PY
    echo "hunk-2: applied (LOW #8 broadcast pruning)"
    APPLIED=$((APPLIED+1))
fi

echo
echo "Summary: $APPLIED applied, $SKIPPED skipped"
echo "Verify:  git diff --stat electron/main.ts"
