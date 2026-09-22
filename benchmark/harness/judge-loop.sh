#!/bin/bash
# Judges completed outputs incrementally until both orchestrators have exited, then one final pass.
cd "$(dirname "$0")/.."
while pgrep -f "harness/orchestrator.mjs" >/dev/null; do
  node harness/judge.mjs --concurrency 6 >> raw/judge.log 2>&1
  sleep 240
done
node harness/judge.mjs --concurrency 6 >> raw/judge.log 2>&1
echo "judge-loop finished $(date -u +%FT%TZ)" >> raw/judge.log
