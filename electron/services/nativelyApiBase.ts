// Where natively-api lives: NATIVELY_API_URL when set (a local or staging
// server), else production, with no trailing slash. One definition, so pointing
// the app at another server moves every managed route together (chat, usage,
// telemetry, reviews, reranking, entitlement, share links) rather than leaving
// one part quietly on production.

export const DEFAULT_NATIVELY_API_URL = 'https://api.natively.software';

export function nativelyApiBase(env: NodeJS.ProcessEnv = process.env): string {
    return (env.NATIVELY_API_URL || DEFAULT_NATIVELY_API_URL).replace(/\/+$/, '');
}
