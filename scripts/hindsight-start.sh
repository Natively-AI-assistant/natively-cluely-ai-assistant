#!/usr/bin/env bash
# Start the Hindsight embedded dev server WITH Natively's LLM provider chain + fallback.
#
# 1. Loads GEMINI_API_KEY (+ any other provider keys) from .env.
# 2. Generates the litellm.Router config (Gemini→OpenAI→Claude→DeepSeek→Groq→Ollama,
#    key-gated) via scripts/hindsight-llm-config.mjs and exports it as
#    HINDSIGHT_API_LLM_LITELLMROUTER_CONFIG.
# 3. Launches scripts/hindsight-dev-server.py (embedded Postgres + pgvector, no Docker).
#
# Usage:  bash scripts/hindsight-start.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# Load provider keys from .env (only KEY=VALUE lines; ignore comments/blank).
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC2046
  export $(grep -E '^(GEMINI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|DEEPSEEK_API_KEY|GROQ_API_KEY)=' .env | sed 's/[\"'"'"']//g' | xargs -0 2>/dev/null || true)
  set +a
fi

# Build the router config from whatever provider keys are present.
ROUTER_JSON="$(node scripts/hindsight-llm-config.mjs 2>/dev/null || true)"
if [ -n "$ROUTER_JSON" ]; then
  export HINDSIGHT_API_LLM_LITELLMROUTER_CONFIG="$ROUTER_JSON"
  echo "[hindsight-start] router chain: $(echo "$ROUTER_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).model_list.map(m=>m.litellm_params.model).join(" -> "))}catch{console.log("(parse error)")}})')"
else
  echo "[hindsight-start] no provider keys → single-model default (Gemini)"
fi

exec python3 scripts/hindsight-dev-server.py
