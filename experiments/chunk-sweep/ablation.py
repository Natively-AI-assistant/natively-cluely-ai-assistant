#!/usr/bin/env python3
"""Ablations that reproduce the tester's failure modes numerically.

Retrieval-only (metrics A/B/D — no generation), reusing the sweep's cache/API.

Configs:
  giant-16000      one-giant-chunk configuration (whole projects pack into
                   ~2-4 huge chunks) — the '63k single file' experience.
  npfx-<size>      chunks at the sweet-spot size but with the heading-path
                   prefix REPLACED by the leaf heading only — mirroring
                   production's `[Section N.N] <leaf>` prefixes
                   (ModeHybridRetriever.chunkText), to isolate what the
                   project-path prefix contributes.
  anon-<size>      sweet-spot chunks, but the 25 direct questions asked
                   WITHOUT the project name (the way an interviewer actually
                   phrases them mid-conversation) — the ASR-realistic case.
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from chunker import (chunk_markdown, chunk_production, est_tokens, parse_sections,  # noqa: E402
                     _context_prefix)
import sweep  # noqa: E402
from sweep import (EmbedCache, CACHE_DIR, embed_texts, retrieve, pack_budget,  # noqa: E402
                   norm, TOP_K)

SWEET = 300  # provisional sweet spot; retrieval saturated at every size <=1250


def leaf_prefix_chunks(markdown: str, target: int):
    """Same packing as chunk_markdown but with LEAF-ONLY heading prefixes."""
    full = chunk_markdown(markdown, target)
    out = []
    for c in full:
        def leaf_only(m):
            path = m.group(1)
            leaf = path.split(">")[-1].strip()
            return f"[context: {leaf}]"
        out.append(re.sub(r"\[context: ([^\]]+)\]", leaf_only, c))
    return out


def anonymize(question: str, project: str) -> str:
    q = question.replace(f"the {project} project", "that project")
    q = q.replace(f"the {project} integration", "that integration")
    q = q.replace(f"{project}", "that project")
    return q


def eval_config(label, chunks, direct, followups, qtexts=None):
    dcache = EmbedCache(CACHE_DIR / f"abl_{label}.json")
    vecs = embed_texts(chunks, "RETRIEVAL_DOCUMENT", dcache)
    qcache = EmbedCache(CACHE_DIR / "queries.json")

    questions = qtexts if qtexts is not None else [n["question"] for n in direct]
    qvecs = embed_texts(questions, "RETRIEVAL_QUERY", qcache)
    recall = survival = 0
    misses = []
    for n, qv in zip(direct, qvecs):
        order = retrieve(qv, vecs, TOP_K)
        text = norm("\n".join(chunks[i] for i in order))
        r = norm(n["answer"]) in text
        s = norm(n["answer"]) in norm(pack_budget(chunks, order))
        recall += r
        survival += s
        if not (r and s):
            misses.append(f"{n['project']}/{n['kind']} r={int(r)} s={int(s)}")

    plain = anchored = 0
    plain_vecs = embed_texts([f["question"] for f in followups], "RETRIEVAL_QUERY", qcache)
    anch_vecs = embed_texts([f"[{f['project']}] {f['question']}" for f in followups],
                            "RETRIEVAL_QUERY", qcache)
    for f, pv, av in zip(followups, plain_vecs, anch_vecs):
        pt = norm("\n".join(chunks[i] for i in retrieve(pv, vecs, TOP_K)))
        at = norm("\n".join(chunks[i] for i in retrieve(av, vecs, TOP_K)))
        plain += norm(f["answer"]) in pt
        anchored += norm(f["answer"]) in at

    row = {"config": label, "chunks": len(chunks), "recall_at_12": recall,
           "budget_survival": survival, "continuity_plain": plain,
           "continuity_anchored": anchored, "misses": misses}
    print(f"{label:>12}: chunks={len(chunks):>3} recall={recall}/25 "
          f"survival={survival}/25 cont plain={plain}/5 anchored={anchored}/5")
    if misses:
        print("              misses:", "; ".join(misses))
    return row


def main():
    corpus = (HERE / "corpus" / "combined_reference.md").read_text()
    needles = json.loads((HERE / "corpus" / "needles.json").read_text())
    direct, followups = needles["direct"], needles["followups"]

    rows = []
    giant = chunk_markdown(corpus, 16000)
    print(f"giant config: {len(giant)} chunks, sizes {[est_tokens(c) for c in giant]}")
    rows.append(eval_config("giant-16000", giant, direct, followups))

    sweet_chunks = chunk_markdown(corpus, SWEET)
    rows.append(eval_config(f"sweet-{SWEET}", sweet_chunks, direct, followups))

    rows.append(eval_config(f"npfx-{SWEET}", leaf_prefix_chunks(corpus, SWEET),
                            direct, followups))

    anon_qs = [anonymize(n["question"], n["project"]) for n in direct]
    rows.append(eval_config(f"anon-{SWEET}", sweet_chunks, direct, followups,
                            qtexts=anon_qs))
    # Anonymous questions against leaf-only prefixes = the closest numeric
    # analogue of production's live-audio + leaf-heading situation.
    rows.append(eval_config(f"anon-npfx-{SWEET}", leaf_prefix_chunks(corpus, SWEET),
                            direct, followups, qtexts=anon_qs))

    # ── T9 BEFORE/AFTER (2026-08-28) ─────────────────────────────────────────
    # The shipped chunker, ported into chunker.chunk_production, run over the
    # SAME corpus, embeddings and scorer as the rows above. `prod` is the
    # after-number for `sweet-300`; `prod-npfx` strips the heading paths so the
    # A/B isolates the identity fix from the boundary change.
    prod_chunks = chunk_production(corpus)
    print(f"production config: {len(prod_chunks)} chunks, "
          f"median {sorted(est_tokens(c) for c in prod_chunks)[len(prod_chunks) // 2]} tokens")
    rows.append(eval_config("prod", prod_chunks, direct, followups))
    rows.append(eval_config("prod-anon", prod_chunks, direct, followups, qtexts=anon_qs))
    prod_leaf = []
    for c in prod_chunks:
        prod_leaf.append(re.sub(r"\[context: ([^\]]+)\]",
                                lambda m: f"[context: {m.group(1).split('>')[-1].strip()}]", c))
    rows.append(eval_config("prod-npfx", prod_leaf, direct, followups))
    rows.append(eval_config("prod-npfx-anon", prod_leaf, direct, followups, qtexts=anon_qs))

    (HERE / "ablation_results.json").write_text(json.dumps(rows, indent=2))
    print(f"\nwritten to {HERE / 'ablation_results.json'}")


if __name__ == "__main__":
    main()
