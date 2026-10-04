# Context limits in Natively — every active limit, where it lives, what it does (2026-10-04)

Build read: local `main` at `efc126a9` (worktree `er-main`). Generator route for runtime probes: AgentRouter → DeepSeek
(`deepseek-v4-flash`, `/v1/messages`), the provider the app was set to; direct DeepSeek only for the provider-limit probes.
Nothing in the app was changed for this work.

How each row was established:
- **code** — the constant and its live caller were read in the source (file:line below). Three independent code traces
  produced the first list; every constant in it was then re-read by grep in `er-main` (all present, values as stated).
- **runtime** — a probe drove the real app (`evidence-rich/limits/probe.mjs`) and read the request the app actually sent
  (the dev-only prompt recorder), or the provider was called directly. Results: `CONTEXT-TRUNCATION-TESTS.md`.
- **DEAD** — present in code, not on the V3 answer path (V3 = the path both the heard and the typed answer use today).

"Tokens" in the app always means the estimate `ceil(chars / 4)` (`context-packer.ts:35`, `modelCapabilities.ts:309`).
There is no tokenizer anywhere in `electron/`. Measured against DeepSeek's own counts it is off in both directions
(`token-ratio`, section 6 of the tests doc): English prose about 0.8×, Chinese 2.2×, Japanese 2.6×, Russian 1.3×,
quote-heavy JSON and numeric CSV about 1.5×.

## 1. Summary table

| Component | Current max | Unit | Actual behaviour | Silent truncation? | Recommended action |
|---|---|---|---|---|---|
| File upload | 50 MB (`SAFE_DOCUMENT_MAX_BYTES`) | bytes | refused with a generic "could not parse or too large" | no (error shown, but not which) | say "file is over 50 MB" |
| Reference file parsing | none (whole text extracted; PDF no OCR) | chars | runtime: 256,514 chars extracted whole, 7/7 planted facts present | no | keep; surface image-only PDF pages |
| Reference file storage | none (`content TEXT`) | chars | whole text stored | no | keep |
| Reference chunking | target 350 / max 1000 est. tokens, no overlap; tables and code fences never split | tokens (est.) | runtime: 161 chunks for a 64k-token file, all ready | no | keep; watch unsplit tables |
| Embedding input | 512 model tokens (e5-small) | model tokens | vector covers the chunk head only; text not cut | ranking only | keep (chunks are ~350) |
| Reranker input | 512 model tokens (MiniLM, query + passage) | model tokens | scores the chunk head only | ranking only | keep |
| Whole-file read (small corpus) | 1,400 (`SMALL_CORPUS_MAX_TOKENS`) | tokens (est.) | every file whole | no | keep |
| Whole-file read (pack) | 12,000 (`WHOLE_PACK_MAX_TOKENS`) for ALL the mode's files together | tokens (est.) | runtime: ≤ 11,800 → the whole file is in the request; ≥ 12,500 → 3–5 retrieved chunks (~7k chars) | **no cut — a switch**: above it the model sees chunks, not the file | measure a higher threshold (Phase 2) |
| Retrieved evidence per turn | 1,200–2,400 per mode (2,400 with 2+ files), 6–8 items (×3 when exhaustive) | tokens (est.) / items | runtime: 3–5 items above 12k | yes (items left out, trace only) | see PROMPT-BUDGET.md |
| Retriever vs packer budget | same number, different measure (packer counts ~95 tokens of tag per item) | tokens (est.) | code: last 1–2 retrieved chunks can be dropped by the packer | yes | count the tag in the retriever, or reserve it |
| Files per mode | none | files | runtime: 12 small files all whole; above 12,000 in total, TYPED questions miss named facts in other files (6 × 2,100, 10 × 3,000; lexical-only retrieval while the local embedder is active); heard questions found them | no cut — a miss | fix typed-path retrieval (bottleneck 2) |
| Profile (résumé + JD) whole | 6,000 for the two together (`PROFILE_WHOLE_MAX_TOKENS`) | tokens (est.) | runtime: 2,500 + 2,500 whole; 3,500 + 3,500 and 1,000 + 8,000 passages (a long JD takes the short résumé out too); named facts found either way | no cut — a switch | see PI-LIMITS.md |
| Profile document ingest | 200,000 (`MAX_PROFILE_DOCUMENT_CHARS`) | chars | refused with an error | no (error shown) | keep |
| Typed message | none (renderer, IPC, handler, composer) | chars | runtime: 400,000 chars → head, middle markers and tail in the request; BUT line breaks removed and the speech cleaner deletes repeated and "filler" words (right, basically, I mean…) | not truncated; **altered** | do not run the speech cleaner on typed text |
| Heard question | latest interviewer turn in last 180 s; interim tail ≤ 1,200 | s / chars | code | interim only | keep |
| Spoken transcript in the prompt | 2,400 (`SPEECH_WINDOW_MAX_CHARS`), newest lines, last 180 s | chars | runtime: a 20-line (~3,200-char) meeting already loses line 1 | **yes** | see bottleneck 1 |
| Older speech (live-transcript retrieval) | windows of 600 chars, BM25, score ≥ 0.2 × best | chars / score | runtime + offline: a long or multi-part question's own window scores 1.00 and every fact window 0.15–0.16 → none admitted; a short targeted question did recall line 2 of 80 | **yes** | see bottleneck 1 |
| Conversation history | 9,600 full + 9,600 condensed (q ≤ 600, gist ≤ 220); ring 400 turns, answer 1,200, question 1,200 | chars / turns | runtime: facts from turns 1, 20 and 39 of a 40-turn chat all in the request | condensed, then dropped | keep |
| Realtime / pinned instructions | 8,000 | chars | slice + "…[truncated]" | yes (no notice to the user) | show a count in the editor |
| Screen text | 1,200-char chunks; 8,000 per turn in history | chars | packer drops what does not fit | yes | keep |
| System prompt | no cap; measured 23,037–26,065 chars | chars | never cut | no | keep (it is ~5.8k provider tokens) |
| Final prompt (cloud) | none — `fitContextForCurrentModel` returns early at ≥ 100k context; every cloud model is a flat 128k in `TIER_BUDGETS` | — | never cut before the call | no | keep; record real counts |
| Final prompt (Ollama / small local) | (ctx − 2,000 − system) × 4 chars | tokens (est.) | lines removed from the TOP of the user message: the question goes first | **yes** | trim evidence, never the question |
| Provider input (DeepSeek, direct and via AgentRouter) | 1,048,576 (`GET /models`) | provider tokens | runtime: 237,849 tokens accepted on both routes (HTTP 200; 15.8 s via AgentRouter) | — | none needed |
| Output tokens requested | 65,536 (`getDeepseekMaxOutput` = min(393,216, 65,536)) | provider tokens | never the binding limit | — | — |
| Output shown | 16,000 visible chars (`MAX_STREAM_OUTPUT_CHARS`) | chars | runtime: a 900-line copy stopped at 16,001 chars mid-entry (689 of 900) | yes in the text (typed path sets `incomplete`; overlay state not captured) | say in the answer that it was cut |
| Claim pass material | 96,000 (`CLAIM_VERIFIER_MATERIAL_MAX_CHARS`) | chars | head-cut beyond it | yes, rare (largest real prompt 48,716) | keep |
| Other repairs (replay) | 24,000 (`REPLAYED_ANSWER_PROMPT_MAX_CHARS`) | chars | runtime: the heard "corrected answer" repair runs on ~20 % of heard turns (never typed), cut at 24,000 every time since E1, lacks a needed fact on 1–4 turns per run; whether its text is shown is not recorded | **yes** | measure, then give it the claim pass's cap |
| Claim pass time | 3,500 ms (6,000 with images) | ms | original answer kept | no | keep |

## Top three bottlenecks (measured)
1. **Spoken context is short and older speech rarely comes back.** The prompt holds the last 2,400 chars of speech
   (about 90 seconds); a 20-line exchange already loses its first line, in General, Team Meet and Call Center.
   Retrieval of older speech normalises every window against the window that contains the question itself, so for a
   long or multi-part question every fact window falls under the 0.2 floor (0.15–0.16) and nothing is admitted.
   Heard answers are Natively's core, so this ranks first.
2. **Above 12,000 est. tokens of reference files the model sees 3–5 pieces, and typed retrieval misses.** A
   whole-document question drops from 7/7 to 2–3/7 facts 700 tokens past the switch. On the typed path, with
   several files, lexical-only retrieval misses uniquely named facts (2 of 3 asked files at 6 × 2,100 and
   10 × 3,000); the heard path found them. The switch is in chars/4, so it comes 2–2.6× sooner in Chinese/Japanese.
3. **Typed text is changed before the model reads it.** Line breaks are removed and the speech cleaner deletes
   words it treats as filler ("the right answer" → "the answer"; "basically", "I mean", repeated words). It happens
   on every typed turn that contains those words, and the user's exact words appear nowhere in the request.
   Ranked above the heard "corrected answer" repair's 24,000-char cut (≈ 20 % of heard turns run it, 1–2 % lose a
   needed fact, and whether its text is shown cannot be read from the recordings), and above the 16,000-char output
   cap (rare: needs a > 16k-char answer, but silent in the overlay).

## 2. Where the limits live (code, er-main @ efc126a9)

Paths relative to the app root.

### Reference files (upload → prompt)
| Stage | file:line | value | behaviour |
|---|---|---|---|
| Upload size | electron/services/SafeDocumentTextExtractor.ts:100,250 | 50 MB | throw; generic message (ipcHandlers.ts:18190) |
| Types | SafeDocumentTextExtractor.ts:18-30,244 | 48 extensions, `.doc` refused | throw |
| Parse timeout | SafeDocumentTextExtractor.ts:110-125 | min(5 min, max(30 s, MB × 2 s)) | reject |
| PDF | SafeDocumentTextExtractor.ts:259-293 | no page cap, no OCR | image pages give no text; console only |
| Files per mode / storage | ModesManager.ts:1110, DatabaseManager.ts:844,2287 | none | whole text stored |
| Chunk router | ModeHybridRetriever.ts:1077-1112 | tabular → DocumentMap (ToC) → semantic | — |
| Semantic chunks | semanticChunker.ts:66,79-84 | min 100 / target 350 / max 1000 / merge 250 est. tokens; atomic units unsplit | — |
| DocumentMap chunks | ModeHybridRetriever.ts:145-146; DocumentMap.ts:476 | 140 words, overlap 30, ceiling 420 | — |
| Tabular chunks | DocumentMap.ts:404-409 | ≤ 120 chunks; rows per chunk grow | nothing dropped |
| Embedding batches | ModeHybridRetriever.ts:152-226 | 100 / 16 per batch, 120,000 chars | failed tail lexical-only, still `ready` |
| Live embedding | ModeHybridRetriever.ts:159 | 24 chunks per turn | rest lexical this turn |
| Whole-file switches | mode-retrieval-port.ts:298,309,337,352,366-380 | 1,400 / 12,000 est. tokens over all files | — |
| Rerank pool | rerankPool.ts:77; ModeHybridRetriever.ts:2282,341 | 30 (60 exhaustive), one per file guaranteed | un-pooled tail kept in order |
| Rerank time | rerankBudget.ts:34-40 | 1,200 ms bundled; 3,000 heard / 8,000 typed when user-selected | order kept |
| Retriever budget | ModeHybridRetriever.ts:2838-2893 | `tokenBudget`, per-file floor 2, section cap 4, first chunk always admitted | skip |
| Plan | orchestrator.ts:216-222,308,333-345,399-409 | multi-file 8 / 2,400; small corpus +T+1,000; whole pack +T+120/file, +files items; ×2 candidates / ×3 accepted when exhaustive | — |
| Gates | legacy-retrieval-port.ts:210-212 | planned type; claim authority (whole mode files exempt since efc126a9) | drop, trace only |
| Packer | context-packer.ts:35,130-144; prompt-composer.ts:1395 | evidenceTokens (×3 exhaustive); item that does not fit is skipped whole; count cap after | trace only |

Per-mode policy (mode-policy-registry.ts:227-396; candidates / accepted / evidence tokens): general 20/6/1500,
call-center 20/6/1800, sales 20/6/1800, recruiting 20/6/1800, team-meet 20/6/1200, looking-for-work 20/6/1800,
technical-interview 20/6/1600, lecture 24/8/2000, seminar 24/8/2400. Custom modes use general's.

### Prompt composition (both answer paths)
| Input | file:line | value |
|---|---|---|
| Typed message | NativelyInterface.tsx:12062 (single-line `<input>`), preload.ts:2457, ipcHandlers.ts:2043, prompt-composer.ts:1477 | no cap |
| Heard question | IntelligenceEngine.ts:2216,3470; interimInjectionGuard.ts:69 | 180 s window; interim ≤ 1,200 chars |
| Transcript store | SessionTracker.ts:135-136,1025-1031 | 180 s, 500 items |
| Speech window | conversationHistoryPolicy.ts:80,97-107 | 2,400 chars, newest whole lines |
| Live-transcript windows | live-transcript-port.ts:47,50,143-147 | 600 chars, score ≥ 0.2 of best |
| History | engine-bridge.ts:408,481-483; history-render.ts:74-76,118-122,186-208; conversation-state.ts:149-207 | 9,600 + 9,600 chars; 400 turns |
| Instructions | ModesManager.ts:1521,1567-1568 | 8,000 chars |
| Profile whole | profile-retrieval-port.ts:175,196-199,676 | 6,000 est. tokens (résumé + JD together) |
| Profile ingest | premium/electron/knowledge/DocumentReader.ts:24,37 | 200,000 chars, refused above |
| Screen | screen-retrieval-port.ts:47; orchestrator.ts:200,210 | 1,200-char chunks; 600-char query |
| Local model fit | LLMHelper.ts:3405-3430,3475,13077-13084; localContextTrim.ts:119-123 | from the top |

### Provider call, output, second passes
| Item | file:line | value |
|---|---|---|
| Context table | modelCapabilities.ts:20-24 | cloud 128,000 flat (DeepSeek's real window is 1,048,576) |
| Prompt fit | LLMHelper.ts:3421 | `if (maxContextTokens >= 100_000) return text;` |
| max_tokens | LLMHelper.ts:368,410,2706-2707,7417-7455,12520 | 65,536 (direct and AgentRouter) |
| Visible output | liveDeadlines.ts:457; LLMHelper.ts:9528,9553 | 16,000 chars |
| Long form (summary) | liveDeadlines.ts:494 | 120,000 chars |
| Replay repairs | LLMHelper.ts:1012,1047-1066 | 24,000 chars |
| Claim pass | claimVerifier.ts:32-34,273,277,402-405 | 96,000 chars; 3,500 / 6,000 ms |
| First-token ceilings | liveDeadlines.ts:579-603; LLMHelper.ts:3088,3141-3152 | 8,000 ms direct DeepSeek; 8,000–20,000 AgentRouter |
| Stall | liveDeadlines.ts:414; textStreamFallback.ts:61 | 2,500–8,000 ms idle; 20,000 ms engine stall (not marked truncated) |

## 3. DEAD or not on the V3 path
- `ModeHybridRetriever` `DEFAULT_TOKEN_BUDGET 1800`, `DEFAULT_TOP_K 6`, `DOC_GROUNDED_*_LOCAL` — V3 always passes its own.
- `ModeContextRetriever.ts` lexical budgets (3,600; 45-word sub-chunks; 700-char identity excerpt; 20,000-char windows) and
  the whole `formattedContext` — V3 reads `chunks` only.
- `isSmallReferenceCorpus` — no callers.
- `fitTranscriptForCurrentModel`, `truncateTranscriptToFit` — no callers. `TIER_BUDGETS.output` — never sent.
- `PackBudget.transcriptTokens`, `screenTokens` — never read by the packer.
- `COMBINED_CTX_CAP 60,000` — only legacy non-V3 typed chat (`skipModeInjection=false`).
- `DOM_CONTEXT_MAX_CHARS 25,000` — legacy WTA packet only.
- `WhatToAnswerLLM` transcript fitting, `prepareTranscriptForWhatToAnswer(…,12)`, `windowTurns = 6` — legacy packet,
  thrown away on V3 turns (`_wtaUserBase = _v3p?.user ?? …`).
- OKF knowledge pack (300,000-char threshold) — the mode port never reads it.
- Read windows that only classify (first 6,000 / 600 / 10,000 chars) — they cut nothing.

Not traced: Direct Assist (its own surface, full file text, `CONTEXT_TOO_LARGE` check), meeting summary.

## 4. What the user is told (request §29) — code read, er-main

| Situation | Told? | What they see |
|---|---|---|
| File too large (> 50 MB) | yes, vaguely | "Could not parse the selected file. It may be corrupt, password-protected, unsupported, or too large." (`ipcHandlers.ts:18190`) — the same text for every failure except `.doc` |
| Extraction failed / empty | yes, vaguely | same generic text |
| Scanned PDF, image-only pages | **no** | no OCR; pages give no text; console `INGESTION AUDIT` only; the file shows as ready |
| Only part of a file embedded | partly | the badge says "Keyword" (`premium/src/ModesSettings.tsx:200`) when the whole file is lexical-only; a partial embedding failure still shows `ready` |
| Too many files | n/a | no limit exists |
| Mode's files over 12,000 est. tokens (the model now sees 3–5 pieces, not the file) | **no** | nothing; the file shows ready |
| Typed input truncated | n/a — never truncated | but line breaks and "filler" words are removed silently (tests §3) |
| Spoken context dropped (older than ~2,400 chars) | **no** | nothing |
| Answer cut at 16,000 chars | **no in the overlay** | `gemini-stream-done` carries `incomplete: true` (`ipcHandlers.ts:2651`), but the overlay's handler and the preload type ignore it (`NativelyInterface.tsx:8430`, `preload.ts:2469`); the phone mirror does say it stopped. Code read; the overlay state was not captured at runtime |
| Profile document > 200,000 chars | yes | error at upload |
| Profile over 6,000 est. tokens (passages, not whole) | no | nothing |

### Recommendation (§30, not implemented)
Per file, after indexing, one plain line from three states that are true and checkable:
"Read in full" (the mode's files fit the whole-file read), "Searchable — Natively reads the most relevant parts
for each question" (over the whole-file size), and a specific failure ("No text found — this looks like a scanned
PDF", "Over 50 MB"). Do not say "indexed successfully" for a file the model will only ever see in pieces, and do not
add a "too large" state for sizes the app handles by retrieval. In the overlay, show the existing `incomplete` flag
("Answer cut off at the length limit").
