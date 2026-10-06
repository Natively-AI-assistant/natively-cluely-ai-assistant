#!/bin/zsh
# Astra, three streams: the 320 E16c drafts of the fresh runs (arms e16c3-ctl / e16c3-new, k 0 and 1).
cd /Users/evin/natively-cluely-ai-assistant/.claude/worktrees/aq-fix/benchmarks/natively-answer-quality
export NATIVELY_ENV_FILE=/Users/evin/natively-cluely-ai-assistant/.env; unset AQ_JUDGE ER_JUDGE_ROLE
LOG=evidence-rich/results/astra-chain.log; say() { echo "$(date -u +%Y-%m-%dT%H:%M:%S.000Z) $*" >> $LOG; }; rm -f $LOG.closed
J() { [ -f $LOG.closed ] && return; label=$1; shift; say "start $label"; out=$(node evidence-rich/judge/judge-er.mjs --set base "$@" --concurrency 3 2>&1 | tail -3 | tr '\n' ' '); say "end $label: $(echo $out | cut -c1-170)"; echo "$out" | grep -q "402 ration exhausted\|account quota exhausted\|stopping new judge calls" && touch $LOG.closed; }
R=evidence-rich/results
a() { J "E16c ctl k0 dev" --runs $R/rg-e16c3-ctl-k0--er3-dev-ctl; J "E16c new k1 dev2" --runs $R/rg-e16c3-new-k1--er3-dev2-new; J "E16c ctl k1 dev2" --runs $R/rg-e16c3-ctl-k1--er3-dev2-ctl; }
b() { J "E16c new k0 dev" --runs $R/rg-e16c3-new-k0--er3-dev-new; J "E16c ctl k0 dev2" --runs $R/rg-e16c3-ctl-k0--er3-dev2-ctl; }
c() { J "E16c ctl k1 dev" --runs $R/rg-e16c3-ctl-k1--er3-dev-ctl; J "E16c new k1 dev" --runs $R/rg-e16c3-new-k1--er3-dev-new; J "E16c new k0 dev2" --runs $R/rg-e16c3-new-k0--er3-dev2-new; }
a & b & c & wait
# one retry pass for rows that failed on the network
for d in $R/rg-e16c3-*; do J "E16c retry $(basename $d)" --runs $d; done
say "E16c (fresh runs) judged$([ -f $LOG.closed ] && echo ' — the pool closed')"; echo ASTRA-E16C3-DONE
