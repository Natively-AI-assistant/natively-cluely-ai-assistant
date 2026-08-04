import {
  AlertCircle,
  Brain,
  CalendarClock,
  CheckCircle,
  Loader2,
  Mic,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { NativelyLogoMark } from '../NativelyLogoMark';
import { getMeetingInterfaceTheme, type MeetingInterfaceTheme } from '../../lib/meetingInterfaceTheme';

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

const MASKED_NATIVELY_KEY = '•'.repeat(24);

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
interface NativelyApiSettingsProps {
  initialIsSaved?: boolean;
}

export const NativelyApiSettings: React.FC<NativelyApiSettingsProps> = ({ initialIsSaved = false }) => {
  const t = useT();
  const [apiKey, setApiKey] = useState(() => (initialIsSaved ? MASKED_NATIVELY_KEY : ''));
  const [isSaved, setIsSaved] = useState(initialIsSaved);
  const [isLoading, setIsLoading] = useState(!initialIsSaved);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [isLoadingUsage, setIsLoadingUsage] = useState(false);

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
          setUsageData(null);
          setUsageError(null);
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

  const handleSave = async () => {
    if (!apiKey.trim() || apiKey.includes('•')) return;
    setIsSaving(true);
    setError(null);
    try {
      const r = await window.electronAPI.setNativelyApiKey(apiKey.trim());
      if (r?.success) {
        setApiKey(MASKED_NATIVELY_KEY);
        setIsSaved(true);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2000);
      } else {
        setError(r?.error || 'Failed to save key.');
      }
    } catch {
      setError('Failed to save key.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    if (!confirm('Remove your Natively API key from this device?')) return;
    try {
      await window.electronAPI.setNativelyApiKey('');
      setApiKey('');
      setIsSaved(false);
      setUsageData(null);
      setUsageError(null);
      setError(null);
    } catch {
      setError('Failed to remove key.');
    }
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

  return (
    <div className="space-y-6 animated fadeIn" data-interface-theme={interfaceTheme}>
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-text-primary mb-1">{t('Natively API')}</h3>
          <p className="text-xs text-text-secondary mb-5">
            Paste your provider API key for managed transcription, AI &amp; search
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
      </header>

      <Card>
        <div className="flex items-center gap-3 px-5 pt-5 pb-4">
          <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center shrink-0">
            <NativelyLogoMark size={18} className="text-blue-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-text-primary">API Key</p>
            <p className="text-[11px] text-text-tertiary leading-snug mt-0.5">
              Your Natively API key (bring your own)
            </p>
          </div>
        </div>

        <div className="h-px bg-border-subtle mx-5" />

        <div className="px-5 pt-4 pb-5 space-y-3">
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

          {error && (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-red-500/8 border border-red-500/15 rounded-xl text-[12px] text-red-400">
              <AlertCircle size={13} className="shrink-0" />
              {error}
            </div>
          )}

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
        </div>
      </Card>

      {isSaved && (
        <Card>
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
              <div className="mx-5 mb-4 grid grid-cols-3 bg-bg-input border border-border-subtle rounded-2xl overflow-hidden divide-x divide-border-subtle">
                {[
                  {
                    label: 'STT mins',
                    value: usageData.quota.transcription.used,
                    color: 'text-blue-400',
                  },
                  {
                    label: 'AI calls',
                    value: usageData.quota.ai.used,
                    color: 'text-violet-400',
                  },
                  {
                    label: 'Searches',
                    value: usageData.quota.search.used,
                    color: 'text-emerald-400',
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
    </div>
  );
};
