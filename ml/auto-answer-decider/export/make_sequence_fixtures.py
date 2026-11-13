"""Golden parity fixtures for the TypeScript sequence builder (campaign Phase 3, step 4).

Writes electron/intelligence/autoAnswer/__tests__/decider-fixtures/laya-sequence.json:
  - the tokenizer's special ids, the head ids and markers for the §4 question;
  - per case: the fitted serialized state, Laya's own `build_sequence` ids, markers and truncation
    stats, the fp32 ONNX logits for that row, and the decoded answer (choice, probabilities,
    confidence, answer_confidence) with the checkpoint's temperatures, mirroring
    `ONNXAgent._decode_answers`.
and laya-tokenizer/{tokenizer.json.gz, tokenizer_config.json} next to it, so the TS test runs in
`npm test` with no model download.

    .venv/bin/python export/make_sequence_fixtures.py [--onnx-dir artifacts/zero-shot-onnx] [--n 300]

Cases: every judge-eval state (they are already in the repo as test data) plus synthetic pilot
candidates up to --n. These are TEST fixtures: nothing here feeds training.
"""
import argparse
import gzip
import json
import os
import shutil
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
REPO = os.path.abspath(os.path.join(ROOT, "..", ".."))
sys.path.insert(0, ROOT)
from decider import state as st  # noqa: E402

OUT_DIR = os.path.join(REPO, "electron", "intelligence", "autoAnswer", "__tests__", "decider-fixtures")


def gold_fields():
    out = subprocess.run(["node", os.path.join(ROOT, "bench", "emit_eval_states.mjs")], capture_output=True, text=True, check=True)
    return [{"id": f"gold:{r['set']}#{r['index']}", "fields": r["fields"]} for r in map(json.loads, out.stdout.splitlines()) if r]


def pilot_fields(path, limit):
    if not os.path.exists(path) or limit <= 0:
        return []
    recs = [json.loads(l) for l in open(path) if l.strip()][:limit]
    out = subprocess.run(["node", os.path.join(ROOT, "data", "emit_fields.mjs")], input="\n".join(json.dumps(r) for r in recs),
                         capture_output=True, text=True, check=True)
    return [{"id": r["id"], "fields": r["fields"]} for r in map(json.loads, out.stdout.splitlines()) if r]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="convaiinnovations/laya")
    ap.add_argument("--onnx-dir", default=os.path.join(ROOT, "artifacts", "zero-shot-onnx"))
    ap.add_argument("--pilot", default=os.path.join(ROOT, "data", "work", "pilot-candidates.jsonl"))
    ap.add_argument("--n", type=int, default=300)
    a = ap.parse_args()

    from laya import Agent
    from laya.common import (answer_confidence, build_head, build_sequence, confidence_from_probs, clamp_temperature,
                             encode_text, state_room, temp_bucket, QTYPES)
    from laya.onnx_agent import _collate_items_numpy
    import onnxruntime as ort

    agent = Agent(a.model, device="cpu")
    tok = agent.tok
    q = agent._to_internal(st.QUESTIONS[st.QUESTION_ID])
    max_len, head_max_len = agent.cfg.get("max_len", 512), agent.cfg.get("head_max_len", 192)
    head_ids, head_markers, _ = build_head(tok, q, head_max_len)
    room = state_room(tok, q, max_len, head_max_len)
    count = lambda s: len(encode_text(tok, s.replace(tok.mask_token, " "), add_special_tokens=False)["input_ids"])

    rows = gold_fields()
    rows += pilot_fields(a.pilot, max(0, a.n - len(rows)))
    # a few hand-made edge cases the TS port must survive: the mask token inside text, astral
    # characters, an over-long candidate that the fit has to cut, an empty context
    base = rows[0]["fields"]
    edge = [
        {**base, "candidate": "please fill in the [MASK] here and tell me why", "context": []},
        {**base, "candidate": "naïve café — 日本語 😀 𝔘𝔫𝔦𝔠𝔬𝔡𝔢?   line sep", "last_answered": None},
        {**base, "candidate": " ".join(["so the ingestion pipeline keeps growing"] * 120) + " how would you shard it?"},
    ]
    rows += [{"id": f"edge:{i}", "fields": f} for i, f in enumerate(edge)]

    sess = ort.InferenceSession(os.path.join(a.onnx_dir, "laya.onnx"), providers=["CPUExecutionProvider"])
    temps = agent.cfg.get("temperature", [1.0, 1.0, 1.0])
    by_opt = agent.cfg.get("temperature_by_options", {}) or {}
    cases = []
    for r in rows:
        fit = st.fit(r["fields"], count, room)
        ids, markers, trunc = build_sequence(tok, fit["serialized"], q, max_len, head_max_len, return_truncation_stats=True)
        batch = _collate_items_numpy([[{"ids": ids, "markers": markers, "qtype": QTYPES["choice"]}]], tok.pad_token_id)
        logits, act = sess.run(None, batch)
        k = len(markers)
        t = clamp_temperature(by_opt.get(temp_bucket(QTYPES["choice"], k), temps[QTYPES["choice"]]))
        z = logits[0, :k] / t
        p = np.exp(z - z.max())
        p /= p.sum()
        keys = list(q["crit"].keys())
        cases.append({
            "id": r["id"],
            "fields": r["fields"],
            "fit": {"droppedTurns": fit["droppedTurns"], "answeredShrunk": fit["answeredShrunk"], "droppedCandidateWords": fit["droppedCandidateWords"]},
            "serialized": fit["serialized"],
            "ids": ids,
            "markers": markers,
            "truncation": trunc,
            "logits": [float(x) for x in logits[0, :k]],
            "answer": {
                "choice": keys[int(p.argmax())],
                "probabilities": {kk: round(float(v), 4) for kk, v in zip(keys, p)},
                "confidence": round(confidence_from_probs(p, k), 4),
                "answer_confidence": round(answer_confidence(p, k), 4),
            },
        })

    long_desc = "a very long description of this option that keeps going " * 12
    head_qs = [
        {"type": "choice", "instructions": "Pick one [MASK] option.", "criteria": {"alpha": long_desc, "beta": "short", "gamma": None}},
        {"type": "choice", "instructions": "Which of many? " * 30, "criteria": {f"opt{i}": long_desc for i in range(9)}},
        {"type": "choice", "instructions": "Labels only", "criteria": ["yes", "no", "maybe"]},
    ]
    head_cases = []
    for hq in head_qs:
        iq = agent._to_internal(hq)
        hids, hmarkers, hstats = build_head(tok, iq, head_max_len)
        head_cases.append({"question": hq, "internal": iq, "ids": hids, "markers": hmarkers, "stats": hstats})

    os.makedirs(OUT_DIR, exist_ok=True)
    fixture = {
        "generator": "ml/auto-answer-decider/export/make_sequence_fixtures.py",
        "model": a.model,
        "max_len": max_len, "head_max_len": head_max_len, "state_room": room,
        "special": {"mask_token": tok.mask_token, "mask_id": tok.mask_token_id, "cls_id": tok.cls_token_id,
                    "sep_id": tok.sep_token_id, "pad_id": tok.pad_token_id},
        "question": st.QUESTIONS[st.QUESTION_ID],
        "internal_question": q,
        "head": {"ids": head_ids, "markers": head_markers},
        # questions that exercise build_head's caps, which the §4 question never reaches: an
        # option over 48 tokens, and enough options to push the per-option cut (< 16 budget)
        "head_cases": head_cases,
        "calibration": {"temperature": temps, "temperature_by_options": by_opt},
        "cases": cases,
    }
    with open(os.path.join(OUT_DIR, "laya-sequence.json"), "w") as f:
        json.dump(fixture, f, ensure_ascii=False, separators=(",", ":"))

    # the tokenizer the ids were made with, gzipped, plus the Apache-2.0 notice
    from huggingface_hub import snapshot_download
    snap = snapshot_download(a.model, allow_patterns=["tokenizer/*"])
    tdir = os.path.join(OUT_DIR, "laya-tokenizer")
    os.makedirs(tdir, exist_ok=True)
    with open(os.path.join(snap, "tokenizer", "tokenizer.json"), "rb") as src, gzip.GzipFile(os.path.join(tdir, "tokenizer.json.gz"), "wb", mtime=0) as dst:
        shutil.copyfileobj(src, dst)
    shutil.copy(os.path.join(snap, "tokenizer", "tokenizer_config.json"), os.path.join(tdir, "tokenizer_config.json"))
    with open(os.path.join(tdir, "NOTICE"), "w") as f:
        f.write("Tokenizer from the Laya checkpoint convaiinnovations/laya (ModernBERT-large tokenizer), "
                "licensed Apache-2.0. Test fixture only; the app downloads the tokenizer with the model.\n")
    print(f"{len(cases)} cases → {OUT_DIR}/laya-sequence.json; head {len(head_ids)} tokens, room {room}")


if __name__ == "__main__":
    main()
