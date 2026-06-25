// Regression test for issue #299: the overlay "Ask anything" chat field must
// wrap long text vertically instead of horizontally scrolling after one line.
//
// Rendering NativelyInterface requires a broad Electron IPC surface, so this
// test follows the repo's existing source-level overlay wiring tests.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(root, 'src/components/NativelyInterface.tsx'), 'utf8');

function overlayChatInputRegion() {
  const anchor = source.indexOf('data-testid="overlay-chat-input"');
  assert.ok(anchor >= 0, 'overlay chat input test id must exist');

  const start = source.lastIndexOf('<textarea', anchor);
  assert.ok(start >= 0, 'overlay chat input must be a textarea');

  const end = source.indexOf('{/* Skill picker', anchor);
  assert.ok(end > start, 'could not find end of overlay chat input region');

  return source.slice(start, end);
}

describe('overlay chat input multiline behavior', () => {
  const region = overlayChatInputRegion();

  test('uses a textarea with wrapping and no manual resize handle', () => {
    assert.match(region, /<textarea\b/, 'chat input must be a textarea');
    assert.doesNotMatch(region, /\btype="text"\b/, 'chat input must not regress to a single-line input');
    assert.match(region, /\brows=\{1\}/, 'textarea should start compact');
    assert.match(region, /\bresize-none\b/, 'textarea should not expose a manual resize handle');
    assert.match(region, /\bwhitespace-pre-wrap\b/, 'textarea should preserve explicit newlines');
    assert.match(region, /\bbreak-words\b/, 'long words should wrap inside the fixed overlay width');
    assert.match(region, /(^|\s)max-h-\[112px\](\s|$)/, 'CSS max height should match the JS pixel cap');
    assert.doesNotMatch(region, /(^|\s)max-h-28(\s|$)/, 'CSS max height must not use a rem-based cap');
  });

  test('auto-sizes from content with a bounded height', () => {
    assert.match(source, /const CHAT_INPUT_MIN_HEIGHT_PX = 42;/, 'minimum input height must be explicit');
    assert.match(source, /const CHAT_INPUT_MAX_HEIGHT_PX = 112;/, 'maximum input height must be explicit');
    assert.match(
      source,
      /useLayoutEffect\(\(\) => \{[\s\S]*input\.style\.height = 'auto';[\s\S]*const scrollHeight = input\.scrollHeight;[\s\S]*Math\.max\(scrollHeight, CHAT_INPUT_MIN_HEIGHT_PX\)[\s\S]*scrollHeight > CHAT_INPUT_MAX_HEIGHT_PX/s,
      'input should resize from one cached scrollHeight read and enable vertical overflow only past the cap',
    );
  });

  test('keeps Enter-to-send while allowing Shift+Enter newlines', () => {
    assert.match(region, /e\.key !== 'Enter' \|\| e\.repeat \|\| e\.shiftKey \|\| e\.nativeEvent\.isComposing/, 'Shift+Enter and IME composition must not submit');
    assert.match(region, /e\.preventDefault\(\);\s*handleManualSubmit\(\);/, 'plain Enter should still submit');
    assert.match(region, /e\.key === 'Tab' \|\| \(e\.key === 'Enter' && !e\.repeat\)/, 'skill picker Enter selection should be preserved');
  });
});
