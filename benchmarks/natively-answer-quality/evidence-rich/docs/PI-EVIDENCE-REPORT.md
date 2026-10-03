# Profile Intelligence — what went in, what the app kept, what reached the prompt

Build `e000db4a`, 2026-10-03. Sources: `results/er-*-base/pi.jsonl` (every profile load, with the stored profile
the app returns), the prompts of every row (`wire.jsonl`), the frozen manifest. Regenerate the tables with
`node evidence-rich/pipeline-reports.mjs --runs … --which pi`. Holdout rows are counted, never listed.

**One limit first.** In this rig the résumé and the job description are structured by the app's built-in
(heuristic) parser: the app starts from an empty profile, the model key is set after start, and no model is
available to the ingest step. Every profile load in these runs reports `resumeExtractionMode: heuristic`. A user who
uploads a résumé with a provider already configured may get the model-based structuring instead. That path was
NOT measured here. Everything below describes the heuristic path only.

## The two synthetic profiles

| | Profile A | Profile B |
|---|---|---|
| Candidate | Advik Thorambath, backend / distributed systems, Hyderabad, six years | Catarina Velmonte, frontend / product engineering, Porto, nine years |
| Résumé | `Advik_Thorambath_Resume_2026.pdf` (PDF, 1,048 words, 48 recorded facts) | `Catarina_Velmonte_CV.docx` (DOCX, 884 words, 43 facts) |
| Employers | Quillhaven Freight Systems (tech lead of 4), Tessarine Mobility | Lumenquay (lead of an 18-person chapter), Ondaverde Health, Plumewright Studio |
| Projects | Skeinrouter, Marrowgate, Farecrest, pgslotwatch | Pebblekit, Fernlatch, Dialbench, Farolim |
| Job description | Ostrakel Payments, Senior Backend Engineer — Payments & Ledger (DOCX, 760 words, 38 facts) | Hollowpine Labs, Senior Product Engineer — Collaborative AI Workspace (plain text, 645 words, 32 facts) |
| Gaps against the JD | Java / Spring, payments domain, PCI DSS, reconciliation | real-time / CRDT, LLM features, rich-text editors |
| Deliberately absent from résumé and JD | reason for leaving, relocation, notice period, salary, weakness, behavioural stories, visa status | the same |
| Candidate-authored notes (Reference Files of the Looking-for-work mode, not PI) | `ostrakel-interview-prep.md`: why moving, relocation (Bengaluru or Hyderabad only), notice 90 days, INR 58–64 lakh, weakness, four stories | `LFW-REF-B-INTERVIEW-NOTES` (DOCX): remote from Porto as a condition, salary ask in EUR, her own stories |

Nothing is shared between A and B: no employer, project, city, university or metric.

## Ingestion

33 profile loads across the four baseline runs (A, A résumé only, A JD only, B; by clearing first, and by uploading
over the previous profile).

| | Result |
|---|---|
| Files accepted by the profile ingest (PDF, DOCX, text) | 33 of 33 loads, every document |
| Résumé structured / JD structured when loaded | 100 % / 100 % |
| Extraction mode | heuristic on every load |
| Load time (median) | résumé + JD 2.6–3.8 s; one document 1.3 s |
| After uploading B over A (5 switches, both directions) | stored profile holds no string of the other profile (0 of 33 loads) |
| After deleting résumé and JD the way a user does | no structured résumé, no JD, 0 knowledge nodes, no string of either profile |

## What the stored (structured) profile holds

For every recorded fact of each document: are its strings present in the structured profile the app stores?

| Document | Facts | Fully present | Partly | Absent |
|---|---:|---:|---:|---:|
| Résumé A (PDF) | 48 | 47.9 % | 10.4 % | 41.7 % |
| JD A (DOCX) | 38 | 55.3 % | 0 % | 44.7 % |
| Résumé B (DOCX) | 43 | 55.8 % | 16.3 % | 27.9 % |
| JD B (plain text) | 32 | 3.1 % | 0 % | 96.9 % |

The raw text of both documents is also indexed in passages, and those can reach a prompt, so "absent from the
structured profile" is not "unavailable". It does mean the structured view is a lossy copy.

**Lost.**
* Résumé A: no bullet survives as a bullet (0 bullets); the measured outcomes (throughput, latency, the migration's
  size and cutover window, incident counts) live only in the raw-text passages.
* JD B: stored with no requirements at all; its team, location, process and "nice to have" lines are absent.
* Candidate location is empty for both ("Hyderabad", "Porto" are in the résumé headers). JD location is stored as
  "Unknown Location" for both (Bengaluru hybrid; Rotterdam / remote within Europe).

**Distorted.**
* Résumé A (PDF): 6 "experience" entries for 3 roles. Two of the companies are stored as "ships." and "[Page 2]"
  (a line fragment and the parser's page marker); three entries are sentence fragments of bullets.
* Résumé A: 35 "project" entries; besides the four projects they are section labels ("Role", "Problem", "Design",
  "My part") and line fragments. Résumé B: 18 project entries of the same kind.
* Résumé A education: institution = "Bachelor of Technology in Computer Science and Engineering", degree = "AWS
  Certified Solutions Architect - Associate", field = "(2022)". The institute (Kesavadri, Warangal) and the CGPA are
  not in the structured record. Résumé B's education is right apart from the grade being glued to the institution.
* JD A company is stored as "Payments & Ledger" (it is Ostrakel Payments; the title is "Senior Backend Engineer —
  Payments & Ledger"). JD B company is stored as "Collaborative AI Workspace" (it is Hollowpine Labs).
* JD A minimum experience is stored as 2 years (the posting asks 6 or more, 2 of them senior).
* JD B technologies include "Sketch" (the posting says teams "sketch together"); the gap analysis then lists
  "Sketch: missing" for candidate B.

**Invented (derived by the app, not in any document).**
* A one-line persona per profile: A "Senior Senior Backend Engineer at Payments & Ledger. Tech: Java, Go, Spring,
  PostgreSQL." (the candidate has no Java or Spring: those are the job's requirements, and he does not work at the
  target company); B "Senior Senior Product Engineer at Collaborative AI Workspace. Tech: JavaScript, TypeScript,
  React, Node.js."
* A gap analysis with a match percentage (A 56 %, B 67 %) and gaps that include the headings "Good to have" and
  "Interview process" as if they were skills; each gap carries a generated "pivot script".

**Did the distortions reach answers?** Checked by string on the 119 rows with a profile loaded: the persona line
is in 0 prompts; the wrong company name ("Payments & Ledger" as the company) is in 6 prompts and is named as the
employer in 0 answers. One holdout answer of profile A puts "Java" next to a first-person verb; it is a holdout
row and was not read, and the candidate's own notes legitimately say he reads Java and has not shipped it, so this
is not established either way. The answer path reads résumé / JD evidence passages, not the persona. The distorted
fields are what the profile screens and the legacy paths show; that was not tested here.

## What reached the prompt

49 cases whose oracle rests on a résumé or JD fact (dev, counterfactual, isolation, holdout).

| Slice | Cases | Profile sources offered to the turn | Résumé / JD evidence of the right kind in the prompt | Every needed profile fact in the prompt |
|---|---:|---:|---:|---:|
| All | 49 | 100 % | 85.7 % | 39.0 % (16 of 41 traceable) |
| Looking for work | 30 | 100 % | 83.3 % | 39.1 % |
| Technical Interview | 19 | 100 % | 89.5 % | 38.9 % |
| Profile A | 36 | 100 % | 86.1 % | 31.0 % |
| Profile B | 13 | 100 % | 84.6 % | 58.3 % |
| Résumé only loaded | 5 | 100 % | 100 % | 40.0 % |
| JD only loaded | 3 | 100 % | 100 % | 100 % |
| Heard turns | 37 | 100 % | 83.8 % | 31.0 % |
| Typed turns | 12 | 100 % | 91.7 % | 58.3 % |

A turn receives at most six profile passages (typically three résumé, three JD) out of 69–73 stored nodes. The
profile is always loaded and always offered; the specific fact the question needs is in the prompt in about four
cases of ten. The résumé facts most often missing when needed (dev and supplementary sets): the on-call and
incident line, the migration's cutover window, the project's throughput, latency and partitioning figures, the
design system's size. When the fact is missing the answers are of the kind "I'll confirm the before-and-after
figures and come back to you", from a candidate whose résumé states them.

## Leakage

| Check (code, on every answered row of the four baseline runs: 559) | Result |
|---|---|
| Rows with a profile loaded in the two profile modes | 119 |
| Other profile's identity strings (names, employers, projects) in the prompt | 0 |
| Other profile's identity strings in the answer | 0 |
| Rows in the seven other modes with a profile loaded | 8 |
| Résumé / JD evidence in their prompt | 0 |
| Profile strings in their answer | 0 |
| Stored profile holding strings of the previous profile after an overwrite | 0 of 5 switches |

One isolation case (ER-ISO-015: profile A loaded after B; "what's your experience with accessibility testing?") was
flagged as using the other profile, because the answer says "screen readers like NVDA and VoiceOver", strings
listed for profile B. None of profile B's text was in that prompt (only A's résumé and the A-side files). The claim
was invented by the generator, which is a fabrication failure, not a leak; the item's strings are generic terms and
are a defect of the v1 item, reported here and not edited.

Two profile-switch cases failed for a third reason: after the switch the résumé passage with the needed fact was
not in the prompt, and the answer filled the gap ("I'm based in Bengaluru" for a candidate whose résumé says
Hyderabad; the prompt held only his notes about the Bengaluru role).

## What this means for the product

* Résumé and JD ingestion is reliable as file handling (every format, every load) and clean across profile
  switches and deletion.
* The structured profile produced by the built-in parser is lossy and in places wrong, most visibly for a PDF
  résumé with wrapped lines and for a plain-text job description. Whether the model-based structuring is better is
  UNKNOWN here.
* The dominant loss is the same as for reference files: the résumé is about 1,600 tokens and the JD about 1,100,
  both small enough to hand over whole, and a turn receives six passages of them.
