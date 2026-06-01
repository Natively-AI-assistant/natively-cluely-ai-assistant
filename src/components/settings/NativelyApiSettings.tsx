import {
  AlertCircle,
  ArrowUpRight,
  Brain,
  CalendarClock,
  CheckCircle,
  Clock,
  Info,
  Loader2,
  Mic,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  Zap,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NativelyLogoMark } from '../NativelyLogoMark';
import { FreeTrialModal } from '../trial/FreeTrialModal';
import { getMeetingInterfaceTheme, type MeetingInterfaceTheme } from '../../lib/meetingInterfaceTheme';
import { motion, AnimatePresence } from 'framer-motion';

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

const PLAN_IDS_ORDER = [
  'natively_api_standard_monthly',
  'natively_api_pro_monthly',
  'natively_api_max_monthly',
  'natively_api_ultra_monthly',
] as const;

const PLAN_STANDARD_URL = 'https://checkout.dodopayments.com/buy/pdt_0NbFixGmD8CSeawb5qvVl';
const PLAN_PRO_URL = 'https://checkout.dodopayments.com/buy/pdt_0NcM6Aw0IWdspbsgUeCLA';
const PLAN_MAX_URL = 'https://checkout.dodopayments.com/buy/pdt_0NcM7JElX4Af6LNVFS1Yf';
const PLAN_ULTRA_URL = 'https://checkout.dodopayments.com/buy/pdt_0NcM7rC2kAb69TFKsZnUU';

const PLANS = [
  {
    id: 'natively_api_standard_monthly',
    name: 'Standard',
    price: '$8',
    url: PLAN_STANDARD_URL,
    badgeText: 'Basic',
    includesPro: false,
    description: 'Ideal for light individual users who want essential transcription and model usage.',
    note: 'Does not include Natively Pro desktop app license. Custom API key usage is supported.',
    features: [
      '500 AI requests per month',
      '200 minutes of Speech-to-Text',
      '20 real-time web searches',
      'Standard server priority & support',
      'Full local API key support',
    ],
  },
  {
    id: 'natively_api_pro_monthly',
    name: 'Pro',
    price: '$15',
    url: PLAN_PRO_URL,
    badgeText: 'Recommended',
    includesPro: true,
    description: 'Best for power users and professionals seeking full local productivity integrations.',
    note: 'Includes a full Natively Pro desktop app license for the duration of subscription.',
    features: [
      '1,000 AI requests per month',
      '500 minutes of Speech-to-Text',
      '100 real-time web searches',
      'High-priority server request queue',
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
    description: 'Built for developers and teams using high volume text-to-speech and AI reasoning.',
    note: 'Includes a full Natively Pro desktop app license for the duration of subscription.',
    features: [
      '2,000 AI requests per month',
      '1,000 minutes of Speech-to-Text',
      '200 real-time web searches',
      'High-priority server request queue',
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
    description: 'For heavy enterprise users, continuous screen understanding, and high-frequency meeting recording.',
    note: 'Includes a full Natively Pro desktop app license for the duration of subscription.',
    features: [
      '3,000 AI requests per month',
      '2,000 minutes of Speech-to-Text',
      '300 real-time web searches',
      'Dedicated high-throughput queue',
      'Full Natively Pro app features included',
    ],
  },
] as const;

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

const cardSlideLeftVariants = {
  enter: {
    x: -12,
    scale: 0.98,
    opacity: 0,
    filter: 'blur(1px)'
  },
  center: {
    x: 0,
    scale: 1,
    opacity: 1,
    filter: 'blur(0px)',
    transition: {
      x: { type: 'spring' as const, duration: 0.58, bounce: 0.04 },
      scale: { type: 'spring' as const, duration: 0.58, bounce: 0.04 },
      opacity: { duration: 0.28, ease: [0.32, 0.72, 0, 1] as const },
      filter: { duration: 0.28, ease: [0.32, 0.72, 0, 1] as const }
    }
  },
  exit: {
    x: -8,
    scale: 0.985,
    opacity: 0,
    filter: 'blur(1px)',
    transition: {
      x: { type: 'spring' as const, duration: 0.44, bounce: 0 },
      scale: { type: 'spring' as const, duration: 0.44, bounce: 0 },
      opacity: { duration: 0.22, ease: [0.32, 0.72, 0, 1] as const },
      filter: { duration: 0.22, ease: [0.32, 0.72, 0, 1] as const }
    }
  }
};

const cardSlideRightVariants = {
  enter: {
    x: 12,
    scale: 0.98,
    opacity: 0,
    filter: 'blur(1px)'
  },
  center: {
    x: 0,
    scale: 1,
    opacity: 1,
    filter: 'blur(0px)',
    transition: {
      x: { type: 'spring' as const, duration: 0.58, bounce: 0.04 },
      scale: { type: 'spring' as const, duration: 0.58, bounce: 0.04 },
      opacity: { duration: 0.28, ease: [0.32, 0.72, 0, 1] as const },
      filter: { duration: 0.28, ease: [0.32, 0.72, 0, 1] as const }
    }
  },
  exit: {
    x: 8,
    scale: 0.985,
    opacity: 0,
    filter: 'blur(1px)',
    transition: {
      x: { type: 'spring' as const, duration: 0.44, bounce: 0 },
      scale: { type: 'spring' as const, duration: 0.44, bounce: 0 },
      opacity: { duration: 0.22, ease: [0.32, 0.72, 0, 1] as const },
      filter: { duration: 0.22, ease: [0.32, 0.72, 0, 1] as const }
    }
  }
};

const cardCtaVariants = {
  enter: {
    y: 6,
    scale: 0.98,
    opacity: 0
  },
  center: {
    y: 0,
    scale: 1,
    opacity: 1,
    transition: {
      y: { type: 'spring' as const, duration: 0.58, bounce: 0.06 },
      scale: { type: 'spring' as const, duration: 0.58, bounce: 0.06 },
      opacity: { duration: 0.28, ease: [0.32, 0.72, 0, 1] as const }
    }
  },
  exit: {
    y: 4,
    scale: 0.99,
    opacity: 0,
    transition: {
      y: { type: 'spring' as const, duration: 0.44, bounce: 0 },
      scale: { type: 'spring' as const, duration: 0.44, bounce: 0 },
      opacity: { duration: 0.22, ease: [0.32, 0.72, 0, 1] as const }
    }
  }
};

// ─── Quota bar ───────────────────────────────────────────────
function QuotaBar({
  label,
  icon: Icon,
  bucket,
  barColor,
}: {
  label: string;
  icon: React.ElementType;
  bucket: QuotaBucket;
  barColor: string;
}) {
  const pct = bucket.limit > 0 ? Math.min(100, (bucket.used / bucket.limit) * 100) : 0;
  const isHigh = pct >= 80;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon
            size={12}
            className={isHigh ? 'text-amber-400' : 'text-text-tertiary'}
            strokeWidth={1.75}
          />
          <span className="text-[12px] text-text-secondary">{label}</span>
        </div>
        <span
          className={`text-[12px] tabular-nums font-medium ${isHigh ? 'text-amber-400' : 'text-text-tertiary'}`}
        >
          {bucket.used.toLocaleString()}
          <span className="font-normal text-text-tertiary/60">
            {' '}
            / {bucket.limit.toLocaleString()}
          </span>
        </span>
      </div>
      <div className="h-[5px] w-full bg-bg-input rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${isHigh ? 'bg-amber-400' : barColor}`}
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
      className={`flex items-center gap-1 ${isWarning ? 'text-amber-400' : 'text-text-tertiary'}`}
    >
      <Clock size={11} strokeWidth={2} />
      <span className="text-[11px] font-mono font-semibold tabular-nums">
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
    <div className="bg-bg-input rounded-[10px] px-3 py-2.5 space-y-2 border border-border-subtle">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon
            size={12}
            strokeWidth={2}
            className={isHigh ? 'text-amber-400' : 'text-text-tertiary'}
          />
          <span className="text-[10.5px] text-text-secondary font-medium">{label}</span>
        </div>
        <span
          className={`text-[12px] tabular-nums font-bold ${isHigh ? 'text-amber-400' : 'text-text-primary'}`}
        >
          {used}
          <span className="text-[10px] font-medium text-text-tertiary">
            /{limit}
            {unit}
          </span>
        </span>
      </div>
      <div className="h-[4px] w-full bg-bg-surface rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${isHigh ? 'bg-amber-400' : 'bg-violet-500/70'}`}
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

// ─── Component ───────────────────────────────────────────────
export const NativelyApiSettings: React.FC = () => {
  const [apiKey, setApiKey] = useState('');
  const [isSaved, setIsSaved] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [isLoadingUsage, setIsLoadingUsage] = useState(false);
  const [pricingProducts, setPricingProducts] = useState<Record<string, PricingProduct>>({});
  const [selectedPlanId, setSelectedPlanId] = useState<string>('natively_api_pro_monthly');
  const [prevPlanId, setPrevPlanId] = useState<string>('natively_api_pro_monthly');
  const [hasUserSelected, setHasUserSelected] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    if (hasUserSelected || isHovered) return;

    const interval = setInterval(() => {
      setSelectedPlanId(prev => {
        setPrevPlanId(prev);
        const currentIndex = PLAN_IDS_ORDER.indexOf(prev as any);
        const nextIndex = currentIndex === -1 ? 1 : (currentIndex + 1) % PLAN_IDS_ORDER.length;
        return PLAN_IDS_ORDER[nextIndex];
      });
    }, 4500);

    return () => clearInterval(interval);
  }, [hasUserSelected, isHovered]);

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
          setApiKey('•'.repeat(24));
          setIsSaved(true);
        }
      } catch (e) {
        console.error('[NativelyApi]', e);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const fetchUsage = useCallback(async () => {
    setIsLoadingUsage(true);
    setUsageError(null);
    try {
      const r = await window.electronAPI.getNativelyUsage();
      if (r.ok && r.quota) {
        setUsageData(r as UsageData);
      } else {
        setUsageError(
          r.error === 'subscription_inactive'
            ? 'Subscription inactive — renew to restore access.'
            : r.error === 'key_not_found'
              ? 'Key not recognised by server.'
              : r.error === 'invalid_key_format'
                ? 'Invalid key format.'
                : r.error === 'network_error' || r.error?.includes('fetch')
                  ? 'Could not reach server.'
                  : `Server error: ${r.error ?? 'unknown'}`,
        );
      }
    } catch {
      setUsageError('Failed to load usage.');
    } finally {
      setIsLoadingUsage(false);
    }
  }, []);

  useEffect(() => {
    if (isSaved && !isLoading) fetchUsage();
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

  const handleSave = async () => {
    if (!apiKey.trim() || apiKey.includes('•')) return;
    setIsSaving(true);
    setError(null);
    try {
      const r = await window.electronAPI.setNativelyApiKey(apiKey.trim());
      if (r.success) {
        setApiKey('•'.repeat(24));
        setIsSaved(true);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2500);
        // @ts-ignore
        window.electronAPI?.setDefaultModel?.('natively').catch(console.error);
        // @ts-ignore
        window.electronAPI?.setSttProvider?.('natively').catch(console.error);
      } else {
        setError(r.error || 'Failed to save API key');
      }
    } catch (e: any) {
      setError(e.message || 'Unexpected error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = () => {
    setApiKey('');
    setIsSaved(false);
    setError(null);
    setUsageData(null);
    setUsageError(null);
    window.electronAPI.setNativelyApiKey('').catch(() => {});
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
    <div 
      className="space-y-4"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Header and Value Proposition */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-widest">
            Choose a Plan
          </p>
          <span className="text-[10px] text-text-tertiary">
            Pro, Max &amp; Ultra include Natively Pro app
          </span>
        </div>
        <div className="w-full flex items-center justify-center py-2.5 rounded-xl border natively-api-header-promo-banner">
          <span className="text-[11.5px] font-medium natively-api-header-promo-text">
            Use code <span className="font-bold natively-api-header-promo-code">INSIDER20</span> for 20% off Pro, Max &amp; Ultra
          </span>
        </div>
      </div>

      {/* Segmented control selector tab bar */}
      <div className="natively-api-selector-bar grid grid-cols-4 relative p-1 bg-black/10 dark:bg-white/5 border border-white/5 rounded-2xl overflow-hidden mb-2">
        {/* Active sliding pill */}
        <div 
          className="absolute top-0 bottom-0 left-0 w-1/4 p-1 transition-transform duration-220 ease-[cubic-bezier(0.23,1,0.32,1)] will-change-transform"
          style={{
            transform: `translate3d(${
              selectedPlanId === 'natively_api_standard_monthly' ? '0%' :
              selectedPlanId === 'natively_api_pro_monthly' ? '100%' :
              selectedPlanId === 'natively_api_max_monthly' ? '200%' :
              '300%'
            }, 0, 0)`
          }}
        >
          <div className={`w-full h-full natively-api-selector-pill rounded-xl transition-all duration-300 ${
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
              onClick={() => {
                selectPlan(tab.id);
                setHasUserSelected(true);
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
          <div className="natively-api-details-wrapper relative w-full">
            <div 
              className={`natively-api-detail-card h-full w-full relative overflow-hidden natively-api-detail-card-${plan.name.toLowerCase()}`} 
              data-active={isActive ? "true" : "false"}
              style={{
                transition: 'background 280ms cubic-bezier(0.23, 1, 0.32, 1), border-color 280ms cubic-bezier(0.23, 1, 0.32, 1), box-shadow 280ms cubic-bezier(0.23, 1, 0.32, 1)'
              }}
            >
              <AnimatePresence custom={direction}>
                <motion.div
                  key={selectedPlanId}
                  custom={direction}
                  variants={cardContainerVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="w-full h-full absolute top-0 left-0 p-6"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch relative z-10 h-full">
                    {/* Left Column - Pricing & Actions */}
                    <div className="flex flex-col justify-between">
                      <motion.div variants={cardSlideLeftVariants}>
                        {/* Badge & Inclusion Row */}
                        <div className="flex items-center gap-2 mb-4 h-6">
                          {plan.badgeText && (
                            <span className={`natively-api-pricing-badge ${
                              plan.name === 'Pro' 
                                ? 'natively-api-pricing-badge-recommended natively-api-badge-text-recommended' 
                                : plan.name === 'Max'
                                  ? 'natively-api-pricing-badge-max natively-api-badge-text-max'
                                  : plan.name === 'Ultra'
                                    ? 'natively-api-pricing-badge-ultra natively-api-badge-text-ultra'
                                    : 'natively-api-pricing-badge-standard natively-api-badge-text-standard'
                            }`}>
                              {plan.badgeText}
                            </span>
                          )}
                          {plan.includesPro && (
                            <span className="natively-api-pricing-badge natively-api-pricing-badge-emerald natively-api-badge-text-emerald select-none">
                              + Pro App
                            </span>
                          )}
                        </div>

                        {/* Plan Name */}
                        <h4 className="text-[20px] font-bold text-text-primary tracking-tight">
                          {plan.name} Tier
                        </h4>

                        {/* Price */}
                        <div className="mt-3 flex items-baseline gap-1.5">
                          <span className={`text-[34px] font-extrabold tracking-tight leading-none ${
                            plan.name === 'Pro' 
                              ? 'natively-api-price-pro' 
                              : plan.name === 'Max'
                                ? 'natively-api-price-max'
                                : plan.name === 'Ultra'
                                  ? 'natively-api-price-ultra'
                                  : 'natively-api-price-standard'
                          }`}>
                            {price}
                          </span>
                          <span className="text-[12px] font-medium text-text-tertiary">/ month</span>
                        </div>
                        <p className="text-[11.5px] text-text-secondary mt-2.5 leading-relaxed">
                          {plan.description}
                        </p>
                      </motion.div>

                      {/* Action / Checkout section */}
                      <motion.div className="mt-6 space-y-3" variants={cardCtaVariants}>
                        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg transition-opacity border natively-api-pricing-promo-wrapper ${
                          plan.includesPro 
                            ? 'opacity-100' 
                            : 'opacity-0 pointer-events-none select-none'
                        }`}>
                          <span className="text-[11px] font-medium natively-api-pricing-promo-text">
                            Code <strong className="natively-api-pricing-promo-bold font-bold select-all">INSIDER20</strong> for 20% off
                          </span>
                        </div>

                        <div>
                          {isActive ? (
                            <div className="w-full natively-api-active-tag text-center py-3 rounded-full text-[13px] font-semibold select-none flex items-center justify-center">
                              Active Plan
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                openExternal(checkoutUrl);
                                setHasUserSelected(true);
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
                      </motion.div>
                    </div>

                    {/* Right Column - Features & Scope */}
                    <motion.div 
                      className="flex flex-col h-full natively-api-features-panel rounded-2xl p-5"
                      variants={cardSlideRightVariants}
                    >
                      <p className="text-[10px] font-bold text-text-primary uppercase tracking-wider mb-4">
                        What's Included
                      </p>
                      <ul className="space-y-3 flex-1">
                        {plan.features.map((feature, i) => (
                          <li key={i} className="flex items-start gap-2.5 text-[12px] text-text-secondary leading-snug">
                            <CheckCircle 
                              size={13} 
                              className={`shrink-0 mt-[1.5px] ${
                                plan.name === 'Pro' 
                                  ? 'natively-api-check-icon-pro' 
                                  : plan.name === 'Max'
                                    ? 'natively-api-check-icon-max'
                                    : plan.name === 'Ultra'
                                      ? 'natively-api-check-icon-ultra'
                                      : 'natively-api-check-icon-standard'
                              }`}
                              strokeWidth={2.5} 
                            />
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-4 pt-4 border-t border-black/5 dark:border-white/5">
                        <p className="text-[10.5px] text-text-tertiary leading-relaxed">
                          {plan.note}
                        </p>
                      </div>
                    </motion.div>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        );
      })()}

      {/* AI quota note */}
      <div className="flex items-start gap-2 px-3 py-2.5 bg-bg-input rounded-xl border border-border-subtle">
        <Info size={11} className="text-text-tertiary shrink-0 mt-[1px]" strokeWidth={2} />
        <p className="text-[11px] text-text-tertiary leading-relaxed">
          AI requests include chat replies, meeting title &amp; summary generation, and embeddings
          — not just manual messages.
        </p>
      </div>
    </div>
  );

  return (
    <div className="space-y-4 animated fadeIn" data-interface-theme={interfaceTheme}>
      {/* ── Page title ───────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[15px] font-semibold text-text-primary tracking-[-0.01em]">
            Natively API
          </h3>
          <p className="text-[12px] text-text-tertiary mt-0.5 leading-snug">
            Managed transcription, AI &amp; search
          </p>
        </div>
        {!isLoading && isSaved && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
            <span className="text-[10px] font-semibold text-emerald-500 tracking-wide">
              {planLabel ?? 'Connected'}
            </span>
          </div>
        )}
      </div>

      {/* ── Free Trial Modal (post-trial) ─────────────── */}
      {showTrialModal && trialState && (
        <FreeTrialModal usage={trialState.usage} onByok={handleByok} onDone={handleTrialDone} />
      )}

      {/* ── Active trial status card ──────────────────── */}
      {trialState?.active &&
        (() => {
          const sttMin = (trialState.usage.stt_seconds / 60).toFixed(1);
          return (
            <Card className="shadow-sm border-violet-500/25">
              <div className="px-5 pt-5 pb-5 space-y-4">
                {/* Header — same layout as "Try Natively API free" start card */}
                <div className="flex items-start gap-3.5">
                  <div className="w-10 h-10 rounded-[11px] bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                    <NativelyLogoMark size={18} className="text-violet-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-[13.5px] font-semibold text-text-primary tracking-tight">
                        Free Trial Active
                      </p>
                      <TrialCountdown expiresAt={trialState.expiresAt} />
                    </div>
                    <p className="text-[10.5px] text-text-tertiary mt-1">
                      {trialState.usage.ai} AI · {sttMin} min STT · {trialState.usage.search}{' '}
                      searches used
                    </p>
                  </div>
                </div>

                {/* Usage pills */}
                <div className="grid grid-cols-3 gap-2">
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

                {/* CTA */}
                <button
                  onClick={() => setShowTrialModal(true)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-[9px] text-[12.5px] font-semibold bg-violet-600 hover:bg-violet-500 text-white shadow-[0_1px_3px_rgba(0,0,0,0.1)] transition-all active:scale-[0.98] cursor-pointer"
                >
                  <ArrowUpRight size={13} strokeWidth={2.3} />
                  Keep the momentum going
                </button>
              </div>
            </Card>
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
            <Card className="shadow-sm">
              <div className="px-5 pt-5 pb-4 flex flex-col items-center justify-center text-center">
                {/* Apple Promo Icon */}
                <div className="w-[42px] h-[42px] mb-3 rounded-[12px] bg-bg-input border border-border-subtle shadow-[inset_0_1px_rgba(255,255,255,0.06),0_2px_8px_rgba(0,0,0,0.04)] flex items-center justify-center relative overflow-hidden">
                  <NativelyLogoMark
                    size={20}
                    className={
                      isClaimed ? 'text-text-tertiary' : 'text-text-primary drop-shadow-sm'
                    }
                  />
                </div>

                <h3 className="text-[14.5px] font-bold text-text-primary tracking-tight mb-1">
                  Natively API. Try it free.
                </h3>
                <p className="text-[12px] text-text-secondary leading-snug px-4 mb-4">
                  Experience managed text-to-speech, AI models, and real-time research without a
                  subscription.
                </p>

                {/* Clean limits grid container */}
                <div className="flex items-center justify-center gap-3.5 mb-5 text-[11.5px] font-medium text-text-primary bg-bg-input px-3.5 py-2 rounded-[8px] border border-border-subtle shadow-[inset_0_1px_rgba(255,255,255,0.02)]">
                  <div className="flex flex-col items-center gap-1">
                    <Clock size={14} strokeWidth={2} className="text-blue-500" />
                    <span>30 min</span>
                  </div>
                  <div className="w-px h-5 bg-border-subtle/80" />
                  <div className="flex flex-col items-center gap-1">
                    <Brain size={14} strokeWidth={2} className="text-violet-500" />
                    <span>10 reqs</span>
                  </div>
                  <div className="w-px h-5 bg-border-subtle/80" />
                  <div className="flex flex-col items-center gap-1">
                    <Mic size={14} strokeWidth={2} className="text-emerald-500" />
                    <span>10m STT</span>
                  </div>
                  <div className="w-px h-5 bg-border-subtle/80" />
                  <div className="flex flex-col items-center gap-1">
                    <Search size={14} strokeWidth={2} className="text-orange-500" />
                    <span>2 searches</span>
                  </div>
                </div>

                <button
                  onClick={handleStartTrial}
                  disabled={trialLoading || isClaimed}
                  className={`w-full max-w-[240px] flex items-center justify-center gap-2 py-2 rounded-full text-[13px] font-bold shadow-[0_1px_3px_rgba(0,0,0,0.1)] transition-all ${
                    isClaimed
                      ? 'bg-bg-input text-text-tertiary border border-border-subtle cursor-not-allowed'
                      : 'bg-text-primary hover:bg-text-primary/90 text-bg-primary active:scale-[0.98]'
                  }`}
                >
                  {trialLoading ? (
                    <>
                      <Loader2 size={13} className="animate-spin" /> Starting trial…
                    </>
                  ) : isClaimed ? (
                    'Trial Already Claimed'
                  ) : (
                    'Start 10-Minute Free Trial'
                  )}
                </button>

                {/* Error Handling */}
                {trialError && !isClaimed && (
                  <div className="flex items-center gap-1.5 px-3 py-2 mt-3 bg-red-500/10 border border-red-500/20 rounded-[8px]">
                    <AlertCircle size={13} className="text-red-500 shrink-0" strokeWidth={2} />
                    <p className="text-[11.5px] text-red-500 font-medium">{trialError}</p>
                  </div>
                )}

                <p className="text-[10.5px] text-text-tertiary font-medium mt-3">
                  No account needed — bound to this device.
                </p>

                <div className="w-[30px] h-px bg-border-subtle my-3" />

                <p className="text-[11px] text-text-secondary font-medium">
                  Already have an API key? Enter it below.
                </p>
              </div>
            </Card>
          );
        })()}

      {/* ── Plans ────────────────────────────────────────── */}
      {!isSaved && PlansCard}

      {/* ── API Key card ─────────────────────────────────── */}
      <Card>
        {/* Card header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4">
          {/* Tinted icon well — Apple style */}
          <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center shrink-0">
            <NativelyLogoMark size={18} className="text-blue-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-text-primary">API Key</p>
            <p className="text-[11px] text-text-tertiary leading-snug mt-0.5">
              Your Natively API key from your subscription email
            </p>
          </div>
        </div>

        {/* Hairline divider */}
        <div className="h-px bg-border-subtle mx-5" />

        {/* Body */}
        <div className="px-5 pt-4 pb-5 space-y-3">
          {/* Label row */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-widest">
              Secret key
            </span>
            {isSaved && (
              <button
                onClick={handleClear}
                className="flex items-center gap-1 text-[11px] text-red-400/80 hover:text-red-400 transition-colors duration-150 cursor-pointer"
              >
                <Trash2 size={11} strokeWidth={2} />
                Remove
              </button>
            )}
          </div>

          {/* Input — with inset shadow for Apple depth */}
          <input
            type="text"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setIsSaved(false);
              setError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            placeholder="natively_api_..."
            spellCheck={false}
            autoComplete="off"
            className={`w-full bg-bg-input border rounded-xl px-3.5 py-2.5 text-[13px] font-mono text-text-primary
                            placeholder:text-text-tertiary/50 placeholder:font-sans placeholder:text-[13px]
                            shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]
                            focus:outline-none transition-all duration-150
                            ${
                              error
                                ? 'border-red-500/40 focus:border-red-500/60 focus:ring-1 focus:ring-red-500/20'
                                : 'border-border-subtle focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/15'
                            }`}
          />

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-red-500/8 border border-red-500/15 rounded-xl text-[12px] text-red-400">
              <AlertCircle size={13} className="shrink-0" />
              {error}
            </div>
          )}

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={isSaving || !isDirty}
            className={`w-full py-2.5 rounded-xl text-[13px] font-medium transition-all duration-150 select-none
                            ${
                              isSaving
                                ? 'bg-button-primary-disabled-bg border border-button-primary-disabled-border text-button-primary-disabled-text cursor-wait'
                                : justSaved
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 cursor-pointer'
                                  : !isDirty
                                    ? 'bg-button-primary-disabled-bg border border-button-primary-disabled-border text-button-primary-disabled-text cursor-default'
                                    : 'bg-button-primary-bg hover:bg-button-primary-hover text-white shadow-sm active:scale-[0.99] cursor-pointer'
                            }`}
          >
            {isSaving ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={13} className="animate-spin" />
                Saving…
              </span>
            ) : justSaved ? (
              <span className="flex items-center justify-center gap-2">
                <CheckCircle size={13} />
                Saved
              </span>
            ) : (
              'Save key'
            )}
          </button>

          {/* Hint */}
          <p className="text-[11px] text-text-secondary leading-relaxed text-center">
            Don't have a key?{' '}
            <span
              onClick={() => openExternal(PLAN_STANDARD_URL)}
              className="text-blue-400 hover:text-blue-300 cursor-pointer transition-colors duration-150"
            >
              Subscribe to get one
            </span>
          </p>

          {/* T&C consent */}
          <p className="text-[10.5px] text-text-tertiary leading-relaxed text-center">
            By saving your key, you agree to our{' '}
            <span
              onClick={() => openExternal('https://natively.software/nativelyapi/t&c')}
              className="text-text-secondary hover:text-text-primary underline decoration-border-subtle underline-offset-[3px] cursor-pointer transition-colors"
            >
              Terms &amp; Conditions
            </span>
            .
          </p>
        </div>
      </Card>

      {/* ── Usage card (connected state) ─────────────────── */}
      {isSaved && (
        <Card>
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/20 flex items-center justify-center shrink-0">
                {isLoadingUsage && !usageData ? (
                  <Loader2 size={15} className="animate-spin text-violet-400" />
                ) : (
                  <CalendarClock size={15} className="text-violet-400" strokeWidth={1.75} />
                )}
              </div>
              <div>
                <p className="text-[13px] font-semibold text-text-primary">Usage this month</p>
                {usageData && (
                  <p className="text-[11px] text-text-tertiary mt-0.5">
                    Resets {fmtDate(usageData.quota.resets_at)}
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={fetchUsage}
              disabled={isLoadingUsage}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-text-tertiary
                                hover:text-text-secondary hover:bg-bg-input transition-all duration-150
                                disabled:opacity-40 cursor-pointer"
            >
              <RefreshCw
                size={11}
                className={isLoadingUsage ? 'animate-spin' : ''}
                strokeWidth={2}
              />
              Refresh
            </button>
          </div>

          {usageError && !usageData && (
            <div className="mx-5 mb-5 flex items-center gap-2 px-3 py-2.5 bg-red-500/8 border border-red-500/15 rounded-xl text-[12px] text-red-400">
              <AlertCircle size={13} className="shrink-0" /> {usageError}
            </div>
          )}

          {usageData && (
            <>
              {/* Stat strip */}
              <div className="mx-5 mb-4 grid grid-cols-3 bg-bg-input border border-border-subtle rounded-2xl overflow-hidden divide-x divide-border-subtle">
                {[
                  {
                    label: 'STT mins',
                    value: usageData.quota.transcription.used,
                    color: 'text-blue-400',
                    glow: 'rgba(59,130,246,0.5)',
                  },
                  {
                    label: 'AI calls',
                    value: usageData.quota.ai.used,
                    color: 'text-violet-400',
                    glow: 'rgba(139,92,246,0.5)',
                  },
                  {
                    label: 'Searches',
                    value: usageData.quota.search.used,
                    color: 'text-emerald-400',
                    glow: 'rgba(16,185,129,0.5)',
                  },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex flex-col items-center py-4 px-3 gap-1">
                    <span
                      className={`text-[22px] font-semibold tabular-nums tracking-tight leading-none ${color}`}
                    >
                      {value.toLocaleString()}
                    </span>
                    <span className="text-[10px] text-text-tertiary font-medium tracking-wide">
                      {label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Progress bars */}
              <div className="px-5 pb-5 space-y-3.5">
                <QuotaBar
                  label="Transcription"
                  icon={Mic}
                  bucket={usageData.quota.transcription}
                  barColor="bg-blue-500"
                />
                <QuotaBar
                  label="AI requests"
                  icon={Brain}
                  bucket={usageData.quota.ai}
                  barColor="bg-violet-500"
                />
                <QuotaBar
                  label="Web searches"
                  icon={Search}
                  bucket={usageData.quota.search}
                  barColor="bg-emerald-500"
                />
              </div>
            </>
          )}
        </Card>
      )}

      {/* ── Plans ────────────────────────────────────────── */}
      {isSaved && PlansCard}

      {/* ── How it works ─────────────────────────────────── */}
      <Card>
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-3.5">
            <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-widest">
              How it works
            </p>
            <button
              onClick={() => openExternal('https://natively.software/pro')}
              className="flex items-center gap-1 text-[10px] font-semibold text-blue-400 hover:text-blue-300 uppercase tracking-widest transition-colors cursor-pointer"
            >
              Watch Demo <ArrowUpRight size={10} strokeWidth={2} />
            </button>
          </div>
          <div className="space-y-3">
            {[
              { step: '1', text: 'Subscribe above and complete checkout on Dodo Payments.' },
              { step: '2', text: 'Your API key is emailed instantly to your inbox.' },
              { step: '3', text: 'Paste it here — Natively handles the rest automatically.' },
            ].map(({ step, text }) => (
              <div key={step} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-bg-input border border-border-subtle flex items-center justify-center text-[10px] font-bold text-text-tertiary shrink-0 mt-[1px]">
                  {step}
                </div>
                <p className="text-[12px] text-text-secondary leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* ── Refund Policy ────────────────────────────────── */}
      <Card>
        <div className="flex items-center gap-3 px-5 pt-5 pb-4">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center shrink-0">
            <Shield size={18} className="text-emerald-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-text-primary">Refund Policy</p>
            <p className="text-[11px] text-text-tertiary leading-snug mt-0.5">
              24-hour refund window — voucher purchases are final sale
            </p>
          </div>
        </div>

        <div className="h-px bg-border-subtle mx-5" />

        <div className="px-5 pt-4 pb-4">
          <div className="space-y-3">
            <div className="rounded-xl bg-bg-input/50 border border-border-subtle px-3.5 py-3">
              <p className="text-[11.5px] text-text-secondary leading-relaxed">
                <strong className="text-text-primary font-semibold">A quick heads-up:</strong>{' '}
                Natively is built and maintained by a single developer and integrates a lot of
                third-party services — AI providers, transcription engines, search APIs, payments,
                OS-level audio &amp; screen capture. That gives the app a lot of capability, but the
                surface area is wider than a typical closed-source product, and once in a while
                something may not behave exactly as expected. If you run into something like that,
                please <em>report it</em> rather than disputing the charge — we read every report
                and fixes typically land in the next update.
              </p>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-text-tertiary/40 shrink-0 mt-[6px]" />
              <p className="text-[11.5px] text-text-secondary leading-relaxed">
                Purchases made with a coupon, voucher, referral credit, or limited-time offer are{' '}
                <strong className="text-text-primary font-semibold">final sale</strong> and not
                eligible for refund.
              </p>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-text-tertiary/40 shrink-0 mt-[6px]" />
              <p className="text-[11.5px] text-text-secondary leading-relaxed">
                To cancel your subscription, log in to the{' '}
                <span
                  onClick={() => openExternal('https://customer.dodopayments.com/')}
                  className="text-text-primary hover:text-text-secondary underline decoration-border-subtle underline-offset-[3px] cursor-pointer transition-colors"
                >
                  https://customer.dodopayments.com/
                </span>{' '}
                portal.
              </p>
            </div>

            <div className="h-px bg-border-subtle mt-4 mb-3" />

            <p className="text-[11.5px] text-text-secondary leading-relaxed">
              For everything else — the 24-hour refund window, subscription handling, taxes &amp;
              fees, and your local consumer rights — please see our full{' '}
              <span
                onClick={() => openExternal('https://natively.software/refundpolicy')}
                className="text-text-primary hover:text-text-secondary underline decoration-border-subtle underline-offset-[3px] cursor-pointer transition-colors"
              >
                Refund Policy
              </span>
              . To request a refund or ask a question, email{' '}
              <span
                onClick={() => openExternal('mailto:natively.contact@gmail.com')}
                className="text-text-primary hover:text-text-secondary underline decoration-border-subtle underline-offset-[3px] cursor-pointer transition-colors"
              >
                natively.contact@gmail.com
              </span>
              .
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
};
