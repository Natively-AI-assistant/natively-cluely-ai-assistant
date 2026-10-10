import React from 'react';
import { CircleAlert, TriangleAlert, X } from 'lucide-react';
import { LiquidGlassButton } from '../../ui-components/LiquidGlassButton';
import SwapText from './SwapText';
import './OverlayBanner.css';

/**
 * OverlayBanner — the one warning and error banner of the always-on-top
 * overlay window. Four call sites share it: the audio / permission banner, the
 * "Transcription Not Configured" banner, the stealth hotkey conflict and the
 * Accessibility banner. The middle two used to be hand-rolled (orange text on
 * an orange wash; a rose box with a bare "×").
 *
 * The design, in the order the eye takes it:
 *
 *  1. A NEUTRAL BODY, never a tint: the overlay's own raised-field surface,
 *     the one the prompt input below it uses. A 10% amber wash went brown over
 *     the dark panel and beige over the light one. The body is deliberately
 *     NOT glass (owner's pick, over a version on the kit's clear pane): the
 *     glass is kept for the things that carry the tone and the action.
 *  2. TONE IN THE MARK AND THE BUTTON. `error` (something is not working and
 *     will not recover on its own) is red, `warning` (something is degraded,
 *     there is a way round it) is amber: a round mark whose shape changes with
 *     it (circle / triangle), so colour is never the only signal, and the
 *     primary button in the same colour. Both are Liquid Glass.
 *  3. HIERARCHY. Title in the primary text colour, body one step quieter.
 *     Neither is ever amber, orange or red.
 *  4. ONE primary action, the kit's button as a tint of the banner's tone
 *     (amber on a warning, red on an error); its clear variant for the
 *     follow-up. The dismiss ✕ is a plain icon, not glass.
 *  5. Actions TRAIL the copy on the same row, right-aligned, and wrap under
 *     it when the panel is too narrow for both.
 *
 * Overlay-window constraints:
 *  - NO outer drop shadow. The overlay is a transparent, frameless,
 *     exact-content-sized window; outer shadows bleed past the window edge
 *     and get clipped (documented shipped bug).
 *  - NO Tailwind `dark:`. There is no `darkMode` key in tailwind.config.js, so
 *     `dark:` follows the OS (prefers-color-scheme) while the app's theme is
 *     token-based (`[data-theme='light']`, liquid-glass, modern). Every colour
 *     here comes from an overlay token or from the theme-scoped --ovb-* tokens
 *     in OverlayBanner.css.
 *  - Compact: this sits directly above the prompt input, so every pixel it
 *     takes is taken from the user's main workflow.
 *  - The dismiss ✕ is always visible. A hover-revealed control is
 *     undiscoverable on a window the pointer rarely enters.
 *
 * i18n: this component renders NO English of its own. Every user-visible
 * string (title, message, button labels, dismiss label) is passed in already
 * wrapped in `t()` by the caller.
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

// The secondary button OUTSIDE a banner (DirectAssistNotice, inside an answer).
// 24px minimum hit target (WCAG 2.2 SC 2.5.8) — `min-h-[24px]` rather than
// bigger vertical padding so it stays compact.
const SECONDARY_BUTTON =
  'inline-flex items-center justify-center min-h-[24px] px-2.5 py-1 rounded-lg ' +
  'text-[11px] leading-none whitespace-nowrap border transition-colors ' +
  'motion-safe:active:scale-95 ' +
  // No focus ring — app-wide policy, see the *:focus-visible rule in index.css.
  'focus-visible:outline-none ' +
  'disabled:opacity-60 disabled:cursor-not-allowed ' +
  // Deliberately colourless: it is the follow-up step, and it reads as an
  // action only because it sits next to the filled one.
  //
  // `.overlay-control-surface` (index.css) rather than
  // `bg-black/[0.04] dark:bg-white/[0.06]`: `dark:` is media-based here while
  // the app theme is token-based, so a user on a dark OS with the light app
  // theme would get white-alpha chrome on a cream surface. The token class
  // carries background, hover background and border-colour, and every var it
  // reads is defined in all four theme scopes.
  'font-medium overlay-text-primary overlay-control-surface';

// Set by OverlayBanner. A secondary button inside a banner is the kit's clear
// glass button; the same component inside an answer (DirectAssistNotice) keeps
// the flat control it has always drawn there.
const InsideBanner = React.createContext(false);

export const OverlayBannerButton: React.FC<OverlayBannerButtonProps> = ({
  variant = 'secondary',
  className = '',
  type = 'button',
  children,
  ...rest
}) => {
  const insideBanner = React.useContext(InsideBanner);
  if (variant !== 'primary' && insideBanner) {
    return (
      <LiquidGlassButton
        {...rest}
        type={type}
        variant="clear"
        className={`lg-sm lg-wide ov-banner-btn--secondary ${className}`.trim()}
      >
        {children}
      </LiquidGlassButton>
    );
  }
  return variant === 'primary' ? (
    // The shared Liquid Glass button as a translucent tint in the banner's
    // tone (amber on a warning, red on an error), at the banner's scale
    // (.ov-banner-btn--primary in OverlayBanner.css). It replaced a solid
    // amber block that was the loudest thing on the overlay. `lg-wide` for the
    // cap fade in lengths: these labels run from "Rebind" to "Open Screen
    // Settings", and a percentage fade is wrong at one end or the other.
    <LiquidGlassButton
      {...rest}
      type={type}
      variant="lavender"
      className={`lg-sm lg-wide ov-banner-btn--primary ${className}`.trim()}
    >
      {children}
    </LiquidGlassButton>
  ) : (
    <button type={type} className={`${SECONDARY_BUTTON} ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
};

// `title` is the banner HEADING, not the native tooltip attribute — hence the
// Omit. The root div has no tooltip; the clamped body has one (messageTooltip).
export type OverlayBannerTone = 'warning' | 'error' | 'ok';

export interface OverlayBannerProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /**
   * `warning` = degraded, with a way round it (a silent mic, a hotkey another
   * app holds). `error` = not working, and it will not recover on its own (a
   * blocked permission, capture that gave up, no transcription provider).
   * `ok` = good news that still needs saying (the free trial started by
   * itself): green, and the caller brings the icon and no primary action.
   */
  tone?: OverlayBannerTone;
  /** Replaces the tone's own icon (triangle / circle). It takes the tone's
   *  colour, so pass an icon that draws with `currentColor`. */
  icon?: React.ReactNode;
  /** Short fault name. Already localised by the caller. Without one, the
   *  message is the headline. */
  title?: React.ReactNode;
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

export const OverlayBanner: React.FC<OverlayBannerProps> = ({
  tone = 'warning',
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
}) => {
  // The tone this banner arrived in. One that changes while it is up (a
  // warning that becomes an error) sends a ring out from the mark; an arrival
  // does not, it has its own entrance.
  const toneAtMount = React.useRef(tone);
  return (
  <div
    // An error is announced when it appears; a warning waits its turn.
    role={tone === 'error' ? 'alert' : 'status'}
    data-tone={tone}
    // `flex-wrap` + a real min-width floor on the copy column, NOT
    // `flex-1 min-w-0`. A `min-w-0` copy column next to `shrink-0` buttons is
    // exactly the shape that shipped the vertical-overflow bug: the text
    // shrank to a ~150px ribbon instead of forcing the row to wrap, so
    // `flex-wrap` never fired. With a floor, the actions wrap onto their own
    // (still right-aligned) line the moment the panel can't hold both.
    className={`ov-banner no-drag flex flex-wrap items-center gap-x-3 gap-y-2 pl-2.5 pr-2 py-2 ${className}`.trim()}
    {...rest}
  >
    <InsideBanner.Provider value>
    <div className="flex items-center gap-2.5 flex-[1_1_220px] min-w-0 max-w-full">
      {/* The mark is Liquid Glass too: the kit's badge (a static, pointer-
          transparent `lg-button`) as a disc, in the same tinted material as
          the primary button. Kit classes directly, because LiquidGlassBadge
          always renders a text label and this carries only an icon. */}
      {/* The wrapper is what moves (transform only): the disc is glass and
          may not fade. */}
      <span className="ov-banner-pop">
      {tone !== toneAtMount.current && <span className="ov-banner-ping" key={tone} aria-hidden="true" />}
      <span className="lg-button lg-lavender lg-badge ov-banner-mark" aria-hidden="true">
        <span className="lg-content">
          {/* Keyed on the tone: when a banner that is already up turns from
              a warning into an error, the new icon pops in like a first one. */}
          <span className="lg-icon ov-banner-mark-icon" key={tone}>
            {icon ?? (tone === 'error' ? <CircleAlert strokeWidth={2.2} /> : <TriangleAlert strokeWidth={2.2} />)}
          </span>
        </span>
      </span>
      </span>
      <div className="flex flex-col gap-0.5 min-w-0">
        {/* Each line rises in one stagger step after the one above (--i).
            A string that changes while the banner is up swaps in place. */}
        {title ? (
          <span className="ov-banner-title ov-banner-line break-words" style={{ '--i': 0 } as React.CSSProperties}>
            {typeof title === 'string' ? <SwapText overlap swapKey={title}>{title}</SwapText> : title}
          </span>
        ) : null}
        {message ? (
          // No line-clamp and no scroll region: the message carries the fix
          // (which pane, which toggle, whether a restart is needed), so a
          // truncated one is a broken instruction. The banner grows instead.
          // Scrolling was never an option here anyway — a global
          // `::-webkit-scrollbar { width: 0 }` (src/index.css) makes a scroll
          // region indistinguishable from text that simply stops.
          <p
            className={`ov-banner-message ov-banner-line break-words ${title ? '' : 'ov-banner-message--lead'}`.trim()}
            style={{ '--i': title ? 1 : 0 } as React.CSSProperties}
            title={messageTooltip}
          >
            {typeof message === 'string' ? <SwapText overlap swapKey={message}>{message}</SwapText> : message}
          </p>
        ) : null}
      </div>
    </div>
    {(actions || onDismiss) && (
      <div className="ov-banner-actions flex items-center gap-1.5 shrink-0 ml-auto">
        {actions}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            // A plain ✕, by owner request: no glass disc round it. Inline and
            // always visible, not absolutely positioned and hover-revealed: a
            // hover-revealed control is undiscoverable on an overlay the user
            // rarely hovers, and an absolute ✕ collides with the trailing
            // action group. `overlay-icon-surface-hover` is a token-driven
            // `:hover` wash in index.css; a Tailwind `dark:` one would follow
            // the OS theme, not the app's.
            className="ov-banner-dismiss overlay-icon-surface-hover focus-visible:outline-none"
            title={dismissLabel}
            aria-label={dismissLabel}
            {...dismissButtonProps}
          >
            <X className="w-3 h-3" aria-hidden="true" />
          </button>
        )}
      </div>
    )}
    </InsideBanner.Provider>
  </div>
  );
};

export default OverlayBanner;
