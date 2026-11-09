"""Export a Laya checkpoint's DecisionModel to ONNX (fp32), plus an int8 dynamic-quantized copy.

Mirrors laya's ONNXAgent input contract (laya/onnx_agent.py `_collate_items_numpy`):
inputs  input_ids int64 [n, L], attention_mask int64 [n, L], marker_pos int64 [n, K],
        marker_mask bool [n, K], qtype int64 [n]; K >= 2 (the traced head takes topk(2)).
outputs logits [n, K], act_logits [n, 2].

    python export/export_onnx.py --model convaiinnovations/laya --out <dir> [--int8]

Phase 0 uses it for latency only; Phase 3 adds fp16/CoreML variants and parity fixtures.
"""
import argparse
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))


def sample_batch(agent, k_cols=2):
    import numpy as np
    from laya.onnx_agent import _collate_items_numpy
    from decider.state import QUESTIONS
    ids = list(QUESTIONS)
    internal = {qid: agent._to_internal(QUESTIONS[qid]) for qid in ids}
    state = '{"mode": "general", "addressed_to": "none", "transcript_lagging": false, "context": [], "last_answered": null, "candidate": "can you walk me through how you would design this"}'
    items = agent._encode_state(state, ids, internal)
    batch = _collate_items_numpy([items], agent.tok.pad_token_id)
    return {k: np.asarray(v) for k, v in batch.items()}


class _restore_fastpath:
    def __init__(self, torch, value):
        self.torch, self.value = torch, value

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.torch.backends.mha.set_fastpath_enabled(self.value)
        return False


def export(model_id, out_dir, opset=17, int8=True, agent=None):
    """Export `agent` (a CPU laya Agent; loaded from `model_id` when None)."""
    import torch
    import laya
    os.makedirs(out_dir, exist_ok=True)
    if agent is None:
        agent = laya.load(model_id, device="cpu")
    if getattr(agent, "parallel_options", False):
        raise SystemExit("checkpoint uses the parallel option layout; this exporter does not pass position_ids/option_ids")
    model = agent.model.eval().float()
    b = sample_batch(agent)
    args = tuple(torch.from_numpy(b[k]) for k in ("input_ids", "attention_mask", "marker_pos", "marker_mask", "qtype"))
    fp32 = os.path.join(out_dir, "laya.onnx")
    t0 = time.perf_counter()
    # Eval-mode nn.TransformerEncoderLayer (laya's head) takes torch's fused
    # `_transformer_encoder_layer_fwd` fast path, which has no ONNX symbolic:
    # "Exporting the operator 'aten::_transformer_encoder_layer_fwd' to ONNX opset
    # version 17 is not supported" (measured 2026-11-09). Trace the plain path.
    fastpath = torch.backends.mha.get_fastpath_enabled()
    torch.backends.mha.set_fastpath_enabled(False)
    with torch.no_grad(), _restore_fastpath(torch, fastpath):
        torch.onnx.export(
            model, args, fp32,
            input_names=["input_ids", "attention_mask", "marker_pos", "marker_mask", "qtype"],
            output_names=["logits", "act_logits"],
            dynamic_axes={
                "input_ids": {0: "n", 1: "L"}, "attention_mask": {0: "n", 1: "L"},
                "marker_pos": {0: "n", 1: "K"}, "marker_mask": {0: "n", 1: "K"},
                "qtype": {0: "n"}, "logits": {0: "n", 1: "K"}, "act_logits": {0: "n"},
            },
            opset_version=opset, do_constant_folding=True, dynamo=False,
        )
    print(f"exported {fp32} in {time.perf_counter() - t0:.1f}s")
    out = {"fp32": fp32}
    if int8:
        from onnxruntime.quantization import QuantType, quantize_dynamic
        q8 = os.path.join(out_dir, "laya.int8.onnx")
        t0 = time.perf_counter()
        quantize_dynamic(fp32, q8, weight_type=QuantType.QInt8)
        print(f"quantized {q8} in {time.perf_counter() - t0:.1f}s")
        out["int8"] = q8
    return agent, out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="convaiinnovations/laya")
    ap.add_argument("--out", required=True)
    ap.add_argument("--opset", type=int, default=17)
    ap.add_argument("--no-int8", action="store_true")
    a = ap.parse_args()
    export(a.model, a.out, a.opset, not a.no_int8)
