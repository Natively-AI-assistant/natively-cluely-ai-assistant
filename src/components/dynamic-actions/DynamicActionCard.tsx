import React, { forwardRef, useMemo, useState } from 'react'
import { motion, useReducedMotion, type Variants } from 'framer-motion'
import {
  AlignLeft, BookOpen, Calculator, CodeXml, CornerDownRight, ListChecks, ScanText, Workflow, X,
  type LucideIcon,
} from 'lucide-react'
import type { DynamicActionPayload } from '@/types/electron'
import './dynamicActionCard.css'

/** Why a card left, so its exit can say so. */
export type CardExitReason = 'accept' | 'dismiss' | 'expire'
/**
 * Per card id, set by the bar BEFORE it removes the card (a removed card never
 * sees new props, so its exit reads this through AnimatePresence's `custom`).
 * `tween`: the overlay holds the window height, so an emptied slot folds
 * smoothly; `settle` releases that hold once the slot is gone.
 */
export type CardExits = Record<string, { reason: CardExitReason; tween: boolean; settle?: () => void }>

// One glyph per KIND of result, monochrome in the muted text colour. The card
// used to show the same bolt on every action, which described nothing.
const GLYPH: Record<string, LucideIcon> = {
  general_summarize: AlignLeft,
  general_explain: BookOpen,
  concept_explanation: BookOpen,
  worked_example: BookOpen,
  action_item: ListChecks,
  decision_point: ListChecks,
  blocker_check: ListChecks,
  owner_deadline_check: ListChecks,
  roi_question: Calculator,
  coding_problem: CodeXml,
  complexity_analysis: CodeXml,
  screen_coding_problem: ScanText,
  system_design_prompt: Workflow,
}
/** Everything else drafts something to say next. */
const glyphFor = (type: string): LucideIcon => GLYPH[type] ?? CornerDownRight

/** A shortcut as the keycap shows it, keys spaced apart: "⌘ 8" on macOS, "Ctrl 8" on Windows. */
export const formatShortcut = (keys: string[]): string =>
  keys.filter(Boolean).join(' ')

// Motion, in transitions.dev's tokens (written as literals, as the rest of the
// renderer does): --ease-smooth-out for every surface move, --duration-fast
// (250ms) to open the slot or bring the next suggestion in, --duration-quick
// (150ms) to leave, --duration-medium (350ms) for an expiry, a quiet
// toast-style fade. Opening carries the distance (--distance-micro, 4px) and
// the blur (--blur-small, 2px); a close is quicker and never bounces.
const EASE_SMOOTH_OUT = [0.22, 1, 0.36, 1] as const
export const CARD_ENTER_MS = 250
const EXIT_FADE_S = 0.15
const EXPIRE_FADE_S = 0.35
const COLLAPSE_S = 0.15
/** How long an emptied slot's exit holds the window height, fade then collapse, per reason. */
export const cardExitMs = (reason: CardExitReason) =>
  Math.round(((reason === 'expire' ? EXPIRE_FADE_S : EXIT_FADE_S) - 0.05 + COLLAPSE_S) * 1000)

/** How a leaving card moves: accept lifts away, dismiss slides toward the ×, an expiry only fades. */
const leaveMotion = (reason: CardExitReason, reduce: boolean) => {
  const fade = reason === 'expire' ? EXPIRE_FADE_S : EXIT_FADE_S
  const move = reduce ? {} : reason === 'accept' ? { y: -4 } : reason === 'dismiss' ? { x: 8 } : {}
  const blur = reduce || reason === 'expire' ? {} : { filter: 'blur(2px)' }
  return { fade, target: { opacity: 0, ...move, ...blur } }
}

interface SlotProps {
  /** The card showing when the slot empties decides how the slot leaves. */
  cardId: string
  /** The slot finished opening: the overlay may settle the window height now. */
  onEntered?: () => void
  children: React.ReactNode
}

// The ONE suggestion slot. It opens (height) when the first suggestion arrives
// and folds when the last one goes, so the transcript and the quick actions
// below glide instead of jumping. While suggestions keep coming, the slot stays
// open and only its row crossfades (DynamicActionCard), so the window never
// shrinks and regrows between them.
export const SuggestionSlot: React.FC<SlotProps> = ({ cardId, onEntered, children }) => {
  const reduce = useReducedMotion() ?? false
  const variants = useMemo<Variants>(() => ({
    hidden: reduce
      ? { opacity: 0 }
      : { opacity: 0, height: 0, y: -4, filter: 'blur(2px)', overflow: 'hidden' },
    shown: reduce
      ? { opacity: 1, transition: { duration: 0.15 } }
      : {
          opacity: 1, height: 'auto', y: 0, filter: 'blur(0px)',
          transition: {
            height: { duration: CARD_ENTER_MS / 1000, ease: EASE_SMOOTH_OUT },
            y: { duration: CARD_ENTER_MS / 1000, ease: EASE_SMOOTH_OUT },
            filter: { duration: CARD_ENTER_MS / 1000, ease: EASE_SMOOTH_OUT },
            opacity: { duration: 0.2, ease: 'easeOut' },
          },
          // Visible overflow once open, so the glass hover shadow isn't
          // clipped; no filter left behind, so no stray compositing layer.
          transitionEnd: { overflow: 'visible', filter: 'none' },
        },
    exit: (exits: CardExits | undefined) => {
      const exit = exits?.[cardId] ?? { reason: 'expire' as const, tween: false }
      const { fade, target } = leaveMotion(exit.reason, reduce)
      return {
        ...target, height: 0, overflow: 'hidden',
        transition: {
          opacity: { duration: fade, ease: EASE_SMOOTH_OUT },
          x: { duration: fade, ease: EASE_SMOOTH_OUT },
          y: { duration: fade, ease: EASE_SMOOTH_OUT },
          filter: { duration: fade, ease: EASE_SMOOTH_OUT },
          // Accept, or a window the overlay couldn't hold: one step once the
          // fade is done, never a per-frame window resize.
          height: exit.tween && !reduce
            ? { duration: COLLAPSE_S, delay: fade - 0.05, ease: EASE_SMOOTH_OUT }
            : { duration: 0, delay: fade },
        },
      }
    },
  }), [reduce, cardId])

  return (
    <motion.div
      variants={variants}
      initial="hidden"
      animate="shown"
      exit="exit"
      onAnimationComplete={(definition) => { if (definition === 'shown') onEntered?.() }}
      className="relative"
      data-testid="dynamic-action-slot"
    >
      {children}
    </motion.div>
  )
}

interface Props {
  action: DynamicActionPayload
  /** How many more suggestions wait behind this one. */
  waiting?: number
  /** The accept shortcut's keys (["⌘", "8"]); empty = no keycap (unbound, off, or taken by another app). */
  shortcutKeys?: string[]
  /** The shortcut was pressed on this card: its keycap goes down before the card leaves. */
  pressing?: boolean
  onAccept: (action: DynamicActionPayload) => void
  onDismiss: (actionId: string) => void
  /** The overlay's opacity-scaled chip fill (appearance.chipStyle), as the quick actions use. */
  surfaceStyle?: React.CSSProperties
}

// A suggested action as one quiet 36px line in the overlay's chip material:
// the glyph, the action, what was said (italic, the rolling transcript's own
// treatment), how many more are waiting, and ONE trailing affordance: the
// accept shortcut, with the dismiss × in its place on hover. Colours come from
// the --overlay-text-* tokens, which follow both theme axes (liquid-glass and
// modern paint a dark panel under data-theme=light).
//
// When the next suggestion takes this one's place, this row leaves (popped out
// of layout by the bar's AnimatePresence) as the next one rises into the same
// spot: a crossfade, not a fold and reopen.
export const DynamicActionCard = forwardRef<HTMLDivElement, Props>(function DynamicActionCard(
  { action, waiting = 0, shortcutKeys = [], pressing = false, onAccept, onDismiss, surfaceStyle },
  ref,
) {
  const [busy, setBusy] = useState(false)
  const reduce = useReducedMotion() ?? false
  const Icon = glyphFor(action.type)
  const snippet = action.evidenceRefs?.[0]?.text?.trim() ?? ''
  const shortcut = formatShortcut(shortcutKeys)

  const variants = useMemo<Variants>(() => ({
    hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 4, filter: 'blur(2px)' },
    shown: reduce
      ? { opacity: 1, transition: { duration: 0.15 } }
      : {
          opacity: 1, y: 0, filter: 'blur(0px)',
          transition: { duration: CARD_ENTER_MS / 1000, ease: EASE_SMOOTH_OUT },
          transitionEnd: { filter: 'none' },
        },
    exit: (exits: CardExits | undefined) => {
      const exit = exits?.[action.id] ?? { reason: 'expire' as const, tween: false }
      const { fade, target } = leaveMotion(exit.reason, reduce)
      return { ...target, transition: { duration: fade, ease: EASE_SMOOTH_OUT } }
    },
  }), [reduce, action.id])

  return (
    <motion.div
      ref={ref}
      variants={variants}
      initial="hidden"
      animate="shown"
      exit="exit"
      className="w-full"
      data-testid={`dynamic-action-card-${action.id}`}
    >
      <div
        className="action-cue-row py-[3px] no-drag select-none"
        data-shortcut={shortcut ? 'true' : 'false'}
        data-pressing={pressing ? 'true' : undefined}
      >
        {/* The chip surface is this wrapper, so the accept button and the
            dismiss × can be SIBLINGS (a button can't hold a button) while the
            keycap and the × share one box: the trailing zone below. */}
        <div
          className="overlay-chip-surface action-cue flex items-center h-9 pr-2 rounded-[12px] border"
          style={surfaceStyle}
        >
          <button
            type="button"
            className="action-cue-main flex min-w-0 flex-1 items-center gap-2.5 self-stretch pl-3 pr-2 rounded-l-[12px] text-left cursor-pointer bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--overlay-border)]"
            title={action.description ?? action.label}
            onClick={async () => {
              if (busy) return
              setBusy(true)
              try {
                await onAccept(action)
              } finally {
                setBusy(false)
              }
            }}
          >
            <Icon aria-hidden className="action-cue-glyph w-3.5 h-3.5 shrink-0 text-[var(--overlay-text-muted)]" strokeWidth={1.75} />
            <span className="action-cue-label shrink-0 text-[12.5px] font-medium text-[var(--overlay-text-primary)]">
              {action.label}
            </span>
            {snippet && (
              <span className="min-w-0 flex-1 truncate text-[12px] italic text-[var(--overlay-text-secondary)] opacity-80">
                {snippet}
              </span>
            )}
            {waiting > 0 && (
              <span
                key={waiting}
                className="action-cue-more ml-auto shrink-0 text-[11px] tabular-nums font-medium text-[var(--overlay-text-muted)]"
                aria-label={`${waiting} more ${waiting === 1 ? 'suggestion' : 'suggestions'} waiting`}
                title={`${waiting} more ${waiting === 1 ? 'suggestion' : 'suggestions'} waiting`}
              >
                +{waiting}
              </span>
            )}
          </button>
          {/* ONE box for the keycap and the ×: the × fills exactly the
              keycap's rectangle, so the swap is a cross-fade in place. Two
              boxes of different sizes (a 33px keycap under a 24px circle
              pinned to the row's edge) left the keycap's edges showing around
              the × — "overlapping and cutting off partially". */}
          <span className="action-cue-trail relative grid shrink-0 place-items-center">
            {shortcut ? (
              <kbd aria-hidden className="action-cue-key inline-flex items-center justify-center h-[20px] min-w-[24px] px-1.5 rounded-[6px] border text-[10px] font-medium leading-none tracking-[0.02em] whitespace-nowrap text-[var(--overlay-text-muted)] border-[var(--overlay-border-soft)] bg-[var(--overlay-control-bg)]">
                {shortcut}
              </kbd>
            ) : (
              <span aria-hidden className="block h-[20px] w-[24px]" />
            )}
            <button
              type="button"
              onClick={() => onDismiss(action.id)}
              className="action-cue-dismiss absolute inset-0 grid place-items-center rounded-[6px] text-[var(--overlay-text-muted)] hover:text-[var(--overlay-text-primary)] hover:bg-[var(--overlay-icon-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--overlay-border)]"
              title="Dismiss"
              aria-label={`Dismiss ${action.label}`}
            >
              <X className="w-3 h-3" strokeWidth={2} />
            </button>
          </span>
        </div>
      </div>
    </motion.div>
  )
})
