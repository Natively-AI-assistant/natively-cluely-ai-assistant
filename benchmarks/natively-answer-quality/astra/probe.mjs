#!/usr/bin/env node
// Step 1 + 2 + 3 of the judge setup (spec §16-§19). Records the result in astra/probe-result.json.
//   node astra/probe.mjs
// 1. GET /models → model ids only (never the raw body, which may carry account metadata).
// 2. Refuse unless the exact id gpt-6-astra is listed. No substitute model, ever.
// 3. Minimal judge-route probe (the Responses API since 2026-10-28, see client.mjs JUDGE_ROUTE); if an OPTIONAL
//    parameter is rejected, drop only that parameter and retry.
// Each key in the env file is tried in order (2026-10-02: there are two) and the first that answers is recorded
// as `key_var` — the variable's NAME. The client starts on that key.
import fs from 'node:fs';
import { rawCall, keyVars, JUDGE_MODEL, JUDGE_ROUTE, BASE_URL, PROBE_FILE, CLIENT_HEADERS, scrub, responsesBody, responsesText } from './client.mjs';

const vars = keyVars();
const out = { at: new Date().toISOString(), base_url: BASE_URL, client_headers: CLIENT_HEADERS, key_var: vars[0], key_vars: vars, requested_model: JUDGE_MODEL, ok: false, model_listed: false, steps: [] };
const save = () => fs.writeFileSync(PROBE_FILE, JSON.stringify(out, null, 2) + '\n');
const requestId = (r) => r.headers['x-request-id'] ?? r.headers['x-oneapi-request-id'] ?? null;

let lastModels = null;
for (let keyIndex = 0; keyIndex < vars.length && !out.ok; keyIndex++) {
  const keyVar = vars[keyIndex];
  const models = await rawCall('GET', '/models', null, { timeoutMs: 30000, keyIndex });
  lastModels = models;
  const ids = Array.isArray(models.json?.data) ? models.json.data.map((m) => m?.id).filter(Boolean) : [];
  out.steps.push({ step: 'models', key_var: keyVar, status: models.status, request_id: requestId(models), model_count: ids.length, error: models.status === 200 ? null : models.text.slice(0, 300) });
  if (!ids.includes(JUDGE_MODEL)) { if (!out.model_listed) out.available_models = ids; continue; }
  out.available_models = ids;
  out.model_listed = true;

  // Minimal probe on the judge's route. Optional params are tried and dropped one at a time only if rejected.
  // 400 output tokens, not 40: the hidden reasoning counts against the cap (37-44 tokens for this probe, measured),
  // and a cap it fills leaves no text, which would read as a broken route.
  const messages = [{ role: 'system', content: 'You are a JSON test responder.' }, { role: 'user', content: 'Return exactly {"ok":true}.' }];
  const base = responsesBody(messages);
  let optional = { temperature: 0, max_output_tokens: 400 };
  const unsupported = [];
  let res = null;
  for (let i = 0; i < 3; i++) {
    res = await rawCall('POST', JUDGE_ROUTE, { ...base, ...optional }, { timeoutMs: 60000, keyIndex });
    out.steps.push({ step: 'responses', key_var: keyVar, params: Object.keys(optional), status: res.status, request_id: requestId(res), latency_ms: res.latencyMs, error: res.status === 200 ? null : res.text.slice(0, 300) });
    if (res.status === 200) break;
    const msg = res.text.toLowerCase();
    const bad = Object.keys(optional).find((k) => msg.includes(k));
    if (bad) { unsupported.push(bad); delete optional[bad]; continue; }
    break;
  }
  if (res?.status === 200 && res.json) {
    const text = responsesText(res.json);
    const shape = { top_level_keys: Object.keys(res.json), content_location: text != null ? 'output[type=message].content[type=output_text].text' : 'unknown', has_usage: !!res.json.usage, usage_keys: res.json.usage ? Object.keys(res.json.usage) : [] };
    if (shape.content_location === 'unknown') continue;
    out.key_var = keyVar;
    out.route = JUDGE_ROUTE;
    out.unsupported_params = unsupported;
    out.token_param = 'max_output_tokens';
    out.response_shape = shape;
    out.returned_model = res.json.model ?? null;
    out.model_mismatch = !!res.json.model && res.json.model !== JUDGE_MODEL;
    out.sample_content = String(text ?? '').slice(0, 80);
    out.ok = true;
  }
}
out.unsupported_params ??= [];
out.token_param ??= 'max_output_tokens';
save();
if (!out.model_listed) {
  console.log(lastModels?.status === 200 ? `${JUDGE_MODEL} unavailable for ${vars.length > 1 ? 'these AgentRouter keys' : 'this AgentRouter key'}` : `models endpoint failed: HTTP ${lastModels?.status} ${scrub(lastModels?.text).slice(0, 200)}`);
  console.log('available model ids:', out.available_models?.length ? out.available_models.join(', ') : '(none returned)');
  process.exit(2);
}
console.log(JSON.stringify({ ok: out.ok, key_var: out.ok ? out.key_var : null, model_listed: out.model_listed, returned_model: out.returned_model, model_mismatch: out.model_mismatch, unsupported_params: out.unsupported_params, response_shape: out.response_shape }, null, 1));
process.exit(out.ok ? 0 : 3);
