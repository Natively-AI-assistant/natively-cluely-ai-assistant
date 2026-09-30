/**
 * AgentRouter's pure rules (electron/llm/agentRouter.ts), pinned against what
 * the live gateway did on 2026-09-30 — not against the docs, which were wrong
 * about the model list and silent about everything else.
 *
 * Every error-shape test below uses the body AgentRouter actually returned,
 * wrapped the way the real transport wraps it: the openai SDK keeps only
 * `body.error` on `err.error`, the Anthropic SDK keeps the whole body, axios
 * puts it on `err.response.data`. A rule that matched only one of those would
 * pass a hand-written fixture and fail in the app.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.join(__dirname, '../../..');
const ar = require(path.join(root, 'dist-electron/electron/llm/agentRouter.js'));

describe('ids', () => {
  test('the prefix is the only thing that claims an AgentRouter id', () => {
    assert.equal(ar.isAgentRouterModelId('agentrouter/claude-opus-5'), true);
    assert.equal(ar.isAgentRouterModelId('claude-opus-5'), false, 'a bare vendor id is the user\'s OWN vendor key');
    assert.equal(ar.isAgentRouterModelId('fluxion/claude-opus-5'), false);
    assert.equal(ar.isAgentRouterModelId(''), false);
    assert.equal(ar.isAgentRouterModelId(undefined), false);
  });

  test('the wire id strips exactly one segment', () => {
    assert.equal(ar.agentRouterWireModel('agentrouter/claude-opus-4-8'), 'claude-opus-4-8');
    assert.equal(ar.agentRouterWireModel('agentrouter/gpt-6-astra'), 'gpt-6-astra');
    assert.equal(ar.agentRouterWireModel('claude-opus-5'), 'claude-opus-5', 'an unprefixed id is left alone');
  });

  test('deepseek-v4-flash is NOT rewritten to DeepSeek\'s successor id', () => {
    // It is a retired alias on DeepSeek's own API (deepseekWireModel maps it to
    // deepseek-flash), but it is AgentRouter's CURRENT id. Rewriting it would
    // 503 "no available channel" on every DeepSeek turn.
    assert.equal(ar.agentRouterWireModel('agentrouter/deepseek-v4-flash'), 'deepseek-v4-flash');
    // Comments stripped first: the module's own doc comment names
    // `deepseekWireModel()` to say it is NOT used, and a needle that matches
    // prose reports a failure on correct code.
    const code = fs.readFileSync(path.join(root, 'electron/llm/agentRouter.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/deepseekWireModel\s*\(/.test(code), 'agentRouter.ts must never call deepseekWireModel');
  });
});

describe('protocol per model', () => {
  test('Claude goes to /v1/messages, everything else to /v1/chat/completions', () => {
    assert.equal(ar.agentRouterProtocolFor('claude-opus-5'), 'anthropic');
    assert.equal(ar.agentRouterProtocolFor('claude-opus-4-8'), 'anthropic');
    // gpt-6-astra's supported_endpoint_types is ['openai'] only (measured) —
    // the anthropic route would fail for it.
    assert.equal(ar.agentRouterProtocolFor('gpt-6-astra'), 'openai');
    assert.equal(ar.agentRouterProtocolFor('deepseek-v4-flash'), 'openai');
    assert.equal(ar.agentRouterProtocolFor('glm-5.3'), 'openai');
  });

  test('base URLs: the Anthropic one has NO /v1 (the SDK appends /v1/messages)', () => {
    assert.equal(ar.AGENTROUTER_ANTHROPIC_BASE_URL, 'https://agentrouter.org');
    assert.equal(ar.AGENTROUTER_OPENAI_BASE_URL, 'https://agentrouter.org/v1');
    assert.equal(ar.AGENTROUTER_MODELS_URL, 'https://agentrouter.org/v1/models');
  });
});

describe('request extras', () => {
  test('DeepSeek always goes out with thinking disabled', () => {
    // Measured: with thinking on, DeepSeek streams reasoning_content first and
    // it counts against max_tokens — a 60-token cap ended mid-sentence.
    assert.deepEqual(ar.agentRouterOpenAIExtras('deepseek-v4-flash'), { thinking: { type: 'disabled' } });
  });

  test('an output cap uses the parameter each family accepts', () => {
    assert.deepEqual(ar.agentRouterOpenAIExtras('deepseek-v4-flash', 256), { thinking: { type: 'disabled' }, max_tokens: 256 });
    assert.deepEqual(ar.agentRouterOpenAIExtras('gpt-6-astra', 256), { max_completion_tokens: 256 });
    assert.deepEqual(ar.agentRouterOpenAIExtras('gpt-6-astra'), {}, 'no cap asked for, none sent');
  });
});

describe('client identity', () => {
  test('exactly one claim header, and it is the one that was measured to pass', () => {
    // Evin's decision (2026-09-30): present as Codex CLI. The narrowest claim
    // that passes the gate is this header; the SDK User-Agent stays honest.
    assert.deepEqual({ ...ar.AGENTROUTER_CLIENT_HEADERS }, { originator: 'codex_cli_rs' });
    assert.ok(Object.isFrozen(ar.AGENTROUTER_CLIENT_HEADERS));
  });

  test('raw HTTP calls carry the key AND the identity header', () => {
    assert.deepEqual(ar.agentRouterHttpHeaders('sk-x'), { Authorization: 'Bearer sk-x', originator: 'codex_cli_rs' });
  });

  test('the decision is recorded where the constant lives', () => {
    const src = fs.readFileSync(path.join(root, 'electron/llm/agentRouter.ts'), 'utf8');
    const at = src.indexOf('export const AGENTROUTER_CLIENT_HEADERS');
    const doc = src.slice(Math.max(0, at - 2500), at);
    assert.match(doc, /IMPERSONATION/);
    assert.match(doc, /Evin/);
  });
});

describe('judge and default model', () => {
  test('both are the unrationed DeepSeek model, prefixed', () => {
    assert.equal(ar.AGENTROUTER_JUDGE_MODEL, 'agentrouter/deepseek-v4-flash');
    assert.equal(ar.AGENTROUTER_DEFAULT_MODEL, 'agentrouter/deepseek-v4-flash');
  });

  test('the default is a shipped preset, so the picker can show what the repair installs', () => {
    const utils = fs.readFileSync(path.join(root, 'src/utils/modelUtils.ts'), 'utf8');
    const block = utils.slice(utils.indexOf('    agentrouter: {'), utils.indexOf("pmKey: 'agentrouterPreferredModel'"));
    assert.ok(block.length > 0 && block.length < 4000, 'the agentrouter preset block must be found and bounded');
    assert.ok(block.includes(`'${ar.AGENTROUTER_DEFAULT_MODEL}'`));
    // The docs' gpt-5.6-sol and glm-5.3 are NOT served (503) — never preset them.
    assert.ok(!block.includes("'agentrouter/gpt-5.6-sol'"));
    assert.ok(!block.includes("'agentrouter/glm-5.3'"));
  });
});

describe('explainAgentRouterError — real bodies, real wrappers', () => {
  // openai SDK: APIError keeps body.error on `.error`; message is "<status> <error.message>".
  const openaiErr = (status, body) => Object.assign(new Error(`${status} ${body?.error?.message ?? ''}`), { status, error: body?.error });
  // Anthropic SDK: keeps the whole body on `.error`.
  const anthropicErr = (status, body) => Object.assign(new Error(`${status} ${JSON.stringify(body)}`), { status, error: body });
  // axios: body on response.data.
  const axiosErr = (status, body) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: body } });

  const UNAUTHORIZED_CLIENT = { error: { message: 'unauthorized client detected, contact support for assistance at https://discord.gg/HgekCyHJqB' }, message: 'UNAUTHENTICATED', success: false, type: 'unauthorized_client_error' };
  const BAD_KEY = { error: { message: '无效的令牌 (request id: 20260930145423573726328czg89EEJkVgUr)', type: 'new_api_error' } };
  const NO_KEY = { error: { message: '未提供令牌 (request id: 202609301454237527246232p5d5Npm3E1Dt)', type: 'new_api_error' } };
  const BUDGET = { error: { message: 'Budget pool quota has been exhausted. Please ask an administrator to increase the limit or select another budget pool.', type: 'bad_response_status_code', param: '', code: 'bad_response_status_code' } };
  const NO_CHANNEL = { error: { message: '当前分组 default 下对于模型 no-such-model-xyz 无可用渠道 (request id: 202609301454258626608525k8kcbF9Z69VR)', type: 'new_api_error' } };
  const BLOCKED = { error: { code: 'content-blocked', message: 'content-blocked (request id: 20260930145339634149227q4bmqoFohNRvH)', param: '', type: 'agent_router_api_error' } };

  test('an unrecognised-client 401 is named as that, never as a bad key', () => {
    for (const make of [openaiErr, anthropicErr, axiosErr]) {
      const msg = ar.explainAgentRouterError(make(401, UNAUTHORIZED_CLIENT));
      assert.match(msg, /unrecognised app/, `wrapper ${make.name}`);
      assert.doesNotMatch(msg, /API key/);
    }
  });

  test('invalid and missing keys read as a key problem', () => {
    for (const body of [BAD_KEY, NO_KEY]) {
      for (const make of [openaiErr, anthropicErr, axiosErr]) {
        assert.match(ar.explainAgentRouterError(make(401, body)), /rejected the API key/);
      }
    }
  });

  test('402 names the daily allowance, the refill times, and the way out', () => {
    for (const make of [openaiErr, anthropicErr, axiosErr]) {
      const msg = ar.explainAgentRouterError(make(402, BUDGET), 'claude-opus-5');
      assert.match(msg, /claude-opus-5/);
      assert.match(msg, /02:00 and 11:00 UTC/);
      assert.match(msg, /DeepSeek/);
    }
  });

  test('the Chinese "no available channel" 503 names the model and the fix', () => {
    const msg = ar.explainAgentRouterError(openaiErr(503, NO_CHANNEL), 'glm-5.3');
    assert.match(msg, /no capacity for glm-5\.3/);
    assert.match(msg, /Refresh the model list/);
  });

  test('a bare 503 without the channel text is left alone (it may be transient)', () => {
    assert.equal(ar.explainAgentRouterError(openaiErr(503, { error: { message: 'upstream overloaded' } })), null);
  });

  test('content-blocked is named', () => {
    assert.match(ar.explainAgentRouterError(openaiErr(400, BLOCKED)), /content filter/);
  });

  test('unknown shapes and aborts return null, so the caller keeps the original', () => {
    assert.equal(ar.explainAgentRouterError(null), null);
    assert.equal(ar.explainAgentRouterError(Object.assign(new Error('Request was aborted.'), { name: 'AbortError' })), null);
    assert.equal(ar.explainAgentRouterError(new Error('socket hang up')), null);
  });
});

describe('agentRouterError', () => {
  test('keeps the status so failover logic sees the same number', () => {
    const raw = Object.assign(new Error('402 Budget pool quota has been exhausted.'), { status: 402 });
    const out = ar.agentRouterError(raw, 'gpt-6-astra');
    assert.notEqual(out, raw);
    assert.equal(out.status, 402);
    assert.equal(out.cause, raw);
    assert.match(out.message, /gpt-6-astra/);
  });

  test('an abort passes through untouched', () => {
    const abort = Object.assign(new Error('Request was aborted.'), { name: 'AbortError' });
    assert.equal(ar.agentRouterError(abort), abort);
  });
});

describe('the pure module stays pure', () => {
  test('no SDK import — the build bundles every entry, so one would ride into every importer', () => {
    // Measured: importing the SDKs here grew VisionProviderRegistry.js from
    // ~190 KB to ~690 KB and modelFetcher.js from ~490 KB to ~985 KB.
    const src = fs.readFileSync(path.join(root, 'electron/llm/agentRouter.ts'), 'utf8');
    assert.ok(!/from ['"]openai['"]/.test(src));
    assert.ok(!/from ['"]@anthropic-ai\/sdk['"]/.test(src));
  });
});
