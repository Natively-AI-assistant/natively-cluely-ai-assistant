#!/bin/zsh
# Astra, three streams: E19's 176 judgments first, then the rest of the baseline, then drafts.
cd /Users/evin/natively-cluely-ai-assistant/.claude/worktrees/aq-fix/benchmarks/natively-answer-quality
export NATIVELY_ENV_FILE=/Users/evin/natively-cluely-ai-assistant/.env; unset AQ_JUDGE ER_JUDGE_ROLE
LOG=evidence-rich/results/astra-chain.log; say() { echo "$(date -u +%Y-%m-%dT%H:%M:%S.000Z) $*" >> $LOG; }; R=evidence-rich/results
ids() { node -e "const p=require('./evidence-rich/results/replay/astra-plan-e19.json'); console.log((p.e19['$1']||[]).join(','))"; }
J() { [ -f $LOG.closed ] && return; label=$1; shift; say "start $label"; out=$(node evidence-rich/judge/judge-er.mjs --set base "$@" --concurrency 3 2>&1 | tail -3 | tr '\n' ' '); say "end $label: $(echo $out | cut -c1-170)"; echo "$out" | grep -q "402 ration exhausted\|account quota exhausted\|stopping new judge calls" && touch $LOG.closed; }
save() { mkdir -p /Users/evin/natively-er-backup/judge-out; cp -p evidence-rich/judge/out/base/*.astra.jsonl /Users/evin/natively-er-backup/judge-out/ 2>/dev/null; git add -f evidence-rich/judge/out/base/*.astra.jsonl 2>/dev/null; git commit -q -m "bench(evidence-rich): Astra judgments, window of 2026-10-07" 2>/dev/null; }
a() { J "E19 new wording, dev2" --runs $R/rp-e19--er4-dev2-main --ids "$(ids rp-e19--er4-dev2-main)"; J "E19 unchanged side, drafts dev" --runs $R/er4-dev-main --draft --ids "$(ids er4-dev-main::draft)"; J "E19 unchanged side, drafts dev2" --runs $R/er4-dev2-main --draft --ids "$(ids er4-dev2-main::draft)"; }
b() { J "E19 control arm, dev2" --runs $R/rp-e19-ctl--er4-dev2-main --ids "$(ids rp-e19-ctl--er4-dev2-main)"; J "E19 control arm, dev" --runs $R/rp-e19-ctl--er4-dev-main --ids "$(ids rp-e19-ctl--er4-dev-main)"; }
c() { J "E19 new wording, dev" --runs $R/rp-e19--er4-dev-main --ids "$(ids rp-e19--er4-dev-main)"; J "E19 unchanged side, shown dev2" --runs $R/er4-dev2-main --ids "$(ids er4-dev2-main)"; J "E19 unchanged side, shown dev" --runs $R/er4-dev-main --ids "$(ids er4-dev-main)"; }
a & b & c & wait
for d in rp-e19--er4-dev-main rp-e19--er4-dev2-main rp-e19-ctl--er4-dev-main rp-e19-ctl--er4-dev2-main; do J "E19 retry $d" --runs $R/$d --ids "$(ids $d)"; done
save; say "E19 judged$([ -f $LOG.closed ] && echo ' — the pool closed')"
M1=general,sales,recruiting; M2=team-meet,looking-for-work,lecture; M3=technical-interview,seminar,call-center
x() { J "baseline dev, $M1" --runs $R/er4-dev-main --mode $M1; J "baseline dev2, $M1" --runs $R/er4-dev2-main --mode $M1; }
y() { J "baseline dev, $M2" --runs $R/er4-dev-main --mode $M2; J "baseline dev2, $M2" --runs $R/er4-dev2-main --mode $M2; }
z() { J "baseline dev, $M3" --runs $R/er4-dev-main --mode $M3; J "baseline dev2, $M3" --runs $R/er4-dev2-main --mode $M3; }
x & y & z & wait; save
(J "drafts dev" --runs $R/er4-dev-main --draft) & (J "drafts dev2" --runs $R/er4-dev2-main --draft) & wait
save; say "astra-e19 finished$([ -f $LOG.closed ] && echo ' (the pool closed)')"; echo ASTRA-E19-DONE
