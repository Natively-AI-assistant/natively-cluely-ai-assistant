import type { DynamicActionPayload } from '@/types/electron';
import { AnimatePresence } from 'framer-motion';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DynamicActionCard } from './DynamicActionCard';

interface Props {
  // Called when the user accepts (or hits Tab on the primary). Parent should
  // kick off the live answer stream using action.promptInstruction.
  onAcceptAction: (action: DynamicActionPayload) => void;
  // Optional: max actions to keep visible. Cluely-style cap at 3.
  maxVisible?: number;
  // Optional: how long actions stay visible without user interaction (ms).
  // Server side already expires; this is the renderer-side cap.
  staleAfterMs?: number;
}

// DynamicActionBar — Cluely-style live action card row.
// Subscribes to intelligence-dynamic-action events from the main process,
// dedupes by id, expires stale cards, and renders up to maxVisible cards.
// Tab keypress accepts the primary (highest-priority) card.
export const DynamicActionBar: React.FC<Props> = ({
  onAcceptAction,
  maxVisible = 3,
  staleAfterMs = 60_000,
}) => {
  const [actions, setActions] = useState<DynamicActionPayload[]>([]);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const handleIncoming = useCallback(
    (action: DynamicActionPayload) => {
      setActions((prev) => {
        // Dedupe by id (engine has already deduped at backend, but renderer
        // may receive late-arriving duplicates after a window restore).
        if (prev.some((a) => a.id === action.id)) return prev;
        // Sort by priority desc, then createdAt desc (newer first when tied).
        const next = [...prev, action]
          .filter((a) => Date.now() - a.createdAt < staleAfterMs)
          .sort((a, b) => b.priority - a.priority || b.createdAt - a.createdAt);
        return next.slice(0, maxVisible * 2); // keep a small buffer past the visible cap
      });
    },
    [staleAfterMs, maxVisible],
  );

  const dismiss = useCallback((id: string) => {
    setActions((prev) => prev.filter((a) => a.id !== id));
    window.electronAPI?.dismissDynamicAction?.(id).catch(() => {
      /* swallow */
    });
  }, []);

  const accept = useCallback(
    async (action: DynamicActionPayload) => {
      // Optimistically remove from the bar so the user gets immediate feedback.
      setActions((prev) => prev.filter((a) => a.id !== action.id));
      try {
        await window.electronAPI?.acceptDynamicAction?.(action.id);
      } catch {
        /* swallow — the parent answer flow is the source of truth */
      }
      onAcceptAction(action);
    },
    [onAcceptAction],
  );

  // Subscribe to push from main process
  useEffect(() => {
    const off = window.electronAPI?.onIntelligenceDynamicAction?.((data) => {
      if (data?.action) handleIncoming(data.action);
    });
    return () => {
      try {
        off?.();
      } catch {
        /* ignore */
      }
    };
  }, [handleIncoming]);

  // Keyboard: Tab accepts primary
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const visible = actionsRef.current.slice(0, maxVisible);
      if (visible.length === 0) return;
      // Don't hijack Tab if focus is in an editable element — the user is typing.
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || target.isContentEditable) return;
      }
      e.preventDefault();
      void accept(visible[0]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [accept, maxVisible]);

  // Periodic stale prune (cheap) — only run when actions exist
  useEffect(() => {
    if (actions.length === 0) return;
    const t = setInterval(() => {
      setActions((prev) => {
        if (prev.length === 0) return prev;
        return prev.filter((a) => Date.now() - a.createdAt < staleAfterMs);
      });
    }, 5_000);
    return () => clearInterval(t);
  }, [staleAfterMs, actions.length]);

  const visible = useMemo(() => actions.slice(0, maxVisible), [actions, maxVisible]);

  if (visible.length === 0) return null;

  return (
    <div
      className="flex flex-col gap-1.5 px-3 pt-1 pb-1 w-full"
      data-testid="dynamic-action-bar"
      aria-label="Suggested actions"
    >
      <AnimatePresence initial={false}>
        {visible.map((a, i) => (
          <DynamicActionCard
            key={a.id}
            action={a}
            isPrimary={i === 0}
            onAccept={accept}
            onDismiss={dismiss}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};
