// src/components/ui/GenieModal.tsx
//
// A popup card that opens and closes with the macOS genie: the same pour out
// of, and back into, a slot at the window's bottom edge (straight below the
// card: the bottom centre, for a centred one) that the browser-extension and
// permissions cards use. Settings, the Modes and Profile Intelligence manager,
// the other launcher popups and the notices in the bottom-right corner all go
// through here, so every card in the app moves the same way.
//
// The animation itself is useGenieCard's. This adds what those two toasters
// never needed:
//
//   - A controlled `open`. The host flips a boolean the way it always has;
//     the card stays mounted after `open` goes false until its close has
//     played (geniePresence.mjs).
//   - Frozen content. While the card drains away it keeps showing what it
//     showed when the host closed it, even if the host has already moved on
//     (the manager's ternary would otherwise swap panels mid-close, and the
//     bands would be cut from the wrong one).
//   - `closeInstantly`, for a hand-over: when one card replaces another, only
//     the incoming one pours. Two genies through the one slot at once is
//     twice the cost for a muddier picture.
//
// Sizing belongs on the wrap, never on the card. The wrap is measured and
// never transformed; the card is written to on every frame of the genie.
import React, { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { motion, type MotionStyle } from 'framer-motion';
import { useGenieCard, type GenieCard, type GenieSnapshotSource } from '../onboarding/useGenieCard';
import {
  warmGenieSnapshots, getGenieSnapshot, captureGenieSnapshot, isSettled, isScrolled, showsTransientState, viewOf, snapshotKey as keyFor,
  type GenieSnapshot,
} from '../onboarding/genieSnapshots';
import { presenceInitial, presenceReducer, presenceEventFor } from '../onboarding/geniePresence.mjs';
import { useGenieAnimationEnabled } from '../../lib/genieAnimationSetting';

type DataAttributes = { [key: `data-${string}`]: string | undefined };


// Pictures (genieSnapshots.ts). The card is photographed again once it has
// sat unchanged this long after a change, at most this often.
const SNAPSHOT_QUIET_MS = 350;
const SNAPSHOT_MIN_GAP_MS = 1200;

// The view each card last opened into, for cards that do not say (the Modes
// manager opens on whichever mode it restores). View names only: tab ids,
// section names, mode ids. Nothing a user typed.
const VIEWS_KEY = 'natively_genie_opening_views_v1';
const readViews = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(VIEWS_KEY) || '{}') || {}; } catch { return {}; }
};
const rememberedView = (card: string): string | undefined => readViews()[card];
const rememberView = (card: string, view: string) => {
  try { localStorage.setItem(VIEWS_KEY, JSON.stringify({ ...readViews(), [card]: view })); } catch { /* private mode */ }
};

export interface GenieModalProps {
  open: boolean;
  /** For console warnings. */
  label: string;
  children: React.ReactNode;
  /** A click on the scrim itself, not on the card. */
  onBackdropClick?: () => void;
  /** The card has poured out and can take focus. */
  onOpened?: () => void;
  /**
   * The close has played and the card is gone. A host that unmounts the
   * popup the moment it hears "dismissed" (the onboarding orchestrator does)
   * reports from here, so the genie is not cut off: the popup keeps its own
   * `open`, sets it false, and tells the host once this fires.
   */
  onClosed?: () => void;
  /** Skip the close genie: another card is taking this one's place. */
  closeInstantly?: boolean;
  /**
   * Which card this is, for its pictures (default: `label`). The genie pours
   * out a picture of the view the card opens into, the way macOS restores a
   * window from its last texture, and keeps it fresh while the card is open.
   */
  snapshotKey?: string;
  /**
   * The view the card is about to open into (a Settings tab, say), when the
   * card only switches to it after mounting. Default: the view it opened into
   * last time, then whatever `data-genie-view` it shows.
   */
  openingView?: string;
  /** No pictures just now (Settings' opacity preview hides the card's content). */
  snapshotPaused?: boolean;
  /**
   * Keep pictures of this card for its next open (default). Off for a card
   * whose content is new each time it opens, a quota reading or a server
   * status: a kept picture would pour out last time's numbers. Its open pours
   * the live card instead, and its close a fresh picture that is not kept.
   */
  keepPictures?: boolean;
  /**
   * A modal (default) sits over a dim that takes the clicks around it. A
   * notice that leaves the app usable, a card in a corner, has no dim, and
   * clicks beside it reach the app.
   */
  modal?: boolean;
  /**
   * Where the card sits in the window (default: centred). The genie pours
   * into a slot at the window's bottom edge, straight below the card.
   */
  placement?: 'center' | 'bottom-right';
  zIndex?: number;

  backdropId?: string;
  backdropClassName?: string;
  backdropStyle?: React.CSSProperties;
  /** Space kept between the card and the window's edges. */
  padding?: number | string;

  wrapClassName?: string;
  wrapStyle?: React.CSSProperties;

  cardRef?: React.Ref<HTMLDivElement>;
  cardClassName?: string;
  cardStyle?: React.CSSProperties;
  cardProps?: Omit<React.HTMLAttributes<HTMLDivElement>, 'className' | 'style' | 'children'> & DataAttributes;

  /**
   * The card's drop shadow and corner radius. A stand-in carries the shadow
   * while the card is cut into bands, and the bands are drawn without one.
   * The card keeps drawing its own shadow from its classes at rest: an inline
   * one would be wiped by Settings' opacity preview, which clears
   * style.boxShadow when it restores the panel.
   */
  shadow: string;
  radius: number | string;
}

export const GenieModal: React.FC<GenieModalProps> = ({
  open, label, children, onBackdropClick, onOpened, onClosed, closeInstantly = false, zIndex = 300,
  snapshotKey, openingView, snapshotPaused = false, keepPictures = true, modal = true, placement = 'center',
  backdropId, backdropClassName, backdropStyle, padding,
  wrapClassName, wrapStyle,
  cardRef, cardClassName, cardStyle, cardProps,
  shadow, radius,
}) => {
  const [presence, dispatch] = useReducer(presenceReducer, open, presenceInitial);

  // ── Pictures ───────────────────────────────────────────────────────────
  const cardKey = snapshotKey ?? label;
  const genieRef = useRef<GenieCard | null>(null);
  const pausedRef = useRef(snapshotPaused);
  pausedRef.current = snapshotPaused;
  const keepRef = useRef(keepPictures);
  keepRef.current = keepPictures;
  const openingViewRef = useRef(openingView);
  openingViewRef.current = openingView;
  // The open has landed (the picture, if any, has handed over).
  const landedRef = useRef(false);
  // Decided as the close begins, while the card can still be hit-tested:
  // may the close's picture be kept for the next open?
  const keepOnCloseRef = useRef<string | null>(null);
  // The last picture taken while open, and whether the card has changed since
  // (a hover's inline colour does not count). Unchanged, the close pours it
  // away at once instead of waiting on a new capture.
  const lastShotRef = useRef<{ key: string; snap: GenieSnapshot } | null>(null);
  const changedSinceShotRef = useRef(true);

  // With the genie off (Settings → Advanced) no picture is used, so none is
  // decoded ahead of time or taken while the card is open.
  const genieEnabled = useGenieAnimationEnabled();
  useEffect(() => { if (genieEnabled) void warmGenieSnapshots(); }, [genieEnabled]);

  const keyOf = useCallback((view: string): string | null => {
    const wrap = genieRef.current?.wrapRef.current;
    if (!wrap) return null;
    const r = wrap.getBoundingClientRect();
    return r.width > 0 ? keyFor(cardKey, view, r.width, r.height) : null;
  }, [cardKey]);

  const snapshots = useMemo<GenieSnapshotSource>(() => ({
    forOpen: () => {
      const card = genieRef.current?.cardRef.current;
      if (!card || !keepRef.current) return null;
      const view = openingViewRef.current ?? rememberedView(cardKey) ?? viewOf(card);
      const key = keyOf(view);
      return key ? getGenieSnapshot(key) : null;
    },
    forClose: async () => {
      const card = genieRef.current?.cardRef.current;
      if (!card || pausedRef.current) return null;
      const last = lastShotRef.current;
      // Not while pictures are off: the watch that would have seen the change
      // that turned them off (a star clicked, a key typed) stopped with them.
      if (keepRef.current && last && !changedSinceShotRef.current && last.key === keyOf(viewOf(card))) return last.snap;
      return captureGenieSnapshot(card, keepOnCloseRef.current);
    },
    settled: () => {
      const card = genieRef.current?.cardRef.current;
      return !card || isSettled(card);
    },
  }), [cardKey, keyOf]);

  const genie = useGenieCard(presence.mounted, label, {
    snapshots,
    onOpened: () => { landedRef.current = true; onOpened?.(); },
  });
  genieRef.current = genie;
  const { shown, closing, closeThen, scrim, wrapRef, bandsRef, shadowRef } = genie;

  const closeInstantlyRef = useRef(closeInstantly);
  closeInstantlyRef.current = closeInstantly;
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  useEffect(() => {
    const event = presenceEventFor(presence, open);
    if (!event) return;
    dispatch(event);
    if (event === 'open') landedRef.current = false;
    if (event === 'close') {
      const card = genieRef.current?.cardRef.current;
      keepOnCloseRef.current = card && keepRef.current && !pausedRef.current && landedRef.current && isSettled(card) && !isScrolled(card)
        && !showsTransientState(card)
        ? keyOf(viewOf(card)) : null;
      const landed = () => { dispatch('closed'); onClosedRef.current?.(); };
      if (closeInstantlyRef.current) landed();
      else closeThen(landed);
    }
  }, [open, presence, closeThen, keyOf]);

  // While the card is open and at rest, photograph it again each time it
  // settles after a change: an upload lands, a setting changes, a mode is
  // switched. That picture is what the next open pours out. The first one
  // after an open also records which view the card opens into.
  useEffect(() => {
    if (!open || !shown || !keepPictures || !genieEnabled) return;
    const card = genieRef.current?.cardRef.current;
    if (!card) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = 0;
    let recorded = false;
    let stopped = false;
    const schedule = (ms: number) => { clearTimeout(timer); timer = setTimeout(attempt, ms); };
    const attempt = async () => {
      if (stopped) return;
      const bandsBusy = (genieRef.current?.bandsRef.current?.childElementCount ?? 0) > 0;
      // Not of a control under the pointer or a focus ring either: wait for the
      // pointer to move on (a hover is not a change, so this polls).
      if (!landedRef.current || bandsBusy || pausedRef.current || !isSettled(card) || showsTransientState(card)) { schedule(400); return; }
      // A picture of the view it opens into is a picture of its top: one
      // scrolled away would pour out scrolled, then land at the top.
      if (isScrolled(card)) return;
      const wait = SNAPSHOT_MIN_GAP_MS - (performance.now() - last);
      if (last && wait > 0) { schedule(wait); return; }
      last = performance.now();
      const view = viewOf(card);
      const key = keyOf(view);
      if (!key) return;
      if (!recorded && openingViewRef.current === undefined) { rememberView(cardKey, view); }
      recorded = true;
      changedSinceShotRef.current = false;
      const snap = await captureGenieSnapshot(card, key);
      if (snap) lastShotRef.current = { key, snap };
    };
    const changed = () => { changedSinceShotRef.current = true; schedule(SNAPSHOT_QUIET_MS); };
    // A hover that recolours a row inline (the Modes manager's do) is not a
    // change worth a picture; it was re-photographing the card every second
    // or so while the mouse moved over it.
    // The card root's own attributes are the genie's (inert as it closes, its
    // style every genie frame), not the content's.
    const observer = new MutationObserver(records => {
      if (records.some(r => r.type !== 'attributes' || (r.target !== card && r.attributeName !== 'style'))) changed();
    });
    observer.observe(card, { subtree: true, childList: true, attributes: true, characterData: true });
    card.addEventListener('scroll', changed, true);
    card.addEventListener('input', changed, true);
    changedSinceShotRef.current = true;
    lastShotRef.current = null;
    schedule(SNAPSHOT_QUIET_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
      observer.disconnect();
      card.removeEventListener('scroll', changed, true);
      card.removeEventListener('input', changed, true);
    };
  }, [open, shown, cardKey, keyOf, keepPictures, genieEnabled]);

  // What the card shows while it drains away: the last thing it showed open.
  const frozen = useRef(children);
  if (open) frozen.current = children;
  const content = open ? children : frozen.current;

  const setCard = useCallback((el: HTMLDivElement | null) => {
    genie.cardRef.current = el;
    if (typeof cardRef === 'function') cardRef(el);
    else if (cardRef) (cardRef as React.RefObject<HTMLDivElement | null>).current = el;
  }, [genie.cardRef, cardRef]);

  if (!shown) return null;

  return (
    <>
      {/*
        The dim and the card are siblings, not parent and child. The dim
        fades in and out with the genie; the card must not fade with it, or it
        pours out ghosted and drains away translucent, where a real window
        stays solid all the way into the Dock. The backdrop element is still
        the one the host styles and Settings' opacity preview reaches by id.
      */}
      {modal && (
        <motion.div
          id={backdropId}
          className={backdropClassName}
          style={{
            position: 'fixed', inset: 0, zIndex,
            ...backdropStyle,
            opacity: scrim,
            // While the card drains away the app behind it is already live again.
            // Otherwise the host's own class decides (Settings' opacity preview
            // turns pointer events off on the scrim).
            ...(closing ? { pointerEvents: 'none' } : null),
          } as MotionStyle}
          onClick={e => { if (e.target === e.currentTarget && !closing) onBackdropClick?.(); }}
        />
      )}
      {/* The card's layer: clicks outside the card fall through to the dim,
          or, with no dim, to the app. */}
      <div
        style={{
          position: 'fixed', inset: 0, zIndex,
          display: 'flex',
          alignItems: placement === 'bottom-right' ? 'flex-end' : 'center',
          justifyContent: placement === 'bottom-right' ? 'flex-end' : 'center',
          padding, pointerEvents: 'none',
        }}
      >
        <div
          ref={wrapRef}
          className={wrapClassName}
          style={{ position: 'relative', pointerEvents: closing ? 'none' : 'auto', ...wrapStyle }}
        >
          {/* The card's shadow, standing in for it mid-genie. */}
          <div
            ref={shadowRef}
            aria-hidden
            style={{
              display: 'none', position: 'absolute', inset: 0,
              borderRadius: radius, transformOrigin: '50% 0', pointerEvents: 'none',
              boxShadow: shadow,
            }}
          />
          <div
            {...cardProps}
            ref={setCard}
            className={cardClassName}
            style={{
              position: 'relative', width: '100%', height: '100%',
              borderRadius: radius, overflow: 'hidden', transformOrigin: '50% 0%',
              // The card takes focus as a container (so Tab starts inside
              // it), not as a control: Escape drew a keyboard focus ring round
              // the whole card for a frame as it began to close.
              outline: 'none',
              ...cardStyle,
            }}
            // The genie is running: the card is a picture, not a control.
            {...(closing ? { inert: true } : null)}
          >
            {content}
          </div>
          {/* The genie's bands, present only while it runs. */}
          <div
            ref={bandsRef}
            aria-hidden
            inert
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          />
        </div>
      </div>
    </>
  );
};

export default GenieModal;
