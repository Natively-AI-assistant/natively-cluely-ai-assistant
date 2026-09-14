import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeStealthCaretLeft } from '../stealthCaretPosition.mjs';

// Geometry only — measureTextWidth needs a canvas and is exercised in the app.
// This is the half that decides WHERE the caret lands, and it is pure.

test('inside the box, the caret sits immediately after the text', () => {
  assert.equal(
    computeStealthCaretLeft({ textWidth: 40, paddingLeft: 12, contentWidth: 200 }),
    52,
  );
});

test('an empty value parks the caret at the text start, not at zero', () => {
  // Zero would put it on the border, outside the padding — visibly wrong, and
  // wrong in the exact state the user sees first (placeholder showing).
  assert.equal(
    computeStealthCaretLeft({ textWidth: 0, paddingLeft: 12, contentWidth: 200 }),
    12,
  );
});

test('once the text overflows, the caret pins to the right edge of the content area', () => {
  // The component scrolls the input to its end in this case, so the tail of the
  // string is flush right and the caret belongs there. `pad + textWidth` would
  // put it far off the visible box.
  assert.equal(
    computeStealthCaretLeft({ textWidth: 900, paddingLeft: 12, contentWidth: 200 }),
    212,
  );
});

test('exactly-full text is the boundary case and does not jump', () => {
  const pad = 12;
  const content = 200;
  const atEdge = computeStealthCaretLeft({ textWidth: content, paddingLeft: pad, contentWidth: content });
  const justUnder = computeStealthCaretLeft({ textWidth: content - 1, paddingLeft: pad, contentWidth: content });
  const justOver = computeStealthCaretLeft({ textWidth: content + 1, paddingLeft: pad, contentWidth: content });
  assert.equal(atEdge, pad + content);
  assert.equal(justOver, atEdge, 'overflow must not move the caret past the edge it already reached');
  assert.equal(justUnder, pad + content - 1);
});

test('the result is monotonic in text width — a caret never moves backwards as you type', () => {
  let prev = -Infinity;
  for (let w = 0; w <= 400; w += 7) {
    const left = computeStealthCaretLeft({ textWidth: w, paddingLeft: 12, contentWidth: 200 });
    assert.ok(left >= prev, `caret moved left going from a narrower value to ${w}px`);
    prev = left;
  }
});

test('never renders left of the padding, whatever the inputs', () => {
  for (const m of [
    { textWidth: -50, paddingLeft: 12, contentWidth: 200 },
    { textWidth: 10, paddingLeft: -5, contentWidth: 200 },
    { textWidth: 10, paddingLeft: 12, contentWidth: -200 },
  ]) {
    const left = computeStealthCaretLeft(m);
    assert.ok(left >= 0, `negative offset from ${JSON.stringify(m)}`);
  }
});

test('non-finite measurements degrade to the text start instead of NaN', () => {
  // getComputedStyle can hand back '' for an unlaid-out element; parseFloat('')
  // is NaN. A NaN `left` makes React drop the style and the caret renders at
  // the wrapper's origin — over the icon, outside the input.
  for (const m of [
    { textWidth: NaN, paddingLeft: 12, contentWidth: 200 },
    { textWidth: 10, paddingLeft: NaN, contentWidth: 200 },
    { textWidth: 10, paddingLeft: 12, contentWidth: NaN },
    { textWidth: Infinity, paddingLeft: 12, contentWidth: 200 },
  ]) {
    const left = computeStealthCaretLeft(m);
    assert.ok(Number.isFinite(left), `non-finite left from ${JSON.stringify(m)}`);
  }
});

test('a zero-width box keeps the caret at the padding rather than drifting', () => {
  // Happens for one frame while the overlay expands from collapsed.
  assert.equal(
    computeStealthCaretLeft({ textWidth: 80, paddingLeft: 12, contentWidth: 0 }),
    12,
  );
});
