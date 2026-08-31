// Fork-safety invariants for Build Smoke.
//
// A pull request from a fork cannot receive the credential for the private
// premium submodule. The workflow must still exercise the public Electron
// graph without weakening the full trusted build or exposing secrets.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const workflow = read('.github/workflows/build-smoke.yml');
const buildScript = read('scripts/build-electron.js');
const packageJson = JSON.parse(read('package.json'));

test('fork PRs use a real core smoke scope without privileged pull_request_target', () => {
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.match(workflow, /IS_FORK_PR:.*head\.repo\.full_name != github\.repository/);
  assert.match(workflow, /echo "mode=core" >> "\$GITHUB_OUTPUT"/);
  assert.match(workflow, /if: steps\.smoke_scope\.outputs\.mode == 'core'\s+run: npm run build:electron:core-smoke/);
  assert.match(workflow, /if: \$\{\{ !cancelled\(\) && steps\.smoke_scope\.outputs\.mode == 'core' \}\}\s+run: npm run test:core-smoke/);
});

test('trusted runs cannot silently downgrade when the premium credential is missing', () => {
  assert.match(workflow, /echo "mode=invalid" >> "\$GITHUB_OUTPUT"/);
  assert.match(workflow, /if: steps\.smoke_scope\.outputs\.mode == 'invalid'[\s\S]*?exit 1/);
  assert.match(workflow, /Checkout premium submodule\s+if: steps\.smoke_scope\.outputs\.mode == 'full'/);
  assert.match(workflow, /Typecheck premium submodule \(TypeScript 7\)\s+if: steps\.smoke_scope\.outputs\.mode == 'full'/);
  assert.match(workflow, /Build Electron main process\s+if: steps\.smoke_scope\.outputs\.mode == 'full'\s+run: npm run build:electron/);
  assert.match(workflow, /Run intelligence unit tests\s+if: \$\{\{ !cancelled\(\) && steps\.smoke_scope\.outputs\.mode == 'full' \}\}/);
});

test('core smoke externalizes private runtime imports only behind an explicit opt-in', () => {
  assert.equal(packageJson.scripts['build:electron'], 'node scripts/build-electron.js');
  assert.match(packageJson.scripts['build:electron:core-smoke'], /NATIVELY_CORE_SMOKE=1/);
  assert.match(buildScript, /const CORE_SMOKE = process\.env\.NATIVELY_CORE_SMOKE === '1'/);
  assert.match(buildScript, /plugins: CORE_SMOKE \? \[coreSmokePremiumExternalPlugin\] : \[\]/);
  assert.match(buildScript, /filter: \/\^\(\?:\\\.\\\.\\\/\)\+premium/);
});

test('core type contracts do not import the private repository', () => {
  const intelligenceEngine = read('electron/IntelligenceEngine.ts');
  const resolver = read('electron/services/resolveCompanySearchProvider.ts');
  const contracts = read('electron/premium/contracts.ts');

  assert.doesNotMatch(intelligenceEngine, /import type .*premium\/electron/);
  assert.doesNotMatch(resolver, /import type .*premium\/electron/);
  assert.match(intelligenceEngine, /from '\.\/premium\/contracts'/);
  assert.match(resolver, /from '\.\.\/premium\/contracts'/);
  assert.match(contracts, /export interface PromptAssemblyResult/);
  assert.match(contracts, /export interface SearchProvider/);
});
