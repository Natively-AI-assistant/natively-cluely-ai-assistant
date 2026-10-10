#!/bin/zsh
# Next Astra window: finish the control holdout (30 rows), then the candidate's shown answers on the 80 rows.
cd /Users/evin/natively-cluely-ai-assistant/.claude/worktrees/aq-fix/benchmarks/natively-answer-quality
export NATIVELY_ENV_FILE=/Users/evin/natively-cluely-ai-assistant/.env; unset AQ_JUDGE ER_JUDGE_ROLE
LOG=evidence-rich/results/astra-chain.log; say() { echo "$(date -u +%Y-%m-%dT%H:%M:%S.000Z) $*" >> $LOG; }; R=evidence-rich/results
node astra/probe.mjs > /dev/null 2>&1; node -e "process.exit(require('./astra/probe-result.json').ok ? 0 : 1)" || { say "astra-next3: judge closed"; exit 3; }
rm -f $LOG.closed; say "astra-next3: start calibration"; node evidence-rich/judge/calibrate-er.mjs > $R/astra-next-cal.out 2>&1 || { say "astra-next3: calibration did not pass or the pool closed"; exit 2; }
say "astra-next3: $(tail -1 $R/astra-next-cal.out | cut -c1-110)"
J() { [ -f $LOG.closed ] && return; label=$1; shift; say "start $label"; out=$(node evidence-rich/judge/judge-er.mjs --set base "$@" --concurrency 3 2>&1 | tail -3 | tr '\n' ' '); say "end $label: $(echo $out | cut -c1-170)"; echo "$out" | grep -q "402 ration exhausted\|account quota exhausted\|stopping new judge calls" && touch $LOG.closed; }
J "holdout, blind: er-holdout-m3 (the 30 rows left)" --runs $R/er-holdout-m3 --blind
(J "shown answers, candidate: dev" --runs $R/er3-dev-new) & (J "shown answers, candidate: dev2" --runs $R/er3-dev2-new) & wait
say "astra-next3 finished$([ -f $LOG.closed ] && echo ' (the pool closed)')"; git add -f evidence-rich/judge/out/base/*.astra.jsonl 2>/dev/null; git commit -q -m "bench(evidence-rich): Astra judgments of the next window (control holdout completed)" 2>/dev/null; echo ASTRA-NEXT3-DONE
