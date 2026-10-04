#!/bin/zsh
# after-run.sh <run-id> [<extra run dirs to judge drafts of>…]: wait for the run, stop the app, judge with the cc judge
# (shown answers, then the drafts of edited rows). One heavy job at a time.
cd /Users/evin/natively-cluely-ai-assistant/.claude/worktrees/aq-fix/benchmarks/natively-answer-quality
RUN=$1; shift
L=evidence-rich/results/supervise-$RUN.log; [ -f $L ] || L=evidence-rich/results/supervise-er-${RUN#er-}.log
until grep -q "all runs complete\|giving up" $L; do sleep 30; done
P=$(ps -axo pid,command | grep "[s]cripts/dev-agent.mjs" | awk '{print $1}'); [ -n "$P" ] && kill -TERM $P
sleep 15
grep -q "all runs complete" $L || { echo "RUN FAILED"; exit 1; }
export AQ_JUDGE=opus ER_JUDGE_ROLE=cc
node evidence-rich/judge/judge-er.mjs --set base --runs evidence-rich/results/$RUN --concurrency 3
node evidence-rich/judge/judge-er.mjs --set base --runs evidence-rich/results/$RUN --draft --concurrency 3
for extra in "$@"; do node evidence-rich/judge/judge-er.mjs --set base --runs evidence-rich/results/$extra --draft --concurrency 3; done
echo AFTER-RUN-DONE
