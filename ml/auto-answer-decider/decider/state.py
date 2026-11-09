"""Python twin of electron/intelligence/autoAnswer/decider/deciderState.ts.

The decider's question and state are MODEL INPUT: training, the local ONNX
runtime and the hosted endpoint must see identical bytes. The state's FIELDS
(including `addressed_to`, from the judge's name helpers) are built in
TypeScript; this module only serializes and fits them, and must match
`serializeDeciderState` / `fitDeciderState` exactly. Change one, change both,
retrain.
"""
import json
import re
from typing import Callable, Dict, Any

QUESTION_ID = "respond"

# Byte-identical to campaign prompt §4 and DECIDER_QUESTION in deciderState.ts.
QUESTIONS = {
    "respond": {
        "type": "choice",
        "instructions": "An assistant drafts answers for the USER in a live meeting. OTHERS is the meeting audio and may hold several voices. Does the latest speech in `candidate` contain a finished question or task aimed at the USER that they must answer or start now and that is not already in `last_answered`?",
        "criteria": {
            "answer": "a finished question or task for the USER, including short or yes/no ones and declarative tasks",
            "silent": "not an ask, aimed at someone else, rhetorical or self-answered, logistics, permission, deferral, or already answered",
            "wait": "an unfinished fragment, or a structure announced but not yet delivered",
        },
    }
}

LABELS = ["answer", "silent", "wait"]
FIELD_ORDER = ["mode", "addressed_to", "transcript_lagging", "context", "last_answered", "candidate"]
ANSWERED_SHRUNK_CHAR_CAP = 120


def keep_tail(text: str, max_chars: int) -> str:
    t = str(text or "")
    return t if len(t) <= max_chars else "…" + t[len(t) - max_chars:]


def serialize(fields: Dict[str, Any]) -> str:
    """json.dumps in the fixed field order; the TS side reproduces these bytes."""
    return json.dumps({k: fields[k] for k in FIELD_ORDER}, ensure_ascii=False)


def fit(fields: Dict[str, Any], count_tokens: Callable[[str], int], room: int) -> Dict[str, Any]:
    """Mirror of fitDeciderState: oldest context turns, then last_answered, then candidate head."""
    f = dict(fields)
    f["context"] = list(fields["context"])
    dropped_turns, answered_shrunk, dropped_words = 0, False, 0

    def fits() -> bool:
        return count_tokens(serialize(f)) <= room

    while not fits() and f["context"]:
        f["context"].pop(0)
        dropped_turns += 1
    la = f.get("last_answered")
    if not fits() and la is not None and len(la) > ANSWERED_SHRUNK_CHAR_CAP + 1:
        f["last_answered"] = keep_tail(re.sub(r"^…", "", la), ANSWERED_SHRUNK_CHAR_CAP)
        answered_shrunk = True
    if not fits():
        words = [w for w in re.split(r"\s+", re.sub(r"^…", "", f["candidate"])) if w]
        while not fits() and len(words) > 1:
            words.pop(0)
            dropped_words += 1
            f["candidate"] = "…" + " ".join(words)
    return {
        "serialized": serialize(f),
        "fields": f,
        "droppedTurns": dropped_turns,
        "answeredShrunk": answered_shrunk,
        "droppedCandidateWords": dropped_words,
    }
