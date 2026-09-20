# Retrieval-scale campaign (2026-09-19)

Question: *"Modes and Profile Intelligence are hit or miss — it says the answer isn't in the file
when it is."* These scripts measure, with the **real production modules**, whether the chunk that
holds an answer reaches the prompt, at 5k / 15k / 30k / 70k-token documents, for every stack.

Nothing here is imported by the app.

## Scripts

| script | what it does | needs |
|---|---|---|
| `gen-fixtures.mjs` | Seeded fake résumé, job description and engineering handbook at four sizes → `out/`. 10 planted facts per document (lexical / paraphrase / STT phrasings), 12 **sibling** facts (questions about the filler itself — the only kind that gets harder with size), absent-fact questions. 672 questions. | node |
| `run-offline.mjs` | MODE path: real `ModeHybridRetriever` → V3 orchestrator + mode port → packer. `--stack lexical\|local\|vector`, `--scenario single\|trio`, `--plain` (as a PDF extracts), `--rerank`, `--fullrank`, `--cap/--tokens`. | `npm run build:electron`; run with `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron` (better-sqlite3 is Electron-ABI) |
| `run-profile.mjs` | PROFILE path: real `createProfileRetrievalPort` → orchestrator → packer, résumé + JD as profile documents. `--plain`, `--mode`, `--structured none\|heuristic\|live`, `--debug-q <id>`, `--vectors` (binds the semantic arm to a real `ModeHybridRetriever` + MiniLM). | node; `--vectors` as `run-offline` |
| `gen-resume.mjs` | Realistic résumés (2k / 5k / 15k / 30k tokens) with ground truth, for measuring how complete LLM structuring is. Used by `live.mjs --structuring`. | node |
| `analyze.mjs` | Stage breakdown of a result file: NOT_ROUTED / RETRIEVER_MISS / EVIDENCE_DROP / PACK_DROP. `--list`. | node |
| `debug-query.mjs` | Full ranking for one query, with the needle's scores. | as `run-offline` |
| `live.mjs` | The REAL app + REAL providers, graded answers. **Billed.** Isolated profile copy (read-only sqlite backup), debug-log protection, raw CDP. `--stack local`, `--env K=V`, `--mix para`, `--natively-key-from-env NAME` (refuses to launch unless the API reports ready), `--local-api PORT`, `--profile`. macOS paths only. | built app |

No LLM is involved except in `live.mjs`.

## Results (answer chunk reaches the prompt, of 162 questions, at 5k / 15k / 30k / 70k)

| path · documents · stack | before | after |
|---|---|---|
| mode · markdown · lexical, one file | 150 / 148 / 148 / 142 | 152 / 151 / 149 / 149 |
| mode · markdown · vectors, one file | 153 / 146 / 150 / 150 | 159 / 159 / 159 / 160 |
| mode · markdown · lexical, three files | 133 / 132 / 130 / 125 | 146 / 146 / 145 / 145 |
| mode · markdown · vectors, three files | 150 / 141 / 142 / 140 | 159 / 157 / 156 / 156 |
| mode · **plain text** · lexical, one file | 143 / 130 / 120 / 120 | 147 / 146 / 146 / 146 |
| mode · **plain text** · vectors, one file | 142 / 132 / 123 / 127 | 152 / 151 / 150 / 151 |
| profile · markdown, BM25 only (% of 108) | 32 / 29 / 32 / 31 % | 90 / 90 / 89 / 89 % |
| profile · plain text, BM25 only (% of 108) | not measured | 90 / 89 / 90 / 90 % |
| profile · markdown, **+ semantic arm** | — | 95 / 95 / 94 / 94 % |
| profile · plain text, **+ semantic arm** | — | 94 / 94 / 94 / 94 % |

"Vectors" is the bundled MiniLM — a lower bound for hosted embedders. Plain text is what every PDF
and DOCX becomes; it was the hidden size effect (the committed chunker got *worse* as files grew).

Live (real app, real LLM, plain-text documents; 150 billed turns in total — the approved bound):

| stack | question mix | result |
|---|---|---|
| **natively** (voyage-4 2048d + rerank-2.5-lite), 15k | default | **18/18**, absent facts 2/2 declined honestly |
| **natively**, 70k | default | **18/18**, absent facts 2/2 declined honestly |
| **natively**, 70k | paraphrase-heavy | **19/20** — the miss was a spoken incident number, since fixed |
| local MiniLM, 70k, lexical-only rule ON (default) | paraphrase-heavy | 16/20, 3 false refusals |
| local MiniLM, 70k, rule OFF | paraphrase-heavy | 17/20, 3 false refusals |
| **natively**, PROFILE path: real résumé + JD ingest at 15k each | 12 résumé + 12 JD | **20/24** — the 4 misses are paraphrases, answered WRONG (an invented salary, "I wasn't at Oakhaven"), not refused |

After the semantic arm, the query rewrite, the anchor boost and the ingest breaker (2026-09-20, same
15k résumé + JD, same 24 questions, 72 more billed turns — 222 in total):

| stack | result |
|---|---|
| **natively** (voyage-4 2048d + rerank-2.5-lite) via the local API | **24/24** correct. Both "promoted to Staff Engineer" questions, the salary, equity and years-of-experience paraphrases that were wrong or refused before all answer from the document. Answer latency p50 1.8 s / p95 3.7 s. The rewrite pass ran on 4 retrieval attempts. |
| own chat provider + **bundled MiniLM** embedder (no natively service — see note) | 22/24. Fixed the same four paraphrases; the "promoted to Staff Engineer" pair was WRONG (the line did not reach the prompt). That run predates the anchor boost, and the pair passes offline with it; not re-run live. |

Note: the MiniLM row was not planned. The local API had exited (its database watchdog) and nothing in
the driver noticed; `live.mjs` now refuses to start a `--local-api` run without a healthy server. The
grader also scored "seven engineers" WRONG against a gold "7" in both runs — fixed; the numbers above
are after reading those answers.

Natively leg (09-19): 60/60 queries hybrid, 60/60 reranked, 0 rerank timeouts, p50 2.0 s / p95 3.0 s.
It ran against a **locally started natively-api** under `NATIVELY_LOCAL_TEST_AUTH` (see below) —
the hosted API was unavailable that day, and is not needed for any of this.

## What changed in the app (not committed)

1. Lexical arm: idf-weighted overlap (same 0–1 scale; exact legacy score below 12 chunks), short
   digit-bearing tokens ("13", "v2") on the idf path only, anchor boost for chunks holding the
   question's distinctive terms (in ranking, admission and the reported score), thin-result top-up
   on the lexical branch.
2. Routing: **corpus arbitration** — the retrieval port tells the orchestrator whether a chunk holds
   the question's terms (`probeAnchors` / `probeAnchorSources`); ambiguous questions retrieve when
   documents are attached.
3. Reranking: rank fusion for the **built-in** cross-encoder only (it demoted exact matches on long
   documents). Hosted rerankers untouched — not measurable offline.
4. Profile path: a document lookup on a profile-only turn looks in the résumé/JD
   (`profileOnlyDocuments`, set by the engine bridge); raw text is chunked with headings.
5. Multi-file turns (≥2 mode files): floor of 8 evidence items / 2400 tokens.
6. Chunker v4 (**re-indexes every file once**; v3 was never released): plain-text heading detection, Title Case and — by structure — sentence case; CRLF/CR normalised at
   every chunking entry point (a Windows-authored markdown file had no headings at all).
7. Every embedding provider logs *why* its availability probe failed (key-shaped tokens masked).
8. The embedding and rerank clients send the local-test header (same `NATIVELY_E2E` gate as chat,
   natively API only), so a locally run server can serve the whole retrieval stack.
10. Profile port: a fired intent rule's vocabulary (salary|compensation|pay|…) now boosts RAW chunks
    in that class when the class is discriminative — live, "How much does the position pay?" had
    been answered with the app's own salary *estimate* instead of the JD's stated range.
11. Profile ingest (premium submodule + `main.ts`): nodes are embedded one *batch* per request.
    Ten concurrent single-text requests per batch drew 429s and silently demoted all 238 nodes of
    a long résumé to the bundled model's space.
12. A stale index is never used: stored vectors are keyed by chunk index, so after a chunker bump
    chunk *i* was scored with the OLD chunk *i*'s vector, silently. Such files are now ignored for
    the turn and re-indexed in the background; prewarm re-indexes one mode at a time on activation.
13. The bundled embedder's vectors are queried when no meeting is running (lexical-only is kept
    during meetings, where the memory pressure that rule guards against actually occurs).
14. Profile Intelligence has a **semantic arm** (`PI-VECTOR-ARM-DESIGN.md`): résumé/JD raw text is
    indexed through the mode retriever (at ingest and lazily) and joins BM25 as a rank-matched
    interleave. Replacing BM25 outright was built first and failed the gate on plain-text JDs.
    A 5-second query-embedding memo stops a turn with mode files embedding the same question twice.
15. Employment-phrased questions ("Who would be my manager?") plan the JD when the question's terms
    are not in the résumé; the `USER_EMPLOYMENT` prohibition itself is unchanged.
16. The derived salary estimate says it is an estimate and that a figure stated in the JD wins.
17. **Low-confidence query rewrite** (`retrieval/llm-query-rewrite.ts`): when the first retrieval leaves
    a claim that needs the user's own documents with NO supporting evidence, the user's fast model is
    asked once — 1.5 s hard cap — to restate the question in document vocabulary ("Who would be my
    manager?" → "reports to, reporting line, director"), and retrieval runs again. The rewrite is a
    ranking query only: source planning, authority and admission still read the user's question.
    Timeout / error / no new words ⇒ the turn is exactly the first pass. Offline the trigger covers
    36 of 432 profile turns (8%) and 14 of the 22 misses left after the semantic arm. Kill switch:
    `NATIVELY_RETRIEVAL_LOW_CONFIDENCE_QUERY_REWRITE=0`.
9. Spoken identifiers: "the forty-four seventy-one outage" → 4471; a number word is never the
   head ("i n c forty 471" corruption); "X and seventy one Y" keeps its "and".

Tests added: `RetrievalScaleLexical`, `CorpusArbitration`, `ProfileDocumentReachability`,
`MultiFileEvidenceCapacity`, `PlainTextHeadings`, `EmbeddingProbeReasonLogged`,
`E2eLocalTestHeader`, `SpokenIdentifierCanon`, `IngestBatchEmbedding`, `StaleIndexVectorsIgnored`,
`LocalEmbedderVectorsOutsideMeeting` (all `2026_09_19`). Full run: 10,961 pass / 0 fail / 56 skipped / 1 todo (the todo pins a known limit: anchors are a bag
of words, so "pod 10" and "10 engineers … pod 15" tie).

## Sentence-case headings were invisible in extracted text (2026-09-20)

Chunker v3's plain-text heading detection accepted Title Case and ALL CAPS only. 7 of a job
description's 80 headings and 2 of a résumé's 87 were never detected — "Minimum qualifications",
"Location and working pattern", "Reporting line", "Interview process", "Career milestones", "Outside
work" — all sentence case, all sections holding a fact people ask about, each glued to the tail of the
1,000-character entry before it. The vector stack then missed "How many years of experience does the
role require?", a purely lexical question, at every size. v4 decides by structure instead of case: the
line passes every other title test, starts with a capital, and a real body follows (a bullet, a table,
or prose). After: every heading of the résumé and JD fixtures recovered at 5k and 70k, no false ones.

| plain text (as a PDF extracts), of 162, 5k/15k/30k/70k | before | after |
|---|---|---|
| mode path · vectors | 152 / 151 / 150 / 151 | **159 / 159 / 157 / 158** (markdown: 159 / 159 / 159 / 160) |
| mode path · lexical | 147 / 146 / 146 / 146 | 149 / 149 / 148 / 148 |
| profile path · + semantic arm (% of 108) | 94 / 94 / 94 / 94 | 95 / 95 / 95 / 94 |
| profile path · real structured data, 15k · + semantic arm | 91 | 94 |
| profile path · BM25 only | 90 / 90 / 90 / 90 | 90 / 89 / 89 / 89 |

The last row is the cost: "Can I work from home and how often must I come in?" shares no word with
"Hybrid: two days per week in the Rotterdam office…". It used to be found only because that line was
buried in a large chunk full of common words; in its own section BM25 has nothing to match. The
vector stack finds it. Chunker version 3 → 4 (v3 never shipped; users still re-index once).

## Better structuring made retrieval worse (2026-09-20)

Every profile number above was measured with `--structured none` or the heuristic extractor. With what
the structuring LLM **really** produced for the 15k fixtures (`--structured live`, exported from a live
run's isolated profile), BM25-only résumé retrieval was **69%** — lexical 50%, sibling facts 58% — where
it is 100% with no structured data at all. "How many engineers did you work with on Project
Cinder-115?" fires the project intent, and all six evidence slots go to structured sections about four
*other* projects while the raw chunk that names Cinder-115 is cut. An intent boost ranks a section by
its type, blind to whether it holds what the question names.

The profile port now has the anchor boost the mode path got on 09-19, with three conditions that each
came from a measured regression, not from design: coverage ≥ 60% of the anchor weight (an ungated
+0.004 nudge pushed a bullet past the skills inventory that is admitted at a fixed 0.600, and "Do I have
Kubernetes experience?" went FULL → PARTIAL); anchors drawn from content words only ("how" was the top
anchor — it is rarer in a résumé than the project's name); at least two anchors, earned by at most 10%
of the chunks ("role" + "report" matched a fifth of the corpus and buried the reporting line).

| 15k, plain text, real structured data | BM25 only | + semantic arm |
|---|---|---|
| before | 77% (lex 75, sibling 79) | 90% |
| after | 86% (lex 100, sibling 100) | 91% |

All 32 cells of the none/heuristic gate are at or above their no-boost value except one (heuristic,
BM25-only, markdown, 5k: 90 → 89, one paraphrase that had held the sixth slot by accident).

## Structuring completeness on realistic résumés (live, 2026-09-20)

`gen-resume.mjs` writes plain-text résumés with exact ground truth; `live.mjs --structuring` ingests
each through the real pipeline and compares what the structuring LLM kept.

| résumé | roles | bullets | projects | skills / edu / certs | structured after |
|---|---|---|---|---|---|
| 2k tokens | 5/5 | 30/30 | 3/3 | 24/24 · 2/2 · 3/3 | 125 s |
| 5k | 14/14 | 84/84 | 6/6 | all | 290 s |
| 15k | 45/45 | 270/270 | 12/12 | all | 893 s |
| 30k (92 roles) | not reached — still queued behind the 15k résumé's story generation when the 15-minute poll ended | | | | — |

**Completeness is not the problem: nothing was dropped at any size that finished.** An earlier note in
this campaign ("structuring kept 5 of ~120 entries") came from a 120-role synthetic fixture, not from
anything résumé-shaped, and does not reproduce.

**Time was the problem, and most of it was one defect.** Every structured call tried the profile's own
OpenAI key first; it answered 429 on 140 of 141 calls, and each failure cost ~9.7 s of retry backoff
before Gemini flash-lite answered in ~4.4 s: 1,334 s waiting on a rung that never succeeded, against
654 s of useful work. The Gemini rungs had a 429 circuit breaker; the OpenAI and Claude rungs did not.
They now do (`structured:openai` / `structured:claude`, structured ladder only — chat is unchanged).
The times above are BEFORE that fix and include the queueing behind the previous résumé's stories.

Proposal, not built: nothing for completeness. For latency, re-measure after the breaker; if a long
résumé is still slow the next lever is the per-role story generation, which is awaited inside the
ingest chain on purpose (`IngestConcurrencyStarLoss2026_08_02`) and should not be made concurrent
without that test's author.

## Running the natively stack without production

`live.mjs --local-api <port>` points the app at a locally run natively-api using its local-test
authentication (no production database, no billing). The server-side setup lives with the API
repository, which is private; the desktop side needs only `NATIVELY_E2E=1` and the token file the
driver reads from its work directory. The app sends the local-test header to the natively API URL
only, never to a third-party provider.

## Blocked / needs the owner

- The hosted API was unavailable for part of the campaign; the natively leg was run against a locally
  started server instead (see above).
- The local-embedding lexical-only rule (`NATIVELY_KEYLESS_LEXICAL_MANUAL_RETRIEVAL`): offline it
  costs key-less users ~11 of 162 at 70k; live +1/20 (noise). Not flipped — the rule exists for ONNX
  pressure during a live meeting with local STT, which typed turns cannot exercise.
- Windows: everything is platform-independent TypeScript and the CRLF fix is tested with CRLF
  input, but none of it has been executed on Windows — see `WINDOWS-CHECKLIST.md`.
