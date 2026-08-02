# Context Intelligence V3 deep-test defect campaign — final report (2026-08-01)

Companion to `deep-test-defects-2026-08-01-root-causes.md` (living investigation log with
file:line for every claim). Fixtures: `~/Downloads/Natively_Deep_Mode_Test_Pack/`.

## 1. Root causes (all reproduced by executed probe or measured replication before any fix)

| # | Defect | Root cause | Where |
|---|---|---|---|
| D1 | Profile facts missing | V3 profile corpus = deterministic renders of `structured_data` ONLY; raw text never persisted; `projects[].highlights` and `leadership[]` never rendered; canaries/7-stage list have no schema slot | `profile-retrieval-port.ts:167-172`, `KnowledgeOrchestrator.ts:605/718`, `KnowledgeDatabaseManager.ts:31-36` |
| D2 | Exact literals fail | (a) "What is the X?" for unlisted nouns → GENERAL_TECHNICAL → FAST, **retrieval never ran**; (b) tokenizer keeps hyphens → `TECH-SMALL-CANARY-524` one opaque token, fts 0.0000 | `turn-classifier.ts` (VALUE_LOOKUP noun-list boundary + self-sealing fallback), `lexicalTokens.ts:121` |
| D3 | Partial multi-file | Three separate mechanisms: FAST-skip (batch size); `who owns` → meeting claim in a mode with no transcript → retrieve=false (Priya); per-file floor walked global order so budget starved late files. Successes were capitalization accidents ("TTL", "QF-2026-0514") | `turn-classifier.ts` MEETING_EVENT_RE, `ModeHybridRetriever.ts:1896-1903` |
| D4 | PDF tail | **No truncation exists** (measured: 14/14 pages, 13 chunks, tail intact). Asymmetry: bare-identifier tail line shares zero vocabulary with the question (all chunks tie on "the"); head canary rode the legacy 500-char identity excerpt. Committed >batch-size combined-floor bug drops null-vector tails (already fixed in tree) | agent-3 measurements; `ModeHybridRetriever.ts:1910/1920` |
| D5 | General fallback masks misses | Acronym-definition escape (RTO/RPO: `onlyAcronymEntities` + missing nouns in DOCUMENT_RE); FAST path emits no disclosure; only CLARIFICATION acted on in the composer; `documentCentricMode` inert in OPEN_KNOWLEDGE modes | `turn-classifier.ts:219-229/442-449`, `prompt-composer.ts:263` |
| D6 | answerability:FULL lies | `evidenceSupportsClaim` = ANY single shared salient term ("backend" ⇒ framework question FULL); FULL-with-zero-claims when only GENERAL claims exist; two contradictory "support" definitions in one trace | `orchestrator.ts:276-306/334-341/564` |
| D7 | Role RESUME for project files | `sourceTypeForFile` fallback `allowed[0]` — technical-interview's allowed[0] is RESUME → ALL 5 technical fixtures stamped RESUME (probe-confirmed); PROJECT_FILE/CODING_SAMPLE unmintable by any port; planned-type filter then drops evidence | `mode-retrieval-port.ts:109`, `legacy-retrieval-port.ts:92-93` |
| D8 | Precedence unexplainable | No deterministic precedence: score-sort only; `filterByScopeAndVersion` has zero callers; every mode file stamped version 'legacy'; no status/source_name rendered to the prompt; PERMANENT_RULES invite a "likely rationale" | `legacy-retrieval-port.ts:107`, `context-packer.ts:65-80`, `prompt-composer.ts:92-94` |
| D9 | Wrong referents | `activeTopic` = first capitalized token of the latest question; personal pronouns resolved against it (she→Kubernetes); 5-word "How…" questions matched the bare-follow-up gate despite naming CampusMesh; state advanced with the REWRITTEN question (self-reinforcing drift) | `conversation-state.ts:151/166/191-227`, `orchestrator.ts:604` |
| D10 | Custom-mode job planning | Custom modes coerce to `general`, whose allowlist has no CANDIDATE_FILE/JOB_DESCRIPTION → claim∩mode = ∅ → planned [], STRICT_NOT_FOUND tested one line before generalKnowledgeAllowed; the persisted ModeSourceContract (which knows the roles) is never read by V3 | `mode-policy-registry.ts:147`, `turn-classifier.ts:623-628`, `orchestrator.ts:512-533`, `engine-bridge.ts:84-85` |

## 2. Overengineering findings

- **The fabrication boundary was a hand-maintained noun list** (VALUE_LOOKUP_RE/DOCUMENT_RE):
  every noun not on it routed a document question to model knowledge. Replaced by a structural
  rule (definite article + no concept complement + mode holds documents).
- **Two hand-synced claim→source maps** (CLAIM_TO_SOURCE vs CLAIM_AUTHORITY) — drifted twice
  historically; now ONE derived map.
- **Six source-role vocabularies** across layers; `[V3]` line mixed two alphabets in one key.
  (Partially addressed: port typing fixed; full vocabulary unification left as follow-up.)
- **Five sequential silent narrowing filters** (planned-type, claim-authority, score-cap,
  cross-port dedup, packer budget) with only stage-19 rejections traced — "20 candidates,
  0 evidence" was unexplainable. New documentSpecific/propertyMatched telemetry narrows this.
- **Dead machinery**: `filterByScopeAndVersion` (0 callers), 5/15 ClaimTypes never emitted,
  PROJECT_FILE/CODING_SAMPLE unmintable (now mintable), 6 fallback labels computed with 1 acted
  on (now 3 act), `trace.rejectedEvidence` hardcoded [].
- **No new layer was added to fix any defect.** Every fix lands inside an existing stage;
  net new code is rules/metadata within stages plus one derived map replacing a hand-written one.

## 3. Rejected hypotheses

- PDF tail truncation (page caps, char caps, embed-batch tail loss) — measured: all four fixture
  PDFs extract 100% of pages; chunker flushes the residual; OKF 420-word cap disproved by the
  281-word team_meet fixture failing identically.
- Retrieval scoring as the cause of the small-file misses (duration/owner/canary in .md/.txt) —
  measured: single-chunk files, fact-bearing chunk returned rank-1 whenever retrieval RAN.
- Per-file slot starvation for TECH-C (3 small files ≈ 420 tokens — everything fits).
- ModeHybridRetriever confidence gate suppressing evidence on the V3 path (telemetry-only there;
  allowRerank=false).
- esbuild dual-singleton / torn index / surface:unspecified (prior campaign, re-checked).

## 4. Architecture before → after

Stage count unchanged (no compensating layer added). Changes are INSIDE stages:
- Classification: noun-list boundary → structural definite-lookup rule; meeting vocabulary split
  conversational/attribution; document-deictic verbs recognized; fallback unsealed w/ concept carve-out.
- Source typing: positive-shape-only identity types; code→CODING_SAMPLE; general modes extend
  allowed types from their own attachments (deterministic role-based routing, the prompt's
  "preferred architecture" step 2).
- Retrieval: additive hyphen sub-tokens; positional (first/last page) restore; round-robin
  per-file floor. Order remains lexical+vector hybrid → filters → pack.
- Answerability: per-claim property-head matching (EvidenceCoverage semantics); weak topical
  overlap caps at PARTIAL.
- Generation: provenance (source_name+status) rendered; precedence + honesty contracts;
  three fallback labels act instead of one.
- Profile: structured sections (precision) + lossless raw-text sections (recall floor).

## 5. Files changed (this session)

electron/context-intelligence/: question/turn-classifier.ts, question/conversation-state.ts,
orchestration/orchestrator.ts, orchestration/engine-bridge.ts, policies/source-authority-policy.ts,
retrieval/mode-retrieval-port.ts, retrieval/profile-retrieval-port.ts, generation/prompt-composer.ts,
generation/context-packer.ts · electron/services/: modes/lexicalTokens.ts, modes/ModeHybridRetriever.ts,
ModesManager.ts, knowledge/v3ProfileSources.ts · electron/llm/ActiveProfileContext.ts ·
electron/ipcHandlers.ts, electron/IntelligenceEngine.ts (V3 wiring blocks only) ·
premium/electron/knowledge/: types.ts, KnowledgeDatabaseManager.ts (guarded raw_text migration),
KnowledgeOrchestrator.ts (persist raw_text) · tests: 3 new suites + 1 documented assertion update
(SourceAuthorityAndScope: RESUME now DOCUMENT_FACT-authoritative).

## 6-7. Tests added & results

- `context-intelligence/__tests__/DeepTestDefects2026_08_01.test.mjs` — 47 tests (D2,D3,D5,D6,D7,D8,D9,D10 + non-regression) — **47/47**
- `context-intelligence/__tests__/ProfileLossless2026_08_01.test.mjs` — 8 tests (D1 end-to-end through the real port) — **8/8**
- `services/__tests__/RetrievalExactLiteral2026_08_01.test.mjs` — 6 tests (tokenizer, positional restore, floor) — **6/6**
- All were failing-before (verified against pre-fix build) except marked NON-REGRESSION.

Full runs: `npx tsc -p electron/tsconfig.json --noEmit` clean ·
`node --test electron/context-intelligence/__tests__/*.test.mjs` → 509 tests, 2 fail
(AnswerPolicy persisted-store parallel-run collision — reproduces WITHOUT this session's changes) ·
`npm test` → pass except better-sqlite3 ABI (needs electron runner) + ZerofillDetector (scans
main.ts, which carries OTHER uncommitted work) · `test:intelligence` → 953 tests, 2 fail, both
pre-existing at HEAD (assertNoAuthorityContradiction definition exists in committed integration.ts;
coordinator-throw contract in unmodified context-os). **Zero failures attributable to this session.**

## 8. Telemetry before/after

Before: `{..., answerability:"FULL", fallback:"NONE"}` for a fabricated canary answer.
After: `[V3]` line adds `documentSpecific` + `propertyMatched`; a masked failure now reads
`{documentSpecific:true, propertyMatched:false, answerability:"PARTIAL"|"NONE",
fallback:"PARTIAL_SUPPORT"|"STRICT_NOT_FOUND"}` and the composer receives matching directives.

## 9. Performance

- No new LLM calls anywhere (0 before → 0 after on the decision path).
- Retrieval stages unchanged; added work is O(tokens) hyphen splitting, one regex pass for
  positional locators, and BM25 over ~10 extra raw-text profile sections (~µs–ms scale).
- Former FAST-path questions that now retrieve pay one local hybrid retrieval (~50-200 ms,
  no network beyond the existing embedding call). Concept/coding questions keep FAST.
- Index size: raw_text column adds ≤200KB/profile doc; no new embeddings.

## 10. Remaining risks (explicit)

1. **Live end-to-end not rerun**: everything verified is deterministic-layer (classification,
   retrieval, packing, composition). The model's final answers with real embeddings + provider
   need a rerun of the deep-test pack in-app (the [V3] line now carries enough to adjudicate
   each turn). RTO/RPO value delivery in particular relies on the vector arm ranking the
   recovery chunk (lexical "RTO"≠"recovery objective" mismatch remains).
2. Existing profile docs get raw text via the disk fallback only for text formats at their
   original path; PDFs ingested before today need re-upload for the lossless path.
3. Short-chunk fts bias (sqrt(|U|) denominator) NOT changed (regression risk outweighed);
   retired-decoy outranking is mitigated by status provenance, not eliminated.
4. Six role vocabularies still exist across legacy layers (only V3's minting fixed).
5. Pre-existing failures listed in §7 remain (owned by other work streams).
6. propertyHeadTerms is head-final-English heuristic; unusual phrasings may grade PARTIAL
   where FULL is deserved (safe direction — discloses, never fabricates).
