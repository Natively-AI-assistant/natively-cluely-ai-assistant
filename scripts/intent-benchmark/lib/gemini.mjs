// scripts/intent-benchmark/lib/gemini.mjs
//
// Minimal Gemini JSON client for dataset generation and labelling.
//
// Deliberately standalone: it does not import the app's provider stack, because
// that stack is built for live turns (deadlines, fallback ladders, telemetry,
// Electron `app`) and none of that belongs in an offline corpus builder. The
// only thing shared with production is the model id default.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export function readApiKey(env = process.env) {
  const k = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!k) throw new Error('GEMINI_API_KEY is not set. Generation needs it; nothing else in this harness does.');
  return k;
}

/**
 * One JSON-mode call. Returns the parsed object.
 *
 * `responseSchema` is passed through to the API rather than being asked for in
 * prose. A prose "reply with JSON" instruction fails a few percent of the time
 * at scale, and a few percent of 1,500 rows is a corpus with holes in it.
 */
export async function generateJson({
  prompt,
  responseSchema,
  model = 'gemini-3.1-flash-lite',
  temperature = 1.0,
  apiKey = readApiKey(),
  timeoutMs = 120_000,
  maxRetries = 4,
}) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      responseMimeType: 'application/json',
      ...(responseSchema ? { responseSchema } : {}),
    },
  };

  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff with jitter. 429 and 503 are the common failures on
      // a long generation run and both are transient.
      const wait = Math.min(30_000, 800 * 2 ** (attempt - 1)) + Math.random() * 400;
      await new Promise((r) => setTimeout(r, wait));
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${ENDPOINT}/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`Gemini ${res.status}: ${text.slice(0, 400)}`);
        // 4xx other than 429 will not fix themselves; stop burning quota.
        if (res.status !== 429 && res.status >= 400 && res.status < 500) throw Object.assign(err, { fatal: true });
        lastErr = err;
        continue;
      }
      const json = await res.json();
      const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
      if (!text.trim()) {
        // A textless completion is a real Gemini behaviour (safety stop, or a
        // terminal usage-only chunk). Treat as retryable, never as valid empty.
        lastErr = new Error('empty completion');
        continue;
      }
      return { data: JSON.parse(text), usage: json?.usageMetadata ?? null };
    } catch (e) {
      if (e?.fatal) throw e;
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Gemini call failed after ${maxRetries + 1} attempts: ${lastErr?.message}`);
}
