#!/bin/zsh
# Astra batch 3 (written 2026-10-06 after the 02:00–03:16 UTC window). Three streams of three calls (nine at once was clean).
# Order: E16c (320 draft judgments, the decision) → the rest of the dev control under Astra (er-dev-e13c, er-dev2-e13c)
# → the drafts of the rows the pass edited on those runs. Probes first, runs calibration, stops when the pool closes.
cd /Users/evin/natively-cluely-ai-assistant/.claude/worktrees/aq-fix/benchmarks/natively-answer-quality
export NATIVELY_ENV_FILE=/Users/evin/natively-cluely-ai-assistant/.env; unset AQ_JUDGE ER_JUDGE_ROLE
LOG=evidence-rich/results/astra-chain.log; say() { echo "$(date -u +%Y-%m-%dT%H:%M:%S.000Z) $*" >> $LOG; }
node astra/probe.mjs > /dev/null 2>&1; node -e "process.exit(require('./astra/probe-result.json').ok ? 0 : 1)" || { say "astra-next2: judge closed, nothing judged"; exit 3; }
rm -f $LOG.closed
say "astra-next2: start calibration"; node evidence-rich/judge/calibrate-er.mjs > evidence-rich/results/astra-next-cal.out 2>&1 || { say "astra-next2: calibration did not pass or the pool closed: stopping"; exit 2; }
say "astra-next2: calibration passed: $(tail -1 evidence-rich/results/astra-next-cal.out | cut -c1-120)"
J() { [ -f $LOG.closed ] && return; label=$1; shift; say "start $label"; out=$(node evidence-rich/judge/judge-er.mjs --set base "$@" --concurrency 3 2>&1 | tail -3 | tr '\n' ' '); say "end $label: $(echo $out | cut -c1-170)"; echo "$out" | grep -q "402 ration exhausted\|account quota exhausted\|stopping new judge calls" && touch $LOG.closed; }
R=evidence-rich/results
a() { J "E16c control k0 dev" --runs $R/rg-e16c-ctl-k0--er-dev-e13c; J "E16c new k0 dev" --runs $R/rg-e16c-new-k0--er-dev-e16b; J "E16c control k1 dev2" --runs $R/rg-e16c-ctl-k1--er-dev2-e13c; J "dev control, modes 1-3" --runs $R/er-dev-e13c --mode call-center,team-meet,recruiting; J "dev2 control, modes 1-3" --runs $R/er-dev2-e13c --mode call-center,team-meet,recruiting; J "drafts dev" --runs $R/er-dev-e13c --draft; }
b() { J "E16c control k1 dev" --runs $R/rg-e16c-ctl-k1--er-dev-e13c; J "E16c new k1 dev" --runs $R/rg-e16c-new-k1--er-dev-e16b; J "E16c new k1 dev2" --runs $R/rg-e16c-new-k1--er-dev2-e16b; J "dev control, modes 4-6" --runs $R/er-dev-e13c --mode sales,general,lecture; J "dev2 control, modes 4-6" --runs $R/er-dev2-e13c --mode sales,general,lecture; J "drafts dev2" --runs $R/er-dev2-e13c --draft; }
c() { J "E16c control k0 dev2" --runs $R/rg-e16c-ctl-k0--er-dev2-e13c; J "E16c new k0 dev2" --runs $R/rg-e16c-new-k0--er-dev2-e16b; J "dev control, modes 7-9" --runs $R/er-dev-e13c --mode seminar,looking-for-work,technical-interview; J "dev2 control, modes 7-9" --runs $R/er-dev2-e13c --mode seminar,looking-for-work,technical-interview; }
a & b & c & wait; say "astra-next2 finished$([ -f $LOG.closed ] && echo ' (the pool closed)')"; echo ASTRA-NEXT2-DONE
