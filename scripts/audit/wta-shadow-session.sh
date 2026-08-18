#!/bin/bash
# scripts/audit/wta-shadow-session.sh — WTA shadow-telemetry session driver.
#
# Speaks the interviewer lines through SYSTEM AUDIO via macOS `say`, which
# Natively's SystemAudioCapture ingests as the INTERVIEWER channel — you
# answer through the MIC as the candidate. Run Natively FIRST (see the
# playbook), start a meeting, then run this script in a second terminal and
# follow the prompts. Each scenario tells you when to answer and when to
# press "What to Answer".
#
#   ./scripts/audit/wta-shadow-session.sh            # all scenarios
#   ./scripts/audit/wta-shadow-session.sh 4          # start from scenario 4
#
# macOS-only (uses `say`). ~20 minutes end to end.

set -u
VOICE="${WTA_VOICE:-Samantha}"
RATE="${WTA_RATE:-172}"
START_FROM="${1:-1}"

speak() {
  echo "    🗣  INTERVIEWER: \"$1\""
  say -v "$VOICE" -r "$RATE" "$1"
}
pause_answer() {
  echo ""
  read -r -p "    🎤  YOU (mic): $1   — press Enter when done… "
}
press_wta() {
  echo ""
  read -r -p "    🔘  PRESS 'What to Answer' NOW ($1) — press Enter after the answer finishes… "
}
scenario() {
  local n="$1"; shift
  CURRENT=$n
  if [ "$n" -lt "$START_FROM" ]; then SKIP=1; else SKIP=0; fi
  if [ "$SKIP" -eq 0 ]; then
    echo ""
    echo "──────────────────────────────────────────────────────────────"
    echo "SCENARIO $n — $*"
    echo "──────────────────────────────────────────────────────────────"
    read -r -p "    Ready? Press Enter to start… "
  fi
}
run() { [ "$SKIP" -eq 0 ] && "$@"; }

echo "WTA shadow-session driver. Voice=$VOICE rate=$RATE. Ctrl-C to stop."
echo "Make sure the meeting is RUNNING in Natively before continuing."
read -r -p "Press Enter to begin… "

scenario 1 "Baseline sanity — simple questions (expect ledger_parity on every press)"
run speak "Thanks for joining today. Let's jump right in. Tell me about yourself."
run press_wta "baseline identity"
run pause_answer "read the suggestion aloud, or say a 2-3 sentence intro"
run speak "Why did you choose Kafka for your notification system?"
run press_wta "baseline technical"
run pause_answer "give a 1-2 sentence answer"

scenario 2 "THE SPEC SUCCESS CRITERION — interrupted 3-part compound"
run speak "Tell me about your notification system."
run pause_answer "START answering, get 1-2 sentences out, mention Kafka and consumer groups"
run speak "Sorry, before that — why did you choose Kafka, how did you handle consumer groups, and what would you change if you built it again?"
run press_wta "expect clause coverage multiPart; ledger 3 open asks"
run pause_answer "read the answer; note whether ALL THREE parts were covered"
run speak "And specifically the rebalancing problem?"
run press_wta "narrowing refinement of the compound"

scenario 3 "Two questions, NO answer in between (expect ledger_divergence_open_2)"
run speak "Walk me through your resume."
run speak "Also, what was the hardest technical decision you made last year?"
run press_wta "extractor sees only Q2; ledger holds both open"
run pause_answer "answer whichever the app chose"

scenario 4 "Narrowing refinement (F2 fix — expect narrowing_refinement in trace)"
run speak "What is your experience with Kafka?"
run pause_answer "answer broadly in 1-2 sentences, do NOT mention consumer groups"
run speak "I mean specifically consumer groups."
run press_wta "resolved question should mention Kafka AND consumer groups"

scenario 5 "Correction (expect correction_entity_swap)"
run speak "Why did you choose Redis for the caching layer?"
run speak "Sorry, I mean Kafka."
run press_wta "resolved question should say Kafka, not Redis"
run pause_answer "answer briefly"

scenario 6 "Bare follow-ups (Why? / And SQL?)"
run speak "Rate your Python skills out of ten."
run pause_answer "give a rating with one reason"
run speak "And SQL?"
run press_wta "should resolve to a rating question about SQL"
run pause_answer "answer it"
run speak "Why?"
run press_wta "bare why — expand rule"

scenario 7 "Topic shift keeps the FULL phrase (wta_skill_054 fix)"
run speak "How comfortable are you with Python?"
run pause_answer "answer briefly"
run speak "Hmm right, and Python frameworks?"
run press_wta "resolved question must keep the word FRAMEWORKS"

scenario 8 "Drill-in preserves the asked words (wta_project_041 fix)"
run speak "Tell me about your best project."
run pause_answer "name a real project in one sentence"
run speak "What tech stack did you use there?"
run press_wta "resolved question must keep TECH STACK, not a generic drill-in"

scenario 9 "NEGATIVES — do NOT press. Watch that no auto-suggestion fires."
run speak "Did you have any trouble finding parking today?"
run pause_answer "just say: no, all good"
run speak "How was your weekend?"
run pause_answer "one casual sentence"
run speak "Interesting, that sounds pretty solid."
run speak "Give me one second, my other monitor just died."
echo "    👀  WATCH: no speculative suggestion should have appeared for any of these."
run pause_answer "confirm nothing fired, then continue"

scenario 10 "Interruption mid-answer"
run speak "Walk me through the architecture of your billing service."
run pause_answer "say ONLY: Sure, so at a high level — then STOP talking"
run speak "Actually, hold on — what database does it use?"
run press_wta "should answer the database question; billing ask stays active in ledger"

scenario 11 "Task directives (ledger TASK_DIRECTIVE fix)"
run speak "Solve Two Sum."
run press_wta "coding path"
run pause_answer "skim the answer"
run speak "Convince me you are right for this role."
run press_wta "jd-fit imperative"

scenario 12 "Long-range recall (3+ minutes of gap needed)"
run speak "Tell me about a production incident you handled."
run pause_answer "IMPORTANT: mention 'a memory leak in a long-running consumer process' in your answer"
echo "    ⏳  Now fill ~3 minutes: chat casually, answer 1-2 filler questions."
run speak "What do you do outside of work?"
run pause_answer "chat for a bit — keep going ~3 minutes total"
run speak "Going back to the memory leak you mentioned earlier — how long did it take your team to ship the fix?"
run press_wta "expect long_range_recall_fired in the trace"

echo ""
echo "DONE. Stop the meeting, then collect the log (see the playbook: grep the tee'd log)."
