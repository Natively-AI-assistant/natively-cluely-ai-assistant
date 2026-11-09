"""Leakage check (campaign §2.2, Phase 1 step 8). Fails (exit 1) on any leak.

The judge-eval sets and the gold test are TEST ONLY. No training, dev or calib record may
hold a gold candidate, a paraphrase of one, or a near-duplicate. The splits must not share
near-duplicates with each other either (they are split by transcript, so one would mean
the generator repeated itself across transcripts).

A pair is a leak when EITHER test fires:
  - normalized-text containment >= 0.8: the share of the shorter text's word bag found in
    the longer one. Texts under 5 words only match on exact normalized equality, since
    "and why?" would otherwise "contain" half the corpus;
  - cosine >= 0.92 between multilingual-e5-small embeddings ("query: " prefix, mean pooling,
    L2-normalized). This is the app's bundled model, sha256-checked against its manifest.
    Applied only when both texts have at least 5 words: below that, e5 scores "and how?"
    vs "and why?" above 0.92, so short texts leak only on exact normalized equality.

    .venv/bin/python data/leakage_check.py --split train=data/train.jsonl --split dev=... --split calib=...
        [--gold-dir electron/intelligence/autoAnswer/__tests__/judge-eval] [--gold extra_gold.jsonl]
        [--e5-dir <dir holding config.json, tokenizer.json, onnx/model_quantized.onnx>]
    .venv/bin/python data/leakage_check.py --self-test
"""
import argparse
import glob
import hashlib
import json
import os
import re
import sys
from collections import Counter

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
MANIFEST = os.path.join(REPO, "resources", "models", "Xenova", "multilingual-e5-small", "manifest.json")
CONTAINMENT_MIN = 0.8
COSINE_MIN = 0.92
SHORT_WORDS = 5


def words(text):
    return re.sub(r"[^\w\s']", " ", str(text).lower()).split()


def containment(a, b):
    wa, wb = words(a), words(b)
    short, long_ = (wa, wb) if len(wa) <= len(wb) else (wb, wa)
    if not short:
        return 0.0
    if len(short) < SHORT_WORDS:
        return 1.0 if short == long_ else 0.0
    bag = Counter(long_)
    hit = 0
    for w in short:
        if bag[w] > 0:
            hit += 1
            bag[w] -= 1
    return hit / len(short)


class E5:
    def __init__(self, model_dir):
        import onnxruntime as ort
        from tokenizers import Tokenizer
        manifest = json.load(open(MANIFEST))
        for f in manifest["files"]:
            p = os.path.join(model_dir, f["path"])
            if not os.path.exists(p):
                raise SystemExit(f"e5 file missing: {p} (pass --e5-dir; the main checkout has it under resources/models)")
            h = hashlib.sha256(open(p, "rb").read()).hexdigest()
            if h != f["sha256"]:
                raise SystemExit(f"e5 sha256 mismatch for {f['path']}")
        self.tok = Tokenizer.from_file(os.path.join(model_dir, "tokenizer.json"))
        self.tok.enable_truncation(512)
        self.sess = ort.InferenceSession(os.path.join(model_dir, "onnx", "model_quantized.onnx"), providers=["CPUExecutionProvider"])
        self.inputs = {i.name for i in self.sess.get_inputs()}

    def embed(self, texts, batch=64):
        out = []
        for i in range(0, len(texts), batch):
            encs = [self.tok.encode("query: " + t) for t in texts[i:i + batch]]
            L = max(len(e.ids) for e in encs)
            ids = np.zeros((len(encs), L), dtype=np.int64)
            att = np.zeros((len(encs), L), dtype=np.int64)
            for j, e in enumerate(encs):
                ids[j, :len(e.ids)] = e.ids
                att[j, :len(e.ids)] = 1
            feed = {"input_ids": ids, "attention_mask": att}
            if "token_type_ids" in self.inputs:
                feed["token_type_ids"] = np.zeros_like(ids)
            h = self.sess.run(None, feed)[0]
            m = att[:, :, None].astype(np.float32)
            v = (h * m).sum(1) / np.clip(m.sum(1), 1e-9, None)
            out.append(v / np.linalg.norm(v, axis=1, keepdims=True))
        return np.concatenate(out) if out else np.zeros((0, 384), dtype=np.float32)


def load_gold(gold_dir, extra):
    rows = []
    for f in sorted(glob.glob(os.path.join(gold_dir, "*.json"))):
        for i, c in enumerate(json.load(open(f))):
            rows.append({"id": f"gold:{os.path.basename(f)}#{i}", "candidate": c["text"]})
    for path in extra or []:
        for line in open(path):
            if line.strip():
                r = json.loads(line)
                rows.append({"id": r.get("id", "gold:extra"), "candidate": r["candidate"]})
    return rows


def load_split(path):
    return [json.loads(l) for l in open(path) if l.strip()]


def find_leaks(a_rows, b_rows, e5, same=False):
    """Pairs (a, b) that leak. `same`: a and b are one split; only cross-transcript pairs count."""
    leaks = []
    ta = [r["candidate"] for r in a_rows]
    tb = [r["candidate"] for r in b_rows]
    ea, eb = e5.embed(ta), (e5.embed(tb) if not same else None)
    eb = ea if same else eb
    for i in range(0, len(ta), 512):
        sims = ea[i:i + 512] @ eb.T
        for di, row in enumerate(sims):
            ai = i + di
            for bj in np.nonzero(row >= COSINE_MIN)[0]:
                if same and (bj <= ai or a_rows[ai].get("transcript_id") == b_rows[bj].get("transcript_id")):
                    continue
                # Under 5 words, e5 cannot tell "and how?" from "and why?" (cosine >= 0.92,
                # measured in --self-test), so short texts leak only on exact normalized
                # equality, which the containment pass below catches.
                if min(len(words(ta[ai])), len(words(tb[bj]))) < SHORT_WORDS:
                    continue
                leaks.append((a_rows[ai]["id"], b_rows[bj]["id"], "cosine", float(row[bj])))
    # containment: word-bag prefilter by shared rare words would be faster; at <=30k x 30k it is
    # run only against gold (small) and as a cheap exact/short check within splits.
    b_index = {}
    for j, t in enumerate(tb):
        for w in set(words(t)):
            b_index.setdefault(w, []).append(j)
    for ai, t in enumerate(ta):
        ws = words(t)
        if not ws:
            continue
        cand = Counter(j for w in set(ws) for j in b_index.get(w, []))
        need = max(1, int(CONTAINMENT_MIN * min(len(set(ws)), SHORT_WORDS)))
        for bj, n in cand.items():
            if n < need:
                continue
            if same and (bj <= ai or a_rows[ai].get("transcript_id") == b_rows[bj].get("transcript_id")):
                continue
            c = containment(t, tb[bj])
            if c >= CONTAINMENT_MIN:
                leaks.append((a_rows[ai]["id"], b_rows[bj]["id"], "containment", c))
    return leaks


def run(splits, gold, e5):
    report, failed = {}, False
    names = list(splits)
    for n in names:
        lk = find_leaks(splits[n], gold, e5)
        report[f"{n}~gold"] = lk
        failed |= bool(lk)
    for i, n in enumerate(names):
        for m in names[i:]:
            lk = find_leaks(splits[n], splits[m], e5, same=(n == m))
            report[f"{n}~{m}"] = lk
            failed |= bool(lk)
    return report, failed


def self_test(e5):
    gold = [{"id": "g1", "candidate": "How would you design a rate limiter for a public API that serves millions of clients?"},
            {"id": "g2", "candidate": "And why?"}]
    train = [
        {"id": "t-exact", "transcript_id": "a", "candidate": "how would you design a rate limiter for a public API that serves millions of clients"},
        {"id": "t-para", "transcript_id": "b", "candidate": "How would you build a rate limiter for a public API serving millions of clients?"},
        {"id": "t-short", "transcript_id": "c", "candidate": "and why"},
        {"id": "t-clean", "transcript_id": "d", "candidate": "Tell me about the last time you disagreed with your manager about a deadline."},
        {"id": "t-short-ok", "transcript_id": "e", "candidate": "And how?"},
    ]
    leaks = find_leaks(train, gold, e5)
    hit = {a for a, *_ in leaks}
    ok = {"t-exact", "t-para", "t-short"} <= hit and not ({"t-clean", "t-short-ok"} & hit)
    print("self-test leaks:", sorted({(a, b, k) for a, b, k, _ in leaks}))
    print("self-test", "PASSED" if ok else "FAILED")
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", action="append", default=[], help="name=path.jsonl (train, dev, calib)")
    ap.add_argument("--gold-dir", default=os.path.join(REPO, "electron", "intelligence", "autoAnswer", "__tests__", "judge-eval"))
    ap.add_argument("--gold", action="append", help="extra gold JSONL (human-labeled recordings)")
    ap.add_argument("--e5-dir", default=os.path.join(REPO, "resources", "models", "Xenova", "multilingual-e5-small"))
    ap.add_argument("--report", help="write every leak pair to this JSON file")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()
    e5 = E5(a.e5_dir)
    if a.self_test:
        sys.exit(0 if self_test(e5) else 1)
    splits = {}
    for s in a.split:
        name, path = s.split("=", 1)
        splits[name] = load_split(path)
    gold = load_gold(a.gold_dir, a.gold)
    report, failed = run(splits, gold, e5)
    for k, v in report.items():
        print(f"{k}: {len(v)} leak pair(s)")
    if a.report:
        json.dump(report, open(a.report, "w"), indent=1)
    if failed:
        print("LEAKAGE CHECK FAILED: remove the flagged records (never edit gold) and re-run.")
        sys.exit(1)
    print("leakage check passed")


if __name__ == "__main__":
    main()
