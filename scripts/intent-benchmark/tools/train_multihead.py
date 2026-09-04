#!/usr/bin/env python3
"""
Fine-tune a multi-head intent router: one shared encoder, one classification
head per IntentFrame axis.

WHY MULTI-HEAD RATHER THAN ONE MODEL PER AXIS

The campaign's central claim is that today's single flat label is carrying
several independent decisions at once. The fix is not six separate models —
that would be six model loads, six ONNX sessions and six worker slots on a
latency budget of 25ms. It is ONE encoder pass feeding several small heads,
which costs one forward pass total regardless of how many axes are asked for.

That contrast is the point of measuring it against the NLI baseline, which
needs one forward pass PER LABEL: 8 passes in production's configuration and 44
for the full frame. This architecture needs 1.

MODE AND CHANNEL ARE INPUTS, NOT AFTERTHOUGHTS

The Phase 1 audit found the shipped classifier sees only the current utterance:
no mode, no channel, no history. Two of the corpus's hardest cases are
unresolvable without them — the same words are `called_on_for_status` in Team
Meet and `discussion_noise` when addressed to someone else, and Recruiting
inverts who the user is. So mode and channel are prepended as text, which lets
the encoder attend to them rather than requiring a separate feature path.

Trains on the TRAIN split only. The held-out split is never touched here.
"""
import argparse, json, os, random
from collections import Counter
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from transformers import AutoTokenizer, AutoModel

# `legacy_intent` is a head like any other so this candidate is directly
# comparable to the NLI runs on the control taxonomy. Without it the trained
# model shows 0.0 in the legacy column purely because it was never asked, which
# reads as a failure rather than an omission.
AXES = ["needs_response", "dialogue_act", "task", "answer_form", "grounding", "mode_intent", "legacy_intent"]


def build_text(row):
    """Mode and channel as text, then a little history, then the utterance."""
    hist = " ".join(row.get("history", [])[-2:])
    return (
        f"[mode] {row.get('custom_mode_key') or row['mode']} "
        f"[channel] {row['channel']} "
        f"[files] {'yes' if row.get('mode_has_reference_files') else 'no'} "
        f"[history] {hist} "
        f"[turn] {row['input']}"
    )


class Rows(Dataset):
    def __init__(self, rows, tok, label_maps, max_len=192):
        self.rows, self.tok, self.maps, self.max_len = rows, tok, label_maps, max_len

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, i):
        r = self.rows[i]
        enc = self.tok(build_text(r), truncation=True, max_length=self.max_len, padding="max_length", return_tensors="pt")
        item = {k: v.squeeze(0) for k, v in enc.items()}
        for axis in AXES:
            v = r.get("legacy_intent") if axis == "legacy_intent" else r["labels"].get(axis)
            # -100 is torch's ignore_index: a row missing an axis contributes no
            # gradient to that head rather than being taught a wrong answer.
            item[f"y_{axis}"] = torch.tensor(self.maps[axis].get(v, -100), dtype=torch.long)
        return item


class MultiHead(nn.Module):
    def __init__(self, encoder_name, sizes, dropout=0.1):
        super().__init__()
        self.encoder = AutoModel.from_pretrained(encoder_name)
        h = self.encoder.config.hidden_size
        self.drop = nn.Dropout(dropout)
        self.heads = nn.ModuleDict({a: nn.Linear(h, n) for a, n in sizes.items()})

    def forward(self, input_ids, attention_mask, **_):
        out = self.encoder(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state
        # Mean-pool over real tokens only. Using [CLS] on a model that was not
        # pretrained with a sentence-level objective throws away most of the
        # signal on short turns, and most turns here are short.
        mask = attention_mask.unsqueeze(-1).float()
        pooled = (out * mask).sum(1) / mask.sum(1).clamp(min=1e-9)
        pooled = self.drop(pooled)
        return {a: head(pooled) for a, head in self.heads.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--encoder", default="sentence-transformers/all-MiniLM-L6-v2")
    ap.add_argument("--out", required=True)
    ap.add_argument("--epochs", type=int, default=6)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--lr", type=float, default=3e-5)
    ap.add_argument("--seed", type=int, default=17)
    args = ap.parse_args()

    random.seed(args.seed); np.random.seed(args.seed); torch.manual_seed(args.seed)

    rows = [json.loads(l) for l in open(args.data) if l.strip()]
    train = [r for r in rows if r.get("split") == "train"]
    holdout = [r for r in rows if r.get("split") == "holdout"]
    print(f"[train] {len(train)} train rows, {len(holdout)} held out (never used here)")

    label_maps, sizes = {}, {}
    for axis in AXES:
        get = (lambda r: r.get("legacy_intent")) if axis == "legacy_intent" else (lambda r: r["labels"].get(axis))
        vals = sorted({get(r) for r in train if get(r) is not None})
        label_maps[axis] = {v: i for i, v in enumerate(vals)}
        sizes[axis] = len(vals)
        print(f"[train] {axis:16} {len(vals)} classes")

    tok = AutoTokenizer.from_pretrained(args.encoder)
    model = MultiHead(args.encoder, sizes)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model.to(device)
    print(f"[train] device {device}")

    dl = DataLoader(Rows(train, tok, label_maps), batch_size=args.batch, shuffle=True)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr)
    # Class imbalance is severe and deliberate (needs_response=no is 43% of the
    # corpus). Unweighted loss would let a head win by always predicting the
    # majority, which is exactly the failure the LLM labeller made on `voice`.
    losses = {}
    for axis in AXES:
        getc = (lambda r: r.get("legacy_intent")) if axis == "legacy_intent" else (lambda r: r["labels"].get(axis))
        counts = Counter(getc(r) for r in train if getc(r) in label_maps[axis])
        w = torch.tensor([1.0 / max(1, counts.get(v, 1)) for v in label_maps[axis]], dtype=torch.float)
        w = (w / w.sum() * len(w)).to(device)
        losses[axis] = nn.CrossEntropyLoss(weight=w, ignore_index=-100)

    for epoch in range(args.epochs):
        model.train(); total = 0.0
        for batch in dl:
            ids = batch["input_ids"].to(device); am = batch["attention_mask"].to(device)
            logits = model(ids, am)
            loss = sum(losses[a](logits[a], batch[f"y_{a}"].to(device)) for a in AXES)
            opt.zero_grad(); loss.backward(); opt.step()
            total += loss.item()
        print(f"[train] epoch {epoch+1}/{args.epochs}  loss {total/max(1,len(dl)):.4f}", flush=True)

    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), out / "model.pt")
    tok.save_pretrained(out)
    json.dump({"encoder": args.encoder, "axes": AXES, "label_maps": label_maps, "sizes": sizes},
              open(out / "heads.json", "w"), indent=2)
    print(f"[train] saved to {out}")


if __name__ == "__main__":
    main()
