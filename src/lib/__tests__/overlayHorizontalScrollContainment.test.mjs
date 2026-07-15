// Regression test for the meeting overlay becoming horizontally scrollable.
//
// The chat viewport may scroll vertically, but horizontal scrolling belongs only
// to code blocks. Long unbreakable code lines must therefore scroll inside the
// dedicated code scroller without widening MessageRow or the outer chat pane.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(__dirname, '../../components/NativelyInterface.tsx');
const source = readFileSync(sourcePath, 'utf8');

test('meeting chat viewport disables horizontal scrolling while retaining vertical scrolling', () => {
  assert.match(
    source,
    /ref=\{scrollContainerRef\}[\s\S]{0,180}className="[^"]*overflow-y-auto[^"]*overflow-x-hidden[^"]*"/,
    'BUG: the meeting chat viewport must combine overflow-y-auto with overflow-x-hidden so regular answers cannot move the whole interface sideways.',
  );
});

test('code answers retain a dedicated contained horizontal scroller', () => {
  assert.match(
    source,
    /className="w-full min-w-0 bg-transparent overflow-x-auto"/,
    'BUG: long code lines must keep scrolling inside a w-full min-w-0 overflow-x-auto code container.',
  );
  assert.match(
    source,
    /wrapLongLines=\{false\}/,
    'Code lines should remain unwrapped; containment belongs on the code scroller rather than by changing code presentation.',
  );
});

test('message flex boundaries allow code scroller to shrink inside the chat viewport', () => {
  assert.match(
    source,
    /<div className="w-full min-w-0"[^>]*data-code-msg/,
    'BUG: MessageRow root must use min-w-0 or an unbreakable code line can enlarge the entire chat viewport.',
  );
  assert.match(
    source,
    /className=\{`flex min-w-0 \$\{msg\.role/,
    'BUG: MessageRow flex wrapper must use min-w-0 so its code child can shrink and scroll internally.',
  );
  assert.match(
    source,
    /min-w-0 \$\{bubbleMaxClass\} text-\[15px\]/,
    'BUG: the message bubble must use min-w-0 so intrinsic code width does not escape the row.',
  );
});
