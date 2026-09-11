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
        # FORCE fp32. Some checkpoints ship float16 weights, and DeBERTa-v3-xsmall
        # is one: every parameter loads as torch.float16 while the heads created
        # below are fp32. On MPS that combination is fatal rather than merely
        # slow. Metal rejects the graph with
        #
        #   'mps.add' op requires the same element type for all operands
        #   %7 = "mps.add"(tensor<2x2xf16>, tensor<2xf32>) -> tensor<*xf32>
        #
        # and inside the training loop it does not raise, it degrades to a NaN
        # loss from the first step. No gradient is ever applied, the model stays
        # at its random initialisation, and the collapse detector reports it as
        # a single-class predictor.
        #
        # That is what happened. DeBERTa-v3-xsmall was recorded as scoring 19.8
        # macro F1 and ruled out of the campaign on a number that measured this
        # bug and not the encoder. Verified after the fix: loss 0.698 and a
        # finite gradient norm of 2.44, identical on MPS and CPU.
        self.encoder = AutoModel.from_pretrained(encoder_name).float()
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
    ap.add_argument("--max-len", type=int, default=192)
    ap.add_argument("--lr", type=float, default=3e-5)
    ap.add_argument("--seed", type=int, default=17)
    ap.add_argument("--dev-frac", type=float, default=0.15,
                    help="fraction of TRAIN groups held out to pick the best epoch; never touches the corpus holdout")
    args = ap.parse_args()

    random.seed(args.seed); np.random.seed(args.seed); torch.manual_seed(args.seed)

    rows = [json.loads(l) for l in open(args.data) if l.strip()]
    train = [r for r in rows if r.get("split") == "train"]
    holdout = [r for r in rows if r.get("split") == "holdout"]
    print(f"[train] {len(train)} train rows, {len(holdout)} held out (never used here)")

    # DEV SLICE, carved out of TRAIN so the epoch count stops being a guess.
    #
    # This script used to run a fixed number of epochs and save whatever the
    # last one produced. The epoch count was therefore an unvalidated
    # hyperparameter: the saved model might be overfit or undertrained and
    # nothing in the output said which. Selecting on the holdout would fix that
    # by leaking it, so the slice comes out of train.
    #
    # Grouped by normalised input, for the same reason the corpus split is:
    # adversarial pairs and repeated backchannels share an input, and splitting
    # them across the fit/dev boundary leaks the answer.
    groups = {}
    for r in train:
        k = " ".join(str(r.get("input", "")).lower().split())
        groups.setdefault(k, []).append(r)
    keys = sorted(groups)
    random.Random(args.seed).shuffle(keys)
    n_dev = max(1, int(len(keys) * args.dev_frac))
    dev_keys = set(keys[:n_dev])
    dev = [r for k in dev_keys for r in groups[k]]
    fit = [r for k in keys[n_dev:] for r in groups[k]]
    print(f"[train] fit {len(fit)} rows, dev {len(dev)} rows (grouped by input, carved from train)")

    label_maps, sizes = {}, {}
    for axis in AXES:
        get = (lambda r: r.get("legacy_intent")) if axis == "legacy_intent" else (lambda r: r["labels"].get(axis))
        vals = sorted({get(r) for r in fit if get(r) is not None})
        label_maps[axis] = {v: i for i, v in enumerate(vals)}
        sizes[axis] = len(vals)
        print(f"[train] {axis:16} {len(vals)} classes")

    tok = AutoTokenizer.from_pretrained(args.encoder)
    model = MultiHead(args.encoder, sizes)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model.to(device)
    print(f"[train] device {device}")
    _dtypes = {p.dtype for p in model.parameters()}
    print(f"[train] param dtypes {sorted(str(d) for d in _dtypes)}")
    assert _dtypes == {torch.float32}, (
        f"every parameter must be fp32 before training; found {_dtypes}. "
        "A mixed fp16/fp32 model produces a NaN loss on MPS without raising.")

    dl = DataLoader(Rows(fit, tok, label_maps, max_len=args.max_len), batch_size=args.batch, shuffle=True)
    dev_dl = DataLoader(Rows(dev, tok, label_maps, max_len=args.max_len), batch_size=args.batch)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)

    # LINEAR WARMUP THEN DECAY.
    #
    # Added after the DeBERTa-v3-xsmall run collapsed: it predicted a single
    # class for all 377 held-out rows, which is uniform logits with argmax
    # taking index 0. That is a non-convergence signature, not a verdict on the
    # encoder, and DeBERTa-v3 in particular is known to need a warmup — its
    # disentangled attention is unstable at a full learning rate from step one,
    # and a constant LR is enough to flatten the heads permanently.
    #
    # MiniLM converged without it, so this changes nothing for the candidate
    # that currently leads; it exists so a larger encoder gets a fair run.
    total_steps = max(1, len(dl) * args.epochs)
    warmup_steps = max(1, int(total_steps * 0.1))

    def lr_lambda(step):
        if step < warmup_steps:
            return step / warmup_steps
        progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
        return max(0.0, 1.0 - progress)

    sched = torch.optim.lr_scheduler.LambdaLR(opt, lr_lambda)
    # Class imbalance is severe and deliberate (needs_response=no is 43% of the
    # corpus). Unweighted loss would let a head win by always predicting the
    # majority, which is exactly the failure the LLM labeller made on `voice`.
    losses = {}
    for axis in AXES:
        getc = (lambda r: r.get("legacy_intent")) if axis == "legacy_intent" else (lambda r: r["labels"].get(axis))
        counts = Counter(getc(r) for r in fit if getc(r) in label_maps[axis])
        w = torch.tensor([1.0 / max(1, counts.get(v, 1)) for v in label_maps[axis]], dtype=torch.float)
        w = (w / w.sum() * len(w)).to(device)
        losses[axis] = nn.CrossEntropyLoss(weight=w, ignore_index=-100)

    best_dev, best_epoch, best_state = -1.0, 0, None
    for epoch in range(args.epochs):
        model.train(); total = 0.0
        for batch in dl:
            ids = batch["input_ids"].to(device); am = batch["attention_mask"].to(device)
            logits = model(ids, am)
            loss = sum(losses[a](logits[a], batch[f"y_{a}"].to(device)) for a in AXES)
            opt.zero_grad(); loss.backward()
            # Clip before stepping. A single outlier batch can otherwise put a
            # head into the flat region it never leaves, which is the collapse
            # this run is guarding against.
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step(); sched.step()
            total += loss.item()
        # DEV MACRO F1 on the decision axis, every epoch, and keep the best.
        #
        # needs_response is the selection key because it is the axis the router
        # actually gates behaviour on. Macro rather than accuracy so a model
        # that learns the majority class and stops does not win.
        model.eval()
        correct_by, total_by, pred_by = Counter(), Counter(), Counter()
        with torch.no_grad():
            for batch in dev_dl:
                logits = model(batch["input_ids"].to(device), batch["attention_mask"].to(device))
                y = batch["y_needs_response"]
                pred = logits["needs_response"].argmax(dim=-1).cpu()
                for t, p_ in zip(y.tolist(), pred.tolist()):
                    if t == -100:
                        continue
                    total_by[t] += 1
                    pred_by[p_] += 1
                    if t == p_:
                        correct_by[t] += 1
        f1s = []
        for cls in set(total_by) | set(pred_by):
            tp = correct_by.get(cls, 0)
            prec = tp / pred_by[cls] if pred_by.get(cls) else 0.0
            rec = tp / total_by[cls] if total_by.get(cls) else 0.0
            f1s.append(2 * prec * rec / (prec + rec) if (prec + rec) else 0.0)
        dev_f1 = sum(f1s) / len(f1s) if f1s else 0.0
        mark = ""
        if dev_f1 > best_dev:
            best_dev, best_epoch = dev_f1, epoch + 1
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            mark = "  <- best so far, kept"
        print(f"[train] epoch {epoch+1}/{args.epochs}  loss {total/max(1,len(dl)):.4f}  dev needs_response macroF1 {dev_f1:.4f}{mark}", flush=True)

    # Restore the best epoch. Without this the saved model is whatever the last
    # epoch happened to produce, which is the defect this dev slice exists for.
    if best_state is not None:
        model.load_state_dict(best_state)
        print(f"[train] restored epoch {best_epoch}, dev needs_response macroF1 {best_dev:.4f}")

    # COLLAPSE CHECK, on the training split, before anything is saved.
    #
    # A collapsed head is indistinguishable from a weak one in the loss curve
    # and looks like a hopeless model in the benchmark. Both the DeBERTa
    # multi-head and the Qwen3 SLM shipped a single-class predictor before this
    # existed. Checking here means the failure is named at training time.
    model.eval()
    with torch.no_grad():
        check = DataLoader(Rows(fit[:256], tok, label_maps, max_len=args.max_len), batch_size=args.batch)
        seen = {a: Counter() for a in AXES}
        for batch in check:
            logits = model(batch["input_ids"].to(device), batch["attention_mask"].to(device))
            for a in AXES:
                for idx in logits[a].argmax(dim=-1).tolist():
                    seen[a][idx] += 1
    for a in AXES:
        distinct = len(seen[a])
        flag = "  COLLAPSED (predicts one class)" if distinct <= 1 else ""
        print(f"[train] {a:16} predicts {distinct}/{sizes[a]} distinct classes{flag}")

    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), out / "model.pt")
    tok.save_pretrained(out)
    json.dump({"encoder": args.encoder, "axes": AXES, "label_maps": label_maps, "sizes": sizes,
               "selection": {"best_epoch": best_epoch, "epochs_run": args.epochs,
                             "dev_needs_response_macro_f1": best_dev,
                             "dev_rows": len(dev), "fit_rows": len(fit)}},
              open(out / "heads.json", "w"), indent=2)
    print(f"[train] saved to {out}")


if __name__ == "__main__":
    main()
