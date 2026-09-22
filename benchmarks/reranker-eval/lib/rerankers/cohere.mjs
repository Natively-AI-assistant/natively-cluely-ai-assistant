//
// Hosted reference ceiling. Uses Cohere's Rerank API (rerank-v3.5). Reads
// COHERE_API_KEY from env — never hardcode a key here. This is the only
// module in the benchmark that sends fixture text (never real user data;
// these are synthetic resumes/JDs authored for this benchmark) over the
// network.
const COHERE_RERANK_URL = 'https://api.cohere.com/v2/rerank';
const MODEL = 'rerank-v3.5';

export async function runCohereReranker(poolEntries) {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) {
    return { perQuery: [], skipped: true, failed: false };
  }

  const perQuery = [];
  for (const entry of poolEntries) {
    const documents = entry.pool.map((c) => c.text);
    const t0 = Date.now();
    let resp;
    try {
      resp = await fetch(COHERE_RERANK_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: MODEL, query: entry.query, documents, top_n: documents.length }),
      });
    } catch (e) {
      return { perQuery, skipped: false, failed: true, error: `network error on query ${entry.queryId}: ${e.message}` };
    }
    const latencyMs = Date.now() - t0;

    if (!resp.ok) {
      const body = await resp.text().catch(() => '<unreadable body>');
      return { perQuery, skipped: false, failed: true, error: `Cohere API ${resp.status} on query ${entry.queryId}: ${body}` };
    }

    const json = await resp.json();
    // Cohere returns { results: [{ index, relevance_score }] } already sorted descending.
    const order = json.results.map((r) => r.index);
    perQuery.push({ queryId: entry.queryId, order, latencyMs });
  }

  return { perQuery, skipped: false, failed: false };
}
