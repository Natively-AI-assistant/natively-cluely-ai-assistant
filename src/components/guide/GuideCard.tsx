// First-run guide: the tip for the launcher and Settings. It points at the real
// control (lit with data-guide-lit) and draws nothing while that control is not
// on screen, so it never points at empty space.
//
// Evin, 2026-11-15: "i didnt like the ui of the guide, redesign it". Modelled on
// Apple's TipKit popover and the coach tips of top apps (Appllama: eToro Delta,
// GoPro Quik, Pump Club): an arrow joins the tip to its control; the surface is
// inverted against the page (a periwinkle-ice tip on the dark app, an ink tip on
// the light one) so it reads as a tip, not as more app; a tinted icon, a bold
// title, one line, one action, and a plain ✕ that skips the guide. No kicker
// label, no progress widget: a quiet "N of 8" beside the action.
import React from 'react';
import { createPortal } from 'react-dom';
import { Check, FileText, KeyRound, Play, Sparkles, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useT } from '../../i18n';
import { GUIDE_STEP_COUNT, GUIDE_STEP_NUMBER } from '../../lib/onboarding/firstRunGuide.mjs';
import type { GuideStepId } from '../../lib/onboarding/firstRunGuide.mjs';
import { useAnchorRect, useGuideLit } from './useGuide';
import './guide.css';

export type GuideListRow = [label: string, state: 'done' | 'now' | 'todo', hint?: string];

export interface GuideCardProps {
  /** CSS selector of the real control, e.g. '[data-guide="start"]'. */
  anchor: string;
  width?: number;
  /** Nudge the tip sideways; the arrow keeps pointing at the control. */
  dx?: number;
  stepId: GuideStepId;
  title: string;
  body: string;
  list?: GuideListRow[];
  /** Action steps wait for the real thing and show this instead of a button. */
  waiting?: string;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  /** The step just finished: show it done for a moment. */
  done?: boolean;
  /** Light the anchor (default true). */
  lit?: boolean;
  onSkip?: () => void;
}

const STEP_ICON: Partial<Record<GuideStepId, LucideIcon>> = {
  start: Play,
  notes: FileText,
  plans: Sparkles,
  keys: KeyRound,
};

const GAP = 10;      // control → arrow tip
const ARROW = 8;     // arrow height
const EDGE = 12;     // window margin
const ARROW_INSET = 22;

export const GuideCard: React.FC<GuideCardProps> = ({
  anchor, width = 320, dx = 0, stepId, title, body, list, waiting, action, done, lit = true, onSkip,
}) => {
  const tr = useT();
  const rect = useAnchorRect(anchor);
  useGuideLit(lit && rect ? anchor : null);
  if (!rect) return null;

  const count = tr('{n} of {total}')
    .replace('{n}', String(GUIDE_STEP_NUMBER[stepId]))
    .replace('{total}', String(GUIDE_STEP_COUNT));
  const Icon = done ? Check : (STEP_ICON[stepId] ?? Sparkles);

  // Below the control, centred on it, kept inside the window; the arrow
  // follows the control's centre wherever the tip lands.
  const vw = window.innerWidth;
  const centre = rect.left + rect.width / 2;
  const left = Math.max(EDGE, Math.min(vw - width - EDGE, centre - width / 2 + dx));
  const top = rect.bottom + GAP + ARROW;
  const arrowX = Math.max(ARROW_INSET, Math.min(width - ARROW_INSET, centre - left));

  // Portalled to <body>: a transformed ancestor (Settings and the launcher
  // animate theirs) would otherwise move a position:fixed tip off its anchor.
  return createPortal(
    <div
      className="guide-enter guide-tip"
      style={{ position: 'fixed', left, top, width, zIndex: 2147483001, transformOrigin: `${arrowX}px -${ARROW}px` }}
      role="dialog"
      aria-label={title}
      data-guide-card={stepId}
    >
      <svg className="guide-tip-arrow" style={{ left: arrowX - 9 }} width="18" height={ARROW} viewBox={`0 0 18 ${ARROW}`} aria-hidden>
        <path d={`M0 ${ARROW} C5 ${ARROW} 7 0 9 0 C11 0 13 ${ARROW} 18 ${ARROW} Z`} />
      </svg>

      <div className="flex items-start gap-3">
        <span className={`guide-tip-icon ${done ? 'is-done' : ''}`} aria-hidden>
          <Icon className="w-[15px] h-[15px]" strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1 pt-px">
          <div className="guide-tip-title">{title}</div>
          <div className="guide-tip-body">{body}</div>
        </div>
        {onSkip && !done && (
          <button type="button" className="guide-tip-close" onClick={onSkip} aria-label={tr('Skip guide')} title={tr('Skip guide')}>
            <X className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
        )}
      </div>

      {list && (
        <ul className="guide-tip-list">
          {list.map(([label, st, hint]) => (
            <li key={label} className={`guide-tip-row is-${st}`}>
              <span aria-hidden className="guide-tick">
                {st === 'done' && <Check className="w-2.5 h-2.5" strokeWidth={3.5} />}
              </span>
              <span className="min-w-0 truncate">{label}</span>
              {st === 'done' && <span className="sr-only">{tr('Done')}</span>}
              {hint && <span className="guide-tip-hint">{hint}</span>}
            </li>
          ))}
        </ul>
      )}

      <div className="guide-tip-foot">
        <span className="guide-tip-count" aria-label={count}>{count}</span>
        {done ? (
          <span role="status" className="guide-tip-status">{tr('Done')}</span>
        ) : action ? (
          <button type="button" className="guide-tip-action" disabled={action.disabled} onClick={action.onClick}>
            {action.label}
          </button>
        ) : waiting ? (
          <span role="status" className="guide-tip-status is-waiting">
            <i className="guide-wait-dot" aria-hidden />
            {waiting}
          </span>
        ) : null}
      </div>
    </div>,
    document.body,
  );
};
