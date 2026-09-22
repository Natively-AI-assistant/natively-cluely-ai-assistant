# START HERE — reference-file retrieval & grounding

**Date:** 2026-08-28 · **Status:** investigation complete, **no production code changed** · **Origin:** beta tester, live Google Meet interviews (system audio + Deepgram) against a ~63,000-char Markdown reference file describing several integration projects.

Read this file first, then `01-ROOT-CAUSES.md`. Do not start from `03-FIX-PLAN.md` — the ordering there only makes sense once you know which pipeline stage each cause sits in.

## The four reported symptoms

1. A project that IS in the reference file sometimes returns *"I couldn't find that in the retrieved sections"* / *"I don't have enough verified detail."*
2. Follow-ups (*"what did you monitor after that?"*) jump to the wrong project.
3. Splitting the 63k file into per-project files helped a lot but not fully; he ended up duplicating critical facts into the 8k Real-time Prompt.
4. Technical Interview mode prioritised résumé/JD over his references; **General mode grounded better**.

Later, separately reported: *"introduce yourself, what are your AI projects"* refuses on live audio but answers correctly when typed into manual chat.

**All are explained.** Symptom → cause map (IDs from `01-ROOT-CAUSES.md`):

| Symptom | Primary cause | Contributing |
|---|---|---|
| 1. "couldn't find that" on a fact that IS in the file | **RC1** (second-person → unreachable) | RC2 (`sync`), RC7b (validator overwrite), RC12 (provider flip) |
| 2. Follow-ups jump to the wrong project | **RC9** (no project identity in chunks) + **RC3** (follow-up loses its pool) | RC11 (capitalisation-gated continuity), RC6 (scope leak) |
| 3. Splitting the file helped, but not fully | RC9 §"Why splitting helped" — filename restores identity | RC1 still fails second-person questions regardless of layout |
| 4. Technical Interview worse than General | **RC4** (mode never document-grounds) | RC1 — though TI is the *least-bad* mode on that axis (4/8 vs 2/8) |
| 5. Live audio refuses what typed answers | `02-WTA-VS-MANUAL.md` — governed-pack hard refusal | RC1 (phrasing), WTA-only deadline |

Symptoms 1–3 share RC1 as master cause; 4 and 5 have their own.

## The one-paragraph answer

**Any second-person question makes a reference file unreachable in all 9 modes.** `PERSONAL_RE` (`turn-classifier.ts:96`) matches bare `you`/`your`/`did you`/`do you`/`my`/`candidate`, which makes the turn a `USER_*` claim — and `REFERENCE_FILE` is authoritative for **no** `USER_*` claim. The turn plans résumé/JD/profile instead and the file is never in scope. In an interview every question is second person, so **none of them can reach the file**. Proved by feeding the real pipeline a chunk that *literally contains the answer* at score 0.99: 9/9 modes discard it. Chunking, embeddings, prefixes and anchoring are all downstream of a turn that never receives evidence.

## Documents

| File | What it is | Who needs it |
|---|---|---|
| `00-START-HERE.md` | This: state, landmines, first moves, skills | Everyone, first |
| `01-ROOT-CAUSES.md` | 12 root causes ordered by **pipeline stage** (planning → admission → delivery → ranking), each with `file:line` and verification status; plus rejected hypotheses | Anyone touching retrieval |
| `02-WTA-VS-MANUAL.md` | Why live-audio (WTA) refuses what manual chat answers — a separate architectural fault with 7 symptoms | "Works typed, fails on audio" |
| `03-FIX-PLAN.md` | 15 tasks, re-prioritised: decision layer first, chunking last | The agent doing the fixes |
| `04-EXPERIMENTS.md` | Both harnesses, measured results, limits, how to run his sanitized pack, how to read his debug logs | Validating fixes / triaging logs |

Harnesses live in `experiments/mode-audit/` (decision layer, TypeScript) and `experiments/chunk-sweep/` (retrieval quality, Python). Both read-only, neither imported by the app.

## Verification standard

Every claim is labelled **Executed** (ran the real production modules), **Read** (traced in source), or **Reported** (from the code-review agent, not independently re-checked). Respect the labels — one conclusion in this investigation was wrong precisely because it trusted a docblock.

| Claim class | Standard |
|---|---|
| Reachability (2/8, 0/6 second-person), token collisions, perfect-retrieval proof, follow-up pools, `[V3]` telemetry | **Executed** against real modules |
| Chunk sweep: sweet spot, budget survival, zero false refusals, continuity delta | **Executed live** — Gemini `gemini-embedding-2` + `gemini-2.5-flash` + `deepseek-v4-flash`, 7 sizes × 25 needles × 2 models |
| Production behaviour end-to-end | **Reviewed but not executed** on macOS and Windows — no app run, no packaged build, no live Meet session |
| Cross-platform impact of fixes | Stated per task in `03-FIX-PLAN.md`; all tasks are platform-neutral TypeScript by construction, not by testing |

## What changed during the investigation (read before quoting anything)

The conclusion inverted twice. If you have seen an earlier summary, it is stale.

1. **First pass:** "Technical Interview is uniquely broken; fix chunking." → Superseded.
2. **Correction:** the claim that non-doc-grounded mode keeps *one chunk per file* was **wrong** — per-file dedup was removed for all callers on 2026-07-31 (`ModeHybridRetriever.ts:1900-1929`). A **stale docblock** at `mode-retrieval-port.ts:216-226` still says otherwise and caused the error. The mode-inversion conclusion survives on other grounds (RC4); the magnitude does not.
3. **Cross-mode audit:** the identity-claim gap is worse in the other eight modes; **Technical Interview is the least-bad** on that axis (4/8 vs 2/8). RC1 became the master cause.
4. **Pipeline audit:** the live-audio failure is a third, independent mechanism (`02-WTA-VS-MANUAL.md`).

**Net:** the original chunking plan is now the *lowest* priority. It is still real and measured — just last.

## First moves

1. **Read `01-ROOT-CAUSES.md`.** Several guards in this subsystem exist for measured reasons; the doc says which are load-bearing so you don't "fix" one by deleting another.
2. **Do `03-FIX-PLAN.md` T1 as a brainstorm with the user, not a patch.** Whether a user's own reference file may evidence a `USER_*` claim is a product decision that changes what every mode is allowed to read.
3. **Ship T2 first if you want a safe win** — three bare tokens (`sync`, `standup`, `candidate`), bounded by a 106-term sweep, no policy implications.
4. **When his sanitized pack arrives, grep it for `sync`/`standup`/`candidate` before touching code** (`04-EXPERIMENTS.md` §3). One command, tests RC2 against real data.
5. **When his debug logs arrive**, check `[WhatToAnswerLLM] Active mode grounding` first — it decides which of the three refusal mechanisms you are looking at.

## Suggested skills

- **`superpowers:brainstorming`** — mandatory before T1 and T8 (product-surface decisions).
- **`context-os`** — a project skill for exactly this layer. Load before editing `electron/context-intelligence/policies/`.
- **`source-contamination-eval`** — mandatory after T1 and T8; guards the JD-as-experience and résumé-mislabelling holes that widening retrieval can re-open.
- **`superpowers:test-driven-development`** — T2, T3, T4 all have crisp assertions writable before implementation.
- **`superpowers:verification-before-completion`** — the CLAUDE.md completion report is mandatory and spans both platforms.
- **Not** `superpowers:systematic-debugging` — diagnosis is done; it will re-litigate settled hypotheses.

## Landmines

- **Two files outside this folder were changed to make the handoff work**, and nothing else: the repo-root `.gitignore` gained `!docs/retrieval-handoff/**` (this folder sits under a blanket `docs/*` ignore, so without it these documents are invisible to git and unreadable to any worktree agent), and `experiments/chunk-sweep/.gitignore` excludes the 6 MB embedding cache. **No file under `electron/` or `src/` was touched.**
- **If you have an earlier summary using hypothesis numbers** (H1–H8), the mapping is: H1→RC9, H2→rejected (see RC8), H3→RC10, H4→RC11, H5→RC4, H6→RC7b, H7→RC12, H8→RC9 §"Why splitting helped".
- **`git status` was already dirty on arrival** — notarization work in `scripts/`, `package.json`, `package-lock.json`, plus untracked `scripts/__tests__/stapler-inconclusive.test.mjs`. **Not ours.** Other agents share this working directory; diff before touching files you did not create.
- **Stale comments actively mislead here.** `mode-retrieval-port.ts:216-226` cost this investigation a wrong conclusion. **Verify behaviour against code, not docblocks** — and prefer executing the module over reading it. Both harnesses exist for that reason.
- **Never tune against recall@k.** It was 25/25 at every chunk size ≤1250 *and* in the worst configuration measured (where only 5/25 facts reached the model). Use budget-survival and reachability.
- **`text-embedding-004` is retired** (404). `gemini-embedding-2` @768d is live and is production's default. Anything still naming the old model is stale.
- **The refusal string is load-bearing in three places** — `documentGroundedPrompt.ts:804` (`SYSTEM_REFUSAL_RE`) and the two `IntelligenceEngine.ts` overwrite sites. Changing the wording without changing all three turns the detector into a no-op.
- **There are three independent refusal mechanisms** (`01-ROOT-CAUSES.md` RC7). Fixing one will not fix the others, and only one of them overwrites an answer that already streamed.
- **Raw e2e scores in `results.json` under-count correctness** — use `results_rescored.json`. Both are kept so the scoring change stays auditable.
