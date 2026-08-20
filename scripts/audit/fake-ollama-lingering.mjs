// Minimal Ollama-compatible server that reproduces the exposed condition:
// deliver a SHORT answer immediately, then hold the stream OPEN past the
// live-path local first-useful deadline (LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS = 30s).
import http from 'node:http';
const SHORT = 'Yes — lead with the AWS migration.';   // 34 chars, well under 160
const HOLD_MS = Number(process.env.FAKE_HOLD_MS || 35000);
const srv = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/tags')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ models: [{ name: 'fake:latest', model: 'fake:latest' }] }));
  }
  if (req.url.startsWith('/api/chat')) {
    let body = ''; for await (const c of req) body += c;
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Transfer-Encoding': 'chunked' });
    // Emit the whole short answer straight away.
    res.write(JSON.stringify({ message: { role: 'assistant', content: SHORT }, done: false }) + '\n');
    console.error(`[fake-ollama] emitted ${SHORT.length} chars, now holding the stream open ${HOLD_MS}ms`);
    // Then hold WITHOUT closing and WITHOUT further tokens — the exposed shape.
    setTimeout(() => {
      try { res.write(JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }) + '\n'); res.end(); } catch {}
      console.error('[fake-ollama] closed');
    }, HOLD_MS);
    return;
  }
  res.writeHead(404); res.end();
});
srv.listen(11499, () => console.error('[fake-ollama] listening on 11499'));
