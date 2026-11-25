/**
 * Core Electron code may REQUIRE the private premium submodule at runtime,
 * but must never make the TYPE checker open it.
 *
 * Fork pull requests do not receive the private `premium/` checkout, so Build
 * Smoke runs `typecheck:electron` without it. A runtime `require('../premium/…')`
 * is fine there (it types as `any`, and the core-smoke esbuild marks it
 * external). A `typeof import('../premium/…')`, `import type … from`, or a static
 * `import … from` into that folder is not: tsc fails with TS2307. On 2026-11-21
 * two such casts in ipcHandlers.ts made EVERY fork PR fail Build Smoke, and it
 * went unnoticed until the next fork PR (#783, 2026-11-25), because trusted runs
 * always have the submodule.
 *
 * This runs in the full suite, so an internal PR catches the regression before
 * an outside contributor does.
 *
 * Run: node --test electron/services/__tests__/ForkSafePremiumTypeImports2026_11_25.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const electronDir = path.join(root, 'electron');
const privatePremium = path.join(root, 'premium') + path.sep;

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

// Specifiers the TYPE checker resolves: `import('x')` (incl. `typeof import`),
// `from 'x'` (static and `import type`), and bare `import 'x'`.
const TYPE_RESOLVED = [
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /^\s*import\s+['"]([^'"]+)['"]/gm,
];

test('no core Electron file makes tsc resolve a path inside the private premium submodule', () => {
  const offenders = [];
  for (const file of sourceFiles(electronDir)) {
    // Comments cannot break tsc, and the fix itself documents the bad shape:
    // blank out comment lines (keeping line numbers) before scanning.
    const text = fs.readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => (/^\s*(\/\/|\/\*|\*)/.test(l) ? '' : l))
      .join('\n');
    for (const pattern of TYPE_RESOLVED) {
      for (const m of text.matchAll(pattern)) {
        const spec = m[1];
        if (!spec.startsWith('.')) continue;
        const target = path.resolve(path.dirname(file), spec);
        if ((target + path.sep).startsWith(privatePremium) || target.startsWith(privatePremium)) {
          const line = text.slice(0, m.index).split('\n').length;
          offenders.push(`${path.relative(root, file)}:${line}  ${spec}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [],
    'Fork PRs typecheck without premium/. Use a runtime require() with a local type '
    + '(see LicenseVerifyPolicyModule in ipcHandlers.ts) instead of:\n  ' + offenders.join('\n  '));
});

test('the guard sees the shapes it is meant to catch', () => {
  const sample = [
    "const a = require('../premium/x') as typeof import('../premium/x');",
    "import type { T } from '../premium/y';",
    "import { U } from '../../premium/z';",
  ].join('\n');
  const found = TYPE_RESOLVED.flatMap((p) => [...sample.matchAll(p)].map((m) => m[1]));
  assert.deepEqual(found.sort(), ['../../premium/z', '../premium/x', '../premium/y']);
  assert.equal([..."require('../premium/x')".matchAll(TYPE_RESOLVED[0])].length, 0, 'a runtime require is allowed');
});

// The local type in ipcHandlers.ts is not checked against the real module by
// tsc any more, so check it here whenever the private source is present.
const policySource = path.join(root, 'premium/electron/services/licenseVerifyPolicy.ts');
test('LicenseVerifyPolicyModule still matches the real premium export', { skip: !fs.existsSync(policySource) && 'premium submodule not checked out (fork PR)' }, () => {
  const real = fs.readFileSync(policySource, 'utf8');
  assert.match(real, /export function normalizePastedKey\(raw: unknown\): string/);
  const ipc = fs.readFileSync(path.join(electronDir, 'ipcHandlers.ts'), 'utf8');
  assert.match(ipc, /type LicenseVerifyPolicyModule = \{ normalizePastedKey\(raw: unknown\): string \};/);
});
