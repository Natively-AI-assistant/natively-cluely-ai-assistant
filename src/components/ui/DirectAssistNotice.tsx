import React from 'react';
import { CircleAlert, CornerDownRight, TriangleAlert } from 'lucide-react';
import type { DirectAssistNoticeView } from '../../lib/directAssistFailure.mjs';
import { OverlayBannerButton } from './OverlayBanner';
import SwapText from './SwapText';
import './DirectAssistNotice.css';

/**
 * DirectAssistNotice — what the overlay shows when a provider failed on the
 * direct-ask path. One shape for every case (see directAssistNoticeView):
 *
 *     [icon] headline
 *            | the provider's own words
 *          • a provider that failed
 *            | its own words
 *          [ Open AI Providers ]
 *
 * Two weights of the same shape:
 *  - `failed` STANDS IN for the answer, so it is set at reading size with a
 *    red mark. It replaces the "❌ CODE: message" line — an emoji as an icon,
 *    and an internal code as a sentence.
 *  - `answered`, `trying` and `cutoff` are FOOTNOTES to an answer that is
 *    there, so they are small and quiet. They replace a 10px line at 60%
 *    opacity, cut off at 260px behind a help glyph.
 *
 * Overlay-window constraints, same as OverlayBanner:
 *  - NO Tailwind `dark:`. It follows the OS (prefers-color-scheme) while the
 *    app theme is token-based; text uses the `overlay-text-*` tokens and the
 *    two accent colours are picked from `isLightTheme`.
 *  - No outer shadow, no boxed card: the overlay is an exact-content-sized
 *    transparent window, and this sits inside a chat that has no cards.
 *  - No `title=` tooltip: native tooltips are rendered in their own window
 *    here. Nothing is clamped, so nothing needs one.
 *  - Contrast: emphasis comes from size and weight. The quietest text is the
 *    primary token at 76% — measured above 4.5:1 on both themes, which the
 *    muted token is not on the light one.
 *
 * Motion lives in DirectAssistNotice.css (and is described there). Here it is
 * only wiring: each line carries its stagger step, the headline swaps in
 * place, the mark swaps or pops.
 *
 * i18n: renders NO English of its own. The view is already worded and the
 * action label is passed in.
 */

export interface DirectAssistNoticeProps {
  view: DirectAssistNoticeView;
  isLightTheme: boolean;
  /** Localised. Shown only when `view.fixable`. */
  actionLabel: string;
  onAction: () => void;
}

// 40ms a line. Capped so that, however many providers failed, the last line
// starts within 300ms of the first and never feels late.
const MAX_STAGGER_STEPS = 7;
const step = (index: number): React.CSSProperties =>
  ({ '--i': Math.min(index, MAX_STAGGER_STEPS) }) as React.CSSProperties;

/** The provider's own words: set off by a hairline, never in quote marks —
 *  they are cut down in main, so they are not a verbatim quotation. */
const ProviderWords: React.FC<{ children: string; className: string }> = ({ children, className }) => (
  <div
    data-notice-part="detail"
    className={`ov-notice-words mt-1 pl-2 overlay-text-primary opacity-[0.76] break-words ${className}`}
  >
    {children}
  </div>
);

export const DirectAssistNotice: React.FC<DirectAssistNoticeProps> = ({
  view,
  isLightTheme,
  actionLabel,
  onAction,
}) => {
  const failed = view.tone === 'failed';
  const alert = failed || view.tone === 'cutoff';
  const amber = isLightTheme ? 'text-amber-600' : 'text-amber-400';
  const red = isLightTheme ? 'text-red-600' : 'text-red-400';

  // The footnote sizes sit between the chat's 15px body and its 10px labels.
  const headlineSize = failed ? 'text-[14px] leading-[1.4]' : 'text-[11.5px] leading-[1.45]';
  const rowSize = failed ? 'text-[12.5px] leading-[1.45]' : 'text-[11.5px] leading-[1.45]';
  const wordsSize = failed ? 'text-[12px] leading-[1.45]' : 'text-[11px] leading-[1.45]';
  const iconBox = failed ? 'w-[15px] h-[15px] mt-[2.5px]' : 'w-3 h-3 mt-[2.5px]';

  // No action while the next provider is still being tried: that state lasts
  // seconds, and a button appearing and moving under the cursor is worse than
  // one that arrives with the outcome.
  const action = view.fixable && view.tone !== 'trying' ? (
    <OverlayBannerButton onClick={onAction}>{actionLabel}</OverlayBannerButton>
  ) : null;

  // Stagger steps, top to bottom.
  const firstRow = view.detail ? 2 : 1;
  const actionStep = firstRow + view.rows.length;

  // A row is identified by what it says, not where it sits: a cut-off answer
  // puts a new row ABOVE the earlier ones, and that new row is the one that
  // should enter. Two rows with the same sentence get a counter.
  const seen = new Map<string, number>();
  const rowKeys = view.rows.map((row) => {
    const count = seen.get(row.text) ?? 0;
    seen.set(row.text, count + 1);
    return count ? `${row.text}#${count}` : row.text;
  });

  return (
    <div
      // The failure IS the message, so it is announced; a footnote to an
      // answer that arrived is not worth interrupting for.
      role={failed || view.tone === 'cutoff' ? 'alert' : 'status'}
      data-direct-assist-notice={view.tone}
      className={`ov-notice flex items-start gap-2 max-w-[440px] ${failed ? '' : 'mt-2'}`}
    >
      {/* The mark. A failure's pops once; a footnote's rises with its
          headline. Under an answer it can change while it is on screen
          ("trying" becomes "cut off"), so those two share a swap slot. */}
      <span
        aria-hidden="true"
        className={`ov-notice-mark flex-shrink-0 ${iconBox} ${alert ? 'ov-notice-mark--pop' : 'ov-notice-line'}`}
        style={step(0)}
      >
        {failed ? (
          <CircleAlert className={`w-full h-full ${red}`} strokeWidth={2} />
        ) : (
          <span className="t-icon-swap w-full h-full" data-state={view.tone === 'cutoff' ? 'b' : 'a'}>
            <span className="t-icon" data-icon="a">
              <CornerDownRight className="w-full h-full overlay-text-primary opacity-[0.6]" strokeWidth={2} />
            </span>
            <span className="t-icon" data-icon="b">
              <TriangleAlert className={`w-full h-full ${amber}`} strokeWidth={2} />
            </span>
          </span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div
          data-notice-part="headline"
          className={`ov-notice-line font-medium overlay-text-primary ${headlineSize}`}
          style={step(0)}
        >
          {/* "Trying Google…" becomes "Answered by Google" in place, and while
              it is still trying it carries the same sweep as "Thinking...". */}
          <SwapText swapKey={view.headline}>
            <span className={view.tone === 'trying' ? 'natively-thinking-label' : undefined}>
              {view.headline}
            </span>
          </SwapText>
        </div>
        {view.detail && (
          <div className="ov-notice-line" style={step(1)}>
            <ProviderWords className={wordsSize}>{view.detail}</ProviderWords>
          </div>
        )}

        {view.rows.length > 0 && (
          <ul className={`flex flex-col gap-1.5 ${failed ? 'mt-2' : 'mt-1'}`}>
            {view.rows.map((row, index) => (
              <li key={rowKeys[index]} className="ov-notice-line flex items-start gap-1.5" style={step(firstRow + index)}>
                <span
                  aria-hidden="true"
                  className={`flex-shrink-0 w-1 h-1 rounded-full bg-current ${amber} ${failed ? 'mt-[8px]' : 'mt-[7px]'}`}
                />
                <div className="min-w-0">
                  <div data-notice-part="row" className={`overlay-text-primary opacity-[0.88] ${rowSize}`}>
                    {row.text}
                  </div>
                  {row.detail && <ProviderWords className={wordsSize}>{row.detail}</ProviderWords>}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Last, under the cause it fixes: what happened, why, what to do.
            Trailing it on the headline row was tried and looked unanchored —
            the notice is only as wide as its longest line, so the button
            landed somewhere different every time. */}
        {action && (
          <div className={`ov-notice-line ${failed ? 'mt-2.5' : 'mt-2'}`} style={step(actionStep)}>
            {action}
          </div>
        )}
      </div>
    </div>
  );
};

export default DirectAssistNotice;
