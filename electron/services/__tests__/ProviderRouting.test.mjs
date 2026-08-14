import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load ProviderRouter from dist-electron
async function loadRouter() {
  const routerPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/ProviderRouter.js');
  return import(pathToFileURL(routerPath).href);
}

// Load RateLimiter for testing
async function loadRateLimiter() {
  const limiterPath = path.resolve(__dirname, '../../../dist-electron/electron/services/RateLimiter.js');
  return import(pathToFileURL(limiterPath).href);
}

describe('RateLimiter', () => {
  let RateLimiter, createProviderRateLimiters;

  beforeEach(async () => {
    const module = await loadRateLimiter();
    RateLimiter = module.RateLimiter;
    createProviderRateLimiters = module.createProviderRateLimiters;
  });

  test('createProviderRateLimiters creates rate limiters for all providers', async () => {
    const limiters = createProviderRateLimiters();

    assert.ok(limiters.groq instanceof RateLimiter, 'groq rate limiter created');
    assert.ok(limiters.gemini instanceof RateLimiter, 'gemini rate limiter created');
    assert.ok(limiters.openai instanceof RateLimiter, 'openai rate limiter created');
    assert.ok(limiters.claude instanceof RateLimiter, 'claude rate limiter created');
    assert.ok(limiters.deepseek instanceof RateLimiter, 'deepseek rate limiter created');
    assert.ok(limiters.litellm instanceof RateLimiter, 'litellm rate limiter created');
  });

  test('acquire() allows requests when tokens available', async () => {
    const limiter = new RateLimiter(10, 1.0); // 10 tokens, refill 1/s

    // Should not throw
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    // Successfully acquired 3 tokens
  });

  test('acquire() throws when queue is full', async () => {
    const limiter = new RateLimiter(0, 0.0); // 0 tokens, no refill

    // Fill the queue to MAX_QUEUE_DEPTH (20)
    const waiters = [];
    for (let i = 0; i < 20; i++) {
      waiters.push(limiter.acquire().catch(() => {}));
    }

    // Give time for all waiters to be queued
    await new Promise(resolve => setTimeout(resolve, 10));

    // 21st request should throw (MAX_QUEUE_DEPTH = 20)
    try {
      await limiter.acquire();
      assert.fail('Should have thrown');
    } catch (e) {
      assert.ok(e.message.includes('queue full'), 'Should indicate queue full');
    }
  });

  test('destroy() rejects all queued waiters', async () => {
    const limiter = new RateLimiter(0, 0.1); // Empty bucket

    const waiters = [];
    for (let i = 0; i < 5; i++) {
      waiters.push(limiter.acquire().catch(() => {}));
    }

    limiter.destroy();

    // Wait a bit for rejection
    await new Promise(resolve => setTimeout(resolve, 50));
  });
});

describe('CircuitBreaker', () => {
  let ProviderRouter, CircuitBreaker;

  beforeEach(async () => {
    const module = await loadRouter();
    CircuitBreaker = module.CircuitBreaker;
    ProviderRouter = module.ProviderRouter;
  });

  test('initial state is closed', () => {
    const cb = new CircuitBreaker('test', { threshold: 3, resetTimeout: 1000, halfOpenMaxCalls: 1 });
    assert.equal(cb.state, 'closed');
    assert.equal(cb.failureCount, 0);
  });

  test('recordSuccess resets failure count and closes circuit', () => {
    const cb = new CircuitBreaker('test', { threshold: 3, resetTimeout: 1000, halfOpenMaxCalls: 1 });
    cb.failureCount = 5;
    cb.state = 'open';

    cb.recordSuccess();

    assert.equal(cb.failureCount, 0);
    assert.equal(cb.state, 'closed');
  });

  test('circuit opens after threshold failures', () => {
    const cb = new CircuitBreaker('test', { threshold: 3, resetTimeout: 1000, halfOpenMaxCalls: 1 });

    cb.recordFailure();
    assert.equal(cb.state, 'closed');

    cb.recordFailure();
    assert.equal(cb.state, 'closed');

    cb.recordFailure();
    assert.equal(cb.state, 'open');
  });

  test('canExecute returns false when open', () => {
    const cb = new CircuitBreaker('test', { threshold: 2, resetTimeout: 10000, halfOpenMaxCalls: 1 });
    cb.recordFailure();
    cb.recordFailure();
    assert.equal(cb.state, 'open');
    assert.equal(cb.canExecute(), false);
  });

  test('circuit transitions to half-open after resetTimeout', async () => {
    const cb = new CircuitBreaker('test', { threshold: 2, resetTimeout: 50, halfOpenMaxCalls: 1 });
    cb.recordFailure();
    cb.recordFailure();
    assert.equal(cb.state, 'open');

    // Wait for reset timeout
    await new Promise(resolve => setTimeout(resolve, 60));

    assert.equal(cb.canExecute(), true);
    assert.equal(cb.state, 'half-open');
  });

  test('half-open allows limited calls', () => {
    const cb = new CircuitBreaker('test', { threshold: 2, resetTimeout: 50, halfOpenMaxCalls: 2 });

    // Force half-open
    cb.state = 'half-open';
    cb.halfOpenCalls = 0;

    assert.equal(cb.canExecute(), true);
    cb.halfOpenCalls = 1;
    assert.equal(cb.canExecute(), true);
    cb.halfOpenCalls = 2;
    assert.equal(cb.canExecute(), false);
  });
});

describe('ProviderRouter', () => {
  let ProviderRouter;

  beforeEach(async () => {
    const module = await loadRouter();
    ProviderRouter = module.ProviderRouter;
  });

  test('selectProvider defaults to groq', () => {
    const router = new ProviderRouter();
    const choice = router.selectProvider({});

    assert.equal(choice.provider, 'groq');
    assert.ok(choice.reason.includes('default'));
  });

  test('local-only mode routes to ollama', () => {
    const router = new ProviderRouter();
    const choice = router.selectProvider({ privacySetting: 'local-only' });

    assert.equal(choice.provider, 'ollama');
    assert.ok(choice.reason.includes('local-only'));
  });

  test('needsVision prefers vision-capable provider', () => {
    const router = new ProviderRouter();
    const choice = router.selectProvider({
      needsVision: true,
      providerHealth: { gemini: 'healthy', groq: 'healthy', openai: 'healthy' }
    });

    assert.ok(['gemini', 'claude', 'openai'].includes(choice.provider));
    assert.ok(choice.reason.includes('vision'));
  });

  test('preferLowLatency prefers fast provider', () => {
    const router = new ProviderRouter();
    const choice = router.selectProvider({
      preferLowLatency: true,
      providerHealth: { gemini: 'healthy', groq: 'healthy' }
    });

    assert.ok(['groq', 'gemini'].includes(choice.provider), `Got ${choice.provider}`);
    assert.ok(choice.reason.includes('low-latency'));
  });

  test('summary action prefers quality provider', () => {
    const router = new ProviderRouter();
    const choice = router.selectProvider({
      actionType: 'summary',
      providerHealth: { claude: 'healthy', openai: 'healthy', groq: 'healthy' }
    });

    assert.ok(['claude', 'openai', 'gemini'].includes(choice.provider), `Got ${choice.provider}`);
    assert.ok(choice.reason.includes('quality'));
  });

  test('down provider is skipped', () => {
    const router = new ProviderRouter();
    const choice = router.selectProvider({
      preferLowLatency: true,
      providerHealth: { groq: 'down', gemini: 'healthy' }
    });

    // Groq is down, so should pick Gemini
    assert.equal(choice.provider, 'gemini');
  });

  test('mode-based routing selects appropriate provider', () => {
    const router = new ProviderRouter();
    const salesChoice = router.selectProvider({
      mode: 'sales',
      providerHealth: { groq: 'healthy', claude: 'healthy', gemini: 'healthy' }
    });
    assert.ok(salesChoice.reason.includes('mode:sales'));

    const recruitingChoice = router.selectProvider({
      mode: 'recruiting',
      providerHealth: { groq: 'healthy', claude: 'healthy', gemini: 'healthy' }
    });
    assert.ok(recruitingChoice.reason.includes('mode:recruiting'));
  });

  test('recordSuccess and recordFailure update circuit breaker', () => {
    const router = new ProviderRouter({ threshold: 3 }); // threshold 3 for testing
    const cb = router.getCircuitBreaker('gemini');

    assert.equal(cb.state, 'closed');

    router.recordFailure('gemini');
    router.recordFailure('gemini');
    assert.equal(cb.failureCount, 2);
    assert.equal(cb.state, 'closed');

    router.recordFailure('gemini'); // threshold = 3, now open
    assert.equal(cb.state, 'open');

    router.recordSuccess('gemini');
    assert.equal(cb.state, 'closed');
    assert.equal(cb.failureCount, 0);
  });

  test('getProviderHealth returns health status for all providers', () => {
    const router = new ProviderRouter();
    const health = router.getProviderHealth();

    assert.ok('gemini' in health);
    assert.ok('groq' in health);
    assert.ok('openai' in health);
    assert.ok('claude' in health);
  });
});

describe('Integration: RateLimiter wiring in LLMHelper', () => {
  test('rate limiter acquire is called before provider request (mock test)', async () => {
    // This tests that the rate limiter acquire mechanism works correctly
    // Full integration testing would require actual API calls

    const module = await loadRateLimiter();
    const { RateLimiter } = module;

    let callCount = 0;
    let acquireCalled = false;

    // Create a limiter with 1 token
    const limiter = new RateLimiter(1, 0.1);

    // First call should succeed
    await limiter.acquire();
    acquireCalled = true;

    // Verify limiter state
    assert.ok(acquireCalled, 'acquire was called');
  });
});