// Raw Hindsight retain→recall smoke test against a running embedded server.
// Proves: server up, Gemini fact-extraction works, client↔server contract holds,
// and tag-based bank isolation excludes a foreign scope.
//
// Usage:  HINDSIGHT_BASE_URL=http://localhost:8888 node scripts/hindsight-smoke-test.mjs
import { HindsightClient } from '@vectorize-io/hindsight-client';

const baseUrl = process.env.HINDSIGHT_BASE_URL || 'http://localhost:8888';
const client = new HindsightClient({ baseUrl });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const bankA = 'smoke_user_alice';
  const bankB = 'smoke_user_bob';
  console.log(`[smoke] baseUrl=${baseUrl}`);

  // 1. Retain a fact for Alice (async server-side extraction).
  console.log('[smoke] retain → Alice bank...');
  await client.retain(bankA, 'Alice works at Google as a staff software engineer on Redis caching.', {
    tags: ['user:alice', 'visibility:private', 'source:meeting_summary'],
    async: false, // synchronous so recall sees it immediately in this test
  });
  console.log('[smoke] retain OK');

  // Give the server a moment to consolidate even if async kicked in.
  await sleep(1500);

  // 2. Recall from Alice's bank — should find the Redis/Google fact.
  console.log('[smoke] recall ← Alice bank...');
  const aliceRes = await client.recall(bankA, 'Where does Alice work and on what?', {
    tags: ['user:alice', 'visibility:private'],
    tagsMatch: 'all_strict',
    maxTokens: 1024,
  });
  const aliceTexts = (aliceRes?.results || []).map((r) => r.text);
  console.log(`[smoke] Alice recall returned ${aliceTexts.length} result(s):`);
  aliceTexts.forEach((t, i) => console.log(`   [${i}] ${String(t).slice(0, 120)}`));
  const found = aliceTexts.some((t) => /google|redis/i.test(String(t)));
  console.log(`[smoke] Alice fact recalled: ${found ? 'YES ✅' : 'NO ❌'}`);

  // 3. Isolation: Bob's bank must NOT see Alice's fact.
  console.log('[smoke] recall ← Bob bank (isolation check)...');
  const bobRes = await client.recall(bankB, 'Where does Alice work?', {
    tags: ['user:bob', 'visibility:private'],
    tagsMatch: 'all_strict',
    maxTokens: 1024,
  });
  const bobTexts = (bobRes?.results || []).map((r) => String(r.text));
  const leaked = bobTexts.some((t) => /google|redis|alice/i.test(t));
  console.log(`[smoke] Bob recall returned ${bobTexts.length} result(s); leaked Alice data: ${leaked ? 'YES ❌' : 'NO ✅'}`);

  // Verdict.
  if (found && !leaked) {
    console.log('\n[smoke] ✅ PASS — retain→recall works and bank isolation holds.');
    process.exit(0);
  } else {
    console.log('\n[smoke] ❌ FAIL — see results above.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('[smoke] ERROR:', e?.message || e);
  if (e?.statusCode) console.error('[smoke] HTTP status:', e.statusCode);
  process.exit(2);
});
