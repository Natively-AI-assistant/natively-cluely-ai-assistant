import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const servicesTestsDir = __dirname;
const llmTestsDir = path.resolve(__dirname, '../../llm/__tests__');

function listTestFiles(dir) {
  return fs.readdirSync(dir)
    .filter(fileName => fileName.endsWith('.test.mjs'))
    .map(fileName => path.join(dir, fileName));
}

test('package test discovery includes every Node test file in services and llm folders', () => {
  const serviceTests = listTestFiles(servicesTestsDir);
  const llmTests = listTestFiles(llmTestsDir);
  const allTests = [...serviceTests, ...llmTests];

  assert.ok(serviceTests.length >= 25, `expected at least 25 service tests, found ${serviceTests.length}`);
  assert.ok(llmTests.length >= 5, `expected at least 5 llm tests, found ${llmTests.length}`);
  assert.equal(allTests.length, new Set(allTests).size, 'test discovery should not include duplicates');
  assert.ok(allTests.some(filePath => filePath.endsWith('TelemetryService.test.mjs')));
  assert.ok(allTests.some(filePath => filePath.endsWith('PostCallWorkflow.test.mjs')));
  assert.ok(allTests.some(filePath => filePath.endsWith('ProviderRouter.test.mjs')));
});
