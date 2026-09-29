# Auto Answer V3: adopt spec V2 with these amendments

This document assumes the V2 spec (AutoAnswerTurnManager / Detector / Queue / Types, state machine, replay harness, invariants, skip reasons). All of that stands. V3 changes what V2 got wrong or left out, and fixes the final pipeline shape. Where V2 and V3 conflict, V3 wins.

The two product invariants from V2 §52 remain the top priority and are restated here because every amendment serves them:

1. Never confidently answer something the interviewer did not ask, and never answer Q1 after the interviewer moved to Q2.
2. When a real question lands, answer it with minimum delay after the true end of the question.

---

## Amendment 1: the user channel is a first-class input (new, highest priority)

V2 treats Auto Answer as a transcript problem. It is a two-channel audio problem that happens to produce transcripts.

Natively captures mic (user) and system loopback (interviewer) as separate streams. No other component in the V2 spec consumes the user channel. Add it everywhere:

**New trigger precondition.** An auto-fire requires all of:

```text
interviewer turn committed
AND user channel silent for USER_SILENCE_MS (start at 700)
AND user did not start speaking between commit and dispatch
```

If the user starts answering within the window, the user did not need help. Skip reason: `user_answering` (add to the V2 §30 enum).

**Barge-in cancellation.** If the user starts speaking while an automatic answer is streaming, pause or cancel the stream. Skip/cancel reason: `user_barge_in`. This saves BYOK tokens and stops the overlay changing under the user mid-sentence.

**Overlap veto.** If both channels were active in the last ~400 ms, do not treat the boundary as clean. Hold.

**Implementation.** A small channel state machine, Rust side, fed by the existing per-channel VAD in `silence_suppression.rs`. It emits joint states (`interviewer_speaking`, `user_speaking`, `both`, `neither`) plus ms-since-transition per channel, over the existing native event bridge. The `AutoAnswerTurnManager` from V2 §5 consumes these through the `onSpeechStarted/onSpeechEnded` hooks V2 already defines; extend those hooks with a `channel` parameter.

This amendment is the single largest false-fire reduction available and it costs no model, no download, and microseconds of compute.

---

## Amendment 2: commit to the audio endpoint model, phase 2 not "maybe"

V2 §15 and §37 defer any learned turn model. Keep the ordering (deterministic system and harness first) but change "decide later whether necessary" to "scheduled, with a reserved interface." Reasons:

- Declarative questions ("So you own that service now.") carry the question in pitch, not words. Text heuristics and the question extractor cannot see them. This is a whole category of interview follow-ups.
- The Whisper REST providers (Groq, OpenAI) emit no endpoint signal at all; `speech_ended` starts the upload. Text-side quiet windows are the only fallback there today and they are exactly the mechanism V2 §2 says is insufficient.
- The cost objection is empirically dead. Smart Turn v3.1 CPU (`pipecat-ai/smart-turn-v3`, BSD-2): Whisper Tiny encoder + linear head, ~8M params, 8 MB int8 ONNX, ~12 ms on a modern local CPU, 23 languages, input 16 kHz mono PCM up to 8 s. It runs once per interviewer speech-stop event. Natively already ships ONNX Runtime (IntentClassifier, bge-small), so this is one asset file and one session, no new runtime.

**Wiring.** Keep an 8-second rolling ring buffer of interviewer-channel PCM at 16 kHz mono (256 KB). On interviewer speech-stop, run inference and feed the probability into the endpoint fusion below. Implement it behind the exact `TurnPredictor` interface V2 §37 defines, so the deterministic path keeps working when the asset is missing (V2 §38 fallback rule is preserved unchanged).

Do not use TEN Turn Detection (7B, too heavy) or LiveKit v1 full (cloud). LiveKit `v1-mini` is the fallback candidate if Smart Turn underperforms on a target language.

---

## Amendment 3: endpoint fusion replaces the pace presets as the primary mechanism

V2 §8's fast/balanced/relaxed quiet windows survive as the *fallback tier and user preference*, not the decision mechanism. The actual endpoint decision fuses, in priority order:

```text
1. Provider semantic EOT, where the provider has one:
   - Deepgram Flux: EndOfTurn / EagerEndOfTurn / TurnResumed (eot_threshold default 0.7)
   - Deepgram Nova: speech_final, else UtteranceEnd with no preceding speech_final
   - AssemblyAI Universal-Streaming: end_of_turn + end_of_turn_confidence
2. Local Smart Turn probability on the interviewer audio slice (Amendment 2)
3. Adaptive quiet window (V2 §8 presets) as the floor
```

Map all of these into V2 §6's normalized `TranscriptEndpointEvent`; add a `confidence?: number` field to it.

**Adaptive wait replaces fixed wait.** The quiet-window budget shrinks with endpoint confidence:

```ts
// starting values, tuned only via the harness
p >= 0.90            -> commit after 250 ms of continued silence
0.70 <= p < 0.90     -> 600 ms
0.45 <= p < 0.70     -> pace preset (700 / 1100 / 1800)
p < 0.45             -> hold, but see hard cap
HARD_CAP_MS = 2500   // measured from first candidate final; the timer can
                     // never be starved by a chatty provider, and "hold"
                     // can never become "forever"
```

The hard cap is mandatory. It closes the known starvation residual from PR #497 that V2 does not mention.

**Post-commit rhetorical hold.** After commit but before dispatch, hold ~500 to 700 ms and cancel if the interviewer resumes ("Why do we do it that way? Well, because..."). This maps onto V2 §18's `QUESTION_COMPLETE -> POSSIBLE_QUESTION` transition; V3 just makes the hold explicit and timed. Skip reason: `rhetorical` (already in V2 §30).

---

## Amendment 4: ternary dispatch, not binary

V2 §12's policy (answer / wait / ignore) loses the middle band. Replace the action set:

```text
answerability >= AUTO_THRESHOLD  and user silent and engine idle -> auto (fire)
answerability >= OFFER_THRESHOLD                                 -> offer (render action card, Tab/hotkey commits)
otherwise                                                        -> silent
```

`speculate` and `queue` remain orthogonal actions exactly as in V2 §19 and §22. `wait` remains valid pre-endpoint.

Rationale: the cost asymmetry. A miss costs one keypress; a wrong auto-fire aborts a correct in-flight answer via `'superseded'`, burns tokens, and occupies the screen at the worst moment. The offer card is what the medium band gets instead of a coin flip. This is also what Cluely actually ships (Dynamic Actions committed via Tab), per the repo's own `cluelyresearch.md` §5.

The offer card is the one UI element this pass is allowed to add, overriding V2 §47's freeze. Keep it to one card, replaced in place, auto-expiring after ~10 s or on topic change. Everything else in §47 stands.

Per-mode thresholds: Interview mode gets a lower bar than Meeting mode. Store them in the mode config next to retrieval scopes. Do not ship a global pair of numbers.

---

## Amendment 5: scores are not probabilities until the harness says so

V2 §12 and §19 pin thresholds like 0.82/0.88 on scores assembled from heuristics. Keep the constants, but:

- Heuristic composite scores, extractor confidences, provider EOT confidences and Smart Turn probabilities live on different scales. Never compare them against one shared threshold. Each source gets its own threshold constant, fitted independently against the replay harness (V2 §31, §35).
- Add `calibration` to the benchmark metrics in V2 §35: bucket predicted confidence vs observed precision. Until that report exists, treat every threshold in this document and V2 as a placeholder.
- Deletion of the hardcoded `confidence: 0.9` (V2 §13) stands and is phase 0.

---

## Amendment 6: dedup uses the embeddings you already bundle

V2 §21's three layers stand, with one substitution: layer 3 is cosine similarity over the bundled `bge-small-en-v1.5` embeddings, not a new asset. Embed only candidates that survive layers 1 and 2, cache by `questionId`, cap the comparison window to the last ~5 committed questions. Same model already backs the Evidence Probe work, so this adds zero download weight.

Also use the same embedding comparison for speculative reuse (V2 §45): reuse when `cosine >= REUSE_THRESHOLD` (start 0.90) and `candidateGeneration` chain is unbroken.

---

## Amendment 7: provider parity is a tested property, not an aspiration

V2 §34 invariant 11 says provider differences must not change semantics. Make it enforceable:

- The replay harness fixtures gain a `provider` field and a per-provider event dialect (Flux events, Nova speech_final/UtteranceEnd, AssemblyAI end_of_turn, ElevenLabs finals-only, REST-Whisper batch finals).
- CI runs every fixture through every dialect. The assertion is that `shouldAnswer`, the reconstructed question, and the trigger count match across dialects, with only latency allowed to differ.
- The REST-Whisper dialect is the worst case and the reason Amendment 2 exists. If parity fails only there before the audio model lands, record it as a known gap, not a green suite.

---

## Amendment 8: harness data must include real audio, not only synthetic event lists

V2 §31's JSON event fixtures are right for unit-level replay. They cannot validate Amendment 1 (channel timing) or Amendment 2 (audio endpointing). Add a second corpus:

- 30 to 50 recorded real dual-channel sessions (raw stereo PCM + per-provider transcript streams), across Interview, Meeting, and Lecture modes.
- Hand labels: true interviewer end-of-turn timestamps; per-utterance dialogue act (using the V2 §16 taxonomy); per-question whether the user hesitated or answered immediately.
- Consent and storage: sessions recorded by the team on itself or with explicit consent, stored outside the repo, referenced by the harness via local path. Never commit audio.

Gate metrics (extends V2 §35): fire precision >= 0.90 before the toggle may default to ON; false fires per hour; staleness rate (dispatched turn was not the newest question) with a permanent regression guard, since stale-fire was the exact #495 failure mode.

---

## Amendment 9: additions to the adversarial suite

V2 §32 stands. Add these buckets:

```text
Declarative question (audio-dependent, expected to fail until Amendment 2):
    "So you're a senior engineer now."
    "And you led that migration yourself."

User-answered promptly (must NOT fire, Amendment 1):
    interviewer question -> user speech within 500 ms

User silent after question (must fire fast):
    interviewer question -> 1200 ms of dual-channel silence

Interviewer self-answer within hold window:
    "Why do we shard by user id? Because hot keys."

Cross-channel overlap at the boundary:
    user talking over the last words of the question

Code-switching pause mid-question (relevant for the user base):
    English question with a 400 ms language-switch pause inside it
```

---

## Amendment 10: phase ordering, final

```text
Phase 0  (immediate, no architecture):
         hard cap on the current 900 ms debounce; pending-slot rearm with
         6 s TTL for transient gate rejections (drop on expiry, newer
         candidate, or user speech); propagate settings persistence
         failures; delete confidence: 0.9.

Phase 1  Channel state machine + user-silence precondition + barge-in
         cancellation (Amendment 1). No new models.

Phase 2  V2's subsystem build: TurnManager, Detector, Types, Queue, state
         machine, skip reasons, extractor/Brain integration, generation
         guards, telemetry. The JSON replay harness and fake clock.

Phase 3  Audio corpus (Amendment 8) + provider-dialect parity suite
         (Amendment 7). This gates all threshold values.

Phase 4  Endpoint fusion + Smart Turn v3.1 behind the TurnPredictor
         interface (Amendments 2 and 3). Re-run phase 3 gates.

Phase 5  Ternary dispatch + offer card + per-mode thresholds
         (Amendment 4). Speculative reuse keyed by questionId +
         embedding similarity (Amendment 6).

Phase 6  Only after fire precision >= 0.90 on the audio corpus across
         providers: consider defaulting the toggle to ON.
```

---

## Latency and compute budget (the constraint that shaped everything)

Per interviewer turn, worst case on CPU, all local:

```text
VAD stop detection            already paid, existing pipeline
Smart Turn v3.1 inference     ~12 ms local CPU (one call per speech stop)
Question extractor            already paid (existing deterministic code)
IntentClassifier ONNX         existing asset, ~5-15 ms, ambiguous cases only
bge embedding for dedup       existing asset, survivors of cheap filters only
Gate + queue + state machine  < 1 ms
Ring buffer memory            256 KB
New disk weight               8 MB (smart-turn-v3 int8) and nothing else
```

Decision latency after the true end of a confident question: ~250 to 350 ms (silence confirmation dominates, not inference), versus a flat 900 ms today. The LLM call itself is hidden by the speculative path V2 §19 already specifies. Nothing here polls, nothing runs per audio frame except the VAD that already runs, and no cloud call ever participates in the gate (V2 §36 stands verbatim).

## What is explicitly rejected

- Any cloud LLM in the detection path (V2 §36, reaffirmed).
- TEN Turn Detection as a runtime dependency (7B). Its finished/unfinished/wait taxonomy is already absorbed into the V2 §14 labels.
- VAP (stereo-native turn prediction) in this pass. It is the long-term ceiling because it natively consumes Natively's dual-channel format, but it is research-grade code. Revisit after Phase 6.
- "100 percent reliable" as a spec target. The target is measured: precision-gated auto-fire, offer card for the middle band, hotkey as the floor. That combination is what reliability looks like in production.
