# Natively interaction router: benchmark results and decision

Phase 5 of the interaction-router campaign. All figures are measured on the held-out split, which no candidate trained on and no prototype was built from. Reproduce any row with `node scripts/intent-benchmark/run.mjs --provider <id> --split holdout --language en`.

Corpus is `scripts/intent-benchmark/dataset/v1.jsonl`, 2,008 rows, 419 held out, 1,813 English and 195 code-switched. Held-out English rows used for scoring: 377.

## Status: these numbers describe the v1 taxonomy

Every figure in this document was measured against the taxonomy as the campaign brief specified it. Two axes have since changed, on the strength of the error analysis below, and the changes invalidate the two headline numbers rather than adjusting them.

`dialogue_act` merged `question` and `request` into a single `ask`. Half of that axis's overlapping-label failures were that one pair.

`needs_response` dropped `optional` and became binary. Nine of eleven overlaps on that axis were `optional` against `yes`, and inspecting those rows showed `optional` had become a bin for the user thinking aloud on their own microphone.

`scripts/intent-benchmark/dataset/v2.jsonl` carries the migrated corpus, with ids and splits preserved so v1 and v2 compare row for row. The benchmark has NOT been re-run against it. Both changes should raise the two affected numbers, since each removes a distinction no candidate could learn, but by how much is unmeasured and this document does not guess.

The ranking, the latency figures, the architecture conclusion and the error analysis are unaffected: none of them turns on the two merged distinctions.

## The headline

Nothing clears the acceptance bar. The best candidate reaches 66.3 macro F1 on `needs_response` against a bar of 85.0.

That is the honest result and it should not be softened, but it sits next to a second result that matters more for the decision. The system shipping today scores 4.4 on the same axis at 70.5ms. The best candidate scores 66.3 at 14.1ms with a 22.8MB model. The gap between today and the bar is large; the gap between today and what is already achievable is larger still, and it is available now.

## Results, ranked

Macro F1 percent on the held-out English split. p95 measured inside the worker on Apple Silicon.

| Candidate | needs_response | dialogue_act | task | answer_form | grounding | mode_intent | p95 | latency clean |
|---|---|---|---|---|---|---|---|---|
| **composite (head + prototype)** | **66.3** | **52.7** | 35.4 | 36.9 | 31.9 | **36.0** | **11.74ms** | yes |
| head-minilm (fine-tuned) | 66.3 | 52.7 | 35.4 | 36.9 | 31.9 | 14.4 | 11.31ms | yes |
| headproto-minilm (one session) | 66.3 | 52.7 | 35.4 | 36.9 | 31.9 | 16.4 | 11.30ms | yes |
| head-modernbert (150M) | 60.9 | 45.6 | 30.3 | 35.1 | 32.2 | 14.9 | 83.5ms | yes |
| head-tiny (3-layer) | 59.6 | 39.3 | 29.0 | 32.2 | 30.1 | 20.6 | 5.78ms | yes |
| proto-potion (static) | 50.8 | 33.0 | 27.8 | 27.4 | 25.7 | 36.0 | **0.07ms** | yes |
| proto-minilm | 43.9 | 26.6 | 25.3 | 28.4 | 25.0 | 30.4 | 4.65ms | yes |
| proto-bge-small | 45.6 | 31.6 | 24.5 | 28.3 | 24.8 | 34.4 | 15.9ms | no |
| gliclass-small | 31.0 | 6.7 | 12.4 | 8.3 | 17.8 | 19.4 | 125ms | no |
| gliclass-base | 29.2 | 9.3 | 3.7 | 3.3 | 3.4 | 5.9 | 465ms | no |
| nli-mobilebert (frame) | 23.5 | 20.1 | 6.9 | 8.6 | 13.1 | 12.9 | 508ms | no |
| slm-qwen3-0.6b (GGUF) | 20.9 | 4.1 | untested | untested | untested | untested | 939ms | no |
| head-deberta (did not converge) | 19.8 | 2.2 | untested | untested | untested | untested | 34ms | no |

The `latency clean` column matters. Figures marked no were taken while a model was training on the same machine, which inflates latency by up to 80% with no other symptom. They are kept because every one of them is far enough over budget that the conclusion does not turn on the exact number, and re-running a candidate that is twenty times over budget to learn it is only ten times over would change nothing. The candidates that are actually in contention were all re-measured on a quiet machine.

Legacy eight-label taxonomy, which is the only axis the shipped system attempts:

| Candidate | balanced accuracy | macro F1 | production-weighted | p95 |
|---|---|---|---|---|
| proto-bge-small | 41.6% | 30.6 | 41.8% | 15.9ms |
| proto-potion | 40.2% | 30.4 | 41.0% | 0.1ms |
| proto-minilm | 38.5% | 27.9 | 40.0% | 5.5ms |
| nli-deberta-base | 6.9% | 18.4 | 12.3% | 133ms |
| nli-deberta-xsmall | 14.9% | 14.8 | 15.8% | 68.6ms |
| nli-modernbert-base | 10.1% | 11.5 | 11.6% | 137ms |
| nli-deberta-small | 8.2% | 7.0 | 12.6% | 71.4ms |
| rules only | 2.9% | 6.6 | 4.0% | 0.0ms |
| **nli-mobilebert (shipping today)** | **2.7%** | **4.4** | **7.7%** | **70.5ms** |

## What the numbers say

### The shipped classifier is below random

MobileBERT scores 2.7% balanced accuracy on eight classes. Random is 12.5%.

That is a strong enough claim to deserve verification rather than assertion, so the pipeline was driven directly on clean unambiguous prose. It gets "Can you explain what you mean by that?" right at 0.737, so it is being used correctly. It also calls "Write a function that reverses a linked list" a clarification at 0.310, and "what happened next" an example request. It never predicted `general` on the held-out split, where 193 rows carry it, and it fell below its own 0.35 threshold on roughly half of all rows.

This corroborates an experiment already recorded in `premium/electron/knowledge/IntentClassifier.ts`, where the same model scored a real speech-to-text garble at 0.18 and false-fired on an unrelated technical term at 0.82. That comment concluded a deterministic gate was the better tool. It was right.

The shipped system works better than 2.7% suggests, because the regex tier catches common cases before the model runs. That is the correct reading of the rules control: it fires on 7.7% of rows and is right on 48% of those. The model tier is what handles everything else, and it is close to useless.

### The per-label forward pass is the cost, not the model

Every NLI escalation in the brief's ladder beats MobileBERT and none of them approach a cheap prototype.

DeBERTa-v3-base reaches 18.4 at 133ms. ModernBERT-base reaches 11.5 at 137ms. A static embedding with no transformer in it reaches 30.4 at 0.1ms. Climbing the ladder buys accuracy at a rate that never catches up, because the architecture pays one forward pass per label. Production's configuration is 8 passes. The full frame is 50, which is why that row lands at 508ms.

GLiClass was included specifically because it removes that cost, encoding all labels in one sequence. It does remove it, and it does not help. The labels ride in the same sequence as the text, so each pass is long and costs about 15ms, and seven passes covering every axis reach 125ms. The per-label cost was never the only cost.

### One encoder pass answering every axis is the shape that works

The three leading candidates all answer every axis in a single forward pass. That is the architectural finding, and it is independent of which encoder is chosen.

### Static embeddings are much faster and not much worse

Model2Vec reaches 50.8 at p95 0.1ms. It has no transformer: it is a table lookup per token followed by a mean, so cost scales with sentence length rather than model depth.

It beats both transformer embedding candidates while being 60 to 160 times faster than them, and it is 5,000 times faster than the shipped MobileBERT. Sub-millisecond routing is real. The assumption that a latency budget forces an accuracy compromise does not survive this row.

## The escalation ladder does not survive a p95 bar

This was measured across six operating points and is written up in full in `docs/natively-router-frontier-2026-09-04.md`.

| Escalation rate | needs_response | p50 | p95 |
|---|---|---|---|
| 0% (primary alone) | 50.8 | 0.06ms | 0.08ms |
| 17% | 52.2 | 0.07ms | 24.7ms |
| 44% | 52.8 | 0.17ms | 25.2ms |
| 82% | 59.3 | 24.6ms | 25.6ms |
| 100% | 66.8 | 26.0ms | 28.1ms |

p95 asks what the slowest turn in twenty costs. Any escalation rate above five percent guarantees that the slowest five percent are escalated turns, so p95 becomes the escalation model's latency however rare escalation is. At a 17% escalation rate the median turn still costs 0.07ms and p95 has already reached 24.7ms.

So the ladder offers a choice between escalating rarely and gaining 1.4 points, or escalating often and paying the escalation's p95 anyway. Neither is worth a second model.

The conclusion held even more strongly after quantization. The fine-tuned head now runs at 14.1ms, inside budget on every turn, so there is no longer a latency argument for putting anything in front of it.

## Error analysis

Every failure was categorised by cause using the brief's seven categories. The categoriser saw the turn, the mode, the channel, the history, the correct label and the predicted label, and never saw which model produced the prediction.

### needs_response

| Cause | MobileBERT | Model2Vec | head-minilm |
|---|---|---|---|
| bad_model | 96.1% | 92.9% | 88.1% |
| overlapping_labels | 2.3% | 5.3% | 10.1% |
| context_missing | 0% | 1.2% | 0% |
| bad_label | 0% | 0% | 0.9% |
| should_never_be_classified | 1.6% | 0.6% | 0.9% |
| failures | 257 of 377 | 170 of 377 | 109 of 377 |

The reading is unambiguous and it is good news. On `needs_response` the corpus is answerable and the taxonomy is sound. Between 88 and 96 percent of every candidate's failures are cases where the correct answer was recoverable and the model missed it. Under two percent of failures are attributable to bad labels or rows that should never have been classified, which is also a validation of the dataset.

This says the remedy for `needs_response` is more capable modelling and more data, not a taxonomy change.

### dialogue_act

| Cause | head-minilm |
|---|---|
| bad_model | 58.4% |
| overlapping_labels | **39.4%** |
| bad_label | 1.5% |
| should_never_be_classified | 0.7% |
| failures | 137 of 377 |

This axis behaves completely differently and it is the most actionable finding in the campaign.

Nearly two in five `dialogue_act` failures are cases where both labels are defensible. The taxonomy does not separate them, so no model can be reliably right and additional training will not fix it.

The specific collisions, counted:

| Pair | Count |
|---|---|
| question vs request | 27 |
| answer vs statement | 12 |
| answer vs backchannel | 5 |
| question vs statement | 5 |
| everything else | 5 |

Half of all overlaps are one pair. "whats the status on the q three report" is a question in grammatical form and a request in conversational function, and the six-value enum forces a choice between them that carries no information. `answer` against `statement` is the same problem in a different place: an answer is a statement, and the distinction is about what preceded it rather than about the turn itself.

On `needs_response` the overlap is smaller but has the same shape. Nine of eleven overlaps are `optional` against `yes`, which says the middle category is not cleanly separable from the positive one.

## A bigger encoder does not help

ModernBERT-base is roughly four times MiniLM-L6 in parameters and produces a 151.7MB quantized model against 22.8MB. It scores worse on both axes that matter.

| Encoder | params | size | needs_response | dialogue_act |
|---|---|---|---|---|
| MiniLM-L6 | 22M | 22.8MB | **66.3** | **52.7** |
| ModernBERT-base | 150M | 151.7MB | 60.9 | 45.6 |
| MiniLM-L3 (distilled) | 17M | 17.4MB | 59.6 | 39.3 |

It is also seven times slower, at p95 83.5ms on a quiet machine against MiniLM's 11.3ms, which puts it over the 25ms budget on its own before anything else runs.

It trained cleanly. The loss reached 3.53 against MiniLM's 7.07, and the collapse detector reported every axis predicting multiple classes, including 46 of 79 on `mode_intent` where MiniLM manages fewer. So the larger model fits the training split better and generalises worse, which is what overfitting looks like on 1,589 rows.

That is consistent with everything else here. The corpus is the binding constraint, not model capacity, and adding capacity against a small corpus makes the fit tighter rather than the answer better. It is one more argument for the 5,000 rows this report recommends, and against reaching for a bigger encoder first.

Two practical notes. ModernBERT could not be trained at batch 32 and sequence length 192 on this machine: 150M parameters plus optimizer state plus activations thrashed unified memory, and the symptom was under two percent CPU with no progress rather than an error. Batch 8 at length 128 worked immediately. And its graph contains a `Split` carrying `num_outputs`, which exists only from opset 18, so exporting at 17 produced a file onnxruntime rejects at load with a message that reads like a corrupt export.

## The local SLM does not do this task zero-shot

Qwen3-0.6B, GGUF, grammar-constrained JSON so an out-of-vocabulary label is impossible rather than merely unlikely. Measured at p95 939ms, which is six times the escalation budget the brief allows and sixty-six times the leading encoder.

The accuracy result is more interesting than the latency one, and it took two runs to see. The first prompt produced `no` for all 377 rows. That looked like a hopeless model, but the same run showed real variety on `dialogue_act`, which proved the model was working and the prompt was not: it described when to answer `no` and never described when to answer `yes`.

The corrected prompt described both directions. It then produced `yes` for 376 of 377 rows.

Two prompts, two collapses in opposite directions, each following whichever class the prompt emphasised. That is not a tuning problem to be solved with a third prompt. It says the model is not performing the discrimination at all on this axis, and is instead reproducing the prompt's emphasis. A 0.6B is being asked to hold a three-way judgement about conversational pragmatics over noisy speech-to-text, and it is answering a different, easier question.

The number reported here is therefore a lower bound in a specific sense: more prompt work would move it, and there is no evidence that any amount of prompt work would make it discriminate rather than follow. The honest conclusion is that the zero-shot local SLM is ruled out on latency regardless, and that its accuracy failure is a capability limit rather than a prompting one.

The brief's answer to that would be the LoRA fine-tune, listed as the accuracy ceiling for escalation. That row was not built, because the escalation role it would fill has itself been ruled out on p95 grounds.

## The two families fail in opposite places, and a second model is not free

This was the last thing measured and it changes what a shipped router should look like.

### The split is cardinality, not quality

| Axis | Classes | Fine-tuned head | Static prototype |
|---|---|---|---|
| needs_response | 3 | **66.3** | 50.8 |
| dialogue_act | 6 | **52.7** | 33.0 |
| mode_intent | 79 | 14.4 | **36.0** |

The prototype beats the head on `mode_intent` in eleven of twelve modes, several by more than twenty points. Seminar goes from 6.7 to 49.2, sales from 23.1 to 52.2, technical interview from 16.3 to 44.1.

The cause is how many examples each class gets. With 1,589 training rows, three classes means hundreds of examples each and a fine-tuned softmax head learns them comfortably. Seventy-nine classes partitioned by mode means about twenty each, and at twenty examples a centroid is still a usable point while a decision boundary is not. That is a property of the data regime rather than of either model, and it is why the two disagree so sharply on one axis and agree on the rest.

### Combining them works, and it is affordable

A composite that lets each family own the axes it wins takes `mode_intent` from 14.4 to 36.0 with every other axis unchanged. It is strictly more accurate than either component, and on a quiet machine it costs p95 11.74ms against the head's 11.31ms.

That is the whole cost of the second model: **0.43ms**, comfortably inside a 25ms budget.

### A retraction: there is no second-session tax

An earlier version of this document reported that a second resident ONNX session taxed the first by roughly two thirds, on the strength of the head measuring 15.31ms alone and 33.93ms with a second session merely open. It reported that sequential execution did not help, and that disabling ONNX Runtime's thread spinning or dropping to one intra-op thread made things worse still.

All of those measurements were taken while a model was training on the same machine. Re-run on a quiet one, with a load average of 1.56 across ten cores:

| Configuration | p50 | p95 |
|---|---|---|
| no second session | 10.87ms | 11.11ms |
| second session open | 10.99ms | 11.29ms |
| no second session, repeated | 11.07ms | 11.43ms |

The spread is about one percent, which is noise. There is no tax. The finding was an artefact of measuring under load, and it is recorded here rather than quietly deleted because it changed a conclusion: on the bad numbers the composite looked undeployable at 39ms, and on the correct ones it is the leading candidate.

The same contamination inflated several other figures. `head-tiny` was reported at p95 15.9ms, which made a three-layer model look slower than the six-layer one it is distilled from, an anomaly flagged at the time as unexplained. Its clean figure is 5.78ms, and the anomaly disappears.

### The single-session variant is still worse, and that part stands

Exporting the encoder's pooled vector so the centroid lookup can run in the same forward pass reaches `mode_intent` 16.4 against the two-model composite's 36.0. That comparison is between two accuracy numbers and was never affected by the latency contamination.

So fine-tuning the encoder for the low-cardinality axes does specialise its representation in a way that costs the seventy-nine-way distinction. The conclusion survives; only the motivation for trying it has gone, since the second session turns out to be nearly free.

## A leak in the held-out split, measured rather than assumed

33 of 419 held-out rows, 7.9%, have an exact input duplicate in the training split, and 31 of them carry the same `needs_response` label.

The cause is the interaction of two decisions that are each correct on their own. Deduplication is keyed on mode and input together, deliberately, because the same backchannel in Team Meet and in Lecture is genuine signal for a mode-aware router. The split is a hash of the row id, also deliberately, so that regenerating the corpus cannot migrate rows across the boundary. But two rows with the same text have different ids, so the hash can put one in train and the other in holdout, and the held-out copy is then memorisable.

The effect was measured on three candidates rather than estimated.

| Candidate | full holdout | excluding leaked rows | on the leaked rows |
|---|---|---|---|
| head-minilm | 66.3 | 65.4 | 83.3% accuracy |
| proto-potion | 50.8 | 50.6 | 63.3% accuracy |
| nli-mobilebert | 23.5 | 24.2 | 10.0% accuracy |

So the leading candidate is inflated by 0.9 points, the prototype by 0.2, and the MobileBERT baseline is actually deflated: it does far worse on the leaked rows than on the rest, because they are mostly short backchannels it mishandles.

The ranking is unaffected and every reported figure moves by under a point. That is small enough that re-splitting and re-running every candidate would cost hours to change a conclusion by less than the difference between adjacent candidates. It is not small enough to leave unsaid, because 0.9 points of a score coming from memorisation is 0.9 points that will not appear in production.

`assignGroupedSplits` fixes it by giving every row that shares a normalised input the split of its lexicographically first id, which is deterministic and still survives regeneration. It is deliberately NOT retrofitted to v1, since doing so would invalidate every measurement in this report. It should be applied when the corpus is regenerated at 5,000 rows, which is the recommendation this report already makes for other reasons.

`validate.mjs` now reports the leak rate on every run, so a future corpus cannot acquire this silently.

## Hardware matrix

| Machine | Status |
|---|---|
| Apple Silicon, CPU | measured, all figures above |
| Apple Silicon, CoreML | untested, no CoreML execution provider wired |
| Intel Mac | untested, machine not available |
| Mid-range Windows laptop | untested, machine not available |

The acceptance bar specifies the Intel Mac, which is slower than the machine every number here came from. The leading candidate has roughly a 1.8x margin at 14.1ms against a 25ms bar, so it plausibly holds, but that is an inference and not a measurement and is marked untested rather than estimated.

## The smallest change that could clear the bar

The brief asks for this rather than for the bar to be lowered.

**More data is the first lever, and the error analysis says it is the right one.** Between 88 and 96 percent of `needs_response` failures are model failures on answerable rows. The corpus is 1,589 English training rows. The brief's own plan is 5,000 for the final decision and 20,000 for distillation. Going from 1,589 to 5,000 is the single change most likely to move 66.3 upward, and nothing measured here suggests a ceiling has been reached.

**The dialogue_act taxonomy needs a change, not more data.** Merging `question` and `request`, or defining the boundary between them explicitly as form against function, addresses 27 of 54 overlapping failures directly. The same applies to `answer` against `statement`. This is a Phase 6 decision about the IntentFrame and it should be made before more labelling, or the new rows will encode the same ambiguity.

**`needs_response` should probably be binary.** Nine of eleven overlaps are `optional` against `yes`. If `optional` cannot be separated from `yes` by a human labeller or a model, it is not carrying information and it is costing accuracy on the axis the campaign turns on.

**A larger encoder is untried at a converged setting.** The DeBERTa multi-head did not converge and predicted a single class for every row, which is a training failure at the hyperparameters tried rather than a verdict on the encoder. ModernBERT-base is still training. Either could beat MiniLM.

## Scope correction: V3 already owns most of these axes

Discovered after this report was written, and it narrows what the router should be. Full account in `docs/natively-routing-correction-v3-2026-09-05.md`.

Context Intelligence V3 is the main answer system, default on since 2026-07-30. The Phase 1 audit missed it because its flag deliberately lives outside `intelligenceFlags.ts`, and reported Prompt System v2 as the live path when V2 is in fact V3's fallback.

V3 is a routing system, not just a composer. `turn-classifier.ts` decides "WHAT a turn is asking and WHETHER retrieval should run at all", carrying `QuestionType` with 17 values, `SourceType` with 10, plus `GroundingPolicy`, `RetrievalPath` and `Answerability`. That covers `grounding`, `capabilities.retrieval` and much of `task` already, deterministically, in production.

What V3 does not have is any notion of whether to speak at all. It returns null when no question resolves, and its own comment names that case: "the genuinely proactive case ... proactivity is the product feature". Those handed-back turns are the ambient live audio, and they are precisely where the 6.1% silence waste sits, because a turn that resolves to a confident question does not end in "Nothing actionable right now".

So the router's job is narrower and better supported than the brief assumed. It should own the axis V3 deliberately left open, `needs_response`, on the proactive turns V3 declines. It should not re-decide axes that already have a deterministic owner.

This also gives the benchmark a sharper purpose. V3's architecture forbids replacing a deterministic decision with a learned one without evidence of improvement. This report is that evidence, for one axis: the deterministic incumbent on `needs_response` is a regex tier that fires on 7.7% of turns, and the best learned candidate reaches 66.3 macro F1 where zero-shot NLI reaches 23.5.

None of the measurements change. No candidate's score depended on which prompt composer runs.

## Decision

Do not ship a router on these numbers. Nothing clears the acceptance bar: the best `needs_response` figure is 66.3 against 85.0, and `dialogue_act` is 52.7 against 80.0.

The architecture question is settled, and the answer is the composite. One shared encoder with a small head per axis, plus a nearest-centroid lookup over a static embedding for `mode_intent`, gives the best figure on every axis simultaneously at p95 11.74ms, which is less than half the budget. The second model costs 0.43ms.

The NLI family is ruled out on both accuracy and latency. The escalation ladder is ruled out on p95 grounds, and note that this conclusion survives the measurement correction: the ladder's problem was never a per-session cost, it was that any escalation rate above five percent makes p95 the escalation model's latency.

The recommended next step is unchanged, and the error analysis is what points at it. Expand the corpus to 5,000 rows, because 88 to 96 percent of `needs_response` failures are cases where the answer was recoverable and the model missed it, which is what more data fixes. Fix the `dialogue_act` and `needs_response` taxonomies first, because 39.4 percent of `dialogue_act` failures are label overlaps that more data will only reproduce. Apply the grouped split when regenerating. Then re-run this benchmark unchanged, which is cheap because the harness, the replay gate and the error analysis all exist.

## What was not run, and why

`head-modernbert` is training and its numbers are not in this report.

`head-deberta` is reported at 19.8 but did not converge: it predicts a single class for all 377 rows, which is uniform logits taking the first index. It is recorded as a training failure at the settings tried, not as an encoder verdict.

The LoRA fine-tune of Qwen3-0.6B, the distilled student of the best head, the Natively-distilled Model2Vec, and the 20k teacher labelling set are not built. The hybrid result removes the reason for the LoRA escalation row, and the rest depend on decisions this report recommends making first.

Signal Q, the prosody extractor, is not built. It needs audio aligned to transcript lines, and the corpus is synthetic text with no audio. The error analysis found `deterministic_signal_missing` on zero failures, so on this corpus it would have nothing to measure. That absence is a property of the corpus rather than evidence that prosody would not help on real audio.

The Hinglish and Manglish slices are generated but not verified by a speaker of either language, and are reported separately in the review file rather than scored here.
