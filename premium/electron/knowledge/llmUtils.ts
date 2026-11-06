// electron/knowledge/llmUtils.ts
// Shared utilities for LLM interactions — JSON parsing, timeout, retry

const DEFAULT_LLM_TIMEOUT_MS = 30000;

/**
 * Extract a JSON array from an LLM response string.
 * Handles markdown fences (```json, ~~~json), preamble text, and trailing content.
 */
export function extractJSONArray<T = any>(raw: string): T[] {
    // Try to find a JSON array in the response
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
        return JSON.parse(match[0]);
    }
    throw new Error(`No JSON array found in LLM response (${raw.length} chars)`);
}

/**
 * Extract a JSON object from an LLM response string.
 */
export function extractJSONObject<T = any>(raw: string): T {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
        return JSON.parse(match[0]);
    }
    throw new Error(`No JSON object found in LLM response (${raw.length} chars)`);
}

/**
 * Call an LLM function with a timeout.
 * Prevents pipeline hangs when LLM is slow or rate-limited.
 */
export async function callWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number = DEFAULT_LLM_TIMEOUT_MS
): Promise<T> {
    return Promise.race([
        fn(),
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`LLM call timed out after ${timeoutMs}ms`)), timeoutMs)
        )
    ]);
}

/**
 * Call an LLM function with timeout and 1 retry.
 */
export async function callWithRetry<T>(
    fn: () => Promise<T>,
    timeoutMs: number = DEFAULT_LLM_TIMEOUT_MS
): Promise<T> {
    try {
        return await callWithTimeout(fn, timeoutMs);
    } catch (firstError: any) {
        console.warn(`[llmUtils] First attempt failed: ${firstError.message}. Retrying...`);
        // Wait 1s before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
        return await callWithTimeout(fn, timeoutMs);
    }
}
