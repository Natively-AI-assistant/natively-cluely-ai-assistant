"""Join candidates + teacher labels into train/dev/calib (campaign Phase 1, steps 6 and 8).

    .venv/bin/python data/build_dataset.py --candidates data/work/candidates.jsonl \
        --labels data/work/labels.jsonl --out data/work/dataset [--e5-dir ...] [--drop-leaks]

- Splits 80/10/10 by TRANSCRIPT (sha256 of transcript_id), never by candidate.
- Records the teacher could not settle (2-2 tie, no valid vote) go to adjudicate.jsonl, not training.
- Runs the leakage check on the splits. It fails the build on any leak, unless --drop-leaks,
  which removes the flagged non-gold records and re-checks until clean.
- Writes, per split, the records (`<split>.jsonl`) and the Laya training rows
  (`<split>.laya.jsonl`: {state, questions, gold}). The state is the §4 fields built by the app's
  TypeScript builder, fitted to the model's room with the Laya tokenizer.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, ROOT)
sys.path.insert(0, HERE)

from decider import state as st  # noqa: E402
import leakage_check as lc  # noqa: E402

LABELS = ["answer", "silent", "wait"]
_AGENT = None


def split_of(transcript_id):
    h = int(hashlib.sha256(transcript_id.encode()).hexdigest()[:8], 16) % 100
    return "train" if h < 80 else "dev" if h < 90 else "calib"


def read_jsonl(p):
    return [json.loads(l) for l in open(p) if l.strip()]


def write_jsonl(p, rows):
    with open(p, "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def with_fields(records):
    node = subprocess.run(["node", os.path.join(HERE, "emit_fields.mjs")], input="\n".join(json.dumps(r) for r in records),
                          capture_output=True, text=True, check=True)
    return [json.loads(l) for l in node.stdout.splitlines() if l.strip()]


def laya_rows(records, model_id):
    from laya import Agent
    from laya.common import encode_text, state_room
    global _AGENT
    if _AGENT is None:
        _AGENT = Agent(model_id, device="cpu")
    agent = _AGENT
    tok = agent.tok
    room = state_room(tok, agent._to_internal(st.QUESTIONS[st.QUESTION_ID]),
                      agent.cfg.get("max_len", 512), agent.cfg.get("head_max_len", 192))
    count = lambda s: len(encode_text(tok, s.replace(tok.mask_token, " "), add_special_tokens=False)["input_ids"])
    rows, fits = [], Counter()
    for r in records:
        f = st.fit(r["fields"], count, room)
        fits["droppedTurns>0"] += f["droppedTurns"] > 0
        fits["answeredShrunk"] += bool(f["answeredShrunk"])
        fits["droppedCandidateWords>0"] += f["droppedCandidateWords"] > 0
        rows.append({"id": r["id"], "state": f["serialized"], "questions": st.QUESTIONS,
                     "gold": {st.QUESTION_ID: {"probabilities": dict(zip(LABELS, r["soft"]))}}})
    return rows, dict(fits), room


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", required=True)
    ap.add_argument("--labels", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--e5-dir", default=os.path.join(lc.REPO, "resources", "models", "Xenova", "multilingual-e5-small"))
    ap.add_argument("--drop-leaks", action="store_true")
    ap.add_argument("--adjudicated", help="adjudicated.jsonl exported from data/adjudicate.html")
    ap.add_argument("--model", default="convaiinnovations/laya")
    ap.add_argument("--skip-laya-rows", action="store_true")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    labels = {r["id"]: r for r in read_jsonl(a.labels)}
    human = {r["id"]: r["label"] for r in read_jsonl(a.adjudicated)} if a.adjudicated else {}
    recs, adjud = [], []
    for c in read_jsonl(a.candidates):
        lab = labels.get(c["id"])
        if not lab:
            continue
        label, soft, by = lab["label"], lab["soft"], "teacher"
        if c["id"] in human and human[c["id"]] in LABELS:
            label, soft, by = human[c["id"]], [float(l == human[c["id"]]) for l in LABELS], "human"
        c = {**c, "label": label, "soft": soft, "teacher": lab.get("teacher"), "labeled_by": by,
             "split": split_of(c["transcript_id"]), "source": "synthetic"}
        if label is None:
            adjud.append({**c, "votes": lab.get("votes", [])})
        else:
            recs.append(c)
    write_jsonl(os.path.join(a.out, "adjudicate.jsonl"), adjud)

    e5 = lc.E5(a.e5_dir)
    gold = lc.load_gold(os.path.join(lc.REPO, "electron", "intelligence", "autoAnswer", "__tests__", "judge-eval"), None)
    dropped = set()
    for round_ in range(5):
        splits = {s: [r for r in recs if r["split"] == s and r["id"] not in dropped] for s in ("train", "dev", "calib")}
        report, failed = lc.run(splits, gold, e5)
        summary = {k: len(v) for k, v in report.items()}
        print(f"leakage round {round_}: {summary}")
        if not failed:
            break
        if not a.drop_leaks:
            json.dump(report, open(os.path.join(a.out, "leaks.json"), "w"), indent=1)
            print("LEAKAGE CHECK FAILED (see leaks.json); re-run with --drop-leaks to remove the flagged records")
            sys.exit(1)
        for k, pairs in report.items():
            for x, y, *_ in pairs:
                # never touch gold; within or across splits drop the second record of the pair
                dropped.add(x if k.endswith("~gold") else y)
    else:
        print("leaks remain after 5 rounds")
        sys.exit(1)

    stats = {"records": len(recs) - len(dropped), "adjudicate": len(adjud), "dropped_for_leakage": len(dropped)}
    for s, rows in splits.items():
        write_jsonl(os.path.join(a.out, f"{s}.jsonl"), rows)
        stats[s] = {"n": len(rows), "labels": dict(Counter(r["label"] for r in rows)),
                    "transcripts": len({r["transcript_id"] for r in rows})}
    if not a.skip_laya_rows:
        for s, rows in splits.items():
            lr, fits, room = laya_rows(with_fields(rows), a.model)
            write_jsonl(os.path.join(a.out, f"{s}.laya.jsonl"), lr)
            stats[s]["fit"] = fits
            stats["state_room"] = room
    json.dump(stats, open(os.path.join(a.out, "stats.json"), "w"), indent=1)
    print(json.dumps(stats, indent=1))


if __name__ == "__main__":
    main()
