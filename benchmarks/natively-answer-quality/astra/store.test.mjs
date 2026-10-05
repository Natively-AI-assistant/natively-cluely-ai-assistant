// The judge's own files survive a write cut short by a full disk: a half line or a half cache file is skipped, the
// next append stays readable, and the scripts that read them (decide, promote) still give a verdict.
//   node --test astra/store.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJsonl, readJsonOrNull, writeAtomic, appendLine } from './store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aq-store-'));
const quiet = (fn) => { const real = console.error; const lines = []; console.error = (...x) => lines.push(x.join(' ')); try { return [fn(), lines]; } finally { console.error = real; } };

test('a line cut short is skipped and counted; the rows around it are read', () => {
  const dir = tmp();
  try {
    const f = path.join(dir, 'run.jsonl');
    fs.writeFileSync(f, '{"id":1}\n{"id":2,"offic\n{"id":3}\n\n{"id":4,"ok":tr');
    const [rows, lines] = quiet(() => readJsonl(f));
    assert.deepEqual(rows.map((r) => r.id), [1, 3]);
    assert.deepEqual(lines, ['[store] run.jsonl: 2 unreadable lines skipped']);
    assert.deepEqual(readJsonl(path.join(dir, 'missing.jsonl')), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an append after a cut-short append starts on its own line', () => {
  const dir = tmp();
  try {
    const f = path.join(dir, 'run.jsonl');
    appendLine(f, { id: 1 });
    fs.appendFileSync(f, '{"id":2,"judgm'); // what a full disk leaves behind
    appendLine(f, { id: 3 });
    appendLine(f, { id: 4 });
    const [rows] = quiet(() => readJsonl(f));
    assert.deepEqual(rows.map((r) => r.id), [1, 3, 4]);
    assert.equal(fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length, 4);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a cache file cut short counts as not cached; a whole-file write leaves the old or the new', () => {
  const dir = tmp();
  try {
    const f = path.join(dir, 'abc.json');
    fs.writeFileSync(f, '{"key":"abc","official":{"over');
    assert.equal(readJsonOrNull(f), null);
    assert.equal(readJsonOrNull(path.join(dir, 'missing.json')), null);
    writeAtomic(f, JSON.stringify({ key: 'abc', v: 1 }));
    assert.deepEqual(readJsonOrNull(f), { key: 'abc', v: 1 });
    // A write that fails leaves the earlier content and no temp file behind.
    assert.throws(() => writeAtomic(path.join(dir, 'no-such-dir', 'x.json'), '{}'));
    assert.throws(() => writeAtomic(f, { toString() { throw new Error('cut'); } }));
    assert.deepEqual(readJsonOrNull(f), { key: 'abc', v: 1 });
    assert.deepEqual(fs.readdirSync(dir), ['abc.json']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a save that fails stops new judge calls with the line the queue stops on, and does not throw', async () => {
  const { saved } = await import('./judge.mjs');
  const client = await import('./client.mjs');
  const stop = new RegExp(fs.readFileSync(path.join(HERE, 'queue3.mjs'), 'utf8').match(/if \(\/(.+?)\/\.test\(s\)\) rationed = true/)[1]);
  const [ok, none] = quiet(() => saved(() => {}));
  assert.equal(ok, true);
  assert.equal(none.length, 0);
  assert.equal(client.RATIONED, null);
  const [failed, lines] = quiet(() => saved(() => { throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }); }));
  assert.equal(failed, false);
  assert.match(client.RATIONED, /^disk nearly full \(a judgment could not be saved: ENOSPC\)/);
  assert.equal(lines.length, 1);
  assert.ok(stop.test(lines[0]));
});

test('the verdict scripts read a judged file with a cut-short last line', () => {
  const root = tmp();
  try {
    const w = (f, text) => { const p = path.join(root, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
    const row = (id, s) => JSON.stringify({ ok: true, benchmark_id: id, repeat: 0, official: { overall: s, hard_fail: false, flags: [] } });
    const ids = ['T-1', 'T-2', 'T-3'];
    for (const split of ['dev', 'holdout']) {
      for (const run of [`aq2-${split}-fix13c`, `aq2-${split}-fix15`]) {
        w(`results/${run}/natively_benchmark_full.jsonl`, ids.map((id) => JSON.stringify({ benchmark_id: id, mode: 'lecture', surface_path: 'typed' })).join('\n') + '\n');
      }
      w(`astra/out/abs-${split}-c2/aq2-${split}-fix13c.jsonl`, ids.map((id) => row(id, 7)).join('\n') + '\n');
      // The candidate's file ends in a line cut short: two rows are read, the third counts as not judged.
      w(`astra/out/abs-${split}-c2/aq2-${split}-fix15.jsonl`, `${row('T-1', 8)}\n${row('T-2', 8)}\n${row('T-3', 8).slice(0, 40)}`);
    }
    const r = spawnSync(process.execPath, [path.join(HERE, 'promote.mjs'), '--root', root], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\| dev \| typed \(reason\) \| 2 of 3 \|/);
    assert.match(r.stdout, /Verdict: INCOMPLETE — no verdict/);
    assert.match(r.stderr, /aq2-dev-fix15\.jsonl: 1 unreadable line skipped/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
