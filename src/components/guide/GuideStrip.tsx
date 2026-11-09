// First-run guide: the inline strip for the overlay and the notes window. Those
// windows are sized to their content (the overlay is about 732×205), so a
// floating card does not fit: the strip sits in the window's own layout and the
// window grows to hold it.
import React from 'react';
import { Keycaps, LavenderButton, WELCOME_FONT, useWelcomeTheme } from '../onboarding/welcomeShared';
import { useT } from '../../i18n';
import { GUIDE_STEP_COUNT, GUIDE_STEP_NUMBER } from '../../lib/onboarding/firstRunGuide.mjs';
import type { GuideStepId } from '../../lib/onboarding/firstRunGuide.mjs';
import { useGuideLit } from './useGuide';
import './guide.css';

export const GUIDE_ACCENT = '#7C5CFF';
export const guideAccentText = (dark: boolean) => (dark ? '#B9A6FF' : '#6A4FE0');

export const GuideStatusDot: React.FC<{ dark: boolean; label: string; done?: boolean }> = ({ dark, label, done }) => (
  <span
    role="status"
    style={{
      display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 500,
      color: done ? (dark ? '#8EE3AE' : '#1E8A4C') : guideAccentText(dark),
    }}
  >
    <i style={{ width: 6, height: 6, borderRadius: 3, background: done ? '#2FB866' : GUIDE_ACCENT, boxShadow: done ? undefined : '0 0 0 4px rgba(124,92,255,.18)' }} />
    {label}
  </span>
);

export interface GuideStripProps {
  stepId: GuideStepId;
  eyebrow: string;
  title: string;
  body: string;
  /** One more line under the body, e.g. "Not on a call? …". */
  note?: string;
  keys?: string[][];
  keyLabels?: string[];
  waiting?: string;
  action?: { label: string; onClick: () => void };
  done?: boolean;
  /** CSS selector of a real control in this window to light up. */
  lit?: string | null;
  onSkip?: () => void;
}

export const GuideStrip: React.FC<GuideStripProps> = ({
  stepId, eyebrow, title, body, note, keys, keyLabels, waiting, action, done, lit = null, onSkip,
}) => {
  const t = useWelcomeTheme();
  const tr = useT();
  const dark = t.bg === '#161618';
  useGuideLit(done ? null : lit);
  const step = GUIDE_STEP_NUMBER[stepId];

  return (
    <div
      role="region"
      aria-label={title}
      data-guide-strip={stepId}
      className="guide-enter"
      style={{
        position: 'relative', boxSizing: 'border-box', width: '100%', padding: '12px 14px 12px 16px', borderRadius: 16,
        display: 'flex', alignItems: 'center', gap: 14,
        background: dark ? 'rgba(124,92,255,0.10)' : 'rgba(124,92,255,0.06)',
        boxShadow: `inset 0 0 0 1px ${dark ? 'rgba(185,166,255,0.18)' : 'rgba(124,92,255,0.16)'}`,
        color: t.strong, fontFamily: WELCOME_FONT, WebkitFontSmoothing: 'antialiased',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 600, color: guideAccentText(dark) }}>
          <span>{tr('{n} of {total}').replace('{n}', String(step)).replace('{total}', String(GUIDE_STEP_COUNT))}</span>
          <span style={{ opacity: 0.5 }} aria-hidden>·</span>
          <span>{eyebrow}</span>
        </div>
        <div style={{ marginTop: 4, fontSize: 14.5, fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.25 }}>{title}</div>
        <div style={{ marginTop: 2, fontSize: 12.5, lineHeight: 1.4, color: t.body }}>{body}</div>
        {note && !done && <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.4, color: t.quiet }}>{note}</div>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 7, flex: '0 0 auto' }}>
        {keys?.map((k, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {keyLabels?.[i] && keys.length > 1 && <span style={{ fontSize: 12, color: t.quiet }}>{keyLabels[i]}</span>}
            <Keycaps t={t} keys={k} pressed={done} />
          </div>
        ))}
        {done ? (
          <GuideStatusDot dark={dark} done label={tr('Done')} />
        ) : action ? (
          <LavenderButton t={t} height={30} labelSize={12.5} onClick={action.onClick}>{action.label}</LavenderButton>
        ) : waiting ? (
          <GuideStatusDot dark={dark} label={waiting} />
        ) : null}
        {onSkip && !done && (
          <button type="button" className="guide-skip" style={{ fontSize: 11.5, color: t.faint }} onClick={onSkip}>{tr('Skip guide')}</button>
        )}
      </div>
    </div>
  );
};
