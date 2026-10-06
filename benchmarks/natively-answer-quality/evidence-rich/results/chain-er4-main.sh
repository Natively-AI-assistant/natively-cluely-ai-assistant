#!/bin/zsh
# Fresh development baseline of today's main (f4cd986d): dev (270) then dev2 (360). Then a copy of the run data
# outside .claude/worktrees (that folder was deleted once, on 2026-10-06).
cd /Users/evin/natively-cluely-ai-assistant/.claude/worktrees/aq-fix/benchmarks/natively-answer-quality
export NATIVELY_ENV_FILE=/Users/evin/natively-cluely-ai-assistant/.env
W=/Users/evin/natively-cluely-ai-assistant/.claude/worktrees/er-main
stopapp() { P=$(ps -axo pid,command | grep "[s]cripts/dev-agent.mjs" | awk '{print $1}'); [ -n "$P" ] && kill -TERM $P; sleep 12; }
stopapp
node evidence-rich/supervise-er.mjs --root $W --runs dev:er4-dev-main,dev2:er4-dev2-main --fresh-userdata > evidence-rich/results/supervise-er4-main.log 2>&1 || echo "RUN FAILED"
stopapp
mkdir -p /Users/evin/natively-er-backup/results /Users/evin/natively-er-backup/judge-out
for r in er4-dev-main er4-dev2-main er3-dev-ctl er3-dev2-ctl er3-dev-new er3-dev2-new er-holdout-m3 er-holdout-e16b3; do [ -d evidence-rich/results/$r ] && cp -R -p evidence-rich/results/$r /Users/evin/natively-er-backup/results/ 2>/dev/null; done
cp -p evidence-rich/judge/out/base/*.astra.jsonl /Users/evin/natively-er-backup/judge-out/ 2>/dev/null
git add -f evidence-rich/results/er4-*/rows.jsonl evidence-rich/results/er4-*/run.json 2>/dev/null && git commit -q -m "bench(evidence-rich): rows of the fresh development baseline of main f4cd986d (er4-dev-main, er4-dev2-main)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
echo CHAIN-ER4-DONE
