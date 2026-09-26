# Synthetic corpus authoring spec (summary-model benchmark, 2026-09-17)

You are authoring ONE long, realistic conversation transcript plus its gold reference fact sheet.
The transcript will be fed to Natively's real post-meeting summary pipeline, and model summaries
will be scored against your fact sheet. Precision of the fact sheet matters as much as realism.

## What Natively transcripts look like

Natively captures two audio channels during a call:
- the **microphone** = the Natively user ("Me"), label `S0`
- the **system audio** = everyone else on the call. Speech diarization splits it into
  `S1`, `S2`, `S3`, ... (stable per person).

The summary model NEVER sees real names as speaker labels — only "Me", "Speaker 1", "Speaker 2".
Names therefore only appear if people SAY them ("Thanks, Priya", "this is Marcus from finance").
Make sure people introduce themselves / address each other naturally so names are recoverable,
but not on every line.

Each transcript line is one finalized speech-to-text segment: usually 1-3 sentences, sometimes a
fragment. Long monologues are split across consecutive lines from the same speaker.

STT realism (light touch, do not overdo):
- occasional fillers ("um", "uh", "you know", "like"), false starts ("we- we could"), repeated words
- occasional small mis-recognitions of jargon or names (at most ~1 per 200 lines, never on a
  critical number), e.g. "Kafka" -> "Kafka", "Postgres" -> "post gress"
- numbers are written the way STT writes them: mostly digits ("$50,000", "Q3", "140 seats",
  "2.5 seconds"), occasionally spelled ("fifty thousand")
- no stage directions, no [laughter] tags, no timestamps, no speaker names in labels

## File format

Write `benchmark/transcripts/src/<ID>.txt`:

```
# id: <ID>
# title: <short internal title, NOT shown to models>
# S0: Me — <name>, <role>, <org>   (the Natively user, on mic)
# S1: <name>, <role>, <org>
# S2: ...
S1: Hey, can you hear me okay?
S0: Yep, loud and clear. Thanks for making the time.
...
```

Rules: header lines start with `# `. Every other non-empty line is `S<n>: <text>`. No blank lines
between turns required. No other syntax. Plain ASCII punctuation preferred.

## Length

Hit the target word count for your ID within +/-10% (count words of the dialogue lines only:
`grep -v '^#' FILE | cut -d: -f2- | wc -w`). Natural speech is ~150 words/minute, so the target
encodes the meeting duration. Do NOT pad with repetition to hit length — add genuine content,
tangents, small talk and back-and-forth like real meetings have.

## Content requirements (ALL conversations)

1. Realistic substance for the scenario: specific names, companies, products, numbers, dates,
   technologies, reasons, tradeoffs. Invent fictional companies/people (no real private people).
2. **Distributed information**: important facts must be spread across the whole transcript —
   early, middle, and late — not front-loaded. At least 25% of critical facts must appear only in
   the final third.
3. **Corrections / supersession**: at least 3 places where an earlier value is later corrected or
   superseded (a number, a date, an owner, a decision reversed). The final statement wins. Make
   some corrections explicit ("sorry, I misspoke, it's 140 not 120") and at least one implicit
   (a later discussion simply lands somewhere different and everyone accepts it).
4. **Distractors**: jokes, greetings, small talk, an irrelevant side discussion, repeated
   statements, a false assumption that is later corrected, similar-sounding names (e.g. Jon /
   Joan, or two people named Alex), multiple dates in play.
5. **Suggestions vs decisions**: at least 3 ideas that are floated but NOT decided (or explicitly
   rejected), alongside real decisions.
6. **Action items with owners and deadlines**, some explicit, some vague ("someone should look
   into..." with no owner), at least one where the owner changes.
7. Some unresolved open questions at the end.
8. Numbers: include at least 10 distinct meaningful numbers (money, counts, percentages, dates,
   durations, versions, metrics).

## Reference fact sheet

Write `benchmark/references/<ID>.json`, valid JSON, this schema:

```json
{
  "id": "<ID>",
  "category": "<category>",
  "natively_mode": "<mode templateType>",
  "length_bucket": "short|medium|long|very_long",
  "speakers": [{"label": "S0", "shown_to_model_as": "Me", "name": "...", "role": "...", "org": "..."}],
  "context": "2-3 sentence neutral description of what this conversation is",
  "facts": [
    {
      "id": "F01",
      "type": "decision|action_item|number|entity|person|timeline|requirement|pain_point|objection|commitment|risk|open_question|definition|concept|example|caveat|conclusion|background|preference|logistics",
      "importance": "critical|important|minor",
      "statement": "one atomic, self-contained fact as the FINAL truth of the conversation",
      "owner": "name or null (action items / commitments)",
      "deadline": "as stated, or null",
      "position": "early|middle|late",
      "lines": [12, 348],
      "notes": "optional: e.g. 'supersedes F07', 'implicit correction'"
    }
  ],
  "corrections": [
    {"id": "C01", "what": "...", "initial_value": "...", "initial_line": 40, "final_value": "...", "final_line": 512, "explicit": true, "fact_id": "F09"}
  ],
  "not_decisions": [
    {"statement": "idea that was floated/rejected, must NOT be reported as decided", "lines": [200]}
  ],
  "distractors": [
    {"statement": "e.g. joke about the CFO's dog; or the false assumption that X", "lines": [5], "why": "irrelevant | false assumption later corrected | superseded value"}
  ],
  "open_questions_at_end": ["..."],
  "summary_must_include": ["the 5-12 things a good summary absolutely must convey, as short phrases, each referencing fact ids"]
}
```

Fact sheet rules:
- Line numbers are 1-based line numbers IN THE .txt FILE (header lines included in numbering).
  Verify every line reference with `grep -n` / `sed -n` before finishing.
- 35-90 facts depending on length (short ~20-30). Every critical fact must be explicitly stated in
  the transcript (no inference leaps). Mark roughly 25-35% critical, 40% important, rest minor.
- Facts must state the FINAL value when there was a correction; the correction entry records the
  superseded value.
- Attribute facts to the right person by name where the transcript supports it.
- Do not include facts that are only implied.

## Final check before you report done

1. Word count within +/-10% of target.
2. `node -e` or python: JSON parses; every `lines` entry exists and the referenced line really
   contains the fact (spot-check all critical facts).
3. Every correction's initial and final lines really contain the old/new values.
4. Report: word count, line count, fact counts by importance, corrections count.
