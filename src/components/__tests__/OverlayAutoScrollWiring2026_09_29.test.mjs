// The overlay chat's follow-the-bottom behaviour is only as good as the least
// careful scroll path. These pin the wiring in NativelyInterface.tsx so a new
// path cannot quietly skip the interrupt state machine again:
//   - every way a user scrolls up detaches the chat synchronously,
//   - plain-text streaming (which bypasses React) is followed by the reveal
//     ticker, and
//   - nothing scrolls the chat with a bare scrollIntoView.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const src = readFileSync(join(root, 'src/components/NativelyInterface.tsx'), 'utf8');

// Drop comments so prose that mentions a call cannot satisfy or trip a check.
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The text from the first occurrence of `start` to the next occurrence of `end`. */
const between = (text, start, end) => {
  const i = text.indexOf(start);
  assert.notEqual(i, -1, `missing: ${start}`);
  const j = text.indexOf(end, i + start.length);
  assert.notEqual(j, -1, `missing end: ${end}`);
  return text.slice(i, j);
};

test('no bare scrollIntoView remains — sends go through scrollToLatest', () => {
  assert.ok(!/\.scrollIntoView\(/.test(code), 'scrollIntoView bypasses the interrupt state machine');
  assert.equal((code.match(/scrollToLatest\(\);/g) ?? []).length, 6);
});

test('scrollToLatest hands control back to auto-follow before scrolling', () => {
  const body = between(code, 'const scrollToLatest = useCallback(', '}, [resumeAutoScroll]);');
  assert.ok(body.indexOf('resumeAutoScroll()') < body.indexOf('scrollTop ='));
  assert.ok(!body.includes("behavior: 'smooth'"), 'smooth scroll fights the per-frame follow');
});

test('the wheel listener and the edge-strip forward share one wheel intent handler', () => {
  assert.match(code, /const onWheel = \(e: WheelEvent\) => handleWheelIntent\(e\.deltaY, e\.deltaX\);/);
  const strip = between(code, "data-resize-handle=\"e\"", 'scrollBy({ top: e.deltaY })');
  assert.ok(strip.includes('handleWheelIntent(e.deltaY, e.deltaX)'), 'strip wheel must detach before it scrolls');
});

test('the held-key scroll-up detaches the chat', () => {
  const branch = between(code, "isShortcutPressed(e, 'scrollUp')", 'startScrollLoop();');
  assert.ok(branch.includes('armAutoScrollInterrupt()'));
  assert.ok(branch.includes('canScrollUp('), 'only arm when there is somewhere to scroll up to');
});

test('the global-shortcut inertial kick detaches the chat on an upward vertical kick', () => {
  const kick = between(code, "const kick = (axis: 'vert' | 'horiz', direction: -1 | 1) => {", 'inertialScrollRef.current = { kick };');
  assert.match(kick, /direction < 0 && canScrollUp\(container\)\) armAutoScrollInterrupt\(\)/);
});

test('the scroll listener arms and re-arms through the shared helpers', () => {
  const handler = between(code, 'const handleScrollInterrupt = useCallback(', 'const handleWheelIntent');
  assert.ok(handler.includes('armAutoScrollInterrupt()'));
  assert.ok(handler.includes('resumeAutoScroll()'));
  assert.ok(!handler.includes('autoScrollSuppressedForMsgIdRef.current ='), 'no hand-rolled suppression writes');
});

test('the reveal ticker follows the bottom after every imperative paint', () => {
  const tick = between(code, 'const revealTick = useCallback(', 'const ensureRevealTicker');
  const paint = tick.indexOf('paintRevealedNow(ts);');
  assert.notEqual(paint, -1);
  assert.ok(tick.indexOf('followStreamBottom();', paint) > paint);
});

test('the stream follow yields to an upward move it did not make', () => {
  const follow = between(code, 'const followStreamBottom = useCallback(', '[armAutoScrollInterrupt]');
  assert.ok(follow.includes('detectExternalUpwardScroll'));
  assert.ok(follow.indexOf('armAutoScrollInterrupt()') < follow.indexOf('c.scrollTop = max'));
});

test('arming while idle never stores null (which reads as "not suppressed")', () => {
  const arm = between(code, 'const armAutoScrollInterrupt = useCallback(', '}, [setJumpToLatestVisible]);');
  assert.ok(arm.includes('suppressionKeyForArm(streamingId)'));
});

test('every path that hands control back also restores the sticky-bottom pin', () => {
  const resume = between(code, 'const resumeAutoScroll = useCallback(', '}, [setJumpToLatestVisible]);');
  assert.ok(resume.includes('wasAtBottomRef.current = true'));
  const jump = between(code, 'const handleJumpToLatest = useCallback(', '}, [resumeAutoScroll]);');
  assert.ok(jump.includes('resumeAutoScroll()'));
});

test('Cmd+B re-expand respects a detached chat and re-reads the container', () => {
  const effect = between(code, 'const grewWhileHidden', '}, [isExpanded, isAutoScrollSuppressed]);');
  assert.ok(effect.includes('isAutoScrollSuppressed()'));
  assert.ok(effect.includes('scrollContainerRef.current'));
});
