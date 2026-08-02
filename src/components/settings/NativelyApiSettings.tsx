import {
  AlertCircle,
  ArrowUpRight,
  Brain,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronsRight,
  Clock,
  Layers,
  Loader2,
  Mic,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';
import { motion, AnimatePresence, LayoutGroup, useReducedMotion } from 'framer-motion';
import { AccordionSection, Disclosure } from '../ui/AccordionSection';
import { InteractiveCard } from '../ui/InteractiveCard';
import { FreeTrialModal } from '../trial/FreeTrialModal';
import { getMeetingInterfaceTheme, type MeetingInterfaceTheme } from '../../lib/meetingInterfaceTheme';
import { BEAT, EASE_ENTER, EASE_LEAVE, INK, SETTLE } from '../../lib/plansMotion';
// Painted as a CSS mask, not rendered as an <img>: the asset is a white
// monochrome glyph, so on the light theme's pale plaque an <img> would be
// invisible. See `.natively-key-mark` in index.css.
import nativelyLogo from '../../assets/logo.webp';

// ─── Types ───────────────────────────────────────────────────
interface QuotaBucket {
  used: number;
  limit: number;
  remaining: number;
}
interface UsageData {
  plan: string;
  member_since: string;
  quota: {
    transcription: QuotaBucket;
    ai: QuotaBucket;
    search: QuotaBucket;
    resets_at: string;
  };
}

interface PricingProduct {
  formattedPrice: string | null;
  checkoutUrl: string;
}

const PLAN_STANDARD_URL = 'https://checkout.dodopayments.com/buy/pdt_0NbFixGmD8CSeawb5qvVl';
const PLAN_PRO_URL = 'https://checkout.dodopayments.com/buy/pdt_0NcM6Aw0IWdspbsgUeCLA';
const PLAN_MAX_URL = 'https://checkout.dodopayments.com/buy/pdt_0NcM7JElX4Af6LNVFS1Yf';
const PLAN_ULTRA_URL = 'https://checkout.dodopayments.com/buy/pdt_0NcM7rC2kAb69TFKsZnUU';
const MASKED_NATIVELY_KEY = '•'.repeat(24);

// Last-known usage, remembered across tab switches AND app restarts.
//
// SettingsOverlay unmounts this component every time the user switches away
// from Plans & Billing, so React state alone can't survive a re-visit; a
// module-level variable covers that but dies with the renderer process, so the
// first open after every app launch was a blank/loading state again. Persisting
// it means the Usage card paints last-known numbers immediately and a silent
// background revalidation swaps in fresh ones a moment later.
//
// Numbers shown from here are always stale by definition. That is acceptable
// because they are replaced within a second and are never used for enforcement
// — the server owns the real quota. The one case where stale is actively
// WRONG rather than merely old is a cache written before the billing period
// rolled over: those bars would show last period's consumption against this
// period's allowance. `resets_at` makes that detectable, so an expired entry is
// dropped rather than displayed.
const USAGE_STORAGE_KEY = 'natively_api_usage_v1';

function readUsageCache(): UsageData | null {
  try {
    const raw = localStorage.getItem(USAGE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Shape-check before trusting: a partial write would otherwise throw inside
    // the render path when QuotaBar reads `.used`/`.limit`.
    if (!parsed?.quota?.transcription || !parsed.quota.ai || !parsed.quota.search) return null;
    const resets = Date.parse(parsed.quota.resets_at);
    if (Number.isFinite(resets) && resets < Date.now()) return null;
    return parsed as UsageData;
  } catch {
    return null;
  }
}

let usageCache: UsageData | null = readUsageCache();

function setUsageCache(next: UsageData | null): void {
  usageCache = next;
  try {
    if (next) localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(USAGE_STORAGE_KEY);
  } catch {
    // Storage unavailable or full — in-memory caching still works for this
    // session, only the cross-restart benefit is lost.
  }
}

// Cursor-tracked spotlight colour per tier, so the API card blooms in its OWN
// hue on hover exactly as the Pro purchase cards do. Values are the tier fills'
// hues at low alpha; a neutral grey glow here would still have read as a
// different control from the Pro cards.
const TIER_GLOW = {
  Standard: 'rgba(60, 107, 105, 0.34)',
  Pro: 'rgba(17, 89, 153, 0.34)',
  Max: 'rgba(102, 60, 104, 0.34)',
  Ultra: 'rgba(111, 37, 66, 0.34)',
} as const;

const PLANS = [
  {
    id: 'natively_api_standard_monthly',
    name: 'Standard',
    price: '$8',
    url: PLAN_STANDARD_URL,
    badgeText: 'Basic',
    includesPro: false,
    description: 'Essential transcription and AI requests for light, everyday use.',
    note: 'Does not include Natively Pro desktop app license. Custom API key usage is supported.',
    // Quotas are described qualitatively rather than as exact figures, so the
    // per-tier limits aren't published in the UI and can be tuned server-side
    // without shipping a copy change. Ordering must stay monotonic across the
    // four tiers (light → regular → high → continuous) since that ladder is
    // now the only signal a buyer has for relative capacity.
    // Underlying limits at time of writing — AI 500/1k/2k/3k, STT 200/500/1k/2k
    // min, search 20/100/200/300 — kept here for reference only, not rendered.
    features: [
      'Light everyday AI usage',
      'Light transcription volume',
      'Occasional web searches',
    ],
  },
  {
    id: 'natively_api_pro_monthly',
    name: 'Pro',
    price: '$15',
    url: PLAN_PRO_URL,
    badgeText: 'Recommended',
    includesPro: true,
    description: 'The full Natively Pro app plus API usage for daily work.',
    note: 'Includes a full Natively Pro desktop app license for the duration of subscription.',
    features: [
      'Daily professional AI usage',
      'Regular meeting transcription',
      'Frequent web searches',
      'Full Natively Pro app features included',
    ],
  },
  {
    id: 'natively_api_max_monthly',
    name: 'Max',
    price: '$25',
    url: PLAN_MAX_URL,
    badgeText: 'Best Value',
    includesPro: true,
    description: 'Higher volume for developers and teams doing more each month.',
    note: 'Includes a full Natively Pro desktop app license for the duration of subscription.',
    features: [
      'High-volume AI usage',
      'Heavy meeting transcription',
      'High-volume web searches',
      'Full Natively Pro app features included',
    ],
  },
  {
    id: 'natively_api_ultra_monthly',
    name: 'Ultra',
    price: '$35',
    url: PLAN_ULTRA_URL,
    badgeText: 'Heavy Users',
    includesPro: true,
    description: 'For continuous recording and the heaviest daily usage.',
    note: 'Includes a full Natively Pro desktop app license for the duration of subscription.',
    features: [
      'Maximum AI usage, all-day',
      'Continuous recording & transcription',
      'Maximum web searches',
      'Full Natively Pro app features included',
    ],
  },
] as const;

// Picks a glyph for a feature row from the feature's OWN wording. The
// references all use characterful, varied icons rather than one repeated
// tick, and a per-row icon is what stops a feature list reading as a generic
// bulleted list. This is presentation only — it classifies the existing
// PLANS[].features strings and asserts nothing they do not already say.
function pickFeatureIcon(feature: string) {
    const f = feature.toLowerCase();
    if (f.includes('transcription') || f.includes('recording')) return Mic;
    if (f.includes('search')) return Search;
    if (f.includes('pro app')) return Layers;
    return Sparkles; // the AI-usage rows
}

// cardSlideLeftVariants / cardSlideRightVariants / cardCtaVariants were removed
// here: the redesign replaced the two-column body (which carried them on the
// left column, the features panel and the CTA block) with a mesh header +
// single body, so nothing consumed them any more. Only the container-level
// opacity crossfade between tiers survives.

const cardContainerVariants = {
  enter: (_direction: number) => ({
    opacity: 0,
  }),
  center: {
    opacity: 1,
    transition: {
      staggerChildren: 0.07,
      delayChildren: 0.02,
    }
  },
  exit: (_direction: number) => ({
    opacity: 0,
    transition: {
      staggerChildren: 0.03,
      staggerDirection: -1 as const,
    }
  })
};

// ─── Quota bar ───────────────────────────────────────────────
// One bar colour for all three buckets. They used to be orchid / violet /
// emerald, which made three neutral facts read as three different *kinds* of
// thing and put a third and fourth hue on a surface that should carry one
// accent. Colour here now means exactly one thing — amber = running low.
function QuotaBar({
  label,
  icon: Icon,
  bucket,
}: {
  label: string;
  icon: React.ElementType;
  bucket: QuotaBucket;
}) {
  const pct = bucket.limit > 0 ? Math.min(100, (bucket.used / bucket.limit) * 100) : 0;
  const isHigh = pct >= 80;
  // Percentage remaining, not the raw used/limit pair — a plan-agnostic
  // number that reads the same way on Standard, Pro, Max, and Ultra instead
  // of forcing a mental "45 / 500 vs 230 / 3000" comparison across tiers.
  const pctRemaining = Math.max(0, Math.round(100 - pct));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={12} className="text-text-tertiary" strokeWidth={1.75} />
          <span className="text-[12px] text-text-secondary">{label}</span>
        </div>
        <span
          className={`text-[12px] tabular-nums ${isHigh ? 'text-amber-500 font-medium' : 'text-text-tertiary'}`}
        >
          {pctRemaining}% left
        </span>
      </div>
      <div className="h-[3px] w-full bg-bg-input rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none ${isHigh ? 'bg-amber-500' : 'bg-accent-primary'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Trial countdown (live, ticks every 500ms) ───────────────
function TrialCountdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, new Date(expiresAt).getTime() - Date.now()),
  );
  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  const totalSec = Math.ceil(remaining / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const isWarning = remaining < 2 * 60 * 1000;
  return (
    <div
      className={`flex items-center gap-1.5 ${isWarning ? 'text-amber-500' : 'text-text-tertiary'}`}
    >
      <Clock size={11} strokeWidth={2} />
      <span className="text-[11px] font-medium tabular-nums">
        {remaining === 0 ? 'Ended' : `${m}:${s.toString().padStart(2, '0')}`}
      </span>
    </div>
  );
}

// ─── Trial usage pill ─────────────────────────────────────────
function TrialUsagePill({
  icon: Icon,
  used,
  limit,
  label,
  unit,
}: {
  icon: React.ElementType;
  used: number;
  limit: number;
  label: string;
  unit: string;
}) {
  const pct = Math.min(100, (used / limit) * 100);
  const isHigh = pct >= 80;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon size={12} strokeWidth={2} className="text-text-tertiary" />
          <span className="text-[12px] text-text-secondary">{label}</span>
        </div>
        <span className={`text-[12px] tabular-nums ${isHigh ? 'text-amber-500 font-medium' : 'text-text-tertiary'}`}>
          {used}/{limit}
          {unit}
        </span>
      </div>
      <div className="h-[3px] w-full bg-bg-input rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none ${isHigh ? 'bg-amber-500' : 'bg-accent-primary'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Card wrapper ────────────────────────────────────────────
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`bg-bg-item-surface rounded-2xl border border-border-subtle overflow-hidden ${className}`}
    >
      {children}
    </div>
  );
}

// ─── Section label ───────────────────────────────────────────
// One small-caps label above each container, replacing the mixture of boxed
// headers, inline titles and uppercase micro-labels this tab used to open
// every section with.
function SectionLabel({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-1 mb-2">
      <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-[0.07em]">
        {children}
      </p>
      {aside}
    </div>
  );
}

// ─── Price ───────────────────────────────────────────────────
// The dominant element on a plan row: visibly larger and heavier than the
// plan name (19px semibold vs 13px medium). It previously sat at 17px bold
// against a 13px semibold name — near-parity, so nothing led.
function Price({ amount, period }: { amount: string; period: string }) {
  return (
    <div className="flex items-baseline gap-1 shrink-0">
      <span
        className="text-[19px] font-semibold text-text-primary tabular-nums"
        style={{ letterSpacing: '-0.025em' }}
      >
        {amount}
      </span>
      <span className="text-[11px] text-text-tertiary">{period}</span>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────
interface NativelyApiSettingsProps {
  initialIsSaved?: boolean;
  /**
   * Rendered between the Natively key card and the plan chooser. A slot exists
   * because that seam is INSIDE this component, so a parent cannot reach it by
   * reordering siblings. Used by PlansSettings to place the "Pro License
   * Active" receipt directly under the credential box it relates to, rather
   * than above the whole section or stranded below the pricing.
   */
  afterKeySection?: React.ReactNode;
}

export const NativelyApiSettings: React.FC<NativelyApiSettingsProps> = ({ initialIsSaved = false, afterKeySection }) => {
  const prefersReducedMotion = useReducedMotion();
  const t = useT();
  // `initialIsSaved` arrives ASYNCHRONOUSLY. SettingsOverlay seeds its own
  // `hasNativelyKey` to false and only flips it after `getStoredCredentials()`
  // resolves, so on every open of this tab the first render says "no key" even
  // for a subscriber. That is what made the Usage section flash: `usageData`
  // was correctly restored from `usageCache` on the very first render, but the
  // card is gated on `isSaved && usageData`, so it stayed hidden until the
  // credentials round-trip landed and then popped in. The plan chooser
  // (`!isSaved && PlansCard`) flashed the other way for the same reason.
  //
  // A populated `usageCache` is itself proof a key was saved: it is only ever
  // written from a successful quota fetch, and it is nulled on BOTH removal
  // paths (`handleClear`, and the credentials effect when no key comes back).
  // So seeding these three from the cache is sound, and it makes the first
  // paint of a revisit identical to the last paint of the previous visit.
  const cachedKeyKnown = !!usageCache;
  const [apiKey, setApiKey] = useState(() => (initialIsSaved || cachedKeyKnown ? MASKED_NATIVELY_KEY : ''));
  const [isSaved, setIsSaved] = useState(initialIsSaved || cachedKeyKnown);
  const [isLoading, setIsLoading] = useState(!(initialIsSaved || cachedKeyKnown));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  // Distinct from justSaved: a Dodo/Gumroad license key activates Pro but
  // writes nothing to CredentialsManager — isSaved/fetchUsage must never
  // fire for this branch, or the UI shows a "Connected" badge with an empty
  // Usage card for a credential that was never actually stored.
  const [justActivatedPro, setJustActivatedPro] = useState(false);
  const [usageData, setUsageData] = useState<UsageData | null>(() => usageCache);
  const [isLoadingUsage, setIsLoadingUsage] = useState(false);
  const [pricingProducts, setPricingProducts] = useState<Record<string, PricingProduct>>({});
  const [selectedPlanId, setSelectedPlanId] = useState<string>('natively_api_pro_monthly');
  const [prevPlanId, setPrevPlanId] = useState<string>('natively_api_pro_monthly');
  // Selection is purely manual now — the tier selector used to auto-rotate
  // through Standard/Pro/Max/Ultra every 4.5s via setInterval, which reads
  // fine as a marketing carousel but fights a "calm once loaded" settings
  // page: content shifting under a user's cursor while they're trying to
  // read is disorienting, and it recreates itself every time this tab is
  // revisited (module state doesn't survive the SettingsOverlay unmount).

  const selectPlan = useCallback((newPlanId: string) => {
    setSelectedPlanId(prev => {
      setPrevPlanId(prev);
      return newPlanId;
    });
  }, []);

  useEffect(() => {
    if (usageData?.plan) {
      const planName = usageData.plan.toLowerCase();
      if (planName === 'starter' || planName === 'standard') {
        selectPlan('natively_api_standard_monthly');
      } else if (planName === 'pro') {
        selectPlan('natively_api_pro_monthly');
      } else if (planName === 'max') {
        selectPlan('natively_api_max_monthly');
      } else if (planName === 'ultra') {
        selectPlan('natively_api_ultra_monthly');
      }
    }
  }, [usageData, selectPlan]);

  const [interfaceTheme, setInterfaceTheme] = useState<MeetingInterfaceTheme>(() => {
    const theme = getMeetingInterfaceTheme();
    return theme === 'default' ? 'liquid-glass' : theme;
  });

  useEffect(() => {
    const handleStorage = () => {
      const theme = getMeetingInterfaceTheme();
      setInterfaceTheme(theme === 'default' ? 'liquid-glass' : theme);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // ── Free Trial state ──────────────────────────────────────
  const [trialState, setTrialState] = useState<{
    active: boolean;
    expired: boolean;
    expiresAt: string;
    startedAt: string;
    usage: { ai: number; stt_seconds: number; search: number };
  } | null>(null);
  // True while getLocalTrial is in flight — prevents the "start trial" card
  // from flashing before we know whether a trial token exists.
  const [isCheckingTrial, setIsCheckingTrial] = useState(true);
  const [trialLoading, setTrialLoading] = useState(false);
  const [trialError, setTrialError] = useState<string | null>(null);
  const [showTrialModal, setShowTrialModal] = useState(false);
  const trialPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const creds = await window.electronAPI.getStoredCredentials();
        if (creds.hasNativelyKey) {
          setApiKey(MASKED_NATIVELY_KEY);
          setIsSaved(true);
        } else {
          setApiKey('');
          setIsSaved(false);
          setUsageCache(null);
          setUsageData(null);
        }
      } catch (e) {
        console.error('[NativelyApi]', e);
        // Unknown is not saved. `isSaved` now starts optimistically true when a
        // persisted usage entry exists, so without this a keychain read failure
        // would leave a masked key in the field with no way out: `handleSave`
        // refuses any value containing '•', so the Activate button would
        // silently no-op. Falling back to the empty state keeps the input
        // usable.
        setApiKey('');
        setIsSaved(false);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // `silent`: revalidate in the background without the loading spinner —
  // used when the tab re-appears and we already have last-known numbers on
  // screen. The manual Refresh button stays non-silent so an explicit click
  // still shows explicit spinner feedback. Either way, a failure (no quota,
  // inactive subscription, network error) just leaves the Usage card hidden
  // — see the `isSaved && usageData` render gate below — rather than
  // surfacing an error card, since a saved-but-not-a-valid-API-plan key is
  // an expected state (e.g. it's actually a Pro-only license), not a fault.
  const fetchUsage = useCallback(async (opts: { force?: boolean; silent?: boolean } = {}) => {
    const { force = false, silent = false } = opts;
    if (!silent) setIsLoadingUsage(true);
    try {
      const r = await window.electronAPI.getNativelyUsage(force);
      if (r.ok && r.quota) {
        setUsageCache(r as UsageData);
        setUsageData(r as UsageData);
      }
    } catch {
      // no-op — see comment above
    } finally {
      if (!silent) setIsLoadingUsage(false);
    }
  }, []);

  useEffect(() => {
    if (!isSaved || isLoading) return;
    // First-ever load in this session (no cache yet) shows the spinner and
    // surfaces errors normally. A re-visit with cached numbers already on
    // screen instead revalidates silently in the background — the whole
    // point being the user never sees a loading state for data they've
    // already seen once this session.
    fetchUsage({ force: true, silent: !!usageCache });
  }, [isSaved, isLoading, fetchUsage]);

  useEffect(() => {
    window.electronAPI?.getNativelyPricing?.()
      .then((res) => {
        if (res?.ok && res.products) setPricingProducts(res.products);
      })
      .catch(() => {});
  }, []);

  // ── Trial init + polling ──────────────────────────────────
  const refreshTrial = useCallback(async () => {
    const res = await window.electronAPI?.getTrialStatus?.();
    if (!res?.ok) return;

    localStorage.setItem('natively_trial_claimed', 'true');

    setTrialState({
      active: !(res.expired ?? false),
      expired: res.expired ?? false,
      expiresAt: res.expires_at ?? '',
      startedAt: res.started_at ?? '',
      usage: res.usage ?? { ai: 0, stt_seconds: 0, search: 0 },
    });
    if (res.expired) {
      setShowTrialModal(true);
      if (trialPollRef.current) {
        clearInterval(trialPollRef.current);
        trialPollRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    // On mount: read local trial token (no network) to determine initial render state,
    // then fetch live usage from server. Setting trialState from local data first
    // prevents the "start trial" card from flashing while the server call is in flight.
    (async () => {
      try {
        const local = await window.electronAPI?.getLocalTrial?.();
        if (!local?.hasToken) {
          if (local?.trialClaimed) localStorage.setItem('natively_trial_claimed', 'true');
          return;
        }

        localStorage.setItem('natively_trial_claimed', 'true');

        if (local.expired) {
          // Token exists but expired locally — show modal immediately, confirm via server
          setTrialState({
            active: false,
            expired: true,
            expiresAt: local.expiresAt ?? '',
            startedAt: local.startedAt ?? '',
            usage: { ai: 0, stt_seconds: 0, search: 0 },
          });
          setShowTrialModal(true);
          refreshTrial(); // updates usage counters in the modal
          return;
        }

        // Set optimistic active state immediately from local data so the correct
        // card renders before the server responds (prevents start-card flash).
        // Usage counters start at 0 and are replaced by refreshTrial below.
        setTrialState({
          active: true,
          expired: false,
          expiresAt: local.expiresAt ?? '',
          startedAt: local.startedAt ?? '',
          usage: { ai: 0, stt_seconds: 0, search: 0 },
        });

        // Fetch live usage + start 15s polling (was 30s — halved so counters
        // feel more responsive during an active session).
        refreshTrial();
        trialPollRef.current = setInterval(refreshTrial, 15_000);
      } finally {
        setIsCheckingTrial(false);
      }
    })();
    return () => {
      if (trialPollRef.current) clearInterval(trialPollRef.current);
    };
  }, [refreshTrial]);

  const handleStartTrial = async () => {
    setTrialLoading(true);
    setTrialError(null);
    try {
      const res = await window.electronAPI?.startTrial?.();
      if (!res?.ok) {
        if (res?.error === 'trial_ip_limit' || res?.error === 'trial_start_rate_limited') {
          localStorage.setItem('natively_trial_claimed', 'true');
          setTrialState({
            active: false,
            expired: true,
            expiresAt: '',
            startedAt: '',
            usage: { ai: 0, stt_seconds: 0, search: 0 },
          });
          return;
        }
        const msg =
          res?.error === 'invalid_hwid'
            ? 'Could not read device ID. Restart the app and try again.'
            : res?.error || 'Could not start trial. Try again.';
        setTrialError(msg);
        return;
      }

      localStorage.setItem('natively_trial_claimed', 'true');

      if (res.already_used && res.expired) {
        setTrialState({
          active: false,
          expired: true,
          expiresAt: '',
          startedAt: '',
          usage: { ai: 0, stt_seconds: 0, search: 0 },
        });
        return;
      }
      setTrialState({
        active: !(res.expired ?? false),
        expired: res.expired ?? false,
        expiresAt: res.expires_at ?? '',
        startedAt: res.started_at ?? '',
        usage: res.usage ?? { ai: 0, stt_seconds: 0, search: 0 },
      });
      if (!res.expired) {
        trialPollRef.current = setInterval(refreshTrial, 30_000);
      }
    } catch (e: any) {
      setTrialError(e.message || 'Network error');
    } finally {
      setTrialLoading(false);
    }
  };

  const handleByok = async () => {
    // Only wipe — modal transitions to DoneState, then onDone closes it
    await window.electronAPI?.endTrialByok?.();
  };

  const handleTrialDone = () => {
    setTrialState(null);
    setShowTrialModal(false);
  };

  // Single box, two credential types. A Natively API key (`natively_sk_...`)
  // is saved via CredentialsManager and already auto-activates Pro server-side
  // when the plan qualifies (ipcHandlers.ts `set-natively-api-key`). Anything
  // else is treated as a Dodo/Gumroad Pro license key and goes through
  // licenseActivate instead — that path activates Pro but does NOT write an
  // API credential, so it must stay on its own success state, never isSaved.
  // Default to licenseActivate for anything that isn't the known API-key
  // prefix, rather than trying to pattern-match the license-key shape — an
  // API key misrouted to licenseActivate reproduces a known half-activation
  // bug (Pro on, no credentials stored, no usage tracking), which is worse
  // than a license key misrouted the other way.
  const handleSave = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed || apiKey.includes('•')) return;
    if (!trimmed.startsWith('natively_sk_')) {
      return activateProLicense(trimmed);
    }
    setIsSaving(true);
    setError(null);
    try {
      const r = await window.electronAPI.setNativelyApiKey(trimmed);
      if (r.success) {
        setApiKey('•'.repeat(24));
        setIsSaved(true);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2500);
        // NOTE: do NOT also call setDefaultModel('natively') / setSttProvider('natively')
        // here. The main-process `set-natively-api-key` handler already auto-promotes
        // both the default model and the STT provider server-side (see
        // CredentialsManager.setNativelyApiKey) and runs reconfigureSttProvider once.
        // Firing those extra IPCs raced a SECOND audio-pipeline rebuild against the
        // first, which deadlocked/crashed the native audio stack right after a key
        // save (the "app hangs after entering the key" bug, macOS + Windows).
      } else {
        setError(r.error || 'Failed to save API key');
      }
    } catch (e: any) {
      setError(e.message || 'Unexpected error');
    } finally {
      setIsSaving(false);
    }
  };

  const activateProLicense = async (key: string) => {
    setIsSaving(true);
    setError(null);
    try {
      const r = await window.electronAPI?.licenseActivate?.(key);
      if (r?.success) {
        setApiKey('');
        setJustActivatedPro(true);
        setTimeout(() => setJustActivatedPro(false), 2500);
        // Intentionally does not touch isSaved/fetchUsage — no API
        // credential was written, so there is no usage to fetch and no
        // "Connected" badge to show.
      } else {
        setError(r?.error || 'Activation failed. Please try again.');
      }
    } catch (e: any) {
      setError(e.message || 'Activation failed.');
    } finally {
      setIsSaving(false);
    }
  };

  // The Usage card is the one region that CANNOT be put on a fixed schedule:
  // its data comes from the network, so on activation `isSaved` flips, the plan
  // chooser starts leaving, `fetchUsage` fires, and the quota lands some
  // variable time later. A plain delay would fire before the data exists on a
  // cold fetch and the card would then pop in with no animation at all.
  //
  // So the layout sequence stays driven by `isSaved`, and this card spends
  // whatever is LEFT of its scheduled slot when its data actually arrives:
  //   * warm `usageCache` (persisted across restarts) — elapsed ≈ 0, so it takes
  //     the full 140ms and lands in its choreographed slot, crossing the
  //     chooser's collapse exactly as designed;
  //   * cold fetch at 800ms — the slot is long gone, delay clamps to 0, and it
  //     animates in the instant the numbers land, which reads as "the data just
  //     arrived" because that is what happened;
  //   * fetch fails — nothing appears, per the existing decision at the render
  //     gate below that a saved-but-planless key is an expected state.
  // Same curve and duration in every case, so a slow network degrades to a late
  // animation, never to a cut.
  const usageArmedAtRef = useRef<number | null>(null);
  if (isSaved) { if (usageArmedAtRef.current === null) usageArmedAtRef.current = performance.now(); }
  else usageArmedAtRef.current = null;

  const usageDelay = (slot: number) =>
    usageArmedAtRef.current === null
      ? 0
      : Math.max(0, slot - (performance.now() - usageArmedAtRef.current) / 1000);

  const clearingRef = useRef(false);

  const handleClear = async () => {
    if (clearingRef.current) return;
    clearingRef.current = true;
    const prevKey = apiKey;
    // Optimistic ON PURPOSE, and it needs no spinner: unlike Deactivate — whose
    // only visible effect was a card vanishing after an await, so the wait was
    // dead air — this immediately moves four regions of the page. That layout
    // change IS the feedback, and a spinner would only delay it.
    //
    // What was actually wrong here is that failure was unobservable. This call
    // also revokes the bundled Pro licence (ipcHandlers.ts:6380), and it used to
    // be fired un-awaited into `.catch(() => {})`. If it rejected, the key was
    // still saved in main, Pro was still active, and the user was looking at a
    // UI that had animated a removal which never happened.
    //
    // `usageData` is deliberately NOT cleared here — see the Usage card's
    // AnimatePresence below, which cannot play an exit for a child whose data
    // has already gone.
    setApiKey('');
    setIsSaved(false);
    setError(null);
    setUsageCache(null);
    try {
      await window.electronAPI.setNativelyApiKey('');
    } catch (e: any) {
      // The entrance/exit are declarative on `isSaved`, so the rollback animates
      // back in on the same curves without any extra work.
      setApiKey(prevKey);
      setIsSaved(true);
      setError(e?.message || 'Could not remove the key — it is still saved.');
    } finally {
      clearingRef.current = false;
    }
  };

  const openExternal = (url: string) => {
    (window.electronAPI as any)?.openExternal?.(url);
  };

  const isDirty = apiKey.length > 0 && !apiKey.includes('•') && !isSaved;
  const planLabel = usageData?.plan
    ? usageData.plan.charAt(0).toUpperCase() + usageData.plan.slice(1)
    : null;
  const fmtDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return iso;
    }
  };

  const PlansCard = (
    // The hover handlers that used to live here only existed to pause a
    // setInterval that auto-rotated the tier selector every 4.5s. That
    // rotation is gone (it made the panel look like it was glitching
    // mid-transition), so there is nothing left to pause.
    <div className="space-y-3">
      {/* Header. The "Pro, Max & Ultra include Natively Pro app" note that used
          to sit opposite this label is gone: the tab header above the whole
          section already states it, and each qualifying tier lists "Full
          Natively Pro app features included" in its own feature rows. */}
      <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-widest">
        Choose a Plan
      </p>

      {/* Segmented control selector tab bar */}
      <div
        role="tablist"
        aria-label="Natively API plan tier"
        className="natively-api-selector-bar grid grid-cols-4 relative p-1 bg-black/10 dark:bg-white/5 border border-white/5 rounded-2xl overflow-hidden"
      >
        {/* Active sliding pill */}
        <div
          aria-hidden="true"
          className="natively-api-selector-pill-track absolute top-0 bottom-0 left-0 w-1/4 p-1 transition-transform duration-220 ease-[cubic-bezier(0.23,1,0.32,1)] will-change-transform"
          style={{
            transform: `translate3d(${
              selectedPlanId === 'natively_api_standard_monthly' ? '0%' :
              selectedPlanId === 'natively_api_pro_monthly' ? '100%' :
              selectedPlanId === 'natively_api_max_monthly' ? '200%' :
              '300%'
            }, 0, 0)`
          }}
        >
          {/* No `transition-all` here: the fill/shadow crossfade is declared
              in index.css against the exact properties that change, so a
              tier switch never animates layout-affecting ones. The slide is
              on the track wrapper above and is untouched. */}
          <div className={`w-full h-full natively-api-selector-pill rounded-xl ${
            selectedPlanId === 'natively_api_standard_monthly' ? 'natively-api-selector-pill-standard' :
            selectedPlanId === 'natively_api_pro_monthly' ? 'natively-api-selector-pill-pro' :
            selectedPlanId === 'natively_api_max_monthly' ? 'natively-api-selector-pill-max' :
            'natively-api-selector-pill-ultra'
          }`} />
        </div>
        {(
          [
            { id: 'natively_api_standard_monthly', name: 'Standard', price: '$8/mo' },
            { id: 'natively_api_pro_monthly', name: 'Pro', price: '$15/mo' },
            { id: 'natively_api_max_monthly', name: 'Max', price: '$25/mo' },
            { id: 'natively_api_ultra_monthly', name: 'Ultra', price: '$35/mo' },
          ] as const
        ).map((tab) => {
          const isSel = selectedPlanId === tab.id;
          const liveProduct = pricingProducts[tab.id];
          const displayPrice = liveProduct?.formattedPrice || tab.price;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`natively-api-tab-${tab.id}`}
              aria-selected={isSel}
              aria-controls="natively-api-tabpanel"
              tabIndex={isSel ? 0 : -1}
              onClick={() => {
                selectPlan(tab.id);
              }}
              className={`natively-api-selector-tab ${isSel ? 'active' : ''}`}
            >
              <span className="tab-name">{tab.name}</span>
              <span className="tab-price">{displayPrice}</span>
            </button>
          );
        })}
      </div>

      {/* Selected Plan Details Container (Double-Bezel Architecture) */}
      {(() => {
        const planOrder = [
          'natively_api_standard_monthly',
          'natively_api_pro_monthly',
          'natively_api_max_monthly',
          'natively_api_ultra_monthly',
        ];
        const prevIndex = planOrder.indexOf(prevPlanId);
        const currentIndex = planOrder.indexOf(selectedPlanId);
        const direction = currentIndex >= prevIndex ? 1 : -1;

        const plan = PLANS.find((p) => p.id === selectedPlanId)!;
        const liveProduct = pricingProducts[plan.id];
        const price = liveProduct?.formattedPrice || plan.price;
        const checkoutUrl = liveProduct?.checkoutUrl || plan.url;
        const currentPlan = usageData?.plan?.toLowerCase();
        const rowPlan = plan.name.toLowerCase();
        const isActive =
          currentPlan === rowPlan ||
          (rowPlan === 'standard' && currentPlan === 'starter');

        return (
          <div
            className="natively-api-details-wrapper relative w-full"
            role="tabpanel"
            id="natively-api-tabpanel"
            aria-labelledby={`natively-api-tab-${plan.id}`}
          >
            <InteractiveCard
              className={`natively-api-detail-card group h-full w-full relative overflow-hidden natively-api-detail-card-${plan.name.toLowerCase()}`}
              glowColor={TIER_GLOW[plan.name as keyof typeof TIER_GLOW]}
              data-active={isActive ? "true" : "false"}
              // No inline `transition` here on purpose. index.css already
              // declares `transition: transform/box-shadow/border-color 180ms`
              // with `!important` on `.natively-api-detail-card`, and an author
              // !important declaration outranks a style-attribute one, so any
              // inline transition string on this element is dead weight. It
              // silently was for a long time: a 280ms value sat here doing
              // nothing while the 180ms from CSS is what actually ran.
              // Note `background` is NOT in that list, so the tier-fill swap is
              // instantaneous; the crossfade you see comes from the
              // AnimatePresence child below, which is a different element.
            >
              <AnimatePresence custom={direction}>
                <motion.div
                  key={selectedPlanId}
                  custom={direction}
                  variants={cardContainerVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="w-full h-full absolute top-0 left-0 px-5 pt-4 pb-4"
                >
                  {/* Two columns. The reference cards are single-column because
                      they are ~300px wide; this one is 640px, and stacking
                      name → description → price → features → CTA vertically
                      there both wastes the width and forces the card ~80px
                      taller. The reference's LOOK (quiet surface, one muted
                      corner glow, saturation only on the CTA, low-contrast
                      supporting text) is what matters and is preserved. */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 h-full">
                    {/* Left: identity, price, action */}
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5 h-5">
                        {plan.badgeText && (
                          <span className="natively-api-fill-pill inline-flex items-center px-2 py-0.5 rounded-full text-[9.5px] font-semibold uppercase tracking-wider">
                            {plan.badgeText}
                          </span>
                        )}
                      </div>

                      <h4 className="natively-api-on-fill mt-2.5 text-[17px] font-bold tracking-tight leading-none">
                        {plan.name}
                      </h4>
                      <p className="natively-api-on-fill-dim text-[11px] mt-1.5 leading-snug">
                        {plan.description}
                      </p>

                      {/* The one piece of high-contrast type. No per-tier
                          colour — that lives in the corner glow and the CTA. */}
                      <div className="mt-3 flex items-baseline gap-1.5">
                        <span
                          className="natively-api-on-fill text-[38px] font-bold leading-none"
                          style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.04em' }}
                        >
                          {price}
                        </span>
                        <span className="natively-api-on-fill-dim text-[12px] font-medium">/ month</span>
                      </div>

                      <div className="mt-auto pt-3">
                        {isActive ? (
                          <div className="w-full natively-api-active-tag text-center rounded-full text-[12.5px] font-semibold select-none flex items-center justify-center">
                            Active Plan
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              openExternal(checkoutUrl);
                            }}
                            className={`natively-api-pricing-cta ${
                              plan.name === 'Pro'
                                ? 'natively-api-pricing-cta-pro'
                                : plan.name === 'Max'
                                  ? 'natively-api-pricing-cta-max'
                                  : plan.name === 'Ultra'
                                    ? 'natively-api-pricing-cta-ultra'
                                    : 'natively-api-pricing-cta-neutral'
                            }`}
                          >
                            Get Started with {plan.name} <ArrowUpRight size={14} strokeWidth={2.5} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Right: what you get, all in low-contrast gray */}
                    <div className="flex flex-col min-w-0">
                      <p className="natively-api-on-fill-dim text-[9px] font-semibold uppercase tracking-[0.14em]">
                        What's included
                      </p>
                      <div className="natively-api-body-rule h-px mt-2 mb-2.5" />
                      <ul className="space-y-2">
                        {plan.features.map((feature, i) => {
                          const FeatureIcon = pickFeatureIcon(feature);
                          return (
                            <li key={i} className="natively-api-on-fill-dim flex items-center gap-2 text-[11px] leading-snug">
                              <span className="natively-api-feature-badge shrink-0 w-[18px] h-[18px] rounded-full flex items-center justify-center">
                                <FeatureIcon size={10} strokeWidth={2.2} />
                              </span>
                              <span className="min-w-0">{feature}</span>
                            </li>
                          );
                        })}
                      </ul>
                      <p className="natively-api-on-fill-dim mt-auto pt-3 text-[10px] leading-snug opacity-80">
                        {plan.note}
                      </p>
                    </div>
                  </div>
                </motion.div>
              </AnimatePresence>
            </InteractiveCard>
          </div>
        );
      })()}

    </div>
  );

  return (
    // LayoutGroup so the three regions below share one layout pass. See
    // ../../lib/plansMotion for why this whole tab is FLIP rather than resizing.
    <LayoutGroup>
    <div className="space-y-6 animated fadeIn" data-interface-theme={interfaceTheme}>
      {/* Page title intentionally omitted here — PlansSettings.tsx (the parent
          tab wrapper) already renders "Plans & Billing" as the section header.
          A second "Natively API / Managed transcription, AI & search" title
          directly beneath it read as two stacked, near-duplicate headers.
          The "Connected"/plan-name badge that used to live here moved down
          into the "Natively key" card header, where it stays visible in
          both the saved and unsaved states without its own header row. */}

      {/* ── Free Trial Modal (post-trial) ─────────────── */}
      {showTrialModal && trialState && (
        <FreeTrialModal usage={trialState.usage} onByok={handleByok} onDone={handleTrialDone} />
      )}

      {/* ── Active trial status card ──────────────────── */}
      {trialState?.active &&
        (() => {
          const sttMin = (trialState.usage.stt_seconds / 60).toFixed(1);
          return (
            /* Ref B: instead of a hard gradient block, soft blurred colour
               bleeds in from the card edges — a cool haze at the top, a warm
               amber haze at the bottom-middle, both very diffuse, like light
               behind frosted glass. It gives this transient state real warmth
               and presence without introducing a competing hard-edged hue, and
               without touching the trial state machine above it. */
            <div>
              <SectionLabel aside={<TrialCountdown expiresAt={trialState.expiresAt} />}>
                Free trial active
              </SectionLabel>
              <div className="trial-bleed-card">
                <div className="trial-bleed-content px-4 py-4 space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <TrialUsagePill
                      icon={Zap}
                      used={trialState.usage.ai}
                      limit={10}
                      label="AI"
                      unit=""
                    />
                    <TrialUsagePill
                      icon={Mic}
                      used={Math.round(trialState.usage.stt_seconds / 60)}
                      limit={10}
                      label="STT"
                      unit="m"
                    />
                    <TrialUsagePill
                      icon={Search}
                      used={trialState.usage.search}
                      limit={2}
                      label="Search"
                      unit=""
                    />
                  </div>

                  {/* Secondary, not accent-filled: the plan list directly below
                      is the primary action on this screen, and two full-width
                      accent pills competing in one viewport is no hierarchy at
                      all. */}
                  <button
                    onClick={() => setShowTrialModal(true)}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-full text-[13px] font-medium bg-bg-input text-text-primary border border-border-muted hover:border-text-tertiary cursor-pointer active:scale-[0.985] transition-[border-color,transform] duration-150 ease-out motion-reduce:transition-none"
                  >
                    See your options
                    <ArrowUpRight size={14} strokeWidth={2.2} />
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-text-tertiary mt-2.5 px-1">
                {trialState.usage.ai} AI · {sttMin} min STT · {trialState.usage.search} searches used
                so far.
              </p>
            </div>
          );
        })()}

      {/* ── Free trial start card (no key, no active trial) ── */}
      {!isLoading &&
        !isSaved &&
        !isCheckingTrial &&
        (!trialState || (trialState.expired && !trialState.active)) &&
        (() => {
          const isClaimed =
            trialState?.expired === true ||
            localStorage.getItem('natively_trial_claimed') === 'true';

          if (isClaimed) {
            return null;
          }

          return (
            <Card>
              <div className="px-4 py-4">
                <div className="flex items-center gap-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium text-text-primary tracking-[-0.01em]">
                      Try the Natively API free
                    </p>
                    <p className="text-[12px] text-text-secondary mt-1 leading-snug">
                      30 min · 10 AI · 10m STT · 2 searches. No account needed
                    </p>
                  </div>
                  <button
                    onClick={handleStartTrial}
                    disabled={trialLoading || isClaimed}
                    className={`shrink-0 flex items-center justify-center gap-2 px-4 h-9 rounded-full text-[13px] font-medium transition-[background-color,transform] duration-150 ease-out motion-reduce:transition-none ${
                      isClaimed
                        ? 'bg-bg-input text-text-tertiary cursor-not-allowed'
                        : 'bg-accent-primary hover:bg-accent-hover text-on-accent active:scale-[0.985] cursor-pointer'
                    }`}
                  >
                    {trialLoading ? (
                      <>
                        <Loader2 size={13} className="animate-spin" /> Starting…
                      </>
                    ) : isClaimed ? (
                      'Already claimed'
                    ) : (
                      'Start free trial'
                    )}
                  </button>
                </div>

                {/* Error Handling */}
                {trialError && !isClaimed && (
                  <div className="flex items-center gap-2 mt-3">
                    <AlertCircle size={13} className="text-[var(--text-danger)] shrink-0" strokeWidth={2} />
                    <p className="text-[12px] text-[var(--text-danger)]">{trialError}</p>
                  </div>
                )}
              </div>
            </Card>
          );
        })()}

      {/* ── Natively key card — one box for either credential type ────── */}
      <div>
        <SectionLabel
          aside={
            !isLoading && isSaved ? (
              <div className="flex items-center gap-3 shrink-0">
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {planLabel ?? 'Connected'}
                </span>
                <button
                  onClick={handleClear}
                  className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-[var(--text-danger)] transition-colors duration-150 cursor-pointer motion-reduce:transition-none"
                >
                  <Trash2 size={11} strokeWidth={2} />
                  Remove
                </button>
              </div>
            ) : undefined
          }
        >
          Natively key
        </SectionLabel>

        {/* `natively-key-card` gives the flat box the same MATERIAL as the
            rest of this tab — layered fill, specular top hairline, 24px
            blueprint grid, raised floor shadow — without its COLOUR. The
            plaque and its well are achromatic; the Activate button is the only
            saturated thing in the section, and only once it has something to
            act on. See the "tactile credential plaque" block in index.css. */}
        <Card className="natively-key-card">
          <div className="px-4 py-4 space-y-3">
            {/* Says the quiet part out loud: one box, EITHER credential. The
                placeholder alone was carrying that, and a placeholder
                disappears the moment you type.

                The mark sits ON this line rather than in a header of its own:
                no squircle, no tinted well, no title + sub-label block. The
                section label above is still the heading. */}
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="natively-key-mark"
                style={{ ['--natively-key-mark-src' as string]: `url(${nativelyLogo})` } as React.CSSProperties}
              />
              <p className="natively-key-sub text-[12px] leading-snug">
                Activate with a Natively API key or a Natively Pro license.
              </p>
            </div>

            {/* The input is the subject of this card. It's now a pressed-in
                well rather than a hairline box — same inset vocabulary as the
                jelly controls, and it gives the credential somewhere to sit.

                The placeholder names the two credential types instead of
                showing the raw `natively_sk_` prefix. That prefix is real —
                handleSave routes on it — but it is an implementation detail
                the user has no reason to recognise, and pairing a literal
                token against the plain-English "or your Pro license key" made
                the two halves read as different KINDS of thing rather than as
                two options for the same box. */}
            <input
              type="text"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setIsSaved(false);
                setError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="Natively API key or Natively Pro license"
              spellCheck={false}
              autoComplete="off"
              data-invalid={error ? 'true' : 'false'}
              className="natively-key-input w-full px-3.5 h-11 text-[13px] font-mono text-text-primary
                            placeholder:text-text-tertiary placeholder:font-sans"
            />

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 text-[12px] text-[var(--text-danger)]">
                <AlertCircle size={13} className="shrink-0" />
                {error}
              </div>
            )}

            {/* Save / Activate button. The disabled state used to be a
                full-width saturated slab (`bg-legacy-action-disabled-bg`),
                which made a control you cannot press the loudest element on
                the card. It now recedes until there's something to submit.
                The four states are unchanged — they're just projected onto a
                `data-state` attribute so the paint (jelly clay on the accent
                accent when ready, ghost when not, tinted chip on success)
                lives in index.css next to the rest of the tab's material. */}
            <button
              onClick={handleSave}
              disabled={isSaving || !isDirty}
              data-state={
                isSaving ? 'saving' : justSaved || justActivatedPro ? 'done' : !isDirty ? 'idle' : 'ready'
              }
              className={`natively-key-cta w-full h-10 text-[13px] font-medium select-none ${
                isSaving
                  ? 'cursor-wait'
                  : justSaved || justActivatedPro
                    ? 'cursor-pointer'
                    : !isDirty
                      ? 'cursor-default'
                      : 'cursor-pointer'
              }`}
            >
              {isSaving ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 size={13} className="animate-spin" />
                  Activating…
                </span>
              ) : justSaved ? (
                <span className="flex items-center justify-center gap-2">
                  <CheckCircle size={13} />
                  Saved
                </span>
              ) : justActivatedPro ? (
                <span className="flex items-center justify-center gap-2">
                  <CheckCircle size={13} />
                  Pro activated
                </span>
              ) : (
                'Activate'
              )}
            </button>
          </div>
        </Card>

        {/* T&C footnote under the card. The "Don't have a key? Subscribe to get
            one" prompt that used to lead this line is gone — the plan chooser
            directly below is the same call to action, stated better. */}
        <p className="text-[11px] text-text-tertiary leading-relaxed mt-2.5 px-1 text-center">
          By activating, you agree to our{' '}
          <span
            onClick={() => openExternal('https://natively.software/nativelyapi/t&c')}
            className="text-text-secondary hover:text-text-primary underline decoration-border-muted underline-offset-[3px] cursor-pointer transition-colors duration-150 motion-reduce:transition-none"
          >
            Terms &amp; Conditions
          </span>
          .
        </p>
      </div>

      {afterKeySection}

      {/* ── Plans ──────────────────────────────────────────
          Leads the arrival sequence on key removal: it takes over the region
          the Usage card and the "Change plan" accordion just vacated, so it is
          the thing that answers "what replaced what I removed".
          `y: -8` — it descends from the key card above that caused the change. */}
      <AnimatePresence mode="popLayout" initial={false}>
        {!isSaved && (
          <motion.div
            key="api-plans"
            layout="position"
            // width:100% is REQUIRED, not cosmetic: mode="popLayout" sets
            // position:absolute on the exiting child, and without an explicit
            // width it collapses to content width the instant it pops — a
            // visible horizontal snap before the fade.
            // `contain: layout` (never `paint` — these cards' 12-32px shadows
            // paint outside their box and would be clipped) confines the
            // invalidation of the two commit-pass layouts.
            style={{ width: '100%', contain: 'layout' }}
            // No `y` and no `height`. FLIP owns every pixel of vertical motion;
            // a `y` on top of it composites a second translation, and a `height`
            // is what made this choppy in the first place.
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.985 }}
            transition={
              prefersReducedMotion
                ? { duration: INK.in, delay: BEAT }
                : {
                  // `layout` defaults to a SPRING — name it or the house curves
                  // are silently discarded.
                  layout: { duration: SETTLE.activate, ease: EASE_ENTER },
                  opacity: { duration: INK.in, ease: EASE_ENTER, delay: BEAT },
                  default: { duration: INK.out, ease: EASE_LEAVE },
                }
            }
          >
            {PlansCard}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Usage card — only for a Natively API key with a confirmed  ── */}
      {/* valid plan (usageData populated by a successful quota fetch). */}
      {/* isSaved alone isn't enough: a saved-but-invalid/inactive key   */}
      {/* has nothing usage-shaped to show, so the section stays hidden */}
      {/* entirely rather than surfacing a card with an error in it.    */}
      {/* Presence is gated on `isSaved` ALONE, and `usageData` is cleared from
          this wrapper's onExitComplete rather than in handleClear. AnimatePresence
          cannot play an exit for a child whose data has already vanished — nulling
          both in the same tick made this unmount instantly no matter what it was
          wrapped in. The inner guard keeps the null-safety for the case where a
          saved key simply has no valid plan. */}
      <AnimatePresence mode="popLayout" initial={false} onExitComplete={() => setUsageData(null)}>
      {isSaved && usageData && (
        <motion.div
          key="api-usage"
          layout="position"
          // width:100% is REQUIRED, not cosmetic: mode="popLayout" sets
          // position:absolute on the exiting child, and without an explicit
          // width it collapses to content width the instant it pops — a
          // visible horizontal snap before the fade.
          // `contain: layout` (never `paint` — these cards' 12-32px shadows
          // paint outside their box and would be clipped) confines the
          // invalidation of the two commit-pass layouts.
          style={{ width: '100%', contain: 'layout' }}
          // No `y` and no `height`. FLIP owns every pixel of vertical motion;
          // a `y` on top of it composites a second translation, and a `height`
          // is what made this choppy in the first place.
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 0.985 }}
          transition={
            prefersReducedMotion
              ? { duration: INK.in, delay: usageDelay(BEAT) }
              : {
                // `layout` defaults to a SPRING — name it or the house curves
                // are silently discarded.
                layout: { duration: SETTLE.activate, ease: EASE_ENTER },
                opacity: { duration: INK.in, ease: EASE_ENTER, delay: usageDelay(BEAT) },
                default: { duration: INK.out, ease: EASE_LEAVE },
              }
          }
        >
          <SectionLabel
            aside={
              <span className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-text-tertiary">
                  Resets {fmtDate(usageData.quota.resets_at)}
                </span>
                <button
                  onClick={() => fetchUsage({ force: true })}
                  disabled={isLoadingUsage}
                  title="Refresh"
                  aria-label="Refresh usage"
                  className="flex items-center justify-center w-5 h-5 rounded-md text-text-tertiary
                                hover:text-text-secondary transition-colors duration-150 motion-reduce:transition-none
                                disabled:opacity-40 cursor-pointer shrink-0"
                >
                  <RefreshCw
                    size={11}
                    className={isLoadingUsage ? 'animate-spin' : ''}
                    strokeWidth={2}
                  />
                </button>
              </span>
            }
          >
            Usage this month
          </SectionLabel>

          <Card>
            <div className="px-4 py-4 space-y-4">
              <QuotaBar label="Transcription" icon={Mic} bucket={usageData.quota.transcription} />
              <QuotaBar label="AI requests" icon={Brain} bucket={usageData.quota.ai} />
              <QuotaBar label="Web searches" icon={Search} bucket={usageData.quota.search} />
            </div>
          </Card>
        </motion.div>
      )}
      </AnimatePresence>

      {/* ── Plans — already-subscribed users have already chosen a plan; ── */}
      {/* collapse the chooser behind "Change plan" instead of always showing */}
      {/* the full pricing selector at equal weight to Usage above it.        */}
      <AnimatePresence mode="popLayout" initial={false}>
        {isSaved && (
          <motion.div
            key="api-change-plan"
            layout="position"
            // width:100% is REQUIRED, not cosmetic: mode="popLayout" sets
            // position:absolute on the exiting child, and without an explicit
            // width it collapses to content width the instant it pops — a
            // visible horizontal snap before the fade.
            // `contain: layout` (never `paint` — these cards' 12-32px shadows
            // paint outside their box and would be clipped) confines the
            // invalidation of the two commit-pass layouts.
            style={{ width: '100%', contain: 'layout' }}
            // No `y` and no `height`. FLIP owns every pixel of vertical motion;
            // a `y` on top of it composites a second translation, and a `height`
            // is what made this choppy in the first place.
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.985 }}
            transition={
              prefersReducedMotion
                ? { duration: INK.in, delay: BEAT }
                : {
                  // `layout` defaults to a SPRING — name it or the house curves
                  // are silently discarded.
                  layout: { duration: SETTLE.activate, ease: EASE_ENTER },
                  opacity: { duration: INK.in, ease: EASE_ENTER, delay: BEAT },
                  default: { duration: INK.out, ease: EASE_LEAVE },
                }
            }
          >
            <AccordionSection
              title="Change plan"
              className="bg-bg-item-surface rounded-2xl border-border-subtle !mb-0"
            >
              {PlansCard}
            </AccordionSection>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── How it works + Refund Policy — collapsed by default, this is ── */}
      {/* reference material, not something read on every settings visit.  */}
    </div>
    </LayoutGroup>
  );
};
