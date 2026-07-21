import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ipcHandlersPath = path.resolve(__dirname, '../../../electron/ipcHandlers.ts');
const ipcSource = readFileSync(ipcHandlersPath, 'utf8');

function extractForwardLogHandler() {
  const start = ipcSource.indexOf("safeOn('forward-log-to-file'");
  assert.ok(start >= 0, "could not locate forward-log-to-file safeOn registration");
  let i = ipcSource.indexOf('{', start);
  assert.ok(i >= 0, 'could not find opening brace for forward-log-to-file handler');
  let depth = 1;
  const bodyStart = i + 1;
  i++;
  while (i < ipcSource.length && depth > 0) {
    const ch = ipcSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, 'unbalanced braces while extracting forward-log-to-file handler');
  return ipcSource.slice(bodyStart, i - 1);
}

test('forward-log-to-file validates types, scrubs control characters, caps length, rate-limits, and tags sender', () => {
  const body = extractForwardLogHandler();
  assert.ok(
    /typeof\s+level\s*!==\s*['"]string['"][\s\S]*typeof\s+msg\s*!==\s*['"]string['"]/.test(body),
    'BUG: forward-log-to-file must reject non-string level/msg payloads from renderers.',
  );
  assert.ok(
    /msg\s*\.replace\s*\(\s*\/\[\\r\\n\\x00[\s\S]+?,\s*['"] ['"]\s*\)\s*\.slice\s*\(\s*0\s*,\s*FORWARD_LOG_MAX_LEN\s*\)/.test(body),
    'BUG: forward-log-to-file must scrub control characters (CWE-117) and cap message length.',
  );
  assert.ok(
    /_forwardLogBuckets\.get\s*\(\s*senderId\s*\)/.test(body) &&
      /bucket\.tokens\s*<=\s*0/.test(body) &&
      /bucket\.tokens\s*-=\s*1/.test(body),
    'BUG: forward-log-to-file must apply a per-sender token-bucket rate limit.',
  );
  assert.ok(
    /Math\.floor\(\(elapsed\s*\*\s*FORWARD_LOG_RATE_BUCKET\)\s*\/\s*FORWARD_LOG_RATE_REFILL_MS\)/.test(body),
    'BUG: forward-log-to-file token bucket must refill proportionally to elapsed time, not snap to full once per second.',
  );
  assert.ok(
    /event\.sender\?\.\s*once\?\.\s*\(\s*['"]destroyed['"]/.test(body) &&
      /_forwardLogBuckets\.delete\s*\(\s*senderId\s*\)/.test(body),
    'BUG: forward-log-to-file must reap per-sender buckets when the renderer is destroyed.',
  );
  assert.ok(
    /event\.sender\?\.\s*id\s*\?\?\s*-1/.test(body) && /\[\$\{senderId\}\]/.test(body),
    'BUG: forward-log-to-file must include the sender id in the log line for diagnostics.',
  );
  assert.ok(
    /FORWARD_LOG_MAX_LEN\s*=\s*4\s*\*\s*1024/.test(ipcSource) &&
      /FORWARD_LOG_RATE_BUCKET\s*=\s*200/.test(ipcSource) &&
      /FORWARD_LOG_RATE_REFILL_MS\s*=\s*1_000/.test(ipcSource),
    'BUG: forward-log-to-file must declare bounded length and per-second refill constants.',
  );
});
