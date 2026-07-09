#!/bin/bash
# Guarantees exactly ONE healthy natively-api backend on :3000 with local-test auth
# + MiniMax gen-pin. Kills zombies (proc alive but not listening). Idempotent.
set -e
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="$REPO/test-results/modes-autopilot/backend-final.log"

healthy() { curl -s -m6 -X POST http://localhost:3000/v1/chat \
  -H "x-natively-local-test: local-test" -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"OK"}]}' 2>/dev/null | grep -q '"content"'; }

if healthy; then echo "backend already healthy"; exit 0; fi

# Kill ALL server.js + free port
ps aux | grep "node server.js" | grep -v grep | awk '{print $2}' | xargs -I{} kill -9 {} 2>/dev/null || true
lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 3

cd "$REPO/natively-api"
NATIVELY_LOCAL_TEST_AUTH=1 PORT=3000 NODE_ENV=development \
  NATIVELY_LOCAL_TEST_TOKEN=local-test NATIVELY_FORCE_PRIMARY_GEN=minimax \
  MINIMAX_TIMEOUT_MS=60000 node server.js > "$LOG" 2>&1 &
BPID=$!
echo "$BPID" > "$REPO/test-results/modes-autopilot/backend.pid"

for i in $(seq 1 25); do
  if [ "$(lsof -ti:3000 2>/dev/null | wc -l | tr -d ' ')" != "0" ] && healthy; then
    echo "backend healthy (PID $BPID, listening, auth OK)"; exit 0
  fi
  kill -0 $BPID 2>/dev/null || { echo "BACKEND DIED — see $LOG"; tail -5 "$LOG"; exit 1; }
  sleep 1
done
echo "backend did not become healthy in 25s"; tail -5 "$LOG"; exit 1
