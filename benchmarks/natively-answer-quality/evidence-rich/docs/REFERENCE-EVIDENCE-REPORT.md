# Reference Files — from upload to prompt

Build `e000db4a`, 2026-10-03, the four baseline runs (dev 270, counterfactual 63, isolation 46, holdout 180; 559
answered rows, no provider failure, no row left unverified). All figures here come from the app's own records (the
upload result, the index status, the `[V3]` trace line of each turn, the prompt that was sent). No judge is
involved. Regenerate with `node evidence-rich/pipeline-reports.mjs --runs … --which reference`. Holdout rows are
counted, never listed.

How a stage is measured:

* **uploaded / parsed**: the production upload (`ingestModeReferenceFile`) returned the file with extracted text.
* **fact survived the parser**: each recorded fact has 1–3 short strings copied from the document; they are looked
  for in the text the app extracted (whitespace and the parser's page markers ignored).
* **indexed**: the file's index status after upload.
* **right file in the prompt**: the prompt's evidence tags name the file(s) the oracle rests on.
* **fact in the prompt**: every string of every needed fact (and of every value a calculation needs) is in the prompt.

## 1. Ingestion and parsing: no loss

| Mode | Uploads | Distinct files | Uploaded | Same bytes as frozen | Parsed | Index ready | Fact strings surviving the parser |
|---|---:|---:|---:|---:|---:|---:|---:|
| General | 56 | 11 | 100 % | 100 % | 100 % | 100 % | 1,544 / 1,544 |
| Sales | 47 | 11 | 100 % | 100 % | 100 % | 100 % | 1,487 / 1,487 |
| Recruiting | 59 | 13 | 100 % | 100 % | 100 % | 100 % | 1,629 / 1,629 |
| Team Meet | 54 | 12 | 100 % | 100 % | 100 % | 100 % | 1,440 / 1,440 |
| Looking for work | 36 | 9 | 100 % | 100 % | 100 % | 100 % | 1,633 / 1,633 |
| Lecture | 63 | 12 | 100 % | 100 % | 100 % | 100 % | 2,419 / 2,419 |
| Technical Interview | 79 | 11 | 100 % | 100 % | 100 % | 100 % | 2,288 / 2,288 |
| Seminar | 56 | 9 | 100 % | 100 % | 100 % | 100 % | 2,052 / 2,052 |
| Call Center | 45 | 12 | 100 % | 100 % | 100 % | 100 % | 1,466 / 1,466 |
| **All** | **495** | **100** | **100 %** | **100 %** | **100 %** | **100 %** | **15,958 / 15,958** |

By format (distinct files): PDF 45, DOCX 23, Markdown 19, text 6, CSV 4, Python / TypeScript / Go 1 each. Not one
recorded string was lost in any format. Tables in a PDF arrive as one line per row and tables in a DOCX as one cell
per line; a value kept inside one cell survives either way. Every upload ended with index status `ready`; the upload
call returns in about 6 ms and indexing completes in the background.

## 2. Retrieval: about half the needed facts reach the prompt

387 cases whose oracle rests on at least one reference file.

| Mode | Cases | Retrieval planned | Every needed file in the prompt | At least one | **Every needed fact in the prompt** | Only wrong files in the prompt | No reference text at all |
|---|---:|---:|---:|---:|---:|---:|---:|
| General | 46 | 93.5 % | 73.9 % | 84.8 % | **45.7 %** | 8.7 % | 6.5 % |
| Sales | 46 | 95.7 % | 78.3 % | 89.1 % | **37.0 %** | 6.5 % | 4.3 % |
| Recruiting | 45 | 95.6 % | 73.3 % | 80.0 % | **45.5 %** | 15.6 % | 4.4 % |
| Team Meet | 46 | 97.8 % | 73.9 % | 78.3 % | **56.5 %** | 19.6 % | 2.2 % |
| Looking for work | 29 | 96.6 % | 93.1 % | 93.1 % | **55.2 %** | 0 % | 6.9 % |
| Lecture | 46 | 100 % | 95.7 % | 100 % | **80.4 %** | 0 % | 0 % |
| Technical Interview | 37 | 100 % | 97.3 % | 97.3 % | **50.0 %** | 2.7 % | 0 % |
| Seminar | 46 | 100 % | 93.5 % | 95.7 % | **50.0 %** | 4.3 % | 0 % |
| Call Center | 46 | 100 % | 87.0 % | 93.5 % | **39.1 %** | 6.5 % | 0 % |
| **All** | **387** | **97.7 %** | **84.5 %** | **89.9 %** | **50.9 %** | **7.5 %** | **2.6 %** |

| Slice | Cases | Every needed fact in the prompt |
|---|---:|---:|
| Answer needs one file | 293 | 53.6 % |
| Answer needs two or more files | 92 | 42.4 % |
| Heard turns | 261 | 49.8 % |
| Typed turns | 124 | 53.2 % |
| Conflict / stale cases | 75 | 45.3 % |
| Calculation cases | 84 | 38.1 % |

Why. The packs are 2,300–9,800 tokens in 6–9 files (as the app counts them). A turn's prompt carries at most 8
evidence passages and 1,500–2,400 evidence tokens (the dev prompts: 8 items at the median and at the maximum of
reference-only turns), a quarter to a half of a pack. On the 111 evidence-required dev rows that missed, 104
carried 6 or more passages (90 carried 8), and the retriever had offered more candidates than were packed on 92.
The ranking mode is not the difference: heard turns ran the local lexical search with rerank (the app marked 342
of 559 turns `local_lexical`), typed turns the hybrid search, and both deliver about half. The no-loss stages above
rule out ingestion.

The app's own verdict per turn agrees in kind but not in size: it called 146 of the 387 turns "partial support"
and 2 "fact not found"; by the strings, 189 lacked a needed fact.

Small corpora were hardly exercised in the baseline sets: two evidence-required rows ran on a pack of 1,400 tokens
or less, the size the kept build reads whole.

## 3. Outdated and draft files

Every base pack holds at least one outdated, draft or informal document. In the 68 conflict / stale cases with such
a file loaded:

| | Cases |
|---|---:|
| An outdated or draft file was in the prompt | 56 |
| The outdated value itself was in the prompt | 34 |
| The current fact was in the prompt | 32 |
| Current fact in, outdated value out | 14 |
| **Outdated value in, current fact out** | **16** |

In 16 of 68 cases the model was handed the old value and not the current one. Whatever the wording of the prompt,
that turn can only quote the old value or defer.

## 4. The question held fixed (`supp-oracle-sources`)

The 223 dev cases whose oracle names a reference file were asked again with only the files their oracle names
loaded in their mode (1 file in 103 cases, 2 in 64, 3 in 41, more in 15).

| | Baseline (whole pack loaded) | Only the oracle's files loaded |
|---|---:|---:|
| Every needed file in the prompt | 82.6 % | 93.5 % |
| Every needed fact in the prompt | 49.7 % (99 / 199) | 79.4 % (158 / 199) |
| Corpus read whole (≤ 1,400 tokens) | 0 % | 31.3 % |

Delivery does not reach 100 % because a single long document (the paper, a handbook) is itself larger than the
whole-corpus size and is still served in passages under the same cap.

## 5. Isolation

Checked by code on all 559 answered rows; every mode's pack was loaded at the same time throughout.

| | Result |
|---|---|
| A file of another mode in the prompt | 0 rows |
| A file unknown to the benchmark in the prompt | 0 rows |
| Reference evidence in the prompt while the mode had no file loaded | 0 rows |
| Another mode's fixed fact in the answer (16 cross-mode items) | 0 |
| Mode switches inside one session (6 items): a file of the mode just left in the prompt | 0 of 6 |

Reference files stay inside their mode.
