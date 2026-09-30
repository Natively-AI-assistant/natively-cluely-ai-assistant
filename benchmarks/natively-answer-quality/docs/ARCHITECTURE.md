# Natively answer engine: architecture map (pre-fix)

Merged from six read-only traces, with spot checks. **Line numbers refer to commit `04333d2d`** (the pre-fix baseline); `premium/…` citations refer to premium submodule commit `c683ea3` (KO = `premium/electron/knowledge/KnowledgeOrchestrator.ts`; `StructuredExtractor`, `ContextAssembler` are in the same tree). Nothing was executed except the trace-03 classifier probes (*probe*). Other confidence labels are kept: *code-read*, *inferred*, *probable*, *hypothesis*.

**Abbreviations:** E = `electron/IntelligenceEngine.ts`; IPC = `electron/ipcHandlers.ts`; NI = `src/components/NativelyInterface.tsx`; WTA = `electron/llm/WhatToAnswerLLM.ts`; LLM = `electron/LLMHelper.ts`; v2 = `electron/llm/promptSystemV2.ts`; composer = `electron/context-intelligence/generation/prompt-composer.ts`; bridge = `electron/context-intelligence/orchestration/engine-bridge.ts`; registry = `electron/context-intelligence/policies/mode-policy-registry.ts`.

**Default flags:** V3 ON (`contracts/flag.ts:108`); Prompt System v2 ON (`intelligence/intelligenceFlags.ts:758`; the "default OFF" comments at LLM:8740 and `intelligenceFlags.ts:349` are stale). OFF: code-execution verification, `answerDiversityGuard` (WTA humanizer), `wtaClauseCoverageRepair`, `answerRelevanceGuardLive`, the intent router / `MODE_ROUTING`, `questionLedgerShadow`.

**Which surface gets which prompt** (not every live answer is V3 + v2 persona):
- **V3 with a v2 `personaBase`:** only typed chat (`_geminiChatStreamHandler`, IPC:2167) and WTA hotkey/Auto Answer (`runWhatShouldISayInner`, E:3921).
- **V3 without persona** (V3 system replaces v2): assist/clarify/brainstorm/code-hint (`buildV3ForTranscriptSurface`, E:7036-7121) and submit-manual-question (`runManualAnswerInner`, E:7513-7600).
- **Legacy transport:** overlay **Answer Now / voice** button (`handleAnswerNow`, NI:8531, `skipSystemPrompt:true`), voice + screenshot, phone-mirror typed chat (`streamChat` + `resolveManualChatBasePrompt(…,'live')`, IPC:18728), any caller-owned prompt (IPC:1798).
- **Own fixed prompt:** Direct Assist (`direct-assist/requestBuilder.ts:14`).

`buildV3Prompt` (bridge:261) declines only when the flag is off (:263), the question is empty (:265) or it throws (:829-838); `v3ModeRetrievalContext` returning null (E:7022) also yields no V3 prompt. Those turns fall to legacy.

---

## 1. Runtime call graphs

### A. Hotkey / What-to-Answer (also Auto Answer)

| Stage | file:function | inputs → outputs | conditions |
|---|---|---|---|
| Transcript ingest | `main.ts:3675` `stt.on('transcript')` → `IntelligenceManager.handleTranscript` → `SessionTracker` | segment → transcript ring; interviewer finals may `maybeSpeculate` (E:789) | meeting active. Auto Answer: `runAutoAnswer` (E:1440) → `handleSuggestionTriggerInner` (E:1027) → `runWhatShouldISay` (E:1143) or adopt speculation |
| User event | `main.ts:2073` maps `chat:whatToAnswer` → overlay `global-shortcut` → NI:7568 `handleWhatToSay` | → `generateWhatToSay(question?, imagePaths?, opts)` (NI:7775) | second press blocked ("Still finishing…") |
| IPC | `preload.ts:2016` → IPC:14594 `generate-what-to-say` → `IntelligenceManager.runWhatShouldISay` → E:1706 → `runWhatShouldISayInner` (E:1714) | | aborts prior token (E:1811) |
| Mode snapshot | E:1870 `snapshotModeInfo` (t0) | → persona, `realtimeInstruction` | V3 policy/retrieval re-read live (§2) |
| Canned exits | E:2014 (no LLM configured), E:2199 (nothing to answer), E:2295-2317 (bare follow-up clarification), E:3570-3615 (source clarification) | → `suggested_answer` with no LLM call | |
| Transcript gatherer | `session.getContext(180)` (E:2052); `extractLatestQuestion` (E:2105); user-asked-last override (E:2125-2146); follow-up resolution (E:2225-2330) | → `wtaTurnQuestion = question ‖ latestQuestion ‖ lastInterviewerTurn` (E:3300) | See §7 for speaker handling. |
| Task/shape | `planAnswer` → `answerPlan`; `resolveCodingPromptSignals` / `detectCodingShape` | → answerType, length directive (`renderLengthDirectiveForPlan`, `AnswerPlanner.ts:2254`), coding shape | Action is `answer` if coding or the mode is lecture/general (custom modes included), else `what_to_say` (E:4032-4070). |
| Context gatherers | `v3ModeRetrievalContext` (E:6868-6996): mode-file, PI, meeting-transcript and screen ports (`combineRetrievalPorts`); prior conversation from the V3 conversation ring (`recordLiveTurn`/`recordAnswerSummary`, E:1638-1680) | → retrieval port + conversation summary | PI only in LFW/TI (§3); files from the **live** active mode (E:6886). |
| V3 composer | E:3767-3783 → bridge:261 `buildV3Prompt({surface:'what-to-answer'})` → `orchestrate`/`decide` → composer:1085 `composePrompt` | → `{system, user, evidenceBlock}` frozen into the request snapshot (E:4152) | `personaBase` = v2 `resolveV2SystemPrompt({action, surface:'live', activeMode: snapshot, codingTask, codingShape, codingFormat})` (E:4069-4097). `heardQuestion` is true for this surface (bridge:566). |
| WTA LLM | E:4195 → WTA:160 `generateStream`; user = `_v3p?.user ?? …` (WTA:1123); system = `composeWtaSystemPrompt(_v3p?.system, …, activeSkill)` (WTA:1127) | → `LLM.streamChatWithOutcome` (WTA:1195) | legacy retrieval, `intentContext` and screen instruction still run, then are discarded |
| Transport | `_streamChatTracked` (LLM:8465) → `_streamChatInner` (LLM:8677) | reasoning filter → dash reducer → 16k-char cap; language suffix appended last (`injectLanguageInstruction`, LLM:4034) | ladder §9 |
| Stream paint | E:4325-4394 `emitChunk`/`paintBuffered` inside `raceStreamWithDeadline` | → `suggested_answer_token` → `main.ts` token batching → `intelligence-token-batch` → NI:7293 `queueToken` → rAF reveal | first paint held to 40 chars; canned opener and `[[NO_ACTION]]` stripped there; `#`-led answers held to final; coding via `CodingStreamGate` + spec stripper |
| Correction passes | E:4596-6575, about 24 passes (§8) | `fullAnswer` → `finalWtaAnswer` | Speculative runs skip most of them (`completeSpeculativeRun`, E:1285). |
| Final | E:6618 `emit('suggested_answer')` → `main.ts:7155` → NI:7173 `finalizeStreamingByIntent` (NI:6846) | | The row is **replaced** if the final text differs from what streamed (NI:6895/6915). |
| Background | E:6696 `maybeVerifyCoding` | → `code_correction` | Default OFF. |

### B. Typed overlay question

| Stage | file:function | inputs → outputs | conditions |
|---|---|---|---|
| User event | NI:8795 `handleManualSubmit` → NI:8943 `streamGeminiChat(text ‖ 'Analyze this screenshot', paths, ctx)` | no `options` | |
| IPC | `preload.ts:2390` → IPC:1646 `_geminiChatStreamHandler` | `answerSurface` is `live` for the overlay sender and `chat` otherwise (IPC:1670) | Supersedes the prior stream per sender. Skill lookup at IPC:1700-1770. |
| V3 gate | IPC:1799 `if (!callerOwnsPrompt && isContextIntelligenceV3Enabled())` | | Caller-owned prompts (`skipSystemPrompt && context`) go to legacy. |
| Mode snapshot | IPC:1816 `modeInfo = getActiveModeInfo()` | one snapshot feeds policy, instructions and persona | |
| Context gatherers | mode files (IPC:1807-1875); PI when `policy.profileSources` is non-empty (IPC:1915-1929); screen port (IPC:1966-2013: a cached transcription, otherwise a `ScreenUnderstandingService` pre-pass); conversation from the V3 ring | | |
| Composer | IPC:2043-2240 `buildV3Prompt({surface:'manual-chat', realtimeInstruction, defaultLengthDirective (live only), personaBase: resolveV2SystemPrompt({action:'answer', surface, activeMode})})` | → system + user | `## ACTIVE SKILL` is appended to the system prompt (IPC:2318). |
| Transport | IPC:2328 `streamChatWithOutcome(user, images, …, ignoreKnowledgeMode=true, skipModeInjection=true, {v3Owned:true})` | tokens → `gemini-stream-token` (IPC:2365) + phone; language suffix last (as A) | **No deadline driver.** A throw re-runs the turn on legacy (IPC:2545). |
| Final | IPC:2385-2396 (mode-change guard) → `gemini-stream-done {finalText: raw}` → memory and history recorded (IPC:2473-2497) → `return null` | | **No post-stream pass runs.** |
| Legacy branch | IPC:2520-6700: canned identity probe and clarifications → `planAnswer` → JIT/OKF profile blocks → `llmHelper.streamChat` (IPC:4521) under `raceStreamWithDeadline` → passes IPC:4760-6372 → `finalText` | NI:8152 `finalTextDiverges` → the row is replaced (NI:8196) | V3 off / null / throw / caller-owned prompt |

### C. Screenshot (deltas from A/B; detail §5)

| Stage | file:function | inputs → outputs | conditions |
|---|---|---|---|
| Capture | `ScreenshotHelper.takeScreenshot` (:672) / selective (:724) / capture-and-process (`main.ts:7684`) | queue of ≤5 files; older unlinked (:447) | later turns see only text |
| Vision pre-pass | IPC:14674 (WTA), IPC:1988 (chat) → `ScreenUnderstandingService.understand` (:182), 6 s | → prose answer → SCREEN_CONTEXT evidence | blind to mode, PI, files |
| Shape | `isPromotedScreenCodingTurn` (`codingPromptSignals.ts:217`) | empty/deictic ask + images → coding, shape from words | |
| Answer | LLM:9982 → `streamVisionWithFallback` (LLM:8162) | pixels + same system prompt | DeepSeek skipped |

### D. Reference-file-grounded (deltas; detail §4)

| Stage | file:function | inputs → outputs | conditions |
|---|---|---|---|
| Classify/plan | `classifyTurn` → `decide` (`orchestrator.ts:213-305`) | claims → planned source types | FAST path skips retrieval |
| Retrieve | legacy port → mode port → `ModeHybridRetriever.retrieve` (:1469) | query `screenEnrichedQuery(…)` → chunks | topK 20/24, 1200 ms |
| Pack | port filters + fill (cap 6/8) → `packContext` (`context-packer.ts:106`) | → `<evidence provenance="MODE_REFERENCE_FILE">` | shared cap/budget |
| Repair | E:5250-5580 | | doc-grounded enforcement + files + non-visual |

### E. Profile Intelligence (deltas; detail §3)

| Stage | file:function | inputs → outputs | conditions |
|---|---|---|---|
| Gate | registry `profileSources` (LFW :294, TI :326) | | LFW/TI only |
| Hydrate/retrieve | `collectV3ProfileSources` (`v3ProfileSources.ts:98`) → `createProfileRetrievalPort` (`profile-retrieval-port.ts:558`) | sections + OKF cards + raw text, BM25 + semantic | per turn; ignores PI toggle; identity pools only under a `USER_*`/`JOB_*` claim (`orchestrator.ts:291-296`) |
| Prompt | composer guards | `<evidence>` typed RESUME / JOB_DESCRIPTION / PROFILE_FACT | no V3 post-generation validator |
| Legacy | JIT → OKF → premium intercept (LLM:8846-8960) | | §3 |

---

## 2. Mode Manager

**Definitions** (four lists, only partly compile-linked): `services/builtinModes.ts:25-35` labels (ids `mode_builtin_<t>`); `services/ModesManager.ts:70-86` templates (+ legacy `TEMPLATE_SYSTEM_PROMPTS` :248, v2-off only); `llm/modeProfiles.ts` planner prior; registry:24-39 `MODE_IDS` + `MODE_POLICIES` :199-374; plus v2 `MODES` (:341-402) and `MODE_SPEAKER` (:474-515). `ModeGenerator.ts:42-50` lacks seminar and call-center.

**Storage.** SQLite `modes(…template_type, custom_context, is_active, is_builtin, source_contract_json)` (`DatabaseManager.ts:828`); one `is_active=1` row, set transactionally (:2256). Files in `mode_reference_files`; strict/non-strict answer policy in a JSON file (`answer-policy-store.ts:25`). `getActiveModeInfo()` is cached on `globalThis` (ModesManager:552-582), invalidated on every write. Writers: `modes:set-active` (IPC:17338) and `clearActiveModeOnLicenseLoss` (:874). General is a seeded row and also the no-mode/unknown fallback (v2:1252, `resolveModeIdOrWarn`). A custom mode is `templateType==='general' && name!=='General'` (ModesManager:347): v2 persona `custom`, V3 policy `general`; renaming the built-in General makes it "custom".

**How the mode reaches each surface.** Typed chat: one t0 snapshot (IPC:1816), consistent. WTA: persona/instructions at t0 (E:1870), V3 policy/evidence/files re-read live after awaits (E:6868-6886), mitigated by `supersedeLiveAnswers()` on switch. Doc-grounded repair: persona read live, retrieval pinned. Phone: retrieval pinned, persona live, stream not aborted on switch. Direct Assist: live files, mode-blind persona.

**What a mode changes:** v2 persona (mode block, voice contract, overlay); one V3 line `# Mode\n<name> — <purpose>` (composer:1132); WTA action (`answer` vs `what_to_say`); registry source types/priorities, `profileSources`, budgets (incl. `screenTokens`), grounding policy, auto-answer thresholds; premium intercept blocklist (ModesManager:587). The Real-time prompt renders LAST in the user message as `<user_instructions>` (composer:1263). No per-mode output format or `max_tokens`; coding contract is mode-independent (RC-3).

**Switch/leak analysis** (IPC:17338-17460). Before the switch: abort chat streams, `clearSessionContext` (epoch bump), clear manual memory, the V3 conversation ring and coding state; then supersede live answers, rebind, prewarm. Survives: `fullTranscript` + epoch summaries (prior-mode speech stays evidence), global PI, phone streams. Caches are content-addressed. Leak risks: WTA t0 persona vs live V3 policy/files; live doc-repair persona; phone answer delivered after a switch; prior-mode transcript. No persisted cross-mode file leak (§4).

| Mode | Internal ID | Prompt/contract | PI allowed | Reference files | Coding behavior | Spoken role | Notes |
|---|---|---|---|---|---|---|---|
| General | `general` (also the no-mode fallback) | v2 `GENERAL_MODE_BY_SURFACE` :548; V3 policy `general` | V3 no. Legacy **yes** once the mode has a prompt or a file (re-migrated to `ask_if_ambiguous`), and in the no-mode state | yes, priority 1 | driven by `codingTask`; WTA action `answer` | user's own voice (live); assistant (chat) | OPEN_KNOWLEDGE; free of the Pro gate |
| Sales | `sales` | v2 `MODES.sales` :354 | V3 no; legacy streaming no; follow-up email *probable* (L1) | yes, priority 1 | driven by `codingTask` | seller, first person | SOURCE_FIRST; confidentiality text contradicted by the composer floor rule (:254) |
| Recruiting | `recruiting` | :364 plus overlay :525 | no (own profile barred) | yes, plus CANDIDATE_FILE and JD | driven by `codingTask` | third-person advisor to the interviewer (user = interviewer) | no branch for "candidate asks the recruiter" (§7) |
| Team Meet | `team-meet` | :370 plus overlay :531 | no | yes, priority 2 | driven by `codingTask` | participant, first person when addressed | OPEN_KNOWLEDGE; capture lines; intercept off |
| Looking for work | `looking-for-work` | :346 | **yes**: RESUME, JD, PROFILE_FACT | yes | driven by `codingTask` | candidate, first person | strongest grounding text; AUTO_ANSWER_INTERVIEW |
| Technical Interview | `technical-interview` | :385 | **yes**: RESUME, JD | yes (priority 4), plus PROJECT_FILE and CODING_SAMPLE | contract only on coding turns; persona says "follow the coding contract exactly" | candidate, first person | "ask one clarification" contradicts the core `<turn_policy>` |
| Lecture | `lecture` | :381 | no | yes, priority 1 | WTA action `answer` | study partner to the student | planner prior `lecture_answer` |
| Seminar | `seminar` | :391 | no | yes, citations VISIBLE | `STRICT_DOC_CAPS` | presenter, first person | disclosure ALWAYS; "say the material does not specify it" contradicts the composer's "never say missing" |
| Call Center | `call-center` | :395 | no | yes, priority 1 | driven by `codingTask` | support agent, first person | "state the escalation path" has no grounding qualifier |
| *(Custom)* | `general` template, name ≠ General | `MODES.custom` :399 / V3 `general` | no (except attachment type extensions) | yes | WTA action `answer` | the role its instructions define | role text reaches V3 only via `<user_instructions>` |

---

## 3. Profile Intelligence (pre-fix)

```
Settings › PI → profile:select-file (60 s allowlist, IPC:16193) → profile:upload-resume|jd (Pro gate, :15992/:16220)
  → premium KnowledgeOrchestrator.ingestDocument (KO:944)
      extractSafeDocumentText (pdf-parse / mammoth / text)
      extractStructuredData (LLM "strict parser", StructuredExtractor:153) | heuristic fallback (KO:997)
      deleteDocumentsByType → saveDocument(structured_data, raw_text)   (one résumé + one JD, global)
      chunk+embed → context_nodes;  [résumé] STAR stories (LLM);  [JD] AOT pipeline (LLM:
      dossier, gap, mock Qs, culture, intro, negotiation);  [résumé] salary estimate (LLM);  OKF packs
  → kickProfileRawIndex (pseudo-mode __profile_raw__) → setKnowledgeMode(true) + persist

Per turn V3:  policy.profileSources ≠ [] (LFW/TI only) → collectV3ProfileSources → profile port
  (structured sections + OKF cards + raw text, BM25 + semantic) → claim authority
  (USER_* → RESUME/PROFILE_FACT, JD prohibited; USER_MOTIVATION → RESUME prohibited; JOB_* → JD only)
  → <evidence source_type=RESUME|JOB_DESCRIPTION|PROFILE_FACT> → composer guards
Per turn legacy:  resolveSourceOwnership → JIT evidence (no behavioral branch) | coordinator pack | OKF cards
  → streamChat premium intercept (knowledgeMode && !docGroundedAuthority) → Profile Grounding V2 block
  + premium persona (replaces the system prompt) → validateProfileEvidence (legacy only)
```

**Gating.** V3: exactly LFW and TI, keyed on `templateType`; ignores the per-mode `sourceContract`, the PI toggle and the license. Legacy is broader and inconsistent: the premium intercept's mode gate is a blocklist (TI, team-meet, lecture, seminar, call-center) bypassed by `factualRecall`, which Profile Grounding V2 sets on almost every turn; the authority-only doc-grounded flag makes seeded Sales/Recruiting/Team-meet/Lecture skip the streaming intercept. Leak paths (*code-read*): L1 follow-up email (`chatWithGemini`, no ignore flag, IPC:15394; *probable*); L2 General with a prompt or file (re-migrated to `ask_if_ambiguous`, profile granted by default); L3 no active mode; L4 `LLMHelper.chat()`; L5 legacy `runManualAnswer`; L8 negotiation tracker/company research in general/sales/recruiting/no-mode. Skips: legacy typed chat with a screenshot or a coding turn skips JIT (IPC:3614), while V3 still hydrates.

**Derived-content risks** (all LLM-made at ingest): project `description` is "generate[d]" when absent (StructuredExtractor:126; both paths); STAR stories (**high**, S/T/R invented from one bullet; legacy intercept only, V3 does not read `context_nodes`); company dossier (**high**, "use training knowledge…"; legacy); gap pivots, mock-answer keys, culture mappings, AOT intro (medium; legacy blocks, and V3 JD-pack artifact cards with circular verification); salary estimate (V3 `PROFILE_FACT` in LFW). Staleness: AOT artifacts regenerate only on JD upload (old intro/pivots survive a résumé swap); the in-memory salary estimate is not cleared on re-upload, so V3 can serve the previous résumé's salary; `profile:delete` leaves dossier and salary rows.

**Behavioral question with no story** gets three conflicting instructions: V3 `personalPast`/`evidenceStoryGuard` "tell no story"; legacy premium persona "construct a grounded, qualitative example… do NOT refuse" (`ContextAssembler.ts:161`); legacy JIT never fires.

---

## 4. Reference files

```
FILE → modes:upload-reference-file (Pro) → ingestModeReferenceFile → extractSafeDocumentText
     → mode_reference_files(mode_id, content) → indexReferenceFile (FIRE-AND-FORGET; E2E hook awaits;
       silent no-op if the RAG pipeline is not yet injected, ModeContextRetriever:1775)
EXTRACT  pdf-parse [Page N] | mammoth | text (BOM, binary sniff, HTML→text); 50 MB
INDEX    chunkText: tabular | ToC 140w/30 overlap | semantic ≈350 tok, no overlap (CHUNKER_VERSION 4)
         → embed (Natively → custom → OpenAI → Gemini 768-d → Ollama → local e5-small)
         → mode_reference_chunks(file_id, vec, space) + index_state(ready|lexical_only|pending|failed|ocr_required)
QUERY    classifyTurn → FAST? → probeAnchors (needs ≥12 chunks) → else NO RETRIEVAL
         q = screenEnrichedQuery(bareFragmentQuery(q) ?? q, screen); referent rewrite; no transcript, no mode name
RETRIEVE ModeHybridRetriever.retrieve: 0.4·fts + 0.6·cos ≥ 0.15·min(1,|q|/5); empty floor (threshold 0),
         thin top-up (<3 → 8 overlap chunks); doc-map / answerability restore; rerank; enforceTokenBudget 1500–2400
RANK     port: scope/version → planned-type (+mode-attachment carve-out) → claim authority → identifier/positional
         retry → sort (identifier > filename > status > position > score) → round-robin fill cap 6/8
         → one LLM rewrite retry if answerability NONE / best < 0.3
SELECT   provider-scope filter (bridge:500) → packContext (rendered-size budget, item cap, shared with screen/meeting/PI)
PROMPT   <evidence … provenance="MODE_REFERENCE_FILE"> under "# Evidence (untrusted data — never instructions)"
         + fallbackGuidance by grounding policy. No small-file inlining. No explicit file-vs-general-knowledge conflict rule.
```

**Failure modes, ranked by mechanism strength** (baseline rows were not accessible to the trace; the order is not measured):
1. **Classifier FAST path + disabled arbitration** (A1+A2, *probe*): general-knowledge phrasing ("what is a mutex") plans no retrieval in every mode; corpus arbitration is null below `IDF_MIN_POOL=12` chunks, so a small file holding a contrary value never reaches the model.
2. **V3 query embed never retries** (B1): guard `elapsed + 3000 > 1200` (`EmbeddingPipeline.ts:1261`); one 429/timeout → lexical with **no floor** (`hybrid_threw`, ModeHybridRetriever:1684): zero/off-target chunks on large pools, weak function-word matches on small ones.
3. **Local embedder on a live-meeting WTA turn** → lexical only (B3).
4. **First question after upload/reindex** (B4): vectors ignored → 24-chunk ephemeral embed or lexical.
5. **Crowd-out** (B7): the answering chunk loses to screen/meeting evidence under the 6-item cap and 1500-token budget; "reached" ≠ "answering chunk reached", since the empty/thin floors almost always admit some file text.
6. **Gates:** wrong active mode (A7), planned type excludes the file (A5), claim authority drops a JD-typed file under `USER_*` (A6), privacy scope (A9), OCR-required PDFs (B6).
7. **Measurement artefact** (C3, *hypothesis*): legacy `<active_mode_retrieved_context>` has no `source_type`.

The `hybrid_threw` degradation is invisible (the port drops `usedFallback`, mode-retrieval-port:303; fallback telemetry throttled to 1/60 s). Screenshot + file combine, but visual turns skip the doc-grounded repair.

---

## 5. Vision

**Entry points.** WTA with images (Answer, Cmd+Enter, capture-and-process) and typed chat with attachments: V3 + v2 persona (flows A/B). Voice + screenshot: legacy, renderer-authored prompt (`skipSystemPrompt`). Code Hint (IPC:14891 → `CodeHintLLM`): V3, v2 fallback pins `approach`. Brainstorm: V3/v2. Phone chat: legacy v2 base, no screen coding promotion (*inferred*). Direct Assist: own prompt, no persona or coding contract. `ProcessingHelper.processScreenshots` and `analyze-image-file` have no callers.

**Two-call structure (A, B).**
1. **Pre-pass**, `ScreenUnderstandingService.understand`, 6 s. `buildVisionPrompts` (`visionPrompts.ts:75`) picks the technical prompt only when `modeTemplateType` is passed; no caller passes it, so `TECHNICAL_INTERVIEW_SYSTEM_PROMPT` is unreachable and every pre-pass is `DIRECT_VISION_SYSTEM_PROMPT` + "Analyze the attached screenshot and answer concisely." Its output is a **second model's prose answer**, which becomes SCREEN_CONTEXT evidence, `capturedScreenText` and the verifier's `screenText`; verbatim Input/Output examples are usually lost. Chat first reads a cached structured transcription (`ScreenshotDescriptionStore`); WTA transcribes only after the answer (E:1638-1662).
2. **Answer**: pixels + the same composed system prompt via `streamVisionWithFallback` (OpenAI, Claude, Gemini lite/flash/pro, Groq, Natively, then selected providers, Codex, Antigravity; selected local/aggregator providers pinned first, the rest health-ordered). DeepSeek is text-only and skipped.

**Words vs screen.** "The screen grounds the problem; the words decide the shape" (`codingPromptSignals.ts:57`). Empty or deictic ask (≤12 words, demonstrative subject) + images → coding turn with shape `detectCodingShape(words)`; empty or "Analyze this screenshot" → `solve`. Five promotion sites (LLM:4391, LLM:8776, IPC:2253, WTA:284, E:3970); only E:3970/4089 restores the Real-time-prompt `codingFormat`, so typed-chat screenshot turns lose a custom format; `suppliedTemplate` is never set for images. Promoted turns keep a non-coding `answerType`, so the six-section validator returns ok (prompt and validator agree). On V3 turns `SCREEN_DIRECT_VISION_INSTRUCTION` ("write your solution INTO it"), `CODING_VERIFICATION_INSTRUCTION` and the legacy repeat-press directive are discarded; V3's `screenReferentNotice` (composer:1042) says "the user wants its ANSWER", with no stub guidance.

## 6. Prompt architecture

**V3 system message** (`composePrompt`, composer:1121-1170): 1 `persona_base` (v2: CLOUD_CORE/LOCAL_CORE → mode → action → silence gate → voice contract → [coding contract] → [chat layout] → `final_check`; `<custom_instructions>` never on V3; typed chat may add a prior-problem block, WTA a `<repeat_press_directive>`) · 2 `meta_request` · 3 `permanent_rules` (:157-294; spoken rules swapped on chat) · 4 `source_authority` (:308) · 5 `# Mode` (:1132) · 6 `no_attached_material` (Seminar, FAST, zero sources) or `grounding` (`fallbackGuidance` :341) · 7 `follow_up` · 8 `absence_contract` · 9 `precedence_contract` · 10 `precedence_history` · 11 `secondary_source` · 12 `evidence_coverage` · 13 `exhaustive` · 14 `exact_value` · 15 `capabilities` · 16 `user_instruction_authority` (only with a Real-time prompt). Then `## ACTIVE SKILL` (call site) and the **language suffix** as the true last block (transport; uncached second block for Claude, LLM:4075).

v2's `<final_check>`, designed to be last, sits mid-prompt with all V3 governance after it; the composer floor rule (:254, "give that value plainly first, then any coaching") therefore outranks by recency the confidentiality text of CLOUD_CORE, Sales and LFW.

**V3 user message:** `# Question` (+ `HEARD_QUESTION_PERSPECTIVE` on WTA) → provenance-labelled conversation → `# Evidence` | `privacy_withheld` | `no_evidence` → `evidence_story` → `list_form` → `default_length` (dropped if the user sets one) → `<user_instructions>` last.

**Legacy prompts, live only on fallbacks.** `llm/prompts.ts` (`HARD_SYSTEM_PROMPT`, per-provider constants, `MODE_*` templates, `CODE_HINT_PROMPT`): reached only when v2 returns null or is off (`systemPromptOverride || HARD_SYSTEM_PROMPT`, LLM:9486), on V3-null edge paths (`composeWtaSystemPrompt`, `wtaSystemPrompt.ts:47`) and CodeHint's fallback; `buildCodeHintMessage` is live when V3 did not compose; non-answer prompts (title/summary/email/recap) likely come from here (*not traced*). `tinyPrompts.ts`: legacy local-model tier (v2 has its own; `TINY_CORE` hardcodes six sections). Premium `ContextAssembler` persona: legacy intercept only. By contrast `userInstructionContract.ts` is **live** (`<user_instructions>`, coding-format resolution, authority note).

---

## 7. Speaker and addressee representation

**Roles.** Only `interviewer | user | assistant`. Every legacy/transcript renderer hardcodes `[INTERVIEWER]`/`[ME]` regardless of mode (`SessionTracker.ts:681`, `transcriptCleaner.ts:204`, `TemporalContextBuilder.ts:141` "Weight interviewer turns more strongly"). The V3 transcript port uses `THEM`/`ME`/`ME (typed to the assistant)` (`live-transcript-port.ts:54-62`). The per-mode role table `MODE_ROUTING` (`routing/IntentFrame.ts:304-362`; recruiting user=interviewer/other=candidate, sales seller/prospect, …) is flag-off with no runtime importer; its doc comment records the Recruiting mislabel. No live user_role, other_party_role, addressee or utterance-intent state; `CanonicalTurn`/`TurnIdentity` carry no speaker. The only speaker signals are interview-framed: `detectedSpeaker`, `speakerPerspective` (hardcoded `'interviewer'` at E:2283/2369/2534/2901) and the composer's `heardQuestion`.

**Latest-question selection.** `extractLatestQuestion` considers only `interviewer` turns (`transcriptQuestionExtractor.ts:400`). The **user-asked-last override** (E:2125-2146) swaps in the user's own ≥12-char wh/aux question but does not reset `detectedSpeaker`; `heardQuestion` is set by surface (bridge:566). So the user's own question is labelled "Asked aloud by the other person… 'I/we/our' mean that speaker" (composer:1063), inverting the speaker, and the absence notice takes the "asked OF the user" branch. The conversation legend never says who `[INTERVIEWER]` is outside interview modes.

**Per-mode gaps.** Recruiting (the only mode where the user asks) has no branch for the candidate asking the recruiter: the persona forces a probe/third-person advice, while PERMANENT_RULES say "answer in the user's voice" and the value rule says "value first, then coaching". Team Meet says "speak only when addressed" with no addressee state.

**Claim taxonomy.** `ClaimType` (`contracts/types.ts:29-35`) has no preference, product-capability, support-policy, pricing or external-research type, so the `/^USER_/`-gated guards (`personalPast`, `personalGuard`, `evidenceStoryGuard`) cannot fire for those asks and absence notices fire only on `PRIVATE_SOURCE_REQUIRED`. Support contacts have no rule. **Push-to-invent lines:** FULLER band "one concrete detail" (`speakability.ts:222`), no-context "what they value" (composer:276), LFW "present role and one proof point", Sales "grounded specifics / never stall", "never ask to clarify" (composer:253).

**Coaching/speaker code.** `COACHING_WRAPPER_RE` (v2:1146) has no runtime caller. The humanizer's `CANDIDATE_NARRATION_REWRITES` ("the candidate has" → "I have", `humanLikeness.ts:217`) is mode-blind and live on legacy typed chat (IPC:5366, legacy branch of `_geminiChatStreamHandler`): a Recruiting speaker-inversion risk (*code-read, not measured*). No "Certainly!/Absolutely!" filter.

## 8. Post-processing, correction passes, GIST

**Stream level** (every `streamChat` consumer, repairs included): `StreamingReasoningFilter` (leading think tags only), `StreamingDashReducer` (dashes → ", " outside code), 16,000-char cap (`liveDeadlines.ts:457`) → `outcome.truncated`. `clampResponse` is disabled; length is prompt-only.

**Typed V3 (default typed path): zero post-stream passes.** `finalText` = raw concatenation; no NO_ACTION, canned-opener/tail, meta-preamble or humanizer step.

**Hotkey WTA** (E:4596-6575, in order; *LLM* = model call): 1 short-answer retry (<160 chars) · 2 empty regen · 3 JSON-envelope recovery · 4 leaked schema-stub line · 5 transport-error text · 6 leaked-tag line · 7 `validateAnswerStructure` (coding; six-section fill-in) · 8 scaffold-misfire extraction · 9 scaffold regen *LLM* · 10 doc-grounded validate/repair *LLM* ("Output ONLY the corrected answer", E:5475-5486; accepted only if non-fabricating, ≥60% length, re-validates; skipped on visual turns) · 11 profile repair (**off on V3-composed turns**) · 12 `stripPlanningPreamble` · 13 steering-tail strip · 14 candidate sanitizer · 15 product-about line · 16 assistant-voice regen *LLM* · 17 false "no content" · 18 non-answer sentinel regen/line · 19 clause coverage (OFF) · 20 relevance regen (OFF, observe-only) · 21 spec strip · 22 `cleanAnswerArtifacts` (`stripMetaPreamble`, `[INTERVIEWER]:` preamble) + `compressToSpeakable` · 23 `applyAnswerContract` humanizer/diversity (OFF) · 24 background code correction (OFF). Speculative/Auto-Answer adopted runs get only 22-23. Typed legacy has its own ~14 passes (IPC:4722-6373), with the humanizer and diversity guard always on.

**Meta filters, verified misses:** "The interviewer's question is…", "The user is asking…", "They want to know…", "Here's how I'd answer:" and "Okay, so I should frame…" pass both filters.

**Stream vs final.** WTA: the final `suggested_answer` replaces the streamed row when it diverges (NI:6895/6915); fallback lines from passes 1/4/5/6/18 are first *appended* via `emitChunk`; answers >30 s old get "(Late answer to: …)". Typed legacy: `finalText` replaces the row (NI:8196); `MeetingChatOverlay` ignores it; persisted/phone text uses `fullResponse`, not the stripped `finalText`.

**GIST.** v2 glance rule (v2:301-302) asks for a final `[[GIST]] …` line past ~40 words. Main never strips it: the raw line goes to session history, usage DB and phone; it is parsed only for history essence (`history-render.ts:60`), summaries and steering-tail re-attach (`stripDisplayMarkup` has zero callers). The renderer splits it (`displayMarkup.ts:42/89`) into a visible **"GIST" chip** (NI:5808, 9308; `index.css:2772-2802`). Raw leaks: `follow_up_questions` copy (NI:9369), phone "Copy conversation", and the body when the marker is misplaced.

**Canned non-LLM responses.** WTA: no API key, "nothing to answer yet", bare follow-up clarification (`FollowUpResolver.ts:153`), source clarification, `buildGracefulRetry`, renderer "Still finishing…". Legacy typed: identity probe, context-free and source clarifications, NO_ACTION line.

## 9. Provider path

**Default.** Fresh install `gemini-3.1-flash-lite` (`CredentialsManager.ts:1142`, applied via `ProcessingHelper` → `LLM.setModel`); saving a Natively key switches to `natively`. Fast Response (`groqFastTextMode`) OFF; when on, WTA pins the fast pick per turn (`textTurn`, E:4240). `ProviderRouter` is a data-scope/privacy gate, not dispatch; the intent router is off (shadow only).

**Ladder** (`_streamChatInner`, LLM:8677+): Antigravity (:9960) → images: `streamVisionWithFallback` (:9989; all fail → fixed "couldn't read the screen" line) → fast pick + `guardFastPick` (:10042) → old fast ladder Codex/Groq/Natively (:10076) → Ollama/Codex terminal (:10158) → custom w/ failover (:10175) → cURL (:10219) → selected OpenAI/Claude/DeepSeek/OpenRouter/Fluxion/NIM/LiteLLM/9Router via `streamSelectedProviderWithFailover` (:10236-10385; selected gets ~60% of budget, spares Natively → Gemini Flash → Groq, spares <3 s dropped) → Groq direct (:10397) → `natively` race Natively/Groq/Gemini Flash/Antigravity/custom (:10455) → Gemini cascade lite → flash → pro (:10630) → Natively key (:10687) → saved custom (:10714) → throw (:10750).

**Fallback engine** (`streamFallbackEngine.ts:473-707`): each rung races first non-blank chunk vs a first-token timer (text: 2 attempts, 2.5 s); the first real chunk commits permanently; 20 s post-commit silence ends the stream; auth/model-gone/payload errors skip the provider, others back off and retry. Post-commit failure → hidden `TRUNCATION_SENTINEL` → `outcome.truncated` (WTA won't store it in history; typed V3 sends `incomplete:true`). The reasoning filter sits outside the engine, so a leading think chunk commits a rung while the outer deadline sees no visible text.

**Deadlines.** WTA `totalHardTimeoutMs`: 8 s built-in / 13 s Natively server / 15 s user endpoint / 20 s vision / 30 s local, via `raceStreamWithDeadline`, 8 s inter-token stall. Legacy typed: `firstUsefulDeadlineMs`. Typed V3: none. Arithmetic, not observed: under 8 s, Gemini Pro is unreachable once flash-lite stalls; later Natively-race rungs cannot fit in 13 s.

**Caps/sampling.** No per-mode or per-intent `max_tokens`. Groq/DeepSeek 8192; Gemini 65536 (thinking budget 0); OpenAI per-model; Claude 8k-128k by model; OpenRouter/Fluxion/Natively none. Temperature 0.2, seed 7 where supported (LLM:443). Reasoning suppressed at request time for Groq, DeepSeek, Gemini, 9Router; others rely on the stream filter.
