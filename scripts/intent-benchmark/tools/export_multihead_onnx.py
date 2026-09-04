#!/usr/bin/env python3
"""
Export the trained multi-head router to ONNX so it runs from Node.

Production runs ONNX or GGUF from Node only; Python stays out of the runtime
path. That is the campaign brief's rule and it is also the only way the latency
measurement means anything, because a PyTorch number on this machine would not
be what ships.

The exported graph has ONE input pair and SIX outputs, one logit tensor per
axis. That shape is the candidate's whole argument: the NLI baseline needs one
forward pass per LABEL (8 in production's config, 44 for the full frame), while
this needs one pass for everything.
"""
import argparse, json
from pathlib import Path

import torch
import torch.nn as nn
from transformers import AutoTokenizer, AutoModel

AXES = ["needs_response", "dialogue_act", "task", "answer_form", "grounding", "mode_intent"]


class MultiHead(nn.Module):
    def __init__(self, encoder_name, sizes):
        super().__init__()
        self.encoder = AutoModel.from_pretrained(encoder_name)
        h = self.encoder.config.hidden_size
        self.heads = nn.ModuleDict({a: nn.Linear(h, n) for a, n in sizes.items()})

    def forward(self, input_ids, attention_mask):
        out = self.encoder(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state
        mask = attention_mask.unsqueeze(-1).float()
        pooled = (out * mask).sum(1) / mask.sum(1).clamp(min=1e-9)
        # Tuple, not dict: torch.onnx names outputs positionally, and a dict
        # return makes the output order implicit. The order here is AXES, and
        # the Node side reads it by that same list.
        return tuple(self.heads[a](pooled) for a in AXES)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trained", required=True, help="directory from train_multihead.py")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    trained = Path(args.trained)
    cfg = json.load(open(trained / "heads.json"))
    out = Path(args.out)
    (out / "onnx").mkdir(parents=True, exist_ok=True)

    model = MultiHead(cfg["encoder"], cfg["sizes"])
    state = torch.load(trained / "model.pt", map_location="cpu")
    # The training module carried a dropout layer that inference does not need,
    # so load non-strictly and report anything unexpected rather than silently
    # accepting a partial load.
    missing, unexpected = model.load_state_dict(state, strict=False)
    real_missing = [k for k in missing if not k.startswith("drop")]
    if real_missing:
        raise SystemExit(f"[export] refusing: weights missing from the checkpoint: {real_missing[:5]}")
    model.eval()

    tok = AutoTokenizer.from_pretrained(trained)
    sample = tok("so uh whats the status on that", return_tensors="pt", padding="max_length",
                 truncation=True, max_length=192)

    torch.onnx.export(
        model,
        (sample["input_ids"], sample["attention_mask"]),
        str(out / "onnx" / "model.onnx"),
        input_names=["input_ids", "attention_mask"],
        output_names=[f"logits_{a}" for a in AXES],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "sequence"},
            "attention_mask": {0: "batch", 1: "sequence"},
            **{f"logits_{a}": {0: "batch"} for a in AXES},
        },
        opset_version=17,
        do_constant_folding=True,
    )

    src = out / "onnx" / "model.onnx"
    data = out / "onnx" / "model.onnx.data"
    q8 = out / "onnx" / "model_quantized.onnx"

    # Quantize if we can, and RECORD WHICH DTYPE ACTUALLY SHIPPED.
    #
    # The first version of this script copied the fp32 graph to the q8 filename
    # when quantization failed, then deleted the fp32 graph and its sidecar as
    # "cleanup". torch writes weights to model.onnx.data, so that left a 0.9MB
    # file that is a graph with no weights: it exists, it has the right name,
    # and it cannot load. That is the same class of failure as the truncated
    # download — a plausible-looking artifact that fails obscurely much later.
    dtype = None
    try:
        from onnxruntime.quantization import quantize_dynamic, QuantType
        quantize_dynamic(str(src), str(q8), weight_type=QuantType.QInt8)
        dtype = "q8"
        # Quantized file is self-contained, so the fp32 pair is now dead weight.
        for stale in (src, data):
            if stale.exists():
                stale.unlink()
    except Exception as e:
        print(f"[export] quantization failed ({str(e)[:90]}); keeping fp32 + external weights")
        if q8.exists():
            q8.unlink()
        dtype = "fp32"

    kept = [p for p in (src, data, q8) if p.exists()]
    if not kept:
        raise SystemExit("[export] refusing: no usable graph was produced")
    total = sum(p.stat().st_size for p in kept)
    cfg["dtype"] = dtype
    cfg["onnxFiles"] = [p.name for p in kept]

    tok.save_pretrained(out)
    json.dump(cfg, open(out / "heads.json", "w"), indent=2)
    print(f"[export] dtype={dtype}  files={[p.name for p in kept]}  {total / 1e6:.1f} MB -> {out}")


if __name__ == "__main__":
    main()
