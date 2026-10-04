#!/bin/zsh
# dev2 baseline on cand/e13b (er-fix1), then E16 on dev + dev2 (er-main), then cc judging. One heavy job at a time.
cd /Users/evin/natively-cluely-ai-assistant/.claude/worktrees/aq-fix/benchmarks/natively-answer-quality
export NATIVELY_ENV_FILE=/Users/evin/natively-cluely-ai-assistant/.env
W=/Users/evin/natively-cluely-ai-assistant/.claude/worktrees
stopapp() { P=$(ps -axo pid,command | grep "[s]cripts/dev-agent.mjs" | awk '{print $1}'); [ -n "$P" ] && kill -TERM $P; sleep 15; }
stopapp
node evidence-rich/supervise-er.mjs --root $W/er-fix1 --runs dev2:er-dev2-e13c --fresh-userdata > evidence-rich/results/supervise-er-dev2-e13c.log 2>&1 || echo "RUN FAILED dev2-e13c"
stopapp
node evidence-rich/supervise-er.mjs --root $W/er-main --runs dev:er-dev-e16,dev2:er-dev2-e16 --fresh-userdata > evidence-rich/results/supervise-er-e16.log 2>&1 || echo "RUN FAILED e16"
stopapp
export AQ_JUDGE=opus ER_JUDGE_ROLE=cc
for r in er-dev2-e13c er-dev-e16 er-dev2-e16; do
  [ -s evidence-rich/results/$r/rows.jsonl ] || continue
  node evidence-rich/judge/judge-er.mjs --set base --runs evidence-rich/results/$r --concurrency 3
  node evidence-rich/judge/judge-er.mjs --set base --runs evidence-rich/results/$r --draft --concurrency 3
done
echo CHAIN-E16-DONE
