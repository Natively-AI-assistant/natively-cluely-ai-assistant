import React, { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  AlignLeft, BookOpen, Calculator, CodeXml, CornerDownRight, ListChecks, ScanText, Workflow, X,
  type LucideIcon,
} from 'lucide-react'
import type { DynamicActionPayload } from '@/types/electron'
import './dynamicActionCard.css'

interface Props {
  action: DynamicActionPayload
  isPrimary: boolean
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

// A suggested action as one quiet 36px line in the overlay's chip material:
// the glyph, the action, what was said (italic, the rolling transcript's own
// treatment) and ONE trailing affordance: Tab on the primary card, the dismiss
// × in its place on hover. Colours come from the --overlay-text-* tokens, which
// follow both theme axes (liquid-glass and modern paint a dark panel under
// data-theme=light). The confidence score and the accent outline are gone:
// neither told the user anything they could act on.
export const DynamicActionCard: React.FC<Props> = ({ action, isPrimary, onAccept, onDismiss, surfaceStyle }) => {
  const [busy, setBusy] = useState(false)
  const reduceMotion = useReducedMotion()
  const Icon = glyphFor(action.type)
  const snippet = action.evidenceRefs?.[0]?.text?.trim() ?? ''

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: reduceMotion ? 0 : -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12, ease: [0.4, 0, 1, 1] } }}
      transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
      className="group relative no-drag select-none"
      data-testid={`dynamic-action-card-${action.id}`}
    >
      <button
        type="button"
        className="overlay-chip-surface action-cue w-full flex items-center gap-2.5 h-9 pl-3 pr-2 rounded-[12px] border text-left cursor-pointer transition-[background-color,transform] duration-150 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--overlay-border)]"
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
        <Icon aria-hidden className="w-3.5 h-3.5 shrink-0 text-[var(--overlay-text-muted)]" strokeWidth={1.75} />
        <span className={`shrink-0 text-[12.5px] font-medium ${isPrimary ? 'text-[var(--overlay-text-primary)]' : 'text-[var(--overlay-text-secondary)]'}`}>
          {action.label}
        </span>
        {snippet && (
          <span className="min-w-0 flex-1 truncate text-[12px] italic text-[var(--overlay-text-secondary)] opacity-80">
            {snippet}
          </span>
        )}
        <span className="ml-auto flex w-9 shrink-0 justify-end">
          {isPrimary && (
            <kbd className="inline-flex items-center h-[18px] px-1.5 rounded-[5px] border text-[10px] font-medium leading-none tracking-[0.02em] text-[var(--overlay-text-muted)] border-[var(--overlay-border-soft)] bg-[var(--overlay-control-bg)] transition-opacity duration-150 group-hover:opacity-0">
              Tab
            </kbd>
          )}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onDismiss(action.id)}
        className="absolute right-2 top-1/2 -translate-y-1/2 grid h-6 w-6 place-items-center rounded-full opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 text-[var(--overlay-text-muted)] hover:text-[var(--overlay-text-primary)] hover:bg-[var(--overlay-icon-hover-bg)]"
        title="Dismiss"
        aria-label={`Dismiss ${action.label}`}
      >
        <X className="w-3 h-3" strokeWidth={2} />
      </button>
    </motion.div>
  )
}
