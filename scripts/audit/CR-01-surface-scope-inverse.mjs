/**
 * CR-01 (code-review HIGH #1): F-303 made supersession surface-scoped in BOTH
 * directions, but only "phone interrupts desktop" was reasoned about. The
 * inverse — desktop question typed while a phone-mirror answer streams —
 * strands the desktop turn: its tokens are dropped and its done is not honored,
 * and NativelyInterface returns on !honor BEFORE setIsProcessing(false).
 */
import { resolveChatStreamToken, resolveChatStreamDone } from '../../src/lib/chatStreamGuard.mjs';

const show = (label, r) => console.log(`  ${label}: ${JSON.stringify(r)}`);

console.log('--- direction A: phone interrupts an active DESKTOP answer (F-303 target) ---');
let tok = resolveChatStreamToken(6, 7, 'desktop', 'phone');
show('phone token vs active desktop', tok);
console.log(`  desktop bubble protected: ${tok.accept === false} (expected true)`);

console.log('\n--- direction B: user types on DESKTOP while a PHONE answer streams (the inverse) ---');
const tokB = resolveChatStreamToken(6, 7, 'phone', 'desktop');
show('desktop token vs active phone', tokB);
const doneB = resolveChatStreamDone(6, 7, 'phone', undefined); // untagged done → 'desktop'
show('desktop done  vs active phone', doneB);

const answerLost = tokB.accept === false;
const spinnerStuck = doneB.honor === false && doneB.release !== true;
console.log(`\n  [half 1] desktop tokens dropped (answer never paints)     : ${answerLost}`);
console.log(`  [half 2] desktop spinner never released (permanent hang) : ${spinnerStuck}`);

// Half 2 is FIXED: the guard now reports release for a cross-surface done that
// belongs to the local surface, and the renderer calls setIsProcessing(false).
// Half 1 is NOT fixed and is not fixable at this layer: the renderer hosts ONE
// streaming row, so accepting the desktop tokens would merge them into the
// phone bubble — exactly the corruption F-303 was added to stop. Hosting two
// concurrent streams needs a per-surface row, which is a product change.
console.log(`\n  half 2 fixed (guard reports release=${doneB.release === true}): ${!spinnerStuck}`);
if (!spinnerStuck && answerLost) {
  console.log('\nPARTIAL: the permanent spinner is fixed; the dropped desktop answer needs a per-surface row.');
  process.exit(0);
}
if (spinnerStuck) { console.log('\nREGRESSED: the spinner is stuck again.'); process.exit(3); }
console.log('\nBOTH halves resolved.');
process.exit(0);
