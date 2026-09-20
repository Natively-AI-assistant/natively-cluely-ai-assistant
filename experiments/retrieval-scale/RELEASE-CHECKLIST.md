# Release checklist — `feat/retrieval-scale` (PR #581)

For the owner to run by hand before marking the PR ready. Everything here was last verified by automated
tests and by driven live runs on macOS; **none of it has been run on Windows**, and the items marked
**(not re-run live)** changed after the last live run.

## 1. What changed for users, in one paragraph

Reference files (especially **PDF and DOCX**) are now chunked on their real headings instead of anonymous
~1,900-character windows; Profile Intelligence (résumé + job description) gained a semantic search arm;
questions phrased as speech ("whats the timeout on ledgerline store two") reach the documents; a rate-
limited provider key no longer slows résumé ingest; and, for users **without** hosted embeddings only, a
low-confidence turn gets one bounded query rewrite.

**Every reference file re-indexes once** after the update (chunker v2 → v4), lazily, per mode, the first
time a question touches it. Until a file's re-index finishes, that file is searched lexically for the turn.

## 2. macOS — try these

| # | Do this | Expect |
|---|---|---|
| 1 | Open a mode that already has reference files; ask a question about one | An answer on the first try; in the log, "indexed under an older chunker/content hash … re-indexing" once per file, then nothing |
| 2 | Upload a **real PDF** handbook/spec (10+ pages) to a mode; ask for a fact that sits under a sentence-case heading ("Minimum qualifications", "Data retention") | The fact, not "I couldn't find that" |
| 3 | Upload a **real DOCX** with a table and a config/code block | Sensible answers about table rows; no flood of tiny chunks (Modes → file shows a chunk count in the tens/hundreds, not thousands) |
| 4 | Profile Intelligence: upload a real résumé **PDF** and a JD; ask a paraphrase ("how much does it pay", "who would I report to", "what did you study for your master's") | Answers from the documents; the salary comes from the JD's stated figure, not the app's estimate |
| 5 | Ask "Have I ever been on call?" with a résumé that does not say so | It says the résumé does not cover it — it must **not** answer from the job description |
| 6 | Delete the résumé in Profile Intelligence, then re-upload a different one | Old résumé facts never resurface |
| 7 | In a **live meeting**, have someone ask spoken-style questions about an attached file | Answers in ~3–4 s with hosted embeddings |
| 8 | Remove/disable the embedding key (or go offline for embeddings), repeat #7 with paraphrased questions **(not re-run live after the last merge change)** | Most still answered; some turns take ~1 s longer (the rewrite). Log line per firing: `[V3] query rewrite: OK in … ms, +N evidence, answerability X -> Y` |
| 9 | Use a provider key that is rate-limited (or an exhausted OpenAI key) and upload a résumé | Ingest completes in well under a minute; log shows `structured:openai circuit OPEN … skipping to fallback` once, not a 10 s stall per call |

## 3. Windows — same list, plus

- A reference file saved with **CRLF** line endings (any text/markdown file authored in Notepad): headings are detected (ask about a section by name).
- The bundled local embedder outside a meeting: typed questions use vectors (log: hybrid retrieval, not "lexical-only").
- `WINDOWS-CHECKLIST.md` in this folder has the longer list.

## 4. Switches (environment variables)

| Variable | Effect |
|---|---|
| `NATIVELY_RETRIEVAL_LOW_CONFIDENCE_QUERY_REWRITE=0` | Query rewrite off everywhere |
| `NATIVELY_RETRIEVAL_QUERY_REWRITE_SCOPE=all` | Query rewrite also for users WITH hosted embeddings (default: local/lexical users only) |
| `NATIVELY_RETRIEVAL_ANCHOR_BOOST=0` | Anchor boost off (mode path and profile path) |
| `NATIVELY_RERANK_FUSION=off` | No rank fusion for the built-in reranker |
| `NATIVELY_KEYLESS_LEXICAL_MANUAL_RETRIEVAL=0` | Bundled embedder's vectors used even during a meeting |

## 5. Known gaps (measured, not fixed)

- **Held-out questions score ~88–91%**, not the ~98% my own question set reports. Paraphrases *without* embeddings are the weak cell (38–46% offline); the rewrite exists for them and took 9/12 → 10/12 in the one live A/B.
- "How do I handle conflict with a coworker?" is classified as a document lookup by a pre-existing rule, so in typed chat (local/lexical users) it can trigger a rewrite it does not need.
- A purely conversational question with no shared vocabulary ("anything you do outside of work with kids or teaching") is still not routed to the résumé.
- Once-only `Label: value` headings in extracted text ("Postmortem: INC-4471") are treated as fields, not headings.
- A 30k-token résumé's structuring time was never measured (2k / 5k / 15k: 100% complete).
- The shared working tree fails one source-window test (`LlmStreamAbortController`) only when this branch and another engineer's uncommitted work are combined; each passes alone. This branch sits 89 characters inside that 40,000-character window.
- CI on `main` is red for unrelated reasons (4 template-gallery tests); this PR inherits that.

## 6. Not part of this PR but outstanding

- **Rotate the GCP service-account key** that was printed into a terminal transcript during this work.
- Your disk was at 99% during the last session (a commit failed with "No space left on device"); free space before building installers.
