#!/bin/bash
# scripts/audit/wta-shadow-session.sh — WTA shadow-telemetry session driver.
#
# Plays a REALISTIC interviewer through SYSTEM AUDIO via macOS `say` (which
# Natively ingests as the interviewer channel); you answer through the MIC.
# The dialogue is grounded in the actual profileresume/ documents:
#   - resume: evin-SoftwareEngineer2025 (EstroTech, Aetherbot, TalentScope,
#     PriceX, RedisMart, GenAI Scholar, CUSAT)
#   - JD: Data Analyst sample (SQL, dashboards, stakeholders, Tableau/PowerBI)
# so profile grounding and JD-fit routing are exercised against REAL content,
# and the interviewer sounds like an interviewer: context-setting preambles,
# hedges, misremembered names, interruptions, evaluative backchannels.
#
# Each scenario still targets one piece of shadow telemetry (see the
# playbook). Setup: upload BOTH profileresume/ PDFs in Natively (resume + JD),
# start a meeting, then run this in a second terminal.
#
#   ./scripts/audit/wta-shadow-session.sh            # all scenarios (~25 min)
#   ./scripts/audit/wta-shadow-session.sh 5          # resume from scenario 5
#
# macOS-only (uses `say`).

set -u
VOICE="${WTA_VOICE:-Samantha}"
RATE="${WTA_RATE:-176}"
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

echo "WTA shadow-session driver (resume-grounded). Voice=$VOICE rate=$RATE."
echo "Checklist: meeting RUNNING, resume + Data Analyst JD uploaded in Natively."
read -r -p "Press Enter to begin… "

scenario 1 "Opening — small talk that must NOT fire, then the real opener (ledger_parity)"
run speak "Hi Evin, thanks for making the time. Can you hear me alright?"
run pause_answer "say: yes, loud and clear"
run speak "Great. How's your day going so far? I know it's evening over in Kochi."
run pause_answer "one casual sentence — WATCH: no suggestion should auto-fire on this"
run speak "Good, good. So, a little context from my side. This seat is on our analytics team, we're about forty people, the analysts sit directly with product, and we ship reporting weekly. I've been through your CV already, but in your own words — walk me through your background, just the highlights."
run press_wta "baseline identity/intro"
run pause_answer "read or paraphrase the suggestion aloud"
run speak "Okay, that makes sense."

scenario 2 "Resume deep-dive — interrupted three-part compound + narrowing (clause coverage, divergence_open_3)"
run speak "Let's get into the projects, because that's honestly the most interesting part of your CV for me. Tell me about PriceX, the price comparison thing."
run pause_answer "START answering — mention the scraping pipeline and the fake review model, keep talking until interrupted"
run speak "Sorry — actually, let me stop you there, because I want to be specific. I'm really trying to understand three things about it. Why you went with Playwright for the scraping instead of something lighter, how you dealt with the retailer sites rate limiting or blocking you, and if you were rebuilding it today, what you would change."
run press_wta "3-part compound — did the answer cover ALL THREE parts?"
run pause_answer "read the answer; note any missing part"
run speak "Hm."
run speak "And specifically the rate limiting part?"
run press_wta "narrowing refinement of part two"
run pause_answer "answer briefly"

scenario 3 "Stacked questions, no answer in between (ledger_divergence_open_2)"
run speak "Okay, switching gears. Walk me through the RedisMart architecture, end to end."
run speak "Actually — also, and answer this one first — across all three of these projects, what's the single hardest technical decision you personally made?"
run press_wta "two open questions; extractor sees only the latest"
run pause_answer "answer whichever the app targeted"
run speak "Right, interesting."

scenario 4 "Narrowing refinement on a real skill (narrowing_refinement)"
run speak "You clearly lean on Redis a lot. What's your experience with Redis, generally?"
run pause_answer "answer broadly — do NOT mention cache invalidation"
run speak "Mm. That is usually where these things fall apart, so let me narrow it."
run speak "I mean specifically cache invalidation."
run press_wta "resolved question must combine Redis AND cache invalidation"
run pause_answer "answer it"

scenario 5 "Interviewer misremembers, corrects (correction_entity_swap)"
run speak "On TalentScope — and forgive me, I had another candidate this morning so I may cross wires — why did you build the realtime sync on Firebase?"
run speak "Sorry, I mean Convex."
run press_wta "answer must be about Convex, not Firebase"
run pause_answer "answer briefly"
run speak "Fair enough."

scenario 6 "JD reality check — SQL ratings and bare follow-ups (topic_shift_skill)"
run speak "So here's the thing I have to be upfront about. The day-to-day in this seat is heavy on SQL. Not sprinkled-in SQL — daily. Rate your SQL out of ten, honestly."
run press_wta "skill rating"
run pause_answer "give the rating with one concrete reason"
run speak "And Python?"
run press_wta "bare skill shift — should become a Python rating question"
run pause_answer "answer"
run speak "Why?"
run press_wta "bare why"
run pause_answer "answer briefly"

scenario 7 "Full-phrase topic shift (the frameworks fix)"
run speak "How comfortable are you with pandas and the analysis side of Python?"
run pause_answer "answer briefly"
run speak "Okay. And Python frameworks?"
run press_wta "resolved question must KEEP the word frameworks"
run pause_answer "answer"

scenario 8 "Drill-in keeps its words (project_drillin)"
run speak "Of the three projects on your CV — TalentScope, PriceX, RedisMart — which one would you call your best work, and I don't mean the flashiest, I mean the one you'd defend in a design review."
run press_wta "best-project pick"
run pause_answer "name one, one sentence why"
run speak "What tech stack did you use there?"
run press_wta "resolved question must say TECH STACK, not a generic drill-in"
run pause_answer "answer"

scenario 9 "NEGATIVES — statements and idioms. Do NOT press. Nothing should auto-fire."
run speak "Give me one second, my other monitor just died."
run speak "Okay, back. So let me tell you a bit more about how the team works. The analysts own the dashboards end to end, ETL through presentation, and they present to stakeholders every other Thursday. We value ownership and autonomy a lot here."
run speak "Interesting, by the way — that RedisMart caching number sounds pretty solid."
run pause_answer "confirm NO suggestion fired for any of those three; note it if one did"

scenario 10 "Interruption mid-answer"
run speak "Walk me through the RedisMart backend, the actual request path."
run pause_answer "say ONLY: Sure, so at a high level — then STOP"
run speak "Actually, hold on, more basic question first — what database is under it?"
run press_wta "should answer the database question (MongoDB)"
run pause_answer "answer"

scenario 11 "Task directives — coding + convince-me (jd_fit)"
run speak "Let's do a quick technical exercise, nothing scary. Solve Two Sum. Just talk me through your approach, complexity included — I saw the LeetCode grind on your CV, this should be comfortable territory."
run press_wta "coding directive"
run pause_answer "skim the answer, note complexity is included"
run speak "Alright. Now the harder one. Your CV reads engineer through and through — kiosks, pixel streaming, backends. This is a data analyst seat. Convince me you're right for this role."
run press_wta "jd-fit imperative — should use resume AND JD"
run pause_answer "deliver it"

scenario 12 "JD gap probing — realistic pressure (gap_analysis / jd shapes)"
run speak "Following on from that — the JD calls out Tableau or Power BI for the dashboarding side, and I don't see either on your CV. I see MongoDB aggregation dashboards in RedisMart, which is adjacent, but not the same thing. How would you close that gap in your first month?"
run press_wta "gap analysis grounded in JD + resume"
run pause_answer "answer"
run speak "And if we need production SQL from you on day one — real queries against a messy warehouse — how ready are you, honestly?"
run press_wta "jd readiness"
run pause_answer "answer"

scenario 13 "Long-range recall — needs a real 3-minute gap (long_range_recall_fired)"
run speak "Tell me about a time something actually broke in production on your watch. An incident you personally handled, not a hypothetical."
run pause_answer "IMPORTANT: tell a story that includes the phrase 'a memory leak in a long-running consumer process' — tie it to RedisMart or the kiosk"
run speak "Okay. Let's step away from the technical for a couple of minutes. I noticed the TEDx sponsorship work and the SEDS chapter on the second page — the fifty percent conversion rate on cold pitches caught my eye. Tell me about that."
run press_wta "behavioral/leadership — also fills the time gap"
run pause_answer "chat about it — keep this going so ~3 minutes pass since the incident story"
run speak "That's genuinely useful context. Okay — going back to the memory leak you mentioned earlier. How long did it take you to actually ship the fix, and what did you put in place so it couldn't happen again?"
run press_wta "long-range recall + compound tail"
run pause_answer "answer both parts"
run speak "Great. That's everything from my side — we'll be in touch about next steps."

echo ""
echo "DONE. Stop the meeting, then grep the session log (see the playbook)."
