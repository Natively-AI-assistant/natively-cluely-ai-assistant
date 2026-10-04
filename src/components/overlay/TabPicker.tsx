import React, { useCallback } from 'react';
import { Check, Globe, X } from 'lucide-react';
import { LiquidGlassButton } from '../../ui-components/LiquidGlassButton';
import SwapText from '../ui/SwapText';
import '../ui/OverlayBanner.css';
import './TabPicker.css';

export interface TabPickerTab {
  id: number;
  title: string;
  url: string;
}

export interface TabPickerProps {
  tabs: TabPickerTab[];
  /** True while the extension is being asked for its open tabs. */
  loading: boolean;
  /** Address of the page the chip above is holding, if any. Its row is marked. */
  currentUrl?: string;
  /** Host shown under each title (the caller's own hostname helper). */
  hostOf: (url?: string) => string | undefined;
  onPick: (tabId: number) => void;
  onClose: () => void;
  /** Ask the extension again (the empty state's button). */
  onRetry: () => void;
  /** Localised strings. */
  labels: {
    title: string;
    loading: string;
    empty: string;
    close: string;
    retry: string;
    current: string;
  };
}

const sameAddress = (a?: string, b?: string): boolean =>
  !!a && !!b && a.split('#')[0] === b.split('#')[0];

const ROW = 'button[data-tp-row]';
/** 6 steps of 40ms: the whole stagger stays under a quarter of a second. */
const STAGGER_CAP = 6;

/**
 * The list of open browser tabs under the captured-page chip: pick one and the
 * extension captures it. See TabPicker.css for the design.
 *
 * The panel never takes focus by itself (the overlay must not pull focus from
 * the meeting). Once focus is inside it, the arrow keys, Home and End move
 * between rows and Escape closes it.
 */
export const TabPicker: React.FC<TabPickerProps> = ({
  tabs,
  loading,
  currentUrl,
  hostOf,
  onPick,
  onClose,
  onRetry,
  labels,
}) => {
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      const step =
        e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : e.key === 'Home' || e.key === 'End' ? 0 : null;
      if (step === null) return;
      const rows = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>(ROW));
      if (rows.length === 0) return;
      const at = rows.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : at === -1 ? 0 : (at + step + rows.length) % rows.length;
      e.preventDefault();
      rows[next].focus();
    },
    [onClose],
  );

  const empty = !loading && tabs.length === 0;

  return (
    // .ov-tone-scope: the banner's tone tokens, for the bead on the captured
    // row and for the clear glass button's dark material on the dark panels.
    <div className="ov-tone-scope tp-panel no-drag" data-tone="ok" onKeyDown={onKeyDown}>
      <div className="tp-head">
        <span className="tp-title">
          <SwapText swapKey={loading ? 'loading' : 'title'}>
            {loading ? (
              <span className="t-shimmer" data-text={labels.loading}>
                {labels.loading}
              </span>
            ) : (
              labels.title
            )}
          </SwapText>
        </span>
        <button
          type="button"
          aria-label={labels.close}
          className="ov-banner-dismiss overlay-icon-surface-hover"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {loading && (
        <div className="tp-list" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="tp-row tp-row--skeleton">
              <span className="tp-row-text">
                <span className="tp-skel tp-skel-title" />
                <span className="tp-skel tp-skel-host" />
              </span>
            </div>
          ))}
        </div>
      )}

      {empty && (
        <div className="tp-empty">
          <span className="lg-button lg-lavender lg-badge ov-banner-mark tp-bead tp-bead--site" aria-hidden="true">
            <span className="lg-content">
              <span className="lg-icon tp-bead-icon">
                <Globe strokeWidth={2.2} />
              </span>
            </span>
          </span>
          <p className="tp-empty-text">{labels.empty}</p>
          <LiquidGlassButton
            type="button"
            variant="clear"
            className="lg-sm lg-wide ov-banner-btn--secondary"
            onClick={onRetry}
          >
            {labels.retry}
          </LiquidGlassButton>
        </div>
      )}

      {!loading && tabs.length > 0 && (
        <div className="tp-list">
          {tabs.map((tab, index) => {
            const host = hostOf(tab.url) || tab.url;
            const current = sameAddress(tab.url, currentUrl);
            return (
              <button
                key={tab.id}
                type="button"
                data-tp-row=""
                className="tp-row"
                // Rows rise in one stagger step apart; capped so the last row
                // of a long list is never late.
                style={{ '--i': Math.min(index, STAGGER_CAP) } as React.CSSProperties}
                aria-current={current ? 'true' : undefined}
                title={tab.url}
                onClick={() => onPick(tab.id)}
              >
                <span className="tp-row-text">
                  <span className="tp-row-title">{tab.title || tab.url}</span>
                  <span className="tp-row-host">{host}</span>
                </span>
                {current && (
                  <span className="tp-row-tag">
                    <Check strokeWidth={2.6} aria-hidden="true" />
                    {labels.current}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
