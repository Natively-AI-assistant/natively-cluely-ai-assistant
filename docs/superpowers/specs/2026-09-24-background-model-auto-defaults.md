# Auto = a decided model per family — research findings

**Source:** artificialanalysis.ai/leaderboards/models, table parsed from raw HTML
(270 rows, 17 columns), fetched 2026-09-24. Not a summariser's reading — the
`<table>` was parsed directly, because four WebFetch passes over one cached page
can repeat the same wrong number four times.

**Use case being optimised:** the background calls only — Auto Answer judge,
query rewrite, browser-metadata classification. Short JSON output (~60 tokens),
called on every consult, inside a 1200 ms rung-0 sub-deadline.
Score used: `est = TTFT + 60/speed`. Intelligence needs a floor, not a maximum.
Price breaks ties only.

## Finding 1 — AA's headline latency is the REASONING row

AA lists `(Reasoning)` and `(Non-reasoning)` as separate rows (321 mentions).
The difference is not marginal:

| Model | TTFT |
|---|---|
| Claude 4.5 Haiku (reasoning row) | 21.60 s |
| Claude 4.5 Haiku (Non-reasoning) | **0.63 s** |
| GPT-6 Luna (low) | 1.79 s |
| GPT-6 Luna (Non-reasoning) | **0.75 s** |

A row only describes our call when its effort setting matches what the app
sends. The app sends `DEEPSEEK_NO_THINKING`, `openaiReasoningParam()`, and no
thinking parameter on Claude.

## Finding 2 — AA has no usable Gemini row for this workload

Only three Gemini rows exist, all slow: 3.5 Flash-Lite 8.02 s, 3.8 Flash (high)
14.26 s, 3.1 Pro Preview 30.34 s. AA's own Latency summary names "Gemini 2.5
Flash-Lite (Non-reasoning)" among the lowest-latency models — and that row is
NOT in the table. So AA cannot rank Gemini for us, and its 8.02 s contradicts
this app's own measurement of flash-lite at 750–1200 ms. Where they conflict,
our measurement wins: it was taken against our prompt, with thinking off.

## Finding 3 — the catalogues are on different versions

Only gpt-oss maps cleanly between AA and this app.

| AA row | App catalogue id | Same model? |
|---|---|---|
| gpt-oss-20b / 120b | `openai/gpt-oss-20b` / `-120b` | yes |
| Claude 4.5 Haiku | `claude-haiku-4-5` | yes |
| GPT-6 Luna | `gpt-5.6-luna` | **unverified** — different naming scheme |
| Gemini 3.5 Flash-Lite | `gemini-3.1-flash-lite` | **no** — different version |
| DeepSeek V4.1 Flash | `deepseek-v4-flash` | **no** — V4.1 vs v4 |

## Proposed table (per family, this version of the app)

| Family | Pick | Evidence | Confidence |
|---|---|---|---|
| Groq | `openai/gpt-oss-120b` | AA: est 1.20 s, TTFT 0.87, int 12, $0.11. Exact id match. 20b is 0.09 s faster but int 9. | **high** |
| Claude | `claude-haiku-4-5` | AA Non-reasoning: est 1.31 s, TTFT 0.63, int 15. Best Anthropic by a wide margin. | **high** |
| Gemini | `gemini-3.1-flash-lite` (unchanged) | AA unusable (Finding 2). Our own measurement 750–1200 ms; already the ladder's first rung. | medium |
| DeepSeek | `deepseek-v4-flash` | AA's nearest row est 1.23 s int 39, but it is `(max)` effort and a different version. Flash-vs-pro is the only real choice and flash is right. | medium |
| OpenAI | `gpt-5.5` (unchanged) | AA's best is GPT-6 Luna Non-reasoning (est 1.22 s, int 18, $0.01) → `gpt-5.6-luna`, but the mapping is unverified AND `isKnownFastModel('gpt-5.6-luna')` currently warns. | **low** |
| Codex CLI | none — keep ladder | OAuth CLI, fixed models, and it rejects several ids live. Any codex command rotates auth.json, so do not probe it. |  |
| Natively | none — keep ladder | server-side routing, no client model choice. |  |
| Gateways | blocked | `callFastModel` refuses all five; needs per-gateway clients + prefix stripping first. |  |

## Open decisions (not mine to make)

1. **Auto's meaning changes.** Today unset = "behave exactly as today". A table
   makes Auto pick a model. That is a deliberate break of the spec's core
   guarantee and needs to be recorded.
2. **One table, not two.** The judge ladder already hardcodes
   `OPENAI_JUDGE_MODEL = 'gpt-5.5'` and flash-lite-first. The table must REPLACE
   those constants; otherwise rung 0 and the ladder call the same family twice.
3. **Scope.** On a gateway-only profile (`fluxion/*`, `ninerouter/*`, `natively`)
   this table changes nothing. Gateway dispatch is the prerequisite for this
   feature to do anything for such a user.
4. **The 1200 ms rung-0 deadline.** Best est in the whole table is 0.95 s and
   most good picks are 1.1–1.3 s. Real-world variance means 1200 ms will often
   lose. Either raise it (~1800 ms) or accept frequent fall-through.


---

# Revision 2 — intelligence floor >= 20, recency bar, and "fastest configured"

User constraints added 2026-09-24: Auto must pick the FASTEST model across all
families the user has keys for (not just the active family); and a pick must be
the latest offering, or under ~4 months old, or score above ~20 intelligence.

## The floor disqualifies both earlier "high confidence" picks

| Earlier pick | Intelligence | Verdict |
|---|---|---|
| `openai/gpt-oss-120b` | 12 | **rejected** |
| `claude-haiku-4-5` (Non-reasoning) | 15 | **rejected** |

## Exact app-id -> AA row mapping (int >= 20 only)

| App id | AA row | Int | est | $/task | Verdict |
|---|---|---|---|---|---|
| `deepseek-v4-flash` | DeepSeek V4.1 Flash (max) | 39 | **1.23 s** | 0.27 | **PICK** — fastest qualifying anywhere; our no-thinking call should beat this row |
| `gpt-5.5` | GPT-5.5 Instant (June 2026) | 26 | **1.53 s** | 0.69 | **PICK** — 3 months old; already the ladder's OPENAI_JUDGE_MODEL, so no second table |
| `gpt-5.6-terra` | GPT-5.6 Terra (Non-reasoning) | 21 | 1.69 s | 0.14 | runner-up: 5x cheaper, 0.16 s slower, 5 points dumber |
| `gpt-5.6-luna` | *no AA row* | — | — | — | cannot verify; also fails our own `isKnownFastModel` |
| `claude-haiku-4-5` | Claude 4.5 Haiku (Non-reasoning) | 15 | 1.31 s | n/a | fails the floor |
| `claude-sonnet-4-6` | *no AA row* | — | — | — | unrated |
| `openai/gpt-oss-20b` / `-120b` | gpt-oss | 9 / 12 | 1.11 / 1.20 s | 0.01 | fail the floor |
| `qwen/qwen3.8-27b` | Qwen3.8 27B | 20 | 5.05 s | 2.49 | meets floor, 4x over budget |
| `gemini-3.1-flash-lite` | *no AA row* | — | — | — | unrated; see below |
| `gemini-3.8-flash` | (low) int 33 / (high) int 41 | 33 | no latency data / 14.47 s | | (low) has no latency row |

## Result: only two families have a qualifying pick

- **DeepSeek** -> `deepseek-v4-flash`
- **OpenAI** -> `gpt-5.5`
- **Claude** -> none. Haiku is fast but int 15; Sonnet 5 (int 23, 2.16 s) is not
  in the direct catalogue, only behind gateways.
- **Groq** -> none. Everything fast is int 9-12; the only model clearing 20 is
  4x over the latency budget.
- **Gemini** -> unresolved. AA has no row for `gemini-3.1-flash-lite`, so it is
  unrated against the floor. It also fails the RECENCY bar: `gemini-3.8-flash`
  is the newer offering, and 3.1-flash-lite's age is unknown. But our own
  measurement (750-1200 ms) makes it the fastest thing we have, and it is
  already the ladder's first rung.

## Auto with multiple keys — the ordering rule

Auto filters this ordered list to the families the user actually has keys for,
then takes the first. Latency is the only ordering key; the floor is a filter
applied BEFORE ordering, not a weight.

1. `gemini-3.1-flash-lite` — 0.75-1.2 s (our measurement; unrated by AA)
2. `deepseek-v4-flash` — 1.23 s, int 39
3. `gpt-5.5` — 1.53 s, int 26

No key for any of these -> fall through to the measured ladder, i.e. today's
behaviour.

## What this means

Two of five families have a defensible pick. Raising the bar to int >= 20 is
what removed Groq and Claude, and that is the correct outcome rather than a
gap to paper over: a judge running at int 9 is a worse judge.

---

# Revision 3 — the static table is abandoned. Measured live, 2026-09-24.

A real non-streaming judge call (short transcript, `{"is_ask":bool}` out,
thinking off, median of 3) against this repo's own `.env` keys:

| Model | Median | Runs | Verdict |
|---|---|---|---|
| `deepseek-chat` | **858 ms** | 2205 / 858 / 783 | fastest — AND NOT IN OUR PICKER |
| `gemini-3.1-flash-lite` | **1012 ms** | 1932 / 1012 / 785 | AA said 8.02 s |
| `deepseek-v4-flash` | 1540 ms | 1540 / 1565 / 1465 | my revision-2 top pick, 680 ms SLOWER than deepseek-chat |
| `gemini-3.8-flash` | 7135 ms | 1892 / 7135 / 12431 | unusable, and wildly variable |
| `gpt-5.5`, `gpt-5.6-terra` | — | 429 no credits | untestable here |

## Why the static table is dead

1. **AA measures a different workload.** Its Gemini figure was 8x our measured
   value. Its rows include reasoning tokens and a large task; ours is a 60-token
   verdict with thinking off.
2. **The best model was not in our catalogue.** `deepseek-chat` beat every
   curated pick. A hand-maintained table cannot find what it does not list.
3. **First-run variance is large** (2205 -> 783 ms). Any measurement must take a
   median, never one sample - cold connections dominate the first call.
4. Model retirement has burned this repo before (Groq killed every Llama id).

## The design that replaces it

On API-key entry, and when a provider's model list changes:
  1. list the provider's current models
  2. shortlist plausible background candidates
  3. run the SAME synthetic judge call against each, timed, median of N
  4. keep the fastest that returns valid JSON; persist it with a timestamp
  5. at runtime, a failure falls back to the last known-good model, then the ladder

This self-corrects when a provider ships or retires a model, and it measures OUR
call rather than someone else's benchmark.

## Open questions for this design

- **It spends the user's credits.** N models x M runs on their key, unprompted
  on key entry. Needs disclosure, a cap, and probably a "re-test" button rather
  than silent periodic runs.
- **The probe prompt must be synthetic.** Never a real transcript - that would
  send meeting content to a provider purely to benchmark it.
- **Model-list endpoints differ.** OpenAI-shaped providers expose GET /models;
  Gemini has ListModels; Anthropic has no equivalent - needs a curated shortlist.
- **Shortlisting matters.** Testing every model on a 400-model gateway is not
  viable; needs a name heuristic plus a hard cap.
