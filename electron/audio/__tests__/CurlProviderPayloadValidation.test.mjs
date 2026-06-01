import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ipcHandlersPath = path.resolve(__dirname, '../../../electron/ipcHandlers.ts');
const ipcSource = readFileSync(ipcHandlersPath, 'utf8');

function extractHandler(channel) {
  const start = ipcSource.indexOf(`safeHandle('${channel}'`);
  assert.ok(start >= 0, `could not locate ${channel}`);
  let i = ipcSource.indexOf('{', start);
  let depth = 1;
  const bodyStart = i + 1;
  i++;
  while (i < ipcSource.length && depth > 0) {
    const ch = ipcSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, `unbalanced braces while extracting ${channel}`);
  return ipcSource.slice(bodyStart, i - 1);
}

test('curl provider save handlers validate renderer payloads before persistence', () => {
  const validatorIndex = ipcSource.indexOf('const validateCurlProviderPayload');
  assert.ok(validatorIndex >= 0, 'BUG: curl provider payload validator must exist.');
  let i = ipcSource.indexOf('=> {', validatorIndex);
  assert.ok(i >= 0, 'could not locate validateCurlProviderPayload body');
  i = ipcSource.indexOf('{', i);
  let depth = 1;
  const bodyStart = i + 1;
  i++;
  while (i < ipcSource.length && depth > 0) {
    const ch = ipcSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, 'unbalanced braces while extracting validateCurlProviderPayload');
  const validatorBody = ipcSource.slice(bodyStart, i - 1);

  for (const field of ['id', 'name', 'curlCommand']) {
    assert.ok(validatorBody.includes(`typeof (provider as any).${field} !== 'string'`),
      `BUG: validator must require string ${field}.`);
  }
  assert.ok(
    /curlCommand[\s\S]*\.includes\(\s*['"]\{\{TEXT\}\}['"]\s*\)/.test(validatorBody),
    'BUG: validator must require {{TEXT}} prompt injection placeholder.',
  );
  assert.ok(
    /responsePath['"]?\s+in\s+provider[\s\S]*typeof\s+\(provider as any\)\.responsePath\s+!==\s+['"]string['"]/.test(validatorBody),
    'BUG: optional responsePath must be type-checked before persistence.',
  );

  for (const channel of ['save-custom-provider', 'save-curl-provider']) {
    const body = extractHandler(channel);
    assert.ok(
      /const\s+validation\s*=\s*validateCurlProviderPayload\(provider\)/.test(body),
      `BUG: ${channel} must use the shared payload validator.`,
    );
    assert.ok(
      /if\s*\(\s*!validation\.ok\s*\)[\s\S]*return\s*\{\s*success:\s*false,\s*error:\s*validation\.error\s*\}/.test(body),
      `BUG: ${channel} must reject invalid providers before saveCurlProvider.`,
    );
    assert.ok(
      /saveCurlProvider\(provider as any\)/.test(body),
      `BUG: ${channel} should only persist after validation succeeds.`,
    );
  }
});
