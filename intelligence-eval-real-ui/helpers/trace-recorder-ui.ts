// Tracing is configured in playwright.config (trace: retain-on-failure / on).
// For the standalone runner we start/stop tracing per test via the context.
import type { BrowserContext } from 'playwright-core';
export async function startTrace(ctx: BrowserContext | undefined) { try { await ctx?.tracing.start({ screenshots: true, snapshots: true }); } catch {} }
export async function stopTrace(ctx: BrowserContext | undefined, file: string) { try { await ctx?.tracing.stop({ path: file }); } catch {} }
