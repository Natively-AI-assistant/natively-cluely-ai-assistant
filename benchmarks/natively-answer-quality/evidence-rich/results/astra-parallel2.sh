#!/bin/zsh
# Astra, four streams: the rest of E17's first sample, then its second sample (the E16b drafts). E16b's own judging
# stopped: its line 3 is decided under Astra (+0.36 against +0.5).
cd /Users/evin/natively-cluely-ai-assistant/.claude/worktrees/aq-fix/benchmarks/natively-answer-quality
export NATIVELY_ENV_FILE=/Users/evin/natively-cluely-ai-assistant/.env; unset AQ_JUDGE ER_JUDGE_ROLE
LOG=evidence-rich/results/astra-chain.log
ids() { node -e "const p=require('./evidence-rich/results/replay/astra-plan.json'); console.log((p['$1']['$2']||[]).join(','))"; }
J() { label=$1; shift; echo "$(date -u +%Y-%m-%dT%H:%M:%S.000Z) start $label" >> $LOG; out=$(node evidence-rich/judge/judge-er.mjs --set base "$@" --concurrency 3 2>&1 | tail -1 | tr '\n' ' ' | cut -c1-200); echo "$(date -u +%Y-%m-%dT%H:%M:%S.000Z) end $label: $out" >> $LOG; }
side() { plan=$1; arm=$2; run=$3; J "$plan $arm new texts: $run" --runs evidence-rich/results/rp-$arm--$run --ids "$(ids $plan rp-$arm--$run)"; }
a() { side e17 e17-ctl er-dev2-e13c; J "e17 shown: er-dev2-e13c" --runs evidence-rich/results/er-dev2-e13c --ids "$(ids e17 er-dev2-e13c)"; J "e17 shown (retry): er-dev-e13c" --runs evidence-rich/results/er-dev-e13c --ids "$(ids e17 er-dev-e13c)"; side e17b e17b-ctl er-dev-e16b; }
b() { side e17 e17-conflict er-dev2-e13c; J "e17 drafts: er-dev2-e13c" --runs evidence-rich/results/er-dev2-e13c --draft --ids "$(ids e17 er-dev2-e13c::draft)"; side e17b e17b-conflict er-dev-e16b; }
c() { side e17b e17b-ctl er-dev2-e16b; J "e17b shown: er-dev-e16b" --runs evidence-rich/results/er-dev-e16b --ids "$(ids e17b er-dev-e16b)"; J "e17b drafts: er-dev-e16b" --runs evidence-rich/results/er-dev-e16b --draft --ids "$(ids e17b er-dev-e16b::draft)"; }
d() { side e17b e17b-conflict er-dev2-e16b; J "e17b shown: er-dev2-e16b" --runs evidence-rich/results/er-dev2-e16b --ids "$(ids e17b er-dev2-e16b)"; J "e17b drafts: er-dev2-e16b" --runs evidence-rich/results/er-dev2-e16b --draft --ids "$(ids e17b er-dev2-e16b::draft)"; }
a & b & c & d & wait
echo "$(date -u +%Y-%m-%dT%H:%M:%S.000Z) parallel2 streams finished" >> $LOG; echo ASTRA-PARALLEL2-DONE
