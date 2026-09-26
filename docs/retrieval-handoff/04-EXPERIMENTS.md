# Experiments, harnesses and triage

Two read-only harnesses, both outside the TypeScript build, neither importing into the app:

| Harness | Question it answers | Language |
|---|---|---|
| **`experiments/mode-audit/`** | *Does the reference file get retrieved at all?* — the decision layer. Executes the real `decide()` / `classifyTurn()` / `orchestrate()` / `authorityOf()`. | TypeScript, bundled with esbuild |
| **`experiments/chunk-sweep/`** | *Once retrieved, does the right chunk rank and survive the budget?* — retrieval quality. Live Gemini + DeepSeek. | Python (`requests` + `python-dotenv`) |

**Why they execute rather than read:** this investigation produced one wrong conclusion by trusting a stale docblock (`01-ROOT-CAUSES.md` RC4 correction). Everything load-bearing is now run, not read.

---

# 1. Mode audit — the decision layer

```bash
cd experiments/mode-audit
npx esbuild interview-reachability.ts --bundle --platform=node --format=cjs --outfile=/tmp/r.cjs && node /tmp/r.cjs
```

| Script | Output |
|---|---|
| `interview-reachability.ts` | How many of 8 realistic interview questions reach the file, per mode (the 2/8 vs 4/8 headline) |
| `perfect-retrieval-proof.ts` | Feeds a chunk *containing the answer* at score 0.99 through the real port chain — proves the drop is in the decision layer |
| `collision-sweep.ts` | Sweeps 106 product/technical terms × 9 modes for misrouting tokens (found `sync`, `standup`, `candidate`) |
| `name-collisions.ts` | Narrower product-name variant |
| `per-mode-matrix.ts` | Per mode: contract seed, `forceDocumentGrounding`, file stamping, per-question verdict + drop reason |
| `reachability.ts` | Per-question reachability with drop reasons |

**Drop reasons** mirror the real filter order in `legacy-retrieval-port.ts`:
- `NO_RETRIEVAL` — the claim's authoritative sources aren't in the mode's allowlist; `shouldRetrieve` false; nothing queried.
- `PLANNED_TYPE_FILTER` — retrieval ran, plan targeted other types, chunks dropped before scoring (`:143`).
- `CLAIM_AUTHORITY` — the file's type isn't authoritative for the claim (`:144-146`).

**Caveat:** models admission only. A question can read `OK` here and still fail because the right chunk didn't rank — that's what the chunk sweep measures.

---

# 2. Chunk sweep — retrieval quality

```bash
cd experiments/chunk-sweep
python3 generate_corpus.py   # deterministic; once
python3 sweep.py             # ~350 generations; caches embeddings; resumable
python3 rescore.py           # -> results_rescored.json   (READ THIS ONE)
python3 ablation.py          # giant / leaf-prefix / anonymized configs
```

**Setup.** Synthetic 64,790-char reference file mirroring the tester's structure: 5 integration projects × 6 sections, each with 5 unique needles (idempotency key format, retry count+backoff, DLQ name, p95 SLO, monitoring metric). 25 direct questions + 5 follow-ups.

**Chunker** (`chunker.py`) — the reference implementation for fix T9: whole heading sections packed greedily to target; sections >1.5× target subdivided at blank-line paragraph boundaries only; no sentence ever split; every chunk prefixed with its heading path; tokens ≈ chars/4.

**Models.** Embeddings Gemini `gemini-embedding-2` @768d (`text-embedding-004` returned 404 — retired — on 2026-08-28, itself a live demonstration of RC12's churn risk). Retrieval cosine top-12. Packing greedy into 3600 tokens, last chunk truncated. Generation at temperature 0: `gemini-2.5-flash` and `deepseek-v4-flash`.

## Results

E2E columns are value-token rescored (`rescore.py` — models legitimately answer "p95 latency SLO of 450 ms" as "450 ms"; raw exact-phrase scores preserved in `results.json`).

| size (tok) | chunks | recall@12 | budget-survival | e2e gemini (refusals/false) | e2e deepseek | continuity plain | anchored |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 150  | 136 | 25/25 | 25/25 | 25/25 (0/0) | 25/25 (0/0) | 5/5 | 5/5 |
| 300  | 66  | 25/25 | 25/25 | 25/25 (0/0) | 25/25 (0/0) | 5/5 | 5/5 |
| 512  | 35  | 25/25 | 25/25 | 25/25 (0/0) | 25/25 (0/0) | 5/5 | 5/5 |
| 800  | 30  | 25/25 | 25/25 | 25/25 (0/0) | 25/25 (0/0) | 5/5 | 5/5 |
| 1250 | 15  | 25/25 | 25/25 | 25/25 (0/0) | 25/25 (0/0) | 5/5 | 5/5 |
| 2000 | 10  | 25/25 | 24/25 | 24/25 (1/0) | 24/25 (1/0) | 5/5 | 5/5 |
| 2500 | 8   | 25/25 | 22/25 | 22/25 (3/0) | 22/25 (3/0) | 5/5 | 5/5 |

1. **E2E failure is entirely budget-survival.** After rescoring, `correct == survived` for every size and both models, and **false refusals were zero everywhere** — with clean prefix-labelled evidence at temperature 0, neither model ever refused a fact that was present. Every refusal the tester saw is upstream of the model.
2. **Sweet spot 300–512 tokens**, by budget-survival first, then headroom: at 300–512 the budget carries 7–12 whole chunks (redundancy against ranking noise); at 1250 only ~3. Production's ~225 tokens already sits in this band — **size is not the problem**.
3. **Degradation above ~1250** is whole facts falling off the packed evidence.

## Giant-chunk ablation

> **Scope note.** Models the *mechanism* of budget starvation; **not** a replay of production, which chunks a 63k file into ~85–95 windows regardless of mode and never hits the one-chunk case.

| config | chunks | recall@12 | budget-survival |
|---|---:|---:|---:|
| giant-16000 | 1 | 25/25 | **5/25** |
| sweet-300 | 66 | 25/25 | **25/25** |

Recall passes trivially while only the first project's 5 needles survive packing. **The strongest demonstration that recall@k is the wrong metric** — it was perfect in the worst configuration measured.

## Continuity: the measured value of anchoring

Containment saturates (top-12 retrieves all five projects' Monitoring sections). The discriminating measure is **project precision** (`continuity_precision.json`):

| config | query form | project-precision@12 | top-1 = right project | answer rank |
|---|---|---:|---:|---|
| sweet-300 (heading paths) | plain | 0.20 (chance) | 1/5 | scattered |
| sweet-300 | **anchored** | **0.60** | **5/5** | **1, every time** |
| npfx-300 (leaf-only, as production) | plain | 0.00 | 0/5 | scattered |
| npfx-300 | anchored | 0.08 | 1/5 | mostly 1–2 |

**The two fixes only work as a pair.** Anchoring without heading paths recovers almost nothing; heading paths without anchoring leave plain follow-ups at chance. Production has neither.

## Limits — read before drawing conclusions

1. **Recall saturates** (25/25 at every size ≤1250). It cannot rank the sizes. Never tune against it.
2. **Containment continuity saturates too** — use project precision.
3. **Raw e2e under-counts** — use `results_rescored.json`. Both files are kept so the scoring change is auditable.
4. **The corpus is synthetic and benign** — clean headings, no OCR noise, no ASR errors in the questions, needles that are exact substrings. Treat the numbers as **upper bounds**.
5. **The giant ablation is a mechanism demo, not production.**

---

# 3. Running the tester's sanitized pack

He prepared a pack with **both** a combined file and split per-project files — exactly the A/B this harness measures. When it arrives:

1. **First, before any code change:** `grep -i '\bsync\b\|\bstandup\b\|\bcandidate\b'` over his file and question list. That single command tests RC2 against his real data and is the cheapest high-value check available.
2. Drop his combined file at `corpus/combined_reference.md`; write `corpus/needles.json` with the same shape (`{"direct":[{project,kind,question,answer}], "followups":[...]}`), every `answer` an **exact substring**. Take questions from his reported failures **verbatim** — the value is in his phrasing.
3. `python3 sweep.py && python3 rescore.py && python3 ablation.py`.
4. For the split-files case, either concatenate his per-project files with filenames as `##` headings, or extend `eval_config` to take a file list — the per-file floor is `files.length > 1`-gated in production, so multi-file is the honest way to measure it.
5. **Also run his questions through `experiments/mode-audit/`** — his phrasings are the real test of RC1, and this is the first chance to measure it on genuine ASR-shaped questions rather than ours.

---

# 4. Reading his verbose debug logs

Settings → General → Advanced Settings → Verbose Debug Mode. Map each symptom to the line that confirms or eliminates it:

| Look for | Tells you |
|---|---|
| `[WhatToAnswerLLM] Active mode grounding` → `documentGroundedCustomModeActive`, `hasReferenceFiles` | Whether doc-grounding was ON. **Check this first** — it decides which fix applies (RC4 vs the WTA governed path). |
| `[V3] … planned=[…] evidence=0 answerability=NONE fallback=DOCUMENT_FACT_NOT_FOUND` | **The RC1 signature.** If `planned` lists only RESUME/JD/PROFILE_FACT on a question about his project, that's the master cause. |
| `intent=[PERSONAL_EXPERIENCE]` on a project question | RC1 confirmed for that turn. |
| `MEETING_STATEMENT` on a non-meeting question | RC2 — check the question for "sync"/"standup". |
| `repair_used: doc_grounded_refusal` / `doc_grounded_safe_refusal_after_repair_reject` | The refusal was an **overwrite of a streamed answer** (RC7b) — highest-value line for symptom 1. |
| `validation_failed` + `reason` | Which coverage rule fired. |
| `referentResolution` (`applied`, `referent`, `activeTopic`, `reason`) | RC11/RC6 — a stale or absent `activeTopic` on a "that project" turn. |
| `[EmbeddingProviderResolver] Selected provider` / `Primary query embedding failed via … falling back to` | RC12 provider churn. |
| `HYBRID performHybrid vectors` (`persistedHits`, `missingCount`) | `missingCount > 0` on a settled file ⇒ space flip (RC12). |

`NATIVELY_CONTEXT_DEBUG` gates richer JSONL (`electron/context-intelligence/debug/`) carrying full `attempts[]` with `rejections[]`. `PLANNED_TYPE_FILTER` / `CLAIM_AUTHORITY` appearing there on his reference chunks is the direct fingerprint of RC1.

**Two log traps:**
- The `[V3]` summary can read `candidates:1, admitted:1, rejected:0` while `evidence=0` — `PLANNED_TYPE_FILTER` drops go to `attempts[].rejections`, not the summary counter. **Never triage from that line alone.**
- A clean quit truncates the user-facing debug log, so captures arrive empty. Ask him to reproduce and copy the log **before** quitting.

---

# 5. Validating a production change

- **T9 (heading paths):** port the new prefix into `chunker.py`'s `_context_prefix`, run `ablation.py`, compare `sweet-*` vs `npfx-*`; `continuity_precision.json` holds the 0.60-vs-0.08 signal.
- **T10 (anchoring):** already measured by the `anon-*` configs vs anchored continuity rows.
- **T1/T2/T5/T8 (decision layer):** `interview-reachability.ts` and `collision-sweep.ts` are the gates.
- **T3/T4 (pipeline, refusals):** not measurable here — the harness's models never false-refuse (0/350). Needs app-level tests against `validateDocumentGroundedAnswer` and assertions on the dispatched user message.

Add `experiments/` to lint/type exclusions if CI complains; it is deliberately outside the TypeScript build. Keys come from repo-root `.env` (`GEMINI_API_KEY` required, `DEEPSEEK_API_KEY` optional). Embedding caches under `cache/` are gitignored and regenerate on demand.
