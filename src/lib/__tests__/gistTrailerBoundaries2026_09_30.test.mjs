// src/lib/__tests__/gistTrailerBoundaries2026_09_30.test.mjs
//
// [[GIST]] is display metadata (the overlay/phone chip), not answer text.
// Before 2026-09-30 the main process never removed it: it was stored raw in
// session history, the usage DB and the phone mirror, and leaked as literal
// text through the follow-up-questions copy button and the phone's "Copy
// conversation". stripGistTrailer (displayMarkup.ts) is the one helper every
// copy/persist boundary uses; the chip itself still renders from the raw text.
//
//   1. stripGistTrailer semantics (same parser as the chip: splitGistLine).
//   2. Wiring: every copy path and every persistence chokepoint uses it.
//
// Pure string logic + source reads; identical on macOS and Windows.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripGistTrailer, splitGistLine } from '../displayMarkup.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const SRC = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n');

describe('stripGistTrailer', () => {
  test('removes a trailing gist line and keeps the body exactly', () => {
    assert.equal(stripGistTrailer('I shard by tenant.\n\nThen replicas.\n[[GIST]] Shard, then replicate'), 'I shard by tenant.\n\nThen replicas.');
  });
  test('agrees with the chip parser on every honored shape', () => {
    for (const raw of [
      'Body.\n[[GIST]] five word essence here',
      'Body.\n- [[GIST]] bullet gist',
      'Body sentence. [[GIST]] glued gist here',
      'Body.\n[[GIST]]\nbroken line gist',
    ]) {
      assert.equal(stripGistTrailer(raw), splitGistLine(raw).body, raw);
      assert.ok(!stripGistTrailer(raw).includes('[[GIST]]'), raw);
    }
  });
  test('text without a marker is returned untouched (not even end-trimmed)', () => {
    assert.equal(stripGistTrailer('No gist here.\n\n'), 'No gist here.\n\n');
    assert.equal(stripGistTrailer(''), '');
    assert.equal(stripGistTrailer(undefined), '');
  });
  test('a mid-sentence marker is prose, not a gist, and stays (same rule as the chip)', () => {
    const raw = 'You sort them [[GIST]] first, then subtract the smaller one from the larger one every time.';
    assert.equal(stripGistTrailer(raw), raw);
  });
  test('a code answer keeps its fence and loses only the gist', () => {
    const raw = '```python\nprint(1)\n```\n[[GIST]] Print one';
    assert.equal(stripGistTrailer(raw), '```python\nprint(1)\n```');
  });
});

describe('copy paths never copy the marker', () => {
  const ni = SRC('src/components/NativelyInterface.tsx');
  // 78991843 (main) dropped the answer cards' copy buttons; code blocks keep
  // their own (code only). What must hold: no remaining button copies raw
  // msg.text, which would carry the [[GIST]] line.
  test('overlay: no card copies raw msg.text', () => {
    assert.doesNotMatch(ni, /<CardCopyButton\s+text=\{msg\.text\}/);
    assert.doesNotMatch(ni, /clipboard\.writeText\(msg\.text\)/);
  });
  test('global chat: "Copy message" strips it', () => {
    assert.match(SRC('src/components/GlobalChatOverlay.tsx'), /navigator\.clipboard\.writeText\(stripGistTrailer\(content\)\)/);
  });
  test('phone: "Copy conversation" copies bodies; per-answer copy already did', () => {
    const client = SRC('electron/services/phoneMirrorClient.ts');
    assert.match(client, /parts\.push\(\(e\.label \? '\[' \+ e\.label \+ '\] ' : ''\) \+ splitGist\(e\.content\)\.body\)/);
    assert.match(client, /copyText\(splitGist\(entry\.content\)\.body\)/);
    // The chip still renders when content arrives without its gist line.
    assert.match(client, /gist = entry\.gist \|\| split\.gist;/);
  });
});

describe('persistence stores the answer without the marker', () => {
  test('SessionTracker: history, transcript and usage log', () => {
    const st = SRC('electron/SessionTracker.ts');
    assert.match(st, /import \{ stripGistTrailer \} from '\.\.\/src\/lib\/displayMarkup';/);
    assert.match(st, /const cleanText = stripGistTrailer\(text\)\.trim\(\);/);
    assert.match(st, /answer: typeof answer === 'string' \? stripGistTrailer\(answer\) : answer,/);
    assert.match(st, /\{ \.\.\.entry, answer: stripGistTrailer\(entry\.answer\) \}/);
  });
  test('phone mirror: content is the text, the gist rides separately; rendered from the raw answer', () => {
    const svc = SRC('electron/services/PhoneMirrorService.ts');
    const fn = svc.slice(svc.indexOf('private answerPayload(raw: string)'));
    assert.match(fn, /const rendered = this\.renderAnswer\(raw\);\s*const content = stripGistTrailer\(raw\);/);
    assert.match(svc, /const payload = this\.answerPayload\(content\);[\s\S]{0,200}this\.broadcast\(\{ type: 'done', streamId, createdAt, \.\.\.payload \}\)/);
    assert.match(svc, /this\.broadcast\(\{ type: 'assistant', id: msg\.id, label, createdAt, \.\.\.payload \}\)/);
  });
  test('the doc-grounded exact-repeat check compares stripped text with stripped history', () => {
    assert.match(SRC('electron/ipcHandlers.ts'), /stripGistTrailer\(trimmed\)\.trim\(\) === priorAnswer/);
  });
});
