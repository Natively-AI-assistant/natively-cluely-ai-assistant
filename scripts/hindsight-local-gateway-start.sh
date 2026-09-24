#!/usr/bin/env bash
# Start Hindsight through Natively's local OpenAI-compatible gateway.
#
# The gateway owns the upstream provider credential. Hindsight only receives a
# non-secret local bearer value, so this wrapper is safe to launch from the
# desktop app without putting a provider key in process arguments or settings.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

export OPENAI_API_BASE="${OPENAI_API_BASE:-http://127.0.0.1:8092/v1}"
export OPENAI_API_KEY="${OPENAI_API_KEY:-natively-local}"
export HINDSIGHT_API_LLM_API_KEY="${HINDSIGHT_API_LLM_API_KEY:-natively-local}"
export HINDSIGHT_LLM_PROVIDER="${HINDSIGHT_LLM_PROVIDER:-openai}"
export HINDSIGHT_LLM_MODEL="${HINDSIGHT_LLM_MODEL:-nvidia-auto}"
export HINDSIGHT_LLM_OPENAI="${HINDSIGHT_LLM_OPENAI:-openai/nvidia-auto}"

exec bash "$SCRIPT_DIR/hindsight-start.sh"
