// scripts/__tests__/ml-workspace-not-packaged.test.mjs
//
// The Auto Answer decider's training workspace (ml/auto-answer-decider: Python,
// a venv, checkpoints, ONNX exports) must never ship in the app. electron-builder's
// `files` is an allowlist that already leaves it out; the explicit root-anchored
// `!ml/**` keeps it out if someone later widens the allowlist. Same config on
// macOS and Windows targets: neither overrides `files`.
//
// Run: node --test scripts/__tests__/ml-workspace-not-packaged.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('electron-builder excludes ml/ and never lists it as a source', () => {
  const files = pkg.build.files;
  assert.ok(files.includes('!ml/**'), 'root-anchored ml/ exclusion present');
  assert.ok(!files.some(f => /^ml(\/|$)/.test(f)), 'ml/ is not allowlisted');
  for (const target of ['mac', 'win', 'linux']) {
    assert.equal(pkg.build[target]?.files, undefined, `${target} does not override files`);
  }
  const extra = JSON.stringify([pkg.build.extraResources, pkg.build.extraFiles, pkg.build.mac?.extraResources, pkg.build.win?.extraResources]);
  assert.ok(!/"from":"ml\//.test(extra), 'no extraResources/extraFiles copy from ml/');
});

test('the venv and artifacts are gitignored', () => {
  const gi = fs.readFileSync(path.join(root, 'ml/auto-answer-decider/.gitignore'), 'utf8');
  for (const p of ['.venv/', 'artifacts/', 'results/runs/']) assert.ok(gi.split('\n').includes(p), p);
});
