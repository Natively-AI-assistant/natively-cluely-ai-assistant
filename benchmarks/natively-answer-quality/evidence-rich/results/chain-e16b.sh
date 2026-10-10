#!/bin/zsh
# E16b on dev + dev2 (er-main, cand/e16b), then cc judging. One heavy job at a time; nothing else on the DeepSeek key.
cd /Users/evin/natively-cluely-ai-assistant/.claude/worktrees/aq-fix/benchmarks/natively-answer-quality
export NATIVELY_ENV_FILE=/Users/evin/natively-cluely-ai-assistant/.env
W=/Users/evin/natively-cluely-ai-assistant/.claude/worktrees
stopapp() { P=$(ps -axo pid,command | grep "[s]cripts/dev-agent.mjs" | awk '{print $1}'); [ -n "$P" ] && kill -TERM $P; sleep 15; }
stopapp
node evidence-rich/supervise-er.mjs --root $W/er-main --runs dev:er-dev-e16b,dev2:er-dev2-e16b --fresh-userdata > evidence-rich/results/supervise-er-e16b.log 2>&1 || echo "RUN FAILED e16b"
stopapp
export AQ_JUDGE=opus ER_JUDGE_ROLE=cc
for r in er-dev-e16b er-dev2-e16b; do
  [ -s evidence-rich/results/$r/rows.jsonl ] || continue
  node evidence-rich/judge/judge-er.mjs --set base --runs evidence-rich/results/$r --concurrency 3
  node evidence-rich/judge/judge-er.mjs --set base --runs evidence-rich/results/$r --draft --concurrency 3
done
echo CHAIN-E16B-DONE
