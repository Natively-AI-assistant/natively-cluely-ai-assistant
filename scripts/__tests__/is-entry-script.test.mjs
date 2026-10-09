// "Only run when invoked directly" is the guard that lets a test import a
// script's helpers. When it wrongly answers "imported", the script prints
// nothing and exits 0 - so `npm test`, which starts through
// scripts/run-with-env.mjs, ran no tests and reported success from any checkout
// reached through a symlink.
//
// The cause is not platform-specific: node resolves the entry script's real
// path for import.meta.url but leaves process.argv[1] as typed. Directory links
// are made as junctions here, which need no privilege on Windows and are plain
// symlinks elsewhere, so both hosts run the same cases.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isEntryScript } from '../lib/is-entry-script.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

/** A real script file plus a directory link that reaches it by another path. */
function linkedScript(t, name = 'tool.mjs') {
  // realpath: os.tmpdir() is itself a symlink on macOS (/var -> /private/var).
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'natively-entry-script-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const real = path.join(dir, 'real');
  fs.mkdirSync(real);
  const script = path.join(real, name);
  fs.writeFileSync(script, '');
  const link = path.join(dir, 'link');
  try {
    fs.symlinkSync(real, link, 'junction');
  } catch (error) {
    return { script, link: null, why: error.code };
  }
  return { script, link, dir };
}

test('the script node was started with is the entry script', (t) => {
  const { script } = linkedScript(t);
  assert.equal(isEntryScript(pathToFileURL(script).href, script), true);
});

test('still the entry script when started through a linked directory', (t) => {
  const { script, link, why } = linkedScript(t);
  if (!link) return t.skip(`cannot create a directory link here: ${why}`);
  // What node hands the script: the real path as its URL, the typed path in argv.
  assert.equal(isEntryScript(pathToFileURL(script).href, path.join(link, 'tool.mjs')), true);
});

test('still the entry script when started through a link with another name', (t) => {
  // The node_modules/.bin shape: the link's own name is not the script's.
  const { script, dir } = linkedScript(t);
  const alias = path.join(dir, 'alias');
  try {
    fs.symlinkSync(script, alias, 'file');
  } catch (error) {
    return t.skip(`cannot create a file link here: ${error.code}`);
  }
  assert.equal(isEntryScript(pathToFileURL(script).href, alias), true);
});

test('a test file that imports the script is not mistaken for it', (t) => {
  const { script } = linkedScript(t);
  const importer = path.join(path.dirname(script), 'tool.test.mjs');
  fs.writeFileSync(importer, '');
  assert.equal(isEntryScript(pathToFileURL(script).href, importer), false);
});

test('no entry script at all (node -e, the REPL) is not an invocation', (t) => {
  const { script } = linkedScript(t);
  assert.equal(isEntryScript(pathToFileURL(script).href, undefined), false);
  assert.equal(isEntryScript(pathToFileURL(script).href, ''), false);
});

test('an entry path that no longer exists falls back to its name, and errs towards running', (t) => {
  // A guard that cannot decide must not choose "imported": that is the silent
  // exit 0. Same name runs; a different name does not.
  const { script } = linkedScript(t);
  const gone = path.join(path.dirname(script), 'missing', 'tool.mjs');
  assert.equal(isEntryScript(pathToFileURL(script).href, gone), true);
  assert.equal(isEntryScript(pathToFileURL(script).href, path.join(path.dirname(script), 'missing', 'other.mjs')), false);
});

// ---------------------------------------------------------------------------
// The three scripts that use the guard, started through a linked checkout.
// ---------------------------------------------------------------------------

function linkedCheckout(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-linked-checkout-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const link = path.join(dir, 'checkout');
  try {
    fs.symlinkSync(REPO, link, 'junction');
  } catch (error) {
    t.skip(`cannot create a directory link here: ${error.code}`);
    return null;
  }
  return link;
}

test('run-with-env runs its command, and returns its exit code, through a linked checkout', (t) => {
  const link = linkedCheckout(t);
  if (!link) return;
  const result = spawnSync(
    process.execPath,
    [
      path.join(link, 'scripts', 'run-with-env.mjs'),
      '--set', 'NATIVELY_ENTRY_SCRIPT_PROBE=reached',
      '--', 'node', '-e',
      'process.stdout.write(String(process.env.NATIVELY_ENTRY_SCRIPT_PROBE)); process.exit(7)',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.stdout, 'reached', 'the command must run, not be skipped silently');
  assert.equal(result.status, 7, 'and its exit code must come back, not a flat 0');
});

test('run-with-env still reports a usage error through a linked checkout', (t) => {
  const link = linkedCheckout(t);
  if (!link) return;
  const result = spawnSync(process.execPath, [path.join(link, 'scripts', 'run-with-env.mjs')], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: node scripts\/run-with-env\.mjs/);
});

test('no script decides "was I invoked directly" by comparing import.meta.url with argv[1] itself', () => {
  // The scorer (`npm run benchmark:reranker:score`) is not started here because
  // it rewrites its tracked report; the source check covers it and every script
  // beside this one instead.
  // Every spelling of the same mistake: import.meta.url against a URL made from
  // argv[1], argv[1] against this file's own path, or a hand-built `file://`.
  const fragile = new RegExp([
    String.raw`import\.meta\.url\s*===\s*(?:url\.)?pathToFileURL\(`,
    String.raw`path\.resolve\(process\.argv\[1\]\)\s*===`,
    String.raw`===\s*path\.resolve\(process\.argv\[1\]\)`,
    'import\\.meta\\.url\\s*===\\s*`file:',
  ].join('|'));
  const files = [path.join(REPO, 'benchmarks', 'reranker-eval', 'score.mjs')];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(mjs|js|cjs)$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(REPO, 'scripts'));
  const helper = path.join(REPO, 'scripts', 'lib', 'is-entry-script.mjs');
  const offenders = files
    .filter((file) => file !== helper && fragile.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(REPO, file));
  assert.deepEqual(offenders, [], 'use isEntryScript(import.meta.url) from scripts/lib/is-entry-script.mjs');
  for (const rel of [
    'scripts/run-with-env.mjs', 'scripts/verify-packaged-local-assets.mjs', 'benchmarks/reranker-eval/score.mjs',
    'scripts/publish-github-release.mjs', 'scripts/write-mac-update-manifest.mjs', 'scripts/hindsight-llm-config.mjs',
  ]) {
    assert.match(fs.readFileSync(path.join(REPO, rel), 'utf8'), /isEntryScript\(import\.meta\.url\)/, `${rel} must use the shared guard`);
  }
});
