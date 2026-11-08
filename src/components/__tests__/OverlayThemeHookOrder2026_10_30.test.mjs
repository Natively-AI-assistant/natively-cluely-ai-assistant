// The overlay called useResolvedTheme() behind `interfaceTheme === 'lavender' ||`,
// so the hook was skipped while the theme was Lavender. Since Lavender became
// the light Default (2026-10-30), a light/dark switch flipped the hook order
// and the overlay crashed with React's "Should have a queue" (seen live in
// dev:agent). No hook in the overlay or Settings may sit behind ||, && or ?.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const SHORT_CIRCUITED_HOOK = /(\|\||&&|\?)\s*use[A-Z][A-Za-z]*\(/;

test('the overlay reads the resolved theme on every render', () => {
  const ni = read('src/components/NativelyInterface.tsx');
  // Since Lavender's dark set (2026-10-31) every style but glass and modern
  // follows the app, so the panel's light/dark is the app's.
  assert.match(ni, /const resolvedTheme = useResolvedTheme\(\);\s*const isLightTheme = resolvedTheme === 'light';/);
});

test('no hook call sits behind ||, && or ? in the overlay or Settings', () => {
  const files = [
    'src/components/NativelyInterface.tsx',
    ...readdirSync(join(root, 'src/components/settings')).filter((f) => f.endsWith('.tsx')).map((f) => `src/components/settings/${f}`),
  ];
  for (const file of files) {
    const hit = read(file).split('\n').find((line) => SHORT_CIRCUITED_HOOK.test(line) && !line.trim().startsWith('//') && !line.trim().startsWith('*'));
    assert.equal(hit, undefined, `${file}: ${hit?.trim()}`);
  }
});
