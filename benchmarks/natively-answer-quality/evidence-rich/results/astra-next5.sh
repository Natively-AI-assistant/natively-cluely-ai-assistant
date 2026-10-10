#!/bin/zsh
# Next Astra window: E19's blind-holdout replay (25 rows, 50 judgments, aggregates only), first.
cd /Users/evin/natively-cluely-ai-assistant/.claude/worktrees/aq-fix/benchmarks/natively-answer-quality
export NATIVELY_ENV_FILE=/Users/evin/natively-cluely-ai-assistant/.env; unset AQ_JUDGE ER_JUDGE_ROLE
LOG=evidence-rich/results/astra-chain.log; say() { echo "$(date -u +%Y-%m-%dT%H:%M:%S.000Z) $*" >> $LOG; }; R=evidence-rich/results
node astra/probe.mjs > /dev/null 2>&1; node -e "process.exit(require('./astra/probe-result.json').ok ? 0 : 1)" || { say "astra-next5: judge closed"; exit 3; }
rm -f $LOG.closed; say "astra-next5: start calibration"; node evidence-rich/judge/calibrate-er.mjs > $R/astra-next-cal.out 2>&1 || { say "astra-next5: calibration did not pass or the pool closed"; exit 2; }
say "astra-next5: $(tail -1 $R/astra-next-cal.out | cut -c1-110)"
ids() { node -e "const p=require('./evidence-rich/results/replay/astra-plan-e19h.json'); console.log((p.need['$1']||[]).join(','))"; }
J() { [ -f $LOG.closed ] && return; label=$1; shift; say "start $label"; out=$(node evidence-rich/judge/judge-er.mjs --set base "$@" --concurrency 3 2>&1 | tail -3 | tr '\n' ' '); say "end $label: $(echo $out | cut -c1-170)"; echo "$out" | grep -q "402 ration exhausted\|account quota exhausted\|stopping new judge calls" && touch $LOG.closed; }
(J "E19 holdout replay, new wording" --runs $R/rp-e19h--er-holdout-e16b3 --blind --ids "$(ids rp-e19h--er-holdout-e16b3)") & (J "E19 holdout replay, control arm" --runs $R/rp-e19h-ctl--er-holdout-e16b3 --blind --ids "$(ids rp-e19h-ctl--er-holdout-e16b3)") & (J "E19 holdout replay, drafts" --runs $R/er-holdout-e16b3 --blind --draft --ids "$(ids er-holdout-e16b3::draft)") & wait
mkdir -p /Users/evin/natively-er-backup/judge-out; cp -p evidence-rich/judge/out/base/*.astra.jsonl /Users/evin/natively-er-backup/judge-out/ 2>/dev/null; git add -f evidence-rich/judge/out/base/*.astra.jsonl 2>/dev/null; git commit -q -m "bench(evidence-rich): Astra judgments — E19 blind-holdout replay" 2>/dev/null
say "astra-next5 finished$([ -f $LOG.closed ] && echo ' (the pool closed)')"; echo ASTRA-NEXT5-DONE
