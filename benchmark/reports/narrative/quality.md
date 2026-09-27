**How to read this section.** The most reliable signal is the per-fact verdicts against the gold fact sheets, aggregated as importance-weighted fact retention and compared **paired by conversation**. The 1-10 "overall", "structure", "conciseness" and "readability" scores are compressed into 1.9-5.9 for every configuration, and mostly measure model-independent pipeline behaviour:
- The deterministic reducer duplicates the same items across mode sections and structured blocks. Natively's copy/export repeats them too.
- Notes can only say "Speaker 1"/"Me".
- Superseded values from earlier chunks survive the merge (see Failure Analysis).

Treat those scores as descriptive, not decisive.

**Findings**
1. **Luna none/low/medium retain fewer facts than the current config.** Paired Δ is −5.8 to −6.7 pp with CIs excluding zero on all 11 conversations, and −3.8 to −4.9 pp (worse in 7/8 conversations) on the common set. The losses concentrate on:
   - timeline facts (67-72% vs 87%)
   - entities/people (73-78% vs 91%)
   - numbers (82-88% vs 93%)
   - concepts (81-88% vs 93%)

   Decisions, risks and open questions are near-equal (93-100%). Luna also contradicts more facts: 1.1-1.6 per summary vs 0.4, typically by stating a superseded or wrong value.
2. **Luna produces more selective notes.** It includes fewer distractors (0.6-1.1 vs 2.6 per summary). The judge scores Luna medium a little higher on overall (+0.56, CI [−0.03, +1.20], not significant) and on structure (5.9 vs 4.1). Selectivity is the flip side of its lower fact retention: it drops background specifics the gold sheets count.
3. **Luna max and DeepSeek-thinking retain slightly more than the current config.** They reach 96.1% / 94.9% vs 93.1%, with paired CIs including zero. Luna max had the fewest critical errors (0.8 vs 2.2) and no suggestions reported as decisions, but only 15 judged runs.
4. **Hallucination is low for every model** (0.55-1.10 flagged items per summary). The main accuracy failure is not invention; it is keeping a value that was later corrected.
