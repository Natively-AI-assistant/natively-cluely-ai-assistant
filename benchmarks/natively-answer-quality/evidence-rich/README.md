# evidence-rich-v1

A separate benchmark of Natively's answers when every mode holds realistic evidence, loaded through the product's
own upload paths. It does not replace or change the frozen 9-mode benchmark in the parent folder; the two series
are never compared number for number (different questions, charter, dimensions and judge envelope).

The question it answers: when the truth is in the user's Reference Files or Profile Intelligence, does Natively
find it and use it correctly, and when it is deliberately absent, does Natively stay truthful and still useful?

## Layout

| Path | What it is | Reaches the app? |
|---|---|---|
| `AUTHORING-ER.md` | The brief the corpus was authored to (schema, rules, counts) | no |
| `authoring/<mode>/` | Authored truth: `manifest.json` (files + facts + needles), `src/` (document sources), `variants.json`, `configs.json`, `dev.json`, `cf.json`; `authoring/profiles/` (résumés, JDs); `authoring/isolation/` | no |
| `authoring-holdout/<mode>/holdout.json` | The blind items. Never read by whoever optimises; scripts print counts only | no |
| `evidence/files/<id>/<file>` | The uploadable files (PDF, DOCX, Markdown, text, CSV, code) built from the sources. This folder is `NATIVELY_E2E_REFERENCE_ROOT`: the upload hook refuses any path outside it, so oracles and results cannot be ingested | **yes, only this** |
| `oracles/` | `evidence-manifest.json` (every file: status, authority, facts, conflicts, sha256), `evidence-texts.json`, `pi-identities.json` | no |
| `datasets/` | `dev.json`, `holdout.json`, `supp-counterfactual.json`, `supp-isolation.json`, each hashed | no |
| `FREEZE.json` | Hashes of the manifest and datasets at freeze time | no |
| `judge/` | `CHARTER-ER.md`, envelope, scoring, judge driver, calibration; `judge/out/<set>/`, `judge/cache/` | no |
| `results/<run>/` | `rows.jsonl`, `wire.jsonl` (the prompts sent), `ingest.jsonl`, `pi.jsonl`, `run.json` | no |
| `docs/` | Corpus index, pipeline reports, quality report | no |

## The path a case takes

```
file on disk ──upload hook──▶ ingestModeReferenceFile ──▶ extractSafeDocumentText (pdf-parse / mammoth / text)
            ──▶ mode_reference_files ──▶ chunk + embed ──▶ per-turn retrieval ──▶ context packing ──▶ prompt
résumé / JD ──ingest hook──▶ KnowledgeOrchestrator.ingestDocument ──▶ structured profile + raw index ──▶ per-turn
            profile retrieval ──▶ prompt
```

Nothing is injected as text. `run-er.mjs` keeps every mode's base pack loaded at once (as a user would have),
changes only the active mode's files for a case, reads the state back from the app before each case, and records
per row: the app's own `[V3]` trace line, the evidence tags of the prompt, the prompt itself, both answers
(streamed and shown), timings.

## Commands (from `benchmarks/natively-answer-quality/`)

```
node evidence-rich/build.mjs lint                 # authored truth: schema, needles, references, counts
node evidence-rich/build.mjs evidence             # sources → PDF / DOCX / text under evidence/ (macOS: Chrome, textutil)
node evidence-rich/build.mjs freeze               # oracles/ + datasets/ + FREEZE.json (refuses on lint errors)
node evidence-rich/build.mjs verify               # re-hash everything against the freeze

NATIVELY_ENV_FILE=<main checkout>/.env CODEX_HOME=<empty dir> \
  node evidence-rich/supervise-er.mjs --root <app worktree> --runs dev:er-dev-base,holdout:er-holdout-base --fresh-userdata

node evidence-rich/analyze.mjs --runs evidence-rich/results/er-dev-base            # funnel, isolation, latency (no judge)
AQ_JUDGE=opus node evidence-rich/judge/calibrate-er.mjs                            # 27 of 30 needed before any batch
AQ_JUDGE=opus node evidence-rich/judge/judge-er.mjs --set base --runs evidence-rich/results/er-dev-base
node evidence-rich/analyze.mjs --runs evidence-rich/results/er-dev-base --set base --judge opus
```

### The report's tables

```
node evidence-rich/report/mode-table.mjs base dev cf holdout          # per-mode table, evidence-condition lines
node evidence-rich/report/mode-slices.mjs e1 dev cf holdout           # Looking for work, Technical Interview, Sales, Call Center
node evidence-rich/report/paired-builds.mjs base e1 holdout           # one build against another, same rows
node evidence-rich/report/paired-delivery.mjs                         # delivered / not delivered, and their paired change
node evidence-rich/report/claim-pass-effect.mjs base e1               # shown text against the streamed draft
node evidence-rich/report/claim-pass-edits.mjs                        # cost of edits that drop a stated number
node evidence-rich/report/claim-pass-gate.mjs e1 holdout              # E4, offline
node evidence-rich/rail-offline.mjs --runs evidence-rich/results/er-dev-e1,evidence-rich/results/er-cf-e1   # E3, offline
```

`ER_JUDGE=astra` makes them read the canonical judge's files; the two judges are never pooled. Start reading at
`docs/EVIDENCE-RICH-QUALITY.md`. State on 2026-10-03: E1 kept on `fix/er-pack-whole` (`bab77f33`), not on main; the
gpt-6-astra chain is armed (`results/astra-chain.log`); raw run output is not committed.

## Judges

* `gpt-6-astra` over AgentRouter: the canonical judge (`judge_status: canonical`).
* `AQ_JUDGE=opus`: Claude Opus 5.5 through the headless Claude Code CLI (`judge_status: provisional`). AgentRouter
  lists no Opus 5.5 (`claude-opus-5`, `claude-opus-4-8` only, checked 2026-10-03); Evin: "use claude codes opus 5.5
  not agent routers".
* Same charter, same envelope, separate files (`<run>.astra.jsonl` / `<run>.opus.jsonl`), never pooled.
* Deterministic checks (`objective.mjs`) outrank either judge; a row where they overrule it is counted as
  `judge_disagreement`.

## Generator

`deepseek-flash` on the direct DeepSeek key, thinking off. The AgentRouter → DeepSeek route was to be tried first;
the build under test (`e000db4a`) has no AgentRouter provider, so that route cannot run without changing the
build. Every row carries `generator_provider`, `generator_model`, `generator_fallback`, `fallback_reason`.

## Rules

* Truth is frozen before the first run. A defective case is marked `benchmark_defect`, removed from scoring and
  fixed in a new dataset version; the oracle is never edited to make an answer right.
* Holdout rows, ids and questions are never printed (`--blind`).
* One app instance at a time. After a run: stop the app, delete the app worktree's `dist-electron`,
  `.agent/userdata` and the copied model weights.
