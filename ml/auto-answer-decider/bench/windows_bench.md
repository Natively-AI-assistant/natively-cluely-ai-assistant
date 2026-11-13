# Run the Laya bench on a Windows laptop

Gate G0 was measured only on the MacBook Air M4. Windows CPU latency decides whether
local Auto Answer can run Laya-large or needs a distilled student, so this needs a run on
a **low-end Windows laptop** (the slowest machine we still support). Same script, same data.

## 1. One-time setup (PowerShell, from the repo root)

    git switch feat/auto-answer-decider
    npm ci
    npm run build:electron
    py -3.12 -m venv ml\auto-answer-decider\.venv
    ml\auto-answer-decider\.venv\Scripts\pip install -r ml\auto-answer-decider\requirements.txt
    # Optional, to time the GPU path: DirectML build of onnxruntime (replaces the CPU wheel)
    ml\auto-answer-decider\.venv\Scripts\pip uninstall -y onnxruntime
    ml\auto-answer-decider\.venv\Scripts\pip install onnxruntime-directml==1.31.1

The first run downloads the English checkpoint (about 0.8 GB) to the Hugging Face cache and
writes the ONNX exports (about 1.6 GB fp32 + 0.4 GB int8) under
`ml\auto-answer-decider\artifacts\`. Put the cache on a disk with room:

    $env:HF_HOME = "D:\hf-cache"

## 2. Run

Close other heavy apps, plug in the charger, and set Windows power mode to "Best performance".

    ml\auto-answer-decider\.venv\Scripts\python ml\auto-answer-decider\bench\laya_m4_bench.py --devices cpu

It prints, and appends to `ml\auto-answer-decider\results\ledger.jsonl`:

- `torch cpu`: fp32 PyTorch latency p50/p90/max over the 187 judge-eval candidates;
- `onnx int8`: the number that matters for Windows. **Gate: p90 <= 250 ms.**
- `onnx fp32`: reference;
- `fp32-directml`: only if `onnxruntime-directml` is installed.

Also run it capped to the physical core count, since oversubscribing logical cores slows CPU inference:

    ml\auto-answer-decider\.venv\Scripts\python ml\auto-answer-decider\bench\laya_m4_bench.py --devices cpu --threads <physical cores>

## 3. Send back

- the new lines of `results\ledger.jsonl`;
- the laptop model, CPU, RAM, and whether it was on battery.

Do not send `results\runs\*.json`. It holds per-candidate predictions on the TEST set, which is
harmless but not needed.

## Notes

- The zero-shot accuracy it prints is a baseline only. It decides nothing.
- `onnxruntime-node` in the app is a separate build from this Python wheel. If DirectML wins
  here, Phase 4 still has to confirm that onnxruntime-node 1.22 on Windows ships the DirectML EP.
