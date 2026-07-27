// electron/llm/__tests__/SdDeepDiveSoftChecksTier0.test.mjs
//
// Tier 0: post-stream deep-dive soft checks (SPEC 07).
// Assumption label, numeric flag, identity under requirements, fail-open.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/SdDeepDiveSoftChecksTier0.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distLlm = path.resolve(__dirname, '../../../dist-electron/electron/llm');

const soft = await import(pathToFileURL(path.join(distLlm, 'sdDeepDiveSoftChecks.js')).href);

const ASSUMPTION_MARKERS = [
  /as a design assumption/i,
  /i'?d assume/i,
  /\[assumption/i,
];

function hasAssumptionLabel(text) {
  return ASSUMPTION_MARKERS.some((re) => re.test(text));
}

function emptyMissContext() {
  return {
    lessonInjected: false,
    sheetCommittedTexts: [],
    lessonChunkTexts: [],
    recentAnswerTexts: [],
  };
}

describe('Deep-dive soft checks — identity under requirements (SPEC 07)', () => {
  test('sdPhase=requirements returns text unchanged despite LESSON-omit miss fixture', () => {
    const spoken =
      'For the API layer I would expose a POST /shorten endpoint that handles 50,000 QPS.';
    const out = soft.enforceDeepDiveChecks(spoken, 'requirements', emptyMissContext());
    assert.equal(out, spoken);
    assert.ok(!hasAssumptionLabel(out));
    assert.ok(!out.includes('[figure unverified]'));
  });
});

describe('Deep-dive soft checks — Check A assumption label (SPEC 07)', () => {
  test('LESSON-omit fixture prepends assumption label (post-gate)', () => {
    const spoken = 'I would put a write-through cache in front of the primary store.';
    const out = soft.enforceDeepDiveChecks(spoken, 'post_requirements', emptyMissContext());
    assert.ok(hasAssumptionLabel(out), `expected assumption label, got: ${out}`);
    assert.ok(out.includes(spoken), 'original answer body must be retained');
    assert.notEqual(out.trim(), '');
  });

  test('empty evidence corpus (evidence miss) gets assumption label even if lessonInjected', () => {
    const spoken = 'Shard by userId across 16 partitions.';
    const out = soft.enforceDeepDiveChecks(spoken, 'post_requirements', {
      lessonInjected: true,
      sheetCommittedTexts: [],
      lessonChunkTexts: [],
      recentAnswerTexts: [],
    });
    assert.ok(hasAssumptionLabel(out), `expected assumption label on evidence miss, got: ${out}`);
    assert.ok(out.includes(spoken));
  });

  test('strong evidence (LESSON + sheet) does not require assumption label', () => {
    const spoken = 'As discussed, we keep a write-through cache in front of the primary store.';
    const out = soft.enforceDeepDiveChecks(spoken, 'post_requirements', {
      lessonInjected: true,
      sheetCommittedTexts: ['write-through cache in front of the primary store'],
      lessonChunkTexts: ['Deep Dive: use a write-through cache for hot keys.'],
      recentAnswerTexts: [],
    });
    assert.ok(!hasAssumptionLabel(out), `unexpected assumption label: ${out}`);
    assert.equal(out, spoken);
  });

  test('legacy unset sdPhase runs checks (treated as post-gate)', () => {
    const spoken = 'I would introduce a fan-out on write path.';
    const out = soft.enforceDeepDiveChecks(spoken, undefined, emptyMissContext());
    assert.ok(hasAssumptionLabel(out));
  });
});

describe('Deep-dive soft checks — Check B numeric flag (SPEC 07)', () => {
  test('ungrounded numeric figure is flagged [figure unverified]', () => {
    const spoken = 'The service needs to handle 50,000 QPS at peak.';
    const out = soft.enforceDeepDiveChecks(spoken, 'post_requirements', {
      lessonInjected: true,
      sheetCommittedTexts: ['API: POST /shorten'],
      lessonChunkTexts: ['Deep Dive: caching strategies for hot keys.'],
      recentAnswerTexts: ['We agreed on a write-through cache.'],
    });
    assert.ok(out.includes('[figure unverified]'), `expected figure flag, got: ${out}`);
    assert.ok(out.includes('50,000') || out.includes('50000'), 'figure text retained');
    assert.ok(!hasAssumptionLabel(out), 'strong non-numeric evidence → no assumption miss label');
  });

  test('figure present in sheet corpus is not flagged', () => {
    const spoken = 'As committed, we target 50,000 QPS at peak.';
    const out = soft.enforceDeepDiveChecks(spoken, 'post_requirements', {
      lessonInjected: true,
      sheetCommittedTexts: ['Scale target: 50,000 QPS peak load'],
      lessonChunkTexts: [],
      recentAnswerTexts: [],
    });
    assert.ok(!out.includes('[figure unverified]'), `unexpected flag: ${out}`);
    assert.equal(out, spoken);
  });

  test('figure present in LESSON corpus is not flagged', () => {
    const spoken = 'LESSON suggests p99 latency under 100ms.';
    const out = soft.enforceDeepDiveChecks(spoken, 'post_requirements', {
      lessonInjected: true,
      sheetCommittedTexts: [],
      lessonChunkTexts: ['NFR: p99 latency under 100ms for read path.'],
      recentAnswerTexts: [],
    });
    assert.ok(!out.includes('[figure unverified]'), `unexpected flag: ${out}`);
  });

  test('figure present in recent answers is not flagged', () => {
    const spoken = 'Sticking with 10GB cache as I said earlier.';
    const out = soft.enforceDeepDiveChecks(spoken, 'post_requirements', {
      lessonInjected: true,
      sheetCommittedTexts: [],
      lessonChunkTexts: [],
      recentAnswerTexts: ['I would size the cache at about 10GB for hot keys.'],
    });
    assert.ok(!out.includes('[figure unverified]'), `unexpected flag: ${out}`);
  });
});

describe('Deep-dive soft checks — never hard-refuse / fail-open (SPEC 07)', () => {
  test('LESSON omit never returns empty string', () => {
    const spoken = 'I would use Redis as a distributed lock.';
    const out = soft.enforceDeepDiveChecks(spoken, 'post_requirements', emptyMissContext());
    assert.ok(typeof out === 'string');
    assert.ok(out.trim().length > 0);
    assert.ok(out.includes('Redis') || out.includes(spoken));
  });

  test('fail-open: poisoned context that throws still returns original text', () => {
    const spoken = 'Keep the primary-replica topology we already chose.';
    const poisoned = {
      get lessonInjected() {
        throw new Error('simulated check failure');
      },
      sheetCommittedTexts: [],
      lessonChunkTexts: [],
      recentAnswerTexts: [],
    };
    const out = soft.enforceDeepDiveChecks(spoken, 'post_requirements', poisoned);
    assert.equal(out, spoken);
  });

  test('critical soft-truncate removes superseded contradicted claim but keeps rest', () => {
    const spoken =
      'We stick with MySQL as the primary store. Separately, I would add a CDN for static assets.';
    const out = soft.enforceDeepDiveChecks(spoken, 'post_requirements', {
      lessonInjected: true,
      sheetCommittedTexts: ['Primary store: Postgres (current)'],
      lessonChunkTexts: ['Storage options overview'],
      recentAnswerTexts: [],
      supersededCommittedTexts: ['We stick with MySQL as the primary store'],
    });
    assert.ok(!/mysql/i.test(out), `superseded claim should be soft-truncated, got: ${out}`);
    assert.ok(/CDN/i.test(out), 'non-contradicted remainder must ship');
    assert.ok(out.trim().length > 0);
  });

  test('non-critical ungrounded numeric flags only — full claim retained', () => {
    const spoken = 'Peak write load is around 2,000 QPS.';
    const out = soft.enforceDeepDiveChecks(spoken, 'post_requirements', {
      lessonInjected: true,
      sheetCommittedTexts: ['entities: User, Link'],
      lessonChunkTexts: ['API design overview'],
      recentAnswerTexts: [],
    });
    assert.ok(out.includes('[figure unverified]'));
    assert.ok(/2,?000\s*QPS/i.test(out), `claim retained with flag, got: ${out}`);
  });
});

describe('buildSoftCheckTrailer (TTFT stream-then-annotate)', () => {
  test('empty when checked equals raw', () => {
    assert.equal(soft.buildSoftCheckTrailer('hello', 'hello'), '');
  });

  test('emits assumption + figure notes without replaying body', () => {
    const raw = 'Redis at 100k QPS.';
    const checked = soft.enforceDeepDiveChecks(raw, 'post_requirements', {
      lessonInjected: false,
      sheetCommittedTexts: [],
      lessonChunkTexts: [],
      recentAnswerTexts: [],
    });
    const trailer = soft.buildSoftCheckTrailer(raw, checked);
    assert.ok(trailer.startsWith('\n\n'));
    assert.match(trailer, /As a design assumption:/i);
    assert.match(trailer, /100k\s*\[figure unverified\]/i);
    assert.doesNotMatch(trailer, /^Redis at/);
  });
});
