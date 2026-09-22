# Screenshot benchmark: DeepSeek V4.1 Flash vs Gemini 3.8 Flash

**Question:** is `deepseek-flash` good enough to become Natively's screenshot **primary**, with Gemini 3.8 Flash demoted to fallback?

**Answer: no — keep 3.8-flash primary.** Run three times across two days: DeepSeek 467/490 checks (95.3%) and 106/126 answers fully correct, Gemini **490/490 (100%)**, every answer clean. DeepSeek is 2.2× faster and 4.4× cheaper and it ties Gemini on the hardest tiers, but it is the only one of the two that gets anything wrong, and two of its failures are near-systematic on exactly the screens Natively's users photograph: an IDE at small zoom, and a chart read.

## How it runs

A ladder of 7 levels, **hardest first**, descending. Both models see byte-identical images and the same prompt, each called with the request shape production uses:

| | model | thinking | notes |
|---|---|---|---|
| DeepSeek | `deepseek-flash` | disabled (`thinking:{type:'disabled'}`) | `buildDeepSeekBody(..., {images})` |
| Gemini | `gemini-3.8-flash` | `thinkingLevel: 'low'` | what `thinkingConfigForModel` sends for this tier |

Images pass through `lib/imageNormalizer.js` first, exactly as `/v1/chat` does. 18 tasks, 7 levels. Screenshots are real pages captured in Chrome at 1440×900 (GitHub, Wikipedia, Hacker News, Stock Analysis, Grafana Play) plus five rendered scenes, used only where the answer must be exactly knowable — a chart with no printed values, a planted code bug, a 26-row table, a CI matrix, an 11px log.

The runner descends until DeepSeek clears a level, but by default runs **every** level, because a model can clear a hard level and trip on an easier one. That is what happens here.

| Run | Date | Runs per task | Calls per model |
|---|---|---|---|
| run1 | 2026-09-17 | 2 | 36 |
| run2 | 2026-09-18 | 3 | 54 |
| run3 | 2026-09-18 | 2 | 36 (plus a DeepSeek thinking-on arm) |

## Results (all runs, corrected scoring)

| Level | What it tests | DeepSeek run1 → run2 | Gemini |
|---|---|---|---|
| L7 | Row alignment, exact counting, 11px text | 93% → 96% | 100% |
| L6 | Two-screenshot diagnosis, exhaustive scan | 100% → 100% | 100% |
| L5 | Reason and compute from the screen | 92% → 92% | 100% |
| L4 | Precise dense extraction | 93% → 93% | 100% |
| L3 | UI state judgement | 95% → 97% | 100% |
| L2 | Plain extraction | 100% → 100% | 100% |
| L1 | Gist | 100% → 100% | 100% |
| **Combined** | 126 calls each | **467/490 (95.3%)** · 106/126 answers clean | **490/490 (100%)** · 126/126 clean |

| | DeepSeek | Gemini |
|---|---|---|
| Median latency (non-streaming) | **~975ms** (p90 ~1,250ms) | ~1,985ms (p90 ~2,800ms) |
| Cost per screenshot | **$0.00014** | $0.00061 |
| Failed or timed-out calls | 0 of 126 | 0 of 126 |

DeepSeek ties Gemini where it was expected to struggle most: it finds the planted off-by-one and writes the corrected line, diagnoses a failing test across two screenshots, lists every flagged row in a 26-row table, holds a row across five columns, and reads an 11px log line including its order id.

## Where DeepSeek loses (across all runs)

| Task | Wrong in | What it got wrong |
|---|---|---|
| `tiny_code` (GitHub at 60% zoom) | **4 of 5 runs** | "what does line 15 require" → `url`, `require('methods')`, `'nodestats'`. Truth: `node:http`. It reads the repo, branch and line count correctly off the same image, so the text is legible — it takes the wrong row, and once invented a module name. |
| `chart_read` (bar chart, no labels) | **4 of 5 runs** | "how many days are above 100" → "Four days", "Five". Truth: 3. Once it also read Saturday and Sunday as ~55 and ~72 (truth 133 and 74). Bar *values* it reads well; *counting and comparing* them it does not. |
| `glyph_counting` (24-job CI list) | 2 of 5 runs | "4 failed, 15 passed" (truth 5 and 16) — then correctly names all 5 failed jobs in the next line. |
| `dashboard_state` (Grafana) | 2 of 5 runs | "Is anyone signed in?" → "Yes, a username avatar is present". There is no avatar; there is a **Sign in** button. Third reproduction of this failure mode, counting the earlier fallback test. |
| `feed_counts` (Hacker News) | 1 of 5 runs | domain read as `crowdsrc.net`; truth `crowdsec.net`. |

Gemini: **zero** failed checks in 126 calls.

## Time to first token (streaming, added 2026-09-18)

The ladder above used non-streaming calls, so it measured total latency only. The live overlay streams, and what a user feels is the wait for the first visible character. 18 streamed calls per provider, three screenshots, short and long questions:

| | DeepSeek | Gemini 3.8 |
|---|---|---|
| TTFT p50 | **832ms** | 1985ms |
| TTFT p90 | **969ms** | 3853ms |
| TTFT worst of 18 | **1126ms** | 4990ms |
| Whole answer p50 | **2151ms** | 2666ms |

DeepSeek starts ~1.15s sooner and its tail is four times tighter. Gemini withholds the response until it has content (its headers land at 1984ms p50, essentially the same moment as its first token), then streams about 2.3x faster — so it closes most of the gap by the end: half a second apart on the whole answer, over a second apart on first paint.

## Does thinking fix DeepSeek's errors? (probe, not a shipped config)

Same ladder with `thinking:{type:'enabled'}, reasoning_effort:'low'`:

| | checks | clean answers | median | p90 | worst |
|---|---|---|---|---|---|
| DeepSeek, thinking off (shipped) | 135/140 (96.4%) | 31/36 | 939ms | 1,271ms | 1,714ms |
| **DeepSeek, thinking on** | **138/140 (98.6%)** | 34/36 | 2,236ms | 4,382ms | **21,088ms** |
| Gemini 3.8 | 140/140 (100%) | 36/36 | 1,911ms | 2,439ms | 5,340ms |

Thinking removes most of the accuracy gap — counting, chart comparison and UI state all clear, leaving only the tiny-text row miss — but it spends the entire latency advantage and then some: median slower than Gemini, and one call took 21s, which would blow through the 10s TTFT bound the streaming cascade enforces. As a way to make DeepSeek the primary, it trades the only thing DeepSeek was winning on.

### Thinking at the lowest effort (2026-09-18)

`low` **is** the floor with thinking on: DeepSeek documents `minimal` as an alias of `low`, `medium`/`xhigh` as aliases of `high`, and no thinking-token budget parameter exists. The only step below `low` is off. Measured anyway:

| Probe | thinking off | thinking low |
|---|---|---|
| Streaming TTFT p50 (8 streams each) | **969ms** | **4,542ms** |
| Streaming TTFT p90 | 1,106ms | 6,925ms |
| `glyph_counting` (4 runs) | 20/24, 2/4 clean | **24/24, 4/4 clean** |
| `chart_read` (4 runs) | 15/16, 3/4 clean | **16/16, 4/4 clean** |
| `dashboard_state` (4 runs) | 12/12 clean | 12/12 clean |
| `tiny_code` (4 runs) | 12/16, 0/4 clean | **13/16, 1/4 clean** (max 15.4s) |

Two conclusions:

1. **Thinking cannot fix the failure that matters most.** Counting and chart comparison clear completely at low effort — those were reasoning gaps. The GitHub-at-60%-zoom line misread does **not** clear (1 of 4 clean, and one call took 15.4s). It is a *seeing* gap, so no effort setting addresses it.
2. **Thinking destroys the only thing DeepSeek wins.** First visible text goes from 969ms to 4,542ms p50, because thinking tokens stream before any answer text. The speed argument for promoting DeepSeek disappears at every thinking level that helps accuracy.

(Curiosity, not a conclusion: on one trivial question `high` returned *fewer* reasoning tokens and faster answers than `low` — 65 vs 292 tokens. Two runs each; not investigated.)

## Verdict

- **Keep `gemini-3.8-flash` as the screenshot primary.** Perfect across 90 calls and two days, against a rival that misreads a small code line in 4 of 5 attempts. "My IDE is on screen, help me" is the main Natively screenshot case, usually at a small font, and a confidently wrong identifier is worse than an answer 1.2s later.
- **Keep `deepseek-flash` as the fallback** (3.8-flash → MiniMax-M3 → deepseek-flash → Pro). Fast, cheap, never failed a call, and it covers the outage mode where the Gemini pool is exhausted — which took screenshots down entirely on 2026-09-17.
- **If first-paint latency becomes the complaint**, the honest trade is: DeepSeek paints ~1.15s sooner (832ms vs 1,985ms p50) and finishes ~0.5s sooner, in exchange for roughly 1 answer in 6 containing at least one wrong detail (106/126 clean vs 126/126).
- **There is no middle setting.** Thinking at its lowest effort fixes the counting and chart errors but not the small-text misread, and pushes first paint to 4.5s — worse than Gemini, for accuracy that is still short of it.

## Caveats

- 490 checks per model over two days. Twenty-three DeepSeek failures is a small sample, but the two big ones repeat 4-of-5, which is a pattern rather than noise. Gemini's 100% means "did not miss on this set", not "cannot miss".
- The main comparison runs DeepSeek with thinking **disabled**, Natively's production setting; the thinking-on arm above is a probe on one run (36 calls), not a shipped configuration.
- TTFT was measured separately (18 streamed calls per provider) and on a different sample of screenshots than the ladder.
- Gemini was billed to the repo-root key; `natively-api`'s own Gemini key is out of prepaid credits. Same model, same request shape.
- Five of twelve screenshots are rendered rather than photographed, used where exact ground truth was required. The seven real ones carry the tasks closest to real usage.
- **Three scoring bugs were found and fixed**, all of which had inflated DeepSeek:
  1. a stale Hacker News score (the page changed between captures);
  2. an ambiguous question on a page with two tab rows;
  3. checks that were not scoped to the answer line, so a "how many?" check matched the `3.` the model used to number its own third answer — this alone credited two wrong chart answers;
  4. the fix for (3) anchored markers to line start, so an answer packed onto one line (`(1) x (2) y (3) z`) scored as misses — this one penalised DeepSeek.
  The scorer now finds answer markers anywhere and is covered by `harness/scoring.test.mjs` (7 cases, including both bugs). Every stored answer from all three runs was re-scored identically (`harness/rescore.mjs`, no new API calls). Gemini's score never moved under any fix (140→140, 210→210, 140→140), so no scoring bug ever flattered it.

## Files

| Path | Contents |
|---|---|
| `harness/tasks.mjs` | the ladder: levels, prompts, checks, ground truth |
| `harness/run.mjs` | runner (adaptive descent, both providers, scoring) |
| `harness/scoring.mjs` | shared check evaluation, incl. answer-line scoping |
| `harness/rescore.mjs` | re-score stored answers after a check fix, no API calls |
| `harness/capture.mjs`, `harness/capture-hard.mjs` | screenshot capture and scene rendering |
| `shots/` | the screenshots, visible-text ground truth, `hard-truth.json` |
| `results/*.rescored.json` | authoritative scores; `results.json` / `results-2026-09-17-run1.json` are the raw runs |

Reproduce: `node harness/capture.mjs ../shots && node harness/capture-hard.mjs ../shots && node harness/run.mjs --runs 3`
