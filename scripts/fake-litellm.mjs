#!/usr/bin/env node
// A fake LiteLLM proxy. Zero dependencies — plain node:http.
//
// Natively never speaks anything LiteLLM-specific to the proxy: it is an
// OpenAI-compatible gateway, so three endpoints are the entire contract.
//   GET  /v1/models           → the model catalogue (drives the picker + Refresh)
//   GET  /model/info          → per-model output budgets (drives Max Tokens "Auto")
//   POST /v1/chat/completions → SSE stream (drives an actual answer)
//
// Usage:
//   node fake-litellm.mjs                        # :4000, three models
//   node fake-litellm.mjs --port 4001 --models a,b   # a second, DIFFERENT proxy
//   node fake-litellm.mjs --key sk-test          # require a virtual key
//
// Run two of these on different ports to exercise the "repoint clears the
// stored default" rule without touching a real gateway.

import http from 'node:http';

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const PORT = Number(arg('--port', 4000));
const REQUIRED_KEY = arg('--key', '');
// Defaults carry an `<upstream>/` segment on purpose — that is how real LiteLLM
// configs name models, and it is what makes the app's ids read
// `litellm/openai/fake-gpt-4o`. A slash-free default would quietly fail to
// reproduce the label bug this shape exists to exercise. The last two share a
// model name across two upstreams, which is the collision case.
const MODELS = arg(
  '--models',
  'openai/fake-gpt-4o,anthropic/fake-claude-sonnet,bedrock/fake.llama-v2,azure/fake-gpt-4o',
).split(',').map(s => s.trim()).filter(Boolean);

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  // Strip an optional /v1 so both base-URL styles a user might type work,
  // exactly like the real proxy (Natively hits /model/info at the ROOT).
  const route = url.pathname.replace(/^\/v1/, '') || '/';
  console.log(`[fake-litellm:${PORT}] ${req.method} ${url.pathname}`);

  if (REQUIRED_KEY) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${REQUIRED_KEY}`) {
      return json(res, 401, { error: { message: 'Invalid virtual key', type: 'auth_error' } });
    }
  }

  // ── Catalogue. This is what fills the model list and the Refresh button. ──
  if (req.method === 'GET' && route === '/models') {
    return json(res, 200, {
      object: 'list',
      data: MODELS.map(id => ({ id, object: 'model', owned_by: 'fake-litellm', created: 0 })),
    });
  }

  // ── Per-model output budgets. Max Tokens "Auto" reads max_output_tokens. ──
  if (req.method === 'GET' && route === '/model/info') {
    return json(res, 200, {
      data: MODELS.map((id, i) => ({
        model_name: id,
        model_info: { max_output_tokens: [4096, 8192, 16384][i % 3] },
      })),
    });
  }

  // ── Chat. SSE, because the app streams. Echoes which model answered, so
  //    you can SEE that routing picked your default rather than model[0]. ──
  if (req.method === 'POST' && route === '/chat/completions') {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
      const model = body.model || 'unknown';
      const reply = `Hello from the FAKE LiteLLM proxy on port ${PORT}. The model that answered is: ${model}`;
      console.log(`[fake-litellm:${PORT}]   → answering as "${model}" (stream=${!!body.stream})`);

      if (!body.stream) {
        return json(res, 200, {
          id: 'chatcmpl-fake', object: 'chat.completion', created: 0, model,
          choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        });
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      const frame = (delta, finish = null) => ({
        id: 'chatcmpl-fake', object: 'chat.completion.chunk', created: 0, model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      });

      send(frame({ role: 'assistant', content: '' }));
      const words = reply.split(' ');
      let i = 0;
      const tick = setInterval(() => {
        if (i < words.length) {
          send(frame({ content: (i ? ' ' : '') + words[i++] }));
          return;
        }
        clearInterval(tick);
        send(frame({}, 'stop'));
        res.write('data: [DONE]\n\n');
        res.end();
      }, 25);
    });
    return;
  }

  json(res, 404, { error: { message: `fake-litellm: no route for ${req.method} ${url.pathname}` } });
});

server.listen(PORT, () => {
  console.log(`[fake-litellm] listening on http://localhost:${PORT}/v1`);
  console.log(`[fake-litellm] models: ${MODELS.join(', ')}`);
  console.log(`[fake-litellm] virtual key: ${REQUIRED_KEY ? REQUIRED_KEY : '(none required)'}`);
});
