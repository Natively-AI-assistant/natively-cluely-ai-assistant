# DeepSeek model-id migration regression (2026-09-17)

Conversations: INT-M, SALES-S, TEAM-M, TECH-DISC-L · 3 runs each · same pipeline bundle, prompts, corpus and deadline overrides as the main benchmark. Only natively-api's `DEEPSEEK_MODEL` differs.

| Metric | Before: `deepseek-v4-flash` (ds-flash-prod, 2026-09-16) | After: `deepseek-flash` (ds-flash-migrated, 2026-09-16/17) |
|---|---|---|
| Runs / summaries produced | 12 / 12 | 12 / 12 |
| Model-call errors · dropped chunks · blocked Gemini fallbacks | 0 · 0 · 0 | 0 · 0 · 0 |
| Production deadline breaches (calls) | 0 | 0 |
| Model id sent by natively-api | deepseek-v4-flash | deepseek-flash |
| Model reported by DeepSeek | deepseek-flash | deepseek-flash |
| `thinking` sent · reasoning tokens | {"type":"disabled"} · 0 | {"type":"disabled"} · 0 |
| All verification checks pass | true | true |
| Pipeline latency P50 / P90 (s) | 39.1 / 58.8 | 38.9 / 56.5 |
| Mean input / output tokens per summary | 50441 / 22474 | 51070 / 22908 |
| Mean cost per summary (cold cache, off-peak) | $0.0211 | $0.0214 |
| Action items · decisions · sections · bullets (mean) | 26.0 · 16.4 · 5.5 · 104.9 | 26.2 · 16.3 · 5.5 · 108.1 |
| Gold-fact anchor retention (all / critical) | 94.9% / 98.6% | 96.6% / 99.2% |
| Numbers not in transcript (mean per summary) | 1.25 | 1.00 |
| Superseded-value leaks (mean per summary) | 5.00 | 4.92 |
| Overview polish rejected (runs) | 11 | 12 |
| Gemini-judged weighted fact retention | 93.1% | not judged (Gemini credits depleted) |

| Conversation | Anchor retention before → after | P50 s before → after | Output tokens before → after |
|---|---|---|---|
| INT-M | 96.3% → 98.3% | 25.7 → 25.9 | 15310 → 15785 |
| SALES-S | 89.9% → 93.1% | 23.4 → 23.9 | 6972 → 6990 |
| TEAM-M | 95.6% → 97.1% | 59.7 → 56.7 | 34524 → 35210 |
| TECH-DISC-L | 97.8% → 97.8% | 50.2 → 50.4 | 33091 → 33648 |

**Reading this table**
- DeepSeek documents `deepseek-v4-flash` as a retired alias served by DeepSeek-V4.1-Flash, and both arms report `deepseek-flash` as the answering model, so differences here are run-to-run sampling noise (no temperature is set on either side), not a model change.
- Anchor retention, unsupported numbers and superseded-value leaks are deterministic text checks, applied identically to both arms. They are coarser than the judge: the superseded-value check counts any occurrence of a number unique to a correction's initial value, so it over-counts (a "9" elsewhere in the summary matches). Use them for before/after deltas only.
- Hallucinated non-numeric content, speaker attribution and decision correctness were not checked: they need the LLM judge, whose Gemini key has no prepaid credits.
- A Gemini Flash-Lite arm was not run for the same reason (the key returns 429 RESOURCE_EXHAUSTED), and because Flash-Lite is not the summary generator in natively-api: it is only the fallback leg after DeepSeek.
- Both arms ran in the DeepSeek off-peak window (before: 2026-09-16 20:04-20:48 UTC; after: 23:34-23:37 UTC), from the same machine.
