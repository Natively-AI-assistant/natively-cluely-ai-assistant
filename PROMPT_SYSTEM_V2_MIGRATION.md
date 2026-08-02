# Prompt System v2 — integration notes (2026-08-01)

Flag: `promptSystemV2` — env `NATIVELY_PROMPT_SYSTEM_V2`, setting `promptSystemV2Enabled`, **DEFAULT ON since 2026-08-02** (promoted after the 8-run benchmark campaign — see `benchmarks/prompt-v2-vs-legacy/results/COMPLETE-WIN.md`: final warm-cache run 31/32 categories, every mode/dimension/safety/format/latency category won). Kill-switch: `NATIVELY_PROMPT_SYSTEM_V2=0` (or the setting) reverts every call site to the legacy constants byte-for-byte — all wiring is `resolveV2SystemPrompt(...) ?? legacy`.

Composer: `electron/llm/promptSystemV2.ts` (adapted from `promptupgrade/natively-prompts-v2.ts`).

## Architecture: old → new

Three prompt regimes exist at runtime, in precedence order:

1. **Context Intelligence V3** (`electron/context-intelligence/generation/prompt-composer.ts`, default ON) — owns the system prompt on assist / manual chat / WTA / clarify / brainstorm when it resolves a decision. **Untouched by this migration.** When V3 composes, v2 never runs (V3 prompts arrive as `systemPromptOverride`/`v3` and win every `??` chain).
2. **Prompt System v2** (this migration, flag-gated) — replaces the entire *legacy constant stack*: `UNIVERSAL_*`, `TINY_*`, `CLARIFY_MODE_PROMPT`, `BRAINSTORM_MODE_PROMPT`, `CODE_HINT_PROMPT`, `CHAT_MODE_PROMPT`, the per-provider `HARD/GROQ_/OPENAI_/CLAUDE_SYSTEM_PROMPT` defaults, and the `## ACTIVE MODE` `MODE_*_PROMPT` template suffix. One composition: cloud/local core → active mode contract → active action contract → (custom block). Coding routes (technical-interview mode, code_hint action) append the validator-pinned six-section `CODING_CONTRACT` unchanged.
3. **Legacy constants** — the flag-off path and the fallback if the resolver ever throws.

Specialized systems deliberately preserved and still layered on top of/under v2:
document-grounded retrieval + reshaping, Context OS evidence packs, profile JIT, OKF, RAG, custom-mode pinned instructions (`## ACTIVE MODE INSTRUCTIONS`, 1,200-char cap, sensitivity-scoped), language injection, Gemini/Claude/OpenAI prompt caching + prewarm, meeting note sections, and the meeting summary JSON schema prompt (parser-coupled — intentionally NOT re-prompted).

## Wiring (all `v2 ?? legacy`)

| Surface | File | Action |
|---|---|---|
| Assist | `electron/llm/AssistLLM.ts` | `assist` |
| Answer (engine) | `electron/llm/AnswerLLM.ts` | `answer` |
| What to say (live WTA) | `electron/llm/WhatToAnswerLLM.ts` (+ suffix skip) | `what_to_say` |
| Clarify | `electron/llm/ClarifyLLM.ts` (both paths) | `clarify` |
| Brainstorm | `electron/llm/BrainstormLLM.ts` | `brainstorm` |
| Follow-up refine | `electron/llm/FollowUpLLM.ts` | `followup` |
| Follow-up questions | `electron/llm/FollowUpQuestionsLLM.ts` | `follow_up_questions` |
| Recap | `electron/llm/RecapLLM.ts` (both paths) | `recap` |
| Code hint | `electron/llm/CodeHintLLM.ts` | `code_hint` |
| Manual chat + phone chat + doc-grounded regen | `electron/ipcHandlers.ts` `resolveManualChatBasePrompt()` | `answer` |
| Meeting title | `electron/MeetingPersistence.ts` | `title` |
| Follow-up email | `electron/ipcHandlers.ts` `generate-followup-email` | `followup_email` |
| Summary JSON | **not re-prompted** (schema-coupled deterministic parser + mode note sections) | — |

LLMHelper hooks:
- `_streamChatInner` / `chatWithGemini`: default the base to v2 `answer` when no override; a v2-composed prompt counts as a *universal override* and the `## ACTIVE MODE` template suffix is never stacked on it (both injection sites gated). Custom-mode pinned instructions + mode context retrieval unchanged.
- `streamChatWithGemini`: the four provider personalities collapse to one v2 base.
- `resolveLocalSystemPrompt`: a v2 cloud prompt downgrades to the v2 **local** composition of the same mode+action on the tiny tier (descriptor registry round-trip).
- `prewarmPromptCache`: warms the v2 base when the flag is on (prefix parity with live requests).

## `[[NO_ACTION]]` sentinel suppression

- WTA/live: `IntelligenceEngine.isNonAnswerSentinel` now also matches the sentinel (via `shouldSuppressModelOutput`) → existing speculative-silent-discard / manual-press-substitution branches apply; the 160-char safe-prefix stream gate already prevents painting, and a misfired leading sentinel is stripped at emit.
- Manual chat: `sendChunkGated` holds the first ~13 chars until the buffer can no longer be the sentinel (zero flash); exact sentinel → substituted with the honest insufficient-context line + `do_not_store` write decision; misfire prefix stripped from display and persistence.
- Storage backstop: `SessionTracker.addAssistantMessage` refuses the sentinel (covers contextItems, fullTranscript → epoch summaries → DB transcripts, lastAssistantMessage, response history — all ~23 call sites).
- Phone surface: `PhoneMirrorService.publishDone` / `publishAssistantMessage` suppress it.
- RAG/meeting-memory already exclude assistant turns by origin; with the SessionTracker guard the sentinel can't enter them at all.

## Measured prompt sizes (compiled, chars)

| Route | Legacy | v2 | Δ |
|---|---|---|---|
| WTA live, looking-for-work, cloud | 47,636 | 7,502 | −84% |
| WTA live, seminar, cloud (suffix never stripped — pre-existing bug) | 51,429 | 6,940 | −87% |
| WTA live, sales, cloud | 40,042 | 7,252 | −82% |
| WTA live, technical-interview, cloud | 39,047 | 8,350 | −79% |
| Assist, general, cloud | 23,160 | 6,830 | −71% |
| Provider default (Groq), cloud | 30,503 | 6,755 | −78% |
| Clarify / Brainstorm, cloud | 15,770 / 15,754 | 6,718 / 6,802 | −57% |
| Code hint, cloud | 16,224 | 8,236 | −49% |
| Manual chat, general, cloud | 6,337 | 6,755 | +7% |
| Recap / follow-up refine / follow-up questions, cloud | 421 / 560 / 695 | ≈6,800 | **grows** — these legacy micro-prompts carried NO identity/security/injection rules; v2 gives them the shared core. Tunable (could route them to the local core) if cost matters more than consistency. |
| WTA / Answer, local tiny | 6,564 / 7,242 | 2,070 / 2,068 | −69% |

## Rollout order (by risk)

1. `general` + `team-meet` (lowest risk), cloud Gemini first (explicit cache, measurable).
2. `lecture`, `recruiting`.
3. `looking-for-work`, `technical-interview` (coding contract regression suite first).
4. `sales` (confidential-bounds scenarios 08–10), `seminar` (citation scenarios 21/22), custom modes.
Providers: Gemini → Groq → OpenAI/Claude → local Ollama.
Gate each step on the live eval harness (`RUN_PROMPT_V2_EVAL=1`) plus the §Metrics list in `promptupgrade/NATIVELY_PROMPT_AUDIT_AND_MIGRATION.md`.

## Deliberately retained (remove only after flag is default-ON a full release)

- All legacy constants in `prompts.ts`/`tinyPrompts.ts` (flag-off path).
- Already-dead exports found during mapping (removable in a separate cleanup PR even before rollout): 13 per-action `GROQ_*/OPENAI_*/CLAUDE_*` variants, `CUSTOM_ANSWER/WHAT_TO_ANSWER/FOLLOWUP/RECAP/FOLLOW_UP_QUESTIONS/ASSIST_PROMPT` + `LLMHelper.mapToCustomPrompt` (zero callers), `FOLLOW_UP_QUESTIONS_MODE_PROMPT`, `ANSWER_MODE_PROMPT`, `WHAT_TO_ANSWER_PROMPT`, `FOLLOWUP_MODE_PROMPT`, all seven `TINY_MODE_*_PROMPT`, `TINY_TITLE/SUMMARY_JSON/FOLLOWUP_EMAIL_PROMPT`, `TINY_CORE` (re-export only), dead `MODE_CONFIGS` in `llm/types.ts`.
- "Nothing actionable right now." producers inside `MODE_*_PROMPT` (still live flag-off).

## Turn composer wiring (2026-08-02)

`buildTurnContentV2` is now LIVE on three surfaces (flag-gated, `?? legacy`, all
stand down for V3-owned or Context-OS-governed turns):

| Surface | Envelope | Where |
|---|---|---|
| Live WTA | FULL typed envelope (profile/reference/screen/DOM/prior-responses evidence → transcript → extracted question → intentContext as task). Screen OCR keeps the assembler injection-redaction. Skipped when governed (`cogGovernedTurn`) — the rendered pack must not be re-escaped. | `WhatToAnswerLLM.ts` (`_v3p?.user ?? _v2TurnUser ?? packet.userMessage`) |
| Manual chat / phone / assist | Assembled-context envelope at the ONE chokepoint after routing/governance/doc-grounding decide (`_streamChatInner` plain branch): upstream-sanitized context VERBATIM, escaped `<current_turn>` + `<task>` last. Gated on the LIVE prompt being v2-composed, non-coding answer type, message not already enveloped; transport-normalized like the governed path. | `LLMHelper.ts` |
| Follow-up refinement | Structured envelope (previous answer as evidence, request as turn+task). | `FollowUpLLM.ts` |

Pinned mode instructions ("Real-time prompt") now ride the v2 SYSTEM prompt for
any mode (`buildSystemPromptV2` renders `<custom_instructions>` whenever
provided) — they are user config and must not be demoted to evidence.

Deliberately NOT enveloped: Recap/FollowUpQuestions/Brainstorm/Clarify/CodeHint
(their production input is one inseparable blob passed as the message — wrapping
would mislabel the whole blob as the newest turn); Context-OS-governed and
doc-grounded turns (own validated shapes); the non-streaming `chatWithGemini`
transport (minor traffic: meeting summary/title/email).

## Universal coding-answer contract (2026-08-02)

The coding contract is now SEMANTICALLY activated: `codingTask: true` on the
composer (threaded from the existing deterministic router — `AnswerPlanner`'s
`isCodingAnswerType`, never re-derived from text) attaches the contract in ANY
mode, current or future. Wired at five sites: manual chat (`isCodingChat`),
phone chat (its own plan), both LLMHelper entry resolves (`routeOptions`),
live WTA, and AnswerLLM. The contract gained four universal rules: the mode
shapes tone but never removes approach/code/example/complexity (explicit user
format requests still override); self-contained coding problems answer from
open knowledge with NO materials disclaimer and no résumé/JD consultation;
never silently switch languages; complexity from the actual implementation
with meaningful variables. Carried through the descriptor so cloud→local
downgrades recompose identically. Already existing and NOT duplicated:
subtype machinery (`codingFollowup.ts` code_only/hint/etc.), source isolation
(`forbiddenContextLayers`), knowledge routing (V3/Context OS), and the
validator-pinned six-section format.

## Teleprompter display layer (2026-08-02)

Answers stay 15–30s spoken prose; a bounded glance layer sits ON TOP of the
word stream so the speaker can reconstruct the answer from hot words:

- **Contract** (`human_voice` in both cores + `final_check` law 5): at most
  three `**hot-word**` marks of at most four words each, never reshaping a
  sentence to showcase a mark; enumerable questions may use a numbered list
  (≤5 items); answers past ~40 words end with one `[[GIST]]` line — the
  five-to-eight-word essence, very last line, never spoken.
- **Helpers** (`promptSystemV2.ts`, exported via `llm/index.ts`):
  `GIST_MARKER`, `splitGistLine` (marker honored only at the start of the
  LAST non-empty line; malformed placement stays visible so lint flags it),
  `stripDisplayMarkup` (pure spoken stream for any TTS/speak consumer).
  `spokenFormatViolations` flags only OVER-bounded marking
  (`markdown_bold` >3 spans or >4-word span) and `gist_misplaced`.
- **Renderer twin** `src/lib/displayMarkup.ts` (+ `splitGistLineStreaming`,
  which hides a partial trailing marker mid-stream) — duplicated because the
  renderer cannot import main-process modules; parity pinned by
  `src/lib/__tests__/displayMarkup.test.mjs`.
- **Renderer wiring**: `NativelyInterface.tsx` — imperative streaming paint
  (`paintRevealedNow`) splits body/gist and appends an `overlay-gist-chip`
  div; finalized branches (what_to_answer, shorten, recap, system fallback)
  render `gistBody` + chip, and their copy buttons copy the marker-free body;
  hot words via `overlay-hotword` class on the spoken intents' `strong`
  handlers (accent color, `--accent-primary`) and a
  `.natively-streaming-answer strong` rule for the streaming bubble.
  `MeetingChatOverlay.tsx` and `MeetingDetails.tsx` (persisted answers)
  split the same way. CSS in `src/index.css` ("Teleprompter glance layer").
- **Benchmark symmetry**: `lib/checks.mjs` mirrors the bounded-marks
  allowance and excludes the gist line from prose lint and word counts.

## Typed-chat layout (`chatSurface`, 2026-08-02)

The spoken contract optimizes for the EAR (flowing 15–30s prose, no lists);
the chat panel is read with the EYE, and reading rewards structure. New
composer input `chatSurface: boolean` (default off) attaches a
`<chat_layout>` block — only `resolveManualChatBasePrompt` (ipcHandlers
manual chat) sets it, so every live/spoken surface is byte-identical.

- **Shape**: one direct lead sentence → short bold-labeled sections
  (`**Example:**`, `**Core concepts:**`) with compact bullets or tiny code
  → for interviewer-plausible questions, a closing `**Good interview
  answer:**` with ONE quotable sentence (spoken rules apply to that
  sentence only). ≤120 words of prose outside code/lists.
- **Precedence**: coding contract > chat layout > defaults; exact-words
  requests and explicit format requests keep/override as before. Block is
  composed AFTER the coding contract so recency cannot loosen it.
- **Carried in the registry descriptor** (like `codingTask`) so the
  cloud→local downgrade recomposes the same surface; local tier gets a
  one-paragraph `CHAT_LAYOUT_TINY`.
- **Tests**: 6 in `PromptSystemV2Composition2026_08_01.test.mjs`
  (attach-in-every-mode, no-leak matrix across all 216 spoken
  compositions, tiny variant, coding-precedence order, descriptor
  round-trip, final-check-last). Live-probed on deepseek-v4-flash:
  both probe questions rendered the intended layout.
- **Renderer note**: the bold section labels are `<strong>`, so the
  glance-layer CSS paints them in the hot-word lavender — labels ARE the
  glance anchors on this surface, no extra wiring.

## V3 persona bridge (`personaBase`, 2026-08-02)

Discovery: the V3-owned manual-chat surface (default ON) composes a
**governance-only** system prompt (rules/authority/grounding) — no Natively
identity, no voice contract — so chat answers read like a default AI
assistant, and the v2 chat layout only reached manual chat on V3 *fallback*.

- `ComposeInput.personaBase` (prompt-composer): rendered FIRST; governance
  sections follow and hold recency precedence — persona shapes tone/layout,
  can never outrank a grounding law. Absent ⇒ byte-identical composition.
- `BridgeInput.personaBase` (engine-bridge): a **callback**
  `({codingTask}) => string|null` — called after the decision exists so the
  caller composes against what the turn is; bridge never imports the prompt
  system. Null/throw ⇒ no persona.
- ipcHandlers manual-chat passes `resolveV2SystemPrompt({action:'answer',
  chatSurface:true, codingTask, activeMode})` — deliberately NOT
  `resolveManualChatBasePrompt` (its CHAT_MODE_PROMPT fallback belongs to the
  legacy path; under the v2 kill-switch V3 composes exactly as before).
- NOT wired: the `pathTag:'engine'` manual-chat call site
  (IntelligenceEngine:4781) — that serves live-meeting overlay answers where
  the spoken shape governs; wiring the typed-chat layout there would fight it.
- Same-day composer fix: `noEvidenceNotice` private-claim guard hoisted to
  cover ALL branches — a general-claims follow-up ("give me an example" after
  "what is a REST API", answerability FULL) retrieves conservatively, finds a
  zero-attachment mode, and was instructed to say "no document has been added
  to this mode yet". Empty retrieval is only narratable when a claim actually
  REQUIRED a private source.
- Tests: 8 new in PromptComposition.test.mjs (guard both ways, persona
  first/absent-identical/whitespace). Live-probed the failing turn with the
  real combined prompt: correct layout example, zero source narration.

## Known gaps / remaining shadow work

- Generation-intent → provider-parameter mapping ships as `recommendedGenerationProfile()` (tested) but is NOT live-wired: the app already runs low-variance everywhere (`INTERACTIVE_TEMPERATURE=0.2`, OpenAI no-sampling-params preserved). Wiring medium variance for brainstorm/followup_email needs per-request parameter threading through the provider adapters — deferred deliberately (an instance-level override would race concurrent streams).
- Live model eval (16 scenarios) is opt-in and has not been run in this session (no API key spend); run before any rollout step.
- V3-owned surfaces keep V3's own composition; unifying V3's composer output shape with v2's display contract is future work.
- Recap/followup/follow-up-questions prompt growth (see table) is a deliberate consistency/security trade.
