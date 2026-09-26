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

# Load provider keys from .env — but ONLY for keys not already present in the environment.
# When the desktop app spawns this script it forwards the REAL (decrypted) provider keys via
# the child env (HindsightManager.buildCredentialEnv); the .env values may be dotenvx-encrypted
# (e.g. GEMINI_API_KEY="AQ.Ab8…"), so blindly exporting them would CLOBBER the good forwarded
# key with an unusable ciphertext. Existing env wins; .env only fills the gaps (manual runs).
if [ -f .env ]; then
  while IFS='=' read -r _k _v; do
    [ -z "$_k" ] && continue
    # only the keys we care about, and only if currently unset/empty
    case "$_k" in
      GEMINI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|DEEPSEEK_API_KEY|GROQ_API_KEY|OPENAI_API_BASE|LITELLM_BASE_URL) ;;
      *) continue ;;
    esac
    if [ -z "${!_k:-}" ]; then
      # strip surrounding quotes from the .env value
      _v="${_v%\"}"; _v="${_v#\"}"; _v="${_v%\'}"; _v="${_v#\'}"
      export "$_k=$_v"
    fi
  done < <(grep -E '^(GEMINI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|DEEPSEEK_API_KEY|GROQ_API_KEY|OPENAI_API_BASE|LITELLM_BASE_URL)=' .env || true)
fi

# Resolve a python3 that ACTUALLY has the `hindsight` package. A machine can have several
# python3 installs (Homebrew, python.org framework, /usr/bin, pyenv); `hindsight-all` is only
# in the one the user pip-installed into. Picking the first python3 on PATH (as `exec python3`
# did) breaks when that's a different interpreter — the reported "No module named 'hindsight'"
# exit-1. Probe candidates in order and pick the first that can import it.
pick_python() {
  local c
  # 1. explicit override, 2. PATH python3/python, 3. common concrete install locations.
  for c in \
    "${HINDSIGHT_PYTHON:-}" \
    "$(command -v python3 || true)" \
    "$(command -v python || true)" \
    /usr/local/bin/python3 \
    /opt/homebrew/bin/python3 \
    /Library/Frameworks/Python.framework/Versions/*/bin/python3 \
    /usr/bin/python3 ; do
    [ -n "$c" ] && [ -x "$c" ] || continue
    if "$c" -c 'import hindsight' >/dev/null 2>&1; then
      echo "$c"; return 0
    fi
  done
  return 1
}

PYTHON_BIN="$(pick_python || true)"
if [ -z "$PYTHON_BIN" ]; then
  echo "[hindsight-start] ERROR: no python3 with the 'hindsight' package found." >&2
  echo "[hindsight-start] Install it:  python3 -m pip install hindsight-all" >&2
  echo "[hindsight-start] Or point HINDSIGHT_PYTHON at the right interpreter." >&2
  exit 1
fi
echo "[hindsight-start] using python: $PYTHON_BIN ($("$PYTHON_BIN" --version 2>&1))"

# Build the router config from whatever provider keys are present.
ROUTER_JSON="$(node scripts/hindsight-llm-config.mjs 2>/dev/null || true)"
if [ -n "$ROUTER_JSON" ]; then
  export HINDSIGHT_API_LLM_LITELLMROUTER_CONFIG="$ROUTER_JSON"
  echo "[hindsight-start] router chain: $(echo "$ROUTER_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).model_list.map(m=>m.litellm_params.model).join(" -> "))}catch{console.log("(parse error)")}})')"
else
  echo "[hindsight-start] no provider keys → single-model default (Gemini)"
fi

exec "$PYTHON_BIN" scripts/hindsight-dev-server.py
