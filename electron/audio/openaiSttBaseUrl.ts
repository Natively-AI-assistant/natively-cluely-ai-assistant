/**
 * Whether a saved OpenAI speech base URL means OpenAI itself or another server.
 *
 * Pure, and imported by both OpenAIStreamingSTT (main) and Settings (renderer),
 * so the Models picker shows exactly when sessions use the Realtime socket.
 *
 * `https://api.openai.com/v1` is the base URL OpenAI documents, and the one
 * people paste. It used to count as a custom server, which skips Realtime and
 * transcribes each turn over whisper-1 REST: slower, and no model choice.
 */

/** OpenAI's own API host, with or without `/v1` and trailing slashes. Nothing else. */
const OPENAI_API_BASE = /^https:\/\/api\.openai\.com(?:\/v1)?\/*$/i;

/** True when the base URL is blank or OpenAI's own API. */
export function isDefaultOpenAiSttBase(baseUrl: string | null | undefined): boolean {
    const trimmed = (baseUrl ?? '').trim();
    return trimmed === '' || OPENAI_API_BASE.test(trimmed);
}
