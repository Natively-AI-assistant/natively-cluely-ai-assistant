#!/usr/bin/env bash
set -u
cd /Users/evin/natively-cluely-ai-assistant
B=scripts/intent-benchmark
STAMP=$(date +%Y%m%d-%H%M%S)

echo "=== COLDSTART CHAIN START $(date +%H:%M:%S) ==="

# Keep the pre-augmentation corpus and model, so the comparison is against a
# preserved artifact rather than a remembered number.
cp $B/dataset/v3.jsonl $B/dataset/v3.pre-coldstart.jsonl
cp -R resources/models/natively/router-minilm-multihead \
      resources/models/natively/router-minilm-multihead.pre-coldstart-$STAMP
echo "preserved: corpus and model before augmentation"

echo "=== 1. augment $(date +%H:%M:%S) ==="
node $B/augment-coldstart.mjs --in dataset/v3.jsonl --out dataset/v3.jsonl || exit 1

echo "=== 2. validate ==="
node $B/validate.mjs --in dataset/v3.jsonl 2>&1 | tail -12

echo "=== 3. retrain minilm on the augmented split $(date +%H:%M:%S) ==="
PYTHONUNBUFFERED=1 python3 $B/tools/train_multihead.py \
  --data $B/dataset/v3.jsonl \
  --encoder sentence-transformers/all-MiniLM-L6-v2 \
  --out $B/trained/minilm-multihead-cs --epochs 12 2>&1 | grep -E "^\[train\]" || exit 1

echo "=== 4. export int8 $(date +%H:%M:%S) ==="
python3 $B/tools/export_multihead_onnx.py \
  --trained $B/trained/minilm-multihead-cs \
  --out resources/models/natively/router-minilm-multihead 2>&1 | grep -E "^\[export\]" || exit 1

echo "=== 5. the measurement that matters: both conditions, both models ==="
node $B/coldstart-eval.mjs 2>&1 | tail -20

echo "=== COLDSTART CHAIN DONE $(date +%H:%M:%S) ==="
