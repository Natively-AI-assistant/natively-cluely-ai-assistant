# Deep-test defect campaign 2026-08-01 — confirmed root causes (living doc)

Fixtures: /Users/evin/Downloads/Natively_Deep_Mode_Test_Pack/ (canaries in PARSER_CANARIES.json).
Working tree = baseline (contains prior A–G fixes, uncommitted).
Probe harness: scratchpad probe1.mjs against dist-electron (build via `node scripts/build-electron.js`).

## Status legend: CONFIRMED (executed repro) / EVIDENCE (code-read, not yet executed) / OPEN

## D1 — Profile Intelligence incomplete contents — CONFIRMED (agent trace, code-level)
- V3 profile corpus = renderProfileSections(structured_data) ONLY. Raw text dies in
  KnowledgeOrchestrator.ingestDocument (premium/…/KnowledgeOrchestrator.ts:605); knowledge_documents
  has NO content column (KnowledgeDatabaseManager.ts:31-36).
- profile-retrieval-port.ts:167-172 renders projects as [name, description, technologies] —
  **p.highlights never read** → "27,450 registered users"/"2,140 stars"/"USD 38,600" lost.
  Legacy ProfileContextBuilder.ts:88 DID render highlights; V3 bypasses it (v3Owned/ignoreKnowledgeMode).
- leadership[] never rendered (latent: "680 attendees").
- Canaries + JD interview_process: NO slot in RESUME_SCHEMA/JD_SCHEMA (StructuredExtractor.ts:79-93)
  → dropped at extraction, unrecoverable. Requires lossless raw-text path:
  raw_text column on knowledge_documents + raw-chunk sections in profile-retrieval-port.
- OKF profile cards flag-gated OFF in prod (intelligenceFlags.ts:461-462) → irrelevant to prod corpus.
- PROFILE_FACT pool always empty (v3ProfileSources.ts:104-112).
- Answerability lie mechanism: "SignalNest users?" retrieves the Project: SignalNest chunk (name matches)
  → topically-relevant evidence without the number → FULL + fabrication.

## D2 — Exact-literal retrieval fails — CONFIRMED (probe1)
- "What is the resume canary?" / "dead-letter topic?" / "last-page canary?" / "worker batch size?"
  ALL classify GENERAL_TECHNICAL → path=FAST, shouldRetrieve=false. **Retrieval never runs.**
  Mechanism: DEFINITION_RE matches "what is", VALUE_LOOKUP_RE noun-list lacks canary/topic/batch-size…,
  technical-interview is not documentCentricMode (primary=RESUME), namesSpecificEntity=false
  (lowercase identifiers). GENERAL_TECHNICAL claim seals the primary-source fallback (turn-classifier.ts:497 `!claims.size`).
- Retrieval-side (agent-2, MEASURED):
  * wordsOf (lexicalTokens.ts:112-131) keeps hyphens → TECH-SMALL-CANARY-524 = ONE opaque token;
    "what is the canary" shares zero tokens with it. `_` splits, `-` does not. Digits ≤2 chars dropped
    (17, 64 unmatchable as values). Fix: ADDITIVE hyphen sub-token pass (file already does this for
    numerals, lexicalTokens.ts:48-53).
  * `# TECH-CODE-CANARY-420` in .py matches headingRe → own empty-body chunk, fts=0.0000 on all queries.
  * Large PDF: "canary"/"last-page" appear NOWHERE in doc; answer chunk lexically indistinguishable
    (all 14 chunks match only "the"); identical per-page boilerplate makes vectors near-uniform.
    Hyphen-split gives the END-915 chunk the only "canary" token → rank 1.
  * computeFtsScore = matches/sqrt(|Q|*|U|) — short-chunk bias: retired decoy (U=27) fts=0.344 BEATS
    current code file (U=39) 0.215 for "worker batch size"/"cache TTL current code" (TECH-E failure).
  * enforceTokenBudget PER_FILE_FLOOR=2 loop does NOT bypass budget (ModeHybridRetriever.ts:1830-1858)
    → trailing files silently get zero slots when budget exhausts (~1500 tokens vs ~3000 needed, TECH-E).
  * computeDocumentAnswerabilityScore genericOverview −0.18 penalizes "…Architecture Summary" title
    (documentGroundedPrompt.ts:657) — correct file penalized for its own title.
  * NO query decomposition (queries[0] only, legacy-retrieval-port.ts:63); confidence gate telemetry-only
    on V3 path (allowRerank:false).
  * TECH-C duration/owner misses are NOT retrieval: single postmortem chunk retrieved rank-1 for all
    three questions — consistent with probe3 (classifier FAST/meeting-route/type-filter are the cause).
  * Working-tree vectorless fix (1609-1639) is orthogonal — keep.

## D3 — Partial multi-file retrieval — CONFIRMED (probe3): three DIFFERENT mechanisms
- "What is the worker batch size?" → GENERAL_TECHNICAL → FAST, retrieve=false (same as D2).
- "Who owns the follow-up?" → "who owns" matches MEETING_EVENT_RE → MEETING_STATEMENT claim →
  MEETING_TRANSCRIPT ∉ technical-interview allowed → unsupportedInMode, retrieve=false →
  Priya Raman structurally unreachable.
- "How long did incident QF-2026-0514 last?" → DOES retrieve (USER_PROJECT via identifier-entity
  fallback, planned RESUME+PROJECT_FILE; all chunks stamped RESUME pass the type filter) →
  miss must be retrieval scoring (query/chunk vocabulary mismatch: "how long…last" vs
  "Duration: 17 minutes"). Pending agent-2 executed retrieval.
- Successes were accidents: "TTL"/"QF-2026-0514" capitalized/identifier tokens → specificEntity →
  GROUNDED; lowercase phrasings of facts in the SAME file → FAST. Capitalization decided retrieval.
- "What are the RTO and RPO in the dossier?" (TI): GROUNDED retrieve=true BUT claim=GENERAL_TECHNICAL
  (no private requirement) → answerability FULL regardless of evidence; RTO/RPO in PDF tail (D4) →
  generic answer with clean FULL trace. Classifier must emit DOCUMENT_FACT for "in the <doc-noun>"
  value lookups.

## D4 — PDF tail loss — agent-3 (pending).

## D5 — General fallback masks retrieval failures — CONFIRMED (probe1)
- "What are the RTO and RPO in the dossier?" (mode general) → GENERAL_TECHNICAL, answerability FULL,
  fallback NONE, zero evidence. "dossier" not in DOCUMENT_RE noun list. Fabrication with clean trace.
- Structural: fallback chain (orchestrator.ts:527-533) consults only generalKnowledgeAllowed, never
  "was this question document-specific"; and FULL is granted when no PRIVATE claims exist (:334-341).

## D6 — Answerability false positives — CONFIRMED (probe1)
- evidenceSupportsClaim (orchestrator.ts:276-306): ANY single shared salient term = claim supported.
  "What backend framework is explicitly documented?" + chunk containing only the word "backend" → FULL.
- Also misclassified: that question → USER_PROJECT claim (not DOCUMENT_FACT), planned RESUME+PROJECT_FILE.

## D7 — Source-role mismatch — CONFIRMED (probe2)
- sourceTypeForFile (mode-retrieval-port.ts:95-110): shape='other' + mode lacks REFERENCE_FILE →
  fallback `allowed[0]`. technical-interview allowed[0]=RESUME → ALL 5 technical fixtures stamped
  RESUME (01_small_project_summary.md, 02_code_samples.py, 03_system_design_large.pdf,
  04_incident_postmortem.txt, 05_legacy_architecture_conflict.md).
- Consequences: (a) telemetry role lie (observed RESUME vs planned PROJECT_FILE);
  (b) CONTAMINATION HAZARD: postmortem/code stamped RESUME can evidence USER_* claims;
  (c) DOCUMENT_FACT-planned turns can lose RESUME-stamped chunks to the planned-type filter;
  (d) explains partial-success pattern: misclassified USER_PROJECT questions plan RESUME and
  accept mislabeled chunks — two wrongs cancel.
- In 'general' mode: shape=resume/job_description correctly DETECTED but flattened to REFERENCE_FILE
  (general's allowlist lacks the types) — ties into D10 fix direction: general/custom modes should
  extend effective allowed types from attached-file shapes (resume→CANDIDATE_FILE, jd→JOB_DESCRIPTION),
  and 'other' fallback must NEVER be RESUME/CANDIDATE_FILE (identity-bearing types).

## D8 — Precedence unexplainable — CONFIRMED (agent-4 + probe4)
- No deterministic precedence exists: ranking is finalScore sort (legacy-retrieval-port.ts:107-109)
  + context-packer rank(); no status/date/version signal anywhere. filterByScopeAndVersion has ZERO
  callers; every mode file stamped versionId 'legacy' (mode-retrieval-port.ts:147-148) → version
  filtering degenerate.
- Provenance never reaches the prompt: renderEvidence (context-packer.ts:65-80) omits documentTitle/
  page/status/date; ModeHybridRetriever chunks carry no metadata field at all.
- PERMANENT_RULES (prompt-composer.ts:92-94) explicitly invites a "clearly-labelled likely rationale"
  → the invented env-var explanation.
- probe4: "What is the current cache TTL?" top lexical hit = the RETIRED file (contains the literal
  words) — correct outcomes depend on the retired fixture restating current values. Precedence is
  luck, not mechanism.

## Agent-4 pipeline audit (for overengineering report)
- 30 stages; stages 20-23+26 are five sequential silent narrowing filters; only stage-19 rejections
  are traced → "20 candidates admitted, evidence 0" is reachable and unexplainable.
- Six source-role vocabularies, no adapter; [V3] line mixes UPPER/lower in the same `role` key.
- Two hand-synced claim maps (CLAIM_TO_SOURCE vs CLAIM_AUTHORITY) — still drifted (USER_MOTIVATION
  CONVERSATION_STATE; GENERAL_TECHNICAL in one only).
- Dead enums: ClaimType 5/15 never emitted; PROJECT_FILE/CODING_SAMPLE unmintable by any port;
  6 fallback labels computed, only CLARIFICATION acts (prompt-composer.ts:263);
  trace.rejectedEvidence hardcoded []; two contradictory "support" definitions in one trace
  (evidenceSupportsClaim vs acceptedFor.includes at orchestrator.ts:564).
- Four overlapping stoplists, none shared.
- V3 imports NOTHING from context-os (no property/entity/confidence axes).
- Custom modes: ModeSourceContract (knows attached roles) never read by V3; engine-bridge coerces
  templateType→'general' and discards the mode's own config (engine-bridge.ts:84-85).
- D5 leak paths: (1) acronym-definition escape (RTO/RPO exact case: onlyAcronymEntities + DEFINITION_RE,
  VALUE_LOOKUP_RE lacks the nouns, GENERAL_TECHNICAL claim seals recovery); (2) FAST path emits no
  disclosure and composer only acts on CLARIFICATION; (3) documentCentricMode false for all
  OPEN_KNOWLEDGE modes → protections inert in general/team-meet; (4) primary-source fallback assigns
  claim by MODE not question ("canary in this résumé" → USER_PROJECT; DOCUMENT_RE lacks resume/dossier);
  (5) generalKnowledgeAllowed true for every built-in mode.

## probe4 (executed lexical retrieval, small files)
- Small fixture files = ONE chunk each → when retrieval runs, fact-bearing chunk IS returned
  (postmortem for duration/owner Q, architecture summary for canary/dead-letter Q).
- Live misses on small files are 100% decision-layer (FAST skip, meeting misroute, RESUME-stamp filter),
  NOT lexical scoring. Large-PDF tail (D4) is the remaining retrieval-side unknown.
- Lexical fallback admits sub-0.15 combined scores via toLexicalThreshold (F-C fix working).

## D9 — Follow-up wrong referent — CONFIRMED (probe1)
- 9a: advance() sets activeTopic = fresh[0] = first capitalized token of latest question
  (conversation-state.ts:151). "Does she have Kubernetes experience?" → activeTopic=Kubernetes;
  PRONOUN_RE she → resolves "(referring to: Kubernetes)". No person/topic slot typing.
- 9b: "How many students used CampusMesh?" = 5 words, starts with "How" → FOLLOW_UP_RE +
  FOLLOW_UP_MAX_WORDS=5 → isBareFollowUp true → referent appended though question names explicit
  entity (extractEntities finds CampusMesh). Rule needed: explicit entity in current question ⇒
  no referent attachment; personal pronouns resolve only to person-typed referents.

## D10 — Custom/general JOB_REQUIREMENT planning fails — CONFIRMED (probe1)
- All four job questions in mode 'general': claims JOB_REQUIRED_SKILL/USER_EMPLOYMENT →
  CLAIM_TO_SOURCE wants JOB_DESCRIPTION/RESUME/CANDIDATE_FILE… ∩ general.allowedSourceTypes
  (REFERENCE_FILE, MEETING_TRANSCRIPT, CONVERSATION_STATE, SCREEN_CONTEXT) = ∅ →
  requiredSourceTypes=[], shouldRetrieve=false, reason "mode general does not authorize",
  fallback STRICT_NOT_FOUND (unsupportedInMode branch, orchestrator.ts:512-515).
- Files ARE attached (as REFERENCE_FILE) but claim→source mapping is type-exact, no doc-role
  awareness for custom modes.

## IMPLEMENTATION STATUS (2026-08-01, this session)
All fixes below IMPLEMENTED and test-verified (see test files):
- F1 classifier: DOCUMENT_RE widened (dossier/resume/postmortem + "written in" verbs);
  definiteValueLookup structural rule (definite article, no concept complement, mode holds
  documents); fallback unsealed (yields only to PRIVATE claims, concept carve-out);
  MEETING_EVENT split conversational vs attribution (attribution needs meetingMode);
  fallback claims DOCUMENT_FACT alongside the primary claim; CLAIM_TO_SOURCE now DERIVED
  from CLAIM_AUTHORITY (two-map trap eliminated).
- F2 mode-retrieval-port: 'other' shape never mints identity types; code ext → CODING_SAMPLE;
  detectDocumentStatus; attachmentSourceTypeExtensions (general-only).
- F3 wiring: ipcHandlers + IntelligenceEngine compute extensions, pass to ports + bridge;
  AnswerRequest.extraAllowedSourceTypes + hasAttachedDocuments; decide() extends policy.
- F4 orchestrator: propertyHeadTerms (head-final NP + coordination + locative/predicate strip);
  evidenceSupportsClaim requires property term (or completeInventory category); weak topical
  overlap → PARTIAL never FULL; claimPlan support aligned to the same definition.
- F5 conversation-state: activePerson slot (possessive/title/who-is cues, sticky);
  personal pronouns resolve only to persons; explicit-entity questions never get referents;
  orchestrator advances state with the ORIGINAL question (drift stopped).
- F6 profile: highlights + leadership rendered; raw_text column (premium KnowledgeDatabaseManager,
  guarded ALTER), saved at ingest, exposed via ActiveProfileContext.rawText, disk fallback for
  legacy text rows in v3ProfileSources; raw text chunked as "Document text (part N)" sections.
- F7 provenance: port stamps metadata.documentStatus; packer renders source_name + status attrs;
  composer precedenceContract section (explain by status, never invent mechanism).
- F8 audit: ModesManager.addReferenceFile warns on parsed<total pages ("INGESTION AUDIT").
- F9 retrieval: wordsOf hyphen sub-tokens (additive); positional locator restore
  (first/last page → head/tail chunk per file, +0.6 answerability); PER_FILE_FLOOR round-robin
  (budget can't starve a file's guaranteed picks).
- F10 composer: weakEvidenceGuidance (PARTIAL_SUPPORT/GENERAL_KNOWLEDGE with doc claims →
  "say the exact value could not be retrieved, never substitute a generic definition");
  noEvidenceNotice strengthened; [V3] line gains documentSpecific + propertyMatched.
Tests: DeepTestDefects2026_08_01 (47), ProfileLossless2026_08_01 (8),
RetrievalExactLiteral2026_08_01 (6) — all failing-before/passing-after except marked
NON-REGRESSION. One existing test updated with justification (SourceAuthorityAndScope: RESUME
now also DOCUMENT_FACT-authoritative). Known pre-existing flake: AnswerPolicy persisted-store
tests fail under parallel node --test (store file collision), pass in isolation — present
without these changes.

## FIX PLAN (minimal, consolidating — drafted before implementation)

F1 (D2/D3/D5, classifier): replace noun-list boundary with structural rule. A factual question in a
   mode with document sources claims the document/primary source UNLESS clearly conceptual
   (indefinite-article definition "what is a/an X", "difference between", "how does X work",
   coding/system-design/tech-self-talk). Definite-article value lookups ("what is the X") ground.
   Unseal the primary-source fallback: gate on "no PRIVATE claims" instead of "no claims" so a
   GENERAL_TECHNICAL claim cannot seal the escape. Document-deictic cue generalized: "in/from/per
   the <noun>" + "written in", "documented" → DOCUMENT_FACT (kills DOCUMENT_RE noun-list dependency).
   Keeps: "What is a mutex?" FAST (indefinite), "goal of dependency injection" FAST in OPEN_KNOWLEDGE
   (concept complement "of <lowercase-concept>").
F2 (D7): sourceTypeForFile fallback must never mint identity types (RESUME/CANDIDATE_FILE/
   JOB_DESCRIPTION) for shape='other'. Order: REFERENCE_FILE → CODING_SAMPLE (code extensions) →
   PROJECT_FILE → first non-identity allowed. Makes PROJECT_FILE/CODING_SAMPLE mintable.
F3 (D10): compute effective allowedSourceTypes for 'general' custom modes from attached-file shapes
   (resume→CANDIDATE_FILE, jd→JOB_DESCRIPTION) at the bridge call sites (ipcHandlers/IntelligenceEngine
   already hold the files); pass the same effective list to createModeRetrievalPort. No profile
   hydration change; isolation preserved (only actually-attached shapes extend).
F4 (D6): property-aware support: evidenceSupportsClaim requires the clause's HEAD-noun (property)
   term matched (or completeInventory category match), not ANY single term. FULL only with property
   matched; single-generic-term overlap → PARTIAL. (FastAPI case passes via resume "Frameworks:" +
   summary "API:" chunks.)
F5 (D9): typed referents. (a) resolveReference: question containing an explicit entity and no pronoun
   → returned unchanged; (b) personal pronouns (she/he/her/him/his) resolve only to activePerson
   (possessive "X's", "candidate X", First-Last two-token names feed it); no person known → previous-
   question anchor, never a tech topic; (c) advance state with the ORIGINAL question, not the rewritten
   one (stops referent drift).
F6 (D1): render projects[].highlights + leadership in profile-retrieval-port (immediate); add lossless
   raw-text sections: persist raw_text at ingest (knowledge_documents) with source_uri re-read fallback
   for existing rows; chunk into "Document text (part N)" sections in the profile port. Skip JD schema
   churn — raw text covers canaries/7 stages.
F7 (D8): stamp status/documentTitle metadata at the mode port (detect Status: RETIRED/current etc. in
   file head), render source name+status in evidence attributes (context-packer), + one composer rule:
   prefer current over retired/superseded and explain precedence from the status attribute only.
F8 (D4): pending agent-3 (PDF tail).
F9 (D2 retrieval): additive hyphen-split sub-tokens in wordsOf; fix short-chunk bias denominator
   OR merge heading-only chunks into following/preceding chunk (prevents empty-body canary chunks);
   budget-reserved PER_FILE_FLOOR (reserve floor slots before global fill).
F10 (D5): composer acts on fallback labels beyond CLARIFICATION: GENERAL_KNOWLEDGE → explicit "evidence
   did not cover this; answer generally and SAY so / for document-specific questions say not retrieved";
   document-deictic questions with NONE → honest not-found even under OPEN_KNOWLEDGE.
Simplifications: derive CLAIM_TO_SOURCE from CLAIM_AUTHORITY (one map); collapse VALUE_LOOKUP/METRIC
   special-cases into F1 structural rule; delete never-called filterByScopeAndVersion OR wire it;
   unify [V3] role vocabulary (upper-snake everywhere).

## Preserved behaviors to not regress (probe-verified where noted)
- "What is a mutex?" FAST in OPEN_KNOWLEDGE modes (existing test).
- PI inheritance (profileSources LfW/TI).
- Current-vs-retired precedence (scope/version filter).
- Meeting-memory provenance (0 decisions on manual chat).
