#!/usr/bin/env python3
"""Chunk-size sweep: embed, retrieve, budget-pack, generate, score.

Metrics per chunk size in SIZES:
  A recall@12        answer substring anywhere in the retrieved chunks
  B budget-survival  answer substring survives greedy packing into a 3600-token
                     evidence budget (last chunk truncated, mirroring production)
  C end-to-end       model answers strictly from packed evidence; counts correct
                     answers and false refusals (refusal while fact WAS packed)
  D continuity       follow-ups retrieved verbatim vs project-name-anchored

Standalone: requests + python-dotenv only. Keys from repo-root .env.
Embeddings: Gemini text-embedding-004 (RETRIEVAL_DOCUMENT / RETRIEVAL_QUERY).
Generation: gemini-2.5-flash (or $GEMINI_MODEL); deepseek-v4-flash if key set.
Embeddings are cached to disk per size so reruns are cheap.
"""
import hashlib
import json
import math
import os
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
load_dotenv(REPO_ROOT / ".env")

sys.path.insert(0, str(HERE))
from chunker import chunk_markdown, est_tokens  # noqa: E402

GEMINI_KEY = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
DEEPSEEK_KEY = os.environ.get("DEEPSEEK_API_KEY")
GEN_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
# text-embedding-004 was retired (404 as of 2026-08); gemini-embedding-2 is the
# live embedding model on this key (also what Natively production defaults to).
EMBED_MODEL = "gemini-embedding-2"
EMBED_DIMS = 768
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"

SIZES = [150, 300, 512, 800, 1250, 2000, 2500]
TOP_K = 12
EVIDENCE_BUDGET_TOKENS = 3600
EMBED_BATCH = 100
BATCH_SLEEP_S = 1.0
GEN_SLEEP_S = 0.35

REFUSAL = "I could not find that in the retrieved sections"

CACHE_DIR = HERE / "cache"
CACHE_DIR.mkdir(exist_ok=True)

session = requests.Session()


def _post_json(url, payload, headers=None, tries=5):
    for attempt in range(1, tries + 1):
        try:
            r = session.post(url, json=payload, headers=headers or {}, timeout=120)
            if r.status_code == 429 or r.status_code >= 500:
                wait = min(30, 2 ** attempt)
                print(f"    [http {r.status_code}] retrying in {wait}s ...", flush=True)
                time.sleep(wait)
                continue
            r.raise_for_status()
            return r.json()
        except requests.RequestException as e:
            if attempt == tries:
                raise
            wait = min(30, 2 ** attempt)
            print(f"    [net err: {e}] retrying in {wait}s ...", flush=True)
            time.sleep(wait)
    raise RuntimeError("unreachable")


# ── Embeddings (cached) ─────────────────────────────────────────────────────

def _cache_key(text: str, task: str) -> str:
    return hashlib.md5(f"{EMBED_MODEL}::{task}::{text}".encode()).hexdigest()


class EmbedCache:
    def __init__(self, path: Path):
        self.path = path
        self.data = {}
        if path.exists():
            try:
                self.data = json.loads(path.read_text())
            except Exception:
                self.data = {}

    def save(self):
        self.path.write_text(json.dumps(self.data))


def embed_texts(texts, task, cache: EmbedCache):
    """Batch-embed with caching. task: RETRIEVAL_DOCUMENT | RETRIEVAL_QUERY."""
    out = [None] * len(texts)
    missing = []
    for i, t in enumerate(texts):
        k = _cache_key(t, task)
        if k in cache.data:
            out[i] = cache.data[k]
        else:
            missing.append(i)
    # gemini-embedding-2 exposes embedContent only (no sync batch endpoint), so
    # embed serially in polite bursts of <=EMBED_BATCH, sleeping between bursts.
    url = f"{GEMINI_BASE}/models/{EMBED_MODEL}:embedContent?key={GEMINI_KEY}"
    for n, i in enumerate(missing, 1):
        payload = {
            "model": f"models/{EMBED_MODEL}",
            "content": {"parts": [{"text": texts[i]}]},
            "taskType": task,
            "outputDimensionality": EMBED_DIMS,
        }
        data = _post_json(url, payload)
        v = data["embedding"]["values"]
        out[i] = v
        cache.data[_cache_key(texts[i], task)] = v
        if n % 25 == 0 or n == len(missing):
            cache.save()
            print(f"    embedded {n}/{len(missing)} new ({task})", flush=True)
        if n % EMBED_BATCH == 0 and n < len(missing):
            time.sleep(BATCH_SLEEP_S)
        else:
            time.sleep(0.06)
    return out


def cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


# ── Retrieval + packing ─────────────────────────────────────────────────────

def retrieve(query_vec, chunk_vecs, k=TOP_K):
    scored = sorted(range(len(chunk_vecs)),
                    key=lambda i: cosine(query_vec, chunk_vecs[i]), reverse=True)
    return scored[:k]


def pack_budget(chunks, order, budget_tokens=EVIDENCE_BUDGET_TOKENS):
    """Greedy pack retrieved chunks; truncate the LAST chunk to fit (mirrors the
    production-shaped packing this experiment was asked to model)."""
    packed = []
    used = 0
    for i in order:
        text = chunks[i]
        t = est_tokens(text)
        if used + t <= budget_tokens:
            packed.append(text)
            used += t
        else:
            remaining = budget_tokens - used
            if remaining > 20:
                packed.append(text[: remaining * 4])
            break
    return "\n\n---\n\n".join(packed)


# ── Generation ──────────────────────────────────────────────────────────────

SYSTEM_PROMPT = (
    "Answer the question strictly and only from the provided document excerpts. "
    "Quote values exactly as written. If the answer is not present in the "
    f'excerpts, reply with exactly: "{REFUSAL}"'
)


def gen_gemini(question, evidence):
    url = f"{GEMINI_BASE}/models/{GEN_MODEL}:generateContent?key={GEMINI_KEY}"
    payload = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{
            "text": f"EXCERPTS:\n{evidence}\n\nQUESTION: {question}"}]}],
        "generationConfig": {"temperature": 0, "maxOutputTokens": 4096},
    }
    data = _post_json(url, payload)
    try:
        parts = data["candidates"][0]["content"]["parts"]
        return "".join(p.get("text", "") for p in parts).strip()
    except (KeyError, IndexError):
        return ""


def gen_deepseek(question, evidence):
    url = "https://api.deepseek.com/chat/completions"
    payload = {
        "model": "deepseek-v4-flash",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"EXCERPTS:\n{evidence}\n\nQUESTION: {question}"},
        ],
        "temperature": 0,
        "max_tokens": 400,
    }
    data = _post_json(url, payload, headers={"Authorization": f"Bearer {DEEPSEEK_KEY}"})
    return (data["choices"][0]["message"]["content"] or "").strip()


def norm(s: str) -> str:
    return " ".join(s.lower().split())


def value_tokens(expected: str, kind: str):
    """The minimal distinguishing values a correct answer must contain.

    Metric A/B use the exact corpus substring (retrieval is verbatim text), but
    a model legitimately answers 'p95 latency SLO of 450 ms' as '450 ms' — so
    e2e correctness checks the value(s), not the full corpus phrasing.
    """
    import re as _re
    if kind == "p95 SLO":
        m = _re.search(r"(\d+\s*ms)", expected)
        return [m.group(1)] if m else [expected]
    if kind == "retry policy":
        nums = _re.findall(r"\d+(?:\.\d+)?", expected)
        return nums  # attempt count + backoff multiplier
    return [expected]


def answer_correct(model_answer: str, expected: str, kind: str = "") -> bool:
    a = norm(model_answer)
    if norm(expected) in a:
        return True
    toks = value_tokens(expected, kind)
    return bool(toks) and all(norm(t) in a for t in toks)


def is_refusal(model_answer: str) -> bool:
    return REFUSAL.lower() in model_answer.lower()


# ── Main sweep ──────────────────────────────────────────────────────────────

def run():
    if not GEMINI_KEY:
        sys.exit("GEMINI_API_KEY missing from repo-root .env")
    corpus = (HERE / "corpus" / "combined_reference.md").read_text()
    needles = json.loads((HERE / "corpus" / "needles.json").read_text())
    direct = needles["direct"]
    followups = needles["followups"]

    gen_models = [("gemini:" + GEN_MODEL, gen_gemini)]
    if DEEPSEEK_KEY:
        gen_models.append(("deepseek:deepseek-v4-flash", gen_deepseek))

    qcache = EmbedCache(CACHE_DIR / "queries.json")
    all_rows = []

    for size in SIZES:
        print(f"\n=== chunk size target: {size} tokens ===", flush=True)
        chunks = chunk_markdown(corpus, size)
        sizes_tok = [est_tokens(c) for c in chunks]
        print(f"  {len(chunks)} chunks (median ~{sorted(sizes_tok)[len(sizes_tok)//2]} tok, "
              f"max {max(sizes_tok)} tok)", flush=True)

        dcache = EmbedCache(CACHE_DIR / f"docs_{size}.json")
        chunk_vecs = embed_texts(chunks, "RETRIEVAL_DOCUMENT", dcache)

        row = {"size": size, "chunks": len(chunks),
               "recall_at_12": 0, "budget_survival": 0,
               "e2e": {}, "continuity_plain": 0, "continuity_anchored": 0,
               "per_question": []}

        # ── A/B/C over the 25 direct needles ────────────────────────────
        questions = [n["question"] for n in direct]
        qvecs = embed_texts(questions, "RETRIEVAL_QUERY", qcache)
        e2e_stats = {name: {"correct": 0, "refusals": 0, "false_refusals": 0}
                     for name, _ in gen_models}

        for n, qv in zip(direct, qvecs):
            order = retrieve(qv, chunk_vecs)
            retrieved_text = "\n\n".join(chunks[i] for i in order)
            recall = norm(n["answer"]) in norm(retrieved_text)
            packed = pack_budget(chunks, order)
            survived = norm(n["answer"]) in norm(packed)
            row["recall_at_12"] += recall
            row["budget_survival"] += survived

            qrec = {"project": n["project"], "kind": n["kind"],
                    "recall": recall, "survived": survived, "models": {}}
            for name, fn in gen_models:
                try:
                    ans = fn(n["question"], packed)
                except Exception as e:
                    print(f"    [gen error {name}: {e}]", flush=True)
                    ans = ""
                time.sleep(GEN_SLEEP_S)
                correct = answer_correct(ans, n["answer"], n["kind"])
                refused = is_refusal(ans)
                false_refusal = refused and survived
                e2e_stats[name]["correct"] += correct
                e2e_stats[name]["refusals"] += refused
                e2e_stats[name]["false_refusals"] += false_refusal
                qrec["models"][name] = {"correct": correct, "refused": refused,
                                        "false_refusal": false_refusal,
                                        "answer_head": ans[:160]}
            row["per_question"].append(qrec)
            print(f"  [{n['project']} / {n['kind']}] recall={int(recall)} "
                  f"survived={int(survived)}", flush=True)

        row["e2e"] = e2e_stats

        # ── D: continuity, plain vs entity-anchored ─────────────────────
        plain_qs = [f["question"] for f in followups]
        anchored_qs = [f"[{f['project']}] {f['question']}" for f in followups]
        plain_vecs = embed_texts(plain_qs, "RETRIEVAL_QUERY", qcache)
        anchored_vecs = embed_texts(anchored_qs, "RETRIEVAL_QUERY", qcache)
        for f, pv, av in zip(followups, plain_vecs, anchored_vecs):
            for label, vec in (("continuity_plain", pv), ("continuity_anchored", av)):
                order = retrieve(vec, chunk_vecs)
                text = norm("\n".join(chunks[i] for i in order))
                if norm(f["answer"]) in text:
                    row[label] += 1

        n_direct, n_fu = len(direct), len(followups)
        print(f"  recall@12 {row['recall_at_12']}/{n_direct} | "
              f"budget-survival {row['budget_survival']}/{n_direct} | "
              f"continuity plain {row['continuity_plain']}/{n_fu} "
              f"anchored {row['continuity_anchored']}/{n_fu}", flush=True)
        for name, st in e2e_stats.items():
            print(f"  e2e[{name}]: correct {st['correct']}/{n_direct}, "
                  f"refusals {st['refusals']} (false: {st['false_refusals']})", flush=True)

        all_rows.append(row)
        (HERE / "results.json").write_text(json.dumps(all_rows, indent=2))

    # ── Final table ─────────────────────────────────────────────────────
    print("\n\n================ SWEEP RESULTS ================")
    hdr = f"{'size':>5} {'chunks':>6} {'recall@12':>9} {'survival':>8} " \
          f"{'cont.plain':>10} {'cont.anch':>9}"
    for name, _ in gen_models:
        hdr += f" | {name} correct/refusals(false)"
    print(hdr)
    for r in all_rows:
        line = (f"{r['size']:>5} {r['chunks']:>6} "
                f"{r['recall_at_12']:>7}/25 {r['budget_survival']:>6}/25 "
                f"{r['continuity_plain']:>8}/5 {r['continuity_anchored']:>7}/5")
        for name, _ in gen_models:
            st = r["e2e"][name]
            line += f" | {st['correct']}/25 {st['refusals']}({st['false_refusals']})"
        print(line)
    print(f"\nresults written to {HERE / 'results.json'}")


if __name__ == "__main__":
    run()
