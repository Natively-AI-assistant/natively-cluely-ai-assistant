// Guards the company-research search-provider wiring after skip-premium.
//
// Premium CompanyResearchEngine / Tavily / Natively providers are gone. The
// shared resolver must stay the single injection seam, return null, and the
// manual research-company handler must delegate to it (no inline cascade).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('shared resolver always returns null in OSS / skip-premium builds', () => {
  const { resolveCompanySearchProvider } = require(
    path.join(root, 'dist-electron/electron/services/resolveCompanySearchProvider.js'),
  );
  assert.equal(resolveCompanySearchProvider(), null);
});

test('shared resolver source has no hard premium requires', () => {
  const src = read('electron/services/resolveCompanySearchProvider.ts');
  assert.doesNotMatch(src, /require\(['"].*premium\//);
  assert.doesNotMatch(src, /from ['"].*premium\//);
  assert.match(src, /return null/);
});

test('main.ts injects the shared resolver into the orchestrator when available', () => {
  const src = read('electron/main.ts');
  assert.ok(
    src.includes('setSearchProviderResolver(resolveCompanySearchProvider)'),
    'main.ts must inject resolveCompanySearchProvider at orchestrator init',
  );
});

test('manual research-company handler uses the SAME shared resolver (no drift)', () => {
  const src = read('electron/ipcHandlers.ts');
  const handler = src.indexOf("safeHandle('profile:research-company'");
  assert.ok(handler >= 0);
  const nextHandler = src.indexOf('safeHandle(', handler + 1);
  const body = src.slice(handler, nextHandler);
  assert.ok(
    body.includes('resolveCompanySearchProvider()'),
    'manual path must delegate to the shared resolver',
  );
  assert.ok(
    !body.includes('new TavilySearchProvider'),
    'no inline cascade left in the handler',
  );
  assert.ok(
    !body.includes("require('../premium/"),
    'handler must not hard-require premium modules',
  );
});

test('OSS KnowledgeOrchestrator stubs company research engine to null', () => {
  const src = read('electron/knowledge/KnowledgeOrchestrator.ts');
  assert.match(src, /getCompanyResearchEngine\(\):\s*null/);
});
