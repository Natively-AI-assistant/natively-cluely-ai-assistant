#!/bin/zsh
# Astra, three streams at once (Evin, 2026-10-05: "paralleling … since we only get astra for so little time").
# Each stream judges the rows that DECIDE a rule first; ids from results/replay/astra-plan.json. Calibration passed 11:08 UTC.
cd /Users/evin/natively-cluely-ai-assistant/.claude/worktrees/aq-fix/benchmarks/natively-answer-quality
export NATIVELY_ENV_FILE=/Users/evin/natively-cluely-ai-assistant/.env; unset AQ_JUDGE ER_JUDGE_ROLE
LOG=evidence-rich/results/astra-chain.log
ids() { node -e "const p=require('./evidence-rich/results/replay/astra-plan.json'); console.log((p['$1']['$2']||[]).join(','))"; }
J() { label=$1; shift; echo "$(date -u +%Y-%m-%dT%H:%M:%S.000Z) start $label" >> $LOG; out=$(node evidence-rich/judge/judge-er.mjs --set base "$@" --concurrency 3 2>&1 | tail -2 | tr '\n' ' ' | cut -c1-260); echo "$(date -u +%Y-%m-%dT%H:%M:%S.000Z) end $label: $out" >> $LOG; }
s1() { for r in er-dev-e13c er-dev-e16b er-dev2-e13c er-dev2-e16b; do J "E16b gained rows: $r" --runs evidence-rich/results/$r --ids "$(ids e16b $r)"; done
       for r in er-dev-e13c er-dev-e16b er-dev2-e13c er-dev2-e16b; do J "E16b profile modes: $r" --runs evidence-rich/results/$r --mode looking-for-work,technical-interview; done }
s2() { for r in er-dev-e13c er-dev2-e13c; do J "E17 control arm, new texts: $r" --runs evidence-rich/results/rp-e17-ctl--$r --ids "$(ids e17 rp-e17-ctl--$r)"; J "E17 unchanged side, shown: $r" --runs evidence-rich/results/$r --ids "$(ids e17 $r)"; done }
s3() { for r in er-dev-e13c er-dev2-e13c; do J "E17 new wording, new texts: $r" --runs evidence-rich/results/rp-e17-conflict--$r --ids "$(ids e17 rp-e17-conflict--$r)"; J "E17 unchanged side, drafts: $r" --runs evidence-rich/results/$r --draft --ids "$(ids e17 $r::draft)"; done }
s1 & s2 & s3 & wait
echo "$(date -u +%Y-%m-%dT%H:%M:%S.000Z) parallel streams finished" >> $LOG
echo ASTRA-PARALLEL-DONE
