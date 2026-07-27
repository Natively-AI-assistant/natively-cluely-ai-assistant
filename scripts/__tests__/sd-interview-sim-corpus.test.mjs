// scripts/__tests__/sd-interview-sim-corpus.test.mjs
//
// Tier0 unit tests for SD interview sim corpus write / redact / retain.
// File-based only — no Electron, no live Gemini, no meeting DB.
//
// Run: node --test scripts/__tests__/sd-interview-sim-corpus.test.mjs

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  CORPUS_DIR_RELATIVE,
  redactSecrets,
  writeCorpusBundle,
  retainLastN,
  createRun,
  appendTurn,
  finalize,
} = require('../lib/sd-interview-sim');

function makeTempCorpus() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sd-interview-sim-corpus-'));
}

describe('sd-interview-sim corpus redact + retain', () => {
  test('CORPUS_DIR_RELATIVE documents gitignored sim corpus path', () => {
    assert.equal(CORPUS_DIR_RELATIVE, 'traces/sd-interview-sim');
  });

  test('redactSecrets strips Gemini/OpenAI-style keys and keyed secret fields', () => {
    const dirty = {
      schema_version: 1,
      run_id: 'run-1',
      turns: [
        {
          idx: 0,
          role: 'interviewer',
          text: 'Use key AIzaSyA-test-key-abcdefghijklmnopqrstuv and sk-proj-abcdefghijklmnopqrstuvwxyz1234',
          attachments: [],
        },
      ],
      side_channels: [
        {
          apiKey: 'AIzaSyRealSecretKeyValueHere123456',
          authorization: 'Bearer tok_abc_secret_value',
          note: 'GEMINI_API_KEY=AIzaSyEnvStyleSecretValue0001',
        },
      ],
      outcome: { end_reason: 'scenario_stop', spend: { input_tokens: 1, output_tokens: 1, estimated_usd: 0 } },
    };

    const clean = redactSecrets(dirty);

    assert.equal(clean.schema_version, 1);
    assert.equal(clean.run_id, 'run-1');
    assert.equal(clean.turns[0].role, 'interviewer');
    assert.match(clean.turns[0].text, /\[REDACTED\]/);
    assert.doesNotMatch(clean.turns[0].text, /AIzaSyA-test-key/);
    assert.doesNotMatch(clean.turns[0].text, /sk-proj-abcdefghijklmnopqrstuvwxyz1234/);
    assert.equal(clean.side_channels[0].apiKey, '[REDACTED]');
    assert.equal(clean.side_channels[0].authorization, '[REDACTED]');
    assert.match(clean.side_channels[0].note, /\[REDACTED\]/);
    assert.doesNotMatch(clean.side_channels[0].note, /AIzaSyEnvStyleSecretValue0001/);
    // Original untouched
    assert.match(dirty.turns[0].text, /AIzaSyA-test-key/);
  });

  test('writeCorpusBundle writes redacted JSON under corpus dir (file-based only)', () => {
    const dir = makeTempCorpus();
    try {
      const run = createRun({
        provenance: { git_sha: 'abc', tier: 'T0', models: {} },
        run_id: 'write-run-1',
      });
      appendTurn(run, {
        role: 'assistant',
        text: 'leak AIzaSyWritePathSecretKeyValueABCDEF',
      });
      const { bundle } = finalize(run, { end_reason: 'scenario_stop' });

      const result = writeCorpusBundle(bundle, { corpusDir: dir });

      assert.ok(result.path.startsWith(dir));
      assert.ok(result.path.endsWith('write-run-1.json'));
      assert.ok(fs.existsSync(result.path));
      assert.ok(result.digestPath);
      assert.ok(fs.existsSync(result.digestPath));
      assert.match(fs.readFileSync(result.digestPath, 'utf8'), /SD interview digest/);

      const onDisk = JSON.parse(fs.readFileSync(result.path, 'utf8'));
      assert.equal(onDisk.run_id, 'write-run-1');
      assert.equal(onDisk.schema_version, 1);
      assert.doesNotMatch(JSON.stringify(onDisk), /AIzaSyWritePathSecretKeyValueABCDEF/);
      assert.match(onDisk.turns[0].text, /\[REDACTED\]/);
      assert.deepEqual(result.bundle, onDisk);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('retainLastN deletes older runs beyond the cap (temp dirs)', () => {
    const dir = makeTempCorpus();
    try {
      const names = ['a.json', 'b.json', 'c.json', 'd.json'];
      for (let i = 0; i < names.length; i += 1) {
        const p = path.join(dir, names[i]);
        fs.writeFileSync(p, JSON.stringify({ run_id: names[i] }), 'utf8');
        const digest = path.join(dir, names[i].replace(/\.json$/, '.digest.md'));
        fs.writeFileSync(digest, `# digest ${names[i]}\n`, 'utf8');
        // Stagger mtimes so sort is deterministic (oldest → newest).
        const when = new Date(Date.now() - (names.length - i) * 60_000);
        fs.utimesSync(p, when, when);
        fs.utimesSync(digest, when, when);
      }

      const result = retainLastN(dir, 2);

      assert.equal(result.kept.length, 2);
      assert.ok(result.deleted.includes('a.json'));
      assert.ok(result.deleted.includes('a.digest.md'));
      assert.ok(result.deleted.includes('b.json'));
      assert.ok(result.deleted.includes('b.digest.md'));
      assert.deepEqual(result.kept.sort(), ['c.json', 'd.json'].sort());
      assert.ok(fs.existsSync(path.join(dir, 'c.json')));
      assert.ok(fs.existsSync(path.join(dir, 'd.json')));
      assert.ok(fs.existsSync(path.join(dir, 'c.digest.md')));
      assert.equal(fs.existsSync(path.join(dir, 'a.json')), false);
      assert.equal(fs.existsSync(path.join(dir, 'a.digest.md')), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('retainLastN with keepCount >= file count deletes nothing', () => {
    const dir = makeTempCorpus();
    try {
      fs.writeFileSync(path.join(dir, 'only.json'), '{}', 'utf8');
      const result = retainLastN(dir, 5);
      assert.equal(result.kept.length, 1);
      assert.deepEqual(result.deleted, []);
      assert.ok(fs.existsSync(path.join(dir, 'only.json')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
