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

# `legacy_intent` is a head like any other so this candidate is directly
# comparable to the NLI runs on the control taxonomy. Without it the trained
# model shows 0.0 in the legacy column purely because it was never asked, which
# reads as a failure rather than an omission.
AXES = ["needs_response", "dialogue_act", "task", "answer_form", "grounding", "mode_intent", "legacy_intent"]


class MultiHead(nn.Module):
    def __init__(self, encoder_name, sizes):
        super().__init__()
        # fp32, for the same reason train_multihead.py forces it, and it has to
        # be repeated here because this is a SECOND definition of MultiHead: the
        # exporter does not import the trainer's.
        #
        # The failure differs on this side. Training a mixed fp16/fp32 model on
        # MPS gives a NaN loss. Exporting one gives a graph that quantizes into
        # fp16 scale tensors, and onnxruntime then refuses to load it:
        #
        #   Type 'tensor(float16)' of input parameter
        #   (encoder.embeddings.word_embeddings.weight_scale) of operator
        #   (DequantizeLinear) is invalid
        #
        # Which is a loud failure rather than a silent one, but only at load
        # time, well after the export reported success.
        self.encoder = AutoModel.from_pretrained(encoder_name).float()
        h = self.encoder.config.hidden_size
        self.heads = nn.ModuleDict({a: nn.Linear(h, n) for a, n in sizes.items()}).float()

    def forward(self, input_ids, attention_mask):
        out = self.encoder(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state
        mask = attention_mask.unsqueeze(-1).float()
        pooled = (out * mask).sum(1) / mask.sum(1).clamp(min=1e-9)
        # Tuple, not dict: torch.onnx names outputs positionally, and a dict
        # return makes the output order implicit. The order here is AXES, and
        # the Node side reads it by that same list.
        #
        # The POOLED EMBEDDING is emitted as a final output, and that is what
        # makes a one-session composite possible.
        #
        # Measured: a second resident ONNX session costs the first one about
        # 66% more latency on this machine (12.71ms to 21.15ms) even when the
        # second model is trivially cheap and never runs concurrently. Disabling
        # ORT's thread spinning made it worse (35.27ms) and dropping to one
        # intra-op thread made it much worse (42.49ms), so the obvious
        # mitigations do not work.
        #
        # The fine-tuned heads win the low-cardinality axes and lose badly on
        # mode_intent, where a nearest-centroid prototype beats them in eleven
        # of twelve modes. Exposing the pooled vector lets the centroid lookup
        # run against THIS model's own representation, so both behaviours come
        # from one forward pass in one session instead of two.
        return tuple(self.heads[a](pooled) for a in AXES) + (pooled,)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trained", required=True, help="directory from train_multihead.py")
    ap.add_argument("--out", required=True)
    # ModernBERT's graph contains a Split carrying `num_outputs`, which only
    # exists from opset 18. Exported at 17 it produces a file onnxruntime
    # rejects at load with "Unrecognized attribute: num_outputs for operator
    # Split" — a model-level error that reads like a corrupt export.
    # MiniLM and its distilled variant are fine at 17, and are left there so
    # their already-measured numbers stay reproducible.
    ap.add_argument("--opset", type=int, default=17)
    args = ap.parse_args()

    trained = Path(args.trained)
    cfg = json.load(open(trained / "heads.json"))
    out = Path(args.out)
    (out / "onnx").mkdir(parents=True, exist_ok=True)

    model = MultiHead(cfg["encoder"], cfg["sizes"])
    _dt = {p.dtype for p in model.parameters()}
    assert _dt == {torch.float32}, (
        f"the graph must be fp32 before export; found {_dt}. "
        "A fp16 parameter survives into the quantized graph as a fp16 scale "
        "tensor, and onnxruntime rejects the model at load time.")
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
        output_names=[f"logits_{a}" for a in AXES] + ["pooled"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "sequence"},
            "attention_mask": {0: "batch", 1: "sequence"},
            **{f"logits_{a}": {0: "batch"} for a in AXES},
            "pooled": {0: "batch"},
        },
        opset_version=args.opset,
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
        import onnx
        from onnxruntime.quantization import quantize_dynamic, QuantType

        # STRIP value_info BEFORE QUANTIZING.
        #
        # torch 2.12's exporter writes value_info for every intermediate tensor:
        # 461 entries on this graph. onnxruntime's quantizer runs its OWN
        # symbolic shape inference, which disagrees with some of them and aborts
        # with "Inferred shape and existing shape differ in dimension 0:
        # (384) vs (3)" — the encoder's hidden width against a head's class
        # count.
        #
        # The graph itself is fine. onnx.checker passes, and
        # onnx.shape_inference.infer_shapes passes in BOTH strict and non-strict
        # mode. Only ORT's separate implementation objects, and it objects at
        # LOAD time, which is why extra_options={'DisableShapeInference': True}
        # does not help and neither does quant_pre_process.
        #
        # Dropping value_info costs nothing: it is a hint, the shapes are
        # recomputed downstream, and the inputs and outputs keep their
        # declarations. Without this the export silently falls back to fp32 and
        # ships a 90.5MB model where 22.8MB would do — four times the size on a
        # 25ms latency budget.
        stripped = out / "onnx" / "_stripped.onnx"
        # Remove any sidecar left by an earlier run BEFORE saving. onnx.save
        # refuses to overwrite an existing external-data file and raises
        # "External data file exists in _stripped.onnx.data.", the export then
        # falls back to fp32, and the model ships six times larger and roughly
        # nine times slower with only a warning to say so. A previous run that
        # failed after writing the sidecar leaves exactly this trap for the next
        # one, which is how deberta was first measured at 107.8ms unquantized.
        for stale in (stripped, out / "onnx" / "_stripped.onnx.data"):
            try:
                if stale.exists():
                    stale.unlink()
                    print(f"[export] removed stale {stale.name} from a previous run")
            except OSError:
                pass
        graph = onnx.load(str(src))
        del graph.graph.value_info[:]
        # `location` is resolved relative to the PROCESS CWD, not to the model
        # path, so a bare filename drops a 90MB sidecar in whatever directory
        # the script was launched from. Write into the onnx dir explicitly.
        import os
        cwd = os.getcwd()
        os.chdir(out / "onnx")
        try:
            onnx.save(graph, "_stripped.onnx", save_as_external_data=True,
                      location="_stripped.onnx.data", all_tensors_to_one_file=True, size_threshold=1024)
        finally:
            os.chdir(cwd)
        quantize_dynamic(str(stripped), str(q8), weight_type=QuantType.QInt8)
        for leftover in (stripped, out / "onnx" / "_stripped.onnx.data"):
            if leftover.exists():
                leftover.unlink()
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
