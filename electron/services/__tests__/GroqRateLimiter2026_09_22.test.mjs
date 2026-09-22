import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../dist-electron/electron/services/RateLimiter.js');
const load = () => import(pathToFileURL(modulePath).href);

// The client-side Groq bucket was 6 req/min — below Groq's own documented
// free-tier ceiling (30 RPM for chat models). acquire() queues instead of
// failing, so the 7th Groq request inside a minute waited up to 10 s in
// silence. One Auto Answer question on Groq is up to three requests (judge,
// prefetch, answer), so an interview hit the wall within two questions.

test('the Groq bucket admits a burst of a full question set without queueing', async () => {
  const { createProviderRateLimiters } = await load();
  const { groq } = createProviderRateLimiters();
  const start = Date.now();
  // 7 back-to-back acquires used to stall on the 7th for ~10 s.
  for (let i = 0; i < 7; i++) await groq.acquire();
  assert.ok(Date.now() - start < 200, 'no acquire waited on the bucket');
});

test('the Groq bucket is not lower than the provider ceiling it is meant to mirror (30 RPM)', async () => {
  const { createProviderRateLimiters } = await load();
  const { groq } = createProviderRateLimiters();
  const start = Date.now();
  for (let i = 0; i < 30; i++) await groq.acquire();
  assert.ok(Date.now() - start < 500, '30 requests in a minute are within Groq\'s documented free tier');
});
