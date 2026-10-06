#!/bin/zsh
cd /Users/evin/natively-cluely-ai-assistant/.claude/worktrees/aq-fix/benchmarks/natively-answer-quality
export NATIVELY_ENV_FILE=/Users/evin/natively-cluely-ai-assistant/.env
W=/Users/evin/natively-cluely-ai-assistant/.claude/worktrees/er-main
S=/private/tmp/claude-501/-Users-evin-natively-cluely-ai-assistant/af04b36e-2892-4160-8a0d-dca6653e3261/scratchpad
IDS="ER-D-GEN-030,ER-D-SALES-030,ER-D-TEAM-030,ER-D-LFW-023,ER-D-LFW-026,ER-D-LFW-027,ER-D-LFW-001,ER-D-LFW-002,ER-D-LFW-003,ER-D-LFW-004,ER-D-LFW-005,ER-D-LFW-006,ER-D-LFW-007,ER-D-LFW-008,ER-D-LFW-009,ER-D-LFW-010,ER-D-LFW-024,ER-D-LFW-025,ER-D-LFW-017,ER-D-LFW-011,ER-D-LFW-012,ER-D-LFW-013,ER-D-LFW-014,ER-D-LFW-015,ER-D-LFW-016,ER-D-TI-022,ER-D-TI-023,ER-D-TI-018,ER-D-TI-019,ER-D-TI-026,ER-D-TI-027,ER-D-TI-001,ER-D-TI-002,ER-D-TI-003,ER-D-TI-004,ER-D-TI-007,ER-D-TI-008,ER-D-TI-009,ER-D-TI-010,ER-D-TI-024,ER-D-TI-025,ER-D-TI-011,ER-D-TI-012,ER-D-TI-013,ER-D-TI-014,ER-D-TI-015,ER-D-TI-016,ER-D-CC-030,ER-D2-TEAM-040,ER-D2-LFW-018,ER-D2-LFW-001,ER-D2-LFW-002,ER-D2-LFW-003,ER-D2-LFW-004,ER-D2-LFW-006,ER-D2-LFW-007,ER-D2-LFW-035,ER-D2-LFW-021,ER-D2-LFW-022,ER-D2-LFW-023,ER-D2-LFW-024,ER-D2-LFW-025,ER-D2-LFW-026,ER-D2-TI-008,ER-D2-TI-009,ER-D2-TI-004,ER-D2-TI-005,ER-D2-TI-001,ER-D2-TI-002,ER-D2-TI-003,ER-D2-TI-006,ER-D2-TI-007,ER-D2-TI-031,ER-D2-TI-032,ER-D2-TI-025,ER-D2-TI-019,ER-D2-TI-020,ER-D2-TI-022,ER-D2-TI-023,ER-D2-TI-040"
stopapp() { P=$(ps -axo pid,command | grep "[s]cripts/dev-agent.mjs" | awk '{print $1}'); [ -n "$P" ] && kill -TERM $P; sleep 10; }
stopapp
node evidence-rich/supervise-er.mjs --root $W --runs dev:er3-dev-ctl,dev2:er3-dev2-ctl --fresh-userdata --run-args "--id $IDS" > evidence-rich/results/supervise-er3-ctl.log 2>&1 || echo "RUN FAILED control"
stopapp
(cd $W && git checkout -q cand/e16b-main && npm run -s build:electron > $S/b2.log 2>&1) || { echo "BUILD FAILED"; exit 1; }
node evidence-rich/supervise-er.mjs --root $W --runs dev:er3-dev-new,dev2:er3-dev2-new --fresh-userdata --run-args "--id $IDS" > evidence-rich/results/supervise-er3-new.log 2>&1 || echo "RUN FAILED candidate"
stopapp
(node evidence-rich/replay-generator.mjs --runs er3-dev-ctl,er3-dev2-ctl --select all --k 2 --name e16c3-ctl 2>&1 | tail -1) & (node evidence-rich/replay-generator.mjs --runs er3-dev-new,er3-dev2-new --select all --k 2 --name e16c3-new 2>&1 | tail -1) & wait
ER_JUDGE=astra node evidence-rich/replay-generator-judge.mjs prep --arms e16c3-ctl,e16c3-new --k 0,1 > /dev/null 2>&1
echo CHAIN-E16C3-READY
