import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

/**
 * ISSUE 3 (P1): Custom cURL provider SSRF Protection
 *
 * The chatWithCurl function accepts a URL template from the cURL command and
 * performs variable substitution, then passes the resulting URL directly to axios
 * without validating it against internal/private address ranges.
 *
 * This allows SSRF attacks where an attacker could target:
 * - localhost (127.0.0.1, ::1)
 * - link-local (169.254.0.0/16)
 * - private networks (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 *
 * Fix: Add URL validation before making the request.
 */

test('chatWithCurl validates URL against SSRF-protected address ranges', () => {
  const source = read('electron/LLMHelper.ts');

  // Find the chatWithCurl function
  const chatWithCurlStart = source.indexOf('public async chatWithCurl(');
  assert.ok(chatWithCurlStart >= 0, 'chatWithCurl function should exist');

  // Extract the function body
  const functionEnd = source.indexOf(/\n\s*\}/, chatWithCurlStart);
  const nextFunction = source.indexOf('\n  public ', chatWithCurlStart + 10);
  const functionBody = source.slice(chatWithCurlStart, nextFunction > -1 && nextFunction < functionEnd ? nextFunction : functionEnd);

  // The function should validate URLs before making requests
  // Look for SSRF protection patterns:
  // - URL validation function imported or defined
  // - isPrivate/isLocal check before axios call
  // - hostname/IP extraction and range checking

  const hasSSRFProtection =
    /validateUrl|isPrivateUrl|isBlockedHost|checkUrlSafety|isInternalIp|isLoopback|isLinkLocal/.test(functionBody) ||
    /url\.startsWith\(['"]https:\/\//.test(functionBody) || // HTTPS enforcement
    /(hostname|host)\s*===\s*['"]127\.0\.0\.1['"|\s]/.test(functionBody) || // explicit localhost check
    /\/\.\.\/|\.\.\\/.test(functionBody); // path traversal check

  assert.ok(hasSSRFProtection, 'chatWithCurl should have SSRF protection (URL validation against private/internal ranges)');
});

test('URL validation function exists for SSRF protection', () => {
  const source = read('electron/LLMHelper.ts');
  const curlUtils = read('electron/utils/curlUtils.ts');

  const combinedSource = source + '\n' + curlUtils;

  // Should have a function to validate URLs
  const hasUrlValidation =
    /function\s+validate(Ssrf|Url|Hostname|UrlSafety)/.test(combinedSource) ||
    /const\s+validate(Ssrf|Url|Hostname|UrlSafety)/.test(combinedSource) ||
    /export\s+(function|const)\s+(validateSsrf|validateUrl|isPrivateUrl|isBlockedHost)/.test(combinedSource);

  assert.ok(hasUrlValidation, 'Should have a URL validation function for SSRF protection');
});

test('axios call in chatWithCurl uses validated URL', () => {
  const source = read('electron/LLMHelper.ts');

  const chatWithCurlStart = source.indexOf('public async chatWithCurl(');
  const nextFunction = source.indexOf('\n  public ', chatWithCurlStart + 10);
  const functionBody = source.slice(chatWithCurlStart, nextFunction > -1 ? nextFunction : chatWithCurlStart + 3000);

  // The axios call should be preceded by URL validation
  const axiosIndex = functionBody.indexOf('axios({');
  assert.ok(axiosIndex >= 0, 'axios call should exist in chatWithCurl');

  // Check that there's validation before axios
  const beforeAxios = functionBody.slice(0, axiosIndex);
  const hasValidation =
    /validate|check|isPrivate|isBlocked|isLocal|isLoopback|hostname/.test(beforeAxios) ||
    /url\.startsWith|https:\/\//.test(beforeAxios);

  assert.ok(hasValidation, 'URL should be validated before axios call');
});

test('path traversal is blocked in URL variable substitution', () => {
  const source = read('electron/LLMHelper.ts');

  const chatWithCurlStart = source.indexOf('public async chatWithCurl(');
  const nextFunction = source.indexOf('\n  public ', chatWithCurlStart + 10);
  const functionBody = source.slice(chatWithCurlStart, nextFunction > -1 ? nextFunction : chatWithCurlStart + 3000);

  // Check that URL variable replacement doesn't allow path traversal
  // The url should not contain ../ after variable replacement
  const urlReplacementIndex = functionBody.indexOf('deepVariableReplacer(curlConfig.url');
  assert.ok(urlReplacementIndex >= 0, 'URL should be processed through variable replacer');

  // After URL replacement, there should be a validation step
  const afterReplacement = functionBody.slice(urlReplacementIndex);
  const hasValidationAfterReplacement =
    /validate|check|isPrivate|isBlocked|isLocal/.test(afterReplacement.slice(0, afterReplacement.indexOf('axios(')));

  assert.ok(hasValidationAfterReplacement, 'URL should be validated after variable replacement');
});

test('blocked SSRF hosts are explicitly rejected', () => {
  const source = read('electron/LLMHelper.ts');
  const curlUtils = read('electron/utils/curlUtils.ts');
  const combined = source + '\n' + curlUtils;

  // Check for blocked host patterns
  const blockedPatterns = [
    'localhost', '127.0.0.1', '0.0.0.0', '::1',
    '169.254', 'link-local',
    '10.', '172.16', '192.168'
  ];

  const hasBlockedHosts = blockedPatterns.some(pattern =>
    /isBlocked|isPrivate|isLocal|blockList|denyList/.test(combined) &&
    combined.includes(pattern)
  );

  // Alternative: check for IP range validation
  const hasIPRangeValidation =
    /parseInt|Number\(.*\)\s*[<>]/.test(combined) ||
    /ip2int|ipToNumber|isInRange/.test(combined);

  assert.ok(hasBlockedHosts || hasIPRangeValidation, 'Should block SSRF targets: localhost, private ranges, link-local');
});

test('loopback guard covers the full 127.0.0.0/8 range, not just 127.0.0.1', () => {
  const curlUtils = read('electron/utils/curlUtils.ts');

  // Locate the branch that rejects loopback addresses.
  const loopbackIdx = curlUtils.indexOf("'Loopback addresses are not allowed'");
  assert.ok(loopbackIdx >= 0, 'loopback rejection should exist');

  // The guard preceding it must match the whole 127.0.0.0/8 range (e.g. via
  // hostname.startsWith('127.')). A check limited to the literal '127.0.0.1'
  // would let 127.0.0.2 and other in-range loopback addresses through.
  const guard = curlUtils.slice(curlUtils.lastIndexOf('if (', loopbackIdx), loopbackIdx);
  assert.ok(
    /startsWith\(\s*['"]127\.['"]\s*\)/.test(guard),
    'loopback guard should match the entire 127.0.0.0/8 range (e.g. hostname.startsWith("127."))'
  );
});