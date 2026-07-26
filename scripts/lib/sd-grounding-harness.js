// scripts/lib/sd-grounding-harness.js
//
// Pure helpers for the SD lesson-grounding quality harness:
// skip gate, question bank / split selection, framework+tech assertions,
// and checkpoint persistence. No Electron / API I/O here — unit-testable.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const DEFAULT_QUESTION_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 2;

/** Framework section markers (hellointerview Delivery Framework). */
const FRAMEWORK_MUST = [
  /#{0,2}\s*Requirements\b/i,
  /#{0,2}\s*High[- ]Level Design\b/i,
  /#{0,2}\s*Deep Dives?\b/i,
];

/**
 * Canonical SD questions. `split: 'development'` is the weekly CI set;
 * `split: 'full'` includes development + extended coverage (20+).
 *
 * `techAny` — at least ONE must match (semantic tech claim from the lesson corpus).
 */
const ALL_QUESTIONS = [
  // ── development (5) ──────────────────────────────────────────────────────
  {
    id: 'url-shortener',
    split: 'development',
    q: 'Design a URL shortener like Bitly. Walk me through the full system design.',
    techAny: [/redis/i, /base62/i, /cdn/i, /dynamodb/i, /memcached/i],
  },
  {
    id: 'twitter-feed',
    split: 'development',
    q: 'Design the Twitter/X news feed. Walk me through the full system design.',
    techAny: [/fan-?out/i, /redis/i, /dynamodb/i, /cassandra/i],
  },
  {
    id: 'rate-limiter',
    split: 'development',
    q: 'Design a distributed rate limiter. Walk me through the full system design.',
    techAny: [/redis/i, /token.?bucket/i, /sliding.?window/i],
  },
  {
    id: 'youtube',
    split: 'development',
    q: 'Design YouTube — video upload and streaming. Walk me through the full system design.',
    techAny: [/cdn/i, /\bs3\b/i, /transcod/i, /cassandra/i, /blob/i],
  },
  {
    id: 'distributed-cache',
    split: 'development',
    q: 'Design a distributed cache. Walk me through the full system design.',
    techAny: [/lru/i, /consistent.?hash/i, /redis/i, /memcached/i],
  },

  // ── full (extended) ──────────────────────────────────────────────────────
  {
    id: 'dropbox',
    split: 'full',
    q: 'Design Dropbox — file sync and storage. Walk me through the full system design.',
    techAny: [/s3|\bblob\b|chunk|metadata|cdc|sync/i],
  },
  {
    id: 'uber',
    split: 'full',
    q: 'Design Uber — matching riders and drivers. Walk me through the full system design.',
    techAny: [/geo|quadtree|geohash|kafka|redis|matching/i],
  },
  {
    id: 'whatsapp',
    split: 'full',
    q: 'Design WhatsApp messaging. Walk me through the full system design.',
    techAny: [/websocket|xmpp|cassandra|kafka|fan-?out|inbox/i],
  },
  {
    id: 'ticketmaster',
    split: 'full',
    q: 'Design Ticketmaster — ticket booking under high contention. Walk me through the full system design.',
    techAny: [/lock|queue|redis|contention|inventory|seat/i],
  },
  {
    id: 'web-crawler',
    split: 'full',
    q: 'Design a web crawler. Walk me through the full system design.',
    techAny: [/frontier|bloom|politen|queue|url|dns/i],
  },
  {
    id: 'tinder',
    split: 'full',
    q: 'Design Tinder — swipe and match. Walk me through the full system design.',
    techAny: [/geo|redis|match|swipe|recommendation/i],
  },
  {
    id: 'top-k',
    split: 'full',
    q: 'Design a top-K / leaderboard system. Walk me through the full system design.',
    techAny: [/heap|redis|sorted.?set|count-?min|stream/i],
  },
  {
    id: 'leetcode',
    split: 'full',
    q: 'Design LeetCode — online coding judge. Walk me through the full system design.',
    techAny: [/sandbox|container|queue|judge|isolat/i],
  },
  {
    id: 'ad-click-aggregator',
    split: 'full',
    q: 'Design an ad-click aggregator. Walk me through the full system design.',
    techAny: [/kafka|flink|stream|aggregat|click/i],
  },
  {
    id: 'fb-live-comments',
    split: 'full',
    q: 'Design Facebook Live comments. Walk me through the full system design.',
    techAny: [/pubsub|websocket|kafka|fan-?out|redis/i],
  },
  {
    id: 'instagram',
    split: 'full',
    q: 'Design Instagram feed and media. Walk me through the full system design.',
    techAny: [/cdn|s3|fan-?out|cassandra|redis/i],
  },
  {
    id: 'google-docs',
    split: 'full',
    q: 'Design Google Docs collaborative editing. Walk me through the full system design.',
    techAny: [/ot\b|crdt|operational.?transform|websocket|conflict/i],
  },
  {
    id: 'payment-system',
    split: 'full',
    q: 'Design a payment system. Walk me through the full system design.',
    techAny: [/ledger|idempoten|double.?entry|transaction|settlement/i],
  },
  {
    id: 'job-scheduler',
    split: 'full',
    q: 'Design a distributed job scheduler. Walk me through the full system design.',
    techAny: [/queue|cron|worker|partition|zookeeper|etcd/i],
  },
  {
    id: 'metrics-monitoring',
    split: 'full',
    q: 'Design a metrics / monitoring system. Walk me through the full system design.',
    techAny: [/time.?series|prometheus|kafka|aggregat|cardinality/i],
  },
  {
    id: 'notification-system',
    split: 'full',
    q: 'Design a notification system (push, email, SMS). Walk me through the full system design.',
    techAny: [/queue|kafka|fan-?out|apns|fcm|priority/i],
  },
];

/** Ordered Gemini / Google key env names (same pool as EmbeddingProviderResolver). */
const GEMINI_KEY_ENV_NAMES = [
  'GEMINI_API_KEY',
  'GEMINI_API_KEY_2',
  'GEMINI_API_KEY_3',
  'GEMINI_API_KEY_4',
  'GEMINI_API_KEY_5',
  'GEMINI_API_KEY_6',
  'GOOGLE_API_KEY',
];

/** First non-blank Gemini/Google key from env, or ''. */
function resolveGeminiApiKey(env = process.env) {
  for (const name of GEMINI_KEY_ENV_NAMES) {
    const v = (env[name] || '').trim();
    if (v) return v;
  }
  return '';
}

/**
 * Opt-in gate for real-API harnesses (SD grounding + Requirements-gate smoke).
 * Requires one of:
 *   RUN_SD_GROUNDING_E2E=1 | RUN_SD_REQUIREMENTS_GATE_E2E=1 | RUN_NATIVELY_API_E2E=1
 * plus either a Gemini key (preferred) or NATIVELY_API_KEY.
 */
function shouldRunRealApi(env = process.env) {
  const optedIn =
    env.RUN_NATIVELY_API_E2E === '1' ||
    env.RUN_SD_GROUNDING_E2E === '1' ||
    env.RUN_SD_REQUIREMENTS_GATE_E2E === '1';
  if (!optedIn) return false;
  return Boolean(resolveGeminiApiKey(env) || (env.NATIVELY_API_KEY || '').trim());
}

function resolveBenchmarkModel(env = process.env) {
  return (env.BENCHMARK_MODEL || '').trim() || DEFAULT_MODEL;
}

function resolveSplit(env = process.env) {
  const raw = (env.SD_BENCHMARK_SPLIT || 'development').trim().toLowerCase();
  return raw === 'full' ? 'full' : 'development';
}

function selectQuestions(split = 'development') {
  if (split === 'full') return ALL_QUESTIONS.slice();
  return ALL_QUESTIONS.filter((q) => q.split === 'development');
}

/**
 * Score one answer. Returns { ok, misses, matchedTech }.
 * Framework headers are ALL required; at least one techAny must match.
 */
function assertAnswer(question, answerText) {
  const text = typeof answerText === 'string' ? answerText : '';
  const misses = [];
  for (const re of FRAMEWORK_MUST) {
    if (!re.test(text)) misses.push(`FRAMEWORK:${re}`);
  }
  const techList = question.techAny || [];
  const matchedTech = techList.filter((re) => re.test(text));
  if (techList.length > 0 && matchedTech.length === 0) {
    misses.push(`TECH:none of ${techList.map(String).join('|')}`);
  }
  return { ok: misses.length === 0, misses, matchedTech: matchedTech.map(String) };
}

function defaultCheckpointPath(repoRoot) {
  return path.join(repoRoot, 'debug-artifacts', 'sd-grounding-checkpoint.json');
}

function loadCheckpoint(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return { completedIds: [] };
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const ids = Array.isArray(raw?.completedIds)
      ? raw.completedIds.filter((id) => typeof id === 'string')
      : [];
    return { completedIds: [...new Set(ids)] };
  } catch {
    return { completedIds: [] };
  }
}

function saveCheckpoint(filePath, completedIds) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const payload = {
    completedIds: [...new Set(completedIds)],
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

function markQuestionComplete(filePath, questionId) {
  const current = loadCheckpoint(filePath);
  if (!current.completedIds.includes(questionId)) {
    current.completedIds.push(questionId);
  }
  return saveCheckpoint(filePath, current.completedIds);
}

function filterPendingQuestions(questions, checkpoint) {
  const done = new Set(checkpoint?.completedIds || []);
  return questions.filter((q) => !done.has(q.id));
}

function summarizeResults(results) {
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  const latencies = results.map((r) => r.latencyMs).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const median = latencies.length ? latencies[Math.floor(latencies.length / 2)] : null;
  const p95 = latencies.length
    ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]
    : null;
  return { pass, fail, total: results.length, medianMs: median, p95Ms: p95 };
}

module.exports = {
  ALL_QUESTIONS,
  FRAMEWORK_MUST,
  DEFAULT_MODEL,
  DEFAULT_QUESTION_TIMEOUT_MS,
  DEFAULT_MAX_ATTEMPTS,
  GEMINI_KEY_ENV_NAMES,
  resolveGeminiApiKey,
  shouldRunRealApi,
  resolveBenchmarkModel,
  resolveSplit,
  selectQuestions,
  assertAnswer,
  defaultCheckpointPath,
  loadCheckpoint,
  saveCheckpoint,
  markQuestionComplete,
  filterPendingQuestions,
  summarizeResults,
};
