#!/usr/bin/env python3
"""
scripts/pi-score.py — deterministic case-sensitive scorer for the PI round-2
replay. Matches replay-results.json answers against the evin-39.json fixture's
mustInclude / mustNotInclude annotations.

Case-sensitive substring match (avoids the earlier round's false positives from
case-folded regex matching "no" inside "note", etc.). Reports per-question
pass/fail plus the acceptance-gate aggregates: no-op count, JD-contamination
count, fabrication signals, and correctness.

Usage:
    python3 scripts/pi-score.py debug-artifacts/pi-benchmark/round2-01/replay-results.json
"""
import json
import re
import sys
import os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURE = os.path.join(REPO, 'test-fixtures', 'pi-benchmark', 'evin-39.json')

NOOP_MARKERS = [
    "Nothing actionable right now",
    "What would you like help with",
]
# JD-fit families where target-job pivot language is legitimate.
JD_OK_FAMILIES = {"jd_fit", "gap", "behavioral", "negotiation"}


def load(path):
    with open(path) as f:
        return json.load(f)


def main():
    if len(sys.argv) < 2:
        print("usage: pi-score.py <replay-results.json>", file=sys.stderr)
        sys.exit(1)
    replay = load(sys.argv[1])
    fixture = load(FIXTURE)
    cases = {c['id']: c for c in (fixture.get('cases', fixture))}
    results = replay['results']

    rows = []
    noop = 0
    fab = 0
    correct = 0
    for r in results:
        cid = r.get('id')
        c = cases.get(cid)
        ans = (r.get('answer') or '')
        fam = (c or {}).get('expectFamily', '?')
        mi = (c or {}).get('mustInclude', [])
        mn = (c or {}).get('mustNotInclude', [])

        # fixture entries are regex patterns (e.g. "sub-80ms|80ms", "Jun.*Aug",
        # "React$"). Case-sensitive search (no IGNORECASE) to preserve the
        # earlier round's intent of catching case-wrong fabrication.
        def hit(pat):
            try:
                return re.search(pat, ans) is not None
            except re.error:
                return pat in ans
        missing = [s for s in mi if not hit(s)]
        present_bad = [s for s in mn if hit(s)]
        is_noop = any(m in ans for m in NOOP_MARKERS)
        if is_noop:
            noop += 1
        ok = (not missing) and (not present_bad) and ans.strip() != ''
        if ok:
            correct += 1
        rows.append({
            'id': cid, 'fam': fam, 'via': r.get('via'),
            'type': r.get('answerType'),
            'ok': ok, 'missing': missing, 'bad': present_bad,
            'noop': is_noop, 'len': len(ans),
            'ms': r.get('firstUsefulMs'),
            'q': (c or {}).get('question', r.get('question', ''))[:55],
        })

    print(f"=== PI round-2 score: {sys.argv[1]} ===")
    print(f"model={replay['meta'].get('model')} n={len(results)}\n")
    for row in rows:
        flag = 'PASS' if row['ok'] else 'FAIL'
        extra = ''
        if row['missing']:
            extra += f" missing={row['missing']}"
        if row['bad']:
            extra += f" BAD={row['bad']}"
        if row['noop']:
            extra += ' [NO-OP]'
        print(f"[{flag}] {row['id']} {row['fam']:10s} via={str(row['via']):9s} "
              f"{row['len']:4d}c {extra}")
        if not row['ok']:
            print(f"        Q: {row['q']}")

    print(f"\n--- ACCEPTANCE GATE ---")
    print(f"correct:   {correct}/{len(results)}  (gate: >=37/39)")
    print(f"no-op:     {noop}            (gate: 0)")
    fails = [r for r in rows if not r['ok']]
    print(f"failures:  {len(fails)} -> {[r['id'] for r in fails]}")


if __name__ == '__main__':
    main()
