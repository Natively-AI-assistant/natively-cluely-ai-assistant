/**
 * R-02 repro — F-303's surface-scoped guard permanently bricks desktop chat
 * after any failed phone turn.
 *
 * Sequence (all real, all reachable today):
 *   1. A phone turn emits >=1 token, tagged source:'phone' (ipcHandlers.ts:12814)
 *      -> renderer adopts {activeId, activeSource:'phone'}.
 *   2. The provider throws AFTER committing tokens (LLMHelper.ts:6866 rethrows
 *      when geminiYielded). ipcHandlers.ts:12851 sends `gemini-stream-error`
 *      with source:'phone-mirror'. NO `gemini-stream-done` is ever sent.
 *   3. The renderer early-returns on source==='phone-mirror' to keep the phone
 *      failure out of the desktop UI -- and, before the fix, returned BEFORE
 *      releasing the guard.
 *   4. Every subsequent DESKTOP stream is untagged -> normalizes to 'desktop'
 *      -> curSrc !== inSrc -> accept:false, and its done -> honor:false.
 *
 * Result before the fix: the desktop user gets no text at all and a spinner
 * that never stops, for every question, until they press Escape.
 *
 * Run: node scripts/audit/R-02-repro.mjs
 */
import {
  resolveChatStreamToken,
  resolveChatStreamDone,
  resolveChatStreamSurfaceError,
} from '../../src/lib/chatStreamGuard.mjs';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`[R-02] ${ok ? 'ok  ' : 'FAIL'} ${label}: ${actual} (expected ${expected})`);
};

// Renderer guard state.
let activeId = null;
let activeSource = null;

const onToken = (id, source) => {
  const d = resolveChatStreamToken(activeId, id, activeSource, source);
  activeId = d.activeId;
  activeSource = d.activeSource ?? null;
  return d.accept;
};
const onDone = (id, source) => {
  const d = resolveChatStreamDone(activeId, id, activeSource, source);
  activeId = d.activeId;
  activeSource = d.activeSource ?? null;
  return d.honor;
};
// Mirrors the renderer's phone-mirror early-return branch.
// `--pre-fix` replays the ORIGINAL branch (a bare `return;` before any reset)
// so this harness can demonstrate the defect it claims to fix.
const PRE_FIX = process.argv.includes('--pre-fix');
const onError = (source, streamId) => {
  if (source === 'phone-mirror') {
    if (PRE_FIX) return;
    if (resolveChatStreamSurfaceError(activeSource, source).release) {
      activeId = null;
      activeSource = null;
    }
    return;
  }
  // The handler's pre-existing tagged-error guard: an error carrying a
  // streamId that is not the adopted one must not tear down this stream.
  if (typeof streamId === 'number' && activeId !== null && streamId !== activeId) return;
  activeId = null;
  activeSource = null;
};

// 1. Phone turn commits a token, then fails post-commit with no `done`.
check('phone token 100 accepted', onToken(100, 'phone'), true);
onError('phone-mirror');
console.log(`[R-02] guard after phone error : activeId=${activeId} activeSource=${activeSource}`);

// 2. The next DESKTOP turn must render normally.
check('desktop token 101 accepted', onToken(101, undefined), true);
check('desktop done  101 honored ', onDone(101, undefined), true);

// 3. And the turn after that, too (the pre-fix failure was permanent).
check('desktop token 102 accepted', onToken(102, undefined), true);
check('desktop done  102 honored ', onDone(102, undefined), true);

// 4. Regression guard: the ORIGINAL F-303 defect must stay fixed — a phone
//    stream starting mid-desktop-answer must NOT steal the desktop bubble.
activeId = null; activeSource = null;
check('desktop token 200 accepted', onToken(200, undefined), true);
check('phone token 201 REJECTED  ', onToken(201, 'phone'), false);
check('phone done  201 NOT honored', onDone(201, 'phone'), false);
check('desktop token 200 still ok ', onToken(200, undefined), true);

// 5. A desktop error tagged with a DIFFERENT streamId must not release a guard
//    owned by the phone surface (the handler's pre-existing tagged-error guard).
activeId = null; activeSource = null;
onToken(300, 'phone');
onError(undefined, 301);
check('phone guard survives foreign desktop error', activeSource, 'phone');

if (failures) {
  console.error(`[R-02] FAIL: ${failures} assertion(s) failed — desktop chat is bricked after a failed phone turn.`);
  process.exit(1);
}
console.log('[R-02] PASS: a failed phone turn releases the guard; desktop chat keeps working.');
