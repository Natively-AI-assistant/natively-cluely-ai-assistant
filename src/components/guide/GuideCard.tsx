// First-run guide: the floating card for the launcher and Settings. It sits
// next to the real control (lit with data-guide-lit) and draws nothing while
// that control is not on screen, so it never points at empty space.
//
// Built from Settings' own parts (Evin, 2026-11-15: the dot-and-pill progress
// "looks horrendous"): the card tokens (bg-bg-card, border-border-subtle, the
// text-text-* inks, all theme-aware), Settings' button shape (SETTINGS_BTN_BASE)
// and the "N of 8" count the overlay banner and the notepad pill use. The one
// accent is the guide's soft periwinkle ice.
import React from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { Keycaps, useWelcomeTheme } from '../onboarding/welcomeShared';
import { SETTINGS_BTN_BASE } from '../settings/SettingsRow';
import { useT } from '../../i18n';
import { GUIDE_STEP_COUNT, GUIDE_STEP_NUMBER } from '../../lib/onboarding/firstRunGuide.mjs';
import type { GuideStepId } from '../../lib/onboarding/firstRunGuide.mjs';
import { useAnchorRect, useGuideLit } from './useGuide';
import './guide.css';

export type GuideListRow = [label: string, state: 'done' | 'now' | 'todo', hint?: string];

export interface GuideCardProps {
  /** CSS selector of the real control, e.g. '[data-guide="start"]'. */
  anchor: string;
  place?: 'below' | 'above';
  width?: number;
  dx?: number;
  dy?: number;
  stepId: GuideStepId;
  eyebrow: string;
  title: string;
  body: string;
  list?: GuideListRow[];
  keys?: string[][];
  keyLabels?: string[];
  /** Action steps wait for the real thing and show this instead of a button. */
  waiting?: string;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  /** The step just finished: show it done for a moment. */
  done?: boolean;
  /** Light the anchor (default true). */
  lit?: boolean;
  onSkip?: () => void;
}

/** The guide's one filled button: Settings' button shape in periwinkle ice. */
export const GUIDE_PRIMARY_BTN = `${SETTINGS_BTN_BASE} guide-primary-btn border-transparent`;

const CARD_HEIGHT_GUESS = 190;

export const GuideCard: React.FC<GuideCardProps> = ({
  anchor, place = 'below', width = 320, dx = 0, dy = 0, stepId, eyebrow, title, body, list, keys, keyLabels,
  waiting, action, done, lit = true, onSkip,
}) => {
  const t = useWelcomeTheme();
  const tr = useT();
  const rect = useAnchorRect(anchor);
  useGuideLit(lit && rect ? anchor : null);
  if (!rect) return null;

  const count = tr('{n} of {total}')
    .replace('{n}', String(GUIDE_STEP_NUMBER[stepId]))
    .replace('{total}', String(GUIDE_STEP_COUNT));
  const vw = window.innerWidth;
  let left = rect.left + rect.width / 2 - width / 2 + dx;
  let top = place === 'below' ? rect.bottom + 12 : rect.top - 12 - CARD_HEIGHT_GUESS;
  top += dy;
  left = Math.max(12, Math.min(vw - width - 12, left));
  top = Math.max(12, top);

  // Portalled to <body>: a transformed ancestor (Settings and the launcher
  // animate theirs) would otherwise move a position:fixed card off its anchor.
  return createPortal(
    <div
      className="guide-enter guide-card bg-bg-card border border-border-subtle rounded-2xl p-4 pb-3.5 text-text-primary"
      style={{ position: 'fixed', left, top, width, zIndex: 2147483001, boxSizing: 'border-box' }}
      role="dialog"
      aria-label={title}
      data-guide-card={stepId}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12px] leading-4 font-medium text-text-tertiary truncate">{eyebrow}</span>
        <span className="shrink-0 text-[12px] leading-4 tabular-nums text-text-tertiary" aria-label={count}>{count}</span>
      </div>
      <div className="mt-2 text-[15px] leading-5 font-semibold tracking-[-0.01em]">{title}</div>
      <div className="mt-1 text-[13px] leading-[19px] text-text-secondary">{body}</div>

      {list && (
        <ul className="mt-3 flex flex-col gap-0.5">
          {list.map(([label, st, hint]) => (
            <li
              key={label}
              className={`flex items-center gap-2.5 h-8 px-2 rounded-lg text-[13px] ${st === 'now' ? 'guide-row-now font-medium' : ''} ${st === 'todo' ? 'text-text-secondary' : 'text-text-primary'}`}
            >
              <span aria-hidden className={`guide-tick ${st === 'done' ? 'is-done' : st === 'now' ? 'is-now' : ''}`}>
                {st === 'done' && <Check className="w-2.5 h-2.5" strokeWidth={3.5} />}
              </span>
              <span className="min-w-0 truncate">{label}</span>
              {st === 'done' && <span className="sr-only">{tr('Done')}</span>}
              {hint && (
                <span className={`ml-auto shrink-0 text-[12px] ${st === 'now' ? 'guide-accent-ink' : 'text-text-tertiary'}`}>{hint}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {keys && (
        <div className="mt-3 flex flex-col gap-2">
          {keys.map((k, i) => (
            <div key={i} className="flex items-center justify-between gap-2.5">
              <span className="text-[12px] text-text-secondary">{keyLabels?.[i] ?? ''}</span>
              <Keycaps t={t} keys={k} pressed={done} />
            </div>
          ))}
        </div>
      )}

      <div className="mt-3.5 flex items-center justify-between gap-3 min-h-[30px]">
        {onSkip && !done ? (
          <button type="button" className="guide-skip text-[12px] text-text-tertiary" onClick={onSkip}>{tr('Skip guide')}</button>
        ) : <span />}
        {done ? (
          <span role="status" className="inline-flex items-center gap-1.5 text-[12px] font-medium guide-accent-ink">
            <Check className="w-3.5 h-3.5" strokeWidth={2.6} />{tr('Done')}
          </span>
        ) : action ? (
          <button type="button" className={GUIDE_PRIMARY_BTN} disabled={action.disabled} onClick={action.onClick}>
            {action.label}
          </button>
        ) : waiting ? (
          <span role="status" className="inline-flex items-center gap-2 text-[12px] text-text-secondary">
            <i className="guide-wait-dot" aria-hidden />
            {waiting}
          </span>
        ) : null}
      </div>
    </div>,
    document.body,
  );
};
