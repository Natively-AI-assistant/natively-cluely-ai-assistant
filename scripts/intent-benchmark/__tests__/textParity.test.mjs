// scripts/intent-benchmark/__tests__/textParity.test.mjs
//
// The trainer and the provider must build the SAME string.
//
// The multi-head model is fine-tuned in Python by tools/train_multihead.py and
// served in Node by providers/embeddingPrototype.mjs. Each builds the text the
// encoder sees from the row, and they build it independently, in different
// languages, from two copies of the same format. If those copies drift, the
// model is trained on one format and asked to predict on another. Nothing
// throws. The accuracy just quietly drops, and it looks like a bad model rather
// than a bad harness.
//
// So this diffs the two implementations over real corpus rows. It is skipped,
// not failed, where python3 or torch is unavailable, because the Node suite
// must stay runnable without the training toolchain.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildText } from '../providers/embeddingPrototype.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const corpus = path.join(root, 'dataset', 'v2.jsonl');

const PY = `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(root, 'tools'))})
from train_multihead import build_text
rows = [json.loads(l) for l in open(${JSON.stringify(corpus)})][:200]
sys.stdout.write("\\n".join(build_text(r) for r in rows))
`;

describe('trainer / provider text parity', () => {
    test('build_text and buildText agree on real rows', (t) => {
        if (!fs.existsSync(corpus)) return t.skip('corpus absent');
        const py = spawnSync('python3', ['-c', PY], { encoding: 'utf8' });
        if (py.status !== 0) return t.skip(`python3 unavailable: ${String(py.stderr).trim().split('\n').pop()}`);

        const rows = fs.readFileSync(corpus, 'utf8').trim().split('\n').slice(0, 200).map((l) => JSON.parse(l));
        const js = rows.map(buildText).join('\n');

        const a = py.stdout.split('\n');
        const b = js.split('\n');
        assert.equal(a.length, b.length, 'row counts differ');
        const firstDiff = a.findIndex((line, i) => line !== b[i]);
        assert.equal(firstDiff, -1, firstDiff === -1 ? '' :
            `row ${firstDiff} differs\n  python: ${a[firstDiff]}\n  node:   ${b[firstDiff]}`);
    });
});
