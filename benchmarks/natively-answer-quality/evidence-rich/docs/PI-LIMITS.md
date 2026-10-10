# Profile Intelligence (résumé + JD): limits (2026-10-04, main efc126a9)

## The path
Upload (`profile:upload-resume` / `profile:upload-jd`, or a pasted JD written to a temp file) →
`DocumentReader.extractDocumentText` (premium; **refused above 200,000 chars**, with an error the user sees) →
structured extraction (LLM, with a heuristic fallback) → `raw_text` persisted whole → chunked (semantic chunker, target
350 / max 1,000 est. tokens) and indexed → per turn, `createProfileRetrievalPort`:
- résumé + JD together **≤ 6,000 est. tokens** (`PROFILE_WHOLE_MAX_TOKENS`, `profile-retrieval-port.ts:175,676`):
  both handed over whole as `Document (whole)` items (E2, landed `73a2f89f`);
- above it, **both** fall back to ranked passages (topK = the mode's candidates, 20–24) competing for the mode's
  accepted items (6, 8 for lecture/seminar).
`v3ProfileSources.ts:25,32` slices to 200,000 chars only for legacy rows that have no `raw_text`.

## Measured (looking-for-work, typed, résumé only, 7 planted facts at 0–99.5 %)
Probe: `node evidence-rich/limits/probe.mjs resume --sizes 1500,3000,5500,6500,12000` (synthetic résumé, filler
"Experience" section with seven unique facts; asked "In my last role, what code opened the gate at the X depot?").

| Résumé (est. tokens) | ingest | how it reached the prompt | facts in the request | user message chars |
|---|---|---|---|---|
| 1,500 | ok (heuristic extraction) | whole | 7/7 | 11,020–14,533 |
| 3,000 | ok | whole | 7/7 | 17,020–20,638 |
| 5,500 | ok | whole | 7/7 | 27,020–30,968 |
| 6,500 | ok | passages (20 candidates) | 7/7 | 7,760–9,848 |
| 12,000 | ok | passages | 7/7 | 6,556–10,182 |

The switch is exactly where the code says (between 5,500 and 6,500). Each question named a unique subject, so
retrieval found every fact; this is the easy case. An "across the whole résumé" question above 6,000 is expected to
behave like the reference-file aggregate probe (2–3 of 7), NOT MEASURED for the profile.

`A_in_stored_profile` came back 0/7 because `__e2e__:profile-state` returns structured fields, not the raw text; the
facts reaching the request at 7/7 shows they were stored. Extraction ran as `heuristic` on every size (the LLM
extractor was not used in this probe).

## Answers
- **Are the résumé and JD cut independently?** No. The 6,000 limit is on their sum: a long JD pushes a short résumé out
  of whole mode too. Nothing is cut mid-document; the switch is all-or-nothing.
- **Is anything cut silently?** No text is cut. Above 6,000 the model sees passages, and the user is not told.
- **Token meaning.** 6,000 is chars/4. For a Chinese or Japanese résumé that is ~13,000–16,000 real tokens
  (measured ratios 2.2× and 2.6×); for English ~4,800.
- **Code risk, not measured:** the plan reserves `raw/4 + 120` per whole document, the packer charges the escaped text
  plus the tag. A quote- or `&`-heavy résumé close to 6,000 could overrun its reserve and be skipped whole.
