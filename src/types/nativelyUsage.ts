/**
 * The shape of GET /v1/usage and GET /v1/plans on the Natively API.
 *
 * ONE definition, imported by both the preload bridge and the renderer. The
 * quota type used to be written out twice — once in electron/preload.ts and
 * once in src/types/electron.d.ts — and the two are the contract the settings
 * panel renders from, so a field added on the server had to be remembered in
 * three places. It is type-only, so nothing here survives into the bundle.
 *
 * ── THE FOUR CATEGORIES AND THE FIVE METERS ─────────────────────────────────
 *
 * The product shows four things: AI Usage, Knowledge Usage, Voice Usage and
 * Research. The server meters five resources: AI tokens, embedding tokens,
 * reranker tokens, STT minutes and research credits. Knowledge is the composite
 * — embeddings and reranking have separate quotas and separate economics, so
 * they stay separate everywhere except the headline number.
 *
 * ── WHY THE LEGACY FIELDS ARE STILL HERE ────────────────────────────────────
 *
 * `transcription`, `search` and `embedding` are aliases the server still emits
 * for builds that shipped before this model existed. This app reads the new
 * names; the aliases are typed so nobody deletes them from the server thinking
 * they are unused, and so a mixed-version debugging session has the shape
 * written down.
 */

/** Every meter reports the same five numbers plus the unit they are counted in. */
export interface UsageMeter {
  used: number;
  /** null means UNMETERED — a plan with no entry for this resource. NOT zero. */
  limit: number | null;
  remaining: number | null;
  /** The REAL percentage. May exceed 100: AI bills after a stream completes. */
  percent: number;
  /** The same number clamped to 0-100, for bar widths. */
  visual_percent: number;
  unit: 'tokens' | 'minutes' | 'usd' | 'requests';
}

/** Knowledge Usage: one headline over two independently enforced meters. */
export interface KnowledgeMeter {
  /** max(embedding, reranker) — never reads low while either half is spent. */
  percent: number;
  visual_percent: number;
  embedding: UsageMeter;
  reranker: UsageMeter;
}

/**
 * Research: shown in dollars, enforced as an integer count of research runs.
 *
 * `unit` is widened to include 'requests' for ONE reason — a server that
 * predates the dollar allowance sends a request count and no USD limit, and
 * pinning this to 'usd' would make normalizeQuota label "15 / 100 searches" as
 * "$15 / $100". A meter that renders a count as money is worse than one that
 * renders nothing.
 */
export interface ResearchMeter extends UsageMeter {
  unit: 'usd' | 'requests';
  runs_used: number;
  runs_limit: number | null;
  runs_remaining: number | null;
}

export interface NativelyQuota {
  ai: UsageMeter;
  knowledge: KnowledgeMeter;
  voice: UsageMeter;
  research: ResearchMeter;

  /** Legacy aliases — see the module header. */
  transcription: UsageMeter;
  search: UsageMeter;
  embedding: UsageMeter;

  resets_at: string;
  is_trial?: boolean;
  expires_at?: string;
}

/** One row of the plan catalog, exactly as the server enforces it. */
export interface NativelyPlanLimits {
  price_usd: number;
  ai_tokens: number;
  transcription_minutes: number;
  embedding_tokens: number;
  reranker_tokens: number;
  research_credits_usd: number;
  /** Research runs — the integer the research gate actually compares. */
  search_requests: number;
}

export interface NativelyUsageResponse {
  ok: boolean;
  plan?: string;
  quota?: NativelyQuota;
  /** The plan row the server enforced, so the UI needs no copy of the numbers. */
  limits?: NativelyPlanLimits;
  research_credit_usd?: number;
  member_since?: string;
  /** Set when a network failure was covered by serving the last good response. */
  stale?: boolean;
  error?: string;
  status?: number;
}

export interface NativelyPlansResponse {
  ok: boolean;
  currency?: string;
  plans?: Record<string, NativelyPlanLimits>;
  resource_units?: Record<string, string>;
  research_credit_usd?: number;
  error?: string;
  status?: number;
}

/**
 * GET /v1/trial/status.
 *
 * `ai` is the LEGACY request counter and is frozen at whatever it reached
 * before AI moved to a token meter — nothing increments it any more. Read
 * `ai_tokens`. It is typed rather than deleted because the server still sends
 * it for builds that predate the change.
 */
export interface TrialUsage {
  ai: number;
  ai_tokens?: number;
  stt_seconds: number;
  search: number;
  embedding_tokens?: number;
  reranker_tokens?: number;
}

/** The trial's own allowances, sent alongside its usage so nothing is hardcoded. */
export interface TrialLimits {
  duration_ms: number;
  ai_requests: number;
  ai_tokens: number;
  stt_minutes: number;
  transcription_minutes: number;
  search_requests: number;
  research_credits_usd: number;
  embedding_tokens: number;
  reranker_tokens: number;
}

/**
 * Allowances a trial falls back to when the server has not answered yet.
 *
 * The three trial surfaces (the settings pills, the banner and the end-of-trial
 * modal) each hardcoded their own copy — `/10 AI`, `/10m STT`, `/2 search` —
 * which is three places to miss when a number changes. They now share this one,
 * and prefer the server's `limits` whenever it has arrived.
 */
export const TRIAL_FALLBACK_LIMITS: Pick<TrialLimits, 'ai_tokens' | 'stt_minutes' | 'search_requests'> = {
  ai_tokens: 60_000,
  stt_minutes: 30,
  search_requests: 3,
};

/**
 * Compact allowance label — 3,000,000 -> "3M", 6,500,000 -> "6.5M".
 *
 * Mirrors formatCompact in the API's lib/resourceUsage.js, which renders the
 * same allowances into the welcome email. A customer comparing that mail
 * against this panel is exactly the person who notices "3M" against
 * "3,000,000" and wonders which is the real number.
 */
export function formatCompact(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1_000_000) {
    const m = v / 1_000_000;
    return `${Number.isInteger(m) ? m : Math.round(m * 10) / 10}M`;
  }
  if (v >= 10_000) {
    const k = v / 1000;
    return `${Number.isInteger(k) ? k : Math.round(k * 10) / 10}k`;
  }
  return v.toLocaleString('en-US');
}

/** "$0.36" / "$1" — research is the one meter denominated in money. */
export function formatUsd(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `$${v % 1 === 0 ? v.toFixed(0) : v.toFixed(2)}`;
}

/**
 * How a meter's used/limit pair should read, given its unit.
 *
 * One function so "4.1M / 6.5M tokens", "314 / 700 minutes" and "$0.36 / $1"
 * cannot drift apart across the panel, the banner and the plan table.
 */
export function formatMeter(m: Pick<UsageMeter, 'used' | 'limit' | 'unit'> | undefined | null): string {
  if (!m) return '—';
  if (m.limit == null) return 'Unlimited';
  switch (m.unit) {
    case 'usd':
      return `${formatUsd(m.used)} / ${formatUsd(m.limit)}`;
    case 'minutes':
      return `${Math.round(m.used).toLocaleString('en-US')} / ${m.limit.toLocaleString('en-US')} min`;
    case 'tokens':
      return `${formatCompact(m.used)} / ${formatCompact(m.limit)}`;
    default:
      return `${Math.round(m.used).toLocaleString('en-US')} / ${m.limit.toLocaleString('en-US')}`;
  }
}

/**
 * Accept a quota from EITHER server generation.
 *
 * The app and the API ship on separate cadences. A build carrying this file can
 * meet a server that predates the resource model — during a rollback, or simply
 * because a user has not restarted since before the deploy — and that server
 * returns three request-counted buckets with no `percent`, no `unit`, no
 * `knowledge`, `voice` or `research`. Rendered raw, the usage panel would show
 * one mislabelled row and three blanks, which reads as a broken app rather than
 * as an old server.
 *
 * So the canonical keys are filled in from the legacy ones when they are
 * missing, and a missing percentage is computed. Nothing is invented: a resource
 * the old server never metered (reranking) stays absent, and the components
 * skip it rather than drawing an empty meter at 0%.
 *
 * The new server needs none of this — it sends every field, and the branches
 * below are all no-ops. That is the intended steady state.
 */
export function normalizeQuota(raw: unknown): NativelyQuota | null {
  const q = raw as Partial<NativelyQuota> & Record<string, unknown>;
  if (!q || typeof q !== 'object') return null;

  const fill = (m: unknown, unit: UsageMeter['unit']): UsageMeter | undefined => {
    const b = m as Partial<UsageMeter> | undefined;
    if (!b || typeof b.used !== 'number') return undefined;
    const limit = typeof b.limit === 'number' ? b.limit : null;
    const percent = typeof b.percent === 'number'
      ? b.percent
      : limit && limit > 0 ? (b.used / limit) * 100 : 0;
    return {
      used: b.used,
      limit,
      remaining: typeof b.remaining === 'number' ? b.remaining : limit == null ? null : Math.max(0, limit - b.used),
      percent,
      visual_percent: typeof b.visual_percent === 'number' ? b.visual_percent : Math.min(100, Math.max(0, percent)),
      unit: b.unit ?? unit,
    };
  };

  const ai = fill(q.ai, 'tokens');
  const voice = fill(q.voice ?? q.transcription, 'minutes');
  const embedding = fill(q.knowledge?.embedding ?? q.embedding, 'tokens');
  const reranker = fill(q.knowledge?.reranker, 'tokens');
  const searchLike = fill(q.search, 'requests');

  // Research is the one meter an old server cannot express: it counted requests
  // and had no dollar allowance. Carry the request counts through under
  // `runs_*` so the meter still renders, and mark it `requests` so nothing
  // formats a count as money.
  const research: ResearchMeter | undefined = q.research
    ? (q.research as ResearchMeter)
    : searchLike
      ? {
        ...searchLike,
        // 'requests', NOT 'usd'. The old server never had a dollar allowance,
        // and formatMeter's usd branch would print "$15 / $100" for 15 searches.
        unit: 'requests' as const,
        runs_used: searchLike.used,
        runs_limit: searchLike.limit,
        runs_remaining: searchLike.remaining,
      }
      : undefined;

  if (!ai && !voice) return null;

  return {
    ...(q as NativelyQuota),
    ai: ai as UsageMeter,
    voice: voice as UsageMeter,
    transcription: (q.transcription as UsageMeter) ?? (voice as UsageMeter),
    embedding: embedding as UsageMeter,
    search: searchLike as UsageMeter,
    research: research as ResearchMeter,
    knowledge: embedding
      ? {
        percent: q.knowledge?.percent ?? Math.max(embedding.percent, reranker?.percent ?? 0),
        visual_percent: q.knowledge?.visual_percent ?? Math.min(100, Math.max(embedding.visual_percent, reranker?.visual_percent ?? 0)),
        embedding,
        // Absent, not zero: an old server never metered reranking, and a meter
        // reading "0 / 0" would claim an allowance that does not exist.
        reranker: reranker as UsageMeter,
      }
      : (q.knowledge as KnowledgeMeter),
    resets_at: (q.resets_at as string) ?? '',
  };
}
