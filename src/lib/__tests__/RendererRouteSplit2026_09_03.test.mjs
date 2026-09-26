// Regression test for: every window evaluated the entire app bundle.
//
// THE BUG. All Natively windows load the same index.html with a different
// `?window=` param, and main.tsx mounted `App` for every one of them. `App`
// statically imports NativelyInterface, which pulls react-markdown,
// react-syntax-highlighter and KaTeX. So the 36px overlay resize toggle
// evaluated the whole application to render thirty DOM nodes.
//
// MEASURED 2026-09-03 (dev, macOS, per-window JS heap read over CDP):
//
//   window            BEFORE                      AFTER
//                     heap  files  katex/md       heap  files  katex/md
//   overlay-toggle    52MB   219    loaded        12MB    17    not loaded
//   overlay-pill      47MB   218    loaded        12MB    17    not loaded
//   cropper           47MB   218    loaded        12MB    18    not loaded
//   launcher          66MB   218    loaded        55MB   213    loaded
//
//   whole-app RSS:    1219.9 MB  ->  917.9 MB
//
// The launcher still loads everything, correctly — it renders the real UI.
//
// THE FIX, guarded here: main.tsx branches on the window param BEFORE importing
// anything heavy. The light routes mount AuxRoot; everything else dynamically
// imports App. Both sides must stay dynamic: a static `import App from "./App"`
// puts App in the entry chunk and silently undoes the whole split, which is
// exactly the regression this test exists to catch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const mainSource = readFileSync(path.join(repoRoot, 'src/main.tsx'), 'utf8');
const auxSource = readFileSync(path.join(repoRoot, 'src/AuxRoot.tsx'), 'utf8');

test('main.tsx does not statically import App', () => {
    assert.doesNotMatch(
        mainSource,
        /^\s*import\s+App\s+from\s+["']\.\/App["']/m,
        'a static `import App from "./App"` in the entry puts the whole application — including ' +
        'react-markdown, react-syntax-highlighter and KaTeX — into the entry chunk, so every ' +
        'window evaluates it again. App must be imported dynamically inside the route branch.',
    );
    assert.match(
        mainSource,
        /import\(['"]\.\/App['"]\)/,
        'App must still be reachable via a dynamic import on the non-light branch',
    );
});

test('the light routes mount AuxRoot instead of App', () => {
    assert.match(
        mainSource,
        /LIGHT_ROUTES\s*=\s*\[[^\]]*'overlay-pill'[^\]]*'overlay-toggle'[^\]]*'cropper'[^\]]*'settings'[^\]]*'model-selector'[^\]]*\]/s,
        'main.tsx must route every light window to the light root: the aux pair, the cropper, and ' +
        'the two panels. settings and model-selector were split on 2026-09-04 after measuring ' +
        'them at 51MB / 213-219 JS files each to render 57-76 DOM nodes; afterwards 13-15MB and ' +
        '26-29 files, with katex/markdown/highlighter no longer loaded at all.',
    );
    assert.match(
        mainSource,
        /import\(['"]\.\/AuxRoot['"]\)/,
        'AuxRoot must be imported dynamically so it is a chunk of its own',
    );
});

test('AuxRoot never reaches the heavy renderer surface', () => {
    // The point of the split. NativelyInterface is the component that drags in
    // markdown + KaTeX + the syntax highlighter; App is what drags in
    // everything else.
    for (const forbidden of ['./App', 'NativelyInterface', 'react-markdown', 'katex', 'react-syntax-highlighter']) {
        assert.doesNotMatch(
            auxSource,
            new RegExp(`from\\s+['"][^'"]*${forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
            `AuxRoot must not import ${forbidden} — importing it puts the heavy renderer surface ` +
            'back into the pill/toggle/cropper windows and undoes the split.',
        );
    }
});

test('AuxRoot does not pull i18n back in', () => {
    // Nothing on these routes uses translation. A provider that needs i18n
    // would re-add a 365 kB chunk to three windows that render <35 nodes.
    assert.doesNotMatch(
        auxSource,
        /from\s+['"][^'"]*i18n/,
        'AuxRoot must not import the i18n bundle',
    );
});

test('the light-route list in main.tsx matches AuxRoot capabilities', () => {
    const declared = [...mainSource.matchAll(/'(overlay-pill|overlay-toggle|cropper)'/g)].map((m) => m[1]);
    for (const route of new Set(declared)) {
        assert.match(
            auxSource,
            new RegExp(`'${route}'`),
            `main.tsx routes "${route}" to AuxRoot, but AuxRoot does not handle it — that window ` +
            'would render the fallback branch instead of its real UI.',
        );
    }
});

test('the split panels keep the provider stack App gave them', () => {
    // They render inside QueryClientProvider + ToastProvider + ErrorBoundary in
    // App, and the components rely on that. Splitting them out without the
    // providers would compile and then fail at runtime.
    for (const needed of ['QueryClientProvider', 'ToastProvider', 'ToastViewport', 'ErrorBoundary']) {
        assert.match(
            auxSource,
            new RegExp(`\\b${needed}\\b`),
            `AuxRoot must provide ${needed} — the panel routes were rendered inside it in App`,
        );
    }
});

test('the overlay is deliberately NOT split', () => {
    // It renders NativelyInterface, whose import graph genuinely needs
    // react-syntax-highlighter and katex to show meeting answers. Splitting it
    // would either break rendering or just move the same weight.
    const mainSrc = readFileSync(path.join(repoRoot, 'src/main.tsx'), 'utf8');
    const list = /LIGHT_ROUTES\s*=\s*\[([^\]]*)\]/s.exec(mainSrc)?.[1] ?? '';
    assert.doesNotMatch(
        list,
        /'overlay'/,
        "the 'overlay' route must keep mounting App — it needs the markdown/katex surface",
    );
});
