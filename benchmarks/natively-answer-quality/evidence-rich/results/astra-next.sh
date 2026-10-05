#!/bin/zsh
# Next Astra batch (written 2026-10-05 after the pool closed at 12:05 UTC). Two streams (twelve calls at once gave
# "fetch failed"). Order: E18, both samples (220 judgments still needed) → the rest of E10 (about 390).
# Run: evidence-rich/results/astra-next.sh   (it probes first, runs calibration, and stops when the pool closes)
cd /Users/evin/natively-cluely-ai-assistant/.claude/worktrees/aq-fix/benchmarks/natively-answer-quality
export NATIVELY_ENV_FILE=/Users/evin/natively-cluely-ai-assistant/.env; unset AQ_JUDGE ER_JUDGE_ROLE
LOG=evidence-rich/results/astra-chain.log; say() { echo "$(date -u +%Y-%m-%dT%H:%M:%S.000Z) $*" >> $LOG; }
node astra/probe.mjs > /dev/null 2>&1; node -e "process.exit(require('./astra/probe-result.json').ok ? 0 : 1)" || { say "astra-next: judge closed, nothing judged"; exit 3; }
say "astra-next: start calibration"; node evidence-rich/judge/calibrate-er.mjs > evidence-rich/results/astra-next-cal.out 2>&1 || { say "astra-next: calibration did not pass or the pool closed: stopping"; exit 2; }
say "astra-next: calibration passed: $(tail -1 evidence-rich/results/astra-next-cal.out | cut -c1-120)"
ids() { node -e "const p=require('./evidence-rich/results/replay/astra-plan.json'); console.log((p['$1']['$2']||[]).join(','))"; }
J() { [ -f $LOG.closed ] && return; label=$1; shift; say "start $label"; out=$(node evidence-rich/judge/judge-er.mjs --set base "$@" --concurrency 3 2>&1 | tail -3 | tr '\n' ' '); say "end $label: $(echo $out | cut -c1-200)"; echo "$out" | grep -q "402 ration exhausted\|account quota exhausted\|stopping new judge calls" && touch $LOG.closed; }
rm -f $LOG.closed
s() { plan=$1; ctl=$2; new=$3; shift 3; for r in "$@"; do J "$plan new wording, new texts: $r" --runs evidence-rich/results/rp-$new--$r --ids "$(ids $plan rp-$new--$r)"; J "$plan control arm, new texts: $r" --runs evidence-rich/results/rp-$ctl--$r --ids "$(ids $plan rp-$ctl--$r)"; J "$plan shown: $r" --runs evidence-rich/results/$r --ids "$(ids $plan $r)"; J "$plan drafts: $r" --runs evidence-rich/results/$r --draft --ids "$(ids $plan $r::draft)"; done; }
a() { s e18 e17-ctl e18 er-dev-e13c er-dev2-e13c; for r in er-dev-m1 er-holdout-m1 er-dev-m1r er-dev-m2; do J "E10 whole k0: $r" --runs evidence-rich/results/rp-e10-whole-k0--$r; done; for r in er-holdout-m1 er-dev-m1r er-dev-m2; do J "E10 cut k1: $r" --runs evidence-rich/results/rp-e10-cut-k1--$r; done; }
b() { s e18b e17b-ctl e18b er-dev-e16b er-dev2-e16b; for r in er-dev-m1r er-dev-m2; do J "E10 cut k0: $r" --runs evidence-rich/results/rp-e10-cut-k0--$r; done; for r in er-dev-m1 er-holdout-m1 er-dev-m1r er-dev-m2; do J "E10 whole k1: $r" --runs evidence-rich/results/rp-e10-whole-k1--$r; done; }
a & b & wait; say "astra-next finished$([ -f $LOG.closed ] && echo ' (the pool closed)')"; echo ASTRA-NEXT-DONE
