# Phase 1 Report — Modes E2E Document Corpus

Location: `test-fixtures/modes-corpus/`
Date: 2026-07-02

## Summary

A real, multi-format document corpus was assembled by downloading genuine files from
the public internet (arXiv, raw.githubusercontent.com, ietf.org, calibre-ebook.com,
Stanford CS231n) plus two real thesis PDFs already present in the repo. Every PDF was
verified with `%PDF` magic + `file`; every OOXML (.docx/.pptx) verified with `PK` magic.
Ground-truth facts were extracted by actually parsing each file (PDFs via the repo's own
`pdf-parse@2.4.5`, CSV via Python `csv`, DOCX via unzip of `word/document.xml`).

- Corpus documents (answerable): 12
- Rejection-path fixture (.pptx, unsupported): 1
- Total files: 13
- Question bank: 26 questions
- Manifest ground-truth facts: 60+ exact facts across the corpus

## Downloaded / assembled files

| File | Source | Format | Pages/Rows | Size |
|------|--------|--------|-----------|------|
| thesis/institutional_thesis.pdf | repo `Sample thesis for testing.pdf` (Aalto MSc, Alberto Dian) | pdf | 66 pp | 24M |
| thesis/seminar_real_thesis.pdf | repo `tests/fixtures/.../seminar_real_thesis.pdf` | pdf | 2 pp | 104K |
| papers/attention_is_all_you_need_1706.03762.pdf | arxiv.org/pdf/1706.03762 | pdf | 15 pp | 2.1M |
| papers/bert_1810.04805.pdf | arxiv.org/pdf/1810.04805 | pdf | 16 pp | 760K |
| papers/resnet_1512.03385.pdf | arxiv.org/pdf/1512.03385 | pdf | 12 pp | 804K |
| datasets/gapminder2007.csv | raw.githubusercontent.com/plotly/datasets | csv | 142 rows | 8K |
| datasets/gdp_worldbank.csv | raw.githubusercontent.com/datasets/gdp | csv | 13978 rows | 552K |
| slides/cs231n_lecture.pdf | cs231n.stanford.edu/slides/2017/…lecture1.pdf | pdf | 48 slides | 16M |
| docs/rfc8259_json.txt | ietf.org/rfc/rfc8259.txt | txt | 899 lines | 28K |
| docs/sample.docx | calibre-ebook.com/downloads/demos/demo.docx | docx | 1 | 1.3M |
| nasty/imageonly_scanned.pdf | py-pdf/sample-files 007-imagemagick-images | pdf | 6 pp (image-only) | 16K |
| nasty/arabic_encoding.pdf | py-pdf/sample-files 015-arabic | pdf | 1 p (RTL/CID) | 16K |
| rejection/sample.pptx | jgm/pandoc test/pptx/reference-depth.pptx | pptx | — | 44K |

## Constraint handling (app allow-list)

The app's server-side upload allow-list (`electron/ipcHandlers.ts:7758-7770`) accepts only
`.txt .md .markdown .json .csv .tsv .xml .html .htm .log .pdf .docx`. There is NO xlsx/pptx
ingest. Accordingly:

- **"Spreadsheet" requirement → CSV.** Two real public datasets (Gapminder 2007, World Bank GDP)
  serve as the real-data spreadsheet analog with exact numeric answer keys.
- **"PowerPoint" requirement → slide CONTENT as PDF.** A real Stanford CS231n Lecture 1 deck
  (48 slides) is supplied as its native PDF (the accepted format). A real `.pptx` is ALSO kept
  under `rejection/` purely to test that the allow-list rejects unsupported presentations.

## Substitutions logged (adaptation to reachability)

1. **DOCX:** first candidates (microsoft/presidio raw path, python-docx test files) returned
   404 / HTML error pages. Fell back to `calibre-ebook.com/downloads/demos/demo.docx`
   — a real, valid Microsoft Word 2007+ file (PK/OOXML verified).
2. **PPTX (rejection fixture):** python-pptx and several sample-host URLs 404'd or timed out.
   Resolved via the GitHub contents API to a real pandoc test deck
   (`reference-depth.pptx`, PK verified).
3. **Nasty PDF:** the initial pdf995 sample turned out to contain normal extractable text
   (not "nasty"). Discarded in favor of TWO genuinely hard cases from py-pdf/sample-files:
   an **image-only** 6-page PDF (~96 chars extractable → scanned-doc robustness case) and an
   **Arabic RTL/CID** PDF (~43 chars, garbled → unusual-encoding case).
4. **Thesis:** no external download needed — the repo already contains a real 66-page Aalto
   master's thesis (`Sample thesis for testing.pdf`) with rich exact figures; copied in with
   provenance. Also copied the repo's `seminar_real_thesis.pdf`, whose content is actually a
   Data Analyst Job Description (documented gotcha; retained as a role-context / mismatch case).

All primary sources (arXiv, raw.githubusercontent, ietf.org) were reachable; no domain-block
fallbacks were required beyond the specific broken URLs noted above.

## Corpus → Mode mapping

| Mode | Primary documents |
|------|-------------------|
| 1 Senior Backend Eng Interview | attention, bert, resnet, rfc8259 |
| 2 Behavioral/HR | seminar_real_thesis (Data Analyst JD) |
| 3 Academic Thesis Defense | institutional_thesis, resnet |
| 4 Data Analyst Screening | gapminder2007, gdp_worldbank, bert, seminar JD |
| 5 Sales Discovery | gapminder2007, docx, thesis |
| 6 Investor Pitch Q&A | institutional_thesis, gapminder, gdp, slides |
| 7 Consulting Case | gapminder, resnet, attention+bert (cross-doc), imageonly |
| 8 Legal/Compliance Q&A | rfc8259, institutional_thesis |
| 9 Technical Conference Talk Q&A | attention, bert, resnet, thesis, slides |
| 10 Customer Support Escalation | docx, imageonly_scanned, seminar JD |

## Question bank composition (26 questions)

- factual (per-document): 16
- cross-document (need ≥2 docs): 2 (Q16 Transformer-vs-BERT metrics; Q17 US GDP per-capita vs total)
- no-answer-in-corpus (refusal expected): 4 (Q18, Q19, Q20 hallucination bait, Q21 image-only)
- follow-up-chain: 4 (Q22←Q04, Q23←Q06, Q24←Q11, Q26←Q25)
- All 10 modes covered; every `followUpOf` and `targetDocuments` reference validated.

Each question's rubric carries `requiredFacts` (exact figures/names that MUST appear),
`forbiddenFacts` (hallucination bait such as wrong parameter counts / swapped metrics),
`refusalExpected`, and `formatConstraints` (e.g. STAR, cites section, attributes metric to
correct paper).

## Verification method

- PDF magic: `head -c 5` == `%PDF`; OOXML magic: `head -c 2` == `PK`.
- Page counts and text extraction via `pdf-parse@2.4.5` (the parser the app itself uses).
- CSV facts computed with Python (`max`/`min`/`Counter`) — e.g. Japan max lifeExp 82.603,
  Norway max gdpPercap 49357.19, China max pop 1,318,683,096, US 2016 GDP 18,804,913,000,000.
- All numeric ground-truth facts were read out of the actual source text, not assumed.
