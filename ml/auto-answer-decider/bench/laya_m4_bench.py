"""
Laya latency + zero-shot benchmark on Natively's judge-eval sets (campaign Phase 0, step 4).

Run from the repo root on the MacBook, after `npm run build:electron`:

    ml/auto-answer-decider/.venv/bin/python ml/auto-answer-decider/bench/laya_m4_bench.py --devices cpu mps

It builds the §4 decider state for each of the 187 judge-eval candidates with the app's
own TypeScript builder (bench/emit_eval_states.mjs -> deciderState.ts, so `addressed_to`
comes from the judge's real name helpers), fits it into the model's token budget with
decider/state.py, then times one `system_one` per candidate on each device and reports:

- p50 / p90 / max latency per device;
- token-length distribution, and how often the 512-token budget would truncate the raw
  state (laya's `return_truncation_stats`) versus the fitted one;
- zero-shot recall, false fires and waits against `expect` (`silent` and `none` = not-ask);
- int8 dynamic-quantized ONNX timing on onnxruntime CPU, and the CoreML EP if exposed.

Every run appends one line to results/ledger.jsonl. The judge-eval sets are TEST ONLY.
Zero-shot accuracy is a baseline, not a decision input: only latency decides gate G0.
"""

import argparse
import contextlib
import gc
import hashlib
import json
import os
import platform
import statistics
import subprocess
import sys
import tempfile
import time
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
ML_ROOT = os.path.dirname(HERE)
REPO_ROOT = os.path.dirname(os.path.dirname(ML_ROOT))
sys.path.insert(0, ML_ROOT)

from decider.state import QUESTIONS, QUESTION_ID, fit, serialize  # noqa: E402

EMITTER = os.path.join(HERE, "emit_eval_states.mjs")


# ── inputs ──────────────────────────────────────────────────────────────────

def load_states(path):
    if path:
        with open(path, encoding="utf-8") as f:
            raw = f.read()
    else:
        raw = subprocess.run(["node", EMITTER], cwd=REPO_ROOT, check=True,
                             capture_output=True, text=True).stdout
    rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
    if not rows:
        raise SystemExit("no eval states; run `npm run build:electron` from the repo root first")
    return rows, hashlib.sha256(raw.encode("utf-8")).hexdigest()


def internal_question(agent):
    return agent._to_internal(QUESTIONS[QUESTION_ID])


def budget(agent):
    return agent.cfg.get("max_len", 512), agent.cfg.get("head_max_len", 192)


def token_counter(agent):
    from laya.common import encode_text
    tok = agent.tok

    def count(serialized):
        # Exactly what Agent._encode_state tokenizes for a string state.
        return len(encode_text(tok, serialized.replace(tok.mask_token, " "), add_special_tokens=False)["input_ids"])
    return count


def prepare(agent, rows):
    """Fit every state; report raw-vs-fitted truncation and token lengths."""
    from laya.common import build_sequence, state_room
    q = internal_question(agent)
    max_len, head_max_len = budget(agent)
    room = state_room(agent.tok, q, max_len, head_max_len)
    count = token_counter(agent)
    prepared, raw_trunc, fit_trunc = [], 0, 0
    raw_state_tokens, seq_lens = [], []
    fit_stats = {"droppedTurns": 0, "answeredShrunk": 0, "droppedCandidateWords": 0, "statesTouched": 0}
    for r in rows:
        raw = serialize(r["fields"])
        _, _, rs = build_sequence(agent.tok, raw, q, max_len, head_max_len, return_truncation_stats=True)
        raw_trunc += rs["truncated"]
        raw_state_tokens.append(rs["state_tokens"])
        fitted = fit(r["fields"], count, room)
        ids, _, fs = build_sequence(agent.tok, fitted["serialized"], q, max_len, head_max_len,
                                    return_truncation_stats=True)
        fit_trunc += fs["truncated"]
        seq_lens.append(len(ids))
        touched = fitted["droppedTurns"] or fitted["answeredShrunk"] or fitted["droppedCandidateWords"]
        fit_stats["statesTouched"] += bool(touched)
        fit_stats["droppedTurns"] += fitted["droppedTurns"]
        fit_stats["answeredShrunk"] += int(fitted["answeredShrunk"])
        fit_stats["droppedCandidateWords"] += fitted["droppedCandidateWords"]
        prepared.append({**r, "serialized": fitted["serialized"]})
    head_len = max_len - 1 - room
    return prepared, {
        "max_len": max_len, "head_max_len": head_max_len, "head_tokens": head_len, "state_room": room,
        "raw_states_truncated": raw_trunc, "fitted_states_truncated": fit_trunc, "n": len(rows),
        "raw_state_tokens": dist(raw_state_tokens), "fitted_sequence_tokens": dist(seq_lens),
        "fit": fit_stats,
    }


# ── stats ───────────────────────────────────────────────────────────────────

def pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(q * (len(xs) - 1))))]


def dist(xs):
    return {"min": min(xs), "p50": pct(xs, .5), "p90": pct(xs, .9), "p99": pct(xs, .99), "max": max(xs),
            "mean": round(statistics.mean(xs), 1)}


def lat_stats(lat):
    return {"p50": round(pct(lat, .5), 1), "p90": round(pct(lat, .9), 1), "max": round(max(lat), 1),
            "mean": round(statistics.mean(lat), 1), "n": len(lat)}


def score(rows, choices):
    """Recall on asks, false fires on non-asks (silent + none), waits; overall and per set."""
    def tally(pairs):
        t = {"asks": 0, "recalled": 0, "non_asks": 0, "false_fires": 0, "waits": 0, "waits_on_asks": 0}
        for r, c in pairs:
            ask = r["expect"] == "ask"
            t["asks"] += ask
            t["non_asks"] += not ask
            t["recalled"] += ask and c == "answer"
            t["false_fires"] += (not ask) and c == "answer"
            t["waits"] += c == "wait"
            t["waits_on_asks"] += ask and c == "wait"
        return t
    pairs = list(zip(rows, choices))
    per_set = {}
    for s in sorted({r["set"] for r in rows}):
        per_set[s] = tally([(r, c) for r, c in pairs if r["set"] == s])
    return {"overall": tally(pairs), "per_set": per_set}


# ── torch runs ──────────────────────────────────────────────────────────────

def run_torch(agent, device, rows, warmup):
    for r in rows[:warmup]:
        agent.system_one(r["serialized"], QUESTIONS)
    lat, preds, truncated = [], [], 0
    for r in rows:
        t = time.perf_counter()
        out = agent.system_one(r["serialized"], QUESTIONS)
        lat.append((time.perf_counter() - t) * 1000)
        # system_one returns {"model", "answers": {qid: {...}}, "usage": {...}} (laya 0.4.30 agent.py).
        ans = out["answers"][QUESTION_ID]
        truncated += bool(out["usage"].get("truncated"))
        preds.append({
            "set": r["set"], "index": r["index"], "expect": r["expect"],
            "choice": ans["choice"], "probabilities": ans["probabilities"],
            "confidence": ans["confidence"], "answer_confidence": ans["answer_confidence"],
            "act_probability": ans.get("action", {}).get("act_probability"),
        })
    res = {"device": device, "latency_ms": lat_stats(lat), "usage_truncated": truncated,
           "zero_shot": score(rows, [p["choice"] for p in preds])}
    print(f"\n== torch {device}: latency ms p50 {res['latency_ms']['p50']} p90 {res['latency_ms']['p90']} "
          f"max {res['latency_ms']['max']}  (usage.truncated {truncated}/{len(rows)})")
    o = res["zero_shot"]["overall"]
    print(f"   zero-shot recall {o['recalled']}/{o['asks']}  false fires {o['false_fires']}/{o['non_asks']}  "
          f"waits {o['waits']} ({o['waits_on_asks']} on asks)")
    return res, preds


# ── ONNX runs ───────────────────────────────────────────────────────────────

@contextlib.contextmanager
def capture_native_stderr():
    """onnxruntime logs EP partitioning from C++ to fd 2; capture it."""
    buf = tempfile.TemporaryFile(mode="w+b")
    saved = os.dup(2)
    sys.stderr.flush()
    os.dup2(buf.fileno(), 2)
    out = {"text": ""}
    try:
        yield out
    finally:
        sys.stderr.flush()
        os.dup2(saved, 2)
        os.close(saved)
        buf.seek(0)
        out["text"] = buf.read().decode("utf-8", "replace")
        buf.close()


def run_onnx(agent, onnx_path, providers, label, rows, warmup, threads, ref_choices):
    import numpy as np
    import onnxruntime as ort
    from laya.onnx_agent import _collate_items_numpy
    so = ort.SessionOptions()
    if threads:
        so.intra_op_num_threads = threads
    so.log_severity_level = 1  # INFO: the CoreML EP reports how many nodes it took
    t0 = time.perf_counter()
    with capture_native_stderr() as log:
        sess = ort.InferenceSession(onnx_path, so, providers=providers)
    load_s = time.perf_counter() - t0
    partition = [ln.strip() for ln in log["text"].splitlines()
                 if "number of nodes" in ln.lower() or "partitions supported" in ln.lower()]
    q_ids = list(QUESTIONS)
    internal = {qid: agent._to_internal(QUESTIONS[qid]) for qid in q_ids}
    keys = [k for k in QUESTIONS[QUESTION_ID]["criteria"]]

    def once(serialized):
        items = agent._encode_state(serialized, q_ids, internal)
        feed = _collate_items_numpy([items], agent.tok.pad_token_id)
        logits, _ = sess.run(["logits", "act_logits"], feed)
        return keys[int(np.argmax(logits[0][:len(keys)]))]

    for r in rows[:warmup]:
        once(r["serialized"])
    lat, choices = [], []
    for r in rows:
        t = time.perf_counter()
        choices.append(once(r["serialized"]))
        lat.append((time.perf_counter() - t) * 1000)
    agree = sum(a == b for a, b in zip(choices, ref_choices)) if ref_choices else None
    res = {"label": label, "providers": sess.get_providers(), "session_load_s": round(load_s, 1),
           "latency_ms": lat_stats(lat), "argmax_agree_with_torch_cpu": agree, "n": len(rows),
           "partition_log": partition[:6], "zero_shot": score(rows, choices)}
    print(f"\n== onnx {label} {sess.get_providers()[0]}: latency ms p50 {res['latency_ms']['p50']} "
          f"p90 {res['latency_ms']['p90']} max {res['latency_ms']['max']}  load {load_s:.1f}s  "
          f"argmax agree {agree}/{len(rows)}")
    for ln in partition[:3]:
        print("   " + ln)
    del sess
    gc.collect()
    return res


# ── main ────────────────────────────────────────────────────────────────────

def hardware():
    info = {"platform": platform.platform(), "machine": platform.machine(), "python": platform.python_version(),
            "processor": platform.processor(), "logical_cpus": os.cpu_count()}
    if sys.platform != "darwin":
        return info  # Windows: platform.processor() names the CPU; RAM is in the bench notes
    try:
        info["cpu"] = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True).stdout.strip()
        info["mem_bytes"] = int(subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True, text=True).stdout.strip())
        info["perf_cores"] = int(subprocess.run(["sysctl", "-n", "hw.perflevel0.physicalcpu"], capture_output=True, text=True).stdout.strip())
        info["eff_cores"] = int(subprocess.run(["sysctl", "-n", "hw.perflevel1.physicalcpu"], capture_output=True, text=True).stdout.strip())
    except Exception:
        pass
    return info


def git_commit():
    try:
        sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=REPO_ROOT, capture_output=True, text=True).stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain"], cwd=REPO_ROOT, capture_output=True, text=True).stdout.strip()
        return sha + ("-dirty" if dirty else "")
    except Exception:
        return None


def versions():
    import importlib.metadata as md
    return {p: md.version(p) for p in ("laya", "torch", "transformers", "onnx", "onnxruntime")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="convaiinnovations/laya")
    ap.add_argument("--states", help="eval states JSONL from emit_eval_states.mjs (default: run it)")
    ap.add_argument("--devices", nargs="+", default=["cpu", "mps"])
    ap.add_argument("--warmup", type=int, default=5)
    ap.add_argument("--threads", type=int, default=0, help="torch / onnxruntime CPU threads (0 = default)")
    ap.add_argument("--onnx-dir", default=os.path.join(ML_ROOT, "artifacts", "zero-shot-onnx"))
    ap.add_argument("--skip-onnx", action="store_true")
    ap.add_argument("--no-accelerator", action="store_true", help="skip the CoreML (macOS) / DirectML (Windows) EP run")
    ap.add_argument("--limit", type=int, default=0, help="first N candidates only (smoke runs)")
    ap.add_argument("--ledger", default=os.path.join(ML_ROOT, "results", "ledger.jsonl"))
    ap.add_argument("--runs-dir", default=os.path.join(ML_ROOT, "results", "runs"))
    args = ap.parse_args()

    import torch
    import laya
    # LAYA_THREADS is read only by laya-serve (laya/serve.py); the Agent API ignores it,
    # so threads are capped on torch directly.
    if args.threads:
        torch.set_num_threads(args.threads)

    rows, data_hash = load_states(args.states)
    if args.limit:
        rows = rows[:args.limit]
    run_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    report = {"id": run_id, "kind": "phase0-zero-shot-bench", "commit": git_commit(), "data": {
        "source": "judge-eval (TEST ONLY)", "states_sha256": data_hash, "n": len(rows)},
        "config": {"model": args.model, "devices": args.devices, "warmup": args.warmup,
                   "torch_threads": torch.get_num_threads(), "question_id": QUESTION_ID},
        "versions": versions(), "hardware": hardware(), "results": {}}

    preds_by = {}
    cpu_choices = None
    agent = None
    for device in args.devices:
        if device == "mps" and not torch.backends.mps.is_available():
            print("\n== mps not available, skipped ==")
            continue
        t0 = time.perf_counter()
        agent = laya.load(args.model, device=device)
        load_s = time.perf_counter() - t0
        if "tokens" not in report:
            rows, report["tokens"] = prepare(agent, rows)
            tk = report["tokens"]
            print(f"tokens: head {tk['head_tokens']}, state room {tk['state_room']}; raw states truncated "
                  f"{tk['raw_states_truncated']}/{tk['n']}, fitted {tk['fitted_states_truncated']}/{tk['n']}; "
                  f"fitted sequence tokens {tk['fitted_sequence_tokens']}")
        res, preds = run_torch(agent, device, rows, args.warmup)
        res["model_load_s"] = round(load_s, 1)
        if device == "mps":
            with contextlib.suppress(Exception):
                res["mps_driver_allocated_bytes"] = int(torch.mps.driver_allocated_memory())
        report["results"][f"torch_{device}"] = res
        preds_by[f"torch_{device}"] = preds
        if device == "cpu":
            cpu_choices = [p["choice"] for p in preds]
            if not args.skip_onnx:
                report["results"].update(onnx_phase(agent, args, rows, cpu_choices))
        del agent
        agent = None
        gc.collect()
        if device == "mps":
            with contextlib.suppress(Exception):
                torch.mps.empty_cache()

    if not args.skip_onnx and cpu_choices is None:
        agent = laya.load(args.model, device="cpu")
        if "tokens" not in report:
            rows, report["tokens"] = prepare(agent, rows)
        report["results"].update(onnx_phase(agent, args, rows, None))

    os.makedirs(args.runs_dir, exist_ok=True)
    with open(os.path.join(args.runs_dir, f"{run_id}.json"), "w") as f:
        json.dump({**report, "predictions": preds_by}, f, indent=1)
    ledger_line = {k: report[k] for k in ("id", "kind", "commit", "config", "versions", "hardware")}
    ledger_line["data_hash"] = data_hash
    ledger_line["tokens"] = report.get("tokens")
    ledger_line["metrics"] = {k: v.get("zero_shot", {}).get("overall") for k, v in report["results"].items()}
    ledger_line["latency_ms"] = {k: v.get("latency_ms") for k, v in report["results"].items()}
    ledger_line["command"] = " ".join([os.path.relpath(sys.executable, REPO_ROOT)] + sys.argv)
    os.makedirs(os.path.dirname(args.ledger), exist_ok=True)
    with open(args.ledger, "a") as f:
        f.write(json.dumps(ledger_line) + "\n")
    print(f"\nrun {run_id} -> {os.path.relpath(args.runs_dir, REPO_ROOT)}/{run_id}.json, ledger appended")


def onnx_phase(agent, args, rows, cpu_choices):
    import onnxruntime as ort
    sys.path.insert(0, os.path.join(ML_ROOT, "export"))
    from export_onnx import export
    fp32 = os.path.join(args.onnx_dir, "laya.onnx")
    int8 = os.path.join(args.onnx_dir, "laya.int8.onnx")
    out = {}
    if not (os.path.exists(fp32) and os.path.exists(int8)):
        try:
            export(args.model, args.onnx_dir, agent=agent)
        except Exception as e:  # recorded, not fatal: torch numbers still stand
            print(f"\n== ONNX export failed: {e!r}")
            return {"onnx_export_error": {"error": repr(e)}}
    out["onnx_int8_cpu"] = run_onnx(agent, int8, ["CPUExecutionProvider"], "int8", rows, args.warmup,
                                    args.threads, cpu_choices)
    out["onnx_fp32_cpu"] = run_onnx(agent, fp32, ["CPUExecutionProvider"], "fp32", rows, args.warmup,
                                    args.threads, cpu_choices)
    if args.no_accelerator:
        return out
    # One accelerated EP per OS: CoreML on macOS (pip onnxruntime), DirectML on Windows
    # (pip onnxruntime-directml). Each falls back to CPU for nodes it does not take.
    accelerators = {
        "CoreMLExecutionProvider": ("onnx_fp32_coreml", "fp32-coreml",
                                    {"ModelFormat": "MLProgram", "MLComputeUnits": "ALL"}),
        "DmlExecutionProvider": ("onnx_fp32_directml", "fp32-directml", {}),
    }
    available = ort.get_available_providers()
    ran = False
    for ep, (key, label, opts) in accelerators.items():
        if ep not in available:
            continue
        ran = True
        try:
            out[key] = run_onnx(agent, fp32, [(ep, opts), "CPUExecutionProvider"], label, rows,
                                args.warmup, args.threads, cpu_choices)
        except Exception as e:
            out[key] = {"error": repr(e)}
            print(f"\n== {ep} run failed: {e!r}")
    if not ran:
        out["onnx_accelerator"] = {"skipped": "no CoreML or DirectML EP in this onnxruntime build",
                                   "available": available}
        print("\n== no CoreML/DirectML EP in this onnxruntime build ==")
    return out


if __name__ == "__main__":
    main()
