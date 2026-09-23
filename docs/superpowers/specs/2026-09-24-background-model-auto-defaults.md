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
