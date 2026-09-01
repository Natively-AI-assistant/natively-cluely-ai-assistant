/**
 * Every SettingsManager method the reranker code calls must actually exist.
 *
 * This exists because of a real, shipped bug. Three reranker call sites used
 * `SettingsManager.getInstance().getSettings()`, which SettingsManager does not
 * have — the API is `.get(key)`. Nothing caught it:
 *
 *  - TypeScript could not: SettingsManager is reached through an untyped
 *    lazy `require()` (it has to be — esbuild gives every electron file its own
 *    bundle, so a top-level import would inline a second copy of the singleton).
 *  - The unit tests could not: they inject their own readers.
 *  - The end-to-end runs could not: they set NATIVELY_RERANKER_MODEL, which is
 *    read BEFORE the settings lookup, so the broken path never executed.
 *
 * And every one of those call sites was wrapped in a try/catch that failed
 * closed, so the TypeError became a silent wrong answer instead of a crash:
 * hosted reranking reported "reference-file content is not allowed to leave
 * this machine" to every user regardless of their actual privacy setting, and a
 * directly-installed local model was never used while the UI reported the
 * switch had succeeded.
 *
 * A defensive catch turns a loud failure into a quiet one. That is usually
 * right on the retrieval path — but it means the call inside it has to be
 * verified some other way. This is that other way.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

const { SettingsManager } = require(path.join(repoRoot, 'dist-electron/electron/services/SettingsManager.js'));

/** Files that reach SettingsManager through a lazy require. */
const SOURCES = [
  'electron/rag/LocalReranker.ts',
  'electron/services/reranking/rerankerConfig.ts',
  'electron/services/extensions/appWiring.ts',
  'electron/ipcHandlers.ts',
];

test('SettingsManager exposes the accessors this repo actually uses', () => {
  assert.equal(typeof SettingsManager.prototype.get, 'function');
  assert.equal(typeof SettingsManager.prototype.set, 'function');
  assert.equal(typeof SettingsManager.getInstance, 'function');
});

test('every SettingsManager method the reranker code calls exists on the class', () => {
  const missing = [];

  for (const rel of SOURCES) {
    const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    // `SettingsManager.getInstance().<method>(` and `settings.<method>(` where
    // `settings` was assigned from getInstance() in the same file.
    // `[ \t]*` rather than `\s*`: spanning newlines makes the dot of one
    // statement pair with the keyword starting the next, which produced a
    // confident report that SettingsManager "has no if()".
    const direct = [...src.matchAll(/SettingsManager\.getInstance\(\)[ \t]*\.[ \t]*([A-Za-z_$][\w$]*)[ \t]*\(/g)];
    const viaLocal = /=[ \t]*SettingsManager\.getInstance\(\)/.test(src)
      ? [...src.matchAll(/\bsettings\.([A-Za-z_$][\w$]*)[ \t]*\(/g)]
      : [];

    for (const m of [...direct, ...viaLocal]) {
      const method = m[1];
      if (typeof SettingsManager.prototype[method] !== 'function'
        && typeof SettingsManager[method] !== 'function') {
        missing.push(`${rel}: SettingsManager has no ${method}()`);
      }
    }
  }

  assert.deepEqual(missing, [],
    'these calls would throw at runtime, and every one of them sits inside a '
    + 'catch that fails closed — so the symptom is a silent wrong answer, not an error:\n'
    + missing.join('\n'));
});

test('the reranker settings readers use get(), not a getSettings() that does not exist', () => {
  for (const rel of ['electron/rag/LocalReranker.ts', 'electron/services/reranking/rerankerConfig.ts']) {
    const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    const calls = [...src.matchAll(/getInstance\(\)\s*\.\s*getSettings\s*\(/g)];
    assert.equal(calls.length, 0, `${rel} calls getSettings(), which SettingsManager does not have`);
  }
});

test('the settings keys the reranker reads are declared on AppSettings', () => {
  // A key that is not in the interface still "works" through an `as any` cast
  // and then silently reads undefined forever.
  const settingsSrc = fs.readFileSync(path.join(repoRoot, 'electron/services/SettingsManager.ts'), 'utf8');
  for (const key of ['reranker', 'providerDataScopes']) {
    assert.match(settingsSrc, new RegExp(`\\n\\s*${key}\\?:`), `AppSettings must declare ${key}`);
  }
});
