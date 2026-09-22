Examples are taken verbatim from the blind judge's flagged items or from the pipeline logs. All are reproducible from `benchmark/evaluations/` and `benchmark/outputs/`.

### Failures shared by every model (pipeline architecture, not model choice)
1. **Superseded values survive the map-reduce.** Every configuration reported ~0.8-1.3 superseded values per summary. Chunk extraction sees only its own ~12k chars, so an early chunk records a value and a later chunk records the correction, and `MeetingSummaryReducer` merges both. Examples:
   - **INT-M.** The salary band was corrected from $128k-$146k to $148k-$172k. Every model, including current DeepSeek, Luna max and Luna medium, still reported "$155k target above the $128k-$146k band" as an open risk.
   - **CASUAL-M.** Trip dates moved from Oct 16-19 to Oct 23-26, and the cabin booking moved from Priya to Dan. The superseded version appears in current-DeepSeek, DeepSeek-thinking and all Luna runs.
   - **LECT-VL.** The homework due date moved from Friday Oct 9 to Monday Oct 12. Luna max reported Oct 9.
2. **Chunk-boundary artifacts written as facts.** When a topic straddles a chunk boundary, models write notes about the chunk rather than the meeting:
   - current DeepSeek, INT-M: "Maya asked about benefits and **the chunk ends there**"
   - DeepSeek-thinking, INT-M: "not covered **in this chunk**"
   - Luna max, INT-TECH-L: "**The chunk ends before** Marcus answers…"
   - Luna none: "what was provided **in this chunk**"

   The reducer then keeps these as open questions even though the meeting answered them later ("resolved issues listed as open questions" is the most common critical error for every model).
3. **Duplication and "Speaker N".** The same decision/action appears in the mode section and the structured blocks, and people can only be named if a speaker says the name. These drive structure 4-6/10, conciseness 2-3/10 and readability 4-5/10 for all six configurations.

### DeepSeek V4.1 Flash — current config (thinking off)
- **Invalid JSON → dropped chunks.** 4 of 156 chunk outputs were unparseable.
  - **Cause (REAL-LECT-VL run 2).** The model copied the prompt's `TIME RANGE: 29824680:16 - …` into `"timeRange": {"startMs": 29824680:16, …}`. That value comes from `formatMs()` applied to epoch-ms timestamps.
  - **Why it dropped the chunk.** The one-shot repair payload re-sends the ~24k-char bad output, which exceeds natively-api's 25,000-char `EXTRACTION_DEEPSEEK_MAX_CHARS`. That routes the repair to Gemini, which was blocked here, so the chunk was dropped. In production, Gemini would have repaired it.
  - **Impact (SALES-DISC-L run 2).** 2 chunks were lost, so that run missed the CFO's $40k approval threshold, the $45→$39 pricing and the "don't phase the rollout" decision. Its fact retention for SALES-DISC-L was 81.6%, versus 95%+ in the other two runs.
- **Most distractors included** (2.6 per summary), e.g. passing suggestions such as "Mia will handle the card and flowers" written as action items.
- **Small factual slips**, e.g. INT-M: "offsite around November 16th" (it is the week of Nov 9th).

### DeepSeek V4.1 Flash — thinking ON
- Best numbers/entities/timeline retention among the non-max configs, and zero invalid JSON. It still fails the same supersession traps: CASUAL-M "$285 each, four people" instead of the final $380 each for three.
- 2.75× the latency. Non-extraction calls routinely exceed the production 10 s cap, 29/33 runs.
- One truncated sentence in a Summary bullet (INT-M run 2: "presented a $128K–$14").

### GPT-5.6 Luna — none / low / medium
- **Money direction reversed.** CASUAL-M: "Dan ('Me') owes Priya $190 and needs to send it tonight". Priya owes Dan. This came up in Luna low runs 2 and 3 and Luna medium run 1.
- **Timeline errors.** "The final trip dates (Oct 23-26) are the weekend before Maya's Oct 21 birthday" (Luna low; it is the weekend after). Timeline retention is 67-72% vs 87% for current DeepSeek.
- **Lower specificity on background and entities.** On critical CASUAL-M action F16, "Dan books the cabin, taking over from Priya", current DeepSeek is 100% present while Luna none/low/medium manage 13%, with 7 contradictions. Other gaps: TECH-DISC-L's outage date (Tue Sep 8), 33% vs 100%; INT-M's four-session final loop, 31% vs 100%.
- **Unfounded absence claims** (Luna medium, INT-M): "The benefits package was not discussed because the call ended…"; "The next hiring step was not specified".
- More contradicted facts (1.1-1.6 vs 0.4 per summary). Fewer distractors (0.6-1.1).

### GPT-5.6 Luna — max
- Highest retention and fewest critical errors (0.8), but ~10 minutes per meeting and 7× the cost.
- **Action-item pollution** (INT-TECH-L run 1): past events and facts listed as action items with deadlines ("Marcus committed to ship the reconciliation alert during the rollout"; "Project Tally is targeted for…").
- **Heaviest chunk meta-commentary** of any config (INT-TECH-L run 3: three "the chunk/transcript ends before…" items).
- Many mid-run OpenAI 429s, all "no credits remaining": an account billing event, not model behaviour (13 runs excluded).
