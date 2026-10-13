import type { LiveRequirementPayload } from '@/types/electron';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, ChevronUp, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

interface Props {
  maxVisible?: number;
}

export const RequirementsPanel: React.FC<Props> = ({ maxVisible = 8 }) => {
  const [requirements, setRequirements] = useState<LiveRequirementPayload[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  const syncList = useCallback((items: LiveRequirementPayload[]) => {
    setRequirements(items.filter((r) => r.status === 'candidate' || r.status === 'accepted'));
  }, []);

  useEffect(() => {
    window.electronAPI?.listRequirements?.()
      .then((res) => {
        if (res?.success && Array.isArray(res.requirements)) {
          syncList(res.requirements);
        }
      })
      .catch(() => { /* swallow */ });

    const off = window.electronAPI?.onRequirementsUpdated?.((data) => {
      if (Array.isArray(data?.requirements)) {
        syncList(data.requirements);
      }
    });
    return () => {
      try {
        off?.();
      } catch {
        /* ignore */
      }
    };
  }, [syncList]);

  const accept = useCallback((id: string) => {
    setRequirements((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status: 'accepted' as const } : r)),
    );
    window.electronAPI?.acceptRequirement?.(id).catch(() => { /* swallow */ });
  }, []);

  const dismiss = useCallback((id: string) => {
    setRequirements((prev) => prev.filter((r) => r.id !== id));
    window.electronAPI?.dismissRequirement?.(id).catch(() => { /* swallow */ });
  }, []);

  const visible = useMemo(() => requirements.slice(0, maxVisible), [requirements, maxVisible]);
  const candidateCount = requirements.filter((r) => r.status === 'candidate').length;

  if (requirements.length === 0) return null;

  return (
    <div
      className="px-3 pt-1 pb-1 w-full"
      data-testid="requirements-panel"
      aria-label="Interview requirements"
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/80 hover:text-muted-foreground mb-1 w-full text-left"
        aria-expanded={!collapsed}
      >
        {collapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
        Requirements ({requirements.length})
        {candidateCount > 0 ? (
          <span className="text-[10px] opacity-70">· {candidateCount} suggested</span>
        ) : null}
      </button>

      {!collapsed ? (
        <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
          <AnimatePresence initial={false}>
            {visible.map((req) => (
              <motion.div
                key={req.id}
                layout
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className={`group flex items-start gap-2 rounded-md px-2 py-1.5 text-xs border ${
                  req.status === 'accepted'
                    ? 'border-emerald-500/30 bg-emerald-500/5'
                    : 'border-border/40 bg-black/[0.02] dark:bg-white/[0.03]'
                }`}
                data-testid={`requirement-row-${req.id}`}
                title={req.evidence?.quote ? `Source: "${req.evidence.quote}"` : undefined}
              >
                {req.status === 'accepted' ? (
                  <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                ) : (
                  <button
                    type="button"
                    onClick={() => accept(req.id)}
                    className="mt-0.5 shrink-0 rounded border border-border/60 p-0.5 hover:bg-emerald-500/10 hover:border-emerald-500/40 transition-colors"
                    aria-label={`Accept requirement: ${req.text}`}
                    data-testid={`requirement-accept-${req.id}`}
                  >
                    <Check className="w-3 h-3 opacity-50 group-hover:opacity-100" />
                  </button>
                )}
                <span className="flex-1 leading-snug">
                  {req.text}
                  {req.status === 'candidate' ? (
                    <span className="ml-1.5 text-[10px] opacity-50">Suggested</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => dismiss(req.id)}
                  className="shrink-0 p-0.5 rounded opacity-40 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition-opacity"
                  aria-label={`Dismiss requirement: ${req.text}`}
                  data-testid={`requirement-dismiss-${req.id}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      ) : null}
    </div>
  );
};
