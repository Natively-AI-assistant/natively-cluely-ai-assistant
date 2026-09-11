#!/usr/bin/env bash
# Run a set of providers and leave one JSON report per provider in reports/.
# Sequential on purpose: two ONNX sessions competing for the same cores would
# corrupt every latency number in the sweep, which is the one measurement the
# benchmark cannot re-derive afterwards.
set -u
cd "$(dirname "$0")/../.."
for p in "$@"; do
  echo "=== $p ==="
  node scripts/intent-benchmark/run.mjs --provider "$p" --split holdout --language en 2>&1 \
    | grep -E "^  (dialogue_act|needs_response|task|mode_intent|answer_form|grounding) |^latency|balanced accuracy|production-weighted|^  (PASS|FAIL)  (needs_response|p95)" \
    || echo "  FAILED"
  echo
done
