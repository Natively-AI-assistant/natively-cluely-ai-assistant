#!/usr/bin/env python3
"""
Export a punctuation-restoration model to the ONNX layout transformers.js loads.

Candidate P of the interaction-router campaign. The campaign brief assumed an
off-the-shelf ONNX punctuation model existed; none does in a transformers.js
layout. `1-800-BAD-CODE/punctuation_fullstop_truecase_english` ships a raw
.onnx but pairs it with a SentencePiece model and no tokenizer.json, which
would mean adding a native SentencePiece dependency to an Electron app that
already has enough native-module surface. So the model is exported here
instead, which is the path the brief explicitly allows ("Use
--break-system-packages for any Python used for fine-tuning or export; keep
Python out of the production path, production runs ONNX or GGUF from Node
only").

Output layout matches what transformers.js expects, and specifically writes
onnx/model_quantized.onnx, because every consumer in this repo passes
dtype:'q8' and a bare model.onnx would fail to load in a packaged build. See
the dtype comment in electron/llm/intentClassifierWorker.ts.

Usage:
  python3 scripts/intent-benchmark/tools/export_punctuation_onnx.py \
      --model unikei/distilbert-base-re-punctuate \
      --out resources/models/natively/punctuation-restore
"""
import argparse, json, os, shutil, sys
from pathlib import Path

import torch
from transformers import AutoTokenizer, AutoModelForTokenClassification


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="unikei/distilbert-base-re-punctuate")
    ap.add_argument("--out", required=True)
    ap.add_argument("--opset", type=int, default=14)
    args = ap.parse_args()

    out = Path(args.out)
    onnx_dir = out / "onnx"
    onnx_dir.mkdir(parents=True, exist_ok=True)

    print(f"[export] loading {args.model}")
    tok = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForTokenClassification.from_pretrained(args.model)
    model.eval()

    # transformers.js reads the tokenizer from tokenizer.json + config files in
    # the model root, and the graph from onnx/.
    tok.save_pretrained(out)
    model.config.save_pretrained(out)
    print(f"[export] labels: {model.config.id2label}")

    sample = tok("so uh whats the deal with invalidation there", return_tensors="pt")
    inputs = (sample["input_ids"], sample["attention_mask"])

    fp32 = onnx_dir / "model.onnx"
    print(f"[export] tracing to {fp32}")
    torch.onnx.export(
        model,
        inputs,
        str(fp32),
        input_names=["input_ids", "attention_mask"],
        output_names=["logits"],
        # Dynamic on BOTH axes. Batch is obvious; sequence matters more here,
        # because live turns range from one word to a long run-on and a fixed
        # sequence length would either truncate or pad every call.
        dynamic_axes={
            "input_ids": {0: "batch", 1: "sequence"},
            "attention_mask": {0: "batch", 1: "sequence"},
            "logits": {0: "batch", 1: "sequence"},
        },
        opset_version=args.opset,
        do_constant_folding=True,
    )

    # Every ONNX consumer in this repo passes dtype:'q8', so a build that ships
    # only model.onnx loads fine in dev and fails in a packaged build. Quantize,
    # and if quantization is unavailable, COPY rather than leave the expected
    # filename missing.
    q8 = onnx_dir / "model_quantized.onnx"
    try:
        from onnxruntime.quantization import quantize_dynamic, QuantType
        print(f"[export] quantizing to {q8}")
        quantize_dynamic(str(fp32), str(q8), weight_type=QuantType.QInt8)
    except Exception as e:
        print(f"[export] quantization unavailable ({e}); copying fp32 to the q8 filename")
        shutil.copyfile(fp32, q8)

    # Drop the fp32 graph and its external weights. torch 2.12's exporter writes
    # weights to a sidecar .data file, so model.onnx alone is a 0.8 MB graph and
    # the real 265 MB sits next to it. Nothing loads the fp32 path: every ONNX
    # consumer in this repo passes dtype:'q8'. Shipping both would put a quarter
    # of a gigabyte of dead weight into the installer.
    for stale in (fp32, onnx_dir / "model.onnx.data"):
        if stale.exists():
            print(f"[export] removing unused {stale.name} ({stale.stat().st_size / 1e6:.1f} MB)")
            stale.unlink()

    print(f"[export] {q8.name}  {q8.stat().st_size / 1e6:.1f} MB")
    print(f"[export] wrote {out}")
    print("[export] files:", sorted(os.listdir(out)))


if __name__ == "__main__":
    sys.exit(main())
