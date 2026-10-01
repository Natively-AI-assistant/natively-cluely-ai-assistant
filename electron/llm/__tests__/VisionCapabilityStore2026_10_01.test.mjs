/**
 * The vision capability store (2026-10-01): provider-published answers, saved.
 * In-memory until main configures a file, so tests and benchmarks never touch
 * the disk by accident; one instance for every bundle (globalThis), because the
 * build gives each entry its own copy of this module.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: { app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' }, safeStorage: { isEncryptionAvailable: () => false } },
};
const S = require(dist('llm/visionCapabilityStore.js'));

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vcs-')), 'vision-capabilities.json');
const answers = (o) => new Map(Object.entries(o));

describe('answers', () => {
  test('a stored answer is returned for its provider, base URL and model only', () => {
    const s = new S.VisionCapabilityStore({ filePath: null });
    s.replaceProviderAnswers('openrouter', '', answers({ 'openai/gpt-4o': true, 'deepseek/deepseek-v4-flash': false }));
    assert.equal(s.answer('openrouter', '', 'openai/gpt-4o'), true);
    assert.equal(s.answer('openrouter', '', 'deepseek/deepseek-v4-flash'), false);
    assert.equal(s.answer('openrouter', '', 'never/listed'), undefined, 'absent is unknown, never "no"');
    assert.equal(s.answer('openrouter', 'http://other', 'openai/gpt-4o'), undefined, 'another base URL is another provider');
    assert.equal(s.answer('litellm', '', 'openai/gpt-4o'), undefined);
  });
  test('a refresh replaces the whole catalogue for that provider and base URL', () => {
    const s = new S.VisionCapabilityStore({ filePath: null, now: () => 1000 });
    s.replaceProviderAnswers('openrouter', '', answers({ 'a/one': true }));
    s.replaceProviderAnswers('openrouter', '', answers({ 'b/two': false }));
    assert.equal(s.answer('openrouter', '', 'a/one'), undefined, 'a model gone from the catalogue is forgotten');
    assert.equal(s.answer('openrouter', '', 'b/two'), false);
    assert.equal(s.fetchedAt('openrouter', ''), 1000);
  });
});

describe('persistence', () => {
  test('in-memory by default: nothing is written until a file is configured', () => {
    S.__setVisionCapabilityStore(null);
    const s = S.getVisionCapabilityStore();
    assert.equal(s.filePath, null, 'the shared default has no file; only main configures one');
    s.replaceProviderAnswers('openrouter', '', answers({ 'x/y': true }));
    assert.equal(s.answer('openrouter', '', 'x/y'), true, 'and still answers in memory');
    S.__setVisionCapabilityStore(null);
  });
  test('a configured file round-trips', () => {
    const file = tmpFile();
    const a = new S.VisionCapabilityStore({ filePath: file, now: () => 42 });
    a.replaceProviderAnswers('openrouter', '', answers({ 'openai/gpt-4o': true, 'z/text': false }));
    const b = new S.VisionCapabilityStore({ filePath: file });
    assert.equal(b.answer('openrouter', '', 'openai/gpt-4o'), true);
    assert.equal(b.answer('openrouter', '', 'z/text'), false);
    assert.equal(b.fetchedAt('openrouter', ''), 42);
  });
  for (const [label, body] of [['corrupt JSON', '{not json'], ['a foreign shape', '{"version":99,"providers":"nope"}'], ['an empty file', '']]) {
    test(`${label} starts empty instead of crashing`, () => {
      const file = tmpFile();
      fs.writeFileSync(file, body);
      const s = new S.VisionCapabilityStore({ filePath: file });
      assert.equal(s.answer('openrouter', '', 'openai/gpt-4o'), undefined);
      s.replaceProviderAnswers('openrouter', '', answers({ 'openai/gpt-4o': true }));
      assert.equal(new S.VisionCapabilityStore({ filePath: file }).answer('openrouter', '', 'openai/gpt-4o'), true, 'and the next write repairs it');
    });
  }
  test('configureVisionCapabilityStore loads the file into the shared instance', () => {
    const file = tmpFile();
    new S.VisionCapabilityStore({ filePath: file }).replaceProviderAnswers('openrouter', '', answers({ 'openai/gpt-4o': true }));
    S.configureVisionCapabilityStore(file);
    assert.equal(S.getVisionCapabilityStore().answer('openrouter', '', 'openai/gpt-4o'), true);
    S.__setVisionCapabilityStore(null);
  });
});

describe('one instance for every bundle', () => {
  test('the singleton lives on globalThis', () => {
    S.__setVisionCapabilityStore(null);
    const s = S.getVisionCapabilityStore();
    const onGlobal = Object.values(globalThis).includes(s);
    assert.ok(onGlobal, 'each esbuild entry carries its own copy of this module; only globalThis is shared');
    S.__setVisionCapabilityStore(null);
  });
  test('storedVisionAnswer strips the routing prefix', () => {
    const s = new S.VisionCapabilityStore({ filePath: null });
    s.replaceProviderAnswers('openrouter', '', answers({ 'openai/gpt-4o': true }));
    S.__setVisionCapabilityStore(s);
    assert.equal(S.storedVisionAnswer('openrouter', 'openrouter/openai/gpt-4o'), true);
    assert.equal(S.storedVisionAnswer('openrouter', 'openrouter/unknown/model'), undefined);
    S.__setVisionCapabilityStore(null);
  });
});

test('main configures the store before LLMHelper exists, under the dev:agent userData', () => {
  const main = fs.readFileSync(path.join(__dirname, '../../main.ts'), 'utf8');
  const configure = main.indexOf('configureVisionCapabilityStore(');
  const helper = main.indexOf('this.processingHelper = new ProcessingHelper(this)');
  assert.ok(configure > 0 && helper > 0 && configure < helper, 'configure must run before the first setModel');
  assert.match(main.slice(configure - 200, configure + 200), /app\.getPath\('userData'\)/);
});
describe('test results (phase 3)', () => {
  test('a recorded test is returned with its time, for that provider, base URL and model only', () => {
    const s = new S.VisionCapabilityStore({ filePath: null, now: () => 500 });
    s.recordTest('fluxion', '', 'glm-5.3', false);
    assert.deepEqual(s.tested('fluxion', '', 'glm-5.3'), { reads: false, at: 500 });
    assert.equal(s.tested('fluxion', '', 'other'), undefined);
    assert.equal(s.tested('agentrouter', '', 'glm-5.3'), undefined);
    assert.equal(s.tested('fluxion', 'http://x', 'glm-5.3'), undefined);
  });
  test('tests and catalogues do not disturb each other, and both round-trip', () => {
    const file = tmpFile();
    const a = new S.VisionCapabilityStore({ filePath: file, now: () => 7 });
    a.replaceProviderAnswers('openrouter', '', answers({ 'openai/gpt-4o': true }));
    a.recordTest('openrouter', '', 'new/model', true);
    a.replaceProviderAnswers('openrouter', '', answers({ 'openai/gpt-4o': true, 'b/c': false }));
    const b = new S.VisionCapabilityStore({ filePath: file });
    assert.deepEqual(b.tested('openrouter', '', 'new/model'), { reads: true, at: 7 }, 'a catalogue refresh keeps test results');
    assert.equal(b.answer('openrouter', '', 'b/c'), false);
  });
  test('a phase-2 file (no tests section) loads with its catalogue intact', () => {
    const file = tmpFile();
    fs.writeFileSync(file, JSON.stringify({ version: 1, providers: { 'openrouter|': { fetchedAt: 9, models: { 'openai/gpt-4o': true } } } }));
    const s = new S.VisionCapabilityStore({ filePath: file });
    assert.equal(s.answer('openrouter', '', 'openai/gpt-4o'), true);
    assert.equal(s.fetchedAt('openrouter', ''), 9);
    assert.equal(s.tested('openrouter', '', 'openai/gpt-4o'), undefined);
  });
  test('a malformed tests section is ignored without losing the catalogue', () => {
    const file = tmpFile();
    fs.writeFileSync(file, JSON.stringify({ version: 1, providers: { 'openrouter|': { fetchedAt: 9, models: { 'a/b': true } } }, tests: { 'x|': { m: { reads: 'yes', at: 'never' } }, bad: 5 } }));
    const s = new S.VisionCapabilityStore({ filePath: file });
    assert.equal(s.answer('openrouter', '', 'a/b'), true);
    assert.equal(s.tested('x', '', 'm'), undefined);
  });
  test('storedVisionTest strips the routing prefix; normalizeVisionBaseURL makes writer and reader agree', () => {
    const s = new S.VisionCapabilityStore({ filePath: null, now: () => 1 });
    s.recordTest('litellm', S.normalizeVisionBaseURL('http://localhost:4000/v1/'), 'my-model', true);
    S.__setVisionCapabilityStore(s);
    assert.deepEqual(S.storedVisionTest('litellm', 'litellm/my-model', S.normalizeVisionBaseURL('http://localhost:4000')), { reads: true, at: 1 });
    assert.equal(S.normalizeVisionBaseURL(' http://h:1/v1// '), 'http://h:1');
    assert.equal(S.normalizeVisionBaseURL(undefined), '');
    S.__setVisionCapabilityStore(null);
  });
});
