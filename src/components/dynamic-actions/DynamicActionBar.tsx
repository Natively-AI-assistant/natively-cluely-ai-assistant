import type { DynamicActionPayload } from '@/types/electron';
import { AnimatePresence, useReducedMotion } from 'framer-motion';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  CARD_ENTER_MS,
  DynamicActionCard,
  SuggestionSlot,
  cardExitMs,
  type CardExitReason,
  type CardExits,
} from './DynamicActionCard';

interface Props {
  // Called when the user accepts (the accept shortcut, or a click). Parent
  // should kick off the live answer stream using action.promptInstruction.
  onAcceptAction: (action: DynamicActionPayload) => void;
  // Optional: how long actions stay visible without user interaction (ms).
  // Server side already expires; this is the renderer-side cap.
  staleAfterMs?: number;
  // The overlay's opacity-scaled chip fill (appearance.chipStyle), so the card
  // reads as the quick actions do at every overlay opacity.
  surfaceStyle?: React.CSSProperties;
  // The accept shortcut's keys as the card shows them (["⌘", "8"]). Empty when
  // it would not fire: unbound, global shortcuts off, or taken by another app.
  shortcutKeys?: string[];
  // Whether the accept shortcut may act now. False while the overlay is hidden
  // (Cmd+B): a global chord must never answer a card the user cannot see.
  shortcutEnabled?: boolean;
  // Asks the overlay to own the window height while the slot tweens open
  // (growPx > 0) or closed: one window resize up front, none per frame. Returns
  // the settle to call when the tween is DONE, or null when the overlay can't
  // hold the channel (an answer is streaming, another transition holds it); an
  // emptied slot then folds in one step.
  requestHeightMotion?: (growPx: number, durationMs: number) => (() => void) | null;
}

/** The slot: the 36px row plus its 3px above and below. */
const CARD_SLOT_PX = 42;
/** How long an accepted card shows its pressed keycap before it leaves (--duration-micro + a frame). */
const PRESS_MS = 110;
/** Suggestions kept waiting behind the one on show. */
const QUEUE_MAX = 4;

// DynamicActionBar — the overlay's live suggestion.
// Subscribes to intelligence-dynamic-action events from the main process,
// dedupes by id, expires stale ones, and shows ONE at a time: the
// highest-priority suggestion, with a quiet "+N" for the ones waiting behind
// it. Accepting, dismissing or expiring it brings the next one up in place.
//
// Accepted with the global "Use Suggestion" shortcut (default Cmd/Ctrl+8, set
// in Settings > Keybinds), never Tab. The overlay is a no-activate panel that
// never takes keyboard focus during a meeting, so an in-page key listener
// never heard Tab while Zoom or Meet had focus — and when it did, it took Tab
// away from the page.
//
// The bar stays mounted when it is empty, so the last card can still animate
// out (returning null unmounted the AnimatePresence with it inside).
export const DynamicActionBar: React.FC<Props> = ({
  onAcceptAction,
  staleAfterMs = 60_000,
  surfaceStyle,
  shortcutKeys = [],
  shortcutEnabled = true,
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
  const shortcutEnabledRef = useRef(shortcutEnabled);
  shortcutEnabledRef.current = shortcutEnabled;
  // Why each card left. Written BEFORE the removal: a removed card never sees
  // new props, so its exit reads this through AnimatePresence's `custom`.
  const exitsRef = useRef<CardExits>({});
  const [pressingId, setPressingId] = useState<string | null>(null);
  const pressingRef = useRef<string | null>(null);

  // Record how these cards leave. Only the one on show animates; one waiting
  // in the queue just drops the count. When the one on show is the LAST, the
  // slot folds, and the overlay is asked to hold the window height for it.
  const markExit = useCallback((ids: string[], reason: CardExitReason) => {
    const current = actionsRef.current;
    const shown = current[0]?.id;
    if (!shown || !ids.includes(shown)) return;
    const empties = current.every((a) => ids.includes(a.id));
    // Accept starts an answer in the same moment, and the overlay must keep
    // reporting that growth, so an accept never holds the height channel.
    const settle = empties && reason !== 'accept' && !reduceRef.current
      ? (requestRef.current?.(0, cardExitMs(reason)) ?? null)
      : null;
    exitsRef.current[shown] = { reason, tween: settle !== null, settle: settle ?? undefined };
  }, []);

  const handleIncoming = useCallback(
    (action: DynamicActionPayload) => {
      setActions((prev) => {
        // Dedupe by id (engine has already deduped at backend, but renderer
        // may receive late-arriving duplicates after a window restore).
        if (prev.some((a) => a.id === action.id)) return prev;
        const now = Date.now();
        const fresh = prev.filter((a) => now - a.createdAt < staleAfterMs);
        // The one on show stays put: a new, higher-priority suggestion must
        // not yank it away mid-read. The waiting ones sort by priority desc,
        // then createdAt desc (newer first when tied).
        const [shown, ...waiting] = fresh;
        const queue = [...waiting, action].sort((a, b) => b.priority - a.priority || b.createdAt - a.createdAt);
        return (shown ? [shown, ...queue] : queue).slice(0, QUEUE_MAX + 1);
      });
    },
    [staleAfterMs],
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
      // A click is its own press; the shortcut shows the keycap going down
      // first. The answer starts NOW either way — only the departure waits.
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

  // The global "Use Suggestion" shortcut (KeybindManager chat:acceptSuggestion,
  // relayed by main as a global-shortcut action). It works whichever app has
  // focus, like What to Answer.
  useEffect(() => {
    const off = window.electronAPI?.onGlobalShortcut?.(({ action }) => {
      if (action !== 'acceptSuggestion' || !shortcutEnabledRef.current) return;
      const shown = actionsRef.current[0];
      // One press, one answer: a second press during the press beat would
      // accept the same, still-visible card again.
      if (!shown || pressingRef.current) return;
      if (reduceRef.current) {
        accept(shown);
        return;
      }
      pressingRef.current = shown.id;
      setPressingId(shown.id);
      accept(shown, PRESS_MS);
    });
    return () => {
      try {
        off?.();
      } catch {
        /* ignore */
      }
    };
  }, [accept]);

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

  const shown = actions[0] ?? null;
  const waiting = Math.max(0, actions.length - 1);

  // The slot is about to open: the window must LEAD that growth. Runs after
  // the slot is in the DOM at height 0, before it paints. A suggestion that
  // REPLACES another opens nothing — the slot is already open.
  const wasOpenRef = useRef(false);
  const enterSettleRef = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const open = shown !== null;
    const opening = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!opening || reduceRef.current) return;
    enterSettleRef.current = requestRef.current?.(CARD_SLOT_PX, CARD_ENTER_MS) ?? null;
  }, [shown]);
  const entered = useCallback(() => {
    const settle = enterSettleRef.current;
    enterSettleRef.current = null;
    settle?.();
  }, []);

  return (
    <div
      className="relative flex flex-col px-3 w-full"
      data-testid="dynamic-action-bar"
      aria-label="Suggested actions"
    >
      <AnimatePresence
        initial={false}
        custom={exitsRef.current}
        onExitComplete={() => {
          // The slot folded: settle the window height its tween held, and
          // forget the exits of cards that are gone.
          entered();   // it may have folded before it finished opening
          const live = new Set(actionsRef.current.map((a) => a.id));
          for (const id of Object.keys(exitsRef.current)) {
            if (live.has(id)) continue;
            exitsRef.current[id].settle?.();
            delete exitsRef.current[id];
          }
        }}
      >
        {shown && (
          <SuggestionSlot key="slot" cardId={shown.id} onEntered={entered}>
            <AnimatePresence initial={false} mode="popLayout" custom={exitsRef.current}>
              <DynamicActionCard
                key={shown.id}
                action={shown}
                waiting={waiting}
                shortcutKeys={shortcutKeys}
                pressing={pressingId === shown.id}
                onAccept={(action) => accept(action)}
                onDismiss={dismiss}
                surfaceStyle={surfaceStyle}
              />
            </AnimatePresence>
          </SuggestionSlot>
        )}
      </AnimatePresence>
    </div>
  );
};
