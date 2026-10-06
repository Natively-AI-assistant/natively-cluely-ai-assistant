#!/bin/zsh
# Astra window of 2026-10-07 (~02:00 UTC). Three streams of three calls.
# Order: the 30 control rows left of the holdout pair (completes E16b's safety line 3) → the development baseline of
# today's main (er4-dev-main, er4-dev2-main; 630 rows) → the drafts of the rows the pass edited on those runs.
# Extra steps for a candidate, when one is ready, go in results/astra-next4-extra.sh (run first if it exists).
cd /Users/evin/natively-cluely-ai-assistant/.claude/worktrees/aq-fix/benchmarks/natively-answer-quality
export NATIVELY_ENV_FILE=/Users/evin/natively-cluely-ai-assistant/.env; unset AQ_JUDGE ER_JUDGE_ROLE
LOG=evidence-rich/results/astra-chain.log; say() { echo "$(date -u +%Y-%m-%dT%H:%M:%S.000Z) $*" >> $LOG; }; R=evidence-rich/results
node astra/probe.mjs > /dev/null 2>&1; node -e "process.exit(require('./astra/probe-result.json').ok ? 0 : 1)" || { say "astra-next4: judge closed"; exit 3; }
rm -f $LOG.closed; say "astra-next4: start calibration"; node evidence-rich/judge/calibrate-er.mjs > $R/astra-next-cal.out 2>&1 || { say "astra-next4: calibration did not pass or the pool closed"; exit 2; }
say "astra-next4: $(tail -1 $R/astra-next-cal.out | cut -c1-110)"
J() { [ -f $LOG.closed ] && return; label=$1; shift; say "start $label"; out=$(node evidence-rich/judge/judge-er.mjs --set base "$@" --concurrency 3 2>&1 | tail -3 | tr '\n' ' '); say "end $label: $(echo $out | cut -c1-170)"; echo "$out" | grep -q "402 ration exhausted\|account quota exhausted\|stopping new judge calls" && touch $LOG.closed; }
save() { mkdir -p /Users/evin/natively-er-backup/judge-out; cp -p evidence-rich/judge/out/base/*.astra.jsonl /Users/evin/natively-er-backup/judge-out/ 2>/dev/null; git add -f evidence-rich/judge/out/base/*.astra.jsonl 2>/dev/null; git commit -q -m "bench(evidence-rich): Astra judgments, window of 2026-10-07" 2>/dev/null; }
[ -x $R/astra-next4-extra.sh ] && { say "astra-next4: candidate steps first"; source $R/astra-next4-extra.sh; save; }
M1=general,sales,recruiting; M2=team-meet,looking-for-work,lecture; M3=technical-interview,seminar,call-center
a() { J "holdout, blind: er-holdout-m3 (the 30 rows left)" --runs $R/er-holdout-m3 --blind; J "baseline dev, $M1" --runs $R/er4-dev-main --mode $M1; J "baseline dev2, $M1" --runs $R/er4-dev2-main --mode $M1; }
b() { J "baseline dev, $M2" --runs $R/er4-dev-main --mode $M2; J "baseline dev2, $M2" --runs $R/er4-dev2-main --mode $M2; }
c() { J "baseline dev, $M3" --runs $R/er4-dev-main --mode $M3; J "baseline dev2, $M3" --runs $R/er4-dev2-main --mode $M3; }
a & b & c & wait; save
(J "baseline retry dev" --runs $R/er4-dev-main) & (J "baseline retry dev2" --runs $R/er4-dev2-main) & wait
(J "drafts dev" --runs $R/er4-dev-main --draft) & (J "drafts dev2" --runs $R/er4-dev2-main --draft) & wait
save; say "astra-next4 finished$([ -f $LOG.closed ] && echo ' (the pool closed)')"; echo ASTRA-NEXT4-DONE
