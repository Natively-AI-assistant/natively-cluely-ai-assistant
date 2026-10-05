/**
 * The two SDK clients for an AgentRouter key. Split from agentRouter.ts only so
 * that module stays free of SDK imports (see its header); the rules live there.
 */
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { AGENTROUTER_CLIENT_HEADERS, AGENTROUTER_ORIGIN } from './agentRouter';

/**
 * Both SDK clients for one key. Both exist whenever a key does, because the
 * protocol is chosen per MODEL (agentRouterProtocolFor), not per key as with
 * Fluxion's groups.
 *
 * `maxRetries: 1`, not the SDK default of 2: the retries the SDK would spend
 * are on 429 and 5xx, and here a 503 almost always means "no channel for this
 * model", which a retry cannot fix. One retry still covers a dropped
 * connection; beyond that the app's own failover moves on to another provider
 * instead of hammering a free service whose terms name automated polling.
 *
 * `origin` exists for the wire tests, which point both clients at a local
 * server to see the exact paths and headers the SDKs send.
 */
export function createAgentRouterClients(apiKey: string, origin: string = AGENTROUTER_ORIGIN): { openai: OpenAI; anthropic: Anthropic } {
    const base = origin.replace(/\/+$/, '');
    return {
        openai: new OpenAI({ apiKey, baseURL: `${base}/v1`, maxRetries: 1, defaultHeaders: { ...AGENTROUTER_CLIENT_HEADERS } }),
        anthropic: new Anthropic({ apiKey, baseURL: base, maxRetries: 1, defaultHeaders: { ...AGENTROUTER_CLIENT_HEADERS } }),
    };
}
