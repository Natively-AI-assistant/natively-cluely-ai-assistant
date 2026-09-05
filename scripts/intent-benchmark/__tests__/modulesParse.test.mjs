// scripts/intent-benchmark/__tests__/modulesParse.test.mjs
//
// Every harness module must import cleanly.
//
// lib/prompts.mjs shipped a syntax error for several commits — a backtick pair
// inside a template literal, from documenting the `ask` label in prose. Nothing
// caught it: the unit tests import schema.mjs and sttRealism.mjs but not
// prompts.mjs, and validate.mjs, which does import it, was being invoked
// through a `grep` of its output. A crash and a filter that matched nothing
// look identical through a pipe.
//
// So this asserts the cheapest possible property, that each module loads, and
// it is the only test here that would have caught it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const modules = [
  'lib/schema.mjs', 'lib/prompts.mjs', 'lib/modeSpecs.mjs', 'lib/sttRealism.mjs',
  'lib/metrics.mjs', 'lib/deriveVoice.mjs', 'lib/gemini.mjs',
  'providers/contract.mjs', 'providers/workerHost.mjs', 'providers/rules.mjs',
  'providers/nli.mjs', 'providers/embeddingPrototype.mjs', 'providers/multihead.mjs',
  'providers/gliclass.mjs', 'providers/slm.mjs', 'providers/hybrid.mjs',
  'providers/composite.mjs', 'providers/headWithPrototypes.mjs',
  'report.mjs', 'replay.mjs',
];

describe('every harness module imports', () => {
  for (const m of modules) {
    test(m, async () => {
      const p = path.join(root, m);
      assert.ok(fs.existsSync(p), `${m} is missing`);
      await import(pathToFileURL(p).href);
    });
  }
});

describe('every executable script parses', () => {
  // These are CLIs with top-level side effects, so importing them would RUN
  // them. `node --check` compiles without executing, which is exactly the
  // property wanted and the same check that would have caught the prompts.mjs
  // syntax error.
  const scripts = ['generate.mjs', 'validate.mjs', 'clean.mjs', 'handcheck.mjs',
    'migrate-taxonomy.mjs', 'restore.mjs', 'run.mjs', 'summarize.mjs',
    'errorAnalysis.mjs', 'relabel.mjs', 'analyze-telemetry.mjs'];
  for (const s of scripts) {
    test(s, () => {
      const r = spawnSync(process.execPath, ['--check', path.join(root, s)], { encoding: 'utf8' });
      assert.equal(r.status, 0, `${s} failed to parse:\n${r.stderr}`);
    });
  }
});
