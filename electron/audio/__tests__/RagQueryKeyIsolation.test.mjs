import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ipcHandlersPath = path.resolve(__dirname, '../../../electron/ipcHandlers.ts');
const ipcSource = readFileSync(ipcHandlersPath, 'utf8');

function extractHandlerRegion(channel) {
  const start = ipcSource.indexOf(`'${channel}'`);
  assert.ok(start >= 0, `could not locate ${channel} handler`);
  const next = ipcSource.indexOf('safeHandle(', start + channel.length);
  return next > start ? ipcSource.slice(start, next) : ipcSource.slice(start);
}

test('rag:query-meeting uses a unique query key per concurrent same-meeting request', () => {
  const handlerRegion = extractHandlerRegion('rag:query-meeting');

  assert.ok(
    /const\s+queryKey\s*=\s*`meeting-\$\{meetingId\}-\$\{crypto\.randomUUID\(\)\}`/.test(handlerRegion),
    'BUG: rag:query-meeting must include crypto.randomUUID() in queryKey so concurrent queries for the same meeting do not overwrite AbortControllers.',
  );
  assert.ok(
    /activeRAGQueries\.set\s*\(\s*queryKey\s*,\s*abortController\s*\)/.test(handlerRegion),
    'BUG: rag:query-meeting must store each unique queryKey in activeRAGQueries.',
  );
  assert.ok(
    /finally\s*\{[^}]*activeRAGQueries\.delete\s*\(\s*queryKey\s*\)/s.test(handlerRegion),
    'BUG: rag:query-meeting must delete only its own unique queryKey in finally.',
  );
});

test('rag:cancel-query still cancels all meeting query keys by meeting prefix', () => {
  const handlerRegion = extractHandlerRegion('rag:cancel-query');

  assert.ok(
    /const\s+queryKey\s*=\s*global\s*\?\s*['"]global['"]\s*:\s*`meeting-\$\{meetingId\}`/.test(handlerRegion),
    'BUG: rag:cancel-query must keep the meeting-${meetingId} prefix so it matches UUID-suffixed meeting query keys.',
  );
  assert.ok(
    /if\s*\(\s*!global\s*&&\s*!meetingId\s*\)/.test(handlerRegion),
    'BUG: rag:cancel-query must reject missing meetingId for non-global cancellation.',
  );
  assert.ok(
    /key\.startsWith\s*\(\s*`\$\{queryKey\}-`\s*\)/.test(handlerRegion),
    'BUG: rag:cancel-query must match meeting keys with a delimiter so similarly-prefixed meeting IDs do not cross-cancel.',
  );
  assert.ok(
    /global\s*\?\s*key\.startsWith\s*\(\s*['"]global-['"]\s*\)/.test(handlerRegion),
    'BUG: rag:cancel-query must match global UUID-suffixed keys by global- prefix.',
  );
});
