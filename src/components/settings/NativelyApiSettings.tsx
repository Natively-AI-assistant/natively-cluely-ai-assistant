import React, { useCallback, useEffect, useState } from 'react';
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
import { useT } from '../../i18n';
import { getMeetingInterfaceTheme, type MeetingInterfaceTheme } from '../../lib/meetingInterfaceTheme';
import { NativelyLogoMark } from '../NativelyLogoMark';

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

const MASKED_KEY = '•'.repeat(24);

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border-subtle bg-bg-item-surface">
      {children}
    </div>
  );
}

function QuotaBar({
  label,
  icon: Icon,
  bucket,
}: {
  label: string;
  icon: React.ElementType;
  bucket: QuotaBucket;
}) {
  const usedPercent = bucket.limit > 0 ? Math.min(100, (bucket.used / bucket.limit) * 100) : 0;
  const low = usedPercent >= 80;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={12} className="text-text-tertiary" strokeWidth={1.75} />
          <span className="text-[12px] text-text-secondary">{label}</span>
        </div>
        <span className={`text-[12px] tabular-nums ${low ? 'font-medium text-amber-500' : 'text-text-tertiary'}`}>
          {Math.max(0, Math.round(100 - usedPercent))}% left
        </span>
      </div>
      <div className="h-[3px] overflow-hidden rounded-full bg-bg-input">
        <div
          className={`h-full rounded-full transition-[width] duration-700 ${low ? 'bg-amber-500' : 'bg-accent-primary'}`}
          style={{ width: `${usedPercent}%` }}
        />
      </div>
    </div>
  );
}

export function NativelyApiSettings({ initialIsSaved = false }: { initialIsSaved?: boolean }) {
  const t = useT();
  const [apiKey, setApiKey] = useState(initialIsSaved ? MASKED_KEY : '');
  const [isSaved, setIsSaved] = useState(initialIsSaved);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingUsage, setIsLoadingUsage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [interfaceTheme, setInterfaceTheme] = useState<MeetingInterfaceTheme>(() => {
    const theme = getMeetingInterfaceTheme();
    return theme === 'default' ? 'liquid-glass' : theme;
  });

  useEffect(() => {
    const onStorage = () => {
      const theme = getMeetingInterfaceTheme();
      setInterfaceTheme(theme === 'default' ? 'liquid-glass' : theme);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    window.electronAPI.getStoredCredentials()
      .then((credentials) => {
        const saved = Boolean(credentials.hasNativelyKey);
        setIsSaved(saved);
        setApiKey(saved ? MASKED_KEY : '');
      })
      .catch(() => {
        setIsSaved(false);
        setApiKey('');
      })
      .finally(() => setIsLoading(false));
  }, []);

  const fetchUsage = useCallback(async (force = false) => {
    setIsLoadingUsage(true);
    try {
      const result = await window.electronAPI.getNativelyUsage(force);
      setUsageData(result?.ok && result.quota ? result as UsageData : null);
    } catch {
      setUsageData(null);
    } finally {
      setIsLoadingUsage(false);
    }
  }, []);

  useEffect(() => {
    if (isSaved && !isLoading) void fetchUsage();
  }, [fetchUsage, isLoading, isSaved]);

  const handleSave = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed || apiKey.includes('•')) return;
    if (!trimmed.startsWith('natively_sk_')) {
      setError('Enter a Natively API key beginning with natively_sk_.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const result = await window.electronAPI.setNativelyApiKey(trimmed);
      if (!result?.success) throw new Error(result?.error || 'Failed to save key.');
      setApiKey(MASKED_KEY);
      setIsSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save key.');
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
      setError(null);
    } catch {
      setError('Failed to remove key.');
    }
  };

  const dirty = apiKey.length > 0 && !apiKey.includes('•') && !isSaved;
  const resetDate = usageData?.quota.resets_at
    ? new Date(usageData.quota.resets_at).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  return (
    <div className="space-y-6 animated fadeIn" data-interface-theme={interfaceTheme}>
      <header>
        <h3 className="mb-1 text-lg font-bold text-text-primary">{t('Natively API')}</h3>
        <p className="text-xs text-text-secondary">
          Add an existing API key for managed transcription, AI, and search.
        </p>
      </header>

      <Card>
        <div className="flex items-center gap-3 px-5 pb-4 pt-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-500/20 bg-blue-500/15">
            <NativelyLogoMark size={18} className="text-blue-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-text-primary">API key</p>
            <p className="mt-0.5 text-[11px] text-text-tertiary">Stored securely on this device</p>
          </div>
        </div>
        <div className="mx-5 h-px bg-border-subtle" />
        <div className="space-y-3 px-5 pb-5 pt-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
              Secret key
            </span>
            {isSaved && (
              <button onClick={handleClear} className="flex items-center gap-1 text-[11px] text-red-400/80 hover:text-red-400">
                <Trash2 size={11} />
                Remove
              </button>
            )}
          </div>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value);
              setIsSaved(false);
              setError(null);
            }}
            onKeyDown={(event) => event.key === 'Enter' && void handleSave()}
            placeholder="natively_sk_..."
            spellCheck={false}
            autoComplete="off"
            disabled={isLoading}
            className="w-full rounded-xl border border-border-subtle bg-bg-input px-3.5 py-2.5 font-mono text-[13px] text-text-primary focus:border-blue-500/50 focus:outline-none"
          />
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-500/15 bg-red-500/10 px-3 py-2.5 text-[12px] text-red-400">
              <AlertCircle size={13} />
              {error}
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={isSaving || !dirty}
            className="w-full rounded-xl bg-button-primary-bg py-2.5 text-[13px] font-medium text-white disabled:cursor-default disabled:bg-button-primary-disabled-bg disabled:text-button-primary-disabled-text"
          >
            {isSaving ? (
              <span className="flex items-center justify-center gap-2"><Loader2 size={13} className="animate-spin" />Saving…</span>
            ) : isSaved ? (
              <span className="flex items-center justify-center gap-2"><CheckCircle size={13} />Saved</span>
            ) : 'Save key'}
          </button>
        </div>
      </Card>

      {isSaved && (
        <Card>
          <div className="flex items-center justify-between px-5 pb-4 pt-5">
            <div className="flex items-center gap-3">
              <CalendarClock size={16} className="text-violet-400" />
              <div>
                <p className="text-[13px] font-semibold text-text-primary">Usage this month</p>
                {resetDate && <p className="mt-0.5 text-[11px] text-text-tertiary">Resets {resetDate}</p>}
              </div>
            </div>
            <button
              onClick={() => void fetchUsage(true)}
              disabled={isLoadingUsage}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-text-tertiary hover:bg-bg-input hover:text-text-secondary disabled:opacity-40"
            >
              <RefreshCw size={11} className={isLoadingUsage ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
          {usageData && (
            <div className="space-y-3.5 px-5 pb-5">
              <QuotaBar label="Transcription" icon={Mic} bucket={usageData.quota.transcription} />
              <QuotaBar label="AI requests" icon={Brain} bucket={usageData.quota.ai} />
              <QuotaBar label="Web searches" icon={Search} bucket={usageData.quota.search} />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
