# Profile Intelligence: a semantic arm for the V3 profile path

Status: **built 2026-09-20** with the owner's answers to the three questions at the end (index at
ingest *and* lazily; yes to the query-embedding memo; structured sections stay on BM25).
One thing below turned out wrong and the measurement caught it — see "What the measurement changed".

## The gap

`profile-retrieval-port.ts` ranks the résumé and job description with BM25 only. There is no
vector arm for any user — natively-api, hosted or local. After this campaign's fixes the chunk
that answers reaches the prompt for ~85% of questions (`run-profile.mjs`), and almost all of the
residue is paraphrase with no shared vocabulary:

| question | fact in the document |
|---|---|
| "How much does the position pay?" | "Base salary range for this role is $214,000–$262,000" |
| "What did you research for your master's degree?" | "M.Sc. … Thesis: Causal consistency in geo-replicated ledgers" |
| "Do you do any community or volunteer work?" | "Teaches weekend robotics to teenagers at Makerspace Alfama" |

On the mode path the same documents score 159–160 of 162 (98%) with vectors vs 149–152 (92–94%)
lexical-only (`run-offline.mjs`, one file), and the difference is almost entirely the paraphrase
column. That is the size of gain to expect here — on paraphrased questions, little on lexical ones.
It is an expectation from the neighbouring path, not a measurement of this one.

## Proposal: reuse the mode retriever's index — do not build a second vector stack

`ModeHybridRetriever` already owns everything a vector arm needs, and this campaign hardened it:
chunk → batch-embed with retries → persist vectors with their embedding-space key →
partial-index detection → re-index on space/chunker change → idf-weighted lexical + anchor boost +
cosine → rerank (with rank fusion for the built-in model) → token-budget selection.

1. **Index.** Treat each profile document's raw text as a pseudo reference file:
   `id = profile:<kind>:<documentHash>`, `content = rawText`. Call the existing `indexFile()`.
   - when: fire-and-forget at the end of `KnowledgeOrchestrator` ingest, and lazily on the first
     profile turn that finds the pseudo-file un-indexed (covers documents ingested before this ships);
   - the id carries the content hash, so a re-upload is a new id; the old rows are removed by the
     existing `removeFileIndex()` when the document is replaced or deleted.
2. **Retrieve.** `ProfilePortInput` gains one injected function (the port stays free of Electron/DB
   imports, as its header requires):
   `rawRetriever?: (query, { topK, tokenBudget }) => Promise<Array<{ sourceId, text, chunkIndex, score, … }>>`
   The call sites bind it to `modesManager.retrieveHybridRaw(profilePseudoMode, pseudoFiles, …)`.
   When present, the port uses its result for the **raw-document** chunks instead of BM25 over
   `semanticChunks(rawText)`; structured sections, cards and derived facts keep BM25 + intent boosts
   exactly as today. Absent (tests, or the retriever not ready) ⇒ today's behaviour, unchanged.
3. **Merge.** Both lists are already scored in [0, 1]; the port's existing sort and planned-type
   filter apply. The raw chunks keep `boostKey: 'raw_document'` and `completeInventory: false`.

## What it costs

- **Embedding:** one pass per document version. A 15k-token résumé is ~90 chunks ≈ 3 natively
  batches; a typical 1–2 page résumé is 5–10 chunks. Negligible next to the structuring LLM call.
- **Latency:** one query embed per profile turn. A turn that also has mode files attached would
  embed the same query twice (the mode port and the profile port are separate by design), and
  `EmbeddingPipeline.getEmbeddingForQuery` has **no cache today**. Proposal: a tiny memo keyed by
  `(space, query text)` with a few-second TTL inside the pipeline — also saves the second embed on
  the mode path's targeted retry.
- **Storage:** rows in the existing `mode_reference_chunks` table; no migration.

## What it does not fix

- **Local-embedding users** still get lexical-only retrieval on every V3 turn
  (`shouldUseLexicalForLocalManualQuery`), so they gain nothing until that rule is revisited — the
  live stability check for that is still owed.
- **Employment-claim questions** ("Who would be my manager?") are classified `USER_EMPLOYMENT`,
  which *prohibits* the job description. That is source-authority policy, not retrieval.
- **Ingest-side loss** (structuring timeouts, the 200k-character gate) is untouched. The raw text is
  what gets embedded, so this arm is independent of structuring quality — which is the point.

## Risks

1. The profile pseudo-files must never be listed as mode attachments in the UI or counted in
   `attachedSourceCount` (that would switch off `profileOnlyDocuments` and turn on the multi-file
   capacity floor). They live only inside the injected function's closure.
2. Provenance: chunks returned through the mode retriever carry `provenance: 'MODE_REFERENCE_FILE'`
   from the *mode* port's mapper — the profile port must map them itself and stamp the profile
   provenance it uses today, or the identity-pool narrowing would admit them as mode attachments.
3. Embedding-space flips mid-session are already handled by the retriever (cross-space vectors are
   ignored for the turn and the file re-indexes in the background); the profile path inherits that,
   including its failure mode — see the 2026-09-19 finding that a selected provider being down
   leaves new uploads `lexical_only` for the session.

## Measuring it

`run-profile.mjs` gains `--vectors` (bind `rawRetriever` to a real `ModeHybridRetriever` with the
bundled MiniLM, as `run-offline.mjs --stack vector` does). Ship only if the paraphrase column rises
and no lexical/sibling cell falls, at all four sizes, markdown and `--plain`.

## What the measurement changed

Step 2 of the proposal says the semantic result is used *instead of* BM25 for the raw-document
chunks. Built that way, it failed the ship gate above: on plain-text job descriptions the lexical
column fell from 100% to 91–95% and the JD rows from ~87% to 81–85%. When the hybrid ranker missed a
lexically obvious chunk, BM25's hit had been thrown away with the rest.

| profile path, % of 108 in the prompt, 5k / 15k / 30k / 70k | markdown | plain text |
|---|---|---|
| BM25 only (before) | 90 / 90 / 89 / 89 | 90 / 89 / 90 / 90 |
| semantic **replaces** BM25 raw chunks | 95 / 95 / 94 / 95 | 91 / 90 / 89 / 89 — JD lexical 91–95% ✗ |
| **union**, sorted by score | 92 / 92 / 91 / 92 | 91 / 92 / 93 / 93 |
| union, **rank-matched interleave** (shipped) | 95 / 95 / 94 / 94 | 94 / 94 / 94 / 94 |

Shipped: the arms are a union, the same text is one row, and the semantic arm's rank-*r* chunk is
lifted to at least the BM25 raw arm's rank-*r* score (semantic first on an exact tie). A plain
score-sorted union wastes most of the gain because the scales differ — BM25's squashed score for any
word-sharing chunk sits far above a correct paraphrase hit's hybrid score. With the interleave the
lexical and sibling columns are 100% in all 16 cells and no cell is below BM25-only.

MiniLM, reranker off — a lower bound for hosted embedders, and not a live measurement.

## Open questions for the owner (answered 2026-09-19 — kept for the record)

1. Index at ingest (pays the embed even if the user never asks a profile question) **and** lazily —
   or lazily only?
2. Is a few-second query-embedding memo acceptable? (It changes nothing observable except latency
   and one billed embed per duplicate query.)
3. Should the structured sections get vectors too? Proposal: **no** for now — they are short, carry
   intent boosts that already rank them, and the raw text covers the same facts.
