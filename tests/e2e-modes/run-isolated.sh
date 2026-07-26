#!/bin/bash
# Run each mode in a FRESH matrix process (MODE_FILTER) so accumulated memory across
# 10 modes can't crash the renderer on the heavy 2-doc modes. Mirrors production,
# which activates one mode at a time. Aggregates per-mode _summary into run-iso/.
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"
RUN="${RUN_N:-iso}"
MODES="backend-eng behavioral-hr thesis-defense data-analyst sales-discovery investor-pitch consulting-case legal-compliance conference-talk support-escalation"
OUT="test-results/modes-autopilot/run-$RUN"
mkdir -p "$OUT"
for m in $MODES; do
  bash tests/e2e-modes/ensure-backend.sh >/dev/null 2>&1
  # kill any stray electron before each mode
  ps aux | grep "natively-cluely-ai-assistant/node_modules/electron" | grep -v grep | awk '{print $2}' | xargs -I{} kill -9 {} 2>/dev/null
  pkill -9 -f "^Natively$" 2>/dev/null
  rm -f ~/Library/Application\ Support/Electron/natively.db* 2>/dev/null
  echo ">>> MODE $m @ $(date -u +%H:%M:%S)"
  MODE_FILTER="$m" RUN_N="$RUN-$m" JUDGE="${JUDGE:-1}" node tests/e2e-modes/runMatrix.mjs > "$OUT/mode-run-$m.log" 2>&1 &
  P=$!
  for i in $(seq 1 260); do kill -0 $P 2>/dev/null || break; sleep 2; done
  kill -0 $P 2>/dev/null && { echo "  HUNG — killing"; kill -9 $P 2>/dev/null; }
  # copy the per-mode json
  cp "test-results/modes-autopilot/run-$RUN-$m/mode-$m.json" "$OUT/" 2>/dev/null
  grep -E "pass=|MATRIX SUMMARY|vectorReady" "$OUT/mode-run-$m.log" 2>/dev/null | tail -8
done
ps aux | grep "natively-cluely-ai-assistant/node_modules/electron" | grep -v grep | awk '{print $2}' | xargs -I{} kill -9 {} 2>/dev/null
echo "=== ISOLATED RUN DONE — per-mode json in $OUT/ ==="
