#!/bin/zsh
# After the er-dev-e12b run: stop the app, then judge (one job at a time): the old Opus charter (E11/E12 rule vs m1/m1r),
# then the Claude Code judge (cc), the new working series.
cd /Users/evin/natively-cluely-ai-assistant/.claude/worktrees/aq-fix/benchmarks/natively-answer-quality
L=evidence-rich/results/supervise-er-dev-e12b.log
until grep -q "all runs complete\|giving up" $L; do sleep 30; done
P=$(ps -axo pid,command | grep "[s]cripts/dev-agent.mjs" | awk '{print $1}'); [ -n "$P" ] && kill -TERM $P
sleep 15
grep -q "all runs complete" $L || { echo "RUN FAILED"; exit 1; }
AQ_JUDGE=opus node evidence-rich/judge/judge-er.mjs --set base --runs evidence-rich/results/er-dev-e12b --concurrency 3
AQ_JUDGE=opus ER_JUDGE_ROLE=cc node evidence-rich/judge/judge-er.mjs --set base --runs evidence-rich/results/er-dev-e12b --concurrency 3
echo AFTER-E12-DONE
