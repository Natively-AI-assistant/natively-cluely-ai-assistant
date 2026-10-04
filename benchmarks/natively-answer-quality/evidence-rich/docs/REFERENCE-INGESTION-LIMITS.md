# Reference files: what "I uploaded this file" means today (2026-10-04, main efc126a9)

| Stage | What happens | Limit | Evidence |
|---|---|---|---|
| A. Parse | whole text extracted (PDF pages as `[Page N]`, DOCX raw text, 48 text types) | 50 MB; parse timeout 30 s–5 min; no OCR; `.doc` refused | runtime: 256,514-char file extracted whole, 7/7 planted facts incl. the last line |
| B. Store + index | whole text stored; chunked (target 350 / max 1,000 est. tokens; tables and code fences unsplit); embedded locally | none on files per mode or total size; embedding sees ~512 model tokens of a chunk | runtime: 161 chunks, all `ready`, for a 64,000-token file |
| C. Retrieve | all the mode's files ≤ 1,400 est. tokens → every file whole; ≤ 12,000 → every file whole (whole pack); above → hybrid retrieval (lexical fallback on typed turns while the local embedder is active), rerank pool 30, per-file floor 2 | 12,000 est. tokens across ALL the mode's files | runtime: §1, §2, §4 of the tests doc |
| D. Pack | per-mode evidence budget 1,200–2,400 est. tokens and 6–8 items, widened by the whole-file size when whole; an item that does not fit is skipped whole | same | runtime: 3–5 chunks above 12,000 |
| E. Send | evidence block inserted verbatim; no cut after the packer; no provider-window cut for cloud models | none | runtime: request contents read from the wire |
| Verifier | claim pass gets the generator's whole user message (≤ 96,000 chars) | 96,000 | 536/536 on main |

## So: is a long file truncated?
**No.** No reference file in these tests was truncated at any stage. What changes at 12,000 est. tokens (≈ 48,000
chars of English, ≈ 18,000 chars of Japanese) is that the model stops seeing the file and starts seeing 3–5
retrieved pieces of it (~7,000 chars). For a question about one named thing that works (7/7 at every size up to
64,000 tokens, fact at any position incl. the very end). For a question about the whole document it does not:
2–3 of 7 facts (tests §2). And retrieval can miss a uniquely named fact in a mid-size multi-file corpus
(10 × 3,000: first and last files missed, reproducibly, cause not yet identified — tests §4).

## Where the answer to "does it see my file" becomes no
1. The mode's files together exceed 12,000 est. tokens AND the question needs more than 3–5 chunks' worth.
2. Retrieval ranks the right chunk out (tests §4 repro).
3. Non-English or numeric files reach the 12,000 switch at fewer real words (tests §6).
4. Scanned PDFs: no OCR — image-only pages produce no text; the user is not told (console only).
5. The legacy "corrected answer" repair (≈ 13 % of heard turns) sees the answer prompt cut at 24,000 chars, i.e.
   only the first ~24,000 chars of a whole-file turn, and can replace the answer (CLAIM-VERIFIER-CONTEXT-PARITY.md).

## Code risks not measured
- Retriever counts `chunk.length/4`, the packer counts the rendered tag (~95 est. tokens per item) — the last 1–2
  retrieved chunks can be dropped by the packer.
- A quote- or `&`-heavy file near the whole-pack reserve can overrun it after XML escaping and be skipped whole.
- Unsplit tables / code fences larger than the evidence budget: retrieved, then skipped whole by the packer.
- Partial embedding failure leaves the tail lexical-only while the file shows `ready`.
