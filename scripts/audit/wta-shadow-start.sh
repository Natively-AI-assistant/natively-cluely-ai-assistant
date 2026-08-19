#!/bin/bash
# scripts/audit/wta-shadow-start.sh — one-command launcher for WTA shadow
# sessions. Replaces the long hand-typed pipeline: sets every shadow/trace
# flag, filters the noisy audio tags out of the LIVE terminal view, and
# AUTO-SAVES every run to timestamped files (terminal scrollback is no longer
# the only copy — nothing to select/copy afterwards):
#
#   ~/wta-shadow-logs/wta-shadow-<label>-<timestamp>.log       filtered (what you see)
#   ~/wta-shadow-logs/wta-shadow-<label>-<timestamp>.full.log  raw, unfiltered
#   ~/wta-shadow-logs/latest.log / latest-full.log             symlinks to the newest run
#
# Usage:
#   ./scripts/audit/wta-shadow-start.sh          # label "session"
#   ./scripts/audit/wta-shadow-start.sh A        # label the run (A/B/C/D…)
#   NATIVELY_WTA_CLAUSE_COVERAGE_REPAIR=1 ./scripts/audit/wta-shadow-start.sh C
#
# Env prefixes pass straight through; the flags below only set defaults.

set -u
LABEL="${1:-session}"
LOG_DIR="${WTA_LOG_DIR:-$HOME/wta-shadow-logs}"
mkdir -p "$LOG_DIR"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
LOG_FILE="$LOG_DIR/wta-shadow-${LABEL}-${STAMP}.log"
FULL_LOG="$LOG_DIR/wta-shadow-${LABEL}-${STAMP}.full.log"
ln -sf "$LOG_FILE" "$LOG_DIR/latest.log"
ln -sf "$FULL_LOG" "$LOG_DIR/latest-full.log"

# Shadow/trace flags — overridable by prefixing the command with your own values.
export NATIVELY_QUESTION_LEDGER_SHADOW="${NATIVELY_QUESTION_LEDGER_SHADOW:-1}"
export NATIVELY_INTELLIGENCE_TRACE="${NATIVELY_INTELLIGENCE_TRACE:-1}"
export NATIVELY_TRACE_LONGCTX="${NATIVELY_TRACE_LONGCTX:-1}"
export MEASURE_LATENCY="${MEASURE_LATENCY:-true}"
export PI_LATENCY_TRACE="${PI_LATENCY_TRACE:-true}"

# The audio-tag noise filter (same pattern used by hand previously). The live
# view and the .log file are filtered; the .full.log keeps EVERYTHING so STT
# behavior can still be diagnosed after the fact.
NOISE='\[STT\]|\[Audio\]|\[Nemotron\]|\[Deepgram\]|\[Whisper\]|\[AudioEngine\]|\[AudioCapture\]|\[StabilityHeartbeat\]'

cd "$(dirname "$0")/../.."

echo "─────────────────────────────────────────────────────────────"
echo " WTA shadow session '${LABEL}'"
echo "   filtered log : $LOG_FILE"
echo "   full raw log : $FULL_LOG"
echo "   newest links : $LOG_DIR/latest.log, $LOG_DIR/latest-full.log"
echo "─────────────────────────────────────────────────────────────"

npm start 2>&1 \
  | tee "$FULL_LOG" \
  | grep --line-buffered -v -E "$NOISE" \
  | tee "$LOG_FILE"
