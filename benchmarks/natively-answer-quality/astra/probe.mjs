#!/usr/bin/env node
// Step 1 + 2 + 3 of the judge setup (spec §16-§19). Records the result in astra/probe-result.json.
//   node astra/probe.mjs
// 1. GET /models → model ids only (never the raw body, which may carry account metadata).
// 2. Refuse unless the exact id gpt-6-astra is listed. No substitute model, ever.
// 3. Minimal chat probe; if an OPTIONAL parameter is rejected, drop only that parameter and retry.
import fs from 'node:fs';
import { rawCall, JUDGE_MODEL, BASE_URL, KEY_VAR, PROBE_FILE, CLIENT_HEADERS, scrub } from './client.mjs';

const out = { at: new Date().toISOString(), base_url: BASE_URL, client_headers: CLIENT_HEADERS, key_var: KEY_VAR, requested_model: JUDGE_MODEL, ok: false, model_listed: false, steps: [] };
const save = () => fs.writeFileSync(PROBE_FILE, JSON.stringify(out, null, 2) + '\n');

const models = await rawCall('GET', '/models', null, { timeoutMs: 30000 });
const ids = Array.isArray(models.json?.data) ? models.json.data.map((m) => m?.id).filter(Boolean) : [];
out.steps.push({ step: 'models', status: models.status, request_id: models.headers['x-request-id'] ?? models.headers['x-oneapi-request-id'] ?? null, model_count: ids.length, error: models.status === 200 ? null : models.text.slice(0, 300) });
out.available_models = ids;
out.model_listed = ids.includes(JUDGE_MODEL);
if (!out.model_listed) {
  save();
  console.log(models.status === 200 ? `${JUDGE_MODEL} unavailable for this AgentRouter key` : `models endpoint failed: HTTP ${models.status} ${scrub(models.text).slice(0, 200)}`);
  console.log('available model ids:', ids.length ? ids.join(', ') : '(none returned)');
  process.exit(2);
}

// Minimal chat probe. Optional params are tried and dropped one at a time only if rejected.
const base = { model: JUDGE_MODEL, messages: [{ role: 'system', content: 'You are a JSON test responder.' }, { role: 'user', content: 'Return exactly {"ok":true}.' }], stream: false };
let optional = { temperature: 0, max_tokens: 40 };
const unsupported = [];
let res = null;
for (let i = 0; i < 4; i++) {
  res = await rawCall('POST', '/chat/completions', { ...base, ...optional }, { timeoutMs: 60000 });
  out.steps.push({ step: 'chat', params: Object.keys(optional), status: res.status, request_id: res.headers['x-request-id'] ?? res.headers['x-oneapi-request-id'] ?? null, latency_ms: res.latencyMs, error: res.status === 200 ? null : res.text.slice(0, 300) });
  if (res.status === 200) break;
  const msg = res.text.toLowerCase();
  const bad = Object.keys(optional).find((k) => msg.includes(k));
  if (bad === 'max_tokens' && !unsupported.includes('max_tokens')) { unsupported.push('max_tokens'); delete optional.max_tokens; optional.max_completion_tokens = 40; out.token_param = 'max_completion_tokens'; continue; }
  if (bad) { unsupported.push(bad); delete optional[bad]; continue; }
  break;
}
out.unsupported_params = unsupported;
out.token_param ??= unsupported.includes('max_tokens') ? 'max_completion_tokens' : 'max_tokens';
if (res?.status === 200 && res.json) {
  const c = res.json.choices?.[0];
  out.response_shape = { top_level_keys: Object.keys(res.json), content_location: typeof c?.message?.content === 'string' ? 'choices[0].message.content (string)' : Array.isArray(c?.message?.content) ? 'choices[0].message.content (parts)' : 'unknown', has_usage: !!res.json.usage, usage_keys: res.json.usage ? Object.keys(res.json.usage) : [] };
  out.returned_model = res.json.model ?? null;
  out.model_mismatch = !!res.json.model && res.json.model !== JUDGE_MODEL;
  out.sample_content = String(c?.message?.content ?? '').slice(0, 80);
  out.ok = out.response_shape.content_location !== 'unknown';
}
save();
console.log(JSON.stringify({ ok: out.ok, model_listed: out.model_listed, returned_model: out.returned_model, model_mismatch: out.model_mismatch, unsupported_params: out.unsupported_params, response_shape: out.response_shape }, null, 1));
process.exit(out.ok ? 0 : 3);
