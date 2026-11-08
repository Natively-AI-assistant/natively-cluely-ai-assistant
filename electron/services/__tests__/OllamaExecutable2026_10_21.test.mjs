// `ollama serve` was spawned by bare name, so it searched the app's PATH. An
// app opened from Finder or the Dock gets launchd's PATH, without Homebrew's
// bin or the CLI link Ollama.app installs: an installed Ollama failed with
// ENOENT and the user was told to install it. On Windows an app started before
// the Ollama install does not see its new PATH entry. ollamaExecutable.ts
// checks the install locations of both platforms first.
//
// Run: node scripts/build-electron.js && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/OllamaExecutable2026_10_21.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { resolveOllamaExecutable, ollamaExecutableCandidates } = require(path.join(repoRoot, 'dist-electron/electron/services/ollamaExecutable.js'));

const only = (...files) => (f) => files.includes(f);
const FINDER_PATH = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' };

test('macOS: Homebrew (Apple Silicon and Intel) and Ollama.app are found without them on PATH', () => {
  assert.equal(resolveOllamaExecutable('darwin', FINDER_PATH, only('/opt/homebrew/bin/ollama'), '/Users/jo'), '/opt/homebrew/bin/ollama');
  assert.equal(resolveOllamaExecutable('darwin', FINDER_PATH, only('/usr/local/bin/ollama'), '/Users/jo'), '/usr/local/bin/ollama');
  assert.equal(
    resolveOllamaExecutable('darwin', FINDER_PATH, only('/Applications/Ollama.app/Contents/Resources/ollama'), '/Users/jo'),
    '/Applications/Ollama.app/Contents/Resources/ollama',
  );
  assert.equal(
    resolveOllamaExecutable('darwin', FINDER_PATH, only('/Users/jo/Applications/Ollama.app/Contents/Resources/ollama'), '/Users/jo'),
    '/Users/jo/Applications/Ollama.app/Contents/Resources/ollama',
  );
  assert.equal(resolveOllamaExecutable('darwin', { PATH: '/Users/jo/bin:/usr/bin' }, only('/Users/jo/bin/ollama'), '/Users/jo'), '/Users/jo/bin/ollama');
});

test('Windows: the per-user install, Program Files and PATH (any case, quoted dirs, spaces)', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\Jo Doe\\AppData\\Local', ProgramFiles: 'C:\\Program Files', Path: 'C:\\Windows;"D:\\Tools\\Ollama"' };
  assert.equal(
    resolveOllamaExecutable('win32', env, only('C:\\Users\\Jo Doe\\AppData\\Local\\Programs\\Ollama\\ollama.exe')),
    'C:\\Users\\Jo Doe\\AppData\\Local\\Programs\\Ollama\\ollama.exe',
  );
  assert.equal(resolveOllamaExecutable('win32', env, only('C:\\Program Files\\Ollama\\ollama.exe')), 'C:\\Program Files\\Ollama\\ollama.exe');
  assert.equal(resolveOllamaExecutable('win32', env, only('D:\\Tools\\Ollama\\ollama.exe')), 'D:\\Tools\\Ollama\\ollama.exe');
  assert.equal(
    resolveOllamaExecutable('win32', { localappdata: 'C:\\L', PATH: '' }, only('C:\\L\\Programs\\Ollama\\ollama.exe')),
    'C:\\L\\Programs\\Ollama\\ollama.exe',
    'env names are case-insensitive on Windows',
  );
  for (const c of ollamaExecutableCandidates('win32', env)) assert.match(c, /ollama\.exe$/);
});

test('nothing installed: the bare name, as before (the caller reports ENOENT the same way)', () => {
  assert.equal(resolveOllamaExecutable('darwin', FINDER_PATH, () => false, '/Users/jo'), 'ollama');
  assert.equal(resolveOllamaExecutable('win32', {}, () => false), 'ollama');
  assert.equal(resolveOllamaExecutable('linux', { PATH: '/usr/bin' }, () => true), 'ollama', 'no guesses on an unsupported OS');
});

test('both places that start `ollama serve` use the resolver', () => {
  for (const file of ['electron/services/OllamaManager.ts', 'electron/rag/OllamaBootstrap.ts']) {
    const src = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    assert.equal(/spawn\('ollama'/.test(src), false, `${file}: no bare-name spawn`);
    assert.match(src, /resolveOllamaExecutable\(\)/, file);
  }
});
