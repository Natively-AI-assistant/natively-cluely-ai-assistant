/**
 * The Auto Answer host hooks are plain callbacks, so a hook wired to a method
 * that does not exist is not a compile error at the call site — it is a
 * `TypeError: … is not a function` at RUNTIME, thrown inside whichever
 * defensive catch the engine wraps it in.
 *
 * That is not hypothetical. `prefetchAnswer` was wired to
 * `intelligenceManager.prefetchAutoAnswer` the day the prefetch landed
 * (0d5bf7fb), while the method only ever existed on IntelligenceEngine. Every
 * call threw straight into `maybePrefetch`'s "prefetch is an optimisation;
 * never break the pipeline" catch, so the feature silently never ran for
 * weeks — no `Auto Answer prefetch fired` line appears in any captured log —
 * and it was invisible to `tsc` too, because the renderer tsconfig does not
 * cover electron/.
 *
 * This pins the whole class: every manager method the host block calls must
 * actually be declared on IntelligenceManager.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/** The `new SimpleAutoAnswerEngine({ … })` host literal, brace-matched. */
function hostBlock(source) {
    const start = source.indexOf('new SimpleAutoAnswerEngine({');
    assert.notEqual(start, -1, 'the SimpleAutoAnswerEngine host block must exist in main.ts');
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('unbalanced braces in the host block');
}

test('every IntelligenceManager method the Auto Answer host calls actually exists', () => {
    const block = hostBlock(read('electron/main.ts'));
    const manager = read('electron/IntelligenceManager.ts');

    const called = [...block.matchAll(/this\.intelligenceManager\.([A-Za-z0-9_]+)\s*\(/g)]
        .map((m) => m[1]);
    assert.ok(called.length >= 5, `expected several manager calls in the host block, found ${called.length}`);

    const missing = [...new Set(called)].filter((name) => {
        // A method declaration on the class: `name(` or `async name(` at member
        // indentation. Deliberately not a bare substring match — the string
        // "prefetchAutoAnswer" appears in comments even when the method does not.
        const decl = new RegExp(`^\\s{2,8}(?:public\\s+|private\\s+|protected\\s+)?(?:async\\s+)?${name}\\s*(?:<[^>]*>)?\\s*\\(`, 'm');
        return !decl.test(manager);
    });

    assert.deepEqual(missing, [],
        `wired to IntelligenceManager but not declared there — these throw at runtime inside the engine's catch: ${missing.join(', ')}`);
});

test('the engine-side counterparts exist too, so the delegation cannot dangle', () => {
    const engine = read('electron/IntelligenceEngine.ts');
    for (const name of ['prefetchAutoAnswer', 'noteAutoAnswerCandidate', 'getSpeculativeSnapshot', 'runAutoAnswer']) {
        const decl = new RegExp(`^\\s{2,8}(?:public\\s+|private\\s+|protected\\s+)?(?:async\\s+)?${name}\\s*\\(`, 'm');
        assert.ok(decl.test(engine), `IntelligenceEngine.${name} must exist for the manager to delegate to`);
    }
});
