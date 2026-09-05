#!/usr/bin/env bash
set -u
cd /Users/evin/natively-cluely-ai-assistant
export GEMINI_API_KEY=$(grep '^GEMINI_API_KEY=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d ' ')
B=scripts/intent-benchmark
# Wait for the expansion to finish. Keyed on there being no generate.mjs
# process left rather than on a bare PID, which the OS could in principle
# recycle, and on the wrapper's own PID as a second signal. The wrapper's
# trailing sentinel echo goes to /dev/null, so the log cannot be used.
# The expansion is confirmed complete: 2006 en + 65 hi + 83 ml rows on disk and
# no generate.mjs running. The wait is gone because there is nothing left to
# wait for.
#
# SINGLE WRITER GUARD. Re-arming this script while a previous instance was
# mid-flight left an orphaned top-up running (pkill kills the shell, not its
# node child), and both instances would have appended to the same output file
# with ids seeded from the same baseline. Interleaved writes and duplicate ids,
# both silent. Refuse to start if any top-up is already running.
if pgrep -f "generate.mjs.*--categories" >/dev/null; then
  echo "ABORT: a top-up generator is already running; not starting a second writer"
  exit 1
fi

echo "=== CHAIN START $(date +%H:%M:%S) ==="
wc -l $B/dataset/v3.expand-*.jsonl 2>/dev/null

# The in-flight generator loaded the old prompts, the old realism gate and the
# old label-blind dedupe at process start, so its fragment/ambiguous/trap cells
# kept rejecting. This is a fresh process and picks up all three fixes. It runs
# BEFORE finalize so the rows reach the retrain.
# --continue-from takes ONE path and seeds both the per-mode id sequence and the
# cross-batch dedupe from it. Seeding from v2 alone would restart ids at v2's
# maxima, which expand-en has already run past, so every top-up id would collide
# with an expand-en id. finalize reads expand-en first and drops colliding ids,
# so the entire top-up would be deleted without a word. Measured before the fix:
# all 12 modes collide. So the baseline is the whole corpus generated so far.
cat $B/dataset/v2.jsonl $B/dataset/v3.expand-en.jsonl > $B/dataset/.seq-baseline.jsonl
for extra in $B/dataset/v3.expand-hi.jsonl $B/dataset/v3.expand-ml.jsonl; do
  [ -f "$extra" ] && cat "$extra" >> $B/dataset/.seq-baseline.jsonl
done
echo "seq baseline: $(wc -l < $B/dataset/.seq-baseline.jsonl) rows"

echo "=== 0. top-up: the three categories the old gate rejected $(date +%H:%M:%S) ==="
# 140, not 96. Measured on a live smoke of this exact path: the filtered top-up
# parrots prompt examples at 30.8% against the main expansion's 10.4%, because a
# run limited to fragment, ambiguous and trap shows proportionally more example
# text per generated row, and those two briefs are the ones examples were just
# added to. The filter drops every one, so the cost is throughput and not
# quality. 140 asked, with cell rejection on top, lands near the 96 intended.
node $B/generate.mjs --all --per-mode 140 --batch 24 \
  --categories fragment,ambiguous,trap \
  --continue-from dataset/.seq-baseline.jsonl --out dataset/v3.expand-hard.jsonl 2>&1 | tail -45

echo "=== 0b. assert the top-up did NOT reuse an id ==="
node -e "
const fs=require('fs');
const ids=new Set(); let dup=0;
for (const f of ['$B/dataset/v2.jsonl','$B/dataset/v3.expand-en.jsonl']) {
  for (const l of fs.readFileSync(f,'utf8').trim().split('\n')) ids.add(JSON.parse(l).id);
}
const hard='$B/dataset/v3.expand-hard.jsonl';
if (!fs.existsSync(hard)) { console.log('no top-up file'); process.exit(0); }
for (const l of fs.readFileSync(hard,'utf8').trim().split('\n')) if (ids.has(JSON.parse(l).id)) dup++;
console.log('top-up ids colliding with the existing corpus:', dup);
if (dup > 0) { console.error('ABORT: the top-up would be dropped by finalize'); process.exit(1); }
" || exit 1

echo "=== 1. finalize: merge, retag, dedupe, GROUPED re-split ==="
node $B/finalize-v3.mjs --out dataset/v3.jsonl || exit 1

echo "=== 2. punctuation restoration ==="
node $B/restore.mjs --in dataset/v3.jsonl 2>&1 | tail -5

echo "=== 3b. split-group tail: assignGroupedSplits groups on input across ALL modes ==="
node -e "
const fs=require('fs');
const g={};
for(const l of fs.readFileSync('$B/dataset/v3.jsonl','utf8').trim().split('\n')){
  const r=JSON.parse(l);const k=String(r.input).toLowerCase().replace(/\s+/g,' ').trim();
  (g[k]=g[k]||[]).push(r);}
const big=Object.entries(g).filter(([,v])=>v.length>=8).sort((a,b)=>b[1].length-a[1].length);
const hold=Object.values(g).filter(v=>v[0].split==='holdout');
const holdRows=hold.reduce((a,v)=>a+v.length,0);
console.log('groups of >=8 identical inputs:', big.length);
for(const [k,v] of big.slice(0,8)) console.log('  ', String(v.length).padStart(3), v[0].split.padEnd(8), JSON.stringify(k).slice(0,46));
const biggestInHoldout = big.filter(([,v])=>v[0].split==='holdout')[0];
if (biggestInHoldout) console.log('largest holdout group:', biggestInHoldout[1].length, 'rows =', (100*biggestInHoldout[1].length/holdRows).toFixed(1)+'% of holdout — one string driving this much of the headline is a caveat to report');
"

echo "=== 3. validate ==="
node $B/validate.mjs --in dataset/v3.jsonl 2>&1 | tail -25

# Every trained head on disk is stale twice over: fitted on the OLD split, so it
# has seen part of the new holdout, AND carrying the old three-class
# needs_response (no/optional/yes) from before the taxonomy collapsed optional
# into no. Neither may be scored. The old exports are moved aside rather than
# deleted so the replacement is provable.
STAMP=$(date +%Y%m%d-%H%M%S)
# minilm and tiny are rebuilt below. deberta and modernbert are NOT: both were
# ruled out on quality and speed earlier in the campaign. They are moved aside
# anyway, so that scoring them fails loudly instead of quietly returning a
# number from a head that was fitted on the old split and carries the old
# three-class needs_response. A fabricated number is worse than a missing one.
for m in minilm tiny deberta modernbert; do
  d=resources/models/natively/router-$m-multihead
  [ -d "$d" ] && mv "$d" "$d.stale-$STAMP" && echo "moved aside: $d -> $d.stale-$STAMP"
done

for m in "minilm sentence-transformers/all-MiniLM-L6-v2" "tiny sentence-transformers/paraphrase-MiniLM-L3-v2"; do
  set -- $m; NAME=$1; ENC=$2
  echo "=== 4.$NAME retrain on the NEW train split $(date +%H:%M:%S) ==="
  PYTHONUNBUFFERED=1 python3 $B/tools/train_multihead.py \
    --data $B/dataset/v3.jsonl --encoder "$ENC" \
    --out $B/trained/$NAME-multihead-v3 --epochs 12 2>&1 | tail -18 || exit 1
  echo "=== 5.$NAME export int8 ONNX to the path the benchmark reads ==="
  python3 $B/tools/export_multihead_onnx.py \
    --trained $B/trained/$NAME-multihead-v3 \
    --out resources/models/natively/router-$NAME-multihead 2>&1 | tail -6 || exit 1
done

echo "=== 6. sanity: exported ONNX present and non-empty, heads TWO-class ==="
for m in minilm tiny; do
  d=resources/models/natively/router-$m-multihead
  n=$(find "$d" -name '*.onnx' -size +0 2>/dev/null | wc -l | tr -d ' ')
  sz=$(du -sh "$d" 2>/dev/null | cut -f1)
  echo "  $m: $n non-empty .onnx file(s), $sz on disk"
  [ "$n" -ge 1 ] || { echo "ABORT: $d has no non-empty ONNX; the export did not land"; exit 1; }
done
for m in minilm tiny; do
  python3 -c "
import json;h=json.load(open('$B/trained/$m-multihead-v3/heads.json'))
print('$m', h['encoder'], 'needs_response:', list(h['label_maps']['needs_response'].keys()))"
done

# Only providers whose artifacts were just rebuilt may be scored. deberta and
# modernbert are deliberately absent: both were ruled out on quality and speed
# earlier in the campaign, and their trained heads are stale twice over (old
# split, old three-class needs_response), so any number from them would be a
# fabrication.
# reports/ holds 36 results scored on the OLD corpus with the OLD models.
# summarize.mjs tables every json it finds, so leaving them there would rank
# stale numbers beside new ones in one table. Archived, not deleted.
mkdir -p $B/reports/archive-precorpus-$STAMP
find $B/reports -maxdepth 1 -name '*.json' -exec mv {} $B/reports/archive-precorpus-$STAMP/ \;
echo "archived $(ls -1 $B/reports/archive-precorpus-$STAMP | wc -l | tr -d ' ') stale reports"

echo "=== 7. benchmark on the NEW holdout $(date +%H:%M:%S) ==="
for pid in production majority rules head-minilm head-tiny headproto-minilm proto-potion-centroid composite-head-potion; do
  echo "--- $pid ---"
  node $B/run.mjs --provider "$pid" --in dataset/v3.jsonl --split holdout \
    --out "reports/$pid-v3.json" --save-rows 2>&1 | tail -14
done

# Hinglish and Manglish are reported SEPARATELY and are never gated on. The
# prototypes and the heads are fitted on English rows only, so these slices
# measure transfer, not fit, and folding them into the headline would hide both.
echo "=== 7b. code-switched slices, reported separately, never gated ==="
for lang in hinglish manglish; do
  for pid in head-minilm composite-head-potion; do
    echo "--- $pid / $lang ---"
    node $B/run.mjs --provider "$pid" --in dataset/v3.jsonl --split holdout \
      --language "$lang" --out "reports/$pid-v3-$lang.json" 2>&1 | tail -8
  done
done

echo "=== 8. cross-provider table $(date +%H:%M:%S) ==="
node $B/summarize.mjs 2>&1 | tail -45

echo "=== CHAIN DONE $(date +%H:%M:%S) ==="
