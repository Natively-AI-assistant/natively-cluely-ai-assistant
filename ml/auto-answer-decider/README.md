# Auto Answer decider: ML workspace

Training, export and benchmarking for the Auto Answer decision model (a fine-tuned
[Laya](https://pypi.org/project/laya/) checkpoint). Governing plan:
`docs/autopilot/CLAUDE_CODE_PROMPT_auto_answer_decider.md`. Progress and measured numbers:
`docs/autopilot/auto-answer-decider-progress.md`.

**Nothing here ships in the app.** `package.json` `build.files` is an allowlist that leaves `ml/`
out, plus an explicit `!ml/**` (pinned by `scripts/__tests__/ml-workspace-not-packaged.test.mjs`).

## Setup (macOS; keep caches off a full system disk)

    python3.12 -m venv ml/auto-answer-decider/.venv
    ml/auto-answer-decider/.venv/bin/pip install -r ml/auto-answer-decider/requirements.txt
    export HF_HOME=/path/with/space/hf   # the English checkpoint is ~0.8 GB, fp32 ONNX ~1.6 GB

## Layout

| path | what |
|---|---|
| `decider/state.py` | Python twin of `electron/intelligence/autoAnswer/decider/deciderState.ts`: the `respond` question, state serialization and token-budget fitting. Model input: change it and you retrain. |
| `bench/emit_eval_states.mjs` | §4 state fields for the 187 judge-eval candidates, built by the app's TypeScript builder (needs `npm run build:electron`). TEST ONLY data. |
| `bench/laya_m4_bench.py` | Phase 0 latency + zero-shot bench: torch cpu/mps, ONNX int8/fp32 CPU, CoreML EP. Appends to `results/ledger.jsonl`. |
| `bench/windows_bench.md` | How to run the same bench on a Windows laptop. |
| `export/export_onnx.py` | DecisionModel to ONNX in laya's `ONNXAgent` input contract, plus int8 dynamic quantization. |
| `results/ledger.jsonl` | One line per experiment: id, commit, data hash, config, metrics, latency, hardware, command. Committed. |
| `results/runs/`, `artifacts/`, `.venv/` | Per-run detail, model files, venv. Gitignored. |

## Rules (see the campaign prompt §2)

- The judge-eval sets and the gold test are **test only**: never training, threshold or temperature data.
- No real user transcript is ever used here.
- Every number written anywhere comes from a run recorded in the ledger.
