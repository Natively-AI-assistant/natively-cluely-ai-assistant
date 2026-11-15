// First-run guide: the floating card for the launcher and Settings. It sits
// next to the real control (lit with data-guide-lit) and draws nothing while
// that control is not on screen, so it never points at empty space.
import React from 'react';
import { createPortal } from 'react-dom';
import { Keycaps, LavenderButton, WELCOME_FONT, useWelcomeTheme } from '../onboarding/welcomeShared';
import { useT } from '../../i18n';
import { GUIDE_STEP_COUNT, GUIDE_STEP_NUMBER } from '../../lib/onboarding/firstRunGuide.mjs';
import type { GuideStepId } from '../../lib/onboarding/firstRunGuide.mjs';
import { useAnchorRect, useGuideLit } from './useGuide';
import { GUIDE_ACCENT, GuideStatusDot, guideAccentText } from './guideStyle';
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

const CARD_HEIGHT_GUESS = 190;

export const GuideCard: React.FC<GuideCardProps> = ({
  anchor, place = 'below', width = 320, dx = 0, dy = 0, stepId, eyebrow, title, body, list, keys, keyLabels,
  waiting, action, done, lit = true, onSkip,
}) => {
  const t = useWelcomeTheme();
  const tr = useT();
  const dark = t.bg === '#161618';
  const rect = useAnchorRect(anchor);
  useGuideLit(lit && rect ? anchor : null);
  if (!rect) return null;

  const step = GUIDE_STEP_NUMBER[stepId];
  const vw = window.innerWidth;
  let left = rect.left + rect.width / 2 - width / 2 + dx;
  let top = place === 'below' ? rect.bottom + 14 : rect.top - 14 - CARD_HEIGHT_GUESS;
  top += dy;
  left = Math.max(12, Math.min(vw - width - 12, left));
  top = Math.max(12, top);

  const card: React.CSSProperties = {
    position: 'fixed', left, top, width, zIndex: 2147483001, boxSizing: 'border-box',
    padding: '16px 16px 14px', borderRadius: 18,
    background: dark ? 'rgba(22,22,24,0.94)' : 'rgba(255,255,255,0.96)',
    backdropFilter: 'blur(24px) saturate(160%)', WebkitBackdropFilter: 'blur(24px) saturate(160%)',
    boxShadow: dark
      ? 'inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.06), 0 24px 60px -20px rgba(0,0,0,0.75)'
      : 'inset 0 0 0 1px rgba(11,16,32,0.08), 0 24px 60px -24px rgba(40,30,80,0.35)',
    border: '1px solid transparent',
    color: t.strong, fontFamily: WELCOME_FONT, WebkitFontSmoothing: 'antialiased',
  };

  // Portalled to <body>: a transformed ancestor (Settings and the launcher
  // animate theirs) would otherwise move a position:fixed card off its anchor.
  return createPortal(
    <div className="guide-enter" style={card} role="dialog" aria-label={title} data-guide-card={stepId}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.02em', color: guideAccentText(dark) }}>{eyebrow}</span>
        <span
          style={{ display: 'inline-flex', gap: 4 }}
          aria-label={tr('Step {n} of {total}').replace('{n}', String(step)).replace('{total}', String(GUIDE_STEP_COUNT))}
        >
          {Array.from({ length: GUIDE_STEP_COUNT }, (_, i) => (
            <i
              key={i}
              className="guide-dot"
              style={{
                width: i + 1 === step ? 14 : 5, height: 5, borderRadius: 3,
                background: i + 1 <= step ? GUIDE_ACCENT : (dark ? 'rgba(255,255,255,0.14)' : 'rgba(11,16,32,0.12)'),
              }}
            />
          ))}
        </span>
      </div>
      <div style={{ marginTop: 8, fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.25 }}>{title}</div>
      <div style={{ marginTop: 5, fontSize: 13, lineHeight: 1.45, color: t.body }}>{body}</div>

      {list && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {list.map(([label, st, hint]) => (
            <div
              key={label}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, height: 32, padding: '0 10px', borderRadius: 10,
                background: st === 'now' ? (dark ? 'rgba(168,184,255,0.12)' : 'rgba(120,138,240,0.10)') : 'transparent',
                fontSize: 13, fontWeight: st === 'now' ? 600 : 500, color: st === 'todo' ? t.quiet : t.strong,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 16, height: 16, borderRadius: 8, flex: '0 0 16px', display: 'grid', placeItems: 'center', boxSizing: 'border-box',
                  background: st === 'done' ? GUIDE_ACCENT : 'transparent',
                  border: st === 'done' ? 'none' : `1.5px solid ${st === 'now' ? GUIDE_ACCENT : (dark ? 'rgba(255,255,255,0.22)' : 'rgba(11,16,32,0.2)')}`,
                }}
              >
                {st === 'done' && (
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                )}
              </span>
              <span>{label}</span>
              {st === 'done' && <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{tr('Done')}</span>}
              {hint && (
                <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 500, color: st === 'now' ? guideAccentText(dark) : t.faint }}>{hint}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {keys && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {keys.map((k, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontSize: 12.5, color: t.quiet }}>{keyLabels?.[i] ?? ''}</span>
              <Keycaps t={t} keys={k} pressed={done} />
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 32, gap: 12 }}>
        {onSkip && !done ? (
          <button type="button" className="guide-skip" style={{ fontSize: 12, color: t.faint }} onClick={onSkip}>{tr('Skip guide')}</button>
        ) : <span />}
        {done ? (
          <GuideStatusDot dark={dark} done label={tr('Done')} />
        ) : action ? (
          <span style={{ opacity: action.disabled ? 0.45 : 1, pointerEvents: action.disabled ? 'none' : undefined }} aria-disabled={action.disabled || undefined}>
            <LavenderButton t={t} height={32} labelSize={13} onClick={action.onClick}>{action.label}</LavenderButton>
          </span>
        ) : waiting ? (
          <GuideStatusDot dark={dark} label={waiting} />
        ) : null}
      </div>
    </div>,
    document.body,
  );
};
