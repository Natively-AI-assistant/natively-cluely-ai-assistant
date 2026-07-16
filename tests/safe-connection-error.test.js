const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildSafeConnectionErrorInfo,
  redactSensitiveText,
} = require('../dist-electron/electron/utils/safeConnectionError.js');
const { formatSafeLogArgs } = require('../dist-electron/electron/utils/safeLog.js');

test('connection diagnostics omit axios request config and redact the active key', () => {
  const secret = 'sk-ant-test-secret-value-1234567890';
  const error = {
    code: 'ERR_BAD_REQUEST',
    message: `Request failed with Bearer ${secret}`,
    config: {
      headers: { Authorization: `Bearer ${secret}` },
    },
    response: {
      status: 401,
      statusText: 'Unauthorized',
      data: { error: { message: `Invalid API key: ${secret}` } },
    },
  };

  const safeInfo = buildSafeConnectionErrorInfo('claude', error, [secret]);
  const serialized = JSON.stringify(safeInfo);

  assert.equal(safeInfo.provider, 'claude');
  assert.equal(safeInfo.status, 401);
  assert.equal(safeInfo.code, 'ERR_BAD_REQUEST');
  assert.equal(Object.hasOwn(safeInfo, 'config'), false);
  assert.equal(serialized.includes(secret), false);
  assert.match(serialized, /\[REDACTED\]/);
});

test('common header, URL, and provider key formats are redacted', () => {
  const message = [
    'Authorization: Bearer abc.def.ghi',
    'https://example.test/models?key=AIza123456789012345678901234567890',
    'provider returned gsk_1234567890abcdefghijklmnop',
  ].join(' ');

  const redacted = redactSensitiveText(message);
  assert.equal(redacted.includes('abc.def.ghi'), false);
  assert.equal(redacted.includes('AIza123456789012345678901234567890'), false);
  assert.equal(redacted.includes('gsk_1234567890abcdefghijklmnop'), false);
});

test('persistent log formatting strips request config, credentials, and content fields', () => {
  const secret = 'soniox-private-value-123456';
  const formatted = formatSafeLogArgs([
    'provider failed',
    {
      message: `Authorization: Bearer ${secret}`,
      config: { headers: { Authorization: `Bearer ${secret}` } },
      transcript: 'private interview answer',
      response: { data: { text: 'private model output' } },
    },
  ]);

  assert.equal(formatted.includes(secret), false);
  assert.equal(formatted.includes('private interview answer'), false);
  assert.equal(formatted.includes('private model output'), false);
  assert.match(formatted, /\[REDACTED\]/);
});
