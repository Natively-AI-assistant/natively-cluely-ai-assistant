import type { DynamicActionPayload } from '@/types/electron';
import { AnimatePresence, useReducedMotion } from 'framer-motion';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CARD_ENTER_MS, DynamicActionCard, cardExitMs, type CardExitReason, type CardExits } from './DynamicActionCard';

interface Props {
  // Called when the user accepts (or hits Tab on the primary). Parent should
  // kick off the live answer stream using action.promptInstruction.
  onAcceptAction: (action: DynamicActionPayload) => void;
  // Optional: max actions to keep visible. Cluely-style cap at 3.
  maxVisible?: number;
  // Optional: how long actions stay visible without user interaction (ms).
  // Server side already expires; this is the renderer-side cap.
  staleAfterMs?: number;
  // The overlay's opacity-scaled chip fill (appearance.chipStyle), so a card
  // reads as the quick actions do at every overlay opacity.
  surfaceStyle?: React.CSSProperties;
  // Asks the overlay to own the window height while a card's slot tweens open
  // (growPx > 0) or closed: one window resize up front, none per frame. Returns
  // the settle to call when the tween is DONE, or null when the overlay can't
  // hold the channel (an answer is streaming, another transition holds it); an
  // exit then collapses its slot in one step.
  requestHeightMotion?: (growPx: number, durationMs: number) => (() => void) | null;
}

/** A card's slot: the 36px row plus its 3px above and below. */
const CARD_SLOT_PX = 42;
/** How long a Tab-accepted card shows its pressed keycap before it leaves (--duration-micro + a frame). */
const TAB_PRESS_MS = 110;

// DynamicActionBar — Cluely-style live action card row.
// Subscribes to intelligence-dynamic-action events from the main process,
// dedupes by id, expires stale cards, and renders up to maxVisible cards.
// Tab keypress accepts the primary (highest-priority) card.
//
// The bar stays mounted when it is empty: returning null used to unmount the
// AnimatePresence with the last card still inside it, so the last card could
// never play its exit and everything below snapped up in one frame.
export const DynamicActionBar: React.FC<Props> = ({
  onAcceptAction,
  maxVisible = 3,
  staleAfterMs = 60_000,
  surfaceStyle,
  requestHeightMotion,
}) => {
  const [actions, setActions] = useState<DynamicActionPayload[]>([]);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const reduceMotion = useReducedMotion() ?? false;
  const reduceRef = useRef(reduceMotion);
  reduceRef.current = reduceMotion;
  const requestRef = useRef(requestHeightMotion);
  requestRef.current = requestHeightMotion;
  // Why each card left. Written BEFORE the removal: a removed card never sees
  // new props, so its exit reads this through AnimatePresence's `custom`.
  const exitsRef = useRef<CardExits>({});
  const [pressingId, setPressingId] = useState<string | null>(null);
  const pressingRef = useRef<string | null>(null);

  const markExit = useCallback((ids: string[], reason: CardExitReason) => {
    const shown = new Set(actionsRef.current.slice(0, maxVisible).map((a) => a.id));
    const leaving = ids.filter((id) => shown.has(id));
    if (leaving.length === 0) return;
    // Accept starts an answer in the same moment, and the overlay must keep
    // reporting that growth; so an accepted card never holds the height channel.
    const settle = reason !== 'accept' && !reduceRef.current
      ? (requestRef.current?.(0, cardExitMs(reason)) ?? null)
      : null;
    for (const id of leaving) exitsRef.current[id] = { reason, tween: settle !== null, settle: settle ?? undefined };
  }, [maxVisible]);

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
    markExit([id], 'dismiss');
    setActions((prev) => prev.filter((a) => a.id !== id));
    window.electronAPI?.dismissDynamicAction?.(id).catch(() => {
      /* swallow */
    });
  }, [markExit]);

  const accept = useCallback(
    (action: DynamicActionPayload, holdMs = 0) => {
      const remove = () => {
        markExit([action.id], 'accept');
        setActions((prev) => prev.filter((a) => a.id !== action.id));
      };
      // A click is its own press; Tab shows the keycap going down first. The
      // answer starts NOW either way — only the card's departure waits.
      if (holdMs > 0) {
        window.setTimeout(() => {
          remove();
          pressingRef.current = null;
          setPressingId(null);
        }, holdMs);
      } else {
        remove();
      }
      void (async () => {
        try {
          await window.electronAPI?.acceptDynamicAction?.(action.id);
        } catch {
          /* swallow — the parent answer flow is the source of truth */
        }
        onAcceptAction(action);
      })();
    },
    [markExit, onAcceptAction],
  );

  // Subscribe to push from main process
  useEffect(() => {
    const off = window.electronAPI?.onIntelligenceDynamicAction?.((data) => {
      if (data?.action) handleIncoming(data.action);
    });
    // Auto Answer V3 offer card: main retracts by id when the offer expired,
    // was replaced by a newer question, or was committed via the hotkey.
    const offRetract = window.electronAPI?.onIntelligenceDynamicActionRetract?.((data) => {
      if (!data?.id) return;
      markExit([data.id], 'expire');
      setActions((prev) => prev.filter((a) => a.id !== data.id));
    });
    return () => {
      try {
        off?.();
        offRetract?.();
      } catch {
        /* ignore */
      }
    };
  }, [handleIncoming, markExit]);

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
      // A second Tab during the press would accept the same, still-visible
      // card again: one Tab, one answer.
      if (pressingRef.current) return;
      pressingRef.current = visible[0].id;
      setPressingId(visible[0].id);
      accept(visible[0], reduceRef.current ? 0 : TAB_PRESS_MS);
      if (reduceRef.current) pressingRef.current = null;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [accept, maxVisible]);

  // Periodic stale prune (cheap) — only run when actions exist
  useEffect(() => {
    if (actions.length === 0) return;
    const t = setInterval(() => {
      const now = Date.now();
      const stale = actionsRef.current
        .filter((a) => !(now - a.createdAt < staleAfterMs && (a.expiresAt === undefined || now < a.expiresAt)))
        .map((a) => a.id);
      if (stale.length === 0) return;
      markExit(stale, 'expire');
      const gone = new Set(stale);
      setActions((prev) => prev.filter((a) => !gone.has(a.id)));
    }, 5_000);
    return () => clearInterval(t);
  }, [staleAfterMs, actions.length, markExit]);

  const visible = useMemo(() => actions.slice(0, maxVisible), [actions, maxVisible]);

  // A card whose slot is about to open: the window must LEAD that growth.
  // Runs after the new card is in the DOM at height 0, before it paints.
  const shownIdsRef = useRef<string[]>([]);
  const enterSettleRef = useRef<Record<string, () => void>>({});
  useLayoutEffect(() => {
    const before = new Set(shownIdsRef.current);
    const added = visible.filter((a) => !before.has(a.id));
    shownIdsRef.current = visible.map((a) => a.id);
    if (added.length === 0 || reduceRef.current) return;
    const settle = requestRef.current?.(added.length * CARD_SLOT_PX, CARD_ENTER_MS);
    if (settle) for (const a of added) enterSettleRef.current[a.id] = settle;
  }, [visible]);
  const entered = useCallback((id: string) => {
    const settle = enterSettleRef.current[id];
    delete enterSettleRef.current[id];
    settle?.();
  }, []);

  return (
    <div
      className="flex flex-col px-3 w-full"
      data-testid="dynamic-action-bar"
      aria-label="Suggested actions"
    >
      <AnimatePresence
        initial={false}
        custom={exitsRef.current}
        onExitComplete={() => {
          // Every exiting card is done: settle the window height their tween held.
          const live = new Set(actionsRef.current.map((a) => a.id));
          for (const id of Object.keys(exitsRef.current)) {
            if (live.has(id)) continue;
            exitsRef.current[id].settle?.();
            enterSettleRef.current[id]?.();   // left before it finished opening
            delete exitsRef.current[id];
            delete enterSettleRef.current[id];
          }
        }}
      >
        {visible.map((a, i) => (
          <DynamicActionCard
            key={a.id}
            action={a}
            isPrimary={i === 0}
            pressing={pressingId === a.id}
            onAccept={(action) => accept(action)}
            onDismiss={dismiss}
            surfaceStyle={surfaceStyle}
            onEntered={() => entered(a.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};
