"""Try CoreML EP configurations on the exported fp32 graph; report partitioning + latency.

    .venv/bin/python bench/coreml_probe.py [--limit 40]

Phase 0 asks for CoreML timing "if the Python onnxruntime build exposes it". It does, and
the default MLProgram build failed (error -7), so this tries the documented alternatives.
"""
import argparse, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.dirname(HERE))
import laya_m4_bench as B

CONFIGS = [
    ("mlprogram-all", {"ModelFormat": "MLProgram", "MLComputeUnits": "ALL"}),
    ("mlprogram-cpu-gpu", {"ModelFormat": "MLProgram", "MLComputeUnits": "CPUAndGPU"}),
    ("neuralnetwork-all", {"ModelFormat": "NeuralNetwork", "MLComputeUnits": "ALL"}),
    ("neuralnetwork-static", {"ModelFormat": "NeuralNetwork", "MLComputeUnits": "ALL", "RequireStaticInputShapes": "1"}),
]

ap = argparse.ArgumentParser(); ap.add_argument("--limit", type=int, default=40); ap.add_argument("--threads", type=int, default=4)
a = ap.parse_args()
import laya
rows, _ = B.load_states(None)
agent = laya.load("convaiinnovations/laya", device="cpu")
rows, _ = B.prepare(agent, rows)
rows = rows[:a.limit]
fp32 = os.path.join(B.ML_ROOT, "artifacts", "zero-shot-onnx", "laya.onnx")
out = {}
for name, opts in CONFIGS:
    try:
        r = B.run_onnx(agent, fp32, [("CoreMLExecutionProvider", opts), "CPUExecutionProvider"], name, rows, 3, a.threads, None)
        out[name] = {k: r[k] for k in ("providers", "session_load_s", "latency_ms", "partition_log")}
    except Exception as e:
        out[name] = {"error": repr(e)[:300]}
        print(f"\n== {name} failed: {repr(e)[:200]}")
print(json.dumps(out, indent=1))
