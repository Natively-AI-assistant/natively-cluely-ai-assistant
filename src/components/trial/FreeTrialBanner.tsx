// src/components/trial/FreeTrialBanner.tsx
// Persistent countdown banner shown during an active free trial.
// Stays visible across the whole session; not dismissible while trial is running.

import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpRight, Clock, Mic, Search, Zap } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import {
  formatCompact, TRIAL_FALLBACK_LIMITS,
  type TrialLimits, type TrialUsage,
} from '../../types/nativelyUsage';

const PLAN_PRO_URL = 'https://checkout.dodopayments.com/buy/pdt_0NcM6Aw0IWdspbsgUeCLA';

interface TrialBannerProps {
  expiresAt: string; // ISO timestamp
  usage: TrialUsage;
  /** The trial's allowances from /v1/trial/status. Falls back when absent. */
  limits?: TrialLimits;
  onUpgrade: () => void; // opens FreeTrialModal
}

function fmt(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const FreeTrialBanner: React.FC<TrialBannerProps> = ({ expiresAt, usage, limits, onUpgrade }) => {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, new Date(expiresAt).getTime() - Date.now()),
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const tick = () => {
      const left = Math.max(0, new Date(expiresAt).getTime() - Date.now());
      setRemaining(left);
      if (left === 0 && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    intervalRef.current = setInterval(tick, 1000);
    tick();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [expiresAt]);

  const isWarning = remaining > 0 && remaining < 2 * 60 * 1000;
  const expired = remaining === 0;

  // Allowances come from the server (see TRIAL_FALLBACK_LIMITS for why the
  // fallback is shared rather than a literal here). AI is token-denominated
  // now: `usage.ai` counted requests and stopped being written when chat moved
  // to a token meter, so a pip reading it would sit at 0 for the whole trial.
  const aiLimit = limits?.ai_tokens ?? TRIAL_FALLBACK_LIMITS.ai_tokens;
  const sttLimit = limits?.stt_minutes ?? TRIAL_FALLBACK_LIMITS.stt_minutes;
  const searchLimit = limits?.search_requests ?? TRIAL_FALLBACK_LIMITS.search_requests;
  const aiUsed = usage.ai_tokens ?? 0;
  const sttUsedMin = usage.stt_seconds / 60;

  const pct = (used: number, limit: number) => (limit > 0 ? Math.min(100, (used / limit) * 100) : 0);
  const aiPct = pct(aiUsed, aiLimit);
  const sttPct = pct(sttUsedMin, sttLimit);
  const searchPct = pct(usage.search, searchLimit);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.25 }}
        className={`
                    mx-3 mb-2 rounded-xl border px-3 py-2
                    ${
                      isWarning || expired
                        ? 'bg-amber-500/10 border-amber-500/30'
                        : 'bg-bg-item-surface border-border-subtle'
                    }
                `}
      >
        <div className="flex items-center justify-between gap-3">
          {/* Timer */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Clock
              size={12}
              strokeWidth={2}
              className={isWarning || expired ? 'text-amber-400' : 'text-text-tertiary'}
            />
            <span
              className={`text-[12px] font-mono font-semibold tabular-nums ${
                isWarning || expired ? 'text-amber-400' : 'text-text-secondary'
              }`}
            >
              {expired ? 'Trial ended' : fmt(remaining)}
            </span>
            <span className="text-[10px] text-text-tertiary/70 font-medium">free trial</span>
          </div>

          {/* Usage mini-bars */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <UsagePip icon={Zap} pct={aiPct} label={`${formatCompact(aiUsed)}/${formatCompact(aiLimit)} AI`} />
            <UsagePip
              icon={Mic}
              pct={sttPct}
              label={`${sttUsedMin.toFixed(1)}/${sttLimit}m voice`}
            />
            <UsagePip icon={Search} pct={searchPct} label={`${usage.search}/${searchLimit} research`} />
          </div>

          {/* Upgrade CTA */}
          <button
            onClick={onUpgrade}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-violet-500/15 text-violet-400 hover:bg-violet-500/25 border border-violet-500/30 transition-colors shrink-0"
          >
            Upgrade
            <ArrowUpRight size={10} strokeWidth={2.5} />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

function UsagePip({
  icon: Icon,
  pct,
  label,
}: {
  icon: React.ElementType;
  pct: number;
  label: string;
}) {
  const isHigh = pct >= 80;
  return (
    <div className="flex items-center gap-1.5 min-w-0" title={label}>
      <Icon
        size={10}
        strokeWidth={2}
        className={isHigh ? 'text-amber-400 shrink-0' : 'text-text-tertiary/60 shrink-0'}
      />
      <div className="h-[3px] w-12 bg-bg-input rounded-full overflow-hidden shrink-0">
        <div
          className={`h-full rounded-full transition-all duration-700 ${
            isHigh ? 'bg-amber-400' : 'bg-violet-500/60'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
