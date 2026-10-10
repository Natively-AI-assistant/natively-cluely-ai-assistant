# Authoring brief — evidence-rich benchmark v1 (`evidence-rich-v1`)

You write the INPUTS and the TRUTH for a benchmark of Natively, a realtime AI copilot. Natively is used while a
person is in a live conversation (interview, sales call, meeting, support call, lecture, seminar). It has nine
modes. Every mode can hold uploaded **Reference Files**. Two modes (Looking for work, Technical Interview) also
read **Profile Intelligence** (PI): the user's résumé and a target job description.

The experiment: when the truth is in the uploaded material, does Natively find it and use it correctly, and when it
is deliberately absent, does Natively stay truthful without becoming useless?

You produce, for ONE mode, a small synthetic world: realistic documents, a manifest of the facts in them, and
benchmark questions with a structured oracle. Everything is fictional. Never use a real person's data or a real
company's private policy. Fictional companies and people must have unusual, clearly invented names.

Natively NEVER sees the manifest, the oracle or the question metadata. It sees only the documents (after they are
uploaded through the product) and the question. A separate judge model sees the oracle.

## 0. Hard rules

1. **Documents look like real documents.** Pricing sheets, policy handbooks, sprint reports, résumés, papers, lecture
   notes: natural prose, headings, tables, dates, version lines, owner names, boilerplate. Never a Q&A sheet, never
   "Answer:", never a line written to match a question.
2. **Questions paraphrase.** A question must not copy a heading or a sentence of a document. If the document says
   "Salesforce connector is included in Enterprise", the question is "Would we have to pay extra to hook up our
   CRM?". Heard questions sound like live speech (fragments, fillers, two asks in one breath are fine). Typed
   questions sound like a person typing fast to an assistant.
3. **Distractors.** Each document carries plausible material no question uses, and near-miss values (another plan's
   price, another region's SLA, last quarter's number) so that a careless reader picks the wrong one.
4. **No benchmark words in documents.** No ids, no "benchmark", "test", "oracle", "question", "trap", "distractor",
   "synthetic". No comments to the reader.
5. **Truth is frozen once written.** Every value a question depends on appears in the manifest as a fact, with the
   exact value. Facts must not contradict each other inside current documents unless you declare the conflict.
6. **Unknown is not false.** If a document does not mention something (HIPAA, a relocation preference), the oracle
   says the answer must neither claim it nor deny it.
7. **Evidence is not authority.** "Typical implementation: 30 days" does not let a seller guarantee 30 days. "A
   supervisor may approve a refund" does not let a tier-1 agent promise one. Where this matters, the oracle says so.
8. **A current decision is not a personal fact.** "Pads or pads and rotors?" may be answered with a reasonable
   decision. "Who's taking this?" may be answered "I can take it". Do not require a document for those.
9. **Today is early October 2026.** Current documents are dated 2026. Outdated ones are dated 2025 or carry an
   older version. Drafts are marked as drafts and dated in the future or "proposed".
10. **Blind set.** You write a development set and a holdout set. The holdout goes to a separate folder that the
    engineer running the benchmark never reads. Do not copy development questions into it with small edits: the
    holdout asks about other facts, or the same facts from another angle.

## 1. Where to write (all paths under the benchmark's `evidence-rich/` folder)

```
authoring/<mode-key>/manifest.json        files + facts (schema in section 3)
authoring/<mode-key>/src/<FILE-ID>.<ext>  the document source, one file per document (section 2)
authoring/<mode-key>/variants.json        counterfactual patches of documents (section 4)
authoring/<mode-key>/configs.json         named sets of files (section 5)
authoring/<mode-key>/dev.json             development items (section 6)
authoring/<mode-key>/cf.json              counterfactual families (section 7)
authoring-holdout/<mode-key>/holdout.json holdout items (same schema as dev.json)
```

`<mode-key>` is one of: `general`, `sales`, `recruiting`, `team-meet`, `looking-for-work`, `lecture`,
`technical-interview`, `seminar`, `call-center`. Id prefixes: `GEN`, `SALES`, `REC`, `TEAM`, `LFW`, `LEC`, `TI`,
`SEM`, `CC`.

Write nothing anywhere else. Do not read `results/`, `astra/`, `dataset/`, `docs/` or another mode's
`authoring-holdout/` folder.

## 2. Documents

* 6 to 9 documents per mode (the task message lists the pack). Each 300 to 1,300 words; a paper may reach 2,500.
  The whole pack 3,500 to 7,500 words.
* File id: `<PFX>-REF-<SLUG>` in capitals, e.g. `SALES-REF-PRICING-2026`. PI documents: `PI-A-RESUME`, `PI-A-JD`.
* Source format: write Markdown (`.md`) for documents that will become PDF, DOCX or Markdown; plain text for `.txt`;
  CSV for `.csv`; real source code for code files (`.go`, `.py`, `.kt`, `.ts`, `.sql`). The engineer converts the
  Markdown to the target format, so the upload passes through the product's real PDF / DOCX parser.
* Choose the target format a real user would have: pricing sheet, résumé, paper, signed policy → `pdf`; handbook,
  guide, JD → `docx` or `pdf`; meeting notes, decision log, sprint status → `md` or `txt`; budget, results table →
  `csv` or a table inside a PDF; code → its language.
* `filename` is what a user's file would be called (`Northwind_Pricing_2026.pdf`), not the id. An outdated file is
  not always called "old": sometimes only its date or version line tells.
* PDF tables come out of the parser as loose lines. Keep every value a question depends on inside ONE table cell or
  one sentence; never split a value and its label across a line break you control.
* Status of each document: `current`, `outdated`, `draft`, `informal`. Authority: current signed/approved 100,
  current working document 80, outdated 40, draft 20, informal notes 10. Authority is oracle metadata: do not write
  the number in the document. A reader must be able to tell current from outdated from the document itself
  (date, version, "supersedes", "DRAFT"), as in real life, but do not make it trivial in every case: at least one
  conflict in the pack must be decidable only from dates or version lines.

## 3. `manifest.json`

```json
{
  "mode": "sales",
  "world": "One paragraph: the fictional company/person/project this pack describes.",
  "files": [
    {
      "id": "SALES-REF-PRICING-2026",
      "mode": "sales",
      "filename": "Northwind_Pricing_2026.pdf",
      "source": "src/SALES-REF-PRICING-2026.md",
      "format": "pdf",
      "document_type": "pricing",
      "title": "Northwind FleetOps price list 2026",
      "status": "current",
      "effective_date": "2026-07-01",
      "authority": 100,
      "supersedes": ["SALES-REF-PRICING-2025"],
      "facts": [
        { "id": "F1", "statement": "The Fleet plan costs $49 per vehicle per month on annual billing.",
          "doc_needles": ["$49"] }
      ],
      "intentional_conflicts": [
        { "fact": "F1", "with_file": "SALES-REF-PRICING-2025", "this_value": "$49", "other_value": "$44",
          "resolution": "current_wins" }
      ],
      "must_not_infer": ["Nothing here says the price is negotiable below the listed discount bands."]
    }
  ]
}
```

* `facts`: every value any item depends on, and the other important values of the document (15 to 40 per document
  is normal for a dense one). `statement` is a full, unambiguous sentence. `doc_needles`: 1 to 3 SHORT substrings
  (1 to 6 words: a number, a name, a term) copied **verbatim** from the document source, each inside one line / one
  table cell. They are used to detect by string match whether that fact reached the model, so prefer strings that
  appear ONLY where that fact is stated. A value that differs between the current and the outdated document must be
  a needle on both sides (`$49` here, `$44` there) and the current document must not contain the outdated string.
* A fact is referenced elsewhere as `<FILE-ID>#<fact id>`, e.g. `SALES-REF-PRICING-2026#F1`.
* `resolution`: `current_wins`, `final_wins`, `authoritative_wins`, or `unresolved` (two current, equally
  authoritative documents genuinely disagree: the right behaviour is to surface the conflict, not to pick).

## 4. `variants.json` — counterfactual documents

A variant is a base document with a few lines changed, so that ONLY the evidence changes between two cases.

```json
[
  { "id": "SALES-REF-INTEGRATIONS-2026~sfaddon",
    "base": "SALES-REF-INTEGRATIONS-2026",
    "replace": [ { "find": "exact text in the base source", "with": "replacement text" } ],
    "facts_changed": [ { "fact": "F4", "statement": "The Salesforce connector is a paid add-on at $300 per month.",
                         "doc_needles": ["$300 per month"] } ],
    "note": "Salesforce moves from included to paid add-on." }
]
```

`find` must match the base source exactly once. The variant keeps the base file's `filename`.

## 5. `configs.json` — which files are loaded

```json
[
  { "id": "sales-full", "mode": "sales", "base": true, "files": ["SALES-REF-PRICING-2026", "..."] },
  { "id": "sales-cf-sf-addon", "mode": "sales", "files": ["...", "SALES-REF-INTEGRATIONS-2026~sfaddon"] },
  { "id": "sales-none", "mode": "sales", "files": [] }
]
```

* Exactly one config per mode has `"base": true`: the whole pack, including the outdated and draft documents. In the
  run every mode keeps its base config loaded at the same time (as a real user would have), and an item changes
  only the files of ITS OWN mode.
* Other configs are the base with a document swapped for a variant, removed, or added; and one empty config
  (`<mode-key>-none`) for no-document cases. Keep the number of configs small (at most 8 per mode).

## 6. Items (`dev.json`, `holdout.json`): `{ "mode": "...", "items": [ ... ] }`

```json
{
  "id": "ER-D-SALES-001",
  "mode": "sales",
  "surface": "hotkey",
  "speaker": "other",
  "question": "So what are we looking at per truck if we commit for the year?",
  "prior_transcript": null,
  "conversation_id": null,
  "turn_index": 1,
  "evidence_config": "sales-full",
  "pi_state": "none",
  "condition": "conflict_stale",
  "category": "pricing",
  "difficulty": "medium",
  "oracle": {
    "expected_behavior_note": "The seller states the current $49 annual price for Fleet and does not quote the 2025 $44 or the draft $52.",
    "required_facts": [
      { "fact": "SALES-REF-PRICING-2026#F1", "text": "Fleet is $49 per vehicle per month on annual billing.",
        "answer_needles": ["$49", "49 dollars", "forty-nine"] }
    ],
    "optional_facts": [ { "fact": "SALES-REF-PRICING-2026#F2", "text": "Monthly billing is $56." } ],
    "forbidden_claims": [
      { "text": "Quotes $44 (2025 sheet) as the price.", "kind": "stale",
        "fact": "SALES-REF-PRICING-2025#F1", "answer_needles": ["$44"] },
      { "text": "Quotes $52 (draft 2027 sheet) as the price.", "kind": "draft",
        "fact": "SALES-REF-PRICING-2027-DRAFT#F1", "answer_needles": ["$52"] }
    ],
    "expected_role": "seller speaking to the prospect, first person",
    "expected_action": "answer_directly",
    "expected_response_type": "spoken_reply",
    "source_ids": ["SALES-REF-PRICING-2026"],
    "source_priority": ["SALES-REF-PRICING-2026", "SALES-REF-PRICING-2025", "SALES-REF-PRICING-2027-DRAFT"],
    "known_conflicts": [ { "topic": "Fleet annual price", "sources": ["SALES-REF-PRICING-2026", "SALES-REF-PRICING-2025", "SALES-REF-PRICING-2027-DRAFT"], "resolution": "current_wins" } ],
    "acceptable_inference": ["Mentioning that annual billing is the cheaper option."],
    "requires_calculation": false,
    "calculation_oracle": null,
    "requires_code_validation": false,
    "code_oracle": null
  }
}
```

Field rules:

* `id`: `ER-D-<PFX>-NNN` (dev), `ER-H-<PFX>-NNN` (holdout).
* `surface` / `speaker`: `hotkey` + `other` = the other party said the question aloud and the user pressed the
  hotkey for what to say (Lecture: the lecturer's words were heard and the student wants help with them).
  `typed` + `user` = the user typed the question privately to Natively. Use about 70 % hotkey in the live modes
  (sales, recruiting, team-meet, looking-for-work, technical-interview, seminar, call-center), about 50 % in general
  and lecture.
* `prior_transcript`: `null`, or up to 6 earlier lines `[{ "speaker": "other" | "user", "text": "..." }]` that the
  microphone heard before the question. Use it when the scenario needs it (a meeting already in progress, a
  customer who stated facts about their case, a candidate's earlier answer the recruiter must probe).
* Chains: items that share a `conversation_id` (`"<id of turn 1>-C"`) and have `turn_index` 1, 2, 3 are one
  conversation, run in order without a reset. All other items are independent (`conversation_id: null`,
  `turn_index: 1`).
* `evidence_config`: a config id from `configs.json` of this mode.
* `pi_state`: `none` in the seven modes without PI. In looking-for-work and technical-interview one of `none`,
  `A`, `A-RESUME`, `A-JD`, `B`, `B-RESUME`, `B-JD` (`A` = résumé + JD of profile A).
* `condition`, exactly one of:
  * `grounded_single` — the answer is in one loaded document (or in PI).
  * `multi_source` — the answer needs two or more sources (two files; résumé + JD; file + what was said in the
    conversation; PI + file).
  * `conflict_stale` — loaded sources disagree (outdated vs current, draft vs final, informal vs approved, or two
    current ones that genuinely conflict).
  * `irrelevant_source` — the right answer does NOT come from the loaded material (general knowledge, a present
    decision, the conversation itself) although the material looks temptingly related; it must not be dragged in.
  * `missing_evidence` — the needed fact is deliberately absent from everything loaded.
  * `followup` — a chain whose later turn depends on the earlier one.
* looking-for-work and technical-interview also set `pi_condition`, one of: `resume_only`, `jd_only`, `resume_jd`,
  `resume_jd_relevant_ref`, `resume_jd_irrelevant_ref`, `profile_conflicting_ref`, `no_pi`, `profile_b`.
* `oracle.required_facts`: the facts a correct answer must convey. `fact` points into the manifest (or a variant's
  `facts_changed`); use `"CONVERSATION"` for a fact stated in `prior_transcript`. `answer_needles`: surface forms,
  ONE of which a correct answer would almost certainly contain (a number in the forms a speaker would say or write
  it, a name). Leave `[]` when a correct answer could be worded without any fixed string. They are checked by exact
  case-insensitive substring match, so list every natural form.
* `oracle.forbidden_claims`: what a wrong answer would say. `kind`: `stale`, `draft`, `fabrication`,
  `other_profile`, `other_mode`, `unauthorized_promise`, `false_denial` (claims something is not so when the
  material is merely silent), `over_deferral` (says it cannot know although the material holds the answer).
  `answer_needles` only when a fixed string would prove it (an outdated price, the other profile's employer);
  never a string a correct answer could also contain. If the question itself mentions the outdated value ("your old
  sheet says $44"), do not list that value as a forbidden needle.
* `expected_action`, one of: `answer_directly`, `answer_with_calculation`, `answer_then_scope_authority` (state the
  fact, do not promise beyond the role's authority), `surface_conflict`, `prefer_current_source`,
  `make_current_decision`, `decline_to_invent_stay_useful`, `defer_to_verify`, `explain`, `write_code`,
  `probe_candidate`, `answer_candidate_question`, `continue_previous_answer`.
* `expected_response_type`: `spoken_reply`, `private_explanation`, `private_advice`, `code`, `words_to_say`.
* `source_ids`: the file ids (or `PI:RESUME`, `PI:JD`, `CONVERSATION`) the correct answer rests on; `[]` for
  `missing_evidence` and `irrelevant_source`.
* `requires_calculation: true` needs `calculation_oracle`: `{ "expression": "320 * 14 * 12 + 2500",
  "result": 56260, "unit": "USD", "accepted_forms": ["56,260", "56260", "$56.3k", "56.26"], "inputs": { "...": "FILE#Fn" } }`.
  Compute it yourself twice. `accepted_forms` are the ways a correct answer would print the result.
* `requires_code_validation: true` (technical-interview coding asks) needs `code_oracle`:
  `{ "language": "python" | "javascript" | "any", "function_hint": "is_palindrome", "tests": [ { "input": ["A man, a plan"], "expected": true } ] }`.

### Counts

Development, 30 items per mode: 11 `grounded_single`, 6 `multi_source`, 5 `conflict_stale`, 3 `irrelevant_source`,
3 `missing_evidence` (at least one of them with the mode's empty config), 2 `followup` (one two-turn chain).

Holdout, 20 items per mode: 7 / 4 / 3 / 2 / 2 / 2 in the same order.

At least 4 development items and 3 holdout items per mode need arithmetic or a date computed from document values
(mark `requires_calculation`), where the mode allows it.

Looking for work and Technical Interview spread `pi_condition` as the task message says.

## 7. `cf.json` — counterfactual families

The same question asked under different evidence. The answer must change with the evidence.

```json
{ "mode": "sales", "families": [
  { "family": "ER-CF-SALES-1", "surface": "hotkey", "speaker": "other",
    "question": "And connecting our CRM, is that part of the deal?", "prior_transcript": null,
    "variants": [
      { "variant": "A", "evidence_config": "sales-full", "pi_state": "none", "evidence_state": "says_yes", "oracle": { "...": "as in section 6" } },
      { "variant": "B", "evidence_config": "sales-cf-sf-addon", "pi_state": "none", "evidence_state": "says_paid_addon", "oracle": { } },
      { "variant": "C", "evidence_config": "sales-cf-sf-conflict", "pi_state": "none", "evidence_state": "current_files_conflict", "oracle": { } },
      { "variant": "D", "evidence_config": "sales-cf-sf-absent", "pi_state": "none", "evidence_state": "no_relevant_file", "oracle": { } }
    ] }
] }
```

Two families per mode: one with 4 variants, one with 3. Each variant has its own full oracle. In the "absent"
variant remove the document (or patch the lines out) so nothing loaded answers the question.

## 8. Self-check before you finish

* Every `doc_needles` string is a verbatim substring of its document source (after variants: of the patched text).
* An outdated value's needle does not occur in the current document, and the reverse.
* Every `fact` reference resolves. Every `evidence_config` exists. Counts match section 6.
* Every calculation recomputed. Every date arithmetic recomputed against a 2026 calendar.
* No question copies 6 or more consecutive words from a document.
* For each `missing_evidence` item, search the whole pack: the fact really is absent, and nothing implies it.
* For each `grounded_single` item, exactly one reading of the documents answers it (no second current document
  gives another value unless you declared the conflict).
* The final message you return: counts only (documents, words, facts, items per condition), the list of file ids
  with status, and anything you could not satisfy. Do not paste documents or questions back.
