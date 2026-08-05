// scripts/role-insight-harness/build.mjs
//
// Builds the Role Insight visual harness.
//
// The Profile Intelligence token set is EXTRACTED from the real component
// source (the `PI_CSS` template literal in ProfileIntelligenceSettings.tsx)
// rather than copied into the harness. If the panel's tokens change, the
// harness picks the change up on the next build — a hand-copied stylesheet
// would quietly drift and start lying about how the feature looks.

import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(__dirname, 'dist');

fs.mkdirSync(OUT, { recursive: true });

// ── 1. Extract PI_CSS from the real component ────────────────────────────────
const panelSrc = fs.readFileSync(path.join(ROOT, 'src/components/ProfileIntelligenceSettings.tsx'), 'utf8');
const piMatch = /^const PI_CSS = `([\s\S]*?)^`;$/m.exec(panelSrc);
if (!piMatch) throw new Error('Could not extract PI_CSS from ProfileIntelligenceSettings.tsx — the harness would render untokenized.');
const PI_CSS = piMatch[1];

// ── 2. Extract the periwinkle scale from the real stylesheet ─────────────────
const indexCss = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8');
const periwinkle = [...indexCss.matchAll(/--periwinkle-[a-z0-9-]+:\s*[^;]+;/g)].map(m => m[0]);
if (periwinkle.length === 0) throw new Error('Could not extract the periwinkle scale from src/index.css.');

const css = `
:root { ${periwinkle.join(' ')} }
* { box-sizing: border-box; }
body { margin: 0; }
${PI_CSS}
`;
fs.writeFileSync(path.join(OUT, 'harness.css'), css);

// ── 3. Bundle both harnesses ─────────────────────────────────────────────────
// entry.tsx  — Role Insight alone, every state, for iteration.
// panel.tsx  — the REAL ProfileIntelligenceSettings with all six sections, for
//              judging whether Role Insight belongs next to its siblings.
// Redirect the Vite-only premium barrel to a direct-import shim. Without this
// esbuild leaves `import.meta.glob` empty and every premium export silently
// becomes NullComponent — the harness would render an empty Role Insight
// section while looking perfectly healthy.
const premiumBarrelShim = {
    name: 'premium-barrel-shim',
    setup(build) {
        const shim = path.join(__dirname, 'premium-shim.tsx');
        build.onResolve({ filter: /(^|\/)premium$/ }, (args) => {
            if (!args.importer.includes(`${path.sep}src${path.sep}`)) return null;
            return { path: shim };
        });
    },
};

const common = {
    bundle: true,
    format: 'iife',
    jsx: 'automatic',
    loader: { '.json': 'json', '.png': 'dataurl', '.svg': 'dataurl' },
    // DEVELOPMENT, deliberately: `npm run app:dev` serves the renderer from the
    // Vite dev server, and StrictMode only double-invokes effects in a
    // development build. A production-mode harness silently cannot reproduce
    // mount→cleanup→remount bugs — which is exactly how one shipped.
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [premiumBarrelShim],
    logLevel: 'warning',
};

await esbuild.build({
    ...common,
    entryPoints: [path.join(__dirname, 'entry.tsx')],
    outfile: path.join(OUT, 'harness.js'),
});

await esbuild.build({
    ...common,
    entryPoints: [path.join(__dirname, 'panel.tsx')],
    outfile: path.join(OUT, 'panel.js'),
});

await esbuild.build({
    ...common,
    entryPoints: [path.join(__dirname, 'modes.tsx')],
    outfile: path.join(OUT, 'modes.js'),
});

fs.writeFileSync(path.join(OUT, 'modes.html'), `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Modes Manager</title>
<link rel="stylesheet" href="./harness.css">
<style>html,body{height:100%;margin:0}</style>
</head>
<body><div id="root"></div><script src="./modes.js"></script></body>
</html>
`);

fs.writeFileSync(path.join(OUT, 'panel.html'), `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Profile Intelligence — full panel</title>
<link rel="stylesheet" href="./harness.css">
<style>html,body{height:100%;margin:0}</style>
</head>
<body>
<div id="root"></div>
<script src="./panel.js"></script>
</body>
</html>
`);

fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Role Insight — visual harness</title>
<link rel="stylesheet" href="./harness.css">
</head>
<body>
<div id="root"></div>
<script src="./harness.js"></script>
</body>
</html>
`);

console.log(`Harness built → ${path.join(OUT, 'index.html')}`);
console.log(`  PI_CSS: ${PI_CSS.length} chars · periwinkle tokens: ${periwinkle.length}`);
