# Decider training record schema (Phase 1, step 1)

One JSONL record per **candidate**: a piece of OTHERS speech exactly as the real
`SimpleAutoAnswerEngine` would send it to a judge (see `segment_via_replay.mjs`). Clean,
hand-written sentences are not training data.

```json
{
  "id": "syn-ti-0042-c07",
  "source": "synthetic:deepseek-v4-pro:2026-11-xx | public:ami | gold:judge-eval",
  "transcript_id": "syn-ti-0042",
  "mode": "technical-interview",
  "user_name": "Jordan Lee",
  "context": [{"speaker": "OTHERS/speaker_1", "text": "…"}, {"speaker": "USER", "text": "…"}],
  "last_answered": "… or null",
  "candidate": "…",
  "transcript_lagging": false,
  "label": "answer",
  "soft": {"answer": 0.83, "silent": 0.17, "wait": 0.0},
  "hard_case_tags": ["merged_reply", "short_yes_no"],
  "split": "train"
}
```

| field | meaning |
|---|---|
| `id` | unique; `transcript_id` groups the candidates of one conversation. **Splits are by transcript, never by candidate**, so no conversation leaks across splits. |
| `source` | `synthetic:<model>:<date>`, `public:<corpus>` (license recorded in DATACARD.md), or `gold:<set>`. Gold is test only. |
| `mode` | mode TEMPLATE id: `general`, `technical-interview`, `looking-for-work`, `sales`, `recruiting`, `team-meet`, `lecture`, `seminar`, `call-center`. |
| `user_name` | full name as the app would know it (résumé or calendar), or null. Only the first name reaches the model, and only through `addressed_to`. |
| `context` | the hot-window turns BEFORE the candidate, oldest first, as the engine held them. `speaker` is `USER`, `OTHERS` or `OTHERS/speaker_N`. |
| `last_answered` | the engine's `lastAnsweredText` at that moment. In synthetic data it is set by the replay's recording host, assuming every earlier `answer` label was answered. |
| `candidate` | the exact candidate text: merged finals, a stall-promoted interim, mid-word cuts. |
| `transcript_lagging` | true when the candidate is a stall-promoted interim (SimpleAutoAnswer `STALL_PROMOTE_MS`). |
| `label` | `answer` / `silent` / `wait`: argmax of `soft`, or the human adjudication. |
| `soft` | the teacher vote share (6 votes; lean ensemble: 2, or 6 on disagreement). Human-adjudicated records get a one-hot `soft`. |
| `hard_case_tags` | taxonomy tags (`taxonomy.md`) that the generator was STEERED to produce. A tag is a request to the generator, not a label. |
| `split` | `train` / `dev` / `calib` (80/10/10 by transcript), or `gold`. |

## How a record becomes model input

The TypeScript builder (`electron/intelligence/autoAnswer/decider/deciderState.ts`) turns
`context`, `candidate`, `last_answered`, `user_name`, `mode` and `transcript_lagging` into the
§4 state fields: last 6 turns, the judge's tails, and `addressed_to` from the judge's name
helpers. `decider/state.py` fits and serializes them. Training rows are then:

```json
{"state": "<serialized fitted state>", "questions": {"respond": {…§4…}}, "gold": {"respond": [p_answer, p_silent, p_wait]}}
```

(`gold` format to be confirmed against `laya/train.py` `target_from_gold` before Phase 2.)

## Teacher-label mapping (judge prompt)

- `complete: false` or act `incomplete` → **wait**;
- route `evaluate` with action `answer` → **answer**;
- everything else → **silent**.

The rubric prompt answers the three labels directly.

## Never in training

- any judge-eval case, a paraphrase of one, or a near-duplicate: the leakage check fails the
  build at normalized containment ≥ 0.8 or e5 cosine ≥ 0.92;
- any real user transcript.
