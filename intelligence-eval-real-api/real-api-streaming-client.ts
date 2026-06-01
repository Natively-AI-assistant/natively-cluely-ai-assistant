// intelligence-eval-real-api/real-api-streaming-client.ts
//
// Wraps real-api-client.streamChat with the RealLatencyRecorder so every live
// call yields both the full streamed text and the spec's streaming latency
// milestones (first_byte, first_token, first_useful_token, total).

import { streamChat, type ChatRequest, type ChatStreamResult } from './real-api-client.ts';
import { RealLatencyRecorder } from './real-api-latency-recorder.ts';

// A "useful" token is the first non-whitespace, non-control answer character.
function isUseful(acc: string): boolean {
  return /\S/.test(acc);
}

export interface StreamRun {
  text: string;
  result: ChatStreamResult;
  latency: ReturnType<RealLatencyRecorder['metrics']>;
  raw: Record<string, number>;
  chunks: number;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function runStreaming(
  key: string,
  req: ChatRequest,
  rec: RealLatencyRecorder,        // caller has already marked requestStart + contextReady
  maxAttempts = 4,                 // retry transient connection failures (rate-limit / reset)
): Promise<StreamRun> {
  let lastErr = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let text = '';
    let chunks = 0;
    let usefulSeen = false;
    // Fresh recorder timing per attempt is NOT used — keep the caller's recorder
    // but only stamp provider-start on the FIRST attempt so latency reflects the
    // successful stream. (Retries are connection-failure recovery, not user-visible.)
    if (attempt === 1) rec.mark('providerRequestStart');
    try {
      const result = await streamChat(key, req, {
        onByte: () => rec.mark('firstByte'),
        onFirstToken: () => rec.mark('firstToken'),
        onChunk: (delta) => {
          chunks++;
          text += delta;
          if (!usefulSeen && isUseful(text)) { usefulSeen = true; rec.mark('firstUsefulToken'); }
        },
      });
      // A 200 with content, or any real HTTP status, is a terminal result.
      if (result.ok && /\S/.test(text)) {
        rec.mark('streamCompleted');
        return { text, result, latency: rec.metrics(), raw: rec.raw(), chunks };
      }
      // 200-but-empty or non-ok HTTP: retry only on empty-200 / 429 / 5xx.
      if (result.httpStatus && result.httpStatus !== 429 && result.httpStatus < 500 && !result.ok) {
        rec.mark('streamCompleted');
        return { text, result, latency: rec.metrics(), raw: rec.raw(), chunks };  // hard client error — don't retry
      }
      lastErr = result.error || (text ? '' : `empty_200`);
      if (result.ok && /\S/.test(text)) { /* handled above */ }
    } catch (e: any) {
      lastErr = String(e?.message || e);   // 'fetch failed' = connection-level (rate limit / reset)
    }
    if (attempt < maxAttempts) {
      // Exponential backoff with jitter (index-derived, no Math.random): 0.8s, 1.6s, 3.2s.
      await sleep(800 * Math.pow(2, attempt - 1) + attempt * 60);
    }
  }
  rec.mark('streamCompleted');
  return {
    text: '', result: { httpStatus: 0, requestId: '', provider: '', ok: false, error: lastErr || 'exhausted_retries' },
    latency: rec.metrics(), raw: rec.raw(), chunks: 0,
  };
}
