// electron/llm/__tests__/SpeakableSd.test.mjs
//
// Speakable-SD ticket 01: pure strip of DSA scaffolds + impl-language fences
// while keeping SPEC 10 ASCII HLD (```text / ```ascii). No Electron / Gemini.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/SpeakableSd.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/speakableSd.js');
const {
  toSpeakableSd,
  applySpeakableSdIfNeeded,
  mayCompressToSpeakable,
} = await import(pathToFileURL(modPath).href);

describe('toSpeakableSd — DSA scaffolds + impl fences → speakable', () => {
  test('strips DSA headings and python fence, keeps ascii HLD', () => {
    const fixture = [
      '## Approach',
      'We start with functional requirements for a URL shortener.',
      '',
      '## Technique / Data Structure / Algorithm Used',
      'Hash-based alias lookup.',
      '',
      '## Code',
      '```python',
      'def shorten(url):',
      '    return hash(url)[:7]',
      '```',
      '',
      '## Dry Run',
      'Input "https://example.com" maps to alias "a1b2c3d".',
      '',
      '## Complexity',
      'Time Complexity: O(1), because hash lookup is constant.',
      'Space Complexity: O(n), because we store n aliases.',
      '',
      '## Interviewer Follow-up Points',
      '- Hot-key cache eviction',
      '',
      'Here is the high-level design:',
      '```ascii',
      '[Client] --> [API Gateway] --> [Shortener Service]',
      '                                 |',
      '                                 v',
      '                              [Redis]',
      '```',
    ].join('\n');

    const out = toSpeakableSd(fixture);

    assert.doesNotMatch(out, /^##\s*Approach\b/m);
    assert.doesNotMatch(out, /^##\s*Technique/m);
    assert.doesNotMatch(out, /^##\s*Code\b/m);
    assert.doesNotMatch(out, /^##\s*Dry Run\b/m);
    assert.doesNotMatch(out, /^##\s*Complexity\b/m);
    assert.doesNotMatch(out, /^##\s*Interviewer Follow-up Points\b/m);
    assert.doesNotMatch(out, /```python/);
    assert.doesNotMatch(out, /def shorten/);
    assert.match(out, /```ascii/);
    assert.match(out, /\[Client\] --> \[API Gateway\]/);
    assert.match(out, /functional requirements for a URL shortener/i);
  });
});

describe('toSpeakableSd — identity for empty / already-speakable', () => {
  test('empty string is identity', () => {
    assert.equal(toSpeakableSd(''), '');
  });

  test('already-speakable SD prose is identity', () => {
    const prose = [
      "I'd start by clarifying functional requirements for the URL shortener,",
      'then sketch core entities like Alias and ClickEvent before we draw the HLD.',
      '',
      '```text',
      'Client -> API -> Shortener -> Store',
      '```',
    ].join('\n');
    assert.equal(toSpeakableSd(prose), prose);
  });

  test('keeps untagged brace/arrow HLD boxes (not impl code)', () => {
    const diagram = [
      'Here is the HLD:',
      '```',
      '{Client} --> {API Gateway} --> {Shortener}',
      '                  |',
      '                  v',
      '               {Redis}',
      '```',
    ].join('\n');
    const out = toSpeakableSd(diagram);
    assert.match(out, /\{Client\}/);
    assert.match(out, /\{Redis\}/);
  });

  test('scaffold-only dump can strip to empty (wire must not restore dirty)', () => {
    const onlyScaffold = '## Approach\n## Code\n```python\nx=1\n```\n## Complexity';
    const out = toSpeakableSd(onlyScaffold);
    assert.doesNotMatch(out, /## Approach/);
    assert.doesNotMatch(out, /```python/);
    assert.equal(applySpeakableSdIfNeeded('system_design_answer', onlyScaffold), out);
  });

  test('runs without Electron runtime', () => {
    assert.equal(process.versions.electron, undefined);
  });
});

describe('applySpeakableSdIfNeeded / mayCompressToSpeakable — WTA wire (ticket 04)', () => {
  test('strips only for system_design_answer', () => {
    const dirty = '## Approach\nWe clarify QPS first.\n```python\nx=1\n```';
    assert.match(applySpeakableSdIfNeeded('system_design_answer', dirty), /clarify QPS/i);
    assert.doesNotMatch(applySpeakableSdIfNeeded('system_design_answer', dirty), /```python/);
    assert.equal(applySpeakableSdIfNeeded('coding_question_answer', dirty), dirty);
    assert.equal(applySpeakableSdIfNeeded('behavioral_interview_answer', dirty), dirty);
  });

  test('mayCompressToSpeakable is false for system_design_answer only', () => {
    assert.equal(mayCompressToSpeakable('system_design_answer'), false);
    assert.equal(mayCompressToSpeakable('skills_answer'), true);
    assert.equal(mayCompressToSpeakable('coding_question_answer'), true);
  });
});
