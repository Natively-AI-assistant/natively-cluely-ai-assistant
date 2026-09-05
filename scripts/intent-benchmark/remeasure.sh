#!/usr/bin/env bash
# Re-run the latency-sensitive candidates on a QUIET machine.
#
# Accuracy does not change between runs; latency does, by up to 80% when
# anything else is running. This exists because several reports were written
# while a training job ran and nothing in the output said so.
#
# Providers are run one at a time, and the load guard in run.mjs stamps each
# report with whether the machine was quiet at the time.
set -u
cd "$(dirname "$0")/../.."
echo "load at start:$(uptime | sed 's/.*load averages*://')"
for p in "$@"; do
  printf '%-26s ' "$p"
  node scripts/intent-benchmark/run.mjs --provider "$p" --split holdout --language en 2>&1 \
    | grep -E "^latency  p50" | sed 's/latency *//'
done
echo "load at end:$(uptime | sed 's/.*load averages*://')"
