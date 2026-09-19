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
| `run-profile.mjs` | PROFILE path: real `createProfileRetrievalPort` → orchestrator → packer, résumé + JD as profile documents. `--plain`, `--mode`. | node |
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
| profile · markdown (% of 108) | 32 / 29 / 32 / 31 % | 86 / 85 / 85 / 85 % |
| profile · plain text (% of 108) | not measured | 84 / 83 / 84 / 84 % |

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

Natively leg: 60/60 queries hybrid, 60/60 reranked, 0 rerank timeouts, p50 2.0 s / p95 3.0 s.
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
6. Chunker v3 (**re-indexes every file once**): plain-text heading detection; CRLF/CR normalised at
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
9. Spoken identifiers: "the forty-four seventy-one outage" → 4471; a number word is never the
   head ("i n c forty 471" corruption); "X and seventy one Y" keeps its "and".

Tests added: `RetrievalScaleLexical`, `CorpusArbitration`, `ProfileDocumentReachability`,
`MultiFileEvidenceCapacity`, `PlainTextHeadings`, `EmbeddingProbeReasonLogged`,
`E2eLocalTestHeader`, `SpokenIdentifierCanon`, `IngestBatchEmbedding`, `StaleIndexVectorsIgnored`,
`LocalEmbedderVectorsOutsideMeeting` (all `2026_09_19`). Full run: 10,961 pass / 0 fail / 56 skipped / 1 todo (the todo pins a known limit: anchors are a bag
of words, so "pod 10" and "10 engineers … pod 15" tie).

## Running the natively stack without production

`live.mjs --local-api <port>` points the app at a locally run natively-api using its local-test
authentication (no production database, no billing). The server-side setup lives with the API
repository, which is private; the desktop side needs only `NATIVELY_E2E=1` and the token file the
driver reads from its work directory. The app sends the local-test header to the natively API URL
only, never to a third-party provider.

## Blocked / needs the owner

- The hosted API was unavailable for part of the campaign; the natively leg was run against a locally
  started server instead (see above).
- `PI-VECTOR-ARM-DESIGN.md` — three questions before the profile path gets a semantic arm.
- The local-embedding lexical-only rule (`NATIVELY_KEYLESS_LEXICAL_MANUAL_RETRIEVAL`): offline it
  costs key-less users ~11 of 162 at 70k; live +1/20 (noise). Not flipped — the rule exists for ONNX
  pressure during a live meeting with local STT, which typed turns cannot exercise.
- A low-confidence LLM query rewrite would address the paraphrase residue; it costs latency and
  tokens per turn.
- Windows: everything is platform-independent TypeScript and the CRLF fix is tested with CRLF
  input, but none of it has been executed on Windows — see `WINDOWS-CHECKLIST.md`.
