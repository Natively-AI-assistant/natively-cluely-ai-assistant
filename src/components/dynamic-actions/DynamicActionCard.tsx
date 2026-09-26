import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { X, Zap, ChevronRight } from 'lucide-react'
import type { DynamicActionPayload } from '@/types/electron'

interface Props {
  action: DynamicActionPayload
  isPrimary: boolean
  onAccept: (action: DynamicActionPayload) => void
  onDismiss: (actionId: string) => void
}

// Single dynamic action card. Compact, glass-styled, dismissible.
// Primary card (highest priority) gets a subtle accent + shortcut hint.
// Cards are intentionally lightweight — clicking accept fires the parent
// callback which is responsible for kicking off the answer stream so the
// card itself stays presentation-only.
export const DynamicActionCard: React.FC<Props> = ({ action, isPrimary, onAccept, onDismiss }) => {
  const [busy, setBusy] = useState(false)
  const evidence = action.evidenceRefs?.[0]
  const evidenceText = evidence?.text?.trim() ?? ''
  const evidenceSnippet = evidenceText.length > 90
    ? `${evidenceText.slice(0, 90).trimEnd()}…`
    : evidenceText

  const confidencePct = Math.round((action.confidence ?? 0) * 100)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
      className={[
        'group relative flex items-stretch gap-2 px-2.5 py-2 rounded-[12px]',
        'border backdrop-blur-md no-drag select-none',
        isPrimary
          ? 'border-accent-focus bg-accent-subtle hover:bg-accent-muted'
          : 'border-white/10 bg-white/5 hover:bg-white/8',
        'transition-colors duration-150 cursor-pointer',
      ].join(' ')}
      onClick={async () => {
        if (busy) return
        setBusy(true)
        try {
          await onAccept(action)
        } finally {
          setBusy(false)
        }
      }}
      title={action.description ?? action.label}
      data-testid={`dynamic-action-card-${action.id}`}
    >
      <div className="flex items-center justify-center w-7 h-7 rounded-full bg-white/8 shrink-0">
        <Zap className={`w-3.5 h-3.5 ${isPrimary ? 'text-accent-primary' : 'text-white/70'}`} />
      </div>

      <div className="flex flex-col flex-1 min-w-0 leading-tight">
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] font-semibold overlay-text-primary truncate">{action.label}</span>
          {confidencePct > 0 && (
            <span className="text-[10px] tabular-nums text-white/40 shrink-0">{confidencePct}%</span>
          )}
        </div>
        {evidenceSnippet && (
          <span className="text-[10.5px] text-white/55 truncate">"{evidenceSnippet}"</span>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {isPrimary && (
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium text-white/60 bg-white/8 border border-white/10">
            Tab
          </kbd>
        )}
        <ChevronRight className="w-3.5 h-3.5 text-white/40 group-hover:text-white/70 transition-colors" />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDismiss(action.id)
          }}
          className="ml-0.5 p-1 rounded-full text-white/30 hover:text-white/70 hover:bg-white/10 transition-colors opacity-0 group-hover:opacity-100"
          title="Dismiss"
          aria-label={`Dismiss ${action.label}`}
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </motion.div>
  )
}
