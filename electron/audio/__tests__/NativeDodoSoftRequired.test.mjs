import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const loaderPath = path.resolve(__dirname, '../nativeModuleLoader.ts');
const source = readFileSync(loaderPath, 'utf8');

test('Dodo native methods remain soft-required and warning tells developers how to fix stale binaries', () => {
  assert.match(
    source,
    /const\s+SOFT_REQUIRED_METHODS\s*=\s*\[\s*['"]verifyDodoKey['"]\s*,\s*['"]validateDodoKey['"]\s*,\s*['"]deactivateDodoKey['"]\s*\]/,
    'Dodo wrapper exports should stay soft-required so stale dev binaries do not disable the whole native module.',
  );
  assert.doesNotMatch(
    source,
    /const\s+REQUIRED_METHODS\s*=\s*\[[^\]]*verifyDodoKey[\s\S]*?\]/,
    'Dodo wrapper exports must not be promoted to hard-required methods; audio and Gumroad should keep working on stale dev binaries.',
  );
  assert.match(
    source,
    /npm\s+run\s+build:native/,
    'Missing-Dodo warning should explicitly tell developers to run npm run build:native.',
  );
});
