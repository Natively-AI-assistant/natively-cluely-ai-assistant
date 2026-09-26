# Natively classifier freeze, 2026-09-04

Phase 1 deliverable. This records the exact state of intent classification before any change. Everything here was read out of the code on branch `feat/extension-system` at commit `330717e5`. Where this contradicts the campaign brief, the code is recorded and the difference is called out in the deltas section.

## The headline correction

The brief says "the current intent classifier". There are two, and they do not share a taxonomy, a runtime, a surface, or a consumer.

Classifier A is `electron/llm/IntentClassifier.ts`. It is the regex plus MobileBERT zero-shot NLI pipeline the brief describes. It serves the live "what to answer" surface through `IntelligenceEngine`.

Classifier B is `premium/electron/knowledge/IntentClassifier.ts`. It is pure TypeScript, no model, keyword scoring plus regex plus a Levenshtein garble rescue. It serves the manual knowledge surface through `premium/electron/knowledge/KnowledgeOrchestrator.ts:1269`. Its labels are `intro`, `negotiation`, `technical`, `profile_detail`, `company_research`, `general`.

Any plan that retires "the classifier" has to retire both, or state that B is out of scope. The compatibility shim in PR 8 of the brief is scoped to A's eight labels only, so it does not cover B.

## Classifier A: exact freeze

### Model and runtime

The model id is `Xenova/mobilebert-uncased-mnli`, hardcoded twice. Once as `INTENT_MODEL_ID` in `electron/llm/IntentClassifier.ts:23`, used as the poison sentinel key. Once as a string literal in `electron/llm/intentClassifierWorker.ts:31`, used as the pipeline argument. The two are not derived from each other, so they can drift.

The runtime is `@huggingface/transformers`, loaded through `new Function('return import("@huggingface/transformers")')` at `intentClassifierWorker.ts:11`. The brief says `@xenova/transformers`. The code uses the successor package.

The pipeline task is `zero-shot-classification`. `dtype` is pinned to `'q8'` at `intentClassifierWorker.ts:44`. That pin is load bearing. Transformers.js v3 ignores the v2 `quantized` option and defaults to fp32, which asks for `onnx/model.onnx`, while the installer ships `onnx/model_quantized.onnx` and nothing else. Without the pin a packaged build fails the load and degrades silently to regex.

Session options come from `getBoundedOnnxSessionOptions()` in `electron/utils/onnxThreadConfig.ts`.

### Tokenizer

Not specified in application code. It is whatever `@huggingface/transformers` resolves from the model directory, which is the MobileBERT uncased WordPiece vocabulary.

### Labels and hypothesis template

Eight candidate labels, defined as a map from natural language hypothesis fragment to `ConversationIntent` at `IntentClassifier.ts:70`.

| Hypothesis fragment sent to the model | Mapped intent |
|---|---|
| asking for clarification or explanation | `clarification` |
| asking about what happened next or follow-up | `follow_up` |
| requesting more detail or deeper explanation | `deep_dive` |
| asking for a personal experience or behavioral example | `behavioral` |
| requesting a concrete example or instance | `example_request` |
| summarizing or confirming understanding | `summary_probe` |
| asking about code, programming, or implementation | `coding` |
| general conversation or question | `general` |

The hypothesis template is not set by the intent path. `intentClassifierWorker.ts:92` only attaches `hypothesis_template` when the caller passes one, and the intent caller never does. Transformers.js therefore applies its default, `"This example is {}."`. So the actual hypothesis for the first label is `This example is asking for clarification or explanation.`

`multi_label` is hardcoded `false` at `intentClassifierWorker.ts:91`. The eight scores are softmaxed against each other. There is no independent per label probability, and no way to express "two of these at once".

### Thresholds, confidence, top-k

`SLM_CONFIDENCE_THRESHOLD` is `0.35`, at `IntentClassifier.ts:83`. `mapWorkerResult` takes `labels[0]` and `scores[0]` only, so top-k is effectively 1. If the top score is below `0.35` the whole model result is discarded and the caller falls to tier 3. Alternatives and the runner up margin are computed by the model and then thrown away.

Confidence values that reach the rest of the system are mostly constants, not probabilities. The regex tier returns hardcoded `0.95`, `0.9`, `0.85`, `0.9`. The context tier returns `0.7` or `0.5`. Only the model tier returns a real score. Nothing downstream distinguishes a hardcoded `0.9` from a measured `0.9`, so the system has no calibration today and cannot be given one without changing the regex tier.

### The three tiers

`classifyIntent(lastInterviewerTurn, recentTranscript, assistantMessageCount)` at `IntentClassifier.ts:653`.

Tier 1 is `detectIntentByPattern`, at `IntentClassifier.ts:504`. Runs only when `lastInterviewerTurn` is truthy. Returns on first match or `null`.

Tier 2 is the zero-shot model. Runs only when tier 1 returned `null` and `lastInterviewerTurn.trim().length > 5`. Returns `null` on any load failure, any inference failure, or a top score under `0.35`.

Tier 3 is `detectIntentByContext`, at `IntentClassifier.ts:625`. It cannot return `null`. It is the terminal default.

### Tier 1 regex rules, verbatim and in order

Evaluation order matters, since the first match wins. The order below is the source order.

1. `clarification`, confidence `0.9`:
   `/(can you explain|what do you mean|clarify|could you elaborate on that specific)/i`

2. `follow_up`, confidence `0.85`:
   `/(what happened|then what|and after that|what.s next|how did that go)/i`

3. `deep_dive`, confidence `0.85`:
   `/(tell me more|dive deeper|explain further|walk me through|how does that work|how (should|would) (you|i) explain)/i`

Before rule 4 the text is rewritten into `textNoStackUpIdiom` by three substitutions, which exist to stop the comparison idiom "stack up" and the tech stack noun from firing the DSA rule:

```
.replace(/\bstack(s|ed)?\s+up\b/g, 'measure$1 up')
.replace(/\b(that|this|your|our|their|my)\s+stack\b/g, '$1 techstack')
.replace(/\b(chose|choose|chosen|choosing|pick|picked|picking|selected|select|use|used|using|went with|decided? on)\s+the\s+stack\b/g, '$1 the techstack')
```

4. `coding`, confidence `0.95`, tested against `textNoStackUpIdiom`:
   `/(two\s*sum|longest substring|reverse (a )?linked list|detect a cycle|binary search|sliding window|two pointers?|hash\s?(map|set|table)|\bstack\b|\bqueue\b|\bheap\b|\btrie\b|union[- ]find|dynamic programming|\bdp\b|backtracking|\brecursion\b|\bgraph\b|\btree\b|\bbfs\b|\bdfs\b|time complexity|space complexity|big[- ]?o)/i`

5. `coding`, confidence `0.9`:
   `/(write code|code for|program for|\bprogram\b|\bimplement\b|function for|algorithm for|algorithm|how to code|setup a .* project|using .* library|debug this|snippet|boilerplate|example of .* in .*|best practice for .* code|utility method|component for|logic for|\bsolve\b|solve .* in (javascript|typescript|python|java|c\+\+|sql))/i`

6. `coding`, confidence `0.9`:
   `/(odd\s*(?:\/|or|and)?\s*even|even\s*(?:\/|or|and)?\s*odd|prime number|palindrome|factorial|fibonacci|reverse string|sort array|find max|find min|check if|check whether|determine whether|detect whether)/i`

7. `behavioral`, confidence `0.9`:
   `/(give me an example|tell me about a time|describe a situation|when have you|share an experience)/i`

8. `example_request`, confidence `0.85`:
   `/(for example|concrete example|specific instance|like what|such as)/i`

9. `summary_probe`, confidence `0.85`:
   `/(so to summarize|in summary|so basically|so you.re saying|let me make sure)/i`

10. `coding`, confidence `0.85`, requires both halves to match:
    `/\b(optimi[sz]e|refactor)\b/i` and `/\b(code|function|algorithm|query|sql|typescript|javascript|python|java|class|method|implementation)\b/i`

Rules 4, 5, 6 and 10 all produce `coding`. Four of the ten rules, and the highest confidence rule, encode a single mode's taxonomy. Rule 6 in particular fires `coding` on the bare phrase "check if", which occurs constantly in ordinary speech.

The DSA rule carries a documented history of misfires. Bare `stack` classified "how many identical layers are stacked in the encoder" as coding at `0.95`, which bypassed the entire document grounded pipeline because `IntelligenceEngine` guards that pipeline on `!isCoding`. The word boundary anchors and the idiom rewrites are the accumulated repairs. This is direct evidence for brief fault 3: one flat label is carrying a routing decision it was never designed to carry.

### Tier 3 context heuristic, verbatim behaviour

```
if (assistantMessageCount >= 2) {
    const interviewerLines = lines.filter(l => l.includes('[INTERVIEWER'));
    const lastInterviewerLine = interviewerLines[interviewerLines.length - 1] || '';
    if (lastInterviewerLine.length < 50 && assistantMessageCount >= 2) return follow_up @ 0.7;
}
return general @ 0.5;
```

The filter string is `'[INTERVIEWER'`. That literal is produced by `formatTranscriptForLLM` in `electron/llm/transcriptCleaner.ts:204`, which labels every system channel turn `INTERVIEWER` in every mode. The consequences are covered in the modes document.

### Timeout, worker lifecycle, cold start, failure path

`WORKER_TIMEOUT_MS` is `30_000`, at `IntentClassifier.ts:109`. This is a per request timeout on the worker round trip, covering both `init` and `classify`. There is no separate, shorter inference deadline. A slow classify can stall a live turn for up to thirty seconds before rejecting.

The worker is a singleton `ZeroShotClassifier` hosting one `worker_threads.Worker`. It is spawned lazily on first `ensureLoaded`. Worker path resolution tries three candidate paths and rewrites `app.asar` to `app.asar.unpacked`. `worker.unref()` is called after all listeners are attached, deliberately, because attaching a message listener re-references the port.

An ONNX concurrency slot is acquired through `acquireOnnxSlot('normal')` and held for the life of the load. A memory floor check `hasEnoughMemoryForOnnxSession()` can refuse the load without latching failure, so a later call retries.

Cold start writes a disk poison sentinel through `writeOnnxLoadSentinel('intent', INTENT_MODEL_ID)` immediately before `new Worker(...)`, so a native ONNX abort that kills the process leaves a breadcrumb. `main.ts:1708` calls `consumeIntentClassifierSentinel()` on the next launch. If a sentinel is found within TTL, `startupPoisoned` is set and the model is skipped for the whole launch, leaving regex only. `ipcHandlers.ts:10054` exposes `clearIntentClassifierPoison()` as the reset.

Warmup is `warmupIntentClassifier()`, called from `main.ts:8712`. It is fire and forget and returns immediately if poisoned.

Every failure path degrades to regex silently from the user's point of view. Status is published to `ProviderStatusRegistry` under id `intent-classifier` with `requiredForStartup: false` and `requiredForCoreFallback: true`.

### The second consumer of the same session

`classifyZeroShotRaw(text, labels, hypothesisTemplate)` at `IntentClassifier.ts:770` is a public entry point onto the same singleton worker and the same ONNX session. Its only caller is `electron/llm/AnswerRelevanceChecker.ts:122`, which passes a single candidate label and a custom hypothesis template to run an answer relevance entailment check.

This matters for the campaign. PR 11 of the brief removes MobileBERT. Removing it also removes the answer relevance check unless that check is rehomed first. The brief does not mention this.

### Where the output goes

`IntentResult` is `{ intent, confidence, answerShape }`. `answerShape` is a prose string looked up from `INTENT_ANSWER_SHAPES` at `IntentClassifier.ts:53`. It is a prompt fragment, not a structured decision.

Two call sites, both in `electron/IntelligenceEngine.ts`.

At `:1000` it is awaited inline and fed to `planNextAssistantAction` in `electron/llm/PlannerDecision.ts`, which decides whether to fire a suggestion at all.

At `:1794` it is kicked as an unawaited promise and resolved later at `planAnswer` time, so classification overlaps retrieval. It has an inline `.catch()` returning `general @ 0.4`, which is a fourth confidence source that never touches the classifier. The input is `question || extractedQuestion.latestQuestion || lastInterviewerTurn`, so it sees the resolved question rather than the raw last turn.

Consumers of the resulting `IntentResult` are `electron/llm/AnswerPlanner.ts`, `electron/llm/PlannerDecision.ts`, `electron/llm/WhatToAnswerLLM.ts`, `electron/llm/TurnPlanner.ts` and `electron/intelligence/LiveMomentRouter.ts`.

## Classifier B: exact freeze

File is `premium/electron/knowledge/IntentClassifier.ts`. No model, no worker, no ONNX. Sub millisecond by construction.

Exports are `classifyIntent(question)`, `classifyIntentWithContext(question, ctx)`, `isGenericKnowledgeQuestion`, `needsCompanyResearch`, `looksLikeGarbledComp` and `INTRO_PATTERNS`.

Labels are the `IntentType` union in `premium/electron/knowledge/types.ts`, including `intro`, `negotiation`, `technical`, `profile_detail`, `company_research` and `general`.

Mechanism is keyword pattern scoring over `INTRO_PATTERNS`, `COMPANY_RESEARCH_PATTERNS`, `NEGOTIATION_PATTERNS`, plus a `SKILL_RATING_REGEX` veto, plus a Levenshtein edit distance rescue over `FUZZY_COMP_WORDS` for STT garble such as "slalary".

`classifyIntentWithContext` is stateful in effect. It takes a context object carrying `negotiationActive`, and soft signals in `NEGOTIATION_FOLLOWUP_SIGNALS` only count when a compensation thread is already open. That is conversational stickiness, which classifier A has no equivalent of.

One comment in this file is directly relevant to Phase 4 and should be carried into the benchmark plan. An earlier design routed near miss compensation words to the zero-shot SLM for a semantic call. It was removed after testing, because mobilebert-mnli scored the real garble "slalary" at `0.18` and false fired on the unrelated technical term "hashmap" at `0.82`, while the deterministic edit distance gate scored ten out of ten on real typos with no false positives over a 133 word vocabulary. That is prior in-repo evidence that the Phase 4 baseline is weak on exactly the short noisy inputs the dataset is meant to be 40 percent composed of.

## Deltas between the brief and the code

The brief names `@xenova/transformers`. The code uses `@huggingface/transformers` with an explicit `dtype: 'q8'`.

The brief names `electron/llm/ModelVersionManager.ts`. No file exists at that path.

The brief asks for a new punctuation and truecasing restoration step as candidate P. `electron/llm/punctuationProvenance.ts` already exists and already models this. It defines `PunctuationSource` as `provider_final`, `provider_interim`, `model_inherent` and `unavailable`, records that only Deepgram and Google request punctuation, and states in its own header that it is designed so a later restoration stage can be added without overwriting raw text. Candidate P should be built against this module rather than beside it.

The brief describes one classifier. There are two.

The brief's PR 11 removes MobileBERT without accounting for `AnswerRelevanceChecker`.

## Open items for the founder

The number of live generations per session that end in a silence string is not measured. Phase 1 makes no behaviour change, so it was not instrumented. Getting a real number needs either opted-in transcripts or a debug-log sweep. See the routing map for why an estimate would be misleading.
