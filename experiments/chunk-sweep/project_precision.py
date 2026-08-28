"""PROJECT PRECISION — the only continuity metric that discriminates.

Containment continuity saturates: top-12 over a five-project corpus retrieves
ALL FIVE projects' Monitoring sections, so "did the answer appear anywhere in
the retrieved set" is 5/5 for every configuration ever measured, including the
worst one. Recall@k saturates the same way (25/25 at every chunk size up to
1250, AND in the giant-chunk config where only 5 of 25 facts survived packing).

What actually separates a follow-up that lands on the right project from one
that does not is:

    precision@12          — what fraction of the retrieved chunks belong to the
                            project the follow-up is about (0.20 is chance with
                            five equal projects)
    top1_right_project    — did the FIRST chunk belong to it
    answer_rank           — where the chunk carrying the answer ranked

This reproduces the measurement recorded in continuity_precision.json for the
T9 before/after. The original ad-hoc script that produced that file is gone;
this is its replacement, kept so the number can be recomputed rather than
quoted.

Usage:  python3 project_precision.py            (writes continuity_precision_T9.json)
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from chunker import chunk_markdown, chunk_production  # noqa: E402
from sweep import EmbedCache, CACHE_DIR, embed_texts, retrieve, norm, TOP_K  # noqa: E402

SWEET = 300


def leaf_only(chunks):
    """Strip the heading ANCESTOR path back to its leaf — production before T9."""
    return [re.sub(r"\[context: ([^\]]+)\]",
                   lambda m: f"[context: {m.group(1).split('>')[-1].strip()}]", c)
            for c in chunks]


def owner_of(chunk: str, projects) -> str:
    """Which project a chunk belongs to, by name occurrence in its text."""
    for p in projects:
        if norm(p) in norm(chunk):
            return p
    return "?"


def measure(label, chunks, followups, projects):
    cache = EmbedCache(CACHE_DIR / f"pp_{label}.json")
    vecs = embed_texts(chunks, "RETRIEVAL_DOCUMENT", cache)
    qcache = EmbedCache(CACHE_DIR / "queries.json")

    rows = []
    for f in followups:
        project, answer = f["project"], f["answer"]
        # PLAIN is the bare follow-up as spoken ("...on that project?"), the
        # shape that has no entity of its own. ANCHORED is T10's rewrite: the
        # active entity prepended to the RETRIEVAL query only.
        variants = {
            "plain": f["question"],
            "anchored": f"{project} {f['question']}",
            # What the CURRENT referent resolver produces: the entity appended
            # in a parenthetical rather than prepended. If this scores like
            # `anchored`, T10 has nothing to add for a resolved follow-up and
            # its value is confined to the turns resolution never fires on.
            "resolved": f"{f['question']} (referring to: {project})",
            # The ASR-LOWERCASE fallback. When the entity arrives lowercased,
            # `activeTopic` stays empty (capitalisation gate) and the resolver
            # falls back to ANCHORED_TO_PREVIOUS_QUESTION, which pastes the
            # WHOLE previous question into the retrieval query. The entity is in
            # there — but so is the previous question's own topic, which pulls
            # retrieval toward the section already answered.
            "prevq": (f"{f['question']} (follow-up to: \"how did you handle "
                      f"idempotency on {project.lower()}\")"),
        }
        qvecs = embed_texts(list(variants.values()), "RETRIEVAL_QUERY", qcache)
        for (mode, _q), qv in zip(variants.items(), qvecs):
            hits = retrieve(qv, vecs, k=TOP_K)
            texts = [chunks[i] for i in hits]
            owners = [owner_of(t, projects) for t in texts]
            right = sum(1 for o in owners if o == project)
            rank = next((i + 1 for i, t in enumerate(texts) if norm(answer) in norm(t)), None)
            rows.append({
                "project": project,
                "mode": mode,
                "precision": round(right / max(1, len(texts)), 2),
                "top1_right_project": owners[0] == project if owners else False,
                "answer_rank": rank,
            })
    return rows


def summarise(label, rows):
    for mode in ("plain", "anchored", "resolved", "prevq"):
        sub = [r for r in rows if r["mode"] == mode]
        if not sub:
            continue
        prec = sum(r["precision"] for r in sub) / len(sub)
        top1 = sum(1 for r in sub if r["top1_right_project"])
        ranks = [r["answer_rank"] for r in sub if r["answer_rank"]]
        print(f"  {label:>16} {mode:<9} precision@12={prec:.2f}  "
              f"top1_right={top1}/{len(sub)}  median_answer_rank="
              f"{sorted(ranks)[len(ranks)//2] if ranks else '-'}")


def main():
    corpus = (HERE / "corpus" / "combined_reference.md").read_text()
    needles = json.loads((HERE / "corpus" / "needles.json").read_text())
    followups = needles["followups"]
    projects = sorted({n["project"] for n in needles["direct"]})

    configs = {
        # BEFORE — the sweep chunker with full paths, and with leaf-only
        # prefixes (what production actually shipped).
        f"sweet-{SWEET}": chunk_markdown(corpus, SWEET),
        f"npfx-{SWEET}": leaf_only(chunk_markdown(corpus, SWEET)),
        # AFTER — the shipped T9 chunker, and the same minus its heading paths
        # so the A/B isolates the identity fix from the boundary change.
        "prod": chunk_production(corpus),
        "prod-npfx": leaf_only(chunk_production(corpus)),
    }

    out = {}
    print("PROJECT PRECISION (five projects; 0.20 = chance)\n")
    for label, chunks in configs.items():
        rows = measure(label, chunks, followups, projects)
        out[label] = rows
        summarise(label, rows)

    (HERE / "continuity_precision_T9.json").write_text(json.dumps(out, indent=2))
    print(f"\nwritten to {HERE / 'continuity_precision_T9.json'}")


if __name__ == "__main__":
    main()
