// Every speech provider CredentialsManager can store must be named where a
// user reads it. PR #671 added Qwen to Settings and main but not here, so Help
// › Setup said "No speech provider chosen yet" to a Qwen user with a key, and
// the failover notice would have said "qwen".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');

const { sttProviderName } = await import(pathToFileURL(path.join(repo, 'dist-electron/electron/audio/sttFailover.js')).href);
const { speechStep, speechProviderLabel } = await import(pathToFileURL(path.join(repo, 'src/lib/helpSetupStatus.mjs')).href);

/** The ids in `sttProvider?: 'none' | 'google' | …` of StoredCredentials. */
function storedSttProviders() {
  const src = fs.readFileSync(path.join(repo, 'electron/services/CredentialsManager.ts'), 'utf8');
  const union = src.match(/sttProvider\?:\s*([^;]+);/);
  assert.ok(union, 'StoredCredentials.sttProvider not found');
  return [...union[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((id) => id !== 'none');
}

test('the stored provider list is read (guards the parser itself)', () => {
  const ids = storedSttProviders();
  assert.ok(ids.includes('deepgram') && ids.includes('qwen'), ids.join(','));
});

test('every stored speech provider has a name in Help › Setup and in the failover notice', () => {
  for (const id of storedSttProviders()) {
    assert.ok(speechProviderLabel(id), `helpSetupStatus SPEECH_PROVIDERS has no "${id}"`);
    assert.notEqual(sttProviderName(id), id, `sttFailover STT_PROVIDER_NAMES has no "${id}"`);
  }
});

test('Help › Setup: Qwen is done with a key and asks for one without, on both platforms', () => {
  for (const platform of ['darwin', 'win32']) {
    assert.deepEqual(speechStep(platform, { sttProvider: 'qwen', hasQwenAsrKey: true }),
      { state: 'done', detail: 'Qwen ASR · key saved' });
    assert.deepEqual(speechStep(platform, { sttProvider: 'qwen', hasQwenAsrKey: false }),
      { state: 'todo', detail: 'Qwen ASR · needs a key' });
  }
});
