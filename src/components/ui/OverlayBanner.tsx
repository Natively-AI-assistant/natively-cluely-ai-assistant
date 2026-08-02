import React from 'react';
import { X } from 'lucide-react';

/**
 * OverlayBanner — the single warning-banner surface for the always-on-top
 * overlay window.
 *
 * Extracted because the overlay grew two visually different banners for the
 * same job: the system-audio / permission banner (amber-on-amber, stacked,
 * `px-3.5 py-2.5 rounded-[12px]`, `text-yellow-*` for every layer) and the
 * stealth-Accessibility banner (`px-3 py-2 rounded-xl`, `text-amber-*`
 * surface with `overlay-text-primary` copy). Same semantic (a permission is
 * missing, here is the fix), two paddings, two radii, two type ramps, two
 * colour vocabularies.
 *
 * Design rules encoded here — all three were the "feels cheap" complaint:
 *
 *  1. HIERARCHY, not monochrome. Amber is an accent (icon chip, surface
 *     tint, hairline, primary CTA), NOT the text colour. Title uses
 *     `overlay-text-primary`, body `overlay-text-secondary`. Amber body copy
 *     at 11px was the readability floor of the old design, and it flattened
 *     title/body/actions into one undifferentiated block.
 *  2. ONE primary action. `OverlayBannerButton` has a filled `primary` and a
 *     quiet `secondary`; two same-weight amber buttons told the user nothing
 *     about which to press first.
 *  3. Actions TRAIL the copy on the same row, right-aligned — matching the
 *     sibling `sttNotConfigured` banner's `justify-between` shape — instead
 *     of floating in the banner's lower-left under a full-width paragraph.
 *
 * Overlay-window constraints:
 *  - NO outer drop shadow. The overlay is a transparent, frameless,
 *     exact-content-sized window; outer shadows bleed past the window edge
 *     and get clipped (documented shipped bug). Depth comes from the tint +
 *     hairline border only.
 *  - Compact: this sits directly above the prompt input, so every pixel it
 *     takes is taken from the user's main workflow. Single row wherever the
 *     panel is wide enough, wrapping to two only when it isn't.
 *  - `motion-safe:` guards the only transform, so `prefers-reduced-motion`
 *     users get the colour transition and no scale.
 *
 * i18n: this component renders NO English of its own. Every user-visible
 * string (title, message, button labels, dismiss label) is passed in already
 * wrapped in `t()` by the caller, so the strings stay in the extractable
 * call-site position they're in today.
 */

export type OverlayBannerButtonVariant = 'primary' | 'secondary';

export interface OverlayBannerButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * `primary` = the step the user should take first (open the settings pane
   * that actually fixes the fault). `secondary` = the follow-up (restart).
   * Exactly one primary per banner.
   */
  variant?: OverlayBannerButtonVariant;
}

// 24px minimum hit target (WCAG 2.2 SC 2.5.8) — `min-h-[24px]` rather than
// bigger vertical padding so the banner stays compact.
const BUTTON_BASE =
  'inline-flex items-center justify-center min-h-[24px] px-2.5 py-1 rounded-lg ' +
  'text-[11px] leading-none whitespace-nowrap border transition-colors ' +
  'motion-safe:active:scale-95 ' +
  // Visible focus ring with a real outline (WCAG 2.2 SC 2.4.11). No
  // ring-offset: an offset ring on a transparent overlay draws a halo of the
  // desktop wallpaper behind it.
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/80 ' +
  'disabled:opacity-60 disabled:cursor-not-allowed';

const BUTTON_VARIANTS: Record<OverlayBannerButtonVariant, string> = {
  // Solid amber with near-black text: 8.1:1 contrast, and identical in light
  // and dark because the fill is opaque — it does not composite with the
  // overlay's variable backdrop the way a /15 tint does. This is what makes
  // the primary action separate from the amber surface it sits on; the old
  // `bg-yellow-500/15` button was the same colour family AND the same alpha
  // ballpark as the banner behind it.
  primary:
    'font-semibold bg-amber-500 hover:bg-amber-400 text-black/85 border-amber-600/30',
  // Deliberately colourless: it is the follow-up step, and it reads as an
  // action only because it sits next to the filled one.
  //
  // `.overlay-control-surface` (index.css) rather than
  // `bg-black/[0.04] dark:bg-white/[0.06]`: Tailwind has no `darkMode` key in
  // tailwind.config.js, so `dark:` is MEDIA-based (prefers-color-scheme) while
  // the app's theme is TOKEN-based (`[data-theme='light']`, liquid-glass,
  // modern). A user on a dark OS with the light app theme would get white-alpha
  // chrome on a cream surface — the fill and hairline would vanish and the
  // button would degrade to bare text. The token class carries background,
  // hover background and border-colour, and every var it reads
  // (--overlay-control-bg, --overlay-control-hover-bg, --overlay-border) is
  // defined in all four theme scopes — verified, because an undefined custom
  // property drops the whole declaration silently.
  secondary: 'font-medium overlay-text-primary overlay-control-surface',
};

export const OverlayBannerButton: React.FC<OverlayBannerButtonProps> = ({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${className}`.trim()}
    {...rest}
  />
);

// `title` is the banner HEADING, not the native tooltip attribute — hence the
// Omit. The root div has no tooltip; the clamped body has one (messageTooltip).
export interface OverlayBannerProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Defaults to the warning triangle both banners used. */
  icon?: React.ReactNode;
  /** Short fault name. Already localised by the caller. */
  title: React.ReactNode;
  /** One or two lines of detail. Already localised by the caller. */
  message?: React.ReactNode;
  /** Native tooltip for `message` — the body is clamped to two lines. */
  messageTooltip?: string;
  /** `OverlayBannerButton`s, primary first. */
  actions?: React.ReactNode;
  onDismiss?: () => void;
  /** Localised label used for both `title` and `aria-label` on the ✕. */
  dismissLabel?: string;
  /**
   * Escape hatch for per-call-site attributes on the ✕. The `data-${string}`
   * half is what lets the stealth banner keep stamping
   * `data-stealth-ignore="true"` on every one of its controls.
   */
  dismissButtonProps?: React.ButtonHTMLAttributes<HTMLButtonElement> &
    Partial<Record<`data-${string}`, string>>;
}

const DefaultWarningIcon: React.FC = () => (
  <svg
    className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2.5}
      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
    />
  </svg>
);

export const OverlayBanner: React.FC<OverlayBannerProps> = ({
  icon,
  title,
  message,
  messageTooltip,
  actions,
  onDismiss,
  dismissLabel,
  dismissButtonProps,
  className = '',
  ...rest
}) => (
  <div
    // `flex-wrap` + a real min-width floor on the copy column, NOT
    // `flex-1 min-w-0`. A `min-w-0` copy column next to `shrink-0` buttons is
    // exactly the shape that shipped the vertical-overflow bug: the text
    // shrank to a ~150px ribbon instead of forcing the row to wrap, so
    // `flex-wrap` never fired. With a floor, the actions wrap onto their own
    // (still right-aligned) line the moment the panel can't hold both.
    className={`relative no-drag flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 rounded-xl border border-amber-500/25 bg-amber-500/10 ${className}`.trim()}
    {...rest}
  >
    <div className="flex items-start gap-2 flex-1 min-w-[220px]">
      <span className="shrink-0 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-amber-500/20">
        {icon ?? <DefaultWarningIcon />}
      </span>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[12px] font-semibold leading-tight overlay-text-primary break-words">
          {title}
        </span>
        {message ? (
          // No line-clamp and no scroll region: the message carries the fix
          // (which pane, which toggle, whether a restart is needed), so a
          // truncated one is a broken instruction. The banner grows instead.
          // Scrolling was never an option here anyway — a global
          // `::-webkit-scrollbar { width: 0 }` (src/index.css) makes a scroll
          // region indistinguishable from text that simply stops.
          <p
            className="text-[11px] leading-snug overlay-text-secondary break-words"
            title={messageTooltip}
          >
            {message}
          </p>
        ) : null}
      </div>
    </div>
    {(actions || onDismiss) && (
      <div className="flex items-center gap-1.5 shrink-0 ml-auto">
        {actions}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            // Inline and always visible, not absolutely positioned and
            // hover-revealed: a hover-revealed control is undiscoverable on an
            // overlay the user rarely hovers, and an absolute ✕ collides with
            // the trailing action group.
            // NOTE: no `hover:overlay-text-primary` — `.overlay-text-*` are
            // hand-written classes in index.css, not Tailwind utilities, so a
            // Tailwind variant prefix on them compiles to nothing (silently).
            // The hover affordance is the background wash.
            // `overlay-icon-surface-hover` (a token-driven `:hover` rule in
            // index.css) instead of `hover:bg-black/5 dark:hover:bg-white/10`,
            // for the same reason as the secondary button: `dark:` is
            // media-based here while the app theme is token-based.
            className="inline-flex items-center justify-center h-6 w-6 shrink-0 ml-0.5 rounded-md overlay-text-muted overlay-icon-surface-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/80"
            title={dismissLabel}
            aria-label={dismissLabel}
            {...dismissButtonProps}
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    )}
  </div>
);

export default OverlayBanner;
