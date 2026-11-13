"""Write golden fixtures for the TS<->Python state parity test.

    ml/auto-answer-decider/.venv/bin/python ml/auto-answer-decider/decider/make_state_fixtures.py

Output: electron/intelligence/autoAnswer/__tests__/decider-fixtures/state-parity.json
The token counter here is a stand-in (whitespace words), so the test checks the FIT
ALGORITHM and the SERIALIZATION bytes, independent of any tokenizer. Phase 3 adds
real-tokenizer fixtures. No judge-eval text is used: these strings are synthetic.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from decider.state import QUESTIONS, fit, serialize  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(REPO, "electron", "intelligence", "autoAnswer", "__tests__", "decider-fixtures", "state-parity.json")


def words(s):
    return len(s.split())


def base(**kw):
    f = {"mode": "technical-interview", "addressed_to": "none", "transcript_lagging": False,
         "context": [], "last_answered": None, "candidate": "can you walk me through it"}
    f.update(kw)
    return f


SERIALIZE = [
    base(),
    base(addressed_to="user", transcript_lagging=True, last_answered="design a rate limiter"),
    base(candidate='she said "fine" \\ then left', context=["OTHERS: tab\there", "USER: line\nbreak"]),
    base(candidate="café — naïve résumé über 你好 \U0001F600", mode="team-meet"),
    base(candidate="ctrl \u0001 \u001f \u007f end", context=["OTHERS/speaker_2:   sep  "]),
    base(candidate="…tail kept", last_answered="…earlier ask"),
    base(context=["OTHERS: a", "USER: b", "OTHERS/speaker_1: c"], addressed_to="other", mode="lecture"),
]

FIT = []
long_ctx = ["OTHERS: " + " ".join(f"w{i}_{j}" for j in range(12)) for i in range(6)]
FIT.append({"fields": base(context=long_ctx), "room": 40})
FIT.append({"fields": base(context=long_ctx, last_answered=" ".join(f"a{j}" for j in range(60))), "room": 30})
FIT.append({"fields": base(context=long_ctx[:2], candidate=" ".join(f"c{j}" for j in range(80))), "room": 25})
FIT.append({"fields": base(context=long_ctx), "room": 500})
FIT.append({"fields": base(candidate="one"), "room": 1})

doc = {
    "generated_by": "ml/auto-answer-decider/decider/make_state_fixtures.py",
    "question": QUESTIONS,
    "serialize": [{"fields": f, "serialized": serialize(f)} for f in SERIALIZE],
    "fit": [{**c, "counter": "whitespace-words", "result": fit(c["fields"], words, c["room"])} for c in FIT],
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(doc, fh, ensure_ascii=False, indent=1)
    fh.write("\n")
print(OUT)
