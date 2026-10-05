#!/usr/bin/env python3
"""Rescore e2e correctness in results.json with value-token matching.

The live run scored 'correct' as exact-corpus-substring; models legitimately
answer 'p95 latency SLO of 450 ms' as '450 ms'. This recomputes per-model
correct/refusal/false-refusal counts from the stored answer heads and writes
results_rescored.json. Retrieval metrics (A/B/D) are untouched — they are
defined over verbatim corpus text.
"""
import json
from pathlib import Path

from sweep import answer_correct, is_refusal

HERE = Path(__file__).resolve().parent
rows = json.loads((HERE / "results.json").read_text())
needles = json.loads((HERE / "corpus" / "needles.json").read_text())
by_pk = {(n["project"], n["kind"]): n for n in needles["direct"]}

for r in rows:
    stats = {m: {"correct": 0, "refusals": 0, "false_refusals": 0}
             for m in r["e2e"]}
    for q in r["per_question"]:
        n = by_pk[(q["project"], q["kind"])]
        for m, st in q["models"].items():
            ans = st.get("answer_head", "")
            correct = answer_correct(ans, n["answer"], n["kind"])
            refused = is_refusal(ans)
            st["correct"] = correct
            st["refused"] = refused
            st["false_refusal"] = refused and q["survived"]
            stats[m]["correct"] += correct
            stats[m]["refusals"] += refused
            stats[m]["false_refusals"] += st["false_refusal"]
    r["e2e"] = stats

(HERE / "results_rescored.json").write_text(json.dumps(rows, indent=2))
print(f"{'size':>5} {'chunks':>6} {'recall@12':>9} {'survival':>8} "
      f"{'cont.plain':>10} {'cont.anch':>9}  e2e (rescored)")
for r in rows:
    line = (f"{r['size']:>5} {r['chunks']:>6} {r['recall_at_12']:>7}/25 "
            f"{r['budget_survival']:>6}/25 {r['continuity_plain']:>8}/5 "
            f"{r['continuity_anchored']:>7}/5 ")
    for m, st in r["e2e"].items():
        line += f" | {m.split(':')[0]}: {st['correct']}/25 ref {st['refusals']}({st['false_refusals']})"
    print(line)
