import React, { useMemo, useState } from 'react'
import { motion, useReducedMotion, type Variants } from 'framer-motion'
import {
  AlignLeft, BookOpen, Calculator, CodeXml, CornerDownRight, ListChecks, ScanText, Workflow, X,
  type LucideIcon,
} from 'lucide-react'
import type { DynamicActionPayload } from '@/types/electron'
import './dynamicActionCard.css'

/** Why a card left, so its exit can say so. */
export type CardExitReason = 'accept' | 'dismiss' | 'expire'
/** Per card id, set by the bar BEFORE it removes the card (a removed card never sees new props). */
export type CardExits = Record<string, { reason: CardExitReason; tween: boolean }>

interface Props {
  action: DynamicActionPayload
  isPrimary: boolean
  /** Tab was pressed on this card: it shows the press before it leaves. */
  pressing?: boolean
  onAccept: (action: DynamicActionPayload) => void
  onDismiss: (actionId: string) => void
  /** The overlay's opacity-scaled chip fill (appearance.chipStyle), as the quick actions use. */
  surfaceStyle?: React.CSSProperties
}

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

// Motion, in transitions.dev's tokens (written as literals, as the rest of the
// renderer does): --ease-smooth-out for every surface move, --duration-fast
// (250ms) to open a slot, --duration-quick (150ms) to leave it, and
// --duration-medium (350ms) for an expiry, which is a quiet toast-style fade.
// Opening carries the distance (--distance-micro, 4px) and the blur
// (--blur-small, 2px); a close is quicker and never bounces.
const EASE_SMOOTH_OUT = [0.22, 1, 0.36, 1] as const
export const CARD_ENTER_MS = 250
const EXIT_FADE_S = 0.15
const EXPIRE_FADE_S = 0.35
const COLLAPSE_S = 0.15
/** How long a card's exit holds the slot open, fade then collapse, per reason. */
export const cardExitMs = (reason: CardExitReason) =>
  Math.round(((reason === 'expire' ? EXPIRE_FADE_S : EXIT_FADE_S) - 0.05 + COLLAPSE_S) * 1000)

// A suggested action as one quiet 36px line in the overlay's chip material:
// the glyph, the action, what was said (italic, the rolling transcript's own
// treatment) and ONE trailing affordance: Tab on the primary card, the dismiss
// × in its place on hover. Colours come from the --overlay-text-* tokens, which
// follow both theme axes (liquid-glass and modern paint a dark panel under
// data-theme=light).
//
// The slot itself opens and closes (height), so the transcript and the quick
// actions below glide instead of jumping. The bar asks the overlay to own the
// window height for the tween (requestHeightMotion); when it can't, the exit
// collapses the slot in one step after its fade.
export const DynamicActionCard: React.FC<Props> = ({ action, isPrimary, pressing = false, onAccept, onDismiss, surfaceStyle }) => {
  const [busy, setBusy] = useState(false)
  const reduce = useReducedMotion() ?? false
  const Icon = glyphFor(action.type)
  const snippet = action.evidenceRefs?.[0]?.text?.trim() ?? ''

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
      const exit = exits?.[action.id] ?? { reason: 'expire' as const, tween: false }
      const fade = exit.reason === 'expire' ? EXPIRE_FADE_S : EXIT_FADE_S
      const move = reduce ? {} : exit.reason === 'accept' ? { y: -4 } : exit.reason === 'dismiss' ? { x: 8 } : {}
      const blur = reduce || exit.reason === 'expire' ? {} : { filter: 'blur(2px)' }
      return {
        opacity: 0, height: 0, overflow: 'hidden', ...move, ...blur,
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
  }), [reduce, action.id])

  return (
    <motion.div
      variants={variants}
      initial="hidden"
      animate="shown"
      exit="exit"
      data-testid={`dynamic-action-card-${action.id}`}
    >
      <div
        className="action-cue-row relative py-[3px] no-drag select-none"
        data-primary={isPrimary ? 'true' : 'false'}
        data-pressing={pressing ? 'true' : undefined}
      >
        <button
          type="button"
          className="overlay-chip-surface action-cue w-full flex items-center gap-2.5 h-9 pl-3 pr-2 rounded-[12px] border text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--overlay-border)]"
          style={surfaceStyle}
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
          <span className={`action-cue-label shrink-0 text-[12.5px] font-medium ${isPrimary ? 'text-[var(--overlay-text-primary)]' : 'text-[var(--overlay-text-secondary)]'}`}>
            {action.label}
          </span>
          {snippet && (
            <span className="min-w-0 flex-1 truncate text-[12px] italic text-[var(--overlay-text-secondary)] opacity-80">
              {snippet}
            </span>
          )}
          <span className="ml-auto flex w-9 shrink-0 justify-end">
            <kbd
              aria-hidden={!isPrimary}
              className="action-cue-key inline-flex items-center h-[18px] px-1.5 rounded-[5px] border text-[10px] font-medium leading-none tracking-[0.02em] text-[var(--overlay-text-muted)] border-[var(--overlay-border-soft)] bg-[var(--overlay-control-bg)]"
            >
              Tab
            </kbd>
          </span>
        </button>
        <button
          type="button"
          onClick={() => onDismiss(action.id)}
          className="action-cue-dismiss absolute right-2 top-1/2 grid h-6 w-6 place-items-center rounded-full text-[var(--overlay-text-muted)] hover:text-[var(--overlay-text-primary)] hover:bg-[var(--overlay-icon-hover-bg)]"
          title="Dismiss"
          aria-label={`Dismiss ${action.label}`}
        >
          <X className="w-3 h-3" strokeWidth={2} />
        </button>
      </div>
    </motion.div>
  )
}
