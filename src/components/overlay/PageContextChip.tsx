import React from 'react';
import { Globe, List, X } from 'lucide-react';
import { useLensTracking } from '../../ui-components/LiquidGlassButton';
import SwapText from '../ui/SwapText';
import '../ui/OverlayBanner.css';
import './PageContextChip.css';

export interface PageContextChipProps {
  /** e.g. "docs.stripe.com · page ready". The part before the first " · " is
   *  set in the stronger weight. Already worded by the caller. */
  label: string;
  /** True when only part of the page could be read. */
  partial: boolean;
  /** Native tooltip: the address and size, or what is missing. */
  title?: string;
  onPickTab: () => void;
  /** True while the tab picker under the chip is open. */
  pickerOpen?: boolean;
  onDismiss: () => void;
  /** Localised labels for the two icon buttons. */
  pickTabLabel: string;
  dismissLabel: string;
}

/**
 * The captured browser page, shown at the top of the overlay until the next
 * answer uses it: a clear Liquid Glass chip (the kit's `clear` variant at
 * `.lg-sm .lg-wide`) with a plain globe in the state's colour, the label, and
 * two plain icon controls. See PageContextChip.css for the design.
 *
 * The chip itself is a `div` wearing the kit's `lg-button` class, as
 * LiquidGlassBadge does: every rule of the material is keyed to that class. It
 * is not a control (the two buttons inside it are), so it gets the pointer
 * lens but no press.
 */
export const PageContextChip: React.FC<PageContextChipProps> = ({
  label,
  partial,
  title,
  onPickTab,
  pickerOpen = false,
  onDismiss,
  pickTabLabel,
  dismissLabel,
}) => {
  const lens = useLensTracking<HTMLDivElement>();
  const cut = label.indexOf(' · ');
  const head = cut === -1 ? label : label.slice(0, cut);
  const rest = cut === -1 ? '' : label.slice(cut);
  return (
    <div className="ov-tone-scope pc-chip-host" data-tone={partial ? 'warning' : 'ok'}>
      <div
        ref={lens.ref}
        onPointerMove={lens.onPointerMove}
        className="lg-button lg-clear lg-sm lg-wide pc-chip"
        title={title}
      >
        <span className="lg-lens" aria-hidden="true" />
        <span className="lg-content">
          <span className="pc-chip-icon" aria-hidden="true">
            <Globe strokeWidth={2} />
          </span>
          <span className="lg-label pc-chip-label">
            {/* A different page captured while the chip is up: the label
                swaps in place instead of jumping. */}
            <SwapText swapKey={label}>
              <span className="pc-chip-head">{head}</span>
              {rest ? <span className="pc-chip-rest">{rest}</span> : null}
            </SwapText>
          </span>
          <span className="pc-chip-sep" aria-hidden="true" />
          <button
            type="button"
            className="pc-chip-btn"
            aria-label={pickTabLabel}
            aria-expanded={pickerOpen}
            onClick={onPickTab}
          >
            <List aria-hidden="true" />
          </button>
          <button type="button" className="pc-chip-btn" aria-label={dismissLabel} onClick={onDismiss}>
            <X aria-hidden="true" />
          </button>
        </span>
      </div>
    </div>
  );
};

export default PageContextChip;
