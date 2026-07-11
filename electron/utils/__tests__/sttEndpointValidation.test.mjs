// electron/utils/__tests__/sttEndpointValidation.test.mjs
//
// SECURITY regression tests for the STT endpoint SSRF guards (Phase 2 hardening).
//
// THE BUG THIS PINS: the renderer-supplied Azure/IBM "region" was interpolated
// directly into the STT endpoint HOSTNAME
//   https://${region}.stt.speech.microsoft.com/...
//   https://api.${region}.speech-to-text.watson.cloud.ibm.com/...
// and the OpenAI-STT base URL was stored verbatim. A hostile/regressed renderer
// could set region="evil.com/x#" (or a private/loopback base URL) and redirect
// the user's API-key-bearing STT request to an attacker-controlled host.
//
// isValidSttRegion() accepts ONLY real region slugs; validateSttBaseUrl() reuses
// the SSRF URL guard. Both are enforced at the IPC setters, the test-connection
// path, and (defense in depth) in RestSTT's constructor.
//
// Run: ELECTRON_RUN_AS_NODE=1 electron --test (or node --test after build:electron)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/utils/curlUtils.js');
const { isValidSttRegion, validateSttBaseUrl } = await import(pathToFileURL(modPath).href);

describe('isValidSttRegion — accepts real region slugs', () => {
  for (const ok of ['eastus', 'westeurope', 'us-south', 'eu-gb', 'centralus', 'au-syd', 'jp-tok']) {
    test(`allows "${ok}"`, () => assert.equal(isValidSttRegion(ok), true));
  }

  test('allows empty / undefined / null (falls back to default region)', () => {
    assert.equal(isValidSttRegion(''), true);
    assert.equal(isValidSttRegion(undefined), true);
    assert.equal(isValidSttRegion(null), true);
  });
});

describe('isValidSttRegion — blocks host-injection payloads', () => {
  const bad = [
    'evil.com',                 // dot => breaks out of host label
    'evil.com/path',            // slash => path injection
    'evil.com#',                // fragment
    'evil.com?x=1',             // query
    'foo.attacker.net',         // extra label prefix
    'east us',                  // whitespace
    'EastUS',                   // uppercase (real regions are lowercase; be strict)
    'user:pass@evil.com',       // credentials
    '10.0.0.1',                 // dotted IP
    '-eastus',                  // leading hyphen
    'eastus-',                  // trailing hyphen
    'east--us'.padEnd(60, 'x'), // > 40 chars
    'east\n.evil',              // newline
    '..',                       // traversal-ish
  ];
  for (const b of bad) {
    test(`blocks ${JSON.stringify(b)}`, () => assert.equal(isValidSttRegion(b), false));
  }

  test('blocks non-string types', () => {
    assert.equal(isValidSttRegion(123), false);
    assert.equal(isValidSttRegion({}), false);
    assert.equal(isValidSttRegion([]), false);
  });
});

describe('validateSttBaseUrl — SSRF guard for OpenAI-compatible base URL', () => {
  test('allows empty (falls back to api.openai.com)', () => {
    assert.equal(validateSttBaseUrl('').isValid, true);
    assert.equal(validateSttBaseUrl(undefined).isValid, true);
  });

  test('allows a legitimate https endpoint', () => {
    assert.equal(validateSttBaseUrl('https://api.openai.com/v1').isValid, true);
    assert.equal(validateSttBaseUrl('https://my-proxy.example.com/v1').isValid, true);
  });

  test('blocks loopback', () => {
    assert.equal(validateSttBaseUrl('http://127.0.0.1:8080').isValid, false);
    assert.equal(validateSttBaseUrl('https://localhost/v1').isValid, false);
  });

  test('blocks private ranges', () => {
    assert.equal(validateSttBaseUrl('https://10.0.0.5/v1').isValid, false);
    assert.equal(validateSttBaseUrl('https://192.168.1.1/v1').isValid, false);
    assert.equal(validateSttBaseUrl('https://169.254.169.254/latest/meta-data').isValid, false);
  });

  test('blocks non-https + dangerous schemes', () => {
    assert.equal(validateSttBaseUrl('http://api.openai.com').isValid, false);
    assert.equal(validateSttBaseUrl('file:///etc/passwd').isValid, false);
    assert.equal(validateSttBaseUrl('//evil.com').isValid, false);
  });
});
