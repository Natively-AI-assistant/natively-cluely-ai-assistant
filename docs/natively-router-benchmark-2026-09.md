# Natively interaction router: benchmark results and decision

Phase 5 of the interaction-router campaign. All figures are measured on the held-out split, which no candidate trained on and no prototype was built from. Reproduce any row with `node scripts/intent-benchmark/run.mjs --provider <id> --split holdout --language en`.

Corpus is `scripts/intent-benchmark/dataset/v1.jsonl`, 2,008 rows, 419 held out, 1,813 English and 195 code-switched. Held-out English rows used for scoring: 377.

## The headline

Nothing clears the acceptance bar. The best candidate reaches 66.3 macro F1 on `needs_response` against a bar of 85.0.

That is the honest result and it should not be softened, but it sits next to a second result that matters more for the decision. The system shipping today scores 4.4 on the same axis at 70.5ms. The best candidate scores 66.3 at 14.1ms with a 22.8MB model. The gap between today and the bar is large; the gap between today and what is already achievable is larger still, and it is available now.

## Results, ranked

Macro F1 percent on the held-out English split. p95 measured inside the worker on Apple Silicon.

| Candidate | needs_response | dialogue_act | task | answer_form | grounding | p95 | passes/row |
|---|---|---|---|---|---|---|---|
| head-minilm (fine-tuned) | **66.3** | 52.7 | 35.4 | 36.9 | 31.9 | 14.1ms | 1 |
| head-tiny (3-layer) | 59.6 | 39.3 | 29.0 | 32.2 | 30.1 | 15.9ms | 1 |
| proto-potion (static) | 50.8 | 33.0 | 27.8 | 27.4 | 25.7 | **0.1ms** | 1 |
| proto-bge-small | 45.6 | 31.6 | 24.5 | 28.3 | 24.8 | 15.9ms | 1 |
| proto-minilm | 43.9 | 26.6 | 25.3 | 28.4 | 25.0 | 5.5ms | 1 |
| proto-minilm-topk | 38.2 | 18.3 | 13.2 | 12.8 | 17.7 | 6.3ms | 1 |
| gliclass-small | 31.0 | 6.7 | 12.4 | 8.3 | 17.8 | 125ms | 7 |
| gliclass-base | 29.2 | 9.3 | 3.7 | 3.3 | 3.4 | 465ms | 7 |
| nli-mobilebert (frame) | 23.5 | 20.1 | 6.9 | 8.6 | 13.1 | 508ms | 50 |
| head-deberta | 19.8 | 2.2 | untested | untested | untested | 34ms | 1 |

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

## Acceptance bar

| Requirement | Best achieved | Verdict |
|---|---|---|
| needs_response macro F1 >= 0.85 | 0.663 (head-minilm) | FAIL |
| dialogue_act macro F1 >= 0.80 | 0.527 (head-minilm) | FAIL |
| mode_intent macro F1 >= 0.70 per mode | 0.36 best, underpowered | NOT MEASURABLE |
| p95 <= 25ms on the Intel Mac | 14.1ms on Apple Silicon | UNTESTED on the specified machine |
| ECE <= 0.08 | 0.013 (Model2Vec), 0.089 (head-minilm) | PASS for Model2Vec |
| zero crashes over 1,000 warm calls | not run | UNTESTED |

`mode_intent` cannot be scored at this corpus size and reporting a number for it would be misleading. There are 78 labels partitioned by mode across 377 held-out rows, leaving fewer than ten rows per label in every mode. Every mode reports as underpowered.

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

## Decision

Do not ship a router on these numbers. Nothing clears the bar.

Do treat the architecture as settled. One shared encoder with one small head per axis, answering every axis in a single forward pass, is faster and more accurate than every alternative measured, by margins that are not close. The escalation ladder is ruled out on p95 grounds. The NLI family is ruled out on both accuracy and latency.

The recommended next step is to expand the corpus to 5,000 rows and fix the `dialogue_act` and `needs_response` taxonomies first, then re-run this benchmark unchanged. The harness, the replay gate and the error analysis all exist and are reproducible, so the second run costs a fraction of the first.

## What was not run, and why

`head-modernbert` is training and its numbers are not in this report.

`head-deberta` is reported at 19.8 but did not converge: it predicts a single class for all 377 rows, which is uniform logits taking the first index. It is recorded as a training failure at the settings tried, not as an encoder verdict.

The LoRA fine-tune of Qwen3-0.6B, the distilled student of the best head, the Natively-distilled Model2Vec, and the 20k teacher labelling set are not built. The hybrid result removes the reason for the LoRA escalation row, and the rest depend on decisions this report recommends making first.

Signal Q, the prosody extractor, is not built. It needs audio aligned to transcript lines, and the corpus is synthetic text with no audio. The error analysis found `deterministic_signal_missing` on zero failures, so on this corpus it would have nothing to measure. That absence is a property of the corpus rather than evidence that prosody would not help on real audio.

The Hinglish and Manglish slices are generated but not verified by a speaker of either language, and are reported separately in the review file rather than scored here.
