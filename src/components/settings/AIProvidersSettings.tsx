import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { useLanguage, useT } from '../../i18n';
import type { VisionModelState } from '../../types/electron';
import { visionAutoText, visionStatusText, visionAnswerInForce, visionStatesShown, visionNotesKept } from './visionLine';
import { Plus, Trash2, Edit2, AlertCircle, Save, ChevronDown, Check, RefreshCw, ExternalLink, Loader2, LogOut, Cloud, Server, Eye, Info, MessageSquare, Image, ImageOff, FileText, User, Boxes, ClipboardList, Laptop, KeyRound } from 'lucide-react';
import { CODEX_CLI_MODEL, codexCliSelectorId, codexModelOptions, type CodexModelCatalogResult, isModelAllowed, isOptInModelProvider, litellmModelLabel, gatewayModelLabel, ninerouterThinkingOptions, STANDARD_CLOUD_MODELS, prettifyModelId } from '../../utils/modelUtils';
import { validateCurl } from '../../lib/curl-validator';
import { ProviderCard } from './ProviderCard';
import { PICKER_MENU_WIDTH, Presence, SettingsMenu, SettingsMotionReady, SwapLabel, capPickerLabel, useMotionReadyAfter } from './SettingsRow';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToggleInit } from './useToggleInit';
import { motion, useReducedMotion } from 'framer-motion';

// Official provider marks, vendored from @lobehub/icons-static-svg v1.94.0 (MIT).
// See src/assets/provider-logos/README.md for provenance and why these are local
// files rather than a CDN fetch.
//
// Imported with `?raw` and inlined, NOT used as <img src>. Three of the six
// (groq, openai, ollama) are monochrome marks that paint with
// `fill="currentColor"`, and currentColor does not resolve inside an <img> — it
// is a separate document context, so those would render black and disappear
// against the dark theme. Inlining lets them inherit the tile's colour and
// adapt to both themes for free.
// The marks themselves live in ../ui/aiProviderMarks so the overlay's model
// picker can render the same registry without pulling this panel in. Re-exported
// below under their original AIP_* names.
import {
    AI_PROVIDER_BRANDS,
    AI_PROVIDER_MARKS,
    AI_PROVIDER_MARK_IMAGES,
    WHITE_ON_TRANSPARENT_MARKS,
} from '../ui/aiProviderMarks';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { AGENTROUTER_REFERRAL_URL, FLUXION_REFERRAL_URL } from '../../lib/partnerLinks';
import { isKnownFastModel } from '../../lib/fastModelHint.mjs';
import { compareCredentialStores, credentialStoreName, describeResolveFailure, formatSavedAt } from '../../lib/credentialStoresConflict.mjs';
import { LiquidGlassBadge } from '../../ui-components/LiquidGlassBadge';

/* ═══════════════════════════════════════════════════════════════════════════
   AI Providers design system — a locally-scoped token block, PI-style.

   WHAT IS AND IS NOT PANEL-LOCAL (revised — the CONTAINER LAYER now aliases
   the app-wide tokens):

     The CARD is `--bg-item-surface` behind a `--border-subtle` edge, in both
     themes. That is the exact pair every card in this panel carried at
     3e8ea9fa, and it is theme-invariant as an EXPRESSION — the split lives in
     the token (#27272A dark / #EAECEF light; transparent dark / 7% black
     light), so it is declared once and cannot drift per theme.

     A previous pass aliased the card to General's dark container instead
     (`bg-transparent`). That is only survivable on General because every
     General card holds a SINGLE ROW: the row's own content is the object, so
     the container may be notional. These cards are multi-row structured
     objects — header + key field + action row + a nested disclosure — and
     without a fill they degraded into hollow outlines with no surface. The
     card here must be a real surface; General's dark transparency is not a
     portable rule.

     The WELL — the layer BELOW a card — is a black wash rather than a flat
     token, because it has to read as recessed against THREE different parents:
     a card, the page canvas, and (for the cURL examples) another well. A flat
     value can only be correct against one of them; an alpha compounds down the
     stack automatically. See the note above ".aip-well".

     Everything BELOW the container — buttons, inputs, the field shell, chips,
     badges, the switch, text roles — stays `--aip-*`. Those need a translucent
     compositing hairline that no Tailwind pair produces: in dark
     `--border-subtle` is literally `transparent` (src/index.css:84) and the
     only visible border token is `--border-muted` (#333, opaque, far heavier
     than a hairline), so a control built on them is either edgeless or heavy.

   `--border-subtle` is NOT changed globally: dozens of other components were
   built against a transparent value.

   The accent is ALIASED, not re-declared per theme: this panel renders inside
   `[data-settings-theme="periwinkle"]` (SettingsOverlay.tsx) where
   `--accent-primary` already resolves to periwinkle-300 dark / periwinkle-600 light.
   `--text-danger` is reused for the same reason (it is already theme-split
   because one red cannot clear 4.5:1 on both fills).

   Tailwind is still used for LAYOUT only inside `.aip-root`. Colour comes from
   `var(--aip-*)`.

   Motion is CSS-only with ONE exception: the provider tablist's selection pill,
   whose translate is driven by a framer-motion spring so it matches the
   meeting-notes Summary/Transcript/Usage switcher (see the tablist below). It is
   still one transform on one element — framer-motion is the driver, not a new
   layer of layout work, and layout/`layoutId` projection is deliberately avoided
   there for a scroll regression documented at the call site. Everything else
   stays on the compositor, which matters because this renderer also hosts the
   always-on-top overlay and a 3s Ollama poll. framer-motion is already loaded in
   this renderer by the sibling settings panels (Plans, Intelligence, Help, Pro,
   Natively API), so the exception adds no bundle cost that was not already
   being paid.
   ═══════════════════════════════════════════════════════════════════════════ */
/* Exported so other panels can adopt this design language. Every token below is
   scoped to `.aip-root`, and this sheet is mounted by whichever panel renders it
   — Settings mounts one panel at a time, so a consumer on another tab has to
   bring the sheet with it or every .aip-* class silently resolves to nothing.
   Duplicate <style> elements are harmless: identical rules, same cascade. */
/**
 * The container class for a selector on the right of a hero card (Active Model,
 * Background Model, AI Response Language here; Active Embedding Model, Active
 * Reranker and the embedding width picker in Retrieval).
 *
 * It fits its content: the picker grows with its label. Active Model and
 * Background Model fit theirs, never narrower than "Gemini 3.8 Flash"
 * (ModelSelect minLabel); the others cap theirs at PICKER_LABEL_MAX_CHARS.
 * shrink-0 keeps the label whole when the
 * text beside it runs long (Background Model's warning line). The trigger fills
 * this box, since .aip-select-trigger is width:100%.
 */
export const AIP_ACTIVE_SELECT_CONTAINER = 'relative shrink-0';

export const AIP_CSS = `
.aip-root {
    --aip-accent:            var(--accent-primary);
    --aip-on-accent:         var(--on-accent);
    --aip-accent-subtle:     color-mix(in srgb, var(--aip-accent) 8%,  transparent);
    --aip-accent-muted:      color-mix(in srgb, var(--aip-accent) 14%, transparent);
    --aip-accent-border:     color-mix(in srgb, var(--aip-accent) 22%, transparent);
    --aip-accent-ring:       color-mix(in srgb, var(--aip-accent) 12%, transparent);
    /* Stroked X, used as a mask so it can be tinted by whatever colour the rule
       sets. Single-quoted attrs and %23 for '#' keep it legal inside url(). */
    --aip-x-glyph: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M3 3 9 9M9 3 3 9' stroke='%23000' stroke-width='1.7' stroke-linecap='round'/%3E%3C/svg%3E");

    --aip-hero:      #ffffff;
    --aip-primary:   rgba(255,255,255,0.86);
    --aip-secondary: rgba(255,255,255,0.56);
    --aip-tertiary:  rgba(255,255,255,0.34);

    --aip-border:        rgba(255,255,255,0.07);
    --aip-border-strong: rgba(255,255,255,0.12);
    --aip-divider:       rgba(255,255,255,0.05);

    /* Container layer. Both of these are theme-invariant EXPRESSIONS over
       theme-split tokens, so they are declared once here and deliberately NOT
       repeated in the light block — see the block comment above.
       Card fill: #27272A dark / #EAECEF light, i.e. a real surface that carries
       the object, rather than an outline around empty canvas.
       Card edge: transparent dark / rgba(0,0,0,0.07) light. In dark the fill
       alone draws the card — a 9-step lift off the #1E1E21 canvas across a 12px
       radius — and stacking a white hairline on top of that would double-encode
       the same edge and re-introduce the bevel this panel was reskinned to
       lose. In light the canvas is #fafafa and the fill lands 16 steps DOWN
       from it, so the hairline is doing separate work and stays. */
    --aip-card-bg:       var(--bg-item-surface);
    --aip-card-border:   var(--border-subtle);
    /* Declared but not consumed by any rule; kept as a tint (not a flat colour)
       so it stays correct over the fill above. Wiring it up would be a
       behaviour change, not a surface fix. */
    --aip-card-bg-hover: rgba(255,255,255,0.028);
    /* The recessed surface BELOW a card (model well, cURL plaque, tab track).
       A wash, not a flat token: the card is now #27272A, so any flat value that
       reads against the #1E1E21 canvas would collide with the card, and vice
       versa. 22% black composites DOWN whatever it lands on:
         on a card   #27272A -> #1E1E21   (recessed, gentler than the #1A1A1A
                                           this well was at 3e8ea9fa)
         on canvas   #1E1E21 -> #17171A   (keeps ".aip-tablist" readable, which
                                           sits on the canvas, not in a card)
         well-in-well        -> #18181A   (the two cURL plaques inside the
                                           Configuration Guide well) */
    --aip-well-bg:       rgba(0,0,0,0.22);
    /* Translucent on purpose: a code chip must stay lighter than whatever it
       sits on, and it sits on BOTH a card and a well. */
    --aip-code-bg:       rgba(255,255,255,0.04);

    --aip-btn-bg:             rgba(255,255,255,0.06);
    --aip-btn-bg-hover:       rgba(255,255,255,0.10);
    --aip-btn-border:         rgba(255,255,255,0.10);
    --aip-item-hover:         rgba(255,255,255,0.04);
    --aip-item-active:        rgba(255,255,255,0.10);
    --aip-input-bg:           transparent;
    --aip-input-border:       rgba(255,255,255,0.10);
    /* Focused field edge. Was --aip-primary (rgba(255,255,255,0.86)), which
       lands at 11.4:1 on the #27272A card — nearly four times the 3:1 that
       SC 1.4.11 asks of a state indicator, and it read as a hard white
       rectangle around a field you had merely clicked into. 0.36 composites to
       #757577 = 3.24:1, so it still clears the floor with margin while sitting
       in the panel's own grey range instead of shouting over it.
       Progression it has to stay legible against: rest 0.10 -> hover 0.12
       (--aip-border-strong) -> focus 0.36. */
    --aip-input-border-focus: rgba(255,255,255,0.36);
    /* Repointed to the shared Apple-style toggle palette (index.css) so this
       switch matches every other one in the app instead of the panel's own
       neutral-grey range. */
    --aip-switch-off:         var(--toggle-off);
    --aip-pill-bg:            var(--aip-item-active);
    --aip-pill-border:        var(--aip-border-strong);
    --aip-pill-lift:          inset 0 1px 0 rgba(255,255,255,0.06);
    --aip-pill-shadow:        none;

    /* ONE status vocabulary. Nothing else may carry a status colour. */
    --aip-ok:            #22c55e;
    --aip-ok-bg:         rgba(34,197,94,0.14);
    --aip-ok-border:     rgba(34,197,94,0.24);
    --aip-info:          #3b82f6;
    --aip-info-bg:       rgba(59,130,246,0.14);
    --aip-info-border:   rgba(59,130,246,0.24);
    --aip-warn:          #facc15;
    --aip-warn-bg:       rgba(250,204,21,0.12);
    --aip-warn-border:   rgba(250,204,21,0.22);
    --aip-danger:        var(--text-danger);
    --aip-danger-bg:     rgba(239,68,68,0.12);
    --aip-danger-border: rgba(239,68,68,0.24);

    /* Card geometry. Theme-invariant, so declared once here and deliberately NOT
       duplicated into the [data-theme='light'] block. --aip-h-ctl is THE control
       height inside a provider card: field, Save segment, trash, models trigger.
       One height means a row of peers reads as a row, not a staircase.
       --aip-card-pad is 16px, not the old 14px, so a provider card's interior
       gutter is General's row gutter ("px-4"). Every hand-written p-5 (20px) on
       a card in this panel came down to p-4 for the same reason. */
    --aip-card-pad: 14px;
    --aip-h-ctl:    32px;
    --aip-gap-row:   8px;
    --aip-gap-col:  12px;

    --aip-r-xs: 4px;  --aip-r-sm: 6px;  --aip-r-md: 10px;
    --aip-r-lg: 12px; --aip-r-xl: 16px; --aip-r-pill: 9999px;

    --aip-ease-out:    cubic-bezier(0.23, 1, 0.32, 1);
    --aip-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

    --aip-dur-press:  110ms;
    --aip-dur-state:  160ms;
    --aip-dur-travel: 220ms;

    --aip-mono: ui-monospace, SFMono-Regular, Menlo, monospace;

    /* Codex action buttons (transitions.dev 17 Tooltip) — softer muted tones */
    --codex-refresh-hover-color: #82b997;
    --codex-logout-hover-color:  #cc7e7e;
}

.aip-root[data-theme='light'] {
    --aip-hero:      #111827;
    --aip-primary:   #374151;
    --aip-secondary: #6b7280;
    --aip-tertiary:  #8e8e93;

    --aip-border:        rgba(0,0,0,0.08);
    --aip-border-strong: rgba(0,0,0,0.13);
    --aip-divider:       rgba(0,0,0,0.06);

    /* --aip-card-bg and --aip-card-border are NOT redeclared here. Both are
       expressions over tokens that already split by theme, so the single
       declaration in ".aip-root" resolves to #EAECEF behind a rgba(0,0,0,0.07)
       hairline here. Re-stating them would only create somewhere to drift.
       #FFFFFF was considered and rejected: this panel renders on --bg-main
       (#fafafa) inside a --bg-elevated (#FFFFFF) modal frame, so a white card
       separates from its canvas by 5 steps and from the frame by 0 — it would
       be carried entirely by the 7% hairline, which is the same skeleton
       failure the dark side had. #EAECEF separates by 16. */
    /* Unconsumed, as in dark. Held EQUAL to the card fill, which is what it has
       always meant here: cards in this panel have no light hover state. */
    --aip-card-bg-hover: var(--bg-item-surface);
    /* Same wash as dark, same direction, much smaller alpha because light
       surfaces are compressed near white:
         on a card   #EAECEF -> #DCDEE1   (recessed)
         on canvas   #fafafa -> #EBEBEB   (".aip-tablist" track, ~ the #EAECEF
                                           it used to be, so unchanged on sight)
         well-in-well        -> #CFD1D4
       A WHITE wash was tried first, to reproduce the lighter-than-card wells of
       3e8ea9fa (#F9FAFB / #FFFFFF). It fails on the canvas: 70% white over
       #fafafa is #FEFEFE, a 4-step delta, and the tab track disappears. Keeping
       the wash black also preserves the CURRENT polarity — wells recessed, not
       raised — which is the part of this panel the owner asked to keep. */
    --aip-well-bg:       rgba(0,0,0,0.06);
    /* Unchanged. A tint, so it composites correctly at any depth: #DCDEE1 on a
       card, #CFD1D4 inside a well. A flat #f3f4f6 chip would be LIGHTER than
       both surfaces it is meant to be marked against. */
    --aip-code-bg:       rgba(0,0,0,0.06);

    --aip-btn-bg:       rgba(0,0,0,0.04);
    --aip-btn-bg-hover: rgba(0,0,0,0.075);
    --aip-btn-border:   rgba(0,0,0,0.08);
    --aip-item-hover:   rgba(0,0,0,0.03);
    --aip-item-active:  rgba(0,0,0,0.06);
    --aip-input-border: rgba(0,0,0,0.11);
    /* Light needs far more alpha than dark for the same ratio: black over the
       #EAECEF card climbs the luminance curve much more slowly than white over
       #27272A. 0.44 composites to #838486 = 3.16:1. (Was #374151 at 8.7:1.)
       Rest 0.11 -> hover 0.13 -> focus 0.44. */
    --aip-input-border-focus: rgba(0,0,0,0.44);
    --aip-switch-off:   var(--toggle-off);
    --aip-pill-bg:      #ffffff;
    --aip-pill-border:  rgba(0,0,0,0.06);
    --aip-pill-lift:    none;
    --aip-pill-shadow:  0 1px 2px rgba(0,0,0,0.07);

    --aip-ok:            #15803d;
    --aip-ok-bg:         rgba(34,197,94,0.10);
    --aip-ok-border:     rgba(21,128,61,0.20);
    --aip-info:          #1d4ed8;
    --aip-info-bg:       rgba(59,130,246,0.09);
    --aip-info-border:   rgba(29,78,216,0.18);
    /* Was #a16207, which measured 3.8:1 on a warn badge or an inline warning,
       3.9:1 as text on a card and 4.2:1 on the Local Models notice: every amber
       line in the light theme was under the 4.5:1 that 9.5-12px text needs.
       #814809 is the same hue one step darker: 5.6:1 on a badge or an inline
       warning, 5.8:1 as text on a card, 6.2:1 on the Local Models notice, and
       4.7:1 on the darkest surface amber text sits on (a key chip in a well).
       The border follows it. */
    --aip-warn:          #814809;
    --aip-warn-bg:       rgba(250,204,21,0.14);
    --aip-warn-border:   rgba(129,72,9,0.20);
    --aip-danger-bg:     rgba(239,68,68,0.08);
    --aip-danger-border: rgba(185,28,28,0.20);

    --codex-refresh-hover-color: #3b7754;
    --codex-logout-hover-color:  #a54848;
}

/* ── Motion. Two easings: ease-out for everything, spring ONLY for the switch
      thumb. Three durations: press 110 / state 160 / travel 220. ────────── */
@keyframes aip-fade-up  { from { opacity:0; transform:translateY(3px); } to { opacity:1; transform:none; } }
@keyframes aip-spin     { to { transform:rotate(360deg); } }
@keyframes aip-check-in { from { opacity:0; transform:scale(0.6); } to { opacity:1; transform:scale(1); } }
@keyframes aip-shimmer  { 0%,100% { opacity:0.55; } 50% { opacity:1; } }

.aip-panel-fade { animation: aip-fade-up var(--aip-dur-state) var(--aip-ease-out) backwards; }
.aip-spinner    { animation: aip-spin 0.65s linear infinite; }
.aip-check      { animation: aip-check-in 200ms var(--aip-ease-spring) both; }
.aip-skeleton   { background: var(--aip-btn-bg); border-radius: var(--aip-r-sm);
                  animation: aip-shimmer 1.4s ease-in-out infinite; }

/* ── Success check (transitions.dev #10) for a Test button's "Passed" tick:
      fade + rotate upright + blur-in + Y-bob, while the tick's stroke draws.
      The snippet's 40px bob and 10px blur are tuned for a ~48px icon; this is
      a 12px glyph inside a 32px button, so both are scaled down or it would
      fly out of the button. The wrapper mounts with the success render, so the
      keyframes play once per pass — no reflow trick needed. */
.aip-root {
    --check-opacity-dur: 500ms;
    --check-rotate-dur: 500ms;
    --check-rotate-from: 80deg;
    --check-bob-dur: 500ms;
    --check-y-amount: 6px;
    --check-blur-dur: 500ms;
    --check-blur-from: 3px;
    --check-path-dur: 500ms;
    --check-path-delay: 80ms;
    --check-ease-out: cubic-bezier(0.22, 1, 0.36, 1);
    --check-ease-opacity: cubic-bezier(0.22, 1, 0.36, 1);
    --check-ease-rotate: cubic-bezier(0.22, 1, 0.36, 1);
    --check-ease-bob: cubic-bezier(0.34, 1.35, 0.64, 1);
    --check-ease-path: cubic-bezier(0.22, 1, 0.36, 1);
}
.t-success-check {
    display: inline-block;
    transform-origin: center;
    opacity: 0;
    will-change: transform, opacity, filter;
}
.t-success-check svg { display: block; overflow: visible; }
/* 24 = lucide Check's "M20 6 9 17l-5-5" (15.56 + 7.07 = 22.63), rounded up. */
.t-success-check svg path {
    stroke-dasharray: 24;
    stroke-dashoffset: 24;
}
.t-success-check[data-state="in"] {
    animation:
        t-check-fade   var(--check-opacity-dur) var(--check-ease-opacity) forwards,
        t-check-rotate var(--check-rotate-dur)  var(--check-ease-rotate)  forwards,
        t-check-blur   var(--check-blur-dur)    var(--check-ease-out)     forwards,
        t-check-bob    var(--check-bob-dur)     var(--check-ease-bob)     forwards;
}
.t-success-check[data-state="in"] svg path {
    animation: t-check-draw var(--check-path-dur) var(--check-ease-path) var(--check-path-delay, 0ms) forwards;
}
@keyframes t-check-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes t-check-rotate {
    from { transform: rotate(var(--check-rotate-from)); }
    to   { transform: rotate(0deg); }
}
@keyframes t-check-blur {
    from { filter: blur(var(--check-blur-from)); }
    to   { filter: blur(0); }
}
@keyframes t-check-bob {
    from { translate: 0 var(--check-y-amount); }
    to   { translate: 0 0; }
}
@keyframes t-check-draw { to { stroke-dashoffset: 0; } }

/* ── Dismissal. A one-shot card that disappears on click, without the rest of
      the panel snapping up into the hole it left.

      grid-template-rows 1fr -> 0fr is the only way to transition to a content
      height CSS never had to compute — "height: auto" is not an animatable
      value, and a hardcoded max-height would be either a clip or a stall
      depending on how a translation wrapped. The child needs min-height:0 (grid
      items floor at min-content otherwise, and nothing moves) and
      overflow:hidden (so the content is clipped by the shrinking track rather
      than spilling past it).

      The grid ITEM must be a bare div — no padding, no border. min-height:0
      lets its CONTENT reach zero, but its own padding and border box cannot
      shrink, so putting the card (p-5, 1px border) directly in the track floors
      the collapse at 42px. Measured, not assumed: the first version of this
      stopped dead at exactly 20+20+2.

      The card's LEADING gap rides inside the track too, as padding on a child
      of that bare item, rather than as the space-y margin it would otherwise
      inherit — a margin outside the track survives the collapse and lands as a
      20px jump at unmount. The TRAILING gap is left to the next sibling's
      space-y margin, which is exactly the gap that should remain once this card
      is gone.

      One duration for both properties, ease-out, 160ms — an exit is the system
      responding, not the user deciding, so it is the panel's fast state
      duration rather than its travel duration. The reduced-motion block above
      already squashes this to 0.01ms; the caller drops its unmount timer to
      match, so the card leaves at once rather than sitting invisible. */
.aip-dismissable { display:grid; grid-template-rows:1fr;
                   transition: grid-template-rows var(--aip-dur-state) var(--aip-ease-out),
                               opacity var(--aip-dur-state) var(--aip-ease-out); }
.aip-dismissable > * { min-height:0; overflow:hidden; }
.aip-dismissable[data-leaving='true'] { grid-template-rows:0fr; opacity:0; }

/* ── Surfaces. The container is rounded-xl + --bg-item-surface +
      --border-subtle, which is the pair every card in this panel carried at
      3e8ea9fa, restored verbatim.

      It is NOT General's dark container. General's is bg-transparent +
      border-transparent, and a pass that copied that here produced hollow
      outlines: General can drop both the fill AND the edge because every one of
      its cards holds a single row, so the row IS the object and the container
      is free to be notional. A provider card is a heading row plus a credential
      row plus an action row plus a nested models disclosure. Four rows with
      nothing behind them do not read as one object — they read as a skeleton,
      and two adjacent skeletons merge into an undifferentiated block. The fill
      is what makes a multi-row card a card; it is not optional here.

      The edge then goes back to --border-subtle, i.e. transparent in dark. With
      the fill restored, a white hairline would encode the same boundary twice
      over a 9-step lift and a 12px radius. In light, --border-subtle is a real
      7% black and does separate work, because the light fill sits BELOW its
      canvas rather than above it. One token, correct in both, by construction.

      Note what General's dark divider really computes to: the
      "divide-border-subtle/20" it asks for emits NO CSS at all (Tailwind 3
      cannot recompute alpha on a bare var() colour — same trap documented at
      src/index.css:63 and tailwind.config.js:23), so its separators fall back
      to preflight's #e5e7eb. Deliberately not reproduced: an authored
      near-white hairline on a #1E1E21 canvas is a bug to inherit, not a
      grammar to match. Dividers here use --aip-divider.

      No box-shadow. General has none in either theme, and the pair this rule
      used to carry never rendered anyway: "box-shadow" is "none | <shadow>#",
      so both "inset 0 1px 0 rgba(...), none" (dark) and "none, 0 1px 1px
      rgba(...)" (light) were invalid declarations and were dropped whole.
      ─────────────────────────────────────────────────────────────────────── */
.aip-card {
    border: 1px solid var(--aip-card-border);
    border-radius: var(--aip-r-lg);
    background: var(--aip-card-bg);
    /* opacity + filter: Fast Response's unavailable dim (opacity-50 grayscale)
       lifts when a Groq key is saved, instead of snapping to full colour. */
    transition: border-color var(--aip-dur-travel) var(--aip-ease-out),
                background   var(--aip-dur-travel) var(--aip-ease-out),
                opacity      var(--aip-dur-travel) var(--aip-ease-out),
                filter       var(--aip-dur-travel) var(--aip-ease-out);
}
/* NOTE: do not re-add a ".aip-card + .aip-card { margin-top }" rule. Every card stack
   in this file also carries a Tailwind "space-y-*", whose
   "> :not([hidden]) ~ :not([hidden])" selector is specificity (0,3,0) — :not() inherits
   its argument's specificity — so it always wins over a (0,2,0) class pair regardless of
   load order. The gap is owned by space-y-*.
   (No backticks in this file's CSS: AIP_CSS is a template literal.) */
/* .aip-card's "border" SHORTHAND also sets border-style, and this sheet loads
   after Tailwind's, so a Tailwind "border-dashed" on the same element would be
   overridden back to solid. Hence an explicit modifier.
   It re-states border-COLOUR too: an empty state IS its border, and dashing a
   6% hairline leaves almost nothing on screen. --aip-border-strong is the value
   ".aip-chip" already uses for its dashed off-state, so this is the existing
   dashed weight rather than a fourth number. */
.aip-card-dashed { border-style: dashed; border-color: var(--aip-border-strong); }

/* ── Divided list. A card whose children are General-style setting rows —
      label + description on the left, one control on the right, separated by a
      hairline instead of by whitespace and boxed once instead of four times.
      Geometry is General's verbatim: px-4 py-3 rows inside a rounded-xl
      container.

      "> * + *" rather than Tailwind's "divide-y divide-*": the colour half of
      that pair is what silently compiles to nothing (see .aip-card above), and
      the width half alone inherits preflight's #e5e7eb. One shorthand here
      sets width, style and colour together and cannot half-apply.

      Declared AFTER .aip-card and at equal specificity (0,1,0), which is what
      lets the border-color override land — every consumer carries BOTH classes.
      ────────────────────────────────────────────────────────────────────── */

.aip-well { background: var(--aip-well-bg); border: 1px solid var(--aip-border);
            border-radius: var(--aip-r-md); overflow: hidden; }
/* Declared AFTER .aip-well on purpose. This stylesheet is injected into the
   body, i.e. later in document order than Tailwind's, so at equal specificity
   .aip-well's "overflow: hidden" shorthand would otherwise beat a Tailwind
   "overflow-y-auto" on the same element and kill the scroll. */
.aip-scroll-y { overflow-y: auto; overflow-x: hidden; }
.aip-scroll-x { overflow-x: auto; overflow-y: hidden; }

/* A floating menu needs the ELEVATED surface, not the recessed one.
   (--aip-well-bg is a black wash, so painting a menu in it would darken it
   into whatever it floats over — a well is the layer BELOW a card and a menu
   floats ABOVE it, so well grey would read as a hole rather than a layer.)
   The spec has no float token because its answer is
   "no floating layers, use .aip-select".
   The two menus still floating here (Active Model, AI Response Language) are
   pre-existing and out of scope for stages 0-2, so they borrow --bg-elevated,
   which is theme-split for exactly this purpose ("Modal outer frame &
   dropdowns", src/index.css:210). */
.aip-float { background: var(--bg-elevated); border: 1px solid var(--aip-border-strong);
             border-radius: var(--aip-r-md); box-shadow: 0 10px 28px rgba(0,0,0,0.30); }

/* Lift the card that currently HOLDS an open menu above its siblings. Once any
   ancestor of the menu is a stacking context, the menu's own z-index stops
   deciding anything — the CARD, at z-index auto, is what gets ordered against
   the cards below it, so the menu paints under them however high it is. That
   ancestor was the settings stagger's animation-fill-mode (fixed at source in
   src/index.css); this rule keeps the layout right for any future one.

   :has() rather than an isOpen prop threaded down to the card: .aip-float
   only exists while a menu is open, so the selector already tracks exactly the
   right state for all five ModelSelect sites plus the language menu.

   position: relative is required (z-index does nothing on a static box) and is
   safe: the only absolutely-positioned things in a card are the menu and
   .aip-switch::after, both of which already have a nearer positioned ancestor. */
.aip-card:has(.aip-float) { position: relative; z-index: 40; }

.aip-root :focus:not(:focus-visible) { outline: none; }

.aip-press, .aip-btn, .aip-chip, .aip-tab {
    transition: background var(--aip-dur-state) var(--aip-ease-out),
                color var(--aip-dur-state) ease,
                border-color var(--aip-dur-state) ease,
                opacity var(--aip-dur-state) var(--aip-ease-out),
                filter var(--aip-dur-state) var(--aip-ease-out),
                transform var(--aip-dur-press) var(--aip-ease-out);
}
.aip-press:active:not(:disabled),
.aip-btn:active:not(:disabled),
.aip-chip:active:not(:disabled),
.aip-tab:active { transform: scale(0.975); }

/* ── Status: ONE primitive. Nothing else may carry a status colour. ────── */
.aip-badge {
    display:inline-flex; align-items:center; gap:4px; height:18px; padding:0 7px;
    border-radius: var(--aip-r-pill); border:1px solid transparent;
    font-size:9.5px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em;
    line-height:1; white-space:nowrap; flex-shrink:0;
    transition: color var(--aip-dur-state) var(--aip-ease-out),
                background var(--aip-dur-state) var(--aip-ease-out),
                border-color var(--aip-dur-state) var(--aip-ease-out);
}
.aip-badge-dot { width:5px; height:5px; border-radius:9999px; background:currentColor; flex-shrink:0; }
/* Label swaps cross-fade through a 3px blur rather than snapping — same
   technique as ProfileIntelligenceSettings' status badge. Capped at 3px. */
.aip-badge-label { transition: opacity var(--aip-dur-state) var(--aip-ease-out),
                               filter var(--aip-dur-state) var(--aip-ease-out); }
.aip-badge[data-fading='true'] .aip-badge-label { opacity:0; filter:blur(3px); }
.aip-badge[data-tone='ok']      { color:var(--aip-ok);        background:var(--aip-ok-bg);     border-color:var(--aip-ok-border); }
.aip-badge[data-tone='info']    { color:var(--aip-info);      background:var(--aip-info-bg);   border-color:var(--aip-info-border); }
.aip-badge[data-tone='warn']    { color:var(--aip-warn);      background:var(--aip-warn-bg);   border-color:var(--aip-warn-border); }
.aip-badge[data-tone='danger']  { color:var(--aip-danger);    background:var(--aip-danger-bg); border-color:var(--aip-danger-border); }
.aip-badge[data-tone='neutral'] { color:var(--aip-secondary); background:var(--aip-btn-bg);    border-color:var(--aip-border); }

/* Inline advisory inside a card. Carries an icon plus a word, never colour alone. */
.aip-inline-warn {
    padding:8px 10px; border-radius: var(--aip-r-md);
    background: var(--aip-warn-bg); border:1px solid var(--aip-warn-border);
    color: var(--aip-warn); font-size:11px; line-height:1.45;
    word-break: break-word;
}

/* ── Switch. 44x20 track (matches the original 20px row height; width grows
      from 34px to 44px — same trade-off as every other size variant, see
      index.css). Geometry values are the reference shape's ratios applied
      to a 20px height, not CSS zoom — zoom doesn't compose reliably with
      backdrop-filter/glass compositing (see index.css's file-level comment
      on the shared .t-toggle rule). Only the background color and
      hit-target stay local here; travel/press/curves are shared. */
.aip-switch::after {
    content:'';
    position:absolute;
    inset:-3px -2px;
}
.aip-switch {
    width: 44px; height: 20px;
    --toggle-inset: 2px; --toggle-thumb-w: 26px; --toggle-thumb-h: 16px;
    --toggle-travel: 14px; --toggle-grow: 2px;
    flex-shrink:0;
    background: var(--aip-switch-off);
    cursor:pointer;
}
/* Repointed to --toggle-on (not --aip-accent) so only the switch changes —
   --aip-accent still drives buttons, links, and chips elsewhere in this panel. */
.aip-switch[aria-checked='true'] { background: var(--toggle-on); }
.aip-switch[aria-disabled='true'] { cursor:not-allowed; }
.aip-switch:disabled { cursor:not-allowed; opacity:0.5; }
/* Thumb dimensions, position, and bounce are owned by .t-toggle-thumb in
   src/index.css. The thumb stays white in both states — this panel used to
   darken it to --aip-on-accent when on; that is deliberately gone. */

/* ── Buttons ───────────────────────────────────────────────────────────── */
.aip-btn {
    display:inline-flex; align-items:center; justify-content:center; gap:6px;
    box-sizing:border-box; height:32px; padding:0 12px; border-radius: var(--aip-r-md);
    border:1px solid var(--aip-btn-border); background: var(--aip-btn-bg);
    color: var(--aip-primary); font-size:12px; font-weight:500; line-height:1;
    white-space:nowrap; cursor:pointer;
}
.aip-btn:hover:not(:disabled) { background: var(--aip-btn-bg-hover); }
.aip-btn:disabled { opacity:0.5; cursor:not-allowed; }
.aip-btn[data-size='sm']   { height:26px; padding:0 9px; font-size:11px; border-radius: var(--aip-r-sm); }
.aip-btn[data-size='row']  { height:34px; }
.aip-btn[data-icon='true'] { width:32px; padding:0; }
.aip-btn[data-variant='accent'] { background: var(--aip-accent-muted); border-color: var(--aip-accent-border); color: var(--aip-accent); }
.aip-btn[data-variant='accent']:hover:not(:disabled) { background: var(--aip-accent-border); }
/* Selected state for a button acting as a choice in a group (the candidate
   counts in Settings > Reranker). React was already setting data-active there
   and NOTHING styled it, so every press persisted the setting and repainted
   identically -- the control looked dead. Scoped to .aip-btn on purpose:
   .aip-card also carries data-active (reranker model rows) and shows selection
   with its own 'In use' badge, which must not gain a second treatment.
   The hover pair is required, not decorative: .aip-btn:hover:not(:disabled) is
   specificity (0,3,0) against this rule's (0,2,0), so without it hovering the
   selected button would drop it back to the unselected background. */
.aip-btn[data-active='true'] { background: var(--aip-accent-muted); border-color: var(--aip-accent-border); color: var(--aip-accent); font-weight:600; }
.aip-btn[data-active='true']:hover:not(:disabled) { background: var(--aip-accent-border); }
.aip-btn[data-variant='ghost']  { background: transparent; border-color: transparent; color: var(--aip-secondary); }
.aip-btn[data-variant='ghost']:hover:not(:disabled) { background: var(--aip-item-hover); color: var(--aip-primary); }
.aip-btn[data-variant='danger-ghost'] { background: transparent; border-color: transparent; color: var(--aip-secondary); }
.aip-btn[data-variant='danger-ghost']:hover:not(:disabled) { background: var(--aip-danger-bg); color: var(--aip-danger); }
.aip-btn[data-tone='ok']     { color:var(--aip-ok);     background:var(--aip-ok-bg);     border-color:var(--aip-ok-border); }
.aip-btn[data-tone='info']   { color:var(--aip-info);   background:var(--aip-info-bg);   border-color:var(--aip-info-border); }
.aip-btn[data-tone='danger'] { color:var(--aip-danger); background:var(--aip-danger-bg); border-color:var(--aip-danger-border); }
.aip-btn[data-tone='ok']:hover:not(:disabled),
.aip-btn[data-tone='info']:hover:not(:disabled),
.aip-btn[data-tone='danger']:hover:not(:disabled) { filter: brightness(1.08); }

/* ── Codex action buttons (transitions.dev 17 Tooltip + custom soft colors) ── */
.aip-btn.aip-codex-action-btn {
    background: transparent !important;
    border-color: transparent !important;
    box-shadow: none !important;
    /* transform: the shared press would otherwise snap (this list replaces it). */
    transition: color 200ms cubic-bezier(0.22, 1, 0.36, 1),
                transform var(--aip-dur-press) var(--aip-ease-out);
}
.aip-btn.aip-codex-action-btn:hover:not(:disabled),
.aip-btn.aip-codex-action-btn:focus-visible:not(:disabled),
.aip-btn.aip-codex-action-btn:active:not(:disabled) {
    background: transparent !important;
    border-color: transparent !important;
    box-shadow: none !important;
}
.t-tt-wrap:hover .aip-codex-refresh-btn:not(:disabled),
.aip-codex-refresh-btn:focus-visible:not(:disabled) {
    color: var(--codex-refresh-hover-color) !important;
}
.t-tt-wrap:hover .aip-codex-logout-btn:not(:disabled),
.aip-codex-logout-btn:focus-visible:not(:disabled) {
    color: var(--codex-logout-hover-color) !important;
}
/* Tooltip below the button with muted, understated styling */
.t-tt-wrap .t-tt {
    top: calc(100% + 5px);
    bottom: auto;
    transform-origin: 50% 0%;
    padding: 3px 7px;
    border-radius: 5px;
    background: var(--tt-bg);
    color: var(--tt-fg);
    font-size: 10.5px;
    font-weight: 450;
    line-height: 1.2;
    letter-spacing: 0.01em;
    border: 1px solid var(--tt-border);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
}

/* ── Chips: DUAL encoding — dashed border off / solid + tinted on — so the
      state survives colour-blindness and greyscale. ───────────────────── */
/* ── Provider card ───────────────────────────────────────────────────────────
   Container query, NOT a viewport breakpoint: the content column is 576px at full
   modal width and 384px at a 768px viewport, so md: fires the wide layout into the
   narrow column. This lives on the card STACK, never on .aip-card — container-type
   establishes containment on the element it is set on, and an element cannot query
   its own container. */
.aip-cq { container-type: inline-size; container-name: aipcards; }

.aip-provider       { padding: var(--aip-card-pad); display:flex; flex-direction:column;
                      gap: var(--aip-gap-row); }
.aip-provider-head  { display:flex; align-items:center; gap:8px; min-height:26px; }
.aip-provider-row   { display:flex; flex-wrap:wrap; align-items:center;
                      column-gap: var(--aip-gap-col); row-gap: var(--aip-gap-row); }
/* flex-basis, not flex-1: both groups need real intrinsic widths so the row wraps on
   its own when narrow, and so the models trigger never crushes its default-model
   label to nothing. */
.aip-provider-field { display:flex; align-items:center; gap:8px; flex:1 1 280px;
                      min-width:0; }
.aip-provider-note  { margin-top: 0; }

/* The credential shell: one 32px box holding glyph + input + Save. overflow:hidden is
   what clips the Save segment's outer corners to the shell radius — which is also why
   focus rings inside it are inset or hoisted onto the shell. */
.aip-field {
    display:flex; align-items:center; box-sizing:border-box;
    flex:1 1 auto; min-width:0; height: var(--aip-h-ctl); overflow:hidden;
    border:1px solid var(--aip-input-border); border-radius: var(--aip-r-md);
    background: var(--aip-input-bg);
    transition: border-color var(--aip-dur-state) var(--aip-ease-out),
                background   var(--aip-dur-state) var(--aip-ease-out);
}
.aip-field:hover:not(:focus-within) { border-color: var(--aip-border-strong); }
/* Neutral focus, no accent. The accent treatment (a 40%-accent border plus a 2px
   solid accent outline) read as an alarm around a field you had merely clicked into
   — and :focus-visible matches pointer focus on text inputs, so it fired on every
   click, not just keyboard nav. A brightened border carries the same information
   without the hue.
   The brightening is now --aip-input-border-focus, not --aip-primary. Reusing the
   TEXT colour for an edge overshot the 3:1 that SC 1.4.11 actually asks for by
   ~3.6x (11.4:1 dark / 8.7:1 light) and drew a hard white rectangle around a field
   you had only clicked into. The token is tuned per theme to sit just above the
   floor — see the ratios at its declaration. */
.aip-field:focus-within { border-color: var(--aip-input-border-focus); }
.aip-field-icon { flex-shrink:0; margin-left:10px; color: var(--aip-tertiary); }
.aip-field > .aip-input {
    height:100%; border:0; border-radius:0; background:transparent;
    padding:0 10px; flex:1 1 auto; min-width:0;
}
/* The input has no ring of its own: the shell's border IS the focus indicator (see
   :focus-within above). Suppressing it here avoids a second, clipped rectangle drawn
   inside the shell's overflow:hidden. */
.aip-root .aip-field > .aip-input:focus-visible { outline:none; }

/* Save, as an inset segment. No transform on :active — a scaling child inside an
   overflow:hidden parent reveals the shell edge. */
.aip-field-seg {
    display:inline-flex; align-items:center; justify-content:center; gap:6px;
    box-sizing:border-box; height:100%; min-width:88px; padding:0 12px; flex-shrink:0;
    border:0; border-left:1px solid var(--aip-input-border); border-radius:0;
    background: var(--aip-btn-bg); color: var(--aip-primary);
    font-family:inherit; font-size:12px; font-weight:500; line-height:1;
    white-space:nowrap; cursor:pointer;
    transition: background var(--aip-dur-state) var(--aip-ease-out),
                color      var(--aip-dur-state) var(--aip-ease-out),
                opacity    var(--aip-dur-state) var(--aip-ease-out);
}
.aip-field-seg:hover:not(:disabled)  { background: var(--aip-btn-bg-hover); }
.aip-field-seg:active:not(:disabled) { background: var(--aip-item-active); }
.aip-field-seg:disabled { opacity:0.5; cursor:not-allowed; }
.aip-field-seg[data-tone='ok'] { color: var(--aip-ok); background: var(--aip-ok-bg); }
/* 0,3,0 to beat ".aip-root :focus-visible" (0,2,0). Precedent: .aip-tab. */
.aip-root .aip-field .aip-field-seg:focus-visible { outline-offset:-2px; }

/* 520 splits the two real widths (576 full, 384 at a 768px viewport). Below it the
   credential group and the models trigger each take a full line: narrow gets taller,
   which is the correct trade. */
@container aipcards (max-width: 519px) {
    .aip-provider-field, .aip-models-summary { flex-basis: 100%; }
}
@container aipcards (min-width: 640px) {
    .aip-provider-field { flex: 2 1 340px; }
}

/* ── Model allow-list. Summary row + in-flow disclosure; see AipModelList. ── */
/* 34px to match .aip-btn[data-size='row'] on either side — the action row is three
   peer controls and they share one height. Uses the existing row token rather than a
   fourth number. No width:100%: it is always a flex child with flex-1, and a fixed
   100% basis fights that. */
/* Thinner than a button, deliberately. It shares a row with the credential field —
   the primary object — and a filled surface made the two compete for the same weight.
   Transparent with a hairline reads as a disclosure; the fill arrives on hover, when
   it is the thing being pointed at. Height is --aip-h-ctl so it sits level with the
   field beside it (it was 34px against a 32px field, a visible 2px staircase). */
.aip-models-summary {
    box-sizing:border-box; display:flex; align-items:center; gap:8px;
    flex: 1 1 240px; min-width:0;
    height: var(--aip-h-ctl); padding:0 10px; border-radius: var(--aip-r-md);
    background: transparent; border:1px solid var(--aip-border);
    color: var(--aip-secondary); cursor:pointer; font-family:inherit; text-align:left;
    transition: background var(--aip-dur-state) var(--aip-ease-out),
                border-color var(--aip-dur-state) var(--aip-ease-out),
                color var(--aip-dur-state) var(--aip-ease-out),
                transform var(--aip-dur-press) var(--aip-ease-out);
}
.aip-models-summary:hover {
    background: var(--aip-item-hover); border-color: var(--aip-border-strong);
    color: var(--aip-primary);
}
/* Open, it is the active object on the row, so it borrows the well's surface to tie
   itself to the panel it just revealed. */
.aip-models-summary[aria-expanded='true'] {
    background: var(--aip-well-bg); border-color: var(--aip-border-strong);
    color: var(--aip-primary);
}
/* max-height, never height: at n=3 the well is short, at n=70 it scrolls. */
.aip-models-well { max-height:216px; padding:4px; }
/* The row is a container, not a button: it holds the membership toggle AND the
   "Set default" action, and a <button> may not contain a <button>. */
.aip-model-row {
    display:flex; align-items:center; gap:6px; width:100%;
    min-height:34px; padding:0 6px 0 8px; border-radius: var(--aip-r-sm);
    transition: background var(--aip-dur-state) var(--aip-ease-out);
}
.aip-model-row:hover { background: var(--aip-item-hover); }
.aip-model-toggle {
    display:flex; align-items:center; gap:8px; flex:1; min-width:0;
    background:transparent; border:0; padding:0; cursor:pointer;
    font-family:inherit; text-align:left; color: var(--aip-secondary);
    transition: color var(--aip-dur-state) var(--aip-ease-out),
                transform var(--aip-dur-press) var(--aip-ease-out);
}
.aip-model-row:hover .aip-model-toggle { color: var(--aip-primary); }
.aip-model-toggle:active { transform: scale(0.975); }
.aip-model-toggle[aria-pressed='true'] { color: var(--aip-primary); }
.aip-model-toggle[aria-disabled='true'] { cursor:default; }
.aip-model-toggle[aria-disabled='true']:active { transform:none; }
.aip-btn-sm { height:22px; padding:0 8px; font-size:10.5px; }
/* Always rendered, never conditionally: a conditional check changes the row's
   intrinsic width and shifts the label as you toggle down a list. */
.aip-model-check {
    color: var(--aip-accent); flex-shrink:0; opacity:0; transform: scale(0.9);
    transition: opacity var(--aip-dur-state) var(--aip-ease-out),
                transform var(--aip-dur-state) var(--aip-ease-out);
}
.aip-model-toggle[aria-pressed='true'] .aip-model-check { opacity:1; transform: scale(1); }
.aip-model-name { font-size:12px; min-width:0; }
/* --aip-secondary, never --aip-tertiary: tertiary is 2.6:1 in dark and is
   reserved for decorative glyphs and disabled states. */
.aip-model-id { font-size:10.5px; color: var(--aip-secondary); margin-left:auto; flex-shrink:0; max-width:52%; }

/* ── "Reads images" per model row. A glyph button that discloses an in-flow
   line under its row — never a menu: the well scrolls, so a floating layer
   would open into clipped space. No status colour: the glyph and its weight
   carry the answer; the accent dot only says "you set this yourself". ── */
.aip-vision-btn {
    position:relative; display:inline-flex; align-items:center; justify-content:center;
    width:22px; height:22px; flex-shrink:0; padding:0; border:0;
    border-radius: var(--aip-r-sm); background:transparent; color: var(--aip-secondary); cursor:pointer;
    transition: background var(--aip-dur-state) var(--aip-ease-out),
                color var(--aip-dur-state) var(--aip-ease-out),
                transform var(--aip-dur-press) var(--aip-ease-out);
}
.aip-vision-btn:hover,
.aip-vision-btn[aria-expanded='true'] { background: var(--aip-item-active); color: var(--aip-primary); }
.aip-vision-btn:active { transform: scale(0.94); }
.aip-vision-btn[data-reads='no'] { color: var(--aip-tertiary); }
.aip-vision-btn[data-reads='unknown'] svg { opacity:0.5; }
/* Always there, so "you set this" arrives and leaves instead of blinking on:
   the same always-rendered tick as .aip-model-check, at the size of a dot. */
.aip-vision-btn::after {
    content:''; position:absolute; top:3px; right:3px; width:4px; height:4px;
    border-radius:9999px; background: var(--aip-accent);
    opacity:0; transform: scale(0.4);
    transition: opacity var(--aip-dur-state) var(--aip-ease-out),
                transform var(--aip-dur-state) var(--aip-ease-out);
}
.aip-vision-btn[data-set='true']::after { opacity:1; transform:none; }
/* The glyph's slot (Presence "icon"): yes, no and the running test cross-fade
   in one 12px box, so the answer changing is seen to change. */
.aip-vision-glyph { width:12px; height:12px; }
/* 27px = the row's 8px inset + the 11px tick + its 8px gap: the line starts
   under the model's NAME, so it reads as belonging to that row.
   6px above and below a 22px control = the 34px of a model row, so the test
   button sits as far from the pill above it as that pill does from the next.
   The 12px row gap keeps that pitch when a long translation wraps the line. */
.aip-vision-detail {
    display:flex; align-items:center; gap:12px 6px; flex-wrap:wrap;
    padding:6px 6px 6px 27px;
}
.aip-vision-label { font-size:11px; color: var(--aip-secondary); margin-right:2px; }
/* Secondary while it is only what Auto WOULD say, or not an answer yet; primary
   once it is the answer in force — the one thing on this line worth reading.
   position:relative is load-bearing: the sentence for screen readers inside it
   is absolutely positioned (.sr-only), and with no positioned box between it and
   the Settings scroller it was laid out against THAT — outside the list's clip,
   at its unscrolled offset. One line open deep in a 300-model list made the
   whole pane 9,000px taller; under reduced motion every row did it at once. */
.aip-vision-status { position:relative; display:flex; align-items:flex-start; justify-content:flex-end;
                     font-size:10.5px; color: var(--aip-secondary); text-align:right;
                     transition: color var(--aip-dur-state) var(--aip-ease-out); }
.aip-vision-status[data-answer='true'] { color: var(--aip-primary); }
/* "Auto would say:" in front of the answer, under the user's own On or Off. It is
   a place too, and it TRADES with the test button's place below: as one closes
   the other opens on the same clock and the same curve, so mid-way the line is
   never wider than at either end. When the two were timed apart (the words
   swapped out over 150ms while the button's place was already opening), a long
   translation overflowed for a moment: the line wrapped to two rows and every
   model row below it jumped down and back. So its two width timings are the
   test place's two, crossed — keep them in step (VisionSettingLine test).
   A column going 0fr to 1fr, not a width: the words are as wide as the language.
   Mid-way the column is narrower than the box (a fraction of a fraction), so it
   is held to the END: the words stay against the answer they introduce. */
.aip-vision-would {
    display:grid; grid-template-columns:0fr; justify-content:end; flex-shrink:0;
    opacity:0; visibility:hidden;
    transition: grid-template-columns var(--aip-dur-travel) var(--aip-ease-out),
                opacity var(--aip-dur-press) var(--aip-ease-out),
                visibility 0s linear var(--aip-dur-travel);
}
.aip-vision-would > span { min-width:0; overflow:hidden; white-space:pre; }
.aip-vision-would[data-open='true'] {
    grid-template-columns:1fr; opacity:1; visibility:inherit;
    transition: grid-template-columns var(--aip-dur-state) var(--aip-ease-out) 50ms,
                opacity var(--aip-dur-state) var(--aip-ease-out) 110ms,
                visibility 0s;
}
/* The result and its test button travel together. When a long translation does
   not fit beside the control, BOTH drop to a second line and stay at the right
   edge — the button alone used to land at the left, under the label. */
.aip-vision-result { display:flex; align-items:center; margin-left:auto; min-width:0; }
/* The test button exists only on Auto. Its place opens and closes — the status
   beside it used to jump a column's width in one frame as you picked On or Off.
   The 6px between the two lives INSIDE the place, so closed it costs nothing.
   Same asymmetry and the same visibility hold as .aip-reveal: opening takes
   --dur-travel with the button following 60ms behind, closing takes --dur-state
   with the button gone first. The close waits 50ms before the place narrows:
   started together, the status slid over a button that was still half there.
   "inherit", never "visible": a closed line is visibility:hidden, and an
   explicit "visible" here would show through it. */
.aip-vision-test {
    display:flex; justify-content:flex-end; flex-shrink:0; overflow:hidden;
    width:0; opacity:0; visibility:hidden; pointer-events:none;
    transition: width var(--aip-dur-state) var(--aip-ease-out) 50ms,
                opacity var(--aip-dur-press) var(--aip-ease-out),
                visibility 0s linear calc(var(--aip-dur-state) + 50ms);
}
.aip-vision-test[data-open='true'] {
    width: calc(var(--aip-col-w, 82px) + 6px); opacity:1; visibility:inherit; pointer-events:auto;
    transition: width var(--aip-dur-travel) var(--aip-ease-out),
                opacity var(--aip-dur-state) var(--aip-ease-out) 60ms,
                visibility 0s;
}
/* Auto / On / Off is ONE choice, so it is one control: the pane's own "pick one"
   idiom (the provider-group track and its raised pill, .aip-tablist), at row
   scale. Three separate chips read as three switches — in this pane a chip is
   a tag you add or remove. The track takes the button fill, not the tablist's
   well wash: this line already sits INSIDE a well, where that wash is invisible,
   and it puts the control on the same surface as "Test again" beside it.
   Each option is as wide as its own label — equal thirds would cost every row
   three times its longest word ("Desactivado") and push the test button onto a
   second line — so the pill is placed by measurement (AipVisionDetail), and
   slides and resizes together. */
.aip-vision-seg {
    position:relative; display:inline-flex; align-items:stretch;
    box-sizing:border-box; height:22px; padding:2px; flex-shrink:0;
    border-radius: var(--aip-r-sm); border:1px solid var(--aip-border);
    background: var(--aip-btn-bg);
}
.aip-vision-seg-pill {
    position:absolute; top:2px; bottom:2px; left:0;
    box-sizing:border-box; border-radius: var(--aip-r-xs); pointer-events:none;
    background: var(--aip-pill-bg); border:1px solid var(--aip-pill-border);
    box-shadow: var(--aip-pill-lift), var(--aip-pill-shadow);
    transition: transform var(--aip-dur-travel) var(--aip-ease-out),
                width var(--aip-dur-travel) var(--aip-ease-out);
}
.aip-vision-seg-opt {
    position:relative; z-index:1; min-width:34px; padding:0 8px; border:0; background:transparent;
    border-radius: var(--aip-r-xs); font-size:10.5px; font-weight:500; line-height:1; white-space:nowrap;
    color: var(--aip-secondary); cursor:pointer;
    transition: color 200ms var(--aip-ease-out), transform var(--aip-dur-press) var(--aip-ease-out);
}
.aip-vision-seg-opt:hover { color: var(--aip-primary); }
.aip-vision-seg-opt:active { transform: scale(0.975); }
.aip-vision-seg-opt[aria-pressed='true'] { color: var(--aip-hero); cursor:default; }
.aip-vision-seg-opt[aria-pressed='true']:active { transform:none; }
/* The glyph takes 28px of the row. The NAME keeps its room; the raw id, which
   never shrank, gives way instead (it is in the row's tooltip in full). */
.aip-model-row--vision .aip-model-id { flex-shrink:1; min-width:64px; }
.aip-model-row--vision .aip-model-name { flex-shrink:0; max-width:68%; }

.aip-chip {
    display:inline-flex; align-items:center; gap:4px; box-sizing:border-box;
    height:22px; padding:0 7px; border-radius: var(--aip-r-sm);
    font-size:10.5px; font-weight:500; line-height:1; white-space:nowrap;
    border:1px dashed var(--aip-border-strong); background:transparent;
    color: var(--aip-secondary); cursor:pointer;
}
.aip-chip:hover { background: var(--aip-item-hover); color: var(--aip-primary); }
.aip-chip[aria-pressed='true'] {
    border-style:solid; border-color: var(--aip-accent-border);
    background: var(--aip-accent-subtle); color: var(--aip-primary);
}
/* Always rendered, so an on-chip is never wider than an off-chip. A width
   change inside flex-wrap can rewrap the row and move every other chip. */
.aip-chip-check { color: var(--aip-accent); flex-shrink:0; opacity:0;
                  transition: opacity var(--aip-dur-state) var(--aip-ease-out); }
.aip-chip[aria-pressed='true'] .aip-chip-check { opacity:1; }

/* ── Reveal. grid-template-rows 0fr→1fr: children NEVER unmount, so a
      half-typed API key and a running 5s auto-save timer both survive a
      collapse. The visibility delay is what keeps collapsed inputs out of
      the tab order. NOT a height animation — this panel lives in an
      overflow-y:auto scroller where those clip and jank. ──────────────── */
/* ASYMMETRIC. Opening is the user's request and gets --dur-travel; closing is the
   system acknowledging and gets --dur-state — the panel should be out of the way
   before you have finished thinking about it. A transition is read from the state
   being transitioned TO, so [data-open='true'] carries the OPEN timing and the base
   rule carries the CLOSE timing.
   This also changes AipSelect's listbox (the other consumer of this class) from a
   220ms to a 160ms collapse — deliberate. The timing has to live on the shared class
   because the visibility delay below must stay pinned to the collapse duration. */
.aip-reveal { display:grid; grid-template-rows:0fr;
              transition: grid-template-rows var(--aip-dur-state) var(--aip-ease-out); }
.aip-reveal[data-open='true'] {
              grid-template-rows:1fr;
              transition: grid-template-rows var(--aip-dur-travel) var(--aip-ease-out); }
/* Tokenised — was a hardcoded 220ms that silently duplicated --aip-dur-travel. This
   delay exists only to hold the tab order open until the box has finished closing,
   so it tracks the COLLAPSE duration and must change with it. */
.aip-reveal > div { overflow:hidden; min-height:0;
                    visibility:hidden; transition: visibility 0s linear var(--aip-dur-state); }
.aip-reveal[data-open='true'] > div { visibility:visible; transition-delay:0s; }

/* A card row that appears once there is something for it to do: the Test + Models
   row a saved key unlocks, and the error note (ProviderCard). The card is a flex
   column, so its row gap moves INSIDE the clip: the margin cancels the gap while
   closed and the content's padding restores it, so a closed row costs 0px and an
   open one exactly the gap it always had. Its content settles like the model list's. */
.aip-reveal--row { margin-top: calc(-1 * var(--aip-gap-row)); }
.aip-reveal--row > div > * { padding-top: var(--aip-gap-row); }
/* Until the panel's stored credentials have loaded, a row that opens is the card
   loading, not news: it lands without a transition (SettingsMotionReady). */
.aip-reveal[data-instant='true'],
.aip-reveal[data-instant='true'] > div,
.aip-reveal[data-instant='true'] > div > * { transition: none !important; }

/* Content motion, scoped to the model list, a card's rows, and the line under a
   model row (--line) — AipSelect's listbox is a menu and keeps the bare clip.
   The transform CANNOT go on ".aip-reveal > div": that element carries the
   overflow:hidden, so transforming it would move the clip box with the content and
   the panel would overlap the trigger. It goes on its single child, inside the clip.
   -4px means the content settles DOWNWARD, travelling with the clip edge rather than
   against it — the panel hangs below the trigger, so it should read as drawn out of it.
   Open: box starts, content follows 60ms later, both land at 220ms — one arrival, not
   two events. Close: content leads and is gone at 110ms, so the descending edge never
   chops through solid rows. */
.aip-reveal--models > div > *,
.aip-reveal--row > div > *,
.aip-reveal--line > div > * {
    opacity:0; transform: translateY(-4px);
    transition: opacity   var(--aip-dur-press) var(--aip-ease-out),
                transform var(--aip-dur-press) var(--aip-ease-out);
}
.aip-reveal--models[data-open='true'] > div > *,
.aip-reveal--row[data-open='true'] > div > *,
.aip-reveal--line[data-open='true'] > div > * {
    opacity:1; transform:none;
    transition: opacity   var(--aip-dur-state) var(--aip-ease-out) 60ms,
                transform var(--aip-dur-state) var(--aip-ease-out) 60ms;
}

/* ── Monogram tile. Not a logo: no provider marks ship in this repo and
      lucide has none, so a two-letter mono monogram on a brand-tinted tile
      is both distinctive and trademark-safe. ──────────────────────────── */

/* Row actions: never opacity:0 — that hides them from keyboard and touch
   entirely. Half-visible at rest, full on hover OR focus-within. */
/* ── The default marker.
      This is not a two-state toggle on one element: it is a single exclusive
      property MOVING between rows. Two rows change at once, arbitrarily far apart,
      and either may be scrolled out of a 216px well.

      So only the ARRIVING badge animates. Three reasons:
        - The row you clicked is the one you are looking at; it is the only place
          feedback is legible.
        - The departing row is frequently off-screen, and animating something
          invisible buys nothing. By the time you scroll to it the animation is
          long over, so it would only ever be seen having already finished.
        - A row quietly GAINING a "Set default" ghost is not something you did.
          Animating it would claim an event that never happened.

      No shared-element "the badge slid across" illusion: that needs FLIP, which
      needs measurement and JS, and the two rows are usually not both on screen —
      it would animate a trip through blank space or off the edge entirely.
      ────────────────────────────────────────────────────────────────────────── */
/* ── The right-hand column of a model list: the default mark, "Set default", and
      the test button on the line under a row. They stack in one column, so they
      are ONE box — same height, same width, same corners, same type. The width is
      that of the widest label in the current language, measured once per list
      (AipModelList) and handed down as --aip-col-w; sized each to its own word,
      the three ended at three different left edges. 82px covers English until
      the measurement lands, and a use outside a list. ── */
.aip-default-slot {
    display:flex; justify-content:flex-end; align-items:center;
    min-width: var(--aip-col-w, 82px);
}
.aip-col-pill { min-width: var(--aip-col-w, 82px); }
/* As a plain block the wrapper set its button on a text baseline: 1.6px below
   the centre of the row, and so below the mark and the test button. */
.aip-default-slot > .aip-row-actions { display:flex; }
/* Never seen: the column's labels at their natural width, for the measurement. */
.aip-col-sizer { height:0; overflow:hidden; visibility:hidden; white-space:nowrap; pointer-events:none; }
/* The default is one model picked out of many, so it wears what "the picked one"
   wears everywhere in this pane: the raised pill of the provider tabs and of
   Auto / On / Off. The box is the small button's own, so it cannot drift from
   "Set default" beside it. No dot: a dot is a status lamp, and this is not a status. */
.aip-default-mark {
    display:inline-flex; align-items:center; justify-content:center; box-sizing:border-box;
    height:22px; padding:0 8px; border-radius: var(--aip-r-md);
    font-size:10.5px; font-weight:500; line-height:1; white-space:nowrap; cursor:default;
    color: var(--aip-hero); background: var(--aip-pill-bg);
    border:1px solid var(--aip-pill-border);
    box-shadow: var(--aip-pill-lift), var(--aip-pill-shadow);
}
/* Lands rather than appears. Scale from 0.94, not from 0 — nothing in the real
   world arrives from nothing — and ease-out rather than the spring, whose
   two-consumer budget is already spent. */
@keyframes aip-default-in { from { opacity:0; transform:scale(0.94); } to { opacity:1; transform:none; } }
.aip-default-mark { animation: aip-default-in var(--aip-dur-state) var(--aip-ease-out) both; }
/* KNOWN LIMITATION: on an IPC failure handleSetDefaultModel rolls the default back,
   which re-mounts the badge on the original row and replays this animation — reading
   as a second user action rather than an undo. Suppressing it would mean threading a
   "this change was a rollback" flag down from the parent. Left as-is because the
   summary row simultaneously shows a danger "Not saved" badge, which is the thing
   that actually explains the reversal. */

.aip-row-actions { opacity: 0.5; transition: opacity var(--aip-dur-state) var(--aip-ease-out); }
.aip-row:hover .aip-row-actions,
.aip-row:focus-within .aip-row-actions { opacity: 1; }

.aip-tile {
    display:inline-flex; align-items:center; justify-content:center; box-sizing:border-box;
    width:26px; height:26px; border-radius:8px; flex-shrink:0;
    font-family: var(--aip-mono); font-size:10.5px; font-weight:600; letter-spacing:0.02em;
    color: var(--aip-brand, var(--aip-accent));
    background: color-mix(in srgb, var(--aip-brand, var(--aip-accent)) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--aip-brand, var(--aip-accent)) 26%, transparent);
}

/* Tile holding an official mark rather than a monogram. The surface goes quiet
   because the logo now carries the brand — keeping the 14%% brand wash behind a
   full-colour mark muddies it. The monochrome marks (groq/openai/ollama) paint
   with currentColor, which resolves to --aip-primary here, so they read as
   foreground in both themes instead of a tinted variant of one. */
.aip-tile--mark {
    color: var(--aip-primary);
    background: var(--aip-btn-bg);
    border-color: var(--aip-border);
}
.aip-tile--mark > svg {
    width:16px; height:16px; display:block;
}

/* ── Inputs. Separate from .aip-well: a well is a container (overflow:hidden,
      container radius); a field needs its own focus grammar. ───────────── */
.aip-input {
    box-sizing:border-box; width:100%; min-width:0; height:32px; padding:0 10px;
    border-radius: var(--aip-r-md); background: var(--aip-input-bg);
    border:1px solid var(--aip-input-border); color: var(--aip-primary);
    font-size:12px;
    transition: border-color var(--aip-dur-state) var(--aip-ease-out),
                background var(--aip-dur-state) var(--aip-ease-out);
}
.aip-input::placeholder { color: var(--aip-tertiary); }
/* Same neutral focus as .aip-field — every input in the panel brightens its border
   rather than taking an accent tint. Accent is reserved for things that are selected
   or active, not for things that merely have the caret. Shares .aip-field's token so
   the two focus treatments cannot drift apart. */
.aip-input:focus { border-color: var(--aip-input-border-focus); }
/* ...and the border must be the ONLY indicator, which means suppressing the panel's
   global ":focus-visible" accent outline here, exactly as ".aip-field > .aip-input"
   already does. Two reasons, both of which this rule was previously only half
   winning — the brightened border was applied but the accent outline still painted
   on top of it:
     CLIPPING. The models filter sits directly inside ".aip-reveal > div", which
     carries overflow:hidden for the collapse animation. An outline at
     "outline-offset: 2px" is drawn 4px OUTSIDE the border box, and the filter is
     flex-1 with its left edge flush to that clip box — so the ring's left arc was
     sliced off square while the right stayed round.
     GRAMMAR. ":focus-visible" matches POINTER focus on text inputs, so a 2px solid
     accent rectangle fired on every click into the field, not on keyboard nav —
     the same "alarm around a field you merely clicked into" the .aip-field comment
     above rejects.
   Keyboard affordance is not lost: --aip-input-border-focus is tuned per theme to
   clear SC 1.4.11's 3:1, which is what the outline was there to guarantee. Nothing
   paints outside the border box now, so no ancestor's overflow can clip it. */
.aip-root .aip-input:focus-visible { outline: none; }

/* Same clip box, the other half of the toolbar. The buttons beside the filter
   (Refresh, Select all, Reset…) sit in the same overflow:hidden row, and the
   last one is flush with its right edge — so the outward outline loses its
   right arc exactly as the input lost its left one.
   Buttons are NOT given the input's treatment: ":focus-visible" does not match
   pointer clicks on a <button>, so here the accent ring is real keyboard
   affordance and removing it would cost a11y for no reason. It is drawn INSIDE
   the border box instead, which is how ".aip-field-seg" and ".aip-tab" already
   solve this — 0,4,0 to beat ".aip-root :focus-visible" (0,2,0).
   Rows inside ".aip-models-well" need no such rule: its padding:4px already
   leaves room for the 2px offset + 2px outline. */
.aip-root .aip-reveal .aip-btn:focus-visible { outline-offset:-2px; }
/* The clear control on the models filter. Chrome's native
   "::-webkit-search-cancel-button" is a fixed raster glyph — a chunky grey
   pill-with-X that ignores colour, sizing and theme, and reads as a much
   heavier control than the hairline field it sits in. Replaced with a plain
   stroked X.
   Drawn as a MASK rather than a background image so the colour comes from
   --aip-danger, which is theme-split; a background SVG would hardcode one red
   and go wrong in the light theme. -webkit-appearance:none is what removes the
   native glyph — without it the mask paints on top of it. */
.aip-input[type='search']::-webkit-search-cancel-button {
    -webkit-appearance: none; appearance: none;
    width:11px; height:11px; cursor:pointer;
    background-color: var(--aip-danger);
    -webkit-mask: var(--aip-x-glyph) center / 11px 11px no-repeat;
            mask: var(--aip-x-glyph) center / 11px 11px no-repeat;
    opacity:0.8; transition: opacity var(--aip-dur-state) var(--aip-ease-out);
}
.aip-input[type='search']::-webkit-search-cancel-button:hover { opacity:1; }
.aip-input[data-mono='true'] { font-family: var(--aip-mono); font-size:11.5px; }
textarea.aip-input { height:auto; padding:10px; line-height:1.5; resize:none; }
select.aip-input { cursor:pointer; }

/* ── In-flow select expander. Portals are banned in this file (the accent
      token scope resolves by DOM ancestry) AND overflow-y:auto computes
      overflow-x:auto, making the settings scroller a clip box on BOTH axes —
      so a floating list opens into clipped space for the lower cards. An
      in-card expander pushes content down instead: nothing to clip, no flip
      logic, no outside-click listener. ────────────────────────────────── */
.aip-select { position:relative; min-width:0; }
.aip-select-trigger {
    display:flex; align-items:center; justify-content:space-between; gap:6px;
    box-sizing:border-box; width:100%; height:32px; padding:0 10px;
    border-radius: var(--aip-r-md); background: var(--aip-btn-bg);
    border:1px solid var(--aip-btn-border); color: var(--aip-primary);
    font-size:12px; line-height:1; text-align:left; cursor:pointer;
    transition: background var(--aip-dur-state) var(--aip-ease-out),
                border-color var(--aip-dur-state) var(--aip-ease-out),
                opacity var(--aip-dur-state) var(--aip-ease-out);
}
.aip-select-trigger:hover { background: var(--aip-btn-bg-hover); }
.aip-select-trigger[aria-disabled='true'] { cursor:default; }
.aip-select-trigger[aria-disabled='true']:hover { background: var(--aip-btn-bg); }
.aip-select-chevron { color: var(--aip-secondary); flex-shrink:0;
                      transition: transform var(--aip-dur-state) var(--aip-ease-out); }
.aip-select-trigger[aria-expanded='true'] .aip-select-chevron { transform: rotate(180deg); }
/* A trigger that fits its label (ModelSelect minLabel). The label slot is given
   the measured width of a hidden copy of the label stacked on the minLabel text in
   one grid cell (.aip-select-fit-measure: never narrower than minLabel in the font
   this platform renders, capped at 15rem, past which the label ellipsizes), and
   eases to it: a resize, so --duration-fast (250ms) on --ease-smooth-out. The
   button is width:auto, so it follows the slot frame by frame. The ease is only
   switched on once the panel is ready (SettingsMotionReady), so the saved pick
   landing from IPC does not grow the picker in on every visit. */
.aip-select-trigger.aip-select-trigger--fit { position:relative; width:auto; }
.aip-select-fit-slot { display:flex; align-items:center; flex:none; min-width:0;
                       box-sizing:border-box; padding-right:8px; }
.aip-select-fit-slot[data-animate='true'] { transition: width 250ms cubic-bezier(0.22, 1, 0.36, 1); }
.aip-select-fit-measure { position:absolute; left:0; top:0; visibility:hidden; pointer-events:none;
                          white-space:nowrap; overflow:hidden; box-sizing:content-box;
                          padding-right:8px; max-width:15rem; display:grid; }
.aip-select-fit-measure > * { grid-area: 1 / 1; justify-self:start; }
/* The models trigger is not an .aip-select-trigger, so it never matched the rule
   above. It was passing an "is-open" class that has no rule anywhere — the chevron
   has never rotated. Use the ARIA state already on the button.
   (No backticks in this CSS: AIP_CSS is a template literal.) */
.aip-models-summary[aria-expanded='true'] .aip-select-chevron { transform: rotate(180deg); }
.aip-select-list { max-height:216px; overflow-y:auto; padding:4px; margin-top:6px; }
.aip-select-option {
    display:flex; align-items:center; justify-content:space-between; gap:8px;
    width:100%; box-sizing:border-box; padding:6px 8px; border-radius: var(--aip-r-sm);
    font-size:12px; color: var(--aip-secondary); background:transparent;
    text-align:left; cursor:pointer;
    transition: background var(--aip-dur-state) var(--aip-ease-out),
                color var(--aip-dur-state) var(--aip-ease-out);
}
.aip-select-option:hover,
.aip-select-option[data-active='true'] { background: var(--aip-item-hover); color: var(--aip-primary); }
.aip-select-option[aria-selected='true'] { background: var(--aip-item-active); color: var(--aip-primary); }
/* A fitted picker's menu rows (ModelSelect minLabel): one line each, left-aligned,
   cut with an ellipsis when too long. Only the picked row gives up room for its
   check, and the 6px gap keeps that at 19px, so a name that fits the trigger fits
   its own row uncut (the trigger's label column is 50px short of the menu, the
   picked row's is 45px short). The check used to take 29px and broke the picked
   name in two. */
.aip-select-option.aip-select-option--fit { gap:6px; }
.aip-select-empty { padding:6px 8px; font-size:12px; color: var(--aip-tertiary); }

/* ── Segmented control. Architecture unchanged — still ONE absolutely-positioned
      pill translated across a fixed-width track, so only "transform" animates and
      the tabs never restyle their own background. What changed is the driver:
      framer-motion springs the translate instead of a fixed-duration CSS ease, so
      the travel matches the meeting-notes Summary/Transcript/Usage switcher and an
      interrupted switch keeps its speed instead of restarting from rest. The pill
      deliberately does NOT unmount per tab — see the tablist JSX for the scroll
      regression that caused.
      The tabs' own colour swap stays in CSS at 200ms, which is MeetingDetails'
      "transition-all duration-200" — so it lands first: measured, the pill needs
      ~250-350ms from click to settle. The label is already the right colour
      under the arriving pill rather than catching up behind it. ────────── */
.aip-tablist { background: var(--aip-well-bg); border:1px solid var(--aip-border); }
.aip-tab-pill { background: var(--aip-pill-bg); border:1px solid var(--aip-pill-border);
                box-shadow: var(--aip-pill-lift), var(--aip-pill-shadow); }
/* No reduced-motion rule of its own: the .aip-root guard below already forces
   transition-duration to 0.01ms !important on every descendant, and a
   non-important shorthand here would lose to it anyway. */
.aip-tab { color: var(--aip-secondary); background:transparent; cursor:pointer;
           transition: color 200ms var(--aip-ease-out),
                       transform var(--aip-dur-press) var(--aip-ease-out); }
/* Inset focus ring. This started as a workaround for the tablist's
   overflow:hidden (which the selection pill's spring overshoot has since forced
   off, see the tablist JSX) and is kept as the deliberate look: the tabs sit
   flush in the well, so an outside ring reads as a halo around the whole track.
   Must be specific enough to beat ".aip-root :focus-visible" (0,2,0) above. */
.aip-root .aip-tab:focus-visible { outline-offset:-2px; }
.aip-tab:hover { color: var(--aip-primary); }
.aip-tab[aria-selected='true'] { color: var(--aip-hero); }

/* ── Text roles. --aip-tertiary is 2.6:1 dark / 3.5:1 light — decorative
      glyphs and disabled states ONLY, never meaning-bearing text. Hints that
      used to be text-text-tertiary are --aip-secondary. ────────────────── */
.aip-hero      { color: var(--aip-hero); }
.aip-text      { color: var(--aip-primary); }
.aip-muted     { color: var(--aip-secondary); }
.aip-faint     { color: var(--aip-tertiary); }
.aip-danger-fg { color: var(--aip-danger); }
.aip-warn-fg   { color: var(--aip-warn); }
.aip-ok-fg     { color: var(--aip-ok); }
.aip-info-fg   { color: var(--aip-info); }
.aip-accent-fg { color: var(--aip-accent); }
/* 18px/700 is General's panel heading ("text-lg font-bold text-text-primary");
   14px/700 is its row title ("text-sm font-bold"). Both were a step down and a
   weight light, which is a second way the panel read as a different product.
   .aip-subtitle is already 12px = General's "text-xs", and --aip-secondary
   already resolves to the same colour as --text-secondary in both themes
   (#6B7280 light; rgba(255,255,255,0.56) over the dark canvas ≈ #A0A0A0), so
   the description role needs no change. */
.aip-title     { font-size:15px; font-weight:600; letter-spacing:-0.012em; color: var(--aip-hero); }
.aip-subtitle  { font-size:12px; font-weight:400; color: var(--aip-secondary); }
.aip-card-title{ font-size:13px; font-weight:600; letter-spacing:-0.008em; color: var(--aip-hero); }
.aip-meta      { font-size:11px; font-weight:400; line-height:1.45; color: var(--aip-secondary); }
.aip-label     { font-size:10px; font-weight:600; text-transform:uppercase;
                 letter-spacing:0.05em; color: var(--aip-secondary); }
.aip-count     { font-size:11px; font-weight:500; font-variant-numeric: tabular-nums;
                 color: var(--aip-secondary); }
.aip-mono      { font-family: var(--aip-mono); font-size:11.5px; font-weight:450; color: var(--aip-primary); }
.aip-code-inline { font-family: var(--aip-mono); font-size:11.5px; padding:1px 5px;
                   border-radius: var(--aip-r-xs); background: var(--aip-code-bg); color: var(--aip-primary); }
.aip-link { color: var(--aip-accent); }
.aip-link:hover { text-decoration: underline; }

/* ── Credential-stores card (two saved key sets). Provider-card anatomy; each
      set is a block in a well with its keys and its own button. ─────────── */
/* The panel's description grey is 3.4:1 on a well and 3.9:1 on a card in the
   light theme. Everything quiet in this card is meant to be read (when a set
   was saved, which keys match), so light gets a darker grey here. Dark already
   clears 5.7:1 and keeps the panel's own. */
.aip-cs { --aip-cs-quiet: var(--aip-secondary); }
.aip-root[data-theme='light'] .aip-cs { --aip-cs-quiet: #555a65; }
.aip-cs .aip-meta { color: var(--aip-cs-quiet); }

.aip-cs-set { display:flex; flex-direction:column; gap: var(--aip-gap-row); padding:12px;
              transition: box-shadow var(--aip-dur-state) var(--aip-ease-out); }
.aip-cs-set + .aip-cs-set { border-top:1px solid var(--aip-divider); }
/* The block whose choice was refused. An inset edge, so nothing moves. */
.aip-cs-set[data-failed='true'] { box-shadow: inset 2px 0 0 var(--aip-danger); }
.aip-cs-set-name { font-size:12px; font-weight:600; letter-spacing:-0.005em; color: var(--aip-hero);
                   overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* While a choice is applying the buttons are aria-disabled, not disabled, so
   the one that was pressed keeps keyboard focus. They take .aip-btn:disabled's
   look, and its hover and press are held off the same way. */
.aip-cs .aip-btn[aria-disabled='true'] { opacity:0.5; cursor:not-allowed; }
.aip-cs .aip-btn[aria-disabled='true']:hover { background: var(--aip-btn-bg); }
.aip-cs .aip-btn[aria-disabled='true']:active { transform:none; }

/* A key: provider name, then its ending. NOT .aip-chip: that one is a toggle
   (dashed off-state, pointer, hover), and these are read, not pressed. */
.aip-cs-keys { display:flex; flex-wrap:wrap; gap:6px; margin:0; padding:0; list-style:none; }
.aip-cs-key {
    display:inline-flex; align-items:center; gap:6px; box-sizing:border-box;
    height:22px; padding:0 7px; border-radius: var(--aip-r-sm);
    border:1px solid var(--aip-border); font-size:10.5px; font-weight:500; line-height:1;
    white-space:nowrap; color: var(--aip-cs-quiet);
}
.aip-cs-key-tail { font-family: var(--aip-mono); font-size:10.5px; font-weight:450; }
/* A key the other set disagrees on: full strength, on the button surface, and
   it says how it differs. The keys both sets agree on stay quiet. */
.aip-cs-key[data-differs='true'] { border-color: var(--aip-border-strong); background: var(--aip-btn-bg); color: var(--aip-hero); }
.aip-cs-key-mark { color: var(--aip-warn); }

/* A refused choice. The words stay at full strength; the icon and the block's
   edge carry the tone. The panel's red is 4.0:1 on a dark card and 4.3:1 on a
   light one, short of what 11px text needs, and this is the one line here that
   has to be read. */
.aip-cs-fail { display:flex; align-items:flex-start; gap:8px; color: var(--aip-danger); }
.aip-cs-fail > svg { margin-top:1.5px; }
.aip-cs-fail-head   { font-size:11.5px; font-weight:500; line-height:1.4; color: var(--aip-hero); }
.aip-cs-fail-detail { font-size:11px; font-weight:400; line-height:1.45; color: var(--aip-cs-quiet); }

@media (prefers-reduced-motion: reduce) {
    .aip-root *, .aip-root *::before, .aip-root *::after {
        animation-duration: 0.01ms !important;
        animation-delay: 0ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        /* Closes the gap that let .aip-reveal keep its full visibility delay after the
           collapse had been squashed to 0.01ms — content stayed visible and tabbable
           after the box was gone. Also load-bearing for two delays a transition-delay
           grep will NOT find, because both sit inside shorthands: the visibility hold,
           and the models content's 60ms lead-in. An !important longhand beats a
           non-important shorthand regardless of specificity, so one line covers all. */
        transition-delay: 0ms !important;
    }
    /* Spinners are EXEMPT — freezing one mid-rotation is worse than motion.
       Rotation is replaced by a pulse rather than removed. */
    .aip-root .aip-spinner { animation: aip-shimmer 1.2s ease-in-out infinite !important; }
    .aip-root .aip-press:active,
    .aip-root .aip-btn:active,
    .aip-root .aip-chip:active,
    .aip-root .aip-tab:active { transform: none; }
    /* Remove the 4px displacement outright rather than trusting a 0.01ms transition
       to land it. Opacity is left alone: it aids comprehension and carries no motion. */
    .aip-root .aip-reveal--models > div > *,
    .aip-root .aip-reveal--row > div > *,
    .aip-root .aip-reveal--line > div > * { transform: none !important; }
    .aip-root .aip-skeleton { animation: none; opacity: 0.55; }
    /* The success check's own guard: show the finished tick outright. */
    .aip-root .t-success-check { animation: none !important; opacity: 1; }
    .aip-root .t-success-check svg path { animation: none !important; stroke-dashoffset: 0 !important; }
}
`;

/* ───────────────────────── Primitives ─────────────────────────────────────
   These live HERE, not in a new file: `SettingsPeriwinklePortalScopeGuard.test.mjs`
   asserts that readdirSync('src/components/settings') filtered to *.tsx EXACTLY
   equals its GUARDED_FILES list, so adding a file to this directory fails the
   suite. `ProviderCard.tsx` imports them from here.

   The resulting import cycle (AIProvidersSettings → ProviderCard → back) is
   safe: every reference is inside a render function, never at module-evaluation
   time, so the live binding is always assigned by the time it is read.
   ───────────────────────────────────────────────────────────────────────── */

export type AipTone = 'ok' | 'info' | 'warn' | 'danger' | 'neutral';

interface AipBadgeProps {
    tone: AipTone;
    label: string;
    /** Swaps the leading dot for a spinner. Use for transient states only. */
    busy?: boolean;
    title?: string;
    className?: string;
}

/**
 * The single status primitive. Nine competing status colours (three greens at
 * three opacities, plus emerald, plus orange AND yellow AND amber for
 * "caution") collapse into one `tone`. Nothing else in this panel may carry a
 * status colour.
 */
export const AipBadge: React.FC<AipBadgeProps> = ({ tone, label, busy = false, title, className = '' }) => {
    // A label swap cross-fades through a 3px blur instead of snapping. The
    // first render after the change paints the NEW label already blurred, then
    // the timeout clears the flag and CSS transitions it in.
    const [fading, setFading] = useState(false);
    const prevLabelRef = useRef<string | undefined>(undefined);
    const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (prevLabelRef.current !== undefined && prevLabelRef.current !== label) {
            setFading(true);
            if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
            fadeTimerRef.current = setTimeout(() => { setFading(false); fadeTimerRef.current = null; }, 170);
        }
        prevLabelRef.current = label;
        return () => { if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current); };
    }, [label]);

    return (
        <span
            className={`aip-badge ${className}`}
            data-tone={tone}
            data-fading={fading ? 'true' : 'false'}
            title={title}
        >
            {busy
                ? <Loader2 size={10} strokeWidth={1.75} className="aip-spinner" aria-hidden="true" />
                : <span className="aip-badge-dot" aria-hidden="true" />}
            <span className="aip-badge-label">{label}</span>
        </span>
    );
};

interface AipSwitchProps {
    checked: boolean;
    onChange: (next: boolean) => void;
    /** Always required — these controls have no visible text. */
    label: string;
    title?: string;
    /**
     * Renders as unavailable and sets `aria-disabled`, but still fires
     * `onChange` so a call site can explain WHY it is unavailable. Pass
     * `hardDisabled` when the control genuinely must not respond.
     */
    disabled?: boolean;
    hardDisabled?: boolean;
    className?: string;
}

/**
 * The shared .t-toggle / .t-toggle-thumb classes (defined in src/index.css)
 * own colors, transitions, and press mechanics — .aip-switch supplies its
 * own 44x20 box size and geometry variables (--toggle-inset/-thumb-w/-h/
 * -travel/-grow), the reference shape's ratios applied to a 20px height,
 * plus the hit-target ::after. --aip-switch-off is repointed to the same
 * shared --toggle-off token, so it no longer diverges from the rest of the
 * app's switches.
 *
 * `is-init`/`arm()` (via useToggleInit) is now inert: the CSS bounce
 * keyframe it used to gate was replaced by a plain transition, which
 * doesn't need arming. Left wired for now rather than ripped out here.
 */
export const AipSwitch: React.FC<AipSwitchProps> = ({
    checked, onChange, label, title, disabled = false, hardDisabled = false, className = '',
}) => {
    const toggleInit = useToggleInit();
    return (
        <button
            type="button"
            role="switch"
            data-on={String(checked)}
            aria-checked={checked}
            aria-disabled={disabled || hardDisabled ? true : undefined}
            aria-label={label}
            title={title}
            disabled={hardDisabled}
            onClick={() => {
                // Soft `disabled` deliberately still fires onChange — call sites
                // rely on it to explain WHY the control is unavailable (see the
                // prop doc above, and Fast Response Mode's alert()). Only arm
                // the bounce, which needs a real state change to animate.
                if (hardDisabled) return;
                if (!disabled) toggleInit.arm();
                onChange(!checked);
            }}
            className={`t-toggle aip-switch ${toggleInit.className} ${className}`}
        >
            <span className="t-toggle-thumb aip-switch-thumb" aria-hidden="true" />
        </button>
    );
};

/** Per-provider brand hues for the monogram tile. */
/**
 * The cloud providers, in render order. One table drives all cards — they
 * were 28 near-identical props copy-pasted five times, so a new prop meant five edits
 * and a missed one was invisible.
 */
export const CLOUD_PROVIDERS = [
    { id: 'gemini'   as const, name: 'Gemini',   placeholder: 'AIzaSy...',  url: 'https://aistudio.google.com/app/apikey' },
    // Also a gateway, but NOT opt-in: 36 models, and its catalogue endpoint is
    // scoped to the key's group. The one provider here with a second required
    // setting — see the protocol selector passed as `extraControls` below.
    // Natively's partner link (sponsor): new sign-ups get $3 in API credit.
    { id: 'fluxion' as const, name: 'Fluxion AI', placeholder: 'sk-...', url: FLUXION_REFERRAL_URL },
    // A gateway like Fluxion: four models, key-scoped catalogue, NOT opt-in.
    // Nothing extra to configure — its protocol is chosen per model. "Get API
    // key" is Natively's own AgentRouter referral link.
    { id: 'agentrouter' as const, name: 'AgentRouter', placeholder: 'sk-...', url: AGENTROUTER_REFERRAL_URL },
    { id: 'groq'     as const, name: 'Groq',     placeholder: 'gsk_...',    url: 'https://console.groq.com/keys' },
    { id: 'openai'   as const, name: 'OpenAI',   placeholder: 'sk-...',     url: 'https://platform.openai.com/api-keys' },
    { id: 'claude'   as const, name: 'Claude',   placeholder: 'sk-ant-...', url: 'https://console.anthropic.com/settings/keys' },
    // Text-only; intentionally NOT part of the screenshot/vision fallback chain.
    { id: 'deepseek' as const, name: 'DeepSeek', placeholder: 'sk-...',     url: 'https://platform.deepseek.com/api_keys' },
    { id: 'nvidia_nim' as const, name: 'Nvidia Nim', placeholder: 'nvapi-...', url: 'https://build.nvidia.com' },
    // A gateway, not a vendor: its model list is opt-in (isOptInModelProvider),
    // and ONE key here also backs OpenRouter embeddings and reranking.
    { id: 'openrouter' as const, name: 'OpenRouter', placeholder: 'sk-or-v1-...', url: 'https://openrouter.ai/keys' },
];
export type CloudProviderId = (typeof CLOUD_PROVIDERS)[number]['id'];

export const AIP_PROVIDER_BRANDS = AI_PROVIDER_BRANDS;

/** A note line that opens and closes in place (.aip-reveal) rather than
    shoving every card below it by a line in one frame. Holds its last text
    while it closes, so the words don't blank out mid-collapse. Lands without a
    transition until the panel's credentials have loaded (SettingsMotionReady),
    since a requirement note resolving then is the panel loading, not news. */
export const AipRevealNote: React.FC<{ text: string; className: string; role?: 'alert' | 'status' }> = ({ text, className, role }) => {
    const ready = React.useContext(SettingsMotionReady);
    const shown = React.useRef(text);
    if (text) shown.current = text;
    return (
        <div className="aip-reveal" data-open={text ? 'true' : 'false'} data-instant={ready ? undefined : 'true'}>
            <div>
                <p className={className} role={role}>{shown.current}</p>
            </div>
        </div>
    );
};

/** A gateway Save button's label: Save / Saving… / Saved swap in place, and the
    button keeps the widest one's width (SwapLabel), so the Test and Remove
    buttons beside it no longer shift as it changes. */
export const AipSaveLabel: React.FC<{ saving: boolean; saved: boolean; dots?: boolean }> = ({ saving, saved, dots }) => {
    const t = useT();
    // Two spellings exist as separate i18n keys; `dots` keeps a caller's own.
    const savingText = dots ? t('Saving...') : t('Saving…');
    return (
        <SwapLabel
            id={saving ? 'saving' : saved ? 'saved' : 'save'}
            sizers={[
                <span className="inline-flex items-center gap-1.5"><span className="w-3" />{savingText}</span>,
                <span className="inline-flex items-center gap-1.5"><span className="w-3" />{t('Saved')}</span>,
                t('Save'),
            ]}
        >
            {saving
                ? <span className="inline-flex items-center gap-1.5"><Loader2 size={12} strokeWidth={1.75} className="aip-spinner" />{savingText}</span>
                : saved
                    ? <span className="inline-flex items-center gap-1.5"><Check size={12} strokeWidth={2} className="aip-check" />{t('Saved')}</span>
                    : t('Save')}
        </SwapLabel>
    );
};

/** A Test Connection label: the four states swap in place, the button keeps
    the widest one's width (SwapLabel), and Passed draws its tick. */
export const AipTestLabel: React.FC<{ status: 'idle' | 'testing' | 'success' | 'error' }> = ({ status }) => {
    const t = useT();
    return (
        <SwapLabel
            id={status}
            sizers={[
                t('Test Connection'),
                <span className="inline-flex items-center gap-1.5"><span className="w-3" />{t('Testing...')}</span>,
                <span className="inline-flex items-center gap-1.5"><span className="w-3" />{t('Passed')}</span>,
                <span className="inline-flex items-center gap-1.5"><span className="w-3" />{t('Error')}</span>,
            ]}
        >
            {status === 'testing' ? <span className="inline-flex items-center gap-1.5"><Loader2 size={12} strokeWidth={1.75} className="aip-spinner" />{t('Testing...')}</span> :
                status === 'success' ? <span className="inline-flex items-center gap-1.5"><AipPassedCheck />{t('Passed')}</span> :
                    status === 'error' ? <span className="inline-flex items-center gap-1.5"><AlertCircle size={12} strokeWidth={1.75} />{t('Error')}</span> :
                        t('Test Connection')}
        </SwapLabel>
    );
};

/** A Test button's "Passed" tick with the success-check animation. Render it
    only in the success branch: each mount is one play. */
export const AipPassedCheck: React.FC = () => (
    <span className="t-success-check" data-state="in" aria-hidden="true">
        <Check size={12} strokeWidth={2} />
    </span>
);

interface AipMonogramProps {
    /** Two letters. Longer strings are clipped to two. */
    mono: string;
    /** Any CSS colour. Defaults to the panel accent (custom providers). */
    brand?: string;
    className?: string;
}

export const AipMonogram: React.FC<AipMonogramProps> = ({ mono, brand, className = '' }) => (
    <span
        className={`aip-tile ${className}`}
        aria-hidden="true"
        style={{ ['--aip-brand' as string]: brand ?? 'var(--aip-accent)' } as React.CSSProperties}
    >
        {mono.slice(0, 2).toUpperCase()}
    </span>
);

/**
 * Provider id → inlined brand mark. Absent keys fall through to
 * AIP_PROVIDER_LOGO_IMAGES, then to the monogram tile. Custom providers are
 * user-defined endpoints with no brand, so they always land on the monogram.
 * `codex` maps to the OpenAI mark because it is the same brand.
 */
/** Raster marks, rendered as <img>. See AIP_PROVIDER_LOGOS for the inlined SVGs. */
export const AIP_PROVIDER_LOGO_IMAGES = AI_PROVIDER_MARK_IMAGES;

export const AIP_PROVIDER_LOGOS = AI_PROVIDER_MARKS;

interface AipProviderMarkProps {
    /** Provider id. Falls back to a monogram when no mark is vendored. */
    provider: string;
    /** Display name — seeds the monogram fallback and the accessible label. */
    name?: string;
    className?: string;
}

/**
 * The provider tile. Renders the official mark where one exists, otherwise the
 * two-letter monogram, so a provider without a licence-clean logo still reads as
 * a deliberate tile rather than a gap.
 *
 * `dangerouslySetInnerHTML` is safe here and is the point of the `?raw` import:
 * the six SVGs are build-time constants vendored from a pinned package and
 * verified to contain only vector paths — no <script>, no <foreignObject>, no
 * external references. Nothing user-supplied ever reaches this.
 */
export const AipProviderMark: React.FC<AipProviderMarkProps> = ({ provider, name, className = '' }) => {
    const key = (provider || '').toLowerCase();
    const markup = AIP_PROVIDER_LOGOS[key];
    const imageSrc = AIP_PROVIDER_LOGO_IMAGES[key];
    const brand = AIP_PROVIDER_BRANDS[key];

    if (!markup && imageSrc) {
        return (
            <span
                className={`aip-tile aip-tile--mark ${className}`}
                aria-hidden="true"
                title={name || provider}
                style={{ ['--aip-brand' as string]: brand?.brand ?? 'var(--aip-accent)' } as React.CSSProperties}
            >
                {/* 20px inside the 26px tile, where the inlined SVG marks get 16
                    (`.aip-tile--mark > svg`). Deliberately different: those are
                    two-colour vector glyphs that stay crisp small, while these are
                    detailed raster artwork — Fluxion's monogram and LiteLLM's
                    favicon — which need the extra pixels to be readable at all.
                    20 leaves 3px of breathing room per side.

                    `.brand-mark-raster` (index.css) flattens a white-on-transparent
                    mark to black in the light theme. Natively's own icon is drawn
                    for the dark theme, so without it the tile reads as empty. It is
                    opt-in (WHITE_ON_TRANSPARENT_MARKS) because on a full-colour
                    mark that filter paints every pixel black. This renderer is
                    shared: the natively mark reaches it from Retrieval's
                    Embeddings/Reranker rows, not from any row in this panel. */}
                <img src={imageSrc} alt="" width={20} height={20}
                    className={`object-contain ${WHITE_ON_TRANSPARENT_MARKS.has(key) ? 'brand-mark-raster' : ''}`} />
            </span>
        );
    }

    if (!markup) {
        return <AipMonogram mono={brand?.mono ?? name ?? provider ?? 'AI'} brand={brand?.brand} className={className} />;
    }

    return (
        <span
            className={`aip-tile aip-tile--mark ${className}`}
            aria-hidden="true"
            title={name || provider}
            style={{ ['--aip-brand' as string]: brand?.brand ?? 'var(--aip-accent)' } as React.CSSProperties}
            dangerouslySetInnerHTML={{ __html: markup }}
        />
    );
};

/* ── "Reads images: Auto / On / Off" per model ─────────────────────────────
   Natively works out by itself whether a model can read a screenshot (the
   provider's own model list, a one-time image test, known model names). This
   is where the user sees that answer and can overrule it, per model AND
   provider. Main owns the answer (vision-capability:* IPC); the renderer sends
   picker ids and shows what comes back. */

type VisionSetting = VisionModelState['setting'];

// The line's wording lives in ./visionLine (pure, so a test can run it).

/**
 * The answers for a set of picker ids, kept current: asked when `active`
 * turns on or the ids change, and again whenever main says an answer changed
 * (a setting saved in another window, a background image test that finished).
 */
export function useVisionStates(ids: readonly string[], active: boolean) {
    const [states, setStates] = useState<Record<string, VisionModelState | null>>({});
    // Ids whose last "Test again" could not finish. Kept here because main's
    // change event re-reads every state, and a re-read knows nothing of it.
    const [inconclusive, setInconclusive] = useState<ReadonlySet<string>>(() => new Set());
    const note = useCallback((id: string, on: boolean) => {
        setInconclusive(prev => { if (prev.has(id) === on) return prev; const next = new Set(prev); if (on) next.add(id); else next.delete(id); return next; });
    }, []);
    const key = ids.join('\n');
    // Only the newest request may write: a slow answer for an old id list must
    // not overwrite a fresh one.
    const seq = useRef(0);
    const refresh = useCallback(async () => {
        const mine = ++seq.current;
        try {
            const result = await window.electronAPI?.getVisionModelStates?.(key ? key.split('\n') : []);
            if (mine === seq.current && result?.states) {
                const fresh = result.states;
                setStates(fresh);
                setInconclusive(prev => visionNotesKept(prev, fresh));
            }
        } catch { /* the rows simply show no control */ }
    }, [key]);
    useEffect(() => {
        if (!active || !key) return;
        void refresh();
        const off = window.electronAPI?.onVisionCapabilityChanged?.(() => { void refresh(); });
        return () => { off?.(); };
    }, [active, key, refresh]);

    const set = useCallback(async (id: string, setting: VisionSetting) => {
        note(id, false);
        // Shown at once; main's answer (which also carries the new "reads") replaces it.
        setStates(prev => prev[id] ? { ...prev, [id]: { ...prev[id]!, setting } } : prev);
        try {
            const result = await window.electronAPI?.setVisionSetting?.(id, setting);
            if (result?.state) setStates(prev => ({ ...prev, [id]: result.state }));
            else void refresh();
        } catch { void refresh(); }
    }, [refresh, note]);
    const retest = useCallback(async (id: string) => {
        note(id, false);
        setStates(prev => prev[id] ? { ...prev, [id]: { ...prev[id]!, checking: true } } : prev);
        try {
            const result = await window.electronAPI?.retestVision?.(id);
            if (result?.state) { setStates(prev => ({ ...prev, [id]: result.state })); note(id, result.state.inconclusive === true); }
            else void refresh();
        } catch { void refresh(); }
    }, [refresh, note]);
    const shown = useMemo(() => visionStatesShown(states, inconclusive), [states, inconclusive]);
    return { states: shown, set, retest };
}

/**
 * Motion for one model row's glyph and line, on from the first time that row's
 * line is opened. A gateway lists hundreds of models, and every motion piece
 * costs a little to mount and again on each re-render: with them on for every
 * row, a 300-model list took half as long again to open. A row nobody has opened
 * has next to nothing to animate — a test is started from its open line — so it
 * draws plain. The pane's own readiness (SettingsMotionReady) still applies.
 */
function useVisionRowMotion(open: boolean): boolean {
    const paneReady = React.useContext(SettingsMotionReady);
    const [opened, setOpened] = useState(open);
    if (open && !opened) setOpened(true);
    return paneReady && opened;
}

/** The glyph at the end of a model row: does it read images, and did the user decide that. */
export const AipVisionButton: React.FC<{
    state: VisionModelState; open: boolean; onClick: () => void; controls: string;
}> = ({ state, open, onClick, controls }) => {
    const t = useT();
    const motionReady = useVisionRowMotion(open);
    const answer = state.reads === 'yes' ? t('Reads images') : state.reads === 'no' ? t('Does not read images') : t('Not known whether it reads images');
    return (
        <button
            type="button"
            className="aip-vision-btn"
            data-reads={state.reads}
            data-set={state.setting !== 'auto' ? 'true' : 'false'}
            aria-expanded={open}
            aria-controls={controls}
            aria-label={answer}
            title={state.setting !== 'auto' ? `${answer} · ${t('set by you')}` : answer}
            onClick={onClick}
        >
            <Presence kind="icon" id={state.checking ? 'checking' : state.reads === 'no' ? 'no' : 'yes'} slotClassName="aip-vision-glyph" ready={motionReady}>
                {state.checking
                    ? <Loader2 size={12} strokeWidth={1.75} className="aip-spinner" aria-hidden="true" />
                    : state.reads === 'no'
                        ? <ImageOff size={12} strokeWidth={1.75} aria-hidden="true" />
                        : <Image size={12} strokeWidth={1.75} aria-hidden="true" />}
            </Presence>
        </button>
    );
};

/** The line a row's glyph discloses: the Auto / On / Off choice, what Auto says, and "Test again". */
export const AipVisionDetail: React.FC<{
    id: string; state: VisionModelState; open: boolean;
    onSet: (setting: VisionSetting) => void; onRetest: () => void;
}> = ({ id, state, open, onSet, onRetest }) => {
    const t = useT();
    const motionReady = useVisionRowMotion(open);
    const choices: Array<{ value: VisionSetting; label: string; title: string }> = [
        { value: 'auto', label: t('Auto'), title: t('Let Natively work it out') },
        { value: 'on', label: t('On'), title: t('Always send this model screenshots') },
        { value: 'off', label: t('Off'), title: t('Never send this model screenshots') },
    ];
    // Where the raised pill sits: the selected option's own box. Measured only
    // while the line is open — a provider can list hundreds of models, each with
    // a closed line nobody can see — and before paint, so it never lands late.
    const segRef = useRef<HTMLDivElement>(null);
    const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
    const labelsKey = choices.map(c => c.label).join('\n');
    useLayoutEffect(() => {
        const seg = segRef.current;
        if (!open || !seg) return;
        const measure = () => {
            const el = seg.querySelector<HTMLElement>('[aria-pressed="true"]');
            if (!el) return;
            const next = { x: el.offsetLeft, w: el.offsetWidth };
            setPill(prev => (prev && prev.x === next.x && prev.w === next.w ? prev : next));
        };
        measure();
        // A late font swap changes every label's width.
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
        observer?.observe(seg);
        return () => observer?.disconnect();
    }, [open, state.setting, labelsKey]);
    // Opened on the last rows in view of a scrolling list, the line landed under
    // the fold: the glyph lit up and nothing else seemed to happen. So while the
    // line opens, the list follows it frame by frame and the two arrive together
    // ("nearest": a line already in view moves nothing). Only for an opening the
    // user just asked for — a row that comes back already open, when a filter is
    // cleared, must not pull the list to itself.
    const lineRef = useRef<HTMLDivElement>(null);
    const wasOpen = useRef(open);
    useEffect(() => {
        const opening = open && !wasOpen.current;
        wasOpen.current = open;
        const line = lineRef.current;
        if (!opening || !line) return;
        // A little past the reveal's opening time (--aip-dur-travel, 220ms).
        const until = performance.now() + 280;
        let frame = 0;
        const follow = () => {
            line.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            if (performance.now() < until) frame = requestAnimationFrame(follow);
        };
        frame = requestAnimationFrame(follow);
        return () => cancelAnimationFrame(frame);
    }, [open]);
    const auto = visionAutoText(state, t);
    const status = visionStatusText(state, t);
    const onAuto = state.setting === 'auto';
    const tested = state.auto.source === 'test';
    return (
        <div ref={lineRef} className="aip-reveal aip-reveal--line" data-open={open ? 'true' : 'false'} id={id}>
            <div>
                <div className="aip-vision-detail" role="group" aria-label={t('Reads images')}>
                    <span className="aip-vision-label">{t('Reads images')}</span>
                    <div className="aip-vision-seg" ref={segRef}>
                        {pill && (
                            <span
                                className="aip-vision-seg-pill"
                                aria-hidden="true"
                                style={{ width: pill.w, transform: `translateX(${pill.x}px)` }}
                            />
                        )}
                        {choices.map(c => (
                            <button
                                key={c.value}
                                type="button"
                                tabIndex={open ? 0 : -1}
                                className="aip-vision-seg-opt"
                                aria-pressed={state.setting === c.value}
                                title={c.title}
                                onClick={() => { if (state.setting !== c.value) onSet(c.value); }}
                            >
                                {c.label}
                            </button>
                        ))}
                    </div>
                    <div className="aip-vision-result">
                        <span className="aip-vision-status" data-answer={visionAnswerInForce(state) ? 'true' : 'false'}>
                            {/* What a screen reader hears: the whole sentence, apart from
                                the pieces below, which move and are for the eye only. */}
                            <span className="sr-only" aria-live="polite">{status}</span>
                            <span className="aip-vision-would" data-open={onAuto ? 'false' : 'true'} aria-hidden="true">
                                <span>{`${t('Auto would say')}: `}</span>
                            </span>
                            <span aria-hidden="true"><Presence kind="text" id={auto} ready={motionReady}>{auto}</Presence></span>
                        </span>
                        {/* Only on Auto, and only where a test can run: On and Off are the
                            user's own answer, and a test would send an image they may have
                            just said not to send. Off Auto the button stays mounted so its
                            place can close (.aip-vision-test), but it is hidden, out of the
                            tab order, and its click does nothing. */}
                        {state.testable && (
                            <div className="aip-vision-test" data-open={onAuto ? 'true' : 'false'} aria-hidden={onAuto ? undefined : true}>
                                <button
                                    type="button"
                                    tabIndex={open && onAuto ? 0 : -1}
                                    className="aip-btn aip-btn-sm aip-col-pill"
                                    disabled={state.checking}
                                    title={t('Send this model a test image now and see whether it can read it')}
                                    onClick={() => { if (onAuto) onRetest(); }}
                                >
                                    <Presence kind="text" id={tested ? 'again' : 'now'} ready={motionReady}>
                                        {tested ? t('Test again') : t('Test now')}
                                    </Presence>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export interface AipModelEntry {
    id: string;
    label: string;
    /** A short line shown in place of the raw id (speech models: "Fastest"). */
    description?: string;
}

interface AipModelListProps {
    /** Presets ∪ persisted catalog. The full universe for this provider. */
    models: AipModelEntry[];
    /** Allow-list. EMPTY MEANS ALL — never "none"; there is no sentinel. */
    enabled: string[];
    onToggle: (modelId: string) => void;
    /** Clears the allow-list back to "all". */
    onReset: () => void;
    /** This provider's default model id. Rendered as a badge; movable per row. */
    defaultId?: string;
    /** Promote a model to this provider's default. Must also allow-list it. */
    onSetDefault?: (modelId: string) => void;
    /** Ids present in `enabled` that the provider no longer offers. */
    staleIds?: string[];
    /**
     * Opt-in provider: an empty `enabled` means NOTHING is selected, not "all".
     * Changes the count wording and lifts the "one must stay on" guard, which
     * exists only to stop an un-check from silently re-lighting every row.
     */
    optIn?: boolean;
    /** Tick/clear every currently VISIBLE row (typed filter applied). */
    onBulkToggle?: (ids: string[], enable: boolean) => void;
    /** Set while a write is in flight so the header can report a failure. */
    error?: string | null;
    /** Re-run discovery against the provider API. */
    onRefresh?: () => void;
    /** Discovery in flight. */
    refreshing?: boolean;
    /**
     * Every row came from provider discovery, so there is no preset/fetched
     * split and the "Showing built-in models only." note below would be false.
     *
     * That note is a heuristic on list LENGTH — it fires under
     * AIP_MODEL_FILTER_THRESHOLD, which is right for the key-backed cards that
     * ship a handful of presets and fetch the rest. A provider whose whole
     * catalogue arrives from an authenticated call (Antigravity) has nothing
     * built in, and a short list there means the account has four models, not
     * that discovery has not run.
     */
    catalogIsComplete?: boolean;
    /**
     * Called once, the first time the panel is expanded with no catalog yet.
     * Expanding this list IS the intent to browse models, so discovery belongs
     * here rather than behind a separate button elsewhere in the card.
     */
    onFirstOpen?: () => void;
    /**
     * A provider that runs ONE model at a time (Settings > Audio's speech
     * providers). There is no allow-list, so a row's tick marks the model in
     * use and clicking the row — or its Set default — picks it; the count is
     * just the number of models and the bulk / reset controls are not offered.
     * Everything else (the summary, the reveal, the row actions) is unchanged.
     */
    pickOnly?: boolean;
    /**
     * Chat-model lists only: each row shows whether the model reads images and
     * discloses the Auto / On / Off choice. Off by default — this component
     * also lists embedding, reranker and speech models, where the question
     * does not exist. `visionId` maps a row id to the picker id main expects
     * when they differ (identity otherwise).
     */
    visionControl?: boolean;
    visionId?: (modelId: string) => string;
    /** Timestamp when this catalog was last dynamically fetched. */
    lastFetchedAt?: number;
}

/** Above this many models, a filter field appears. */
const AIP_MODEL_FILTER_THRESHOLD = 12;

/**
 * The model allow-list: a summary row that discloses a vertical list.
 *
 * One control from n=2 to n=70. What changes with size is whether the well
 * scrolls and whether a filter appears — never what the control *is*.
 *
 * Deliberately NOT a modal or popover. Portals are forbidden in this file
 * (SettingsPeriwinklePortalScopeGuard) because the design tokens resolve by DOM
 * ancestry, and `overflow-y:auto` on the settings scroller computes `overflow-x`
 * to `auto`, making it a clip box on both axes — a floating layer on a lower card
 * opens into clipped space.
 *
 * Chips were the previous control. They work at n=3 and fail at n=70: a wrapped
 * wall, one tab stop per chip, and flex-wrap reflow that moves a click target
 * between aim and click.
 */
export const AipModelList: React.FC<AipModelListProps> = ({
    models, enabled, onToggle, onReset, defaultId, onSetDefault, staleIds = [], error,
    onRefresh, refreshing, onFirstOpen, optIn = false, onBulkToggle,
    catalogIsComplete = false, pickOnly = false, visionControl = false, visionId,
    lastFetchedAt,
}) => {
    const t = useT();
    const [open, setOpen] = useState(false);
    // Asked only while the list is open: a closed list shows no rows.
    const visionIds = useMemo(
        () => visionControl ? models.map(m => visionId ? visionId(m.id) : m.id) : [],
        [visionControl, models, visionId],
    );
    const vision = useVisionStates(visionIds, visionControl && open);
    const [visionOpenId, setVisionOpenId] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const firstOpenFired = useRef(false);
    const listRef = useRef<HTMLDivElement>(null);
    const summaryRef = useRef<HTMLButtonElement>(null);
    const idRef = useRef(`aip-models-${Math.random().toString(36).slice(2, 9)}`);
    const panelId = `${idRef.current}-panel`;

    // The pill column (.aip-col-pill): every label this list can put in it, laid
    // out unseen at its natural width; the widest sets the column. Measured while
    // the list is open and before paint, so the pills never resize in view.
    const colLabels = [
        t('Default'),
        ...(onSetDefault ? [t('Set default')] : []),
        ...(visionControl ? [t('Test again'), t('Test now')] : []),
    ];
    const colKey = colLabels.join('\n');
    const colSizerRef = useRef<HTMLDivElement>(null);
    const [colWidth, setColWidth] = useState<number | null>(null);
    useLayoutEffect(() => {
        const sizer = colSizerRef.current;
        if (!open || !sizer) return;
        const labels = Array.from(sizer.children) as HTMLElement[];
        const measure = () => {
            const widest = Math.max(0, ...labels.map(el => el.offsetWidth));
            // offsetWidth rounds to a whole pixel; the extra one keeps the floor
            // above the widest label's real width, so all of them land on it.
            if (widest > 0) setColWidth(widest + 1);
        };
        measure();
        // A late font swap changes every label's width.
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
        labels.forEach(el => observer?.observe(el));
        return () => observer?.disconnect();
    }, [open, colKey]);

    // Opt-in inverts the empty case: nothing is on until it is listed.
    const isOn = (id: string) => pickOnly ? id === defaultId : optIn ? enabled.includes(id) : (enabled.length === 0 || enabled.includes(id));
    const enabledCount = (!optIn && enabled.length === 0) ? models.length : enabled.length;

    // Threshold keys off the UNFILTERED count. Keying it off visible rows would
    // make the filter field appear and vanish as you type — exactly the jank the
    // threshold exists to prevent.
    const showFilterBar = models.length > AIP_MODEL_FILTER_THRESHOLD;

    // Every model the provider reports is listed. The typed filter is the ONLY
    // thing that can hide a row — there is deliberately no category the UI
    // suppresses on the user's behalf, so a model that exists upstream is always
    // reachable here.
    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return models;
        return models.filter(m => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q));
    }, [models, query]);

    const moveTo = useCallback((index: number) => {
        if (visible.length === 0) return;
        const next = Math.max(0, Math.min(visible.length - 1, index));
        setActiveIndex(next);
        requestAnimationFrame(() => {
            listRef.current?.querySelector<HTMLElement>(`[data-index='${next}']`)
                ?.scrollIntoView({ block: 'nearest' });
        });
    }, [visible.length]);

    const onListKeyDown = (e: React.KeyboardEvent) => {
        switch (e.key) {
            case 'Escape':
                // MUST stop propagation: SettingsOverlay listens for Escape, so without
                // this, closing a model list closes the whole Settings window.
                e.stopPropagation();
                setOpen(false);
                setQuery('');
                requestAnimationFrame(() => summaryRef.current?.focus());
                return;
            case 'ArrowDown': e.preventDefault(); moveTo(activeIndex + 1); return;
            case 'ArrowUp':   e.preventDefault(); moveTo(activeIndex - 1); return;
            case 'Home':      e.preventDefault(); moveTo(0); return;
            case 'End':       e.preventDefault(); moveTo(visible.length - 1); return;
        }
    };

    // The sole remaining checked model is inert. Un-checking it would normalise the
    // allow-list to [] — which means ALL — so every row would re-light. To the user
    // that reads as "I unchecked one thing and everything turned back on".
    // Not applicable to an opt-in provider: there [] legitimately means "none",
    // so clearing the last row is a normal outcome, not a trapdoor back to "all".
    const soleEnabled = (!optIn && enabled.length === 1) ? enabled[0] : null;

    return (
        <>
            <button
                ref={summaryRef}
                type="button"
                onClick={() => {
                    const next = !open;
                    setOpen(next);
                    if (!next) setQuery('');
                    // Once only: a failed or empty discovery must not re-fire on every
                    // expand, and the user can still refresh explicitly below.
                    if (next && !firstOpenFired.current) {
                        firstOpenFired.current = true;
                        onFirstOpen?.();
                    }
                }}
                aria-expanded={open}
                aria-controls={panelId}
                className="aip-models-summary aip-press order-2"
            >
                <span className="aip-label shrink-0">{t('Models')}</span>
                <span className="aip-meta truncate min-w-0 flex-1 text-right">
                    <Presence kind="text" id={defaultId || null} block className="truncate">
                        {defaultId ? `${models.find(m => m.id === defaultId)?.label ?? defaultId} · ${t('default')}` : ''}
                    </Presence>
                </span>
                {error
                    ? <AipBadge tone="danger" label={t('Not saved')} />
                    : <span className="aip-count shrink-0" aria-live="polite">
                        {pickOnly ? `${models.length}` : enabled.length === 0
                            ? (optIn ? `${t('None selected')} · ${models.length}` : `${t('All')} ${models.length}`)
                            : `${enabledCount} / ${models.length}`}
                      </span>}
                <ChevronDown size={13} strokeWidth={1.75} className="aip-select-chevron" aria-hidden="true" />
            </button>

            {/* basis-full forces this onto its own line inside the action row;
                order-4 keeps it visually last while DOM order keeps it directly
                after the trigger it belongs to. */}
            <div className="aip-reveal aip-reveal--models w-full basis-full order-4" data-open={open ? 'true' : 'false'}>
                <div>
                    <div
                        id={panelId}
                        role="group"
                        aria-label={pickOnly ? t('Models') : t('Models shown in the picker')}
                        className="pt-2"
                        onKeyDown={onListKeyDown}
                        style={colWidth ? { ['--aip-col-w' as string]: `${colWidth}px` } as React.CSSProperties : undefined}
                    >
                        <div ref={colSizerRef} className="aip-col-sizer" aria-hidden="true">
                            {colLabels.map((label, i) => <span key={i} className="aip-btn aip-btn-sm">{label}</span>)}
                        </div>
                        <div className="flex items-center gap-2 mb-2">
                        {showFilterBar && (
                            <>
                                <input
                                    type="search"
                                    value={query}
                                    onChange={e => setQuery(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); moveTo(0); } }}
                                    placeholder={t('Filter models…')}
                                    className="aip-input flex-1"
                                    data-mono="true"
                                />
                                {/* Reset means "back to no filter" = ALL, which is incoherent
                                    for an opt-in provider — there Clear above is the real
                                    control and this would just be a second, wrong-labelled one. */}
                                {!optIn && enabled.length > 0 && (
                                    <button type="button" onClick={onReset} className="aip-btn aip-btn-sm shrink-0" title={t('Show all models again')}>
                                        {t('Reset')}
                                    </button>
                                )}
                            </>
                        )}
                        {/* Deliberately OUTSIDE {showFilterBar}: that gate only opens above
                            12 models, and bulk selection is not a big-catalogue luxury. On an
                            OPT-IN list nothing is ticked until you tick it, so with a 4-model
                            proxy these were the only controls that mattered and they were the
                            ones being hidden.

                            They act on the VISIBLE rows, so with 300+ models the filter scopes
                            a family ("gpt" -> Select all); a button that ignored the filter
                            would be a 300-model foot-gun sitting right next to it. With no
                            filter typed, `visible` is every model the provider reports, so
                            Deselect all can always reach every selection. */}
                        {onBulkToggle && visible.length > 0 && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => onBulkToggle(visible.map(m => m.id), true)}
                                    className="aip-btn aip-btn-sm shrink-0"
                                    title={query.trim()
                                        ? t('Select the models currently listed')
                                        : t('Select every model')}
                                >
                                    {t('Select all')}
                                </button>
                                {/* "Deselect all", not "Clear": users reach for the symmetric
                                    wording, and an asymmetric pair reads as two unrelated
                                    actions. Both labels over-claim identically while a filter
                                    is active, which the tooltips resolve. */}
                                {enabledCount > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => onBulkToggle(visible.map(m => m.id), false)}
                                        className="aip-btn aip-btn-sm shrink-0"
                                        title={query.trim()
                                            ? t('Deselect the models currently listed')
                                            : t('Deselect every model')}
                                    >
                                        {t('Deselect all')}
                                    </button>
                                )}
                            </>
                        )}
                        {onRefresh && (
                            <button
                                type="button"
                                onClick={onRefresh}
                                disabled={refreshing}
                                className={`aip-btn aip-btn-sm shrink-0 ${showFilterBar || (onBulkToggle && visible.length > 0) ? '' : 'ml-auto'}`}
                                title={t('Re-read the model list from this provider')}
                            >
                                <RefreshCw size={11} strokeWidth={1.75} className={refreshing ? 'aip-spinner' : ''} />
                                {/* "Fetch all models" offers to go and get the REST of the
                                    catalogue — right for the preset-shipping cards, wrong for
                                    one whose catalogue already arrived whole. Same signal
                                    catalogIsComplete uses to silence the built-in note. */}
                                {refreshing ? t('Fetching...') : (showFilterBar || catalogIsComplete) ? t('Refresh') : t('Fetch all models')}
                            </button>
                        )}
                        {lastFetchedAt && lastFetchedAt > 0 && (
                            <span className="text-[10px] aip-muted ml-auto self-center shrink-0">
                                {t('Synced')} {new Date(lastFetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                        )}
                        </div>

                        <div ref={listRef} className="aip-well aip-scroll-y custom-scrollbar aip-models-well">
                            {visible.length === 0 ? (
                                <p className="aip-meta px-2 py-3 text-center">{t('No models match that filter.')}</p>
                            ) : visible.map((m, i) => {
                                const on = isOn(m.id);
                                const inert = soleEnabled === m.id;
                                const stale = staleIds.includes(m.id);
                                const isDefault = defaultId === m.id;
                                const pickerId = visionId ? visionId(m.id) : m.id;
                                const visionState = visionControl ? vision.states[pickerId] : null;
                                const visionPanelId = `${idRef.current}-vision-${i}`;
                                return (
                                    <React.Fragment key={m.id}>
                                    <div className={`aip-model-row aip-row${visionState ? ' aip-model-row--vision' : ''}`}>
                                        <button
                                            type="button"
                                            data-index={i}
                                            tabIndex={i === activeIndex ? 0 : -1}
                                            aria-pressed={on}
                                            aria-disabled={inert || undefined}
                                            onClick={() => {
                                                if (inert) return;
                                                if (pickOnly) { if (m.id !== defaultId) onSetDefault?.(m.id); return; }
                                                onToggle(m.id);
                                            }}
                                            onFocus={() => setActiveIndex(i)}
                                            title={inert
                                                ? t('At least one model must stay on. Turn the provider off to hide it entirely.')
                                                : m.id}
                                            className="aip-model-toggle"
                                        >
                                            <Check size={11} strokeWidth={2.5} className="aip-model-check" aria-hidden="true" />
                                            <span className="aip-model-name truncate">{m.label}</span>
                                            {m.description ? (
                                                <span className="aip-model-id truncate">{m.description}</span>
                                            ) : m.label !== m.id && (
                                                <span className="aip-model-id aip-mono truncate">{m.id}</span>
                                            )}
                                        </button>
                                        {stale && <AipBadge tone="warn" label={t('Not offered')} />}
                                        {visionState && (
                                            <AipVisionButton
                                                state={visionState}
                                                open={visionOpenId === m.id}
                                                controls={visionPanelId}
                                                onClick={() => setVisionOpenId(cur => cur === m.id ? null : m.id)}
                                            />
                                        )}
                                        {/* One slot for both states, as wide as the list's pill
                                            column: the mark and the button are the same box, so
                                            nothing in the row moves as the default changes rows. */}
                                        <div className="aip-default-slot shrink-0">
                                            {isDefault ? (
                                                <span className="aip-default-mark aip-col-pill">{t('Default')}</span>
                                            ) : onSetDefault && (
                                                // 0.5 opacity at rest, not 0: an action that is invisible
                                                // until hover is unreachable by keyboard and touch.
                                                <div className="aip-row-actions">
                                                    <button
                                                        type="button"
                                                        onClick={() => onSetDefault(m.id)}
                                                        className="aip-btn aip-btn-sm aip-col-pill"
                                                        title={t('Use this model by default for this provider')}
                                                    >
                                                        {t('Set default')}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    {visionState && (
                                        <AipVisionDetail
                                            id={visionPanelId}
                                            state={visionState}
                                            open={visionOpenId === m.id}
                                            onSet={(setting) => { void vision.set(pickerId, setting); }}
                                            onRetest={() => { void vision.retest(pickerId); }}
                                        />
                                    )}
                                    </React.Fragment>
                                );
                            })}
                        </div>

                        {!catalogIsComplete && models.length <= AIP_MODEL_FILTER_THRESHOLD && (
                            <p className="aip-meta mt-2">{t('Showing built-in models only.')}</p>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
};

/**
 * `name` is the OPEN menu row; `triggerName`, when present, is what the CLOSED
 * trigger shows instead. Optional because most selectors (widths, plain
 * choices) have one name and a required field would blank their triggers.
 */
export interface AipSelectOption { id: string; name: string; triggerName?: string }

interface AipSelectProps {
    value: string;
    options: AipSelectOption[];
    onChange: (value: string) => void;
    /** Always required — the trigger's text is a value, not a name. */
    label: string;
    placeholder?: string;
    emptyLabel?: string;
    /** Renders the trigger inert (still readable) plus an optional hint. */
    disabled?: boolean;
    disabledHint?: string;
    className?: string;
}

/**
 * The in-flow select expander. Deliberately NOT a floating layer:
 *  - portals are banned in this file (the accent tokens resolve by DOM
 *    ancestry, so a portalled menu silently falls back to the blue root), and
 *  - `overflow-y:auto` computes `overflow-x:auto`, so the settings scroller is
 *    a clip box on both axes and a dropdown on a lower card opens into
 *    clipped space.
 * Expanding in-flow pushes content down: nothing to clip, no flip logic, and
 * no outside-mousedown listener. Escape still closes.
 */
export const AipSelect: React.FC<AipSelectProps> = ({
    value, options, onChange, label, placeholder, emptyLabel,
    disabled = false, disabledHint, className = '',
}) => {
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const listRef = useRef<HTMLDivElement>(null);
    const idRef = useRef(`aip-select-${Math.random().toString(36).slice(2, 9)}`);
    const listId = `${idRef.current}-list`;

    const selected = options.find(o => o.id === value);

    const moveTo = useCallback((index: number) => {
        if (options.length === 0) return;
        const next = Math.max(0, Math.min(options.length - 1, index));
        setActiveIndex(next);
        // Keep the roving option visible without hijacking the page scroll.
        requestAnimationFrame(() => {
            listRef.current?.querySelector<HTMLElement>(`[data-index='${next}']`)
                ?.scrollIntoView({ block: 'nearest' });
        });
    }, [options.length]);

    const openList = useCallback((index?: number) => {
        if (disabled || options.length === 0) return;
        setOpen(true);
        const start = index ?? Math.max(0, options.findIndex(o => o.id === value));
        moveTo(start);
    }, [disabled, options, value, moveTo]);

    const commit = (id: string) => {
        onChange(id);
        setOpen(false);
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
        if (disabled) return;
        switch (e.key) {
            case 'Escape':
                if (open) { e.stopPropagation(); setOpen(false); }
                return;
            case 'ArrowDown':
            case 'ArrowUp': {
                e.preventDefault();
                if (!open) { openList(); return; }
                moveTo(activeIndex + (e.key === 'ArrowDown' ? 1 : -1));
                return;
            }
            case 'Home':
                if (open) { e.preventDefault(); moveTo(0); }
                return;
            case 'End':
                if (open) { e.preventDefault(); moveTo(options.length - 1); }
                return;
            case 'Enter':
            case ' ':
                e.preventDefault();
                if (!open) { openList(); return; }
                if (activeIndex >= 0 && options[activeIndex]) commit(options[activeIndex].id);
                return;
            default:
                return;
        }
    };

    return (
        <div className={`aip-select ${className}`}>
            <button
                type="button"
                role="combobox"
                aria-label={label}
                aria-expanded={open}
                aria-controls={listId}
                aria-haspopup="listbox"
                aria-disabled={disabled || undefined}
                aria-activedescendant={open && activeIndex >= 0 ? `${idRef.current}-opt-${activeIndex}` : undefined}
                title={disabled ? disabledHint : undefined}
                onClick={() => (open ? setOpen(false) : openList())}
                onKeyDown={onKeyDown}
                className="aip-select-trigger"
            >
                <span className="truncate">{selected ? selected.name : (value || placeholder || label)}</span>
                <ChevronDown size={14} strokeWidth={1.75} className="aip-select-chevron" aria-hidden="true" />
            </button>

            {/* Children stay mounted: the reveal animates grid-template-rows and
                hides them with `visibility`, which is also what keeps them out
                of the tab order while collapsed. */}
            <div className="aip-reveal" data-open={open ? 'true' : 'false'}>
                <div>
                    <div
                        id={listId}
                        role="listbox"
                        aria-label={label}
                        ref={listRef}
                        className="aip-well aip-select-list custom-scrollbar"
                    >
                        {options.map((option, index) => (
                            <div
                                key={option.id}
                                id={`${idRef.current}-opt-${index}`}
                                role="option"
                                aria-selected={value === option.id}
                                data-index={index}
                                data-active={activeIndex === index ? 'true' : 'false'}
                                onClick={() => commit(option.id)}
                                onMouseEnter={() => setActiveIndex(index)}
                                className="aip-select-option"
                            >
                                <span className="truncate">{option.name}</span>
                                {value === option.id && (
                                    <Check size={13} strokeWidth={1.75} className="aip-accent-fg shrink-0" aria-hidden="true" />
                                )}
                            </div>
                        ))}
                        {options.length === 0 && (
                            <div className="aip-select-empty">{emptyLabel ?? 'No options'}</div>
                        )}
                    </div>
                </div>
            </div>
            {/* Outside the reveal: a disabled trigger never opens, so a hint
                nested inside it could never be read. */}
            {disabled && disabledHint && <p className="aip-meta mt-1.5">{disabledHint}</p>}
        </div>
    );
};

// What a pending destructive action refers to. Kept as a discriminated union so
// the confirm dialog can render action-specific copy from one piece of state.
type PendingConfirm =
    | { kind: 'litellm' }
    | { kind: 'ninerouter' }
    | { kind: 'providerKey'; provider: string; setter: (val: string) => void }
    | { kind: 'customProvider'; id: string };

// The cloud data scopes, in render order. One list drives the rows, the count and
// the "N/6 shared" summary, so those can never disagree. Keys must match
// ProviderDataScope in electron/llm/ProviderRouter.ts — that union is what the
// main-process guard asserts against.
const SCOPE_ROWS = [
    { key: 'transcript' as const,        labelKey: 'Transcripts',         Icon: MessageSquare },
    { key: 'screenshots' as const,       labelKey: 'Screenshots',         Icon: Image },
    { key: 'reference_files' as const,   labelKey: 'Reference files',     Icon: FileText },
    { key: 'profile_history' as const,   labelKey: 'Profile history',     Icon: User },
    { key: 'embeddings' as const,        labelKey: 'Cloud embeddings',    Icon: Boxes },
    { key: 'post_call_summary' as const, labelKey: 'Post-call summaries', Icon: ClipboardList },
];

// Provider groups for the settings tabs. Labels are translated at render time.
// Icons are lucide, never emoji — a prior attempt shipped cloud/plug/eye emoji
// and was rejected. (Spelled out here on purpose: Stage 7's sweep greps this
// file for emoji codepoints, including in comments.)
const PROVIDER_TABS = [
    { id: 'cloud' as const, label: 'Cloud Providers', Icon: Cloud },
    { id: 'gateways' as const, label: 'Local & Gateways', Icon: Server },
    { id: 'vision' as const, label: 'Privacy', Icon: Eye },
];
type ProviderTabId = (typeof PROVIDER_TABS)[number]['id'];
const tabButtonId = (id: ProviderTabId) => `aip-tab-${id}`;
const tabPanelId = (id: ProviderTabId) => `aip-tabpanel-${id}`;

const CODEX_SERVICE_TIERS = ['default', 'fast', 'flex'] as const;
// Must mirror CodexCliService.CODEX_MODEL_REASONING_EFFORTS in
// electron/services/CodexCliService.ts. Kept in sync manually because the
// Settings UI runs in the renderer (no direct module access to main).
const CODEX_MODEL_REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh'] as const;

// Per-model valid reasoning-effort sets (mirrors CodexCliService's
// CODEX_MODEL_REASONING_SETS). Longest-match wins so gpt-5.4-codex beats
// gpt-5. The dropdown hides unsupported values per the currently-selected
// model so a user can't pick e.g. xhigh for gpt-5.3-codex (which the codex
// CLI binary rejects with a 400).
const CODEX_MODEL_REASONING_SETS: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['gpt-5-2025-08-07', ['low', 'medium', 'high']],
    ['gpt-5-mini',       ['low', 'medium', 'high']],
    ['gpt-5-nano',       ['low', 'medium', 'high']],
    ['gpt-5',            ['low', 'medium', 'high']],
    ['gpt-5.1',          ['none', 'low', 'medium', 'high']],
    ['gpt-5.2',          ['none', 'low', 'medium', 'high', 'xhigh']],
    ['gpt-5.4',          ['none', 'low', 'medium', 'high', 'xhigh']],
    ['gpt-5.5',          ['none', 'low', 'medium', 'high', 'xhigh']],
    ['gpt-5.6',          ['low', 'medium', 'high', 'xhigh']],
    ['gpt-6',            ['low', 'medium', 'high', 'xhigh']],
    ['gpt-5.5-codex',    ['low', 'medium', 'high', 'xhigh']],
    ['gpt-5.4-codex',    ['low', 'medium', 'high', 'xhigh']],
    ['gpt-5.3-codex-spark', ['low', 'medium', 'high']],
    ['gpt-5.3-codex',    ['low', 'medium', 'high']],
    ['gpt-5.2-codex',    ['low', 'medium', 'high', 'xhigh']],
    ['gpt-5.1-codex',    ['low', 'medium', 'high']],
    ['gpt-5-codex',      ['low', 'medium', 'high']],
];

function getValidCodexReasoningEfforts(modelId: string): readonly string[] {
    const id = (modelId || '').toLowerCase();
    let best: readonly [string, readonly string[]] | null = null;
    for (const entry of CODEX_MODEL_REASONING_SETS) {
        if (id.includes(entry[0]) && (!best || entry[0].length > best[0].length)) best = entry;
    }
    return best ? best[1] : ['low', 'medium', 'high'];
}

// LiteLLM max-output-token presets — the standard per-model output budgets
// (powers of two used across the LiteLLM model registry). '' = Auto: resolve
// each model's real budget from the proxy's /model/info, fallback 8192.
const LITELLM_MAX_TOKENS_OPTIONS: ModelOption[] = [
    { id: '', name: 'Auto (per-model)' },
    { id: '4096', name: '4,096 (4K)' },
    { id: '8192', name: '8,192 (8K)' },
    { id: '16384', name: '16,384 (16K)' },
    { id: '32768', name: '32,768 (32K)' },
    { id: '65536', name: '65,536 (64K)' },
    { id: '131072', name: '131,072 (128K)' },
    { id: '262144', name: '262,144 (256K)' },
    { id: '524288', name: '524,288 (512K)' },
    { id: '1048576', name: '1,048,576 (1M)' },
];

interface CustomProvider {
    id: string;
    name: string;
    curlCommand: string;
    responsePath: string;
    /** Whether this provider accepts screenshots. undefined = auto-detect from the cURL template. */
    multimodal?: boolean;
}

interface ModelOption {
    id: string;
    name: string;
}

interface ModelSelectProps {
    value: string;
    options: ModelOption[];
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
    /** Sizes the picker. The trigger fills this box (.aip-select-trigger is width:100%). */
    containerClassName?: string;
    /** Caps the trigger's label at this many characters (see capPickerLabel). */
    maxLabelChars?: number;
    /** Sizes the open menu. Defaults to the trigger's width. */
    menuClassName?: string;
    /** Makes the trigger fit its label, never narrower than this text renders,
        growing and shrinking with an ease as the pick changes
        (.aip-select-trigger--fit). Without it the trigger is a fixed w-40. Pair
        it with the default menuClassName: the menu is then the trigger's width
        and a name too long for a row is cut with an ellipsis. */
    minLabel?: string;
}

/** The Active Model and Background Model pickers: at least wide enough for this
    name. Measured, not a ch count: SF Pro and Segoe UI set it at different widths. */
const HERO_MODEL_PICKER_MIN_LABEL = 'Gemini 3.8 Flash';

/** A fitted picker's label is centred only when it is narrower than the picker's
    floor by at least this much, in em of its font (30px at 12px). Short of that, a
    centred name sits a few px in from the left edge and reads as misaligned. */
const FIT_LABEL_CENTRE_MIN_SPARE_EM = 2.5;

/** A fitted menu row whose name is cut shows the whole name as its tooltip. Set as
    the pointer arrives: only a laid-out row knows whether it is cut. */
const showFullNameIfCut = (event: React.MouseEvent<HTMLButtonElement>) => {
    const row = event.currentTarget;
    const name = row.firstElementChild;
    if (!(name instanceof HTMLElement)) return;
    row.title = name.scrollWidth > name.clientWidth ? name.textContent ?? '' : '';
};

const ModelSelect: React.FC<ModelSelectProps> = ({ value, options, onChange, placeholder, className = "", containerClassName = "relative", maxLabelChars, menuClassName = "w-full", minLabel }) => {
    const t = useT();
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const fit = minLabel !== undefined;
    const measureRef = useRef<HTMLSpanElement>(null);
    const [fitWidth, setFitWidth] = useState<number | null>(null);
    const [fitTruncated, setFitTruncated] = useState(false);
    const [fitCentred, setFitCentred] = useState(false);
    const [fitAnimate, setFitAnimate] = useState(false);

    // The hidden copy re-measures whenever its text or font changes (a new pick,
    // a language switch, a late webfont). offsetWidth, not a rect: layout px,
    // whatever transform the settings panel's own entrance applies. A hidden
    // ancestor reads 0: keeping the last real width stops an ease in from 0.
    // offsetWidth is a whole number and rounds DOWN for a label 140.2px wide,
    // which left the slot 0.2px short: "OpenAI Codex (GPT-5.5)" ellipsized in
    // the trigger and was cut in its own menu row. One spare px covers it.
    // The label's own copy is watched too: two names both narrower than the
    // floor leave the box the same size, but can differ on whether they centre.
    React.useLayoutEffect(() => {
        const el = measureRef.current;
        const label = el?.firstElementChild;
        const floor = el?.lastElementChild;
        if (!fit || !el || !(label instanceof HTMLElement) || !(floor instanceof HTMLElement)) return;
        const measure = () => {
            if (el.offsetWidth === 0) return;
            setFitWidth(el.offsetWidth + 1);
            setFitTruncated(el.scrollWidth > el.clientWidth);
            const spare = floor.offsetWidth - label.offsetWidth;
            setFitCentred(spare >= FIT_LABEL_CENTRE_MIN_SPARE_EM * parseFloat(getComputedStyle(el).fontSize));
        };
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        ro.observe(label);
        return () => ro.disconnect();
    }, [fit]);
    // The saved pick arrives over IPC after mount. It is loading, not news, so the
    // ease waits for the panel's ready flag (SettingsMotionReady) plus a frame for
    // the width that value set to land.
    const motionReady = React.useContext(SettingsMotionReady);
    useEffect(() => {
        if (!fit || !motionReady) return;
        const frame = requestAnimationFrame(() => setFitAnimate(true));
        return () => cancelAnimationFrame(frame);
    }, [fit, motionReady]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const selectedOption = options.find(o => o.id === value);
    const resolvedPlaceholder = placeholder ?? t('Select model');
    const fullLabel = selectedOption ? selectedOption.name : resolvedPlaceholder;
    const shownLabel = maxLabelChars ? capPickerLabel(fullLabel, maxLabelChars) : fullLabel;

    return (
        <div className={containerClassName} ref={containerRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
                aria-haspopup="listbox"
                className={`aip-select-trigger ${fit ? 'aip-select-trigger--fit' : 'w-40'} ${className}`}
                title={shownLabel !== fullLabel || (fit && fitTruncated) ? fullLabel : undefined}
                type="button"
            >
                {fit ? (
                    <>
                        <span
                            className="aip-select-fit-slot"
                            data-animate={fitAnimate ? 'true' : undefined}
                            style={fitWidth === null ? undefined : { width: fitWidth }}
                        >
                            {/* The label leaves and the new one arrives (Presence
                                "text") while the slot eases to the new width. A
                                name well short of the slot is centred (mx-auto in
                                the flex slot, fitCentred); one close to its width
                                stays at the left edge. The class rides on each
                                label, so the one leaving keeps its own alignment
                                through its fade instead of jumping. */}
                            <Presence
                                kind="text"
                                id={shownLabel}
                                className={`max-w-full truncate ${fitCentred ? 'mx-auto' : ''}`}
                            >
                                {shownLabel}
                            </Presence>
                        </span>
                        <span
                            ref={measureRef}
                            aria-hidden="true"
                            className="aip-select-fit-measure"
                        >
                            <span>{shownLabel}</span>
                            <span>{minLabel}</span>
                        </span>
                    </>
                ) : (
                    <span className="truncate pr-2">{shownLabel}</span>
                )}
                <ChevronDown size={14} strokeWidth={1.75} className="aip-select-chevron" aria-hidden="true" />
            </button>

            {/* Settings' menu move (SettingsMenu): grows from the trigger's corner
                and eases out on close, where it used to vanish. It stays an
                .aip-float while it leaves, so its card stays lifted until gone. */}
            <SettingsMenu
                open={isOpen}
                origin="top right"
                role="listbox"
                className={`aip-float aip-scroll-y absolute top-full right-0 mt-1 ${menuClassName} z-50 max-h-60 p-1 custom-scrollbar`}
            >
                    {options.map((option) => (
                        <button
                            key={option.id}
                            onClick={() => {
                                onChange(option.id);
                                setIsOpen(false);
                            }}
                            role="option"
                            aria-selected={value === option.id}
                            className={`aip-select-option ${fit ? 'aip-select-option--fit' : ''}`}
                            onMouseEnter={fit ? showFullNameIfCut : undefined}
                            type="button"
                        >
                            {/* A fitted picker's menu is exactly the trigger's width, and
                                a row is one line: a name too long for it is cut with
                                an ellipsis (as many characters as fit, less the one
                                the ellipsis takes), and the row's tooltip then carries
                                the whole name, since "OpenAI Codex: GPT-5.6-Terra" and
                                "…-Luna" cut to the same text. */}
                            <span className={fit ? 'min-w-0 truncate' : 'truncate'}>{option.name}</span>
                            {value === option.id && <Check size={13} strokeWidth={1.75} className={`aip-accent-fg shrink-0 ${fit ? '' : 'ml-2'}`} aria-hidden="true" />}
                        </button>
                    ))}
                    {options.length === 0 && (
                        <div className="aip-select-empty">{t('No models available')}</div>
                    )}
            </SettingsMenu>
        </div>
    );
};

interface AIProvidersSettingsProps {
    aiResponseLanguage: string;
    availableAiLanguages: any[];
    isAiLangDropdownOpen: boolean;
    onToggleAiLangDropdown: () => void;
    onSelectAiLanguage: (code: string) => void;
    aiLangDropdownRef: React.RefObject<HTMLDivElement | null>;
    /** Deep-link to another settings tab (used by the lightweight-embedding notice). */
    onNavigate?: (tab: string) => void;
}

/* ═══════════════════════════════════════════════════════════════════════════
   R-10 resolution card (§19.1). Rendered only while the main process reports
   two credential stores that cannot be ordered (a whole-profile restore left a
   newer app-managed backup beside the OS-keyring file). Until the user answers,
   the app runs from the union of both sets and refuses to overwrite either
   file — safe, but every new key lands in the weaker app-managed store, so the
   state should be ENDED deliberately, here, where keys are managed.
   Shows key NAMES and last-4 only; the main process never sends values.

   What it says is in src/lib/credentialStoresConflict.mjs (unit-tested):
   provider names instead of field names, which keys the two sets disagree on,
   the OS store named for the platform the app is running on, and a sentence
   for every reason main can refuse a choice.
   ═══════════════════════════════════════════════════════════════════════════ */
type AmbiguousStores = {
    keyring: { keys: { name: string; last4: string }[]; mtimeIso: string | null };
    fallback: { keys: { name: string; last4: string }[]; mtimeIso: string | null };
};
type StoreChoice = 'keyring' | 'fallback' | 'merge';
type StoreFailure = { choice: StoreChoice; attempt: number; headline: string; detail: string };

/** A key's ending as Settings writes it everywhere else: dots, then the last
    four. Main already masks a value too short to show any of. */
const keyTail = (last4: string) => (last4 === '····' ? last4 : `····${last4}`);

const AmbiguousStoresCard: React.FC = () => {
    const t = useT();
    const { lang } = useLanguage();
    const reduceMotion = useReducedMotion();
    const [stores, setStores] = useState<AmbiguousStores | null>(null);
    const [busy, setBusy] = useState<StoreChoice | null>(null);
    const [failure, setFailure] = useState<StoreFailure | null>(null);

    useEffect(() => {
        let cancelled = false;
        const fetch = () => {
            window.electronAPI?.getAmbiguousCredentialStores?.()
                .then((v) => { if (!cancelled) setStores(v); })
                .catch(() => { /* absent API (older main) → render nothing */ });
        };
        fetch();
        // Re-fetch on credential changes so the card tracks reality: it must
        // disappear if another window resolved the state, and a mount-only
        // fetch would show stale data forever (adversarial review 2026-08-19).
        const unsubscribe = window.electronAPI?.onCredentialsChanged?.(fetch);
        return () => { cancelled = true; unsubscribe?.(); };
    }, []);

    // Leaving is two steps, like the notice under the header: collapse, THEN
    // unmount, so the panel does not snap up into the hole. The card keeps
    // drawing the last sets it was given while it closes, and each refusal note
    // keeps its own words while it closes.
    const shownStores = useRef<AmbiguousStores | null>(null);
    if (stores) shownStores.current = stores;
    const shownFailures = useRef<Partial<Record<StoreChoice, StoreFailure>>>({});
    if (failure) shownFailures.current[failure.choice] = failure;
    const attempts = useRef(0);
    const inFlight = useRef(false);
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        if (stores) { setMounted(true); return; }
        const leave = () => { setMounted(false); setFailure(null); };
        // Reduced motion squashes the collapse to 0.01ms, so a timer would only
        // leave an invisible card holding the space.
        if (reduceMotion) { leave(); return; }
        const id = setTimeout(leave, 170);
        return () => clearTimeout(id);
    }, [stores, reduceMotion]);

    if (!mounted || !shownStores.current) return null;

    const platform = window.electronAPI?.platform ?? '';

    const resolve = async (choice: StoreChoice) => {
        // The buttons stay focusable while a choice is applying (see keepButton),
        // so a second press has to be refused here.
        if (inFlight.current || !stores) return;
        inFlight.current = true;
        setBusy(choice);
        // A new attempt takes the last refusal away first, whichever block it
        // was on: "nothing was changed" beside "Applying…" would be a claim
        // about a choice that has not been answered yet.
        setFailure(null);
        const attempt = ++attempts.current;
        try {
            const res = await window.electronAPI?.resolveAmbiguousCredentialStores?.(choice);
            if (res?.ok) {
                setStores(null);   // state ended; the card leaves
                return;
            }
            const told = describeResolveFailure(res?.error, choice, platform, t);
            if (told.gone) {
                // Another window answered first, so there is nothing left to
                // choose: re-read the state and leave instead of reporting a failure.
                const now = await window.electronAPI?.getAmbiguousCredentialStores?.();
                setStores(now ?? null);
                return;
            }
            setFailure({ choice, attempt, headline: told.headline, detail: told.detail });
        } catch {
            const told = describeResolveFailure(undefined, choice, platform, t);
            if (!told.gone) setFailure({ choice, attempt, headline: told.headline, detail: told.detail });
        } finally {
            inFlight.current = false;
            setBusy(null);
        }
    };

    const view = compareCredentialStores(shownStores.current, t);
    const idle = busy === null && stores !== null;

    // The label swaps in place and the button keeps the wider one's width.
    // aria-disabled, NOT disabled: a disabled button gives up keyboard focus,
    // so pressing one sent focus to the page and a refused choice left a
    // keyboard or VoiceOver user at the top of the window (heard with VoiceOver,
    // 2026-10-02). The press is refused in resolve() instead.
    // Both set buttons read "Keep this set", so the spoken name carries the
    // set's too; as an aria-label it is one phrase, where a hidden suffix was
    // read with a pause before the colon.
    const keepButton = (choice: StoreChoice, label: string, spoken?: string) => {
        const shown = busy === choice ? t('Applying…') : label;
        return (
            <button
                type="button"
                className="aip-btn shrink-0"
                data-size="sm"
                aria-disabled={!idle}
                aria-label={spoken ? `${shown}: ${spoken}` : undefined}
                onClick={() => resolve(choice)}
            >
                <SwapLabel id={busy === choice ? 'busy' : 'rest'} sizers={[label, t('Applying…')]}>
                    {shown}
                </SwapLabel>
            </button>
        );
    };
    // A refused choice opens inside the block it was about (.aip-reveal) and
    // keeps its words while it closes. It was one red line of text under all
    // three buttons: no icon, not announced, and one sentence for six causes.
    // The words are keyed by attempt: the same refusal twice in a row is new
    // text in the alert, so it is announced again instead of looking (and
    // sounding) as if the second press did nothing.
    const refusal = (choice: StoreChoice) => (
        <div className="aip-reveal aip-reveal--row" data-open={failure?.choice === choice ? 'true' : 'false'}>
            <div>
                <div className="aip-cs-fail" role="alert">
                    <AlertCircle size={13} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
                    <div className="min-w-0" key={shownFailures.current[choice]?.attempt ?? 0}>
                        <p className="aip-cs-fail-head">{shownFailures.current[choice]?.headline}</p>
                        <p className="aip-cs-fail-detail">{shownFailures.current[choice]?.detail}</p>
                    </div>
                </div>
            </div>
        </div>
    );
    const setBlock = (which: 'keyring' | 'fallback') => {
        const other = which === 'keyring' ? 'fallback' : 'keyring';
        const name = credentialStoreName(which, platform, t);
        // The keys the choice decides lead; the ones both sets agree on follow.
        const mine = view.rows
            .filter((r) => r[which] !== null)
            .sort((a, b) => Number(b.differs) - Number(a.differs));
        // The month is written in the app's language when that is not English;
        // in English the system's region decides the order, as it did before.
        const when = formatSavedAt(view[which].savedAt, { locale: lang === 'en' ? undefined : lang });
        const facts = [
            when ? t('Saved {when}').replace('{when}', when) : t('Save time unknown'),
            view.newer === which ? t('newer') : null,
            view[which].others > 0 ? t('other settings: {count}').replace('{count}', String(view[which].others)) : null,
        ].filter(Boolean).join(' · ');
        return (
            <div className="aip-cs-set" role="group" aria-label={name} data-failed={failure?.choice === which ? 'true' : 'false'}>
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="aip-cs-set-name">{name}</p>
                        <p className="aip-meta">{facts}</p>
                    </div>
                    {keepButton(which, t('Keep this set'), name)}
                </div>
                {mine.length === 0
                    ? <p className="aip-meta">{t('No keys could be read from this set.')}</p>
                    : (
                        <ul className="aip-cs-keys">
                            {mine.map((r) => (
                                <li key={r.name} className="aip-cs-key" data-differs={r.differs ? 'true' : 'false'}>
                                    {r.label}
                                    <span className="aip-cs-key-tail">{keyTail(r[which] as string)}</span>
                                    {r.differs && <span className="aip-cs-key-mark">{r[other] === null ? t('only here') : t('differs')}</span>}
                                </li>
                            ))}
                        </ul>
                    )}
                {refusal(which)}
            </div>
        );
    };

    return (
        // Same three boxes as the notice under the header (.aip-dismissable):
        // the grid wrapper animates, the bare item is what reaches zero height.
        // This card is the panel's FIRST child, so it is its trailing gap that
        // has to ride inside the track: pb-5 puts it there, and the negative
        // margin cancels it against the next sibling's own space-y margin, so
        // the gap is 20px at rest and nothing is left over once the card is gone.
        <div className="aip-dismissable" data-leaving={stores ? 'false' : 'true'} style={{ marginBottom: -20 }}>
          <div>
            <div className="pb-5">
            {/* Provider-card anatomy, as the Retrieval notice: neutral card,
                26px tile, 13px title, ONE status badge, 11px description. It was
                a hand-rolled amber box whose text inherited a dark colour, so in
                the dark theme the title and both key lists were near-black on
                dark amber. */}
            <div className="aip-card aip-cs p-5 space-y-3" data-testid="ambiguous-stores-card">
                <div className="flex items-start gap-3">
                    <span className="aip-tile aip-tile--mark" aria-hidden="true">
                        <KeyRound size={16} strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <p className="aip-card-title">{t('Two saved key sets were found')}</p>
                            <AipBadge tone="warn" label={t('Choose one')} />
                        </div>
                        <p className="aip-meta mt-1">
                            {t('This usually follows a restored backup or a move to another computer. Both sets stay in use until you choose, and new keys are saved to the app backup, the weaker of the two.')}
                        </p>
                    </div>
                </div>
                {/* One block per choice, in a well: the set, when it was saved,
                    its keys, and its own button. A key the other set disagrees
                    on is marked in words, so the two can be told apart without
                    reading every ending. */}
                <div className="aip-well">
                    {setBlock('keyring')}
                    {setBlock('fallback')}
                    <div className="aip-cs-set" data-failed={failure?.choice === 'merge' ? 'true' : 'false'}>
                        <div className="flex items-center justify-between gap-3">
                            <p className="aip-meta min-w-0">{t('Or keep both. Where a key differs, the one in the app backup is used.')}</p>
                            {keepButton('merge', t('Keep both'))}
                        </div>
                        {refusal('merge')}
                    </div>
                </div>
                <p className="aip-meta">{t('Both files are copied aside before anything changes.')}</p>
            </div>
            </div>
          </div>
        </div>
    );
};

export const AmbiguousCredentialStoresCard = AmbiguousStoresCard;

/**
 * §5 cross-panel notice: the user has configured a third-party AI provider, but
 * retrieval is still running on a lightweight embedding model.
 *
 * The failure this prevents is silent and easy to misattribute — an excellent
 * generation model still produces a poor answer when the wrong context was
 * retrieved, and the user blames the model or Natively. Non-blocking by design,
 * and "Continue" is permanent: an unstoppable warning becomes something to click
 * past.
 *
 * The predicate lives in the main process (electron/rag/embeddingStatus.ts) so
 * this component never re-derives "is it lightweight" from a model name — an
 * Ollama user on nomic-embed-text must not be nagged.
 */
const LightweightEmbeddingNotice: React.FC<{ onOpenEmbeddings?: () => void }> = ({ onOpenEmbeddings }) => {
    const t = useT();
    const reduceMotion = useReducedMotion();
    const [state, setState] = React.useState<{
        show: boolean;
        model?: string | null;
        dimensions?: number | null;
        location?: 'on-device' | 'cloud' | 'unknown';
        cloudAllowed: boolean;
    }>({ show: false, cloudAllowed: true });
    // Dismissal is two steps: play the collapse, THEN unmount. Without the
    // second state the card would vanish on click and the panel would snap up
    // into the hole.
    const [leaving, setLeaving] = React.useState(false);
    const leaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const s = await window.electronAPI.getEmbeddingStatus?.();
                if (!cancelled && s?.shouldWarn) setState({
                    show: true,
                    model: s.active?.model,
                    dimensions: s.active?.dimensions,
                    location: s.active?.location,
                    // Never dangle a managed cloud key at someone whose scope
                    // forbids cloud embeddings — for them the only real advice
                    // is a stronger LOCAL model.
                    cloudAllowed: s.scopeAllowsCloud !== false,
                });
            } catch { /* best-effort notice */ }
        })();
        return () => { cancelled = true; };
    }, []);

    React.useEffect(() => () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }, []);

    if (!state.show) return null;

    const dismiss = async () => {
        // Persist FIRST: the animation is decoration, the acknowledgement is the
        // thing that must survive a close mid-transition.
        await window.electronAPI.acknowledgeLightweightEmbeddings?.(true);
        // Reduced motion squashes the transition to 0.01ms panel-wide, so a
        // 160ms timer would just leave an invisible card holding its space.
        if (reduceMotion) { setState(s => ({ ...s, show: false })); return; }
        setLeaving(true);
        leaveTimer.current = setTimeout(() => setState(s => ({ ...s, show: false })), 170);
    };

    const detail = [
        // "-d" is a unit, not prose: it stays out of the translation catalogue.
        state.dimensions ? `${state.dimensions}-d` : null,
        state.location === 'on-device' ? t('On-device') : state.location === 'cloud' ? t('Cloud') : null,
    ].filter(Boolean).join(' · ');

    return (
        // Three nested boxes, each load-bearing: the grid wrapper animates,
        // the bare item is the only thing that can actually reach zero height
        // (see .aip-dismissable), and pt-5 inside it puts the card's leading gap
        // INSIDE the collapsing track. The inline margin opts the wrapper out of
        // the parent space-y, whose margin would survive the collapse and land
        // as a 20px jump at unmount.
        //
        // Measured consequence, accepted: the header's own 8px bottom margin
        // (the subtitle's mb-2) escapes and collapses against this wrapper's
        // zero margin, so the gap ABOVE the card reads 28px where every other
        // card gap is 20px. A grid container never self-collapses, so no
        // arrangement of margins here can be both jump-free on exit and exactly
        // 20px at rest — and 8px of extra air before an interruption is the
        // cheaper of the two errors.
        <div
            className="aip-dismissable"
            data-leaving={leaving ? 'true' : 'false'}
            style={{ marginTop: 0 }}
        >
          {/* Bare grid item: anything with padding or a border here floors the
              collapse at that box's own height. */}
          <div>
            <div className="pt-5">
            {/* No entrance animation of its own. This wrapper is a direct child
                of `[data-settings-stagger]`, so `settings-stagger-in` (220ms,
                the same ease-out) already plays when the card is inserted —
                which is the moment that matters here, since the card mounts a
                beat after the panel does, on an IPC round-trip. Adding
                `.aip-panel-fade` underneath would be two entrances for one
                arrival. */}
            <div className="aip-card p-5 space-y-3">
                {/* Provider-card anatomy, verbatim: 26px tile, 13px title, one
                    status badge, 11px description hanging off the tile gutter.
                    That shape is what makes a card in this panel look like it
                    belongs to this panel. `.aip-tile--mark` is the NEUTRAL tile
                    (button fill, hairline border, currentColor glyph) rather
                    than the brand-tinted monogram — there is no brand here. */}
                <div className="flex items-start gap-3">
                    <span className="aip-tile aip-tile--mark" aria-hidden="true">
                        <Boxes size={16} strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <p className="aip-card-title">{t('Retrieval still uses a lightweight model')}</p>
                            {/* One status primitive, as everywhere else here. */}
                            <AipBadge tone="warn" label={t('Embeddings')} />
                        </div>
                        {/* Two plain sentences: the stake first, then the fix.
                            No em-dash aside — a parenthetical inside an 11px
                            line is a speed bump, and it was carrying the part
                            the reader most needs.
                            It also no longer sells the Natively key. Embeddings
                            run on any provider in the catalogue (OpenAI, Gemini,
                            Voyage, OpenRouter, Ollama, a custom endpoint), so
                            naming one of them here was both a plug and wrong. */}
                        <p className="aip-meta mt-1">
                            {state.cloudAllowed
                                ? t('Every answer is built on what retrieval finds. A stronger embedding model finds your code and documents more accurately, locally or through any provider you have set up.')
                                : t('Every answer is built on what retrieval finds. A stronger local embedding model finds your code and documents more accurately.')}
                        </p>
                    </div>
                </div>
                {/* The model as a well, not as prose. It is the evidence behind
                    the word "lightweight", so it gets the panel's recessed
                    surface and its real numbers — 384 dimensions is what makes
                    the claim checkable instead of an assertion. */}
                <div className="aip-well px-3 py-2 flex items-center justify-between gap-3">
                    <span className="aip-mono truncate">{state.model || 'MiniLM'}</span>
                    {detail && <span className="aip-count shrink-0">{detail}</span>}
                </div>
                {/* The Antigravity/Codex action bar, verbatim: `flex-1` +
                    data-size="row" on the action, `shrink-0` + the same row
                    height beside it. Two auto-width pills left-aligned under a
                    576px card left half the row empty and read as leftovers;
                    a filled 34px bar reads as the card's footer, and it is the
                    shape this panel already uses for a card's primary action.
                    NEUTRAL, like every button here. Not data-variant="accent":
                    the accent tint is periwinkle in this panel's token scope,
                    and both sign-in bars refuse it for exactly that reason.
                    `ghost` is not the answer for the dismiss either: no border,
                    no fill, and this dismissal is permanent, so an escape hatch
                    that reads as a caption is an unstoppable warning from the
                    other side. Width and order carry the hierarchy. */}
                <div className="aip-provider-row">
                    <button
                        type="button"
                        className="aip-btn flex-1"
                        data-size="row"
                        onClick={() => onOpenEmbeddings?.()}
                    >
                        {t('Choose an embedding model')}
                    </button>
                    <button
                        type="button"
                        className="aip-btn shrink-0"
                        data-size="row"
                        onClick={dismiss}
                    >
                        {t('Keep MiniLM')}
                    </button>
                </div>
            </div>
            </div>
          </div>
        </div>
    );
};

// Unified Codex sign-in: Natively's own (source 'natively') or the Codex CLI's
// `codex login`, used read-only (source 'codex-cli'). `cliLogin` is the CLI
// session's state either way, for the expired-login hint.
type CodexSignInStatus = { signedIn: boolean; source?: 'natively' | 'codex-cli' | null; cliLogin?: string; email?: string; expiresAt?: number };

const readCodexSignInStatus = async (): Promise<CodexSignInStatus | null> => {
    const status = await window.electronAPI?.codexLoginStatus?.().catch(() => null);
    if (!status?.success) return null;
    return { signedIn: !!status.signedIn, source: status.source ?? null, cliLogin: status.cliLogin, email: status.email, expiresAt: status.expiresAt };
};

/** Key-backed vendors among LLMHelper's AUTO_FAST_TIERS (Groq, DeepSeek Flash,
    Gemini Flash-Lite, GPT-5.5, Claude Haiku). Natively and Codex, the other two
    candidates, are checked by their own sign-in state. */
const AUTO_FAST_VENDORS = ['groq', 'deepseek', 'gemini', 'openai', 'claude'] as const;

export const AIProvidersSettings: React.FC<AIProvidersSettingsProps> = ({
    aiResponseLanguage,
    availableAiLanguages,
    isAiLangDropdownOpen,
    onToggleAiLangDropdown,
    onSelectAiLanguage,
    aiLangDropdownRef,
    onNavigate,
}) => {
    const t = useT();
    // Mirrors document.documentElement[data-theme] through the shared
    // MutationObserver, so `.aip-root[data-theme='light']` flips with the app.
    const theme = useResolvedTheme();
    // --- Standard Providers ---
    const [apiKey, setApiKey] = useState('');
    const [groqApiKey, setGroqApiKey] = useState('');
    const [openaiApiKey, setOpenaiApiKey] = useState('');
    const [claudeApiKey, setClaudeApiKey] = useState('');
    const [deepseekApiKey, setDeepseekApiKey] = useState('');
    const [nvidiaNimApiKey, setNvidiaNimApiKey] = useState('');
    const [openrouterApiKey, setOpenrouterApiKey] = useState('');
    const [fluxionApiKey, setFluxionApiKey] = useState('');
    const [agentrouterApiKey, setAgentrouterApiKey] = useState('');
    /**
     * Which wire protocol the user's Fluxion key speaks, which is a property
     * of the KEY'S GROUP and is not discoverable from the key itself. Held in
     * component state (not just written on save) because the card has to show
     * the stored value when the panel re-opens — a silently wrong protocol is
     * exactly the failure this control exists to prevent.
     */
    const [fluxionProtocol, setFluxionProtocol] = useState<'openai' | 'anthropic'>('openai');
    /**
     * The active speech provider, so the remove-key confirmation can warn when
     * the NVIDIA key it is about to delete is ALSO the one speech is using —
     * one nvapi- credential authenticates both.
     */
    const [activeSttProvider, setActiveSttProvider] = useState<string>('none');
    /**
     * Whether embeddings or reranking are currently running on OpenRouter, so the
     * remove-key confirmation can warn BEFORE the click that deleting the key
     * also takes retrieval down with it — the same "say it first, don't let them
     * discover it later" rule the NVIDIA/speech warning follows. One OpenRouter
     * credential backs chat, embeddings and reranking.
     */
    const [openrouterBacksRetrieval, setOpenrouterBacksRetrieval] = useState(false);
    const openrouterBacksRetrievalRef = useRef(false);
    /**
     * Re-reads whether retrieval runs on OpenRouter. A mount-time read alone was
     * NOT enough: saving the key activates OpenRouter reranking asynchronously,
     * so the value read at load went stale the moment a key was saved in this
     * session (reproduced live 2026-09-17 — reranker 'openrouter', dialog copy
     * still generic). Called at load, after an OpenRouter save, and again when
     * the remove dialog opens. A failed read keeps the last known value rather
     * than inventing or dropping a warning.
     */
    const refreshOpenrouterRetrievalCoupling = async (): Promise<boolean> => {
        try {
            const [embedding, reranker]: any[] = await Promise.all([
                window.electronAPI?.getEmbeddingStatus?.().catch(() => null),
                window.electronAPI?.getRerankerStatus?.().catch(() => null),
            ]);
            if (!embedding && !reranker) return openrouterBacksRetrievalRef.current;
            const backs = embedding?.active?.provider === 'openrouter' || reranker?.provider === 'openrouter';
            openrouterBacksRetrievalRef.current = backs;
            setOpenrouterBacksRetrieval(backs);
            return backs;
        } catch {
            return openrouterBacksRetrievalRef.current;
        }
    };


    // Binds the key fields to the CLOUD_PROVIDERS table. The useState calls stay
    // separate (they are read individually elsewhere); this is only the lookup the
    // render map needs, so adding a provider is a table row plus one line here.
    const keyFields: Record<CloudProviderId, [string, (v: string) => void]> = {
        gemini: [apiKey, setApiKey],
        groq: [groqApiKey, setGroqApiKey],
        openai: [openaiApiKey, setOpenaiApiKey],
        claude: [claudeApiKey, setClaudeApiKey],
        deepseek: [deepseekApiKey, setDeepseekApiKey],
        nvidia_nim: [nvidiaNimApiKey, setNvidiaNimApiKey],
        openrouter: [openrouterApiKey, setOpenrouterApiKey],
        fluxion: [fluxionApiKey, setFluxionApiKey],
        agentrouter: [agentrouterApiKey, setAgentrouterApiKey],
    };

    // --- LiteLLM proxy (OpenAI-compatible gateway: baseURL + optional virtual key) ---
    const [litellmBaseURL, setLitellmBaseURL] = useState('');
    const [litellmApiKey, setLitellmApiKey] = useState('');
    // Max output tokens for proxied models. '' = Auto: per-model budget from the
    // proxy's /model/info (standard registry value), falling back to 8192.
    const [litellmMaxTokens, setLitellmMaxTokens] = useState('');
    const [litellmModels, setLitellmModels] = useState<string[]>([]);
    const [isRefreshingLitellm, setIsRefreshingLitellm] = useState(false);
    // --- 9Router (self-hosted OpenAI-compatible fallback proxy: baseURL + optional key) ---
    const [ninerouterBaseURL, setNinerouterBaseURL] = useState('');
    const [ninerouterApiKey, setNinerouterApiKey] = useState('');
    const [ninerouterMaxTokens, setNinerouterMaxTokens] = useState('');
    const [ninerouterModels, setNinerouterModels] = useState<string[]>([]);
    const [isRefreshingNinerouter, setIsRefreshingNinerouter] = useState(false);
    // Test Connection result. Kept separate from savingStatus because it answers a
    // different question: Save persists, this proves the instance will actually
    // answer. On 9Router those are genuinely different outcomes — /v1/models
    // responds without a key while /v1/chat/completions does not.
    const [ninerouterTest, setNinerouterTest] = useState<{ testing: boolean; ok?: boolean; message?: string }>({ testing: false });
    const [ninerouterThinking, setNinerouterThinking] = useState('');
    // Per-model reasoning capability from the catalogue, so the thinking
    // dropdown offers what THIS model can actually do.
    const [ninerouterModelMeta, setNinerouterModelMeta] = useState<Record<string, { reasoning?: boolean; thinkingCanDisable?: boolean; thinkingFormat?: string }>>({});
    // Provider visibility filters. `disabledProviders` hides a provider's models
    // without touching its stored credential; `cloudEnabledModels[prov]` narrows
    // which of that provider's models reach the picker (empty = all).
    const [disabledProviders, setDisabledProviders] = useState<string[]>([]);
    const [cloudEnabledModels, setCloudEnabledModelsState] = useState<Record<string, string[]>>({});
    // Per-provider catalog, as last fetched from the provider API. Persisted in
    // CredentialsManager so it survives the settings-tab switch that unmounts this
    // panel (SettingsOverlay renders it behind `activeTab === 'ai-providers' &&`).
    const [cloudFetchedModels, setCloudFetchedModels] = useState<Record<string, AipModelEntry[]>>({});
    const [cloudFetchedAt, setCloudFetchedAt] = useState<Record<string, number>>({});
    const [modelSaveError, setModelSaveError] = useState<Record<string, boolean>>({});

    // Status
    const [savedStatus, setSavedStatus] = useState<Record<string, boolean>>({});
    const [savingStatus, setSavingStatus] = useState<Record<string, boolean>>({});
    const [hasStoredKey, setHasStoredKey] = useState<Record<string, boolean>>({});
    const [testStatus, setTestStatus] = useState<Record<string, 'idle' | 'testing' | 'success' | 'error'>>({});
    const [testError, setTestError] = useState<Record<string, string>>({});
    /**
     * A key write the main process REFUSED (e.g. `credential_store_degraded`).
     * Before this, a failed save only stopped the spinner, so the user had no
     * way to tell a refused key from a saved one. Cleared on the next attempt.
     */
    const [keyWriteError, setKeyWriteError] = useState<Record<string, string>>({});
    const keyWriteFailureText = (result: { error?: string; message?: string } | undefined, action: 'save' | 'remove'): string =>
        result?.error === 'credential_store_degraded'
            ? (action === 'save'
                ? t('Could not save the key: your credential store is unavailable this session. Restart Natively and try again.')
                : t('Could not remove the key: your credential store is unavailable this session. Restart Natively and try again.'))
            : (result?.message || result?.error || (action === 'save' ? t('Could not save the key.') : t('Could not remove the key.')));

    // --- Custom Providers ---
    const [customProviders, setCustomProviders] = useState<CustomProvider[]>([]);
    const [isEditingCustom, setIsEditingCustom] = useState(false);
    const [editingProvider, setEditingProvider] = useState<CustomProvider | null>(null);
    const [customName, setCustomName] = useState('');
    const [customCurl, setCustomCurl] = useState('');
    const [customResponsePath, setCustomResponsePath] = useState('');
    // 'auto' = detect vision support from the template; 'on'/'off' = explicit override.
    const [customVision, setCustomVision] = useState<'auto' | 'on' | 'off'>('auto');
    const [curlError, setCurlError] = useState<string | null>(null);

    // --- Local (Ollama) ---
    const [ollamaModels, setOllamaModels] = useState<string[]>([]);
    // Whether a denied scope would ACTUALLY be handled on-device — answered by the
    // main process (LLMHelper.scopeFallbackAvailable) so this shares the enforcement
    // predicate instead of re-deriving it. Split because the gate passes
    // needsVision=true only for screenshots. Starts false/false so the privacy UI
    // never promises on-device handling before it knows.
    const [localFallback, setLocalFallback] = useState<{ text: boolean; vision: boolean }>({ text: false, vision: false });
    const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'detected' | 'not-found' | 'fixing'>('checking');
    // "Reads images" for the installed Ollama models (their rows are not an AipModelList).
    const ollamaVisionIds = useMemo(() => ollamaModels.map(m => `ollama-${m}`), [ollamaModels]);
    const ollamaVision = useVisionStates(ollamaVisionIds, ollamaStatus === 'detected');
    const [ollamaVisionOpen, setOllamaVisionOpen] = useState<string | null>(null);
    const [ollamaRestarted, setOllamaRestarted] = useState(false);
    const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
    const [confirmBusy, setConfirmBusy] = useState(false);
    const [activeTab, setActiveTab] = useState<ProviderTabId>('cloud');
    // Index drives the pill's spring target; -1 can't happen (state is typed to
    // the tab ids) but Math.max keeps a bad persisted value from shifting it off-track.
    const activeTabIndex = Math.max(0, PROVIDER_TABS.findIndex((tab) => tab.id === activeTab));
    const [isRefreshingOllama, setIsRefreshingOllama] = useState(false);
    // Roving tabindex: only the selected tab is a tab stop, so Arrow/Home/End
    // are the ONLY way to reach the other two. Without this a keyboard user
    // landed on the active tab and could never leave it.
    const tabRefs = useRef<Partial<Record<ProviderTabId, HTMLButtonElement | null>>>({});
    // Gates the tablist pill's spring only. Every other animation in this file
    // is CSS and is already covered by the .aip-root reduced-motion block.
    const prefersReducedMotion = useReducedMotion();

    const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        const navKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
        if (!navKeys.includes(event.key)) return;
        event.preventDefault();

        const current = Math.max(0, PROVIDER_TABS.findIndex((tab) => tab.id === activeTab));
        let nextIndex: number;
        if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = PROVIDER_TABS.length - 1;
        else {
            const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
            nextIndex = (current + delta + PROVIDER_TABS.length) % PROVIDER_TABS.length;
        }

        const nextId = PROVIDER_TABS[nextIndex].id;
        setActiveTab(nextId);
        // Automatic activation: focus follows selection. The target button only
        // becomes a tab stop after React re-renders, hence the rAF.
        requestAnimationFrame(() => tabRefs.current[nextId]?.focus());
    };

    // --- Local (Codex CLI) ---
    const [codexCliConfig, setCodexCliConfig] = useState({ enabled: false, path: 'codex', model: 'gpt-5.5', timeoutMs: 60000, sandboxMode: 'read-only' as string, serviceTier: 'default', modelReasoningEffort: undefined as string | undefined });
    // The installed Codex CLI's model list (models_cache.json); null until read.
    const [codexModelCatalog, setCodexModelCatalog] = useState<CodexModelCatalogResult | null>(null);
    const [codexModelsRefreshing, setCodexModelsRefreshing] = useState(false);
    const codexModels = codexModelOptions(codexModelCatalog);
    const codexModelsFromCli = codexModelCatalog?.source === 'codex-cli' && codexModelCatalog.models.length > 0;
    const [codexCliStatus, setCodexCliStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [codexCliError, setCodexCliError] = useState('');
    const [codexAuthAction, setCodexAuthAction] = useState<'idle' | 'status' | 'logout' | 'login' | 'doctor'>('idle');
    const [codexAuthStatus, setCodexAuthStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [codexAuthMessage, setCodexAuthMessage] = useState('');

    // --- ChatGPT OAuth (new — replaces `codex login` CLI subprocess) ---
    // The OAuth flow runs entirely in the main process; the renderer just
    // kicks it off and listens for IPC events. We keep the auth state
    // visible so the user can see who's signed in and re-auth / sign out
    // without leaving Settings.
    const [codexOauthStatus, setCodexOauthStatus] = useState<CodexSignInStatus>({ signedIn: false });
    const [codexOauthInProgress, setCodexOauthInProgress] = useState(false);
    const [antigravityStatus, setAntigravityStatus] = useState({ signedIn: false, inProgress: false, expiresAt: undefined as number | undefined });
    const [antigravityModels, setAntigravityModels] = useState<{ id: string; label: string }[]>([]);
    const [antigravityError, setAntigravityError] = useState('');
    const [antigravityBusy, setAntigravityBusy] = useState(false);
    const antigravityLoad = useRef(0);

    useEffect(() => window.electronAPI.onAntigravityStatusChanged?.((status) => {
        ++antigravityLoad.current;
        setAntigravityStatus({ signedIn: status.signedIn, inProgress: status.inProgress, expiresAt: status.expiresAt });
        if (!status.signedIn) setAntigravityModels([]);
        setAntigravityError(status.error || '');
    }), []);

    const loadAntigravity = async (force = false) => {
        const run = ++antigravityLoad.current;
        if (!window.electronAPI.antigravityStatus) return;
        try {
            const status = await window.electronAPI.antigravityStatus();
            const result = status.signedIn ? await window.electronAPI.antigravityModels(force) : null;
            if (run !== antigravityLoad.current) return;
            setAntigravityStatus({ signedIn: status.signedIn, inProgress: status.inProgress, expiresAt: status.expiresAt });
            if (!status.signedIn || result?.success) setAntigravityModels(result?.models || []);
            setAntigravityError(result?.error || status.error || '');
        } catch {
            if (run === antigravityLoad.current) setAntigravityError(t('Could not load Antigravity status. Try again.'));
        }
    };

    const runAntigravityAction = async (action: 'login' | 'logout' | 'models') => {
        setAntigravityBusy(true);
        setAntigravityError('');
        try {
            if (action === 'models') { await loadAntigravity(true); return; }
            const result = await (action === 'login' ? window.electronAPI.antigravityStartLogin()
                : window.electronAPI.antigravitySignOut());
            await loadAntigravity();
            if (!result.success) setAntigravityError(result.error || t('Antigravity request failed. Try again.'));
        } catch {
            setAntigravityError(t('Could not reach Antigravity. Try again.'));
        } finally { setAntigravityBusy(false); }
    };

    // --- Default Model ---
    // UNION, not a pick. 3.8-flash is this branch's bump and main has no
    // reference to it at all (IntelligenceManager.ts, LLMHelper.ts, re-probed
    // 2026-09-03), so the model default takes the branch side; the three
    // Direct Assist states are main's and are additive.
    const [defaultModel, setDefaultModel] = useState<string>('gemini-3.8-flash');
    // 'auto' means unset: use the measured per-provider ladder, not a slow default.
    const [fastModel, setFastModel] = useState<string>('auto');
    // Only the ids the fast path can actually dispatch. Main owns the provider
    // classifiers, so we ASK it rather than re-deriving them here - a second copy
    // would drift, and drift here means offering a pick that silently does nothing.
    // null = not answered yet.
    const [fastModelDispatchable, setFastModelDispatchable] = useState<string[] | null>(null);
    const [directAssistEnabled, setDirectAssistEnabled] = useState(false);
    const [directAssistBusy, setDirectAssistBusy] = useState(false);
    const [directAssistError, setDirectAssistError] = useState('');
    const [fastResponseMode, setFastResponseMode] = useState(false);
    const [credentialsLoaded, setCredentialsLoaded] = useState(false);
    // Card rows that open on a saved key stay still while the stored ones load.
    const motionReady = useMotionReadyAfter(credentialsLoaded);
    // Fast Response Mode answers with the Background Model when one is picked
    // (LLMHelper.openFastModelStream). On Auto it is the fastest connected
    // candidate by this computer's own measurements (LLMHelper.autoFastPick) —
    // Groq, DeepSeek, Gemini, Natively, OpenAI, Codex or Claude — so no
    // particular provider is required.
    // `disabledProviders`, not isProviderEnabled(): that is declared further down.
    // Availability reads the PICK, not fastModelDispatchable: that list arrives
    // asynchronously after credentials load, and the enforcement effect below
    // would persist the switch OFF in the gap.
    const hasFastModelPick = fastModel !== 'auto';
    // AVAILABILITY is key-based, ignoring the provider on/off switches: it drives
    // the effect below that saves Fast Response OFF, and switching Groq off for a
    // moment must not wipe the user's Fast Response setting for good. Whether it
    // APPLIES right now (switches included) is the mirror further down.
    const hasAutoFastKey = AUTO_FAST_VENDORS.some((p) => !!hasStoredKey[p]);
    const canUseFastMode = !!(hasFastModelPick || hasAutoFastKey || hasStoredKey.groq || hasStoredKey.natively || (codexCliConfig.enabled && codexOauthStatus.signedIn));
    // A candidate Auto can use NOW — LLMHelper.fastFamilyReady(): key or sign-in
    // AND switched on (Codex: isCodexAvailable() reads its switch too).
    const hasAutoCandidate = AUTO_FAST_VENDORS.some((p) => hasStoredKey[p] && !disabledProviders.includes(p))
        || (!!hasStoredKey.natively && !disabledProviders.includes('natively'))
        || (codexCliConfig.enabled && codexOauthStatus.signedIn && !disabledProviders.includes('codex-cli'));
    // Mirror of LLMHelper.activeIsSelfHosted(): on Auto, a turn for the user's
    // own endpoint never goes to another vendor.
    const activeIsSelfHosted = defaultModel.startsWith('litellm/') || defaultModel.startsWith('ninerouter/')
        || customProviders.some((p) => p.id === defaultModel);
    // Mirror of LLMHelper's fast gates. A dispatchable pick applies to any
    // Active Model except a local one. Auto applies to any Active Model except a
    // local one, an explicitly chosen Codex model (issue #315) or the user's own
    // endpoint. Antigravity answers before either. Availability
    // (canUseFastMode) is about keys and the pick; this is about the MODEL, and
    // it is what the inline hint below tells the user.
    // An unanswered dispatchable list (null) is not "unavailable" — it is still
    // loading, and saying otherwise flashes the warning on every open.
    const fastModelPickApplies = hasFastModelPick
        && (fastModelDispatchable === null || fastModelDispatchable.includes(fastModel))
        && !defaultModel.startsWith('ollama-');
    // Only a gateway-only (or keyless) install lands here: gateways have no fast
    // tier of their own, so the user names one in Background Model. With nothing
    // to pick yet — no key, or an opt-in gateway (OpenRouter, LiteLLM) with no
    // model ticked — the fix is in the provider cards below.
    const fastModeUnavailableNote = fastModelDispatchable?.length
        ? t('Pick a Background Model to turn this on.')
        : t('Add a cloud model below, then pick it as the Background Model.');
    const autoFastTierApplies = !hasFastModelPick && hasAutoCandidate && !activeIsSelfHosted
        && !defaultModel.startsWith('ollama-') && !defaultModel.startsWith('codex-cli');
    const fastModeAppliesToActiveModel = !defaultModel.startsWith('antigravity:') && (fastModelPickApplies || autoFastTierApplies);

    // --- Dynamic Model Discovery ---
    const [preferredModels, setPreferredModels] = useState<Record<string, string>>({});

    // --- Screen Understanding (vision routing) ---
    const [screenUnderstandingMode, setScreenUnderstandingMode] = useState<'vision_first' | 'vision_only' | 'private_vision'>('vision_first');
    const [technicalInterviewVisionFirst, setTechnicalInterviewVisionFirst] = useState<boolean>(true);

    // --- Cloud Provider Data Scopes (fail-closed cloud share controls) ---
    // The scope badges below pop in when a row is switched off, but not while
    // the saved scopes are still arriving (their own read, not credentials').
    const [scopesLoaded, setScopesLoaded] = useState(false);
    const scopesMotionReady = useMotionReadyAfter(scopesLoaded);
    const [providerDataScopes, setProviderDataScopes] = useState<{ transcript?: boolean; screenshots?: boolean; reference_files?: boolean; profile_history?: boolean; embeddings?: boolean; post_call_summary?: boolean }>({});

    // `screenUnderstandingMode` is one enum with three values, but it answers two
    // independent user questions. Presenting it as three radios forced the user to
    // read our provider-fallback architecture; presenting it as two switches asks
    // what they actually care about.
    //
    //   local-only OFF + require OFF  -> 'vision_first'   (cascade, most permissive)
    //   local-only OFF + require ON   -> 'vision_only'    (never silently drop)
    //   local-only ON                 -> 'private_vision' (local vision only)
    //
    // 'private_vision' already requires a local vision provider, so the require
    // switch is implied — and disabled — while local-only is on. Both switches stay
    // in ONE card on purpose: they write the same enum, so splitting them across
    // tabs would let one clobber the other's choice.
    const visionLocalOnly = screenUnderstandingMode === 'private_vision';
    const visionRequired = screenUnderstandingMode === 'vision_only' || visionLocalOnly;

    // Three enum values, two switches — so 'private_vision' cannot represent what
    // the "Require" switch was set to before local-only was turned on. Deriving it
    // (`visionRequired` above is true whenever local-only is) meant turning
    // local-only back OFF resolved `required` as true and landed on 'vision_only',
    // never 'vision_first'. A switch the user never touched silently latched ON and
    // there was no UI path back to the default. Remembering the pre-local-only
    // value restores the round-trip WITHIN A MOUNT — this is a ref, not persisted
    // state, so closing Settings between the two toggles loses it and leaving
    // local-only lands on 'vision_first'. That is the safe direction (the old bug
    // latched "Require" ON with no way back); persisting it would need a second
    // stored field, which the enum deliberately does not have.
    const requiredBeforeLocalOnly = useRef<boolean | null>(null);

    const applyVisionMode = async (localOnly: boolean, required: boolean) => {
        // Snapshot what a refused write has to be rolled back TO. Both of these
        // are mutated below, so capture before, not after.
        const previousMode = screenUnderstandingMode;
        const previousRequiredBefore = requiredBeforeLocalOnly.current;

        let effectiveRequired = required;
        if (localOnly && !visionLocalOnly) {
            // Entering local-only: stash what "Require" really was, since the
            // enum is about to stop being able to express it.
            requiredBeforeLocalOnly.current = screenUnderstandingMode === 'vision_only';
        } else if (!localOnly && visionLocalOnly) {
            // Leaving local-only: restore it rather than reading it back off the
            // derived value, which is unconditionally true while local-only is on.
            effectiveRequired = requiredBeforeLocalOnly.current ?? false;
            requiredBeforeLocalOnly.current = null;
        }
        const mode = localOnly ? 'private_vision' : (effectiveRequired ? 'vision_only' : 'vision_first');
        setScreenUnderstandingMode(mode);

        // CR-04 follow-up: the handler refuses when the settings store is degraded
        // and — correctly — no longer broadcasts, so the
        // onScreenUnderstandingModeChanged subscription that normally re-converges
        // this component never fires. Setting local state optimistically and
        // ignoring the result therefore left THIS window showing a privacy mode
        // that was never saved, while main and disk held the old one. On a setting
        // whose copy promises "cloud vision is never called", a mode the UI only
        // THINKS it is in is not cosmetic. Roll back on refusal.
        try {
            const res = await window.electronAPI?.setScreenUnderstandingMode?.(mode);
            if (res && res.success === false) {
                setScreenUnderstandingMode(previousMode);
                requiredBeforeLocalOnly.current = previousRequiredBefore;
                console.warn('[AIProviders] screen-understanding mode was not saved:', res.error);
            }
        } catch (e) {
            // Now that this is awaited, a rejected IPC would surface as an
            // unhandled rejection from an onChange handler. A failed write must
            // roll the switch back for the same reason a refused one does.
            setScreenUnderstandingMode(previousMode);
            requiredBeforeLocalOnly.current = previousRequiredBefore;
            console.warn('[AIProviders] screen-understanding mode write failed:', e);
        }
    };

    // Where a disabled scope's data actually goes. Must match ENFORCEMENT
    // (LLMHelper.scopeFallbackAvailable), not `ollamaModels.length > 0` — which
    // counted `nomic-embed-text` as a vision fallback AND ignored that the gate
    // only fires when Ollama is the selected provider.
    // The gate computes needsVision ONCE PER TURN, as
    // `deniedOutboundScopes.includes('screenshots')` — not per scope. So when
    // Screenshots is also denied, a turn carrying an image resolves the local
    // fallback for EVERY denied scope against the vision-capable predicate.
    // Keying each row on its own scope in isolation over-promised: with
    // Transcripts+Screenshots off and a text-only Ollama, the Transcripts row
    // claimed "On-device" while the real gate refused the turn.
    const localFallbackFor = (key: string) =>
        (key === 'screenshots' || providerDataScopes.screenshots === false)
            ? localFallback.vision
            : localFallback.text;
    // Card-level shorthand: the Screenshots card is about images, so it asks the
    // vision question.
    const localFallbackAvailable = localFallback.vision;
    const disabledScopeCount = SCOPE_ROWS.filter(r => providerDataScopes[r.key] === false).length;

    // Load Initial Data
    useEffect(() => {
        const loadCredentials = async () => {
            try {
                setCredentialsLoaded(false);
                // Load credentials FIRST so canUseFastMode is correct before we set fastResponseMode.
                // If we set fastResponseMode before hasStoredKey is populated, the enforcement
                // effect below fires with canUseFastMode=false and immediately resets fast mode
                // to false — writing that reset back to SettingsManager on every startup.
                //
                // The persisted default model is read in the SAME round trip, not after
                // the Codex / Antigravity / custom-provider loads below. Read last, the
                // `useState` initial value stayed on screen for that whole chain, and
                // once hasStoredKey made it a real option (any Gemini key does) the
                // Active Model picker showed Gemini for a beat before switching to the
                // actual default, e.g. Natively API. Both setters now land in one render.
                const [creds, persistedDefault] = await Promise.all([
                    // @ts-ignore
                    window.electronAPI?.getStoredCredentials?.(),
                    window.electronAPI?.getDefaultModel?.().catch(() => null),
                ]);
                if (persistedDefault?.model) setDefaultModel(persistedDefault.model);
                if (creds) {
                    setHasStoredKey({
                        gemini: creds.hasGeminiKey,
                        groq: creds.hasGroqKey,
                        openai: creds.hasOpenaiKey,
                        claude: creds.hasClaudeKey,
                        deepseek: creds.hasDeepseekKey || false,
                        nvidia_nim: creds.hasNvidiaNimKey || false,
                        openrouter: (creds as any).hasOpenrouterKey || false,
                        fluxion: (creds as any).hasFluxionKey || false,
                        agentrouter: (creds as any).hasAgentRouterKey || false,
                        litellm: creds.hasLitellmBaseURL || false,
                        // Base URL, not key: a stock 9Router runs keyless.
                        ninerouter: (creds as any).hasNinerouterBaseURL || false,
                        natively: creds.hasNativelyKey || false
                    });
                    setActiveSttProvider((creds as any).sttProvider || 'none');
                    // Prefill stored LiteLLM config so re-saving doesn't silently reset it.
                    // (baseURL is config, not a secret; the key stays masked/blank = keep.)
                    // Also clear the fields when another window removes the proxy.
                    setLitellmBaseURL(creds.litellmBaseURL || '');
                    setLitellmMaxTokens(creds.litellmMaxTokens ? String(creds.litellmMaxTokens) : '');
                    setNinerouterBaseURL((creds as any).ninerouterBaseURL || '');
                    setNinerouterMaxTokens((creds as any).ninerouterMaxTokens ? String((creds as any).ninerouterMaxTokens) : '');
                    setNinerouterThinking((creds as any).ninerouterThinking || '');
                    setNinerouterModelMeta((creds as any).ninerouterModelMeta || {});
                    // Load preferred models
                    const pm: Record<string, string> = {};
                    if (creds.geminiPreferredModel) pm.gemini = creds.geminiPreferredModel;
                    if (creds.groqPreferredModel) pm.groq = creds.groqPreferredModel;
                    if (creds.openaiPreferredModel) pm.openai = creds.openaiPreferredModel;
                    if (creds.claudePreferredModel) pm.claude = creds.claudePreferredModel;
                    if (creds.deepseekPreferredModel) pm.deepseek = creds.deepseekPreferredModel;
                    if (creds.nvidia_nimPreferredModel) pm.nvidia_nim = creds.nvidia_nimPreferredModel;
                    // Already prefixed on disk (`openrouter/<vendor>/<model>`), the same
                    // form the model list renders — see the LiteLLM note below.
                    if ((creds as any).openrouterPreferredModel) pm.openrouter = (creds as any).openrouterPreferredModel;
                    // Already prefixed on disk (`fluxion/<model>`), same rule as above.
                    if ((creds as any).fluxionPreferredModel) pm.fluxion = (creds as any).fluxionPreferredModel;
                    // Already prefixed on disk (`agentrouter/<model>`), same rule.
                    if ((creds as any).agentrouterPreferredModel) pm.agentrouter = (creds as any).agentrouterPreferredModel;
                    // Only adopt the stored protocol when a key actually exists.
                    // loadCredentials re-runs on EVERY credentials-changed broadcast —
                    // saving a Gemini key on another card fires one — and an
                    // unconditional set silently reverted a protocol the user had
                    // picked but not yet saved (there is nothing to persist against
                    // before a key exists). They would then hit Save and ship the
                    // default they had explicitly opted out of, with the UI agreeing
                    // with disk so nothing looked wrong. With a key stored the stored
                    // value IS the truth, so cross-window sync still converges.
                    if ((creds as any).hasFluxionKey) {
                        setFluxionProtocol((creds as any).fluxionProtocol === 'anthropic' ? 'anthropic' : 'openai');
                    }
                    // Already prefixed on disk (`litellm/<model>`), which is the id the
                    // LiteLLM model list renders — no re-prefixing here or the star lands
                    // on no row at all.
                    if (creds.litellmPreferredModel) pm.litellm = creds.litellmPreferredModel;
                    // Already prefixed on disk (`ninerouter/<alias>/<model>`), same rule.
                    if ((creds as any).ninerouterPreferredModel) pm.ninerouter = (creds as any).ninerouterPreferredModel;
                    setDisabledProviders(Array.isArray(creds.disabledProviders) ? creds.disabledProviders : []);
                    setCloudEnabledModelsState(creds.cloudEnabledModels || {});
                    window.electronAPI?.getCloudFetchedModels?.()
                        .then((res: { models?: Record<string, AipModelEntry[]>; fetchedAt?: Record<string, number> }) => {
                            if (res?.models) setCloudFetchedModels(res.models);
                            if (res?.fetchedAt) setCloudFetchedAt(res.fetchedAt);
                        })
                        .catch(() => {});
                    setPreferredModels(pm);

                    // Is retrieval actually running on OpenRouter right now? Only
                    // asked when a key exists, so an install that has never seen
                    // OpenRouter makes no IPC calls. Both are best-effort: a
                    // failure leaves the flag false, which downgrades the remove
                    // dialog to its generic copy rather than inventing a warning.
                    if ((creds as any).hasOpenrouterKey) void refreshOpenrouterRetrievalCoupling();
                }

                // Now it's safe to read fast mode — hasStoredKey is already set so
                // canUseFastMode will be correct when the enforcement effect runs.
                // @ts-ignore
                const cliConfig = await window.electronAPI?.getCodexCliConfig?.();
                if (cliConfig) setCodexCliConfig(cliConfig as typeof codexCliConfig);
                const cliCatalog = await window.electronAPI?.getCodexCliModels?.().catch(() => null);
                if (cliCatalog) setCodexModelCatalog(cliCatalog);

                // Codex OAuth status — read once on mount so the Settings UI
                // shows the right state without waiting for a user click.
                const signIn = await readCodexSignInStatus();
                if (signIn) {
                    setCodexOauthStatus(signIn);
                    // A `codex login` session makes Codex usable with no sign-in
                    // step in Natively, so nothing else would flip `enabled` on
                    // (Natively's own sign-in does it in onCodexLoginComplete).
                    // The provider switch on the card stays the user's off switch.
                    if (signIn.source === 'codex-cli' && cliConfig && !cliConfig.enabled) {
                        const result = await window.electronAPI?.setCodexCliConfig?.({ ...cliConfig, enabled: true });
                        if (result?.config) setCodexCliConfig(result.config as typeof codexCliConfig);
                    }
                }

                const fastMode = await window.electronAPI?.getGroqFastTextMode();
                await loadAntigravity();
                if (fastMode) setFastResponseMode(fastMode.enabled);

                // @ts-ignore
                const custom = await window.electronAPI?.getCustomProviders();
                if (custom) {
                    setCustomProviders(custom);
                }

                // Load the persisted fast model. null on disk means "Auto".
                // @ts-ignore
                const fastResult = await window.electronAPI?.getFastModel?.();
                setFastModel(fastResult?.model || 'auto');

                const directEnabled = await window.electronAPI?.getDirectAssistEnabled?.();
                setDirectAssistEnabled(directEnabled === true);

                // Check Ollama
                checkOllama();

                // Mark credentials as fully loaded only after custom/default model
                // state is refreshed, so the stale-default guard doesn't reset a
                // still-loading custom/LiteLLM/Codex selection.
                setCredentialsLoaded(true);

            } catch (e) {
                console.error("Failed to load settings:", e);
                setCredentialsLoaded(true); // Unblock even on error
            }
        };
        loadCredentials();

        // Listen for changes from other windows (2-way sync)
        const unsubs: Array<() => void> = [];
        if (window.electronAPI?.onGroqFastTextChanged) {
            // @ts-ignore
            unsubs.push(window.electronAPI.onGroqFastTextChanged((enabled: boolean) => {
                setFastResponseMode(enabled);
                localStorage.setItem('natively_groq_fast_text', String(enabled));
            }));
        }
        if (window.electronAPI?.onDirectAssistEnabledChanged) {
            unsubs.push(window.electronAPI.onDirectAssistEnabledChanged((enabled: boolean) => {
                setDirectAssistEnabled(enabled === true);
                setDirectAssistError('');
            }));
        }
        if (window.electronAPI?.onCredentialsChanged) {
            // @ts-ignore
            unsubs.push(window.electronAPI.onCredentialsChanged(() => {
                loadCredentials();
            }));
        }
        if (window.electronAPI?.onLiveCatalogUpdated) {
            unsubs.push(window.electronAPI.onLiveCatalogUpdated(() => {
                loadCredentials();
            }));
        }
        return () => { unsubs.forEach(unsub => unsub?.()); };
    }, []);

    const isCodexReady = codexCliConfig.enabled && codexOauthStatus.signedIn;

    // Mirrors modelAvailable() in ipcHandlers.ts. Both surfaces must agree: this
    // one decides what the user can pick, that one decides what routing will
    // accept. If they diverge, the picker offers models the router rejects.
    const isProviderEnabled = (provider: string) => !disabledProviders.includes(provider);
    const isModelEnabled = (provider: string, modelId: string) =>
        isModelAllowed(provider, modelId, cloudEnabledModels[provider] || []);

    /**
     * The full model universe for a provider: presets ∪ persisted catalog ∪ every
     * id already in the allow-list.
     *
     * That third term is load-bearing. It guarantees an allow-listed id ALWAYS has
     * a row, even when the catalog is missing (never fetched, cleared on key
     * rotation, or a failed persist). Without it the card would show "3 / 3" while
     * silently filtering the picker by 12 invisible selections — and the toggle
     * normalisation below would then collapse against the wrong cardinality and
     * wipe them.
     */
    const effectiveModels = useCallback((provider: string): AipModelEntry[] => {
        const preset = STANDARD_CLOUD_MODELS[provider];
        const out: AipModelEntry[] = [];
        const seen = new Set<string>();
        const push = (id: string, label: string) => {
            if (!id || seen.has(id)) return;
            seen.add(id);
            out.push({ id, label });
        };
        preset?.ids.forEach((id, i) => push(id, preset.names[i] || id));
        // LiteLLM has no preset table and no `cloudFetchedModels` entry — its universe
        // is whatever the proxy reported, held UNPREFIXED in `litellmModels`. Prefix it
        // here so the allow-list stores the same `litellm/<model>` ids that
        // modelAvailable() in ipcHandlers.ts compares against; storing the bare name
        // would make the two surfaces disagree and the filter would silently no-op.
        if (provider === 'litellm') litellmModels.forEach(m => push(`litellm/${m}`, litellmModelLabel(m)));
        // Same shape as LiteLLM: no preset table, no cloudFetchedModels entry.
        // The universe is whatever the instance reported, held UNPREFIXED in
        // `ninerouterModels`, so the prefix is added here and the allow-list
        // stores the same `ninerouter/<id>` ids modelAvailable() compares.
        if (provider === 'ninerouter') ninerouterModels.forEach(m => push(`ninerouter/${m}`, gatewayModelLabel(m)));
        // Antigravity is the same shape of problem as LiteLLM: no preset table, and
        // `cloudFetchedModels` is written only from getCloudFetchedModels(), which
        // covers the key-backed providers and never the OAuth ones. Without this the
        // universe is EMPTY, and handleToggleModel's "empty allow-list means all"
        // branch then materialises `universe` — nothing — so un-ticking one row
        // persisted an allow-list containing ONLY that row. Measured before the fix:
        // un-ticking the 2nd of 4 models took the summary from "All 4" to "1 / 4" and
        // moved the default onto the row just un-ticked. handleBulkToggleModels reads
        // the same universe and had the same landmine.
        //
        // Prefixed, because `antigravity:<id>` is the form the allow-list, the picker
        // and modelAvailable() in ipcHandlers.ts all compare against.
        if (provider === 'antigravity') antigravityModels.forEach(m => push(`antigravity:${m.id}`, m.label || m.id));
        // Codex: same shape again, prefixed `codex-cli:<id>` like the picker and
        // modelAvailable(). The Codex default keeps a row even when the installed
        // CLI's catalogue dropped it, so it stays visible and can be moved.
        if (provider === 'codex-cli') {
            codexModels.forEach(m => push(codexCliSelectorId(m.id), m.name));
            push(codexCliSelectorId(codexCliConfig.model), codexModelsFromCli
                ? `${prettifyModelId(codexCliConfig.model)} (${t('not in your Codex CLI list')})`
                : prettifyModelId(codexCliConfig.model));
            // Ticked models the catalogue has since dropped, named without the prefix.
            (cloudEnabledModels[provider] || []).forEach(id => push(id, prettifyModelId(id.replace(/^codex-cli:/, ''))));
        }
        (cloudFetchedModels[provider] || []).forEach(m => push(m.id, m.label || m.id));
        // Allow-listed ids with no catalog entry still get a row, labelled as best we can.
        // LiteLLM ids are proxy literals, so they take the segment label rather than
        // prettifyModelId — which would render `litellm/openai/gpt-4o` as
        // "Litellm/Openai/Gpt 4o".
        (cloudEnabledModels[provider] || []).forEach(id =>
            push(id, (provider === 'litellm' || provider === 'ninerouter') ? gatewayModelLabel(id) : prettifyModelId(id)));
        return out;
    }, [cloudFetchedModels, cloudEnabledModels, litellmModels, ninerouterModels, antigravityModels, codexModelCatalog, codexCliConfig.model, t]);

    /**
     * The Background Model picker's options: Auto, plus only the models the fast
     * path can actually run.
     *
     * Until main answers the filter IPC we offer ONLY Auto (plus whatever is
     * already saved), so the full unfiltered list never flashes up as selectable.
     * A saved-but-unsupported pick stays visible and labelled rather than being
     * silently dropped - dropping it would render an empty control while the id
     * is still persisted, and rewriting it would change a setting the user chose.
     */
    const buildAvailableModelOptions = (): { id: string; name: string }[] => {
        const opts: { id: string; name: string }[] = [];

        if (hasStoredKey.natively && isProviderEnabled('natively')) {
            opts.push({ id: 'natively', name: 'Natively API' });
        }

        for (const [prov, cfg] of Object.entries(STANDARD_CLOUD_MODELS)) {
            if (!hasStoredKey[prov as keyof typeof hasStoredKey]) continue;
            if (!isProviderEnabled(prov)) continue;
            // Every allow-listed model reaches the picker — not just the preferred one.
            // Previously `preferredModels[prov]` was the ONLY bridge for a non-preset
            // id, which made allow-listing a fetched model a placebo: the user could
            // tick it and it would never appear.
            const seenForProv = new Set<string>();
            effectiveModels(prov).forEach(({ id, label }) => {
                if (!isModelEnabled(prov, id) || seenForProv.has(id)) return;
                seenForProv.add(id);
                opts.push({ id, name: label });
            });
            const pm = preferredModels[prov as keyof typeof preferredModels];
            if (pm && !seenForProv.has(pm) && isModelEnabled(prov, pm)) {
                opts.push({ id: pm, name: prettifyModelId(pm) });
            }
        }
        // Same allow-list gate as every cloud card. The bare entry runs the Codex
        // default, so it is listed exactly when that model is ticked
        // (modelAvailable in ipcHandlers.ts reads it the same way).
        if (isCodexReady && isProviderEnabled('codex-cli')) {
            const configuredName = codexModels.find(model => model.id === codexCliConfig.model)?.name || prettifyModelId(codexCliConfig.model);
            if (isModelEnabled('codex-cli', codexCliSelectorId(codexCliConfig.model))) {
                opts.push({ id: CODEX_CLI_MODEL.id, name: `${CODEX_CLI_MODEL.name} (${configuredName})` });
            }
            codexModels.forEach(model => {
                const id = codexCliSelectorId(model.id);
                if (isModelEnabled('codex-cli', id) && !opts.find(o => o.id === id)) {
                    opts.push({ id, name: `${CODEX_CLI_MODEL.name}: ${model.name}` });
                }
            });
        }
        if (antigravityStatus.signedIn && isProviderEnabled('antigravity')) {
            antigravityModels.forEach(({ id, label }) => {
                const selectorId = `antigravity:${id}`;
                if (isModelEnabled('antigravity', selectorId)) opts.push({ id: selectorId, name: `${label} (Antigravity)` });
            });
        }
        if (hasStoredKey.litellm && isProviderEnabled('litellm')) {
            // Same allow-list gate the cloud providers get above. Without it the proxy's
            // full catalogue reaches the picker while modelAvailable() filters it, and
            // the two surfaces disagree — the exact drift the comment at isProviderEnabled
            // warns about.
            litellmModels.forEach(model => {
                const id = `litellm/${model}`;
                if (!isModelEnabled('litellm', id)) return;
                opts.push({ id, name: `${litellmModelLabel(model)} (LiteLLM)` });
            });
        }
        if (hasStoredKey.ninerouter && isProviderEnabled('ninerouter')) {
            // Same allow-list gate, same reason: without it the instance's whole
            // catalogue reaches the picker while modelAvailable() filters it, and
            // the two surfaces disagree.
            ninerouterModels.forEach(model => {
                const id = `ninerouter/${model}`;
                if (!isModelEnabled('ninerouter', id)) return;
                opts.push({ id, name: `${gatewayModelLabel(model)} (9Router)` });
            });
        }
        if (isProviderEnabled('custom')) {
            customProviders.forEach(p => opts.push({ id: p.id, name: p.name }));
        }
        if (isProviderEnabled('ollama')) {
            ollamaModels.forEach(m => opts.push({ id: `ollama-${m}`, name: `${m} (Local)` }));
        }
        return opts;
    };

    const fastModelCandidateKey = buildAvailableModelOptions().map((o) => o.id).join(',');
    useEffect(() => {
        let cancelled = false;
        const ids = fastModelCandidateKey ? fastModelCandidateKey.split(',') : [];
        window.electronAPI?.filterFastModelCandidates?.(ids)
            .then((r) => { if (!cancelled) setFastModelDispatchable(r?.ids ?? []); })
            .catch(() => { if (!cancelled) setFastModelDispatchable([]); });
        return () => { cancelled = true; };
    }, [fastModelCandidateKey]);

    const buildFastModelOptions = (): { id: string; name: string }[] => {
        const all = buildAvailableModelOptions();
        const allowed = fastModelDispatchable === null
            ? []
            : all.filter((o) => fastModelDispatchable.includes(o.id));
        const opts = [{ id: 'auto', name: t('Auto') }, ...allowed];
        if (fastModel !== 'auto' && !allowed.some((o) => o.id === fastModel)) {
            const saved = all.find((o) => o.id === fastModel);
            opts.push({ id: fastModel, name: `${saved?.name ?? fastModel} ${t('(not supported)')}` });
        }
        return opts;
    };


    // Keep the persisted default model from pointing at a provider the user just
    // removed/signed out of. This turns credential changes into immediate routing
    // changes instead of waiting for a failing request to discover stale state.
    useEffect(() => {
        if (!credentialsLoaded) return;
        if (defaultModel.startsWith('antigravity:') && antigravityStatus.signedIn && antigravityError) return;
        const opts = buildAvailableModelOptions();
        if (!defaultModel || opts.some(o => o.id === defaultModel) || opts.length === 0) return;
        // A Codex model that is no longer offered (the CLI catalogue dropped it,
        // or it was a preset the ChatGPT backend now rejects, or it was un-ticked
        // in the Codex card) falls back to the Codex entry itself, then to any
        // Codex model still ticked — never to whichever provider happens to be first.
        const next = (defaultModel.startsWith('antigravity:')
            ? opts.find(option => option.id.startsWith('antigravity:'))?.id : undefined)
            || (defaultModel.startsWith(CODEX_CLI_MODEL.id)
                ? (opts.find(option => option.id === CODEX_CLI_MODEL.id)
                    ?? opts.find(option => option.id.startsWith(`${CODEX_CLI_MODEL.id}:`)))?.id : undefined)
            || opts[0].id;
        setDefaultModel(next);
        window.electronAPI?.setDefaultModel?.(next).catch(console.error);
    }, [credentialsLoaded, defaultModel, hasStoredKey, preferredModels, isCodexReady, codexCliConfig.model, codexModelCatalog, customProviders, ollamaModels, litellmModels, ninerouterModels, disabledProviders, cloudEnabledModels, antigravityStatus.signedIn, antigravityModels, antigravityError]);

    // Load LiteLLM model IDs only when the proxy is configured. The active-model
    // selector should not expose stale `litellm/...` choices after the proxy is
    // removed, but it should keep real proxy models selectable while configured.
    useEffect(() => {
        let cancelled = false;
        if (!hasStoredKey.litellm) {
            setLitellmModels([]);
            return;
        }
        window.electronAPI?.getAvailableLiteLLMModels?.()
            .then((models) => {
                if (!cancelled) setLitellmModels(Array.isArray(models) ? models.filter(Boolean) : []);
            })
            .catch(() => {
                if (!cancelled) setLitellmModels([]);
            });
        return () => { cancelled = true; };
    }, [hasStoredKey.litellm, litellmBaseURL]);

    // Same rule for 9Router: load its ids only while configured, so the
    // active-model selector cannot offer stale `ninerouter/...` choices after the
    // instance is removed. Keyed on the base URL too, because repointing at a
    // different instance invalidates the catalogue — which models a 9Router
    // serves depends on which upstream accounts its owner has connected.
    useEffect(() => {
        let cancelled = false;
        if (!hasStoredKey.ninerouter) {
            setNinerouterModels([]);
            return;
        }
        window.electronAPI?.getAvailableNinerouterModels?.()
            .then((models) => {
                if (!cancelled) setNinerouterModels(Array.isArray(models) ? models.filter(Boolean) : []);
            })
            .catch(() => {
                if (!cancelled) setNinerouterModels([]);
            });
        return () => { cancelled = true; };
    }, [hasStoredKey.ninerouter, ninerouterBaseURL]);

    // Switch a whole provider off/on. The credential is left untouched — this is
    // the difference between "I'm not using this right now" and "delete my key".
    const handleToggleProvider = async (provider: string, enabled: boolean) => {
        const next = enabled
            ? disabledProviders.filter(p => p !== provider)
            : [...disabledProviders.filter(p => p !== provider), provider];
        setDisabledProviders(next);
        try {
            await window.electronAPI?.setDisabledProviders?.(next);
        } catch (e) {
            console.error('Failed to persist disabled providers:', e);
        }
    };

    // Narrow which of a provider's models reach the picker. An empty list means
    // "all" — so un-checking the last remaining model re-enables all of them
    // rather than leaving the provider silently empty. Use the provider toggle to
    // hide a provider outright.
    // Codex keeps its default in codexCliConfig.model, not preferredModels, so the
    // default-moving above never reached it: un-ticking the Codex default left
    // the "default" badge on an un-ticked row, and the bare Codex entry (which
    // runs that model) vanished from every picker. Same rule as the others:
    // move it to the first model still ticked.
    const moveCodexDefaultIfUnticked = (allowList: string[]) => {
        const current = codexCliSelectorId(codexCliConfig.model);
        if (allowList.length === 0 || isModelAllowed(CODEX_CLI_MODEL.id, current, allowList)) return;
        const moved = allowList[0].slice(`${CODEX_CLI_MODEL.id}:`.length);
        void saveCodexCliConfig({ ...codexCliConfig, model: moved })
            .catch((e: unknown) => console.error('Failed to move the Codex default model:', e));
    };

    const handleToggleModel = async (provider: string, modelId: string) => {
        const universe = effectiveModels(provider).map(m => m.id);
        const current = cloudEnabledModels[provider] || [];
        const optIn = isOptInModelProvider(provider);
        // An empty allow-list means "all", so the first un-check has to materialise
        // the full set minus the one being removed. The set is the EFFECTIVE universe,
        // not just the presets — normalising against presets while the list also holds
        // fetched ids collapses at the wrong cardinality and wipes the selection.
        //
        // For an OPT-IN provider empty already means "none", so there is nothing to
        // materialise — the stored list IS the selection and starts empty.
        const effective = optIn ? current : (current.length === 0 ? universe : current);
        const nextList = effective.includes(modelId)
            ? effective.filter(id => id !== modelId)
            : [...effective, modelId];
        // Everything selected → store [] (no filter). Never store "none": the UI keeps
        // the last remaining row inert so this branch is unreachable from a click.
        //
        // Neither collapse may happen for an opt-in provider: [] means "none" there,
        // so folding a full selection into [] would silently deselect everything, and
        // un-checking the last model must be allowed to reach [] rather than being
        // read as "all".
        const normalised = optIn
            ? nextList
            : (nextList.length === 0 || nextList.length === universe.length) ? [] : nextList;
        const prev = cloudEnabledModels;
        setCloudEnabledModelsState(p => ({ ...p, [provider]: normalised }));

        // If the model just un-checked was this provider's default, move the default
        // rather than leaving it pointing outside the picker. `normalised === []` means
        // "all", so the default is still valid there and needs no move.
        const currentDefault = preferredModels[provider as keyof typeof preferredModels];
        if (currentDefault === modelId && normalised.length > 0) {
            const moved = normalised[0];
            setPreferredModels(p => ({ ...p, [provider]: moved }));
            window.electronAPI?.setProviderPreferredModel?.(provider as any, moved)
                .catch((e: unknown) => console.error('Failed to move default model:', e));
        }
        if (provider === CODEX_CLI_MODEL.id) moveCodexDefaultIfUnticked(normalised);
        try {
            const res = await window.electronAPI?.setCloudEnabledModels?.(provider, normalised);
            if (res && res.success === false) throw new Error(res.error || 'save failed');
        } catch (e) {
            // Optimistic writes must revert. Leaving the UI showing a state the disk
            // does not have is worse than the write failing visibly.
            console.error('Failed to persist enabled models:', e);
            setCloudEnabledModelsState(prev);
            setModelSaveError(p => ({ ...p, [provider]: true }));
            setTimeout(() => setModelSaveError(p => ({ ...p, [provider]: false })), 4000);
        }
    };

    /**
     * Tick or clear a whole set of models at once.
     *
     * Exists because an opt-in provider can front 300+ models: selecting a family
     * of them one checkbox at a time is not a real option. `ids` is whatever the
     * list is CURRENTLY showing (typed filter applied), so "gpt" → Select all
     * ticks the matches and leaves the other 290 alone.
     *
     * Shares handleToggleModel's normalisation rules exactly — including the
     * opt-in carve-outs — so a bulk action can never reach a state a sequence of
     * single clicks could not.
     */
    const handleBulkToggleModels = async (provider: string, ids: string[], enable: boolean) => {
        if (ids.length === 0) return;
        const universe = effectiveModels(provider).map(m => m.id);
        const optIn = isOptInModelProvider(provider);
        const current = cloudEnabledModels[provider] || [];
        const effective = optIn ? current : (current.length === 0 ? universe : current);
        const set = new Set(effective);
        ids.forEach(id => { if (enable) set.add(id); else set.delete(id); });
        // Rebuild through `universe` so the stored order stays the catalogue's
        // order rather than click order — the default-move below takes [0].
        const nextList = universe.filter(id => set.has(id));
        const normalised = optIn
            ? nextList
            : (nextList.length === 0 || nextList.length === universe.length) ? [] : nextList;

        const prev = cloudEnabledModels;
        setCloudEnabledModelsState(p => ({ ...p, [provider]: normalised }));

        // Same invariant handleToggleModel maintains: the default must never point
        // outside the allow-list. A bulk clear can drop it, so move it here too.
        const currentDefault = preferredModels[provider as keyof typeof preferredModels];
        if (currentDefault && !isModelAllowed(provider, currentDefault, normalised) && normalised.length > 0) {
            const moved = normalised[0];
            setPreferredModels(p => ({ ...p, [provider]: moved }));
            window.electronAPI?.setProviderPreferredModel?.(provider as any, moved)
                .catch((e: unknown) => console.error('Failed to move default model:', e));
        }
        if (provider === CODEX_CLI_MODEL.id) moveCodexDefaultIfUnticked(normalised);
        try {
            const res = await window.electronAPI?.setCloudEnabledModels?.(provider, normalised);
            if (res && res.success === false) throw new Error(res.error || 'save failed');
        } catch (e) {
            console.error('Failed to persist enabled models:', e);
            setCloudEnabledModelsState(prev);
            setModelSaveError(p => ({ ...p, [provider]: true }));
            setTimeout(() => setModelSaveError(p => ({ ...p, [provider]: false })), 4000);
        }
    };

    /**
     * Promote a model to this provider's default.
     *
     * Invariant: the default is ALWAYS allow-listed. Otherwise the provider defaults
     * to a model the picker refuses to show — the exact incoherence merging the two
     * controls exists to abolish.
     *
     * That makes this TWO writes when the model is not yet allow-listed, so the order
     * and the rollback matter. Allow-list first: "allow-listed but not default" is a
     * perfectly coherent resting state, while "default but not allow-listed" is the
     * state being abolished. If the process dies between the writes, we land on the
     * harmless one.
     */
    const handleSetDefaultModel = async (provider: string, modelId: string) => {
        const prevEnabled = cloudEnabledModels;
        const prevPreferred = preferredModels;
        const current = cloudEnabledModels[provider] || [];
        // An empty allow-list means "all" for most providers, so nothing to add.
        // For an OPT-IN provider (OpenRouter, LiteLLM) empty means NONE, so the
        // new default must be added or it is a default that routing rejects:
        // reproduced live 2026-09-17 — "Set default" on an OpenRouter model
        // stored the preference, left the allow-list empty, and the model never
        // appeared in the overlay picker.
        const needsAllow = isOptInModelProvider(provider)
            ? !current.includes(modelId)
            : current.length > 0 && !current.includes(modelId);
        const nextList = needsAllow ? [...current, modelId] : current;

        if (needsAllow) setCloudEnabledModelsState(p => ({ ...p, [provider]: nextList }));
        setPreferredModels(p => ({ ...p, [provider]: modelId }));

        try {
            if (needsAllow) {
                const r = await window.electronAPI?.setCloudEnabledModels?.(provider, nextList);
                if (r && r.success === false) throw new Error(r.error || 'allow-list write failed');
            }
            await window.electronAPI?.setProviderPreferredModel?.(provider as any, modelId);
        } catch (e) {
            // Roll BOTH back — a half-applied merge is worse than no change.
            console.error('Failed to set default model:', e);
            setCloudEnabledModelsState(prevEnabled);
            setPreferredModels(prevPreferred);
            setModelSaveError(p => ({ ...p, [provider]: true }));
            setTimeout(() => setModelSaveError(p => ({ ...p, [provider]: false })), 4000);
        }
    };

    /**
     * Antigravity's "Set default" promotes a model to the APP's active model,
     * not to a per-provider preferred model.
     *
     * handleSetDefaultModel writes `preferredModels[provider]`, which persists as
     * `<provider>PreferredModel`. That is a dead end here: PreferredModelProvider
     * is gemini|groq|openai|claude|deepseek|nvidia_nim|litellm, StoredCredentials
     * has no antigravityPreferredModel field, and the only reader in the codebase
     * is litellm's. Wiring the button there would move a badge and change nothing —
     * worse than no button.
     *
     * `antigravity:<id>` IS a valid app default: buildAvailableModelOptions emits
     * those ids and the fallback effect above already handles them. So this sets
     * the same state the Active Model select at the top of the panel sets, which
     * is also why the two now agree on screen.
     *
     * Keeps handleSetDefaultModel's invariant — the default is ALWAYS allow-listed,
     * or the picker would refuse to show the model the app defaults to — and the
     * same ordering: allow-list first, because "allow-listed but not default" is a
     * coherent resting state and "default but not allow-listed" is the one being
     * abolished.
     */
    const handleSetAntigravityDefault = async (modelId: string) => {
        const prevEnabled = cloudEnabledModels;
        const prevDefault = defaultModel;
        const current = cloudEnabledModels['antigravity'] || [];
        // An empty allow-list already means "all", so there is nothing to add.
        const needsAllow = current.length > 0 && !current.includes(modelId);
        const nextList = needsAllow ? [...current, modelId] : current;

        if (needsAllow) setCloudEnabledModelsState(p => ({ ...p, antigravity: nextList }));
        setDefaultModel(modelId);

        try {
            if (needsAllow) {
                const r = await window.electronAPI?.setCloudEnabledModels?.('antigravity', nextList);
                if (r && r.success === false) throw new Error(r.error || 'allow-list write failed');
            }
            // @ts-ignore - persist as default + update runtime + broadcast
            await window.electronAPI?.setDefaultModel(modelId);
        } catch (e) {
            console.error('Failed to set Antigravity default model:', e);
            setCloudEnabledModelsState(prevEnabled);
            setDefaultModel(prevDefault);
            setModelSaveError(p => ({ ...p, antigravity: true }));
            setTimeout(() => setModelSaveError(p => ({ ...p, antigravity: false })), 4000);
        }
    };

    const handleResetModels = async (provider: string) => {
        const prev = cloudEnabledModels;
        setCloudEnabledModelsState(p => ({ ...p, [provider]: [] }));
        try {
            const res = await window.electronAPI?.setCloudEnabledModels?.(provider, []);
            if (res && res.success === false) throw new Error(res.error || 'save failed');
        } catch (e) {
            console.error('Failed to reset enabled models:', e);
            setCloudEnabledModelsState(prev);
        }
    };

    // Explicit re-discovery. `get-available-litellm-models` now answers from a
    // persisted cache so opening the model picker never blocks on the proxy;
    // this is how the user picks up models added to the proxy since.
    const handleRefreshLitellmModels = async () => {
        setIsRefreshingLitellm(true);
        try {
            const models = await window.electronAPI?.refreshLiteLLMModels?.();
            setLitellmModels(Array.isArray(models) ? models.filter(Boolean) : []);
        } catch (e) {
            console.error('Failed to refresh LiteLLM models:', e);
        } finally {
            setIsRefreshingLitellm(false);
        }
    };

    // Effect to enforce fast mode disabled if neither Groq key nor Natively API is configured.
    // Guard with credentialsLoaded so this never fires during the initial async load phase
    // (when hasStoredKey is still empty and canUseFastMode is incorrectly false).
    useEffect(() => {
        if (!credentialsLoaded) return;
        if (!canUseFastMode && fastResponseMode) {
            setFastResponseMode(false);
            localStorage.setItem('natively_groq_fast_text', 'false');
            // @ts-ignore
            window.electronAPI?.setGroqFastTextMode(false);
        }
    }, [credentialsLoaded, canUseFastMode, fastResponseMode]);

    // Poll for Ollama status every 3 seconds requesting smart start on mount
    useEffect(() => {
        // Immediate "Smart Start" check
        ensureOllamaStartup();

        // Background polling for maintenance
        const interval = setInterval(() => {
            checkOllama(false);
        }, 3000);
        return () => clearInterval(interval);
    }, []);

    // Wire up Codex OAuth IPC events. The main process emits these as
    // login progresses (or fails, or refreshes in the background) and
    // we mirror the state into the React tree. Each subscription
    // returns an unsubscribe function; clean up on unmount.
    useEffect(() => {
        const api = window.electronAPI as any;
        const unsubs: Array<() => void> = [];
        try {
            if (api?.onCodexLoginComplete) {
                unsubs.push(api.onCodexLoginComplete((info: any) => {
                    setCodexOauthInProgress(false);
                    setCodexOauthStatus(prev => ({ ...prev, signedIn: true, source: 'natively', email: info?.email || prev.email }));
                    setCodexAuthStatus('success');
                    setCodexAuthMessage(`${t('Signed in to ChatGPT')}${info?.email ? ` ${t('as')} ${info.email}` : ''}.`);
                    // Auto-enable codex now that we're signed in.
                    setCodexCliConfig(prev => {
                        const next = { ...prev, enabled: true };
                        window.electronAPI?.setCodexCliConfig?.(next);
                        return next;
                    });
                }));
            }
            if (api?.onCodexLoginFailed) {
                unsubs.push(api.onCodexLoginFailed((info: any) => {
                    setCodexOauthInProgress(false);
                    setCodexAuthStatus('error');
                    setCodexAuthMessage(info?.message || t('Codex sign-in failed.'));
                }));
            }
            if (api?.onCodexSignedOut) {
                unsubs.push(api.onCodexSignedOut(() => {
                    setCodexOauthStatus({ signedIn: false });
                    setCodexAuthStatus('idle');
                    setCodexAuthMessage(t('Signed out of ChatGPT.'));
                    // A valid `codex login` session keeps Codex usable after
                    // signing out of Natively's own — re-read so the card says so
                    // instead of showing a sign-out that did not take effect.
                    readCodexSignInStatus().then(status => { if (status) setCodexOauthStatus(status); });
                }));
            }
            if (api?.onCodexTokensRefreshed) {
                unsubs.push(api.onCodexTokensRefreshed((info: any) => {
                    setCodexOauthStatus(prev => ({ ...prev, expiresAt: info?.expiresAt || prev.expiresAt }));
                }));
            }
        } catch { /* subscriptions are best-effort */ }
        return () => { for (const u of unsubs) try { u(); } catch { /* noop */ } };
    }, []);

    // Load Screen Understanding (vision routing) settings
    useEffect(() => {
        window.electronAPI?.getScreenUnderstandingMode?.().then(setScreenUnderstandingMode as any).catch(() => { });
        (window.electronAPI as any)?.getTechnicalInterviewVisionFirst?.()
            .then(setTechnicalInterviewVisionFirst)
            .catch(() => {
                // Fallback to deprecated alias if the renderer is talking to an older main process.
                window.electronAPI?.getTechnicalInterviewDirectVision?.().then(setTechnicalInterviewVisionFirst).catch(() => { });
            });
    }, []);

    useEffect(() => {
        const api: any = window.electronAPI;
        if (!api?.onScreenUnderstandingModeChanged) return;
        const unsubscribe = api.onScreenUnderstandingModeChanged(setScreenUnderstandingMode);
        return () => unsubscribe?.();
    }, []);

    useEffect(() => {
        const api: any = window.electronAPI;
        const handler = (enabled: boolean) => setTechnicalInterviewVisionFirst(enabled);
        const unsub1 = api?.onTechnicalInterviewVisionFirstChanged?.(handler);
        const unsub2 = api?.onTechnicalInterviewDirectVisionChanged?.(handler);
        return () => {
            unsub1?.();
            unsub2?.();
        };
    }, []);

    // Load Cloud Provider Data Scopes and subscribe to cross-window changes
    useEffect(() => {
        window.electronAPI?.getProviderDataScopes?.().then(setProviderDataScopes).catch(() => { }).finally(() => setScopesLoaded(true));
    }, []);

    useEffect(() => {
        if (window.electronAPI?.onProviderDataScopesChanged) {
            const unsubscribe = window.electronAPI.onProviderDataScopesChanged(setProviderDataScopes);
            return () => unsubscribe();
        }
    }, []);

    const ensureOllamaStartup = async () => {
        setOllamaStatus('checking');
        try {
            // electronAPI.ensureOllamaRunning, NOT a generic `invoke`.
            //
            // This called `window.electronAPI?.invoke?.('ensure-ollama-running')`
            // behind a @ts-ignore, and this preload exposes NO generic `invoke`
            // (the only passthrough, e2eInvoke, is undefined unless
            // NATIVELY_E2E=1). So the optional call short-circuited, `result`
            // was always undefined, and the branch below reported 'not-found'
            // WITHOUT EVER TRYING TO START THE DAEMON. The @ts-ignore is what
            // let it typecheck.
            const result = await window.electronAPI?.ensureOllamaRunning?.();
            if (result && result.success) {
                // It's running (or just started), now fetch models
                checkOllama(true);
            } else {
                setOllamaStatus('not-found');
            }
        } catch (e) {
            console.warn("Ollama ensure startup failed:", e);
            setOllamaStatus('not-found');
        }
    };

    // The poll below runs every 3s and each pass makes real HTTP calls to the
    // Ollama daemon. Without a guard, a slow daemon lets passes stack up.
    const checkOllamaInFlight = useRef(false);

    const checkOllama = async (_isInitial = true) => {
        // Don't override 'checking' if we are already in smart-start mode
        // if (isInitial) setOllamaStatus('checking');
        if (checkOllamaInFlight.current) return;
        checkOllamaInFlight.current = true;
        try {
            await checkOllamaInner();
        } finally {
            checkOllamaInFlight.current = false;
        }
    };

    const checkOllamaInner = async () => {

        // Refreshed OUTSIDE the models try/catch on purpose. "Ollama has models
        // installed" and "a denied scope would actually be served locally" are
        // different questions — the gate also requires Ollama to be the SELECTED
        // provider, which the user can change from this very screen. If this rode
        // along inside the block below, a getAvailableOllamaModels() throw (Ollama
        // stopped mid-session) would skip it and leave the Privacy card showing a
        // stale "On-device" for content that is now being dropped. Fail closed.
        try {
            const st = await window.electronAPI?.getLocalFallbackStatus?.();
            setLocalFallback({ text: Boolean(st?.text), vision: Boolean(st?.vision) });
        } catch { setLocalFallback({ text: false, vision: false }); }

        try {
            // @ts-ignore
            const models = await window.electronAPI?.getAvailableOllamaModels?.();
            const usable = Array.isArray(models) ? models : [];
            setOllamaModels(usable);

            if (usable.length > 0) {
                setOllamaStatus('detected');
            } else {
                // An empty list is NOT proof the daemon is missing. This handler
                // answers with generation-capable models, and Natively itself
                // pulls nomic-embed-text for retrieval — so a perfectly healthy
                // Ollama holding only that embedder lands here. Reporting "Not
                // found" would offer Auto-Fix, whose force-restart path can
                // `kill -9` an app-managed daemon that is working fine.
                // Ask the daemon directly instead; 'detected' with an empty list
                // already has its own copy ("running but no models found").
                let reachable = false;
                try { reachable = Boolean(await window.electronAPI?.isOllamaReachable?.()); } catch { /* treated as unreachable */ }
                if (reachable) {
                    setOllamaStatus('detected');
                } else if (ollamaStatus !== 'detected') {
                    // Only set not-found if we haven't detected it yet
                    setOllamaStatus('not-found');
                }
            }
        } catch (e) {
            // console.warn(`Ollama check failed:`, e);
            if (ollamaStatus !== 'detected') {
                setOllamaStatus('not-found');
            }
        }
    };

    const handleFixOllama = async () => {
        setOllamaStatus('fixing');
        try {
            // Same defect: forceRestartOllama IS bridged, but reaching it
            // through the nonexistent generic `invoke` silently did nothing.
            const result = await window.electronAPI?.forceRestartOllama?.();
            if (result && result.success) {
                setOllamaRestarted(true);
                // Wait for server to be ready
                setTimeout(() => checkOllama(false), 2000);
            } else {
                setOllamaStatus('not-found');
            }
        } catch (e) {
            console.error("Fix failed", e);
            setOllamaStatus('not-found');
        }
    };

    const saveCodexCliConfig = async (next = codexCliConfig) => {
        // Auto-enable when signed in; no manual toggle needed.
        const enabled = codexOauthStatus.signedIn || next.enabled;
        const normalized = { ...next, enabled, timeoutMs: Number(next.timeoutMs) || 60000 };
        setCodexCliConfig(normalized);
        const result = await window.electronAPI?.setCodexCliConfig?.(normalized);
        if (result?.config) setCodexCliConfig(result.config as typeof codexCliConfig);
        return result;
    };

    // "Set default" in the Codex model list is the Model dropdown it replaced: it
    // moves the Codex default (codexCliConfig.model), which the bare Codex entry,
    // structured calls and the Auto fast ladder run. Like every card's, it also
    // allow-lists the model, or it would be a default the picker hides.
    const handleSetCodexDefault = async (selectorId: string) => {
        const model = selectorId.slice(`${CODEX_CLI_MODEL.id}:`.length);
        const prevEnabled = cloudEnabledModels;
        const prevConfig = codexCliConfig;
        const current = cloudEnabledModels['codex-cli'] || [];
        // An empty allow-list already means "all", so there is nothing to add.
        const needsAllow = current.length > 0 && !current.includes(selectorId);
        const nextList = needsAllow ? [...current, selectorId] : current;

        if (needsAllow) setCloudEnabledModelsState(p => ({ ...p, 'codex-cli': nextList }));
        try {
            if (needsAllow) {
                const r = await window.electronAPI?.setCloudEnabledModels?.('codex-cli', nextList);
                if (r && r.success === false) throw new Error(r.error || 'allow-list write failed');
            }
            const saved = await saveCodexCliConfig({ ...codexCliConfig, model });
            if (!saved?.success) throw new Error(saved?.error || 'Codex config write failed');
        } catch (e) {
            console.error('Failed to set Codex default model:', e);
            setCloudEnabledModelsState(prevEnabled);
            setCodexCliConfig(prevConfig);
            setModelSaveError(p => ({ ...p, 'codex-cli': true }));
            setTimeout(() => setModelSaveError(p => ({ ...p, 'codex-cli': false })), 4000);
        }
    };

    // Re-reads the installed Codex CLI's catalogue (main reads its models cache
    // on every call), picking up models the CLI has learned since Settings opened.
    const handleRefreshCodexModels = async () => {
        setCodexModelsRefreshing(true);
        try {
            const catalog = await window.electronAPI?.getCodexCliModels?.();
            if (catalog) setCodexModelCatalog(catalog);
        } catch (e) {
            console.error('Failed to refresh Codex models:', e);
        } finally {
            setCodexModelsRefreshing(false);
        }
    };

    const handleTestCodexCli = async () => {
        setCodexCliStatus('testing');
        setCodexCliError('');
        try {
            const saveResult = await saveCodexCliConfig();
            const configToTest = saveResult?.config || codexCliConfig;
            const result = await window.electronAPI?.testCodexCli?.(configToTest);
            if (result?.success) {
                // If the main process auto-detected an install, reflect the
                // resolved path in the form so the user sees what got picked.
                if (result.config) setCodexCliConfig(result.config as typeof codexCliConfig);
                setCodexCliStatus('success');
                setTimeout(() => setCodexCliStatus('idle'), 3000);
            } else {
                setCodexCliStatus('error');
                setCodexCliError(result?.error || t('Codex CLI test failed'));
            }
        } catch (e: any) {
            setCodexCliStatus('error');
            setCodexCliError(e.message || t('Codex CLI test failed'));
        }
    };

    const handleCodexAuthAction = async (action: 'status' | 'logout' | 'login' | 'doctor') => {
        setCodexAuthAction(action);
        setCodexAuthStatus('idle');
        setCodexAuthMessage('');
        try {
            const saveResult = await saveCodexCliConfig();
            const configToUse = saveResult?.config || codexCliConfig;
            const api = window.electronAPI as any;
            // The new OAuth flow uses dedicated IPCs: codexStartLogin opens
            // the system browser and resolves when the callback fires.
            // For 'login' we kick that off and let the IPC events drive
            // the UI; the other actions still go through the legacy
            // wrappers (which are now OAuth-aware).
            if (action === 'login' && api?.codexStartLogin) {
                setCodexOauthInProgress(true);
                setCodexAuthMessage(t('Opening browser — complete sign-in there, then return here.'));
                const result = await api.codexStartLogin();
                // The actual UI update happens via the onCodexLoginComplete
                // / onCodexLoginFailed events; this is the success/fail
                // path in case the events miss (e.g. the renderer reloaded
                // mid-flow).
                setCodexOauthInProgress(false);
                if (result?.success) {
                    setCodexAuthStatus('success');
                    setCodexAuthMessage(`${t('Signed in to ChatGPT')}${result.email ? ` ${t('as')} ${result.email}` : ''}.`);
                    setCodexOauthStatus({ signedIn: true, email: result.email, expiresAt: result.expiresAt });
                } else {
                    setCodexAuthStatus('error');
                    setCodexAuthMessage(result?.error || t('Codex sign-in failed.'));
                }
                return;
            }
            const fn = action === 'status'
                ? api?.codexCliAuthStatus
                : action === 'logout'
                    ? api?.codexCliLogout
                    : action === 'login'
                        ? api?.codexCliLogin
                        : api?.codexCliDoctor;
            const result = await fn?.(configToUse);
            if (result?.config) setCodexCliConfig(result.config as typeof codexCliConfig);
            if (result?.success) {
                setCodexAuthStatus('success');
                setCodexAuthMessage(result.output || `Codex ${action} succeeded.`);
                // Sync OAuth status after status/logout IPCs.
                if (action === 'status' || action === 'logout') {
                    const status = await readCodexSignInStatus();
                    if (status) setCodexOauthStatus(status);
                }
            } else {
                setCodexAuthStatus('error');
                const msg = result?.error || result?.output || `Codex ${action} failed.`;
                setCodexAuthMessage(msg);
            }
        } catch (e: any) {
            setCodexAuthStatus('error');
            setCodexAuthMessage(e.message || `Codex ${action} failed.`);
        } finally {
            setCodexAuthAction('idle');
        }
    };

    // Convenience: one-click "Sign in with ChatGPT" — same as clicking
    // the "Login / Reconnect" button, but with a primary-style highlight
    // and the email field prominent when already signed in.
    const handleCodexSignOut = async () => {
        const api = window.electronAPI as any;
        try {
            await api?.codexSignOut?.();
            setCodexOauthStatus({ signedIn: false });
        } catch { /* noop */ }
    };

    const handleCodexRefresh = async () => {
        const api = window.electronAPI as any;
        setCodexAuthMessage(t('Refreshing tokens…'));
        try {
            const result = await api?.codexRefreshTokens?.();
            if (result?.success) {
                setCodexAuthStatus('success');
                setCodexAuthMessage(t('Tokens refreshed.'));
                setCodexOauthStatus(prev => ({ ...prev, expiresAt: result.expiresAt, email: result.email || prev.email }));
            } else {
                setCodexAuthStatus('error');
                setCodexAuthMessage(result?.error || t('Refresh failed.'));
            }
        } catch (e: any) {
            setCodexAuthStatus('error');
            setCodexAuthMessage(e?.message || t('Refresh failed.'));
        }
    };

    const handleSaveKey = async (provider: string, key: string, setter: (val: string) => void) => {
        if (!key.trim()) return;
        setSavingStatus(prev => ({ ...prev, [provider]: true }));
        setKeyWriteError(prev => ({ ...prev, [provider]: '' }));
        try {
            let result;
            // @ts-ignore
            if (provider === 'gemini') result = await window.electronAPI.setGeminiApiKey(key);
            // @ts-ignore
            if (provider === 'groq') result = await window.electronAPI.setGroqApiKey(key);
            // @ts-ignore
            if (provider === 'openai') result = await window.electronAPI.setOpenaiApiKey(key);
            // @ts-ignore
            if (provider === 'claude') result = await window.electronAPI.setClaudeApiKey(key);
            // @ts-ignore
            if (provider === 'deepseek') result = await window.electronAPI.setDeepseekApiKey(key);
            if (provider === 'nvidia_nim') result = await window.electronAPI.setNvidiaNimApiKey(key);
            if (provider === 'openrouter') result = await window.electronAPI.setOpenrouterApiKey(key);
            // No protocol is passed: the main process PROBES the key's group and
            // reports what it found. The group is a property of the key that the
            // key does not reveal, so asking the user was asking them to guess.
            if (provider === 'fluxion') {
                result = await window.electronAPI.setFluxionConfig({ apiKey: key });
                const detected = (result as { protocol?: 'openai' | 'anthropic' })?.protocol;
                if (detected) setFluxionProtocol(detected);
            }
            if (provider === 'agentrouter') result = await window.electronAPI.setAgentRouterApiKey(key);

            if (result && result.success) {
                // The save may have just switched OpenRouter reranking on; the
                // credentials broadcast does not fire when the same key is saved
                // again, so re-read here rather than rely on it.
                if (provider === 'openrouter') void refreshOpenrouterRetrievalCoupling();
                setSavedStatus(prev => ({ ...prev, [provider]: true }));
                setHasStoredKey(prev => ({ ...prev, [provider]: true }));
                setter('');
                setTimeout(() => setSavedStatus(prev => ({ ...prev, [provider]: false })), 2000);
            } else if (result && (result as { success?: boolean }).success === false) {
                // Keep the typed key in the field: nothing was stored, so clearing
                // it would throw away the only copy.
                setKeyWriteError(prev => ({ ...prev, [provider]: keyWriteFailureText(result as any, 'save') }));
            }
        } catch (e) {
            console.error(`Failed to save ${provider} key:`, e);
        } finally {
            setSavingStatus(prev => ({ ...prev, [provider]: false }));
        }
    };

    // 9Router takes the same three fields as LiteLLM for the same reason: it is a
    // user-supplied endpoint, not a vendor key.
    const handleSaveNinerouter = async () => {
        const url = ninerouterBaseURL.trim();
        if (!url) return;
        setSavingStatus(prev => ({ ...prev, ninerouter: true }));
        try {
            const parsedMax = parseInt(ninerouterMaxTokens, 10);
            const result = await window.electronAPI.setNinerouterConfig({
                apiKey: ninerouterApiKey.trim(),
                baseURL: url,
                maxTokens: Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : undefined,
                thinking: ninerouterThinking || undefined,
            });
            if (result && result.success) {
                setSavedStatus(prev => ({ ...prev, ninerouter: true }));
                setHasStoredKey(prev => ({ ...prev, ninerouter: true }));
                setNinerouterApiKey('');
                window.electronAPI?.getAvailableNinerouterModels?.()
                    .then((models) => setNinerouterModels(Array.isArray(models) ? models.filter(Boolean) : []))
                    .catch(() => setNinerouterModels([]));
                setTimeout(() => setSavedStatus(prev => ({ ...prev, ninerouter: false })), 2000);
            }
        } catch (e) {
            console.error('Failed to save 9Router config:', e);
        } finally {
            setSavingStatus(prev => ({ ...prev, ninerouter: false }));
        }
    };

    /**
     * Test Connection.
     *
     * Deliberately tests what the user typed, not what is stored, so pressing it
     * before Save answers for the config in front of them. The probe POSTs — a
     * GET-based test would go green on an instance whose work routes reject the
     * key, because on 9Router every GET answers openly and every POST does not.
     */
    const handleTestNinerouter = async () => {
        setNinerouterTest({ testing: true });
        try {
            const r = await window.electronAPI?.testNinerouterConnection?.({
                apiKey: ninerouterApiKey.trim(),
                baseURL: ninerouterBaseURL.trim(),
            });
            setNinerouterTest({
                testing: false,
                ok: !!r?.ok,
                message: r?.ok ? t('9Router answered. The key works.') : (r?.error || t('Connection test failed.')),
            });
        } catch (e: any) {
            setNinerouterTest({ testing: false, ok: false, message: e?.message || t('Connection test failed.') });
        }
    };

    const handleRefreshNinerouterModels = async () => {
        setIsRefreshingNinerouter(true);
        try {
            const models = await window.electronAPI?.refreshNinerouterModels?.();
            setNinerouterModels(Array.isArray(models) ? models.filter(Boolean) : []);
        } catch (e) {
            console.error('Failed to refresh 9Router models:', e);
        } finally {
            setIsRefreshingNinerouter(false);
        }
    };

    const handleRemoveNinerouter = () => setPendingConfirm({ kind: 'ninerouter' });

    const performRemoveNinerouter = async () => {
        try {
            const result = await window.electronAPI.setNinerouterConfig({ apiKey: '', baseURL: '' });
            if (result && result.success) {
                setHasStoredKey(prev => ({ ...prev, ninerouter: false }));
                setNinerouterBaseURL('');
                setNinerouterApiKey('');
                setNinerouterMaxTokens('');
                setNinerouterThinking('');
                setNinerouterModelMeta({});
                setNinerouterModels([]);
                setNinerouterTest({ testing: false });
                // Main already dropped ninerouterPreferredModel with the rest of the
                // config; mirror it so re-configuring the same instance in this
                // session doesn't show a star pointing at the old catalogue.
                setPreferredModels(prev => {
                    const { ninerouter: _removed, ...rest } = prev;
                    return rest;
                });
            }
        } catch (e) {
            console.error('Failed to remove 9Router config:', e);
        }
    };

    // LiteLLM needs three fields (baseURL + optional key + optional max-tokens),
    // so it can't use the single-key ProviderCard contract. baseURL is required
    // to enable the proxy; maxTokens empty → backend default (8192).
    const handleSaveLitellm = async () => {
        const url = litellmBaseURL.trim();
        if (!url) return;
        setSavingStatus(prev => ({ ...prev, litellm: true }));
        try {
            const parsedMax = parseInt(litellmMaxTokens, 10);
            const result = await window.electronAPI.setLitellmConfig({
                apiKey: litellmApiKey.trim(),
                baseURL: url,
                maxTokens: Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : undefined,
            });
            if (result && result.success) {
                setSavedStatus(prev => ({ ...prev, litellm: true }));
                setHasStoredKey(prev => ({ ...prev, litellm: true }));
                setLitellmApiKey('');
                window.electronAPI?.getAvailableLiteLLMModels?.()
                    .then((models) => setLitellmModels(Array.isArray(models) ? models.filter(Boolean) : []))
                    .catch(() => setLitellmModels([]));
                setTimeout(() => setSavedStatus(prev => ({ ...prev, litellm: false })), 2000);
            }
        } catch (e) {
            console.error('Failed to save LiteLLM config:', e);
        } finally {
            setSavingStatus(prev => ({ ...prev, litellm: false }));
        }
    };

    // Destructive actions below are gated by <ConfirmDialog>, never by native
    // confirm(): on Windows the native modal leaves Chromium's input-focus and
    // pointer-event subsystem wedged after it closes, so inputs and Save buttons
    // stay dead until the window loses and regains focus.
    const handleRemoveLitellm = () => setPendingConfirm({ kind: 'litellm' });

    const performRemoveLitellm = async () => {
        try {
            const result = await window.electronAPI.setLitellmConfig({ apiKey: '', baseURL: '' });
            if (result && result.success) {
                setHasStoredKey(prev => ({ ...prev, litellm: false }));
                setLitellmBaseURL('');
                setLitellmApiKey('');
                setLitellmMaxTokens('');
                setLitellmModels([]);
                // Main already dropped litellmPreferredModel with the rest of the
                // config; mirror it here so a re-configure of the same proxy in this
                // same session doesn't show a star pointing at the old catalogue.
                setPreferredModels(prev => {
                    const { litellm: _removed, ...rest } = prev;
                    return rest;
                });
            }
        } catch (e) {
            console.error('Failed to remove LiteLLM config:', e);
        }
    };


    const handleRemoveKey = async (provider: string, setter: (val: string) => void) => {
        // Read the coupling FRESH before the dialog renders its copy, so the
        // warning reflects what removing the key will actually do right now.
        // Bounded: a slow status read must not make the trash button feel dead,
        // so after 1s the dialog opens on the last known value.
        if (provider === 'openrouter') {
            await Promise.race([
                refreshOpenrouterRetrievalCoupling(),
                new Promise(resolve => setTimeout(resolve, 1000)),
            ]);
        }
        setPendingConfirm({ kind: 'providerKey', provider, setter });
    };

    const performRemoveKey = async (provider: string, setter: (val: string) => void) => {
        setKeyWriteError(prev => ({ ...prev, [provider]: '' }));
        try {
            let result;
            // @ts-ignore
            if (provider === 'gemini') result = await window.electronAPI.setGeminiApiKey('');
            // @ts-ignore
            if (provider === 'groq') result = await window.electronAPI.setGroqApiKey('');
            // @ts-ignore
            if (provider === 'openai') result = await window.electronAPI.setOpenaiApiKey('');
            // @ts-ignore
            if (provider === 'claude') result = await window.electronAPI.setClaudeApiKey('');
            // @ts-ignore
            if (provider === 'deepseek') result = await window.electronAPI.setDeepseekApiKey('');
            if (provider === 'nvidia_nim') result = await window.electronAPI.setNvidiaNimApiKey('');
            if (provider === 'openrouter') result = await window.electronAPI.setOpenrouterApiKey('');
            if (provider === 'fluxion') result = await window.electronAPI.setFluxionConfig({ apiKey: '' });
            if (provider === 'agentrouter') result = await window.electronAPI.setAgentRouterApiKey('');

            if (result && result.success) {
                setHasStoredKey(prev => ({ ...prev, [provider]: false }));
                setter('');
                // NVIDIA's one key backs speech recognition too, so the main
                // process may have switched the speech provider off. The Audio
                // tab re-reads on the credentials-changed broadcast and will
                // show it as off; this only records WHY in the log.
                if (provider === 'nvidia_nim' && (result as { sttProviderCleared?: boolean }).sttProviderCleared) {
                    console.log('[Settings] NVIDIA key removed — speech recognition switched off (it shared this key)');
                }
                // Same shape, one layer deeper: the OpenRouter key also backs
                // embeddings and reranking, and clearing it reverts an OpenRouter
                // reranker to local. The Intelligence tab re-reads on the
                // credentials-changed broadcast; this records WHY and clears the
                // local flag so a re-opened dialog does not repeat a stale warning.
                if (provider === 'openrouter' && (result as { retrievalDeactivated?: boolean }).retrievalDeactivated) {
                    openrouterBacksRetrievalRef.current = false;
                    setOpenrouterBacksRetrieval(false);
                    console.log('[Settings] OpenRouter key removed — embeddings/reranking that used it were switched off');
                }
            } else if (result && (result as { success?: boolean }).success === false) {
                // The key is still stored; say so instead of leaving a trash
                // button that silently did nothing.
                setKeyWriteError(prev => ({ ...prev, [provider]: keyWriteFailureText(result as any, 'remove') }));
            }
        } catch (e) {
            console.error(`Failed to remove ${provider} key:`, e);
        }
    };

    const handleTestConnection = async (provider: string, key: string) => {
        // Allow testing if key is provided OR if we have a stored key
        if (!key.trim() && !hasStoredKey[provider]) {
            return;
        }
        setTestStatus(prev => ({ ...prev, [provider]: 'testing' }));
        setTestError(prev => ({ ...prev, [provider]: '' }));

        try {
            // @ts-ignore
            const result = await window.electronAPI.testLlmConnection(provider, key);
            if (result.success) {
                setTestStatus(prev => ({ ...prev, [provider]: 'success' }));
                setTimeout(() => setTestStatus(prev => ({ ...prev, [provider]: 'idle' })), 3000);
            } else {
                setTestStatus(prev => ({ ...prev, [provider]: 'error' }));
                setTestError(prev => ({ ...prev, [provider]: result.error || t('Connection failed') }));
            }
        } catch (e: any) {
            setTestStatus(prev => ({ ...prev, [provider]: 'error' }));
            setTestError(prev => ({ ...prev, [provider]: e.message || t('Connection failed') }));
        }
    };

    // --- Custom Provider Handlers ---

    const handleEditProvider = (provider: CustomProvider) => {
        setEditingProvider(provider);
        setCustomName(provider.name);
        setCustomCurl(provider.curlCommand);
        setCustomResponsePath(provider.responsePath || '');
        setCustomVision(provider.multimodal === true ? 'on' : provider.multimodal === false ? 'off' : 'auto');
        setIsEditingCustom(true);
        setCurlError(null);
    };

    const handleNewProvider = () => {
        setEditingProvider(null);
        setCustomName('');
        setCustomCurl('');
        setCustomResponsePath('');
        setCustomVision('auto');
        setIsEditingCustom(true);
        setCurlError(null);
    };

    const handleSaveCustom = async () => {
        setCurlError(null);
        if (!customName.trim()) {
            setCurlError(t("Provider Name is required."));
            return;
        }

        const validation = validateCurl(customCurl);
        if (!validation.isValid) {
            setCurlError(validation.message || t("Invalid cURL command."));
            return;
        }

        const newProvider: CustomProvider = {
            id: editingProvider ? editingProvider.id : crypto.randomUUID(),
            name: customName,
            curlCommand: customCurl,
            responsePath: customResponsePath,
            // 'auto' → omit the flag so the backend auto-detects from the template.
            ...(customVision === 'on' ? { multimodal: true } : customVision === 'off' ? { multimodal: false } : {}),
        };

        try {
            // @ts-ignore
            const result = await window.electronAPI.saveCustomProvider(newProvider);
            if (result.success) {
                // Refresh list
                // @ts-ignore
                const updated = await window.electronAPI.getCustomProviders();
                setCustomProviders(updated);
                setIsEditingCustom(false);
            } else {
                setCurlError(result.error ?? null);
            }
        } catch (e: any) {
            setCurlError(e.message);
        }
    };

    const handleDeleteCustom = (id: string) => setPendingConfirm({ kind: 'customProvider', id });

    const performDeleteCustom = async (id: string) => {
        try {
            // @ts-ignore
            const result = await window.electronAPI.deleteCustomProvider(id);
            if (result.success) {
                // @ts-ignore
                const updated = await window.electronAPI.getCustomProviders();
                setCustomProviders(updated);
            }
        } catch (e) {
            console.error("Failed to delete provider:", e);
        }
    };

    // Copy + action for whatever destructive request is currently pending.
    // Returning null keeps the dialog unmounted when nothing is pending.
    const confirmCopy = (() => {
        if (!pendingConfirm) return null;
        switch (pendingConfirm.kind) {
            case 'ninerouter':
                return {
                    title: t('Remove 9Router configuration?'),
                    description: t('The base URL, API key and token limit will be cleared. Discovered models will no longer appear in the model picker.'),
                    confirmLabel: t('Remove'),
                };
            case 'litellm':
                return {
                    title: t('Remove LiteLLM proxy configuration?'),
                    description: t('The proxy URL, virtual key, and token limit will be cleared. Discovered models will no longer appear in the model picker.'),
                    confirmLabel: t('Remove'),
                };
            case 'providerKey': {
                // NVIDIA issues ONE key for both chat and speech, so removing it
                // here also disables speech recognition if that is what it is
                // running on. Said before the click, not discovered afterwards.
                const alsoDisablesSpeech =
                    pendingConfirm.provider === 'nvidia_nim' && activeSttProvider === 'nvidia_nim';
                // OpenRouter issues ONE key for chat, embeddings AND reranking.
                // Removing it here reverts an OpenRouter reranker to the local
                // model and leaves an OpenRouter embedding space with no
                // credential — a silently degraded corpus if it is not said here.
                const alsoDisablesRetrieval =
                    pendingConfirm.provider === 'openrouter' && openrouterBacksRetrieval;
                return {
                    title: `${t('Remove the')} ${pendingConfirm.provider} ${t('API key?')}`,
                    description: alsoDisablesSpeech
                        ? t('The stored key is deleted. Speech recognition uses this same key, so it will be switched off too — you will need to pick another speech provider under Audio.')
                        : alsoDisablesRetrieval
                            ? t('The stored key is deleted. Embeddings and reranking use this same key, so they will fall back to the local models — you can pick another provider under Intelligence.')
                            : t('The stored key is deleted. You will need to paste it again to re-enable this provider.'),
                    confirmLabel: t('Remove key'),
                };
            }
            case 'customProvider':
                return {
                    title: t('Delete this custom provider?'),
                    description: t('Its endpoint, cURL template, and response path are deleted. This cannot be undone.'),
                    confirmLabel: t('Delete'),
                };
        }
    })();

    const runPendingConfirm = async () => {
        if (!pendingConfirm || confirmBusy) return;
        setConfirmBusy(true);
        try {
            switch (pendingConfirm.kind) {
                case 'litellm':
                    await performRemoveLitellm();
                    break;
                case 'ninerouter':
                    await performRemoveNinerouter();
                    break;
                case 'providerKey':
                    await performRemoveKey(pendingConfirm.provider, pendingConfirm.setter);
                    break;
                case 'customProvider':
                    await performDeleteCustom(pendingConfirm.id);
                    break;
            }
        } finally {
            // Always close, even if the action threw — the individual perform*
            // helpers already log and swallow their own failures.
            setConfirmBusy(false);
            setPendingConfirm(null);
        }
    };

    return (
        // `.aip-root` is the token scope; everything below resolves --aip-* by
        // DOM ancestry from here (which is why nothing in this file may portal).
        // ConfirmDialog DOES portal — it is pre-existing, renders outside this
        // subtree, and is intentionally not token-matched.
        // data-settings-stagger: header + cards + tablist settle in sequence on
        // tab entrance (rules in src/index.css). The three cloud/gateways/vision
        // panels below carry `data-stagger-skip` because they already own
        // `.aip-panel-fade`; without the opt-out this ladder's animation-delay
        // would apply to THAT animation and put a 175ms stall in front of every
        // in-tab panel switch. `.aip-root`'s own reduced-motion guard (~line 841)
        // already neutralises both.
        <SettingsMotionReady.Provider value={motionReady}>
        <div className="aip-root space-y-5 pb-10" data-theme={theme} data-settings-stagger>
            <AmbiguousStoresCard />
            {confirmCopy && (
                <ConfirmDialog
                    open
                    onOpenChange={(next) => { if (!next) setPendingConfirm(null); }}
                    title={confirmCopy.title}
                    description={confirmCopy.description}
                    confirmLabel={confirmCopy.confirmLabel}
                    busy={confirmBusy}
                    onConfirm={runPendingConfirm}
                />
            )}
            <header>
                {/* mb-1 / mb-2, General's exact header rhythm — was mb-1 / mb-5,
                    which stacked 20px onto the 20px the aip-root space-y already
                    contributes and pushed the first control 40px down the panel. */}
                <h3 className="aip-title mb-1">{t('AI Providers')}</h3>
                <p className="aip-subtitle mb-2">
                    {t('Pick a default model and connect the cloud, local, or custom providers you want available.')}
                </p>
            </header>

            {/* Below the header, not above it. This is an advisory about one
                setting, and rendering it first opened the whole panel on a
                yellow warning with no title above it. AmbiguousStoresCard stays
                at the top on purpose: a credential-store conflict is an alarm
                about what the panel is showing you, not advice about a setting
                inside it. */}
            <LightweightEmbeddingNotice onOpenEmbeddings={onNavigate ? () => onNavigate('embedding') : undefined} />

            <div className="aip-card p-5 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                        <label className="block text-xs font-medium uppercase tracking-wide mb-0 aip-hero">{t('Active Model')}</label>
                        <p className="text-[10px] aip-muted mt-0.5">{t('Applies to new chats instantly.')}</p>
                    </div>
                    <ModelSelect
                        containerClassName={AIP_ACTIVE_SELECT_CONTAINER}
                        minLabel={HERO_MODEL_PICKER_MIN_LABEL}
                        value={defaultModel}
                        options={buildAvailableModelOptions()}
                        onChange={(val) => {
                            setDefaultModel(val);
                            // @ts-ignore - persist as default + update runtime + broadcast
                            window.electronAPI?.setDefaultModel(val).catch(console.error);
                        }}
                    />
                </div>

            <div className="aip-card p-5 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                        <label className="block text-xs font-medium uppercase tracking-wide mb-0 aip-hero">{t('Background Model')}</label>
                        <p className="text-[10px] aip-muted mt-0.5">{t('Runs Auto Answer, quick decisions and Fast Response Mode.')}</p>
                        {/* Advisory only: a big pick silently re-creates the latency
                            problem the measured judge ladder exists to avoid, but a
                            hard filter would need a hand-maintained list that goes
                            stale on every model retirement. */}
                        {!isKnownFastModel(fastModel) && (
                            <p className="text-[10px] aip-warn-fg mt-0.5 font-medium">{t('Large models make Auto Answer slower. Pick a small tier for the best results.')}</p>
                        )}
                    </div>
                    <ModelSelect
                        containerClassName={AIP_ACTIVE_SELECT_CONTAINER}
                        minLabel={HERO_MODEL_PICKER_MIN_LABEL}
                        value={fastModel}
                        options={buildFastModelOptions()}
                        onChange={async (val) => {
                            const previous = fastModel;
                            setFastModel(val);
                            try {
                                // @ts-ignore - null clears it, which means "use the measured ladder"
                                const res = await window.electronAPI?.setFastModel?.(val === 'auto' ? null : val);
                                // A resolved { success:false } is invisible to .catch(), and a
                                // missing preload method resolves undefined. Either way the write
                                // did not land, so the row must not keep showing the new value.
                                if (!res?.success) {
                                    setFastModel(previous);
                                    console.error('[Settings] Fast Model not saved:', res?.error ?? 'unavailable');
                                }
                            } catch (e) {
                                setFastModel(previous);
                                console.error('[Settings] Fast Model not saved:', e);
                            }
                        }}
                    />
                </div>

            <div className="aip-card p-5 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                        <label className="block text-xs font-medium uppercase tracking-wide mb-0 aip-hero">{t('AI Response Language')}</label>
                        <p className="text-[10px] aip-muted mt-0.5">
                            {aiResponseLanguage === 'auto'
                                ? t('Mirrors user\'s language automatically')
                                : t('Language for AI suggestions and notes')
                            }
                        </p>
                    </div>
                    <div className={AIP_ACTIVE_SELECT_CONTAINER} ref={aiLangDropdownRef}>
                        <button
                            type="button"
                            onClick={onToggleAiLangDropdown}
                            aria-expanded={isAiLangDropdownOpen}
                            className="aip-select-trigger"
                        >
                            <span className="capitalize truncate pr-2">
                                {capPickerLabel(aiResponseLanguage === 'auto' ? t('Auto') : aiResponseLanguage)}
                            </span>
                            <ChevronDown size={14} strokeWidth={1.75} className="aip-select-chevron" aria-hidden="true" />
                        </button>

                        <SettingsMenu
                                open={isAiLangDropdownOpen}
                                origin="top right"
                                role="listbox"
                                ariaLabel={t('AI Response Language')}
                                className="aip-float aip-scroll-y absolute right-0 top-full mt-1 min-w-full w-max z-20 p-1 select-none max-h-60 custom-scrollbar"
                            >
                                {availableAiLanguages.map((option) => (
                                    <button
                                        key={option.code}
                                        onClick={() => onSelectAiLanguage(option.code)}
                                        className={`aip-select-option ${aiResponseLanguage === option.code ? 'aip-text' : ''}`}
                                        aria-selected={aiResponseLanguage === option.code}
                                        role="option"
                                    >
                                        {option.code === 'auto' ? (
                                            <span className="font-medium">{t('Auto')}</span>
                                        ) : (
                                            <span className="font-medium">{option.label}</span>
                                        )}
                                    </button>
                                ))}
                        </SettingsMenu>
                    </div>
                </div>

            <div className="aip-card p-5 flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <label className="block text-xs font-medium uppercase tracking-wide mb-0 aip-hero">{t('Direct Assist')}</label>
                            {/* The Liquid Glass material rather than .aip-badge:
                                a tag qualifies the title beside it, and this one
                                carries no status, so it also drops the status dot
                                that primitive leads with.

                                `sky` is a LIGHT fill, which inverts the material's
                                lighting model — specular on the top face only, plus
                                a contact shadow — so it is the one variant that
                                looks the same in both themes without a per-theme
                                block. Its white label is 2.81:1, below the AA floor
                                for text this size; design.md records that as a
                                deliberate choice for this variant, and it is one
                                here too. A navy label on the same fill reaches
                                5.31:1 if that ever needs to change. */}
                            <LiquidGlassBadge variant="sky">{t('Beta')}</LiquidGlassBadge>
                        </div>
                        <p className="text-[10px] aip-muted mt-0.5">
                            {t('Sends your typed, spoken, screenshot, and page input straight to the model, unprocessed.')}
                        </p>
                        <AipRevealNote text={directAssistError} className="text-[10px] aip-danger-fg mt-1" role="alert" />
                    </div>
                    <AipSwitch
                        checked={directAssistEnabled}
                        disabled={directAssistBusy}
                        label={t('Direct Assist')}
                        onChange={async () => {
                            if (directAssistBusy) return;
                            const previous = directAssistEnabled;
                            const next = !previous;
                            setDirectAssistBusy(true);
                            setDirectAssistError('');
                            setDirectAssistEnabled(next);
                            try {
                                const result = await window.electronAPI?.setDirectAssistEnabled?.(next);
                                if (!result?.success) {
                                    setDirectAssistEnabled(previous);
                                    setDirectAssistError(result?.error || t('Could not update Direct Assist.'));
                                }
                            } catch (error) {
                                setDirectAssistEnabled(previous);
                                setDirectAssistError(
                                    error instanceof Error ? error.message : t('Could not update Direct Assist.'),
                                );
                            } finally {
                                setDirectAssistBusy(false);
                            }
                        }}
                    />
                </div>

<div
                    className={`aip-card p-5 flex items-center justify-between gap-4 ${!canUseFastMode ? 'opacity-50 grayscale' : ''}`}
                    title={!canUseFastMode ? fastModeUnavailableNote : ""}
                >
                    <div className="flex-1 min-w-0">
                        {/* No "Needs Groq" badge. It named ONE of the things that
                            satisfy canUseFastMode (a Background Model pick, any
                            connected vendor's fast tier, Natively API, Codex), so it read as a hard Groq dependency
                            that does not exist — and the line below already
                            states the real requirement in full, as does the
                            card's title. A badge carries only what no other
                            control already says. */}
                        <label className="block text-xs font-medium uppercase tracking-wide mb-0 aip-hero">{t('Fast Response Mode')}</label>
                        {/* Says which model will answer: the Background Model when one
                            is picked, otherwise Auto's fastest connected model. */}
                        <p className="text-[10px] aip-muted mt-0.5">{hasFastModelPick
                            ? t('Answers with the Background Model, not the Active Model.')
                            : t('Uses the fastest available provider instead of your selected model.')}</p>
                        <AipRevealNote
                            text={!canUseFastMode ? fastModeUnavailableNote : ''}
                            className="text-xs aip-warn-fg mt-0.5 font-medium"
                        />
                        <AipRevealNote
                            text={canUseFastMode && fastResponseMode && !fastModeAppliesToActiveModel
                                ? (defaultModel.startsWith('antigravity:') || defaultModel.startsWith('ollama-')
                                    ? t('Not applied while the Active Model is a local or Antigravity model.')
                                    : hasFastModelPick
                                        ? t('Your Background Model isn\'t available — pick another or choose Auto.')
                                        : activeIsSelfHosted
                                            ? t('On Auto this stays on your own endpoint — pick a Background Model to use another.')
                                            : !hasAutoCandidate
                                                ? t('Not applied: the providers it can use are switched off.')
                                                : t('Not applied to the current Active Model — pick a Background Model above for this to take effect.'))
                                : ''}
                            className="text-xs aip-warn-fg mt-0.5 font-medium"
                        />
                    </div>
                    {/* When unavailable, the click does nothing: the reason is
                        already spelled out inline by the AipRevealNote above. It
                        used to also alert() it, but a native alert is its own OS
                        window outside content protection, so it showed up in
                        screen shares while Undetectable was on. */}
                    <AipSwitch
                        checked={fastResponseMode}
                        disabled={!canUseFastMode}
                        label={t('Fast Response Mode')}
                        onChange={async () => {
                            if (!canUseFastMode) return;
                            const newState = !fastResponseMode;
                            setFastResponseMode(newState);
                            localStorage.setItem('natively_groq_fast_text', String(newState));
                            // @ts-ignore
                            await window.electronAPI?.setGroqFastTextMode(newState);
                        }}
                    />
                </div>

            {/* Provider groups. Splits the sections below into three views instead
                of one long scroll. Each tab now carries id + aria-controls, each
                panel role="tabpanel" + aria-labelledby + tabIndex, and the list has
                a roving-tabindex key handler (see handleTabKeyDown) — without it a
                keyboard user landed on the active tab and could never leave it.

                Motion is the meeting-notes Summary/Transcript/Usage switcher's
                (MeetingDetails.tsx): the same framer-motion spring, stiffness 400
                / damping 30. Measured here: 2.8% positional overshoot, settled by
                ~640ms, and on an interrupt at +100ms the pill goes 32 -> 23 -> 48
                -> 46 px/frame — it keeps its speed instead of restarting from
                rest, which is what the old `transition-transform` did (a fresh
                full duration eased in from zero velocity, every time). That
                interruption behaviour is the part that actually reads as "the
                same switcher"; the easing curve alone is not.

                What is deliberately NOT copied is MeetingDetails' `layoutId`
                shared-layout element. This pill is ONE node that never unmounts,
                springing `x` across the track. The reason is a real regression the
                layoutId version caused: switching tabs from a scrolled position
                snapped the panel back to the top. No code writes scrollTop (a
                patched setter caught zero writes) — layout projection forces a
                measure pass around the panel unmount/mount, the scroller's content
                transiently collapses below scrollTop + clientHeight, and Chromium
                clamps. Measured in the harness: scrollTop 260 -> 0 with layoutId,
                260 -> 260 with this version, same spring in both. `overflow-anchor:
                none` on SettingsOverlay's scroller means nothing restores it.

                Still transform-only, and the tabs themselves still never restyle
                their background — which is what stops the three-way colour swap
                that a per-button `bg` transition produces. Only the label colour
                crossfades, from `.aip-tab`'s own CSS transition.

                The track's `overflow-hidden` is GONE, and that is load-bearing:
                the spring overshoots by ~13px on the ~465px cloud->privacy hop
                while the track has only 4px of `p-1` plus a ~1px gap to spare, so
                on the end tabs the clip shaved the pill's outer edge flat for ~4
                frames — exactly the part of the meeting-notes feel being ported.
                Nothing else needed the clip: the pill is inset and `rounded-md`
                inside the track's `rounded-lg`, and the labels self-truncate. */}
            <div
                role="tablist"
                aria-label={t('Provider groups')}
                className="aip-tablist grid grid-cols-3 relative p-1 rounded-lg"
            >
                <motion.div
                    aria-hidden="true"
                    className="absolute top-0 bottom-0 left-0 w-1/3 p-1 will-change-transform"
                    initial={false}
                    animate={{ x: `${activeTabIndex * 100}%` }}
                    transition={prefersReducedMotion
                        ? { duration: 0 }
                        : { type: 'spring', stiffness: 400, damping: 30 }}
                >
                    <div className="w-full h-full rounded-md aip-tab-pill" />
                </motion.div>

                {PROVIDER_TABS.map(({ id, label, Icon }) => (
                    <button
                        key={id}
                        id={tabButtonId(id)}
                        ref={(node) => { tabRefs.current[id] = node; }}
                        type="button"
                        role="tab"
                        aria-selected={activeTab === id}
                        aria-controls={tabPanelId(id)}
                        tabIndex={activeTab === id ? 0 : -1}
                        onClick={() => setActiveTab(id)}
                        onKeyDown={handleTabKeyDown}
                        className="aip-tab relative z-10 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium"
                    >
                        <Icon size={13} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
                        <span className="truncate">{t(label)}</span>
                    </button>
                ))}
            </div>

            {/* Incoming panel only, no exit animation: the outgoing panel unmounts
                synchronously so the scroller never sees two children (an
                AnimatePresence cross-fade doubles content height for a frame,
                which flashes the scrollbar and jumps scrollTop). Each branch sits
                at its own fixed child position, so switching tabs already forces
                an unmount + mount and re-runs .aip-panel-fade — no `key` needed. */}
            {activeTab === 'cloud' && (
            <div
                id={tabPanelId('cloud')}
                role="tabpanel"
                aria-labelledby={tabButtonId('cloud')}
                tabIndex={0}
                className="space-y-5 aip-panel-fade"
                data-stagger-skip
            >
            {/* Cloud Providers */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-sm font-bold aip-hero mb-1">{t('Cloud Providers')}</h3>
                    <p className="text-xs aip-muted mb-2">{t('Add API keys to unlock cloud AI models.')}</p>
                </div>

                <div className="aip-cq space-y-4">

                    {CLOUD_PROVIDERS.map(({ id, name, placeholder, url }) => {
                        const [keyValue, setKeyValue] = keyFields[id];
                        return (
                            <ProviderCard
                                key={id}
                                providerId={id}
                                providerName={name}
                                keyPlaceholder={placeholder}
                                keyUrl={url}
                                apiKey={keyValue}
                                onKeyChange={setKeyValue}
                                hasStoredKey={!!hasStoredKey[id]}
                                preferredModel={preferredModels[id]}
                                isDisabled={disabledProviders.includes(id)}
                                onToggleDisabled={(enabled) => handleToggleProvider(id, enabled)}
                                selectableModels={effectiveModels(id)}
                                enabledModels={cloudEnabledModels[id]}
                                onToggleModel={(modelId) => handleToggleModel(id, modelId)}
                                onResetModels={() => handleResetModels(id)}
                                onSetDefaultModel={(modelId) => handleSetDefaultModel(id, modelId)}
                                hasCatalog={(cloudFetchedModels[id]?.length ?? 0) > 0}
                                fetchedAt={cloudFetchedAt[id]}
                                modelSaveError={!!modelSaveError[id]}
                                onSaveKey={async () => { await handleSaveKey(id, keyValue, setKeyValue); }}
                                onRemoveKey={() => handleRemoveKey(id, setKeyValue)}
                                onTestConnection={() => handleTestConnection(id, keyValue)}
                                testStatus={testStatus[id] || 'idle'}
                                testError={testError[id]}
                                keyWriteError={keyWriteError[id]}
                                savingStatus={!!savingStatus[id]}
                                savedStatus={!!savedStatus[id]}
                                onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, [id]: model }))}
                                extraControls={id !== 'fluxion' || !hasStoredKey.fluxion ? undefined : (
                                    /* One muted line, not a label + two buttons + a hint.
                                       The protocol is DETECTED from the key's group on save
                                       (see detectFluxionProtocol), so there is nothing here
                                       for the user to decide — this only reports what was
                                       found, the way a resolved value should. */
                                    <div className="aip-provider-row">
                                        <span className="text-[11px] aip-muted">
                                            {t('API format')}: {fluxionProtocol === 'anthropic' ? t('Anthropic') : t('OpenAI')}
                                            {' · '}
                                            {t('detected from your key')}
                                        </span>
                                    </div>
                                )}
                            />
                        );
                    })}

                </div>
            </div>

            {/* Google Antigravity */}
            <div className="aip-card p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex gap-3">
                        <AipProviderMark provider="antigravity" name="Google Antigravity" className="mt-0.5" />
                        <div>
                            <h3 className="text-sm font-bold aip-hero mb-1">Google Antigravity</h3>
                            <p className="text-xs aip-muted">{t('Sign in with Google to use your Antigravity models.')}</p>
                        </div>
                    </div>
                    {/* Same switch every other provider header carries (Codex above,
                        ProviderCard's key-backed providers below) — not an
                        Enable/Disable button, which read as a different kind of
                        control for the same state. Shown unconditionally, like
                        Codex: ProviderCard gates its switch on `hasStoredKey`
                        because there is nothing to hide before a key exists, but
                        this provider's models are gated by sign-in, not a key, and
                        the disabled flag is independently meaningful. */}
                    <AipSwitch
                        checked={!disabledProviders.includes('antigravity')}
                        onChange={() => handleToggleProvider('antigravity', disabledProviders.includes('antigravity'))}
                        label={`${disabledProviders.includes('antigravity') ? t('Enable') : t('Disable')} Google Antigravity`}
                        title={disabledProviders.includes('antigravity') ? t('Enable provider') : t('Disable provider')}
                    />
                </div>
                {/* No "Not connected" line: the sign-in bar directly below already
                    says the account is not connected, so the label was a second
                    copy of the same fact taking a row.
                    The live region stays MOUNTED and is hidden instead of being
                    conditionally rendered — a role="status" that mounts together
                    with its first message is not reliably announced, and Tailwind's
                    space-y uses `:not([hidden]) ~ :not([hidden])`, so a hidden node
                    drops out of the spacing chain and leaves no gap. */}
                <p className="text-xs aip-muted" role="status" hidden={!antigravityStatus.inProgress && !antigravityStatus.signedIn}>
                    {antigravityStatus.inProgress ? t('Waiting for Google sign-in…')
                        : antigravityStatus.signedIn ? t('Antigravity connected') : ''}
                    {antigravityStatus.signedIn && antigravityStatus.expiresAt && ` · ${t('Refreshes automatically before')} ${new Date(antigravityStatus.expiresAt).toLocaleTimeString()}`}
                </p>
                {/* Primary action takes Codex's full-width row SHAPE (aip-btn
                    flex-1, data-size="row") but NOT its data-variant="accent":
                    the accent tint is periwinkle in this panel's token scope, and
                    the card keeps the neutral button colour it already had.
                    Cancel stays a compact ghost beside the in-flight bar rather
                    than replacing it — Antigravity can abort a pending browser
                    round-trip and Codex cannot, and that capability should not
                    cost the shared shape. */}
                {/* `.aip-provider-row`, the same class Groq / NVIDIA NIM / every
                    ProviderCard action row uses — not an ad-hoc `flex flex-wrap gap-2`,
                    which was 8px in both axes where that class is 12px column / 8px row.
                    Reusing it keeps the two card families spaced identically instead of
                    close enough to look like a mistake. */}
                <div className="aip-provider-row">
                    {/* ONE bar through the round-trip: its label swaps to the wait
                        and Cancel fades in beside it, where the two used to be
                        different buttons that cut from one to the other. */}
                    {antigravityStatus.inProgress || !antigravityStatus.signedIn ? (
                        <>
                            <button
                                type="button"
                                className="aip-btn flex-1"
                                data-size="row"
                                disabled={antigravityStatus.inProgress || antigravityBusy}
                                onClick={() => void runAntigravityAction('login')}
                            >
                                <SwapLabel id={antigravityStatus.inProgress ? 'waiting' : 'signin'} sizers={[]}>
                                    {antigravityStatus.inProgress
                                        ? <span className="inline-flex items-center gap-1.5"><Loader2 size={13} strokeWidth={1.75} className="aip-spinner" />{t('Waiting for browser…')}</span>
                                        : <span className="inline-flex items-center gap-1.5"><ExternalLink size={13} strokeWidth={1.75} />{t('Sign in with Google')}</span>}
                                </SwapLabel>
                            </button>
                            <Presence kind="control" id={antigravityStatus.inProgress ? 'cancel' : null} className="shrink-0">
                                <button
                                    type="button"
                                    className="aip-btn shrink-0"
                                    data-size="row"
                                    data-variant="ghost"
                                    onClick={() => window.electronAPI.antigravityCancelLogin().catch(() => setAntigravityError(t('Could not cancel sign-in. Try again.')))}
                                >{t('Cancel')}</button>
                            </Presence>
                        </>
                    ) : (<>
                        {/* "Reload models" is gone from this row: AipModelList owns
                           discovery, exactly as ProviderCard's comment says for the cloud
                           cards. Two controls for one action is what that note warns about. */}
                        <button type="button" className="aip-btn" onClick={() => void runAntigravityAction('logout')}>{t('Disconnect')}</button>

                        {/* Beside Disconnect, not under it — the same row placement Groq,
                            NVIDIA NIM and every other ProviderCard uses.

                            It MUST be a direct child of this wrapping flex row: AipModelList
                            is a fragment whose summary is `order-2` (so it lands after the
                            order-0 buttons) and whose panel is `basis-full order-4` (so the
                            panel wraps onto its own line). Outside a wrapping flex row those
                            classes are inert and the panel squeezes — which is exactly what
                            it did when this sat in a block below. The enclosing fragment is
                            transparent to flex, so these stay direct children.

                            Ids carry the `antigravity:` prefix because that is the form
                            buildAvailableModelOptions and the allow-list already use; a bare
                            id would tick a row that never matches at read time. Antigravity
                            is not an opt-in provider (isOptInModelProvider is litellm-only),
                            so an empty allow-list still means ALL models. */}
                        {antigravityModels.length > 0 && !disabledProviders.includes('antigravity') && (
                            <AipModelList
                                visionControl
                                models={antigravityModels.map(({ id, label }) => ({ id: `antigravity:${id}`, label }))}
                                enabled={cloudEnabledModels['antigravity'] || []}
                                onToggle={(modelId) => handleToggleModel('antigravity', modelId)}
                                onReset={() => handleResetModels('antigravity')}
                                defaultId={defaultModel.startsWith('antigravity:') ? defaultModel : undefined}
                                onSetDefault={(modelId) => void handleSetAntigravityDefault(modelId)}
                                error={modelSaveError['antigravity'] ? 'save-failed' : null}
                                refreshing={antigravityBusy}
                                onRefresh={() => void runAntigravityAction('models')}
                                catalogIsComplete
                            />
                        )}
                    </>)}
                </div>
                {/* The empty catalogue keeps its own Reload control. Discovery moved
                    into AipModelList, which is gated on `antigravityModels.length > 0`
                    — so in exactly the state that needs a retry there was none, and
                    signing out and back in was the only way to re-run it. */}
                {antigravityStatus.signedIn && antigravityModels.length === 0 && (
                    <div className="space-y-1">
                        <p className="text-xs aip-muted">{t('No Antigravity models currently have quota.')}</p>
                        <button type="button" className="aip-btn" data-size="sm" disabled={antigravityBusy} onClick={() => void runAntigravityAction('models')}>
                            <RefreshCw size={12} strokeWidth={1.75} className={antigravityBusy ? 'aip-spinner' : undefined} />
                            {antigravityBusy ? t('Reloading…') : t('Reload models')}
                        </button>
                    </div>
                )}
                {antigravityError && <p className="text-xs aip-warn-fg" role="alert">{antigravityError}</p>}
            </div>

            {/* Codex — ChatGPT subscription proxy.

                Same card shape as Google Antigravity above: ONE aip-card that owns
                its provider header (mark + title + description + switch), then a
                hidden-until-meaningful role="status" line, then the action row.
                Previously the header sat OUTSIDE the card and the card repeated the
                provider with a "ChatGPT Account" label — two nested sections for one
                provider, and the only card on the panel shaped that way.

                The account email moves from a dedicated `aip-well` into the status
                line, which is where Antigravity puts the same fact; the well was the
                third element competing to say "you are signed in". */}
            <div className="aip-card p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex gap-3 min-w-0">
                        <AipProviderMark provider="codex" name="OpenAI Codex" className="mt-0.5" />
                        <div className="min-w-0">
                            <h3 className="text-sm font-bold aip-hero mb-1">OpenAI Codex</h3>
                            <p className="text-xs aip-muted">{t('Use your ChatGPT Plus/Pro subscription as an AI provider.')}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {/* Refresh / Sign out act on Natively's own tokens only, so a
                            `codex login` session gets the sign-in button below instead —
                            signing in here takes precedence over the CLI login.
                            Icon-only beside the switch with transitions.dev #17 tooltips. */}
                        {codexOauthStatus.signedIn && codexOauthStatus.source !== 'codex-cli' && <>
                            <span className="t-tt-wrap">
                                <button
                                    type="button"
                                    onClick={handleCodexRefresh}
                                    disabled={codexOauthInProgress}
                                    className="aip-btn aip-codex-action-btn aip-codex-refresh-btn t-tt-trigger"
                                    data-icon="true"
                                    data-variant="ghost"
                                    aria-label={t('Refresh session')}
                                    aria-describedby="codex-tt-refresh"
                                >
                                    <RefreshCw size={16} strokeWidth={1.75} className={codexOauthInProgress ? 'aip-spinner' : undefined} />
                                </button>
                                <span className="t-tt" id="codex-tt-refresh" role="tooltip">
                                    {t('Refresh')}
                                </span>
                            </span>
                            <span className="t-tt-wrap">
                                <button
                                    type="button"
                                    onClick={handleCodexSignOut}
                                    disabled={codexOauthInProgress}
                                    className="aip-btn aip-codex-action-btn aip-codex-logout-btn t-tt-trigger"
                                    data-icon="true"
                                    data-variant="ghost"
                                    aria-label={t('Sign out')}
                                    aria-describedby="codex-tt-logout"
                                >
                                    <LogOut size={16} strokeWidth={1.75} />
                                </button>
                                <span className="t-tt" id="codex-tt-logout" role="tooltip">
                                    {t('Logout')}
                                </span>
                            </span>
                        </>}
                        <AipSwitch
                            checked={!disabledProviders.includes('codex-cli')}
                            onChange={() => handleToggleProvider('codex-cli', disabledProviders.includes('codex-cli'))}
                            label={`${disabledProviders.includes('codex-cli') ? t('Enable') : t('Disable')} OpenAI Codex`}
                            title={disabledProviders.includes('codex-cli') ? t('Enable provider') : t('Disable provider')}
                        />
                    </div>
                </div>

                {/* Mounted-but-hidden live region, same reasoning as Antigravity's. */}
                <p className="text-xs aip-muted" role="status" hidden={!codexOauthInProgress && !codexOauthStatus.signedIn}>
                    {codexOauthInProgress ? t('Waiting for browser…')
                        : codexOauthStatus.signedIn
                            ? `${codexOauthStatus.source === 'codex-cli' ? t('Using your Codex CLI login') : t('Codex connected')}${codexOauthStatus.email ? ` · ${codexOauthStatus.email}` : ''}`
                            : ''}
                </p>

                {/* Only the sign-in state has a row now — Refresh / Sign out live
                    in the header — so it isn't mounted empty under space-y-4. */}
                {(!codexOauthStatus.signedIn || codexOauthStatus.source === 'codex-cli') && (
                    <div className="flex flex-wrap gap-2">
                        {/* Full-width row, and NEUTRAL: data-variant="accent" tints it
                           periwinkle, which the Antigravity bar deliberately does not do. */}
                        <button
                            type="button"
                            onClick={() => handleCodexAuthAction('login')}
                            disabled={codexOauthInProgress || codexAuthAction !== 'idle'}
                            className="aip-btn flex-1"
                            data-size="row"
                        >
                            <SwapLabel id={codexOauthInProgress || codexAuthAction === 'login' ? 'waiting' : 'signin'} sizers={[]}>
                                {codexOauthInProgress || codexAuthAction === 'login'
                                    ? <span className="inline-flex items-center gap-1.5"><Loader2 size={13} strokeWidth={1.75} className="aip-spinner" />{t('Waiting for browser…')}</span>
                                    : <span className="inline-flex items-center gap-1.5"><ExternalLink size={13} strokeWidth={1.75} />{t('Sign in with ChatGPT')}</span>}
                            </SwapLabel>
                        </button>
                    </div>
                )}

                {/* The Codex CLI's `codex login` works too, read-only: Natively
                    never refreshes it (that would sign the CLI out), so an
                    expired one is refreshed from the CLI side. */}
                {!codexOauthStatus.signedIn && (
                    <p className="text-xs aip-muted">
                        {codexOauthStatus.cliLogin === 'expired'
                            ? t('Codex CLI login expired — run `codex` to refresh, or sign in above.')
                            : codexOauthStatus.cliLogin === 'api-key'
                                ? t('Your Codex CLI is logged in with an API key, which Codex here cannot use — sign in with ChatGPT here, or run `codex login` with your ChatGPT account.')
                                : t('Or run `codex login` in a terminal — Natively can use that ChatGPT login too.')}
                    </p>
                )}
                {codexOauthStatus.signedIn && codexOauthStatus.source === 'codex-cli' && (
                    <p className="text-xs aip-muted">
                        {t('Natively uses this login read-only. When it expires, run any `codex` command to refresh it.')}
                    </p>
                )}

                {codexAuthMessage && (
                    <p className={`text-xs ${codexAuthStatus === 'error' ? 'aip-danger-fg' : 'aip-ok-fg'}`} role="alert">
                        {codexAuthMessage}
                    </p>
                )}

                {/* Model + settings — only shown once signed in */}
                {codexOauthStatus.signedIn && (
                        <>
                            {/* The same model list every provider card has, where two
                                dropdowns used to be. "Set default" replaces the Model
                                dropdown (handleSetCodexDefault). The "Fast Mode Model"
                                dropdown is gone: Fast Response Mode answers with the
                                Background Model, and a Codex model other than this
                                default is picked THERE now. Direct child of
                                .aip-provider-row for the reason Antigravity's comment gives. */}
                            {!disabledProviders.includes('codex-cli') && (
                                <div className="aip-provider-row">
                                    <AipModelList
                                        visionControl
                                        models={effectiveModels('codex-cli')}
                                        enabled={cloudEnabledModels['codex-cli'] || []}
                                        onToggle={(modelId) => handleToggleModel('codex-cli', modelId)}
                                        onReset={() => handleResetModels('codex-cli')}
                                        defaultId={codexCliSelectorId(codexCliConfig.model)}
                                        onSetDefault={(modelId) => void handleSetCodexDefault(modelId)}
                                        error={modelSaveError['codex-cli'] ? 'save-failed' : null}
                                        refreshing={codexModelsRefreshing}
                                        // Refresh re-reads the installed Codex CLI's model cache; with
                                        // no CLI list there is nothing it could ever add.
                                        onRefresh={codexModelsFromCli ? () => void handleRefreshCodexModels() : undefined}
                                        catalogIsComplete={codexModelsFromCli}
                                    />
                                </div>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <label className="space-y-1 block min-w-0">
                                    <span className="aip-label">{t('Reasoning Effort')}</span>
                                    <ModelSelect
                                        value={(() => {
                                            const valid = getValidCodexReasoningEfforts(codexCliConfig.model);
                                            if (!codexCliConfig.modelReasoningEffort) return '';
                                            return valid.includes(codexCliConfig.modelReasoningEffort)
                                                ? codexCliConfig.modelReasoningEffort
                                                : '';
                                        })()}
                                        options={(() => {
                                            const valid = getValidCodexReasoningEfforts(codexCliConfig.model);
                                            return [
                                                { id: '', name: t('None (default)') },
                                                ...CODEX_MODEL_REASONING_EFFORTS
                                                    .filter(e => e !== 'none' && valid.includes(e))
                                                    .map(e => ({ id: e, name: e.charAt(0).toUpperCase() + e.slice(1) })),
                                            ];
                                        })()}
                                        onChange={(effort) => saveCodexCliConfig({ ...codexCliConfig, modelReasoningEffort: effort || undefined })}
                                        placeholder={t("None (default)")}
                                    />
                                    {(() => {
                                        const valid = getValidCodexReasoningEfforts(codexCliConfig.model);
                                        const saved = codexCliConfig.modelReasoningEffort;
                                        if (saved && !valid.includes(saved)) {
                                            return (
                                                <p className="aip-meta aip-warn-fg flex items-center gap-1.5">
                                                    <AipBadge tone="warn" label={t('Unsupported')} />
                                                    '{saved}' {t("unsupported by this model — will default to 'low'.")}
                                                </p>
                                            );
                                        }
                                        return null;
                                    })()}
                                </label>
                                <label className="space-y-1 block min-w-0">
                                    <span className="aip-label">{t('Service Tier')}</span>
                                    <ModelSelect
                                        value={codexCliConfig.serviceTier ?? 'default'}
                                        options={CODEX_SERVICE_TIERS.map(t => ({ id: t, name: t.charAt(0).toUpperCase() + t.slice(1) }))}
                                        onChange={(serviceTier) => saveCodexCliConfig({ ...codexCliConfig, serviceTier: serviceTier as typeof CODEX_SERVICE_TIERS[number] })}
                                        placeholder={t("Default")}
                                    />
                                </label>
                            </div>
                            {/* Same grid as the selectors above, so Test Connection is
                                exactly one selector wide and tall. The error sits in its
                                own full-width row so it can't push the button off the
                                input's baseline. */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end mt-1">
                                <label className="space-y-1 block min-w-0">
                                    <span className="aip-label">{t('Timeout (ms)')}</span>
                                    <input
                                        type="number"
                                        value={codexCliConfig.timeoutMs}
                                        onChange={e => setCodexCliConfig(prev => ({ ...prev, timeoutMs: Number(e.target.value) }))}
                                        onBlur={() => saveCodexCliConfig()}
                                        data-mono="true"
                                        className="aip-input"
                                        min={1000}
                                    />
                                </label>
                                {/* Column-width + centred content: a label change
                                    ("Test Connection" → "Testing…") must not reflow
                                    the row it sits in. */}
                                <button
                                    type="button"
                                    onClick={handleTestCodexCli}
                                    disabled={codexCliStatus === 'testing'}
                                    className="aip-btn w-full"
                                    data-tone={codexCliStatus === 'success' ? 'ok' : codexCliStatus === 'error' ? 'danger' : undefined}
                                >
                                    <SwapLabel
                                        id={codexCliStatus}
                                        sizers={[t('Test Connection')]}
                                    >
                                    {codexCliStatus === 'testing' ? (
                                        <span className="inline-flex items-center gap-1.5"><Loader2 size={12} strokeWidth={1.75} className="aip-spinner" />{t('Testing…')}</span>
                                    ) : codexCliStatus === 'success' ? (
                                        <span className="inline-flex items-center gap-1.5"><AipPassedCheck />{t('Passed')}</span>
                                    ) : codexCliStatus === 'error' ? (
                                        <span className="inline-flex items-center gap-1.5"><AlertCircle size={12} strokeWidth={1.75} />{t('Failed')}</span>
                                    ) : (
                                        t('Test Connection')
                                    )}
                                    </SwapLabel>
                                </button>
                                {codexCliStatus === 'error' && codexCliError && (
                                    <p className="text-[10px] aip-danger-fg md:col-span-2">{codexCliError}</p>
                                )}
                            </div>
                        </>
                    )}
            </div>

            </div>
            )}

            {activeTab === 'gateways' && (
            <div
                id={tabPanelId('gateways')}
                role="tabpanel"
                aria-labelledby={tabButtonId('gateways')}
                tabIndex={0}
                className="space-y-5 aip-panel-fade"
                data-stagger-skip
            >
            {/* LiteLLM — OpenAI-compatible AI gateway, grouped with the other gateways. */}
            <div className="space-y-5">
                <div className="space-y-4">
                    {/* LiteLLM — OpenAI-compatible AI gateway (100+ providers via one proxy).
                        Three fields: proxy base URL (required), optional virtual key, and an
                        optional max-output-tokens override. Models are auto-discovered from
                        the proxy and appear in the model selector with a "litellm/" prefix. */}
                    <div className="aip-card p-5 space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-start gap-2.5 min-w-0">
                                <AipProviderMark provider="litellm" name="LiteLLM Proxy" className="mt-0.5" />
                                <div className="min-w-0">
                                <label className="block text-xs font-bold aip-hero mb-0">LiteLLM Proxy</label>
                                <p className="text-[10px] aip-muted">
                                    {t('OpenAI-compatible gateway to 100+ providers. Models auto-discovered from the proxy.')}{' '}
                                    <a href="https://docs.litellm.ai/docs/simple_proxy" target="_blank" rel="noreferrer" className="aip-link">{t('Docs')}</a>
                                </p>
                                </div>
                            </div>
                            {hasStoredKey.litellm && (
                                <div className="flex items-center gap-2 shrink-0">
                                    {/* Model count and re-discovery both live in the
                                        <AipModelList> below now — same as every cloud card.
                                        Keeping a second Refresh up here would give the card
                                        two controls for one action. */}
                                    <AipBadge tone="ok" label={t('Configured')} />
                                    <AipSwitch
                                        checked={!disabledProviders.includes('litellm')}
                                        onChange={() => handleToggleProvider('litellm', disabledProviders.includes('litellm'))}
                                        label={`${disabledProviders.includes('litellm') ? t('Enable') : t('Disable')} LiteLLM`}
                                        title={disabledProviders.includes('litellm') ? t('Enable provider') : t('Disable provider (keeps your configuration)')}
                                    />
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <label className="space-y-1 block min-w-0">
                                <span className="aip-label">{t('Proxy Base URL')}</span>
                                <input
                                    value={litellmBaseURL}
                                    onChange={e => setLitellmBaseURL(e.target.value)}
                                    data-mono="true"
                                    className="aip-input"
                                    placeholder="http://localhost:4000/v1"
                                />
                            </label>

                            <label className="space-y-1 block min-w-0">
                                <span className="aip-label">{t('Virtual Key (optional)')}</span>
                                <input
                                    type="password"
                                    value={litellmApiKey}
                                    onChange={e => setLitellmApiKey(e.target.value)}
                                    data-mono="true"
                                    className="aip-input"
                                    placeholder={hasStoredKey.litellm ? t('•••••••• (leave blank to keep)') : t('sk-... (only if proxy requires auth)')}
                                />
                            </label>
                        </div>

                        <div className="space-y-1">
                            <span className="block aip-label">{t('Max Output Tokens')}</span>
                            <ModelSelect
                                value={litellmMaxTokens}
                                options={LITELLM_MAX_TOKENS_OPTIONS}
                                onChange={setLitellmMaxTokens}
                                placeholder={t("Auto (per-model)")}
                            />
                            <p className="text-[10px] aip-muted">
                                {t("Auto reads each model's real output budget from the proxy's")} <span className="aip-code-inline">/model/info</span> {t('(falls back to 8,192 if unavailable). Pick a fixed value to override.')}
                            </p>
                        </div>

                        {/* flex-wrap, not plain flex: <AipModelList> is a fragment whose
                            summary is `order-2` (so it lands after these order-0 buttons)
                            and whose panel is `basis-full order-4` (so it wraps onto its
                            own line). Both only work as direct children of a wrapping flex
                            row — outside one the classes are inert and the panel squeezes. */}
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={handleSaveLitellm}
                                disabled={!litellmBaseURL.trim() || !!savingStatus.litellm}
                                className="aip-btn min-w-[92px]"
                                data-variant="accent"
                            >
                                <AipSaveLabel saving={!!savingStatus.litellm} saved={!!savedStatus.litellm} />
                            </button>
                            {/* Gains a Remove once saved: it fades in rather than landing. */}
                            <Presence kind="control" id={hasStoredKey.litellm ? 'remove' : null}>
                                <button
                                    type="button"
                                    onClick={handleRemoveLitellm}
                                    className="aip-btn"
                                    data-variant="ghost"
                                >
                                    {t('Remove')}
                                </button>
                            </Presence>

                            {/* The proxy can expose dozens of models; without this the Active
                                Model dropdown gets all of them. Reuses the cloud providers'
                                allow-list wholesale — `cloudEnabledModels` is keyed by provider
                                string, so 'litellm' needs no dedicated store or IPC channel.
                                `onSetDefault`/`defaultId` ride the same generic path: the value
                                lives in litellmPreferredModel (prefixed, like every id here) and
                                is read back by refreshRuntimeDefaultIfUnavailable(), which would
                                otherwise install whichever model the proxy happens to list first
                                when the active model becomes unavailable. */}
                            {hasStoredKey.litellm && (
                                <AipModelList
                                    visionControl
                                    models={effectiveModels('litellm')}
                                    enabled={cloudEnabledModels['litellm'] || []}
                                    onToggle={(modelId) => handleToggleModel('litellm', modelId)}
                                    onReset={() => handleResetModels('litellm')}
                                    defaultId={preferredModels['litellm']}
                                    onSetDefault={(modelId) => handleSetDefaultModel('litellm', modelId)}
                                    // A gateway fronts the upstream's whole catalogue (300+ is
                                    // normal), so this list is opt-in: nothing reaches the model
                                    // picker until it is ticked here.
                                    optIn
                                    onBulkToggle={(ids, enable) => handleBulkToggleModels('litellm', ids, enable)}
                                    error={modelSaveError['litellm'] ? 'save-failed' : null}
                                    refreshing={isRefreshingLitellm}
                                    onRefresh={handleRefreshLitellmModels}
                                    // Deliberately NOT gated on litellmModels.length: an empty
                                    // catalogue (proxy down at save time, or the cache cleared)
                                    // is exactly when the user needs Refresh, and this list is
                                    // now the only place it lives.
                                    onFirstOpen={() => {
                                        if (litellmModels.length === 0) handleRefreshLitellmModels();
                                    }}
                                />
                            )}
                        </div>
                    </div>
                </div>
            </div>


            {/* 9Router — self-hosted fallback proxy. Grouped with LiteLLM rather
                than with the Cloud providers because it is the same SHAPE: an
                address the user runs and pastes, not a vendor key. */}
            <div className="space-y-5">
                <div className="space-y-4">
                    <div className="aip-card p-5 space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-start gap-2.5 min-w-0">
                                <AipProviderMark provider="ninerouter" name="9Router" className="mt-0.5" />
                                <div className="min-w-0">
                                <label className="block text-xs font-bold aip-hero mb-0">9Router</label>
                                <p className="text-[10px] aip-muted">
                                    {t('Self-hosted proxy that falls back across 40+ providers. Models auto-discovered from your instance.')}{' '}
                                    <a href="https://github.com/decolua/9router" target="_blank" rel="noreferrer" className="aip-link">{t('Docs')}</a>
                                </p>
                                </div>
                            </div>
                            {hasStoredKey.ninerouter && (
                                <div className="flex items-center gap-2 shrink-0">
                                    {/* No "Configured" badge: the card already says so three
                                        times over — the fields are filled, Remove has
                                        appeared, and the switch itself only renders once
                                        there is a configuration to switch. */}
                                    <AipSwitch
                                        checked={!disabledProviders.includes('ninerouter')}
                                        onChange={() => handleToggleProvider('ninerouter', disabledProviders.includes('ninerouter'))}
                                        label={`${disabledProviders.includes('ninerouter') ? t('Enable') : t('Disable')} 9Router`}
                                        title={disabledProviders.includes('ninerouter') ? t('Enable provider') : t('Disable provider (keeps your configuration)')}
                                    />
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <label className="space-y-1 block min-w-0">
                                <span className="aip-label">{t('Base URL')}</span>
                                <input
                                    value={ninerouterBaseURL}
                                    onChange={e => { setNinerouterBaseURL(e.target.value); setNinerouterTest({ testing: false }); }}
                                    data-mono="true"
                                    className="aip-input"
                                    placeholder="http://localhost:20128/v1"
                                />
                            </label>

                            <label className="space-y-1 block min-w-0">
                                <span className="aip-label">{t('API Key')}</span>
                                <input
                                    type="password"
                                    value={ninerouterApiKey}
                                    onChange={e => { setNinerouterApiKey(e.target.value); setNinerouterTest({ testing: false }); }}
                                    data-mono="true"
                                    className="aip-input"
                                    placeholder={hasStoredKey.ninerouter ? t('•••••••• (leave blank to keep)') : t('From the 9Router dashboard → Keys')}
                                />
                            </label>
                        </div>

                        {/* Said here rather than discovered later: 9Router's model list
                            answers without a key, so a configuration can look complete
                            and still fail every question. */}
                        <p className="text-[10px] aip-muted">
                            {t('Your instance may serve its model list without a key while still requiring one to answer. Use Test Connection to be sure.')}
                        </p>

                        <div className="space-y-1">
                            <span className="block aip-label">{t('Max Output Tokens')}</span>
                            <ModelSelect
                                value={ninerouterMaxTokens}
                                options={LITELLM_MAX_TOKENS_OPTIONS}
                                onChange={setNinerouterMaxTokens}
                                placeholder={t("Auto (per-model)")}
                            />
                            <p className="text-[10px] aip-muted">
                                {t("Auto reads each model's real output budget from")} <span className="aip-code-inline">/v1/models</span> {t('(falls back to 64,000 if unavailable). Pick a fixed value to override.')}
                            </p>
                        </div>

                        {/* Thinking level.
                            45 of the 47 models a stock instance serves are reasoning
                            models, and reasoning_effort is honoured monotonically
                            (measured: none < low < medium < high). How much it buys
                            depends on the model and the prompt — on Gemini, Auto was
                            itself the fastest, because it varies effort per prompt.

                            The OPTIONS come from the selected model's own catalogue
                            entry, so a non-reasoning model shows no control at all and a
                            model that can only be turned DOWN says "Minimal" rather than
                            promising "Off". */}
                        {(() => {
                            const selected = (preferredModels['ninerouter'] || '').replace(/^ninerouter\//, '');
                            const opts = ninerouterThinkingOptions(selected ? ninerouterModelMeta[selected] : undefined);
                            if (opts.length === 0) {
                                return (
                                    <p className="text-[10px] aip-muted">
                                        {t('This model does not use reasoning, so there is no thinking level to set.')}
                                    </p>
                                );
                            }
                            return (
                                <div className="space-y-1">
                                    <span className="block aip-label">{t('Thinking')}</span>
                                    <ModelSelect
                                        /* An empty stored value IS the default, so the row
                                           shown is the first option rather than a blank —
                                           a control whose default renders as nothing reads
                                           as unset, and users then set it redundantly. */
                                        value={ninerouterThinking || opts[0].id}
                                        options={opts}
                                        onChange={setNinerouterThinking}
                                        placeholder={opts[0].name}
                                    />
                                    <p className="text-[10px] aip-muted">
                                        {selected
                                            ? t('Applies to the model you set as default here.')
                                            : t('Set a default model above to match these options to it.')}{' '}
                                        {t('Natively defaults to the fastest setting. Raise it when an answer needs more reasoning, or pick Auto to let the model choose.')}
                                    </p>
                                </div>
                            );
                        })()}

                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={handleSaveNinerouter}
                                disabled={!ninerouterBaseURL.trim() || !!savingStatus.ninerouter}
                                className="aip-btn min-w-[92px]"
                                data-variant="accent"
                            >
                                <AipSaveLabel saving={!!savingStatus.ninerouter} saved={!!savedStatus.ninerouter} />
                            </button>
                            <button
                                type="button"
                                onClick={handleTestNinerouter}
                                disabled={!ninerouterBaseURL.trim() || ninerouterTest.testing}
                                className="aip-btn"
                                data-variant="ghost"
                            >
                                <SwapLabel
                                    id={ninerouterTest.testing ? 'testing' : 'idle'}
                                    sizers={[t('Test Connection'), <span className="inline-flex items-center gap-1.5"><span className="w-3" />{t('Testing…')}</span>]}
                                >
                                    {ninerouterTest.testing
                                        ? <span className="inline-flex items-center gap-1.5"><Loader2 size={12} strokeWidth={1.75} className="aip-spinner" />{t('Testing…')}</span>
                                        : t('Test Connection')}
                                </SwapLabel>
                            </button>
                            <Presence kind="control" id={hasStoredKey.ninerouter ? 'remove' : null}>
                                <button
                                    type="button"
                                    onClick={handleRemoveNinerouter}
                                    className="aip-btn"
                                    data-variant="ghost"
                                >
                                    {t('Remove')}
                                </button>
                            </Presence>

                            {hasStoredKey.ninerouter && (
                                <AipModelList
                                    visionControl
                                    models={effectiveModels('ninerouter')}
                                    enabled={cloudEnabledModels['ninerouter'] || []}
                                    onToggle={(modelId) => handleToggleModel('ninerouter', modelId)}
                                    onReset={() => handleResetModels('ninerouter')}
                                    defaultId={preferredModels['ninerouter']}
                                    onSetDefault={(modelId) => handleSetDefaultModel('ninerouter', modelId)}
                                    // Opt-in: a stock instance already answers with 47 models
                                    // across 6 upstream aliases, and that is one user's
                                    // connected accounts, not the ceiling.
                                    optIn
                                    onBulkToggle={(ids, enable) => handleBulkToggleModels('ninerouter', ids, enable)}
                                    error={modelSaveError['ninerouter'] ? 'save-failed' : null}
                                    refreshing={isRefreshingNinerouter}
                                    onRefresh={handleRefreshNinerouterModels}
                                    onFirstOpen={() => {
                                        if (ninerouterModels.length === 0) handleRefreshNinerouterModels();
                                    }}
                                />
                            )}
                        </div>
                        {ninerouterTest.message && (
                            <p className={`text-[10px] ${ninerouterTest.ok ? 'aip-ok-fg' : 'aip-danger-fg'}`} role="status">
                                {ninerouterTest.message}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* Local (Ollama) Providers */}
            <div className="space-y-5">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-start gap-2.5 min-w-0">
                        <AipProviderMark provider="ollama" name="Ollama" className="mt-0.5" />
                        <div className="min-w-0">
                            <h3 className="text-sm font-bold aip-hero mb-1">{t('Local Models (Ollama)')}</h3>
                            <p className="text-xs aip-muted">{t('Run open-source models locally.')}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            onClick={async () => {
                                setIsRefreshingOllama(true);
                                await checkOllama(false);
                                // Add a small delay for visual feedback if the check is too fast
                                setTimeout(() => setIsRefreshingOllama(false), 500);
                            }}
                            className="aip-btn"
                            data-icon="true"
                            data-variant="ghost"
                            title={t("Refresh Ollama")}
                            disabled={isRefreshingOllama}
                        >
                            <RefreshCw size={16} strokeWidth={1.75} className={isRefreshingOllama ? "aip-spinner" : ""} />
                        </button>
                        <AipSwitch
                            checked={!disabledProviders.includes('ollama')}
                            onChange={() => handleToggleProvider('ollama', disabledProviders.includes('ollama'))}
                            label={`${disabledProviders.includes('ollama') ? t('Enable') : t('Disable')} Ollama`}
                            title={disabledProviders.includes('ollama') ? t('Enable provider') : t('Disable provider')}
                        />
                    </div>
                </div>

                {/* NOTE: nothing in this block may carry an entrance animation.
                    checkOllama() polls every 3s, so anything keyed on
                    ollamaStatus would re-fire forever and a transient blip
                    would flash the block twice. */}
                <div className="aip-card p-5">
                    {ollamaStatus === 'checking' && (
                        <div className="flex items-center gap-2 text-xs aip-muted">
                            <AipBadge tone="info" label={t('Checking')} busy />
                            {t('Checking for Ollama...')}
                        </div>
                    )}

                    {ollamaStatus === 'fixing' && (
                        <div className="flex items-center gap-2 text-xs aip-muted">
                            <AipBadge tone="info" label={t('Fixing')} busy />
                            {t('Attempting to auto-fix connection...')}
                        </div>
                    )}

                    {ollamaStatus === 'not-found' && (
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                                <AipBadge tone="danger" label={t('Not found')} />
                                <span className="text-xs aip-danger-fg">{t('Ollama not detected')}</span>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                                {/* Kept as one translated key — it exists in all four
                                    generated dictionaries. Splitting it out to wrap
                                    `ollama serve` in .aip-code-inline is Stage 5's job
                                    and needs the dictionaries regenerated. */}
                                <p className="text-xs aip-muted">
                                    {t('Ensure Ollama is running (`ollama serve`).')}
                                </p>
                                <button
                                    onClick={handleFixOllama}
                                    className="aip-btn"
                                    data-size="sm"
                                >
                                    {t('Auto-Fix Connection')}
                                </button>
                            </div>
                        </div>
                    )}

                    {ollamaStatus === 'detected' && ollamaModels.length > 0 && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 mb-3">
                                <AipBadge tone="ok" label={t('Running')} />
                                <span className="text-xs aip-muted">{t('Ollama connected')}</span>
                            </div>

                            <div className="grid grid-cols-1 gap-2">
                                {ollamaModels.map((model, i) => {
                                    const pickerId = `ollama-${model}`;
                                    const visionState = ollamaVision.states[pickerId];
                                    const panelId = `aip-ollama-vision-${i}`;
                                    return (
                                        <div key={model} className="aip-well p-2">
                                            <div className="flex items-center gap-2">
                                                <span className="aip-mono truncate flex-1 min-w-0">{model}</span>
                                                {visionState && (
                                                    <AipVisionButton
                                                        state={visionState}
                                                        open={ollamaVisionOpen === model}
                                                        controls={panelId}
                                                        onClick={() => setOllamaVisionOpen(cur => cur === model ? null : model)}
                                                    />
                                                )}
                                                <AipBadge tone="neutral" label={t('Local')} />
                                            </div>
                                            {visionState && (
                                                <AipVisionDetail
                                                    id={panelId}
                                                    state={visionState}
                                                    open={ollamaVisionOpen === model}
                                                    onSet={(setting) => { void ollamaVision.set(pickerId, setting); }}
                                                    onRetest={() => { void ollamaVision.retest(pickerId); }}
                                                />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    {ollamaStatus === 'detected' && ollamaModels.length === 0 && (
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                                <AipBadge tone="ok" label={t('Running')} />
                                <span className="text-xs aip-muted">{t('Ollama connected')}</span>
                            </div>
                            {/* "no models found" was true of the old raw list and
                                is not true now: this list is generation-capable
                                models, and a fresh install can hold exactly the
                                nomic-embed-text Natively pulled for retrieval.
                                Telling that user nothing is installed sends them
                                to fix something that is not broken. */}
                            <div className="text-xs aip-muted">
                                {t('No model here can generate text yet. Embedding models, such as the one Natively uses for retrieval, cannot chat. Run `ollama pull qwen2.5:3b` to add one.')}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Custom Providers */}
            <div className="space-y-5">
                <div className="flex items-center justify-between mb-2">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-sm font-bold aip-hero">{t('Custom Providers')}</h3>
                            <AipBadge tone="warn" label={t('Experimental')} />
                        </div>
                        <p className="text-xs aip-muted">{t('Add your own AI endpoints via cURL.')}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {!isEditingCustom && (
                            <button
                                onClick={handleNewProvider}
                                className="aip-btn"
                            >
                                <Plus size={14} strokeWidth={1.75} /> {t('Add Provider')}
                            </button>
                        )}
                        {customProviders.length > 0 && (
                            <AipSwitch
                                checked={!disabledProviders.includes('custom')}
                                onChange={() => handleToggleProvider('custom', disabledProviders.includes('custom'))}
                                label={`${disabledProviders.includes('custom') ? t('Enable') : t('Disable')} custom providers`}
                                title={disabledProviders.includes('custom') ? t('Enable custom providers') : t('Disable custom providers (keeps them saved)')}
                            />
                        )}
                    </div>
                </div>

                {isEditingCustom ? (
                    <div className="aip-card p-5 aip-panel-fade">
                        <h4 className="text-sm font-bold aip-hero mb-4">{editingProvider ? t('Edit Provider') : t('New Provider')}</h4>

                        <div className="space-y-4">
                            <div>
                                <label className="block aip-label mb-1">{t('Provider Name')}</label>
                                <input
                                    type="text"
                                    value={customName}
                                    onChange={(e) => setCustomName(e.target.value)}
                                    placeholder={t("My Custom LLM")}
                                    className="aip-input"
                                />
                            </div>

                            <div>
                                <label className="block aip-label mb-1">{t('cURL Command')}</label>
                                <div className="relative">
                                    <textarea
                                        value={customCurl}
                                        onChange={(e) => setCustomCurl(e.target.value)}
                                        placeholder={`curl https://api.openai.com/v1/chat/completions ... "content": "{{TEXT}}"`}
                                        data-mono="true"
                                        rows={7}
                                        className="aip-input"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block aip-label mb-1">
                                    {t('Response JSON Path')} <span className="aip-faint normal-case font-normal">{t('(Optional)')}</span>
                                </label>
                                <input
                                    type="text"
                                    value={customResponsePath}
                                    onChange={(e) => setCustomResponsePath(e.target.value)}
                                    placeholder={t("e.g. choices[0].message.content")}
                                    data-mono="true"
                                    className="aip-input"
                                />
                                <p className="text-[10px] aip-muted mt-1">
                                    {t('Dot notation path to the answer text in the JSON response. If empty, the full JSON is returned.')}
                                </p>
                            </div>

                            <div>
                                <label className="block aip-label mb-1">
                                    {t('Screenshot / Vision Support')}
                                </label>
                                {/* AipSelect, never a native <select>: a native popup
                                    is its own OS window outside content protection, so
                                    its options showed up in screen shares while
                                    Undetectable was on. */}
                                <AipSelect
                                    value={customVision}
                                    onChange={(v) => setCustomVision(v as 'auto' | 'on' | 'off')}
                                    label={t('Screenshot / Vision Support')}
                                    options={[
                                        { id: 'auto', name: t('Auto-detect (recommended)') },
                                        { id: 'on', name: t('Always send screenshots') },
                                        { id: 'off', name: t('Never send screenshots (text only)') },
                                    ]}
                                />
                                <p className="text-[10px] aip-muted mt-1">
                                    {t('Auto-detect enables vision when your cURL uses')} <code className="aip-code-inline">{"{{IMAGE_BASE64}}"}</code> {t('or an OpenAI-style')} <code className="aip-code-inline">messages</code> {t('body. Choose “Always” only if your endpoint accepts images another way; “Never” keeps this provider out of screenshot analysis.')}
                                </p>
                            </div>

                            <div className="aip-well mt-4">
                                <div className="px-4 py-3 flex items-center justify-between border-b" style={{ borderColor: 'var(--aip-divider)' }}>
                                    <h5 className="block aip-label">
                                        {t('Configuration Guide')}
                                    </h5>
                                </div>

                                <div className="p-4 space-y-4 min-w-0">
                                    <div>
                                        <p className="text-xs aip-muted mb-2 font-medium">{t('Available Variables')}</p>
                                        <div className="grid grid-cols-1 gap-2">
                                            <div className="flex items-center gap-2 text-xs">
                                                <code className="aip-code-inline shrink-0">{"{{TEXT}}"}</code>
                                                <span className="aip-muted">{t('Combined System + Context + Message (Recommended)')}</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs">
                                                <code className="aip-code-inline shrink-0">{"{{IMAGE_BASE64}}"}</code>
                                                <span className="aip-muted">{t('Screenshot data (if available)')}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="min-w-0">
                                        <p className="text-xs aip-muted mb-2 font-medium">{t('Examples')}</p>
                                        <div className="space-y-3 min-w-0">
                                            {/* Ollama Example */}
                                            <div className="min-w-0">
                                                <div className="aip-label mb-1.5">{t('Local (Ollama)')}</div>
                                                <div className="aip-well aip-scroll-x p-2.5 min-w-0">
                                                    <code className="aip-mono whitespace-pre block">
                                                        curl http://localhost:11434/api/generate -d '{"{"}"model": "llama3", "prompt": "{`{{TEXT}}`}"{"}"}'
                                                    </code>
                                                </div>
                                            </div>

                                            {/* OpenAI Example */}
                                            <div className="min-w-0">
                                                <div className="aip-label mb-1.5">{t('OpenAI Compatible')}</div>
                                                <div className="aip-well aip-scroll-x p-2.5 min-w-0">
                                                    <code className="aip-mono whitespace-pre block">
                                                        {`curl https://api.openai.com/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "{{TEXT}}"}
    ],
    "temperature": 0.7
  }'`}
                                                    </code>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {curlError && (
                                <div
                                    className="flex items-start gap-2 p-3 rounded-lg text-xs aip-danger-fg"
                                    style={{ background: 'var(--aip-danger-bg)', border: '1px solid var(--aip-danger-border)' }}
                                >
                                    <AlertCircle size={14} strokeWidth={1.75} className="shrink-0 mt-0.5" />
                                    <span>{curlError}</span>
                                </div>
                            )}

                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    onClick={() => setIsEditingCustom(false)}
                                    className="aip-btn"
                                    data-variant="ghost"
                                >
                                    {t('Cancel')}
                                </button>
                                <button
                                    onClick={handleSaveCustom}
                                    className="aip-btn"
                                    data-variant="accent"
                                >
                                    <Save size={14} strokeWidth={1.75} /> {t('Save Provider')}
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {customProviders.length === 0 ? (
                            <div className="aip-card aip-card-dashed text-center py-8">
                                <p className="text-xs aip-muted">{t('No custom providers added yet.')}</p>
                            </div>
                        ) : (
                            customProviders.map((provider) => (
                                <div key={provider.id} className="aip-card aip-row p-4 flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                        {/* Custom providers reuse the monogram tile with the
                                            panel accent as their brand hue. */}
                                        <AipMonogram mono={provider.name} />
                                        <div className="min-w-0">
                                            <h4 className="aip-card-title truncate">{provider.name}</h4>
                                            <p className="aip-mono aip-muted truncate max-w-[240px]">
                                                {provider.curlCommand.substring(0, 30)}...
                                            </p>
                                            {provider.responsePath && (
                                                <p className="aip-meta truncate mt-0.5">
                                                    {t('path:')} {provider.responsePath}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    {/* Was opacity-0 group-hover:opacity-100 — invisible to
                                        keyboard and touch. 0.5 → 1 on hover OR focus-within. */}
                                    <div className="aip-row-actions flex items-center gap-1 shrink-0">
                                        <button
                                            onClick={() => handleEditProvider(provider)}
                                            className="aip-btn"
                                            data-icon="true"
                                            data-variant="ghost"
                                            title={t("Edit")}
                                        >
                                            <Edit2 size={14} strokeWidth={1.75} />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteCustom(provider.id)}
                                            className="aip-btn"
                                            data-icon="true"
                                            data-variant="danger-ghost"
                                            title={t("Delete")}
                                        >
                                            <Trash2 size={14} strokeWidth={1.75} />
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>

            </div>
            )}

            {activeTab === 'vision' && (
            <div
                id={tabPanelId('vision')}
                role="tabpanel"
                aria-labelledby={tabButtonId('vision')}
                tabIndex={0}
                className="space-y-5 aip-panel-fade"
                data-stagger-skip
            >
            {/* Screenshots — the privacy-relevant half of screenUnderstandingMode.
                Was three radios (Vision first / Vision only / Private vision) whose
                copy could only describe itself as "Recommended" vs "Stricter" — a
                fallback-strategy distinction the user has no way to reason about.
                Now two switches over the same enum; see applyVisionMode(). */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-sm font-bold aip-hero mb-1">{t('Screenshots')}</h3>
                    <p className="text-xs aip-muted mb-2">{t('Controls where screenshots of your screen are processed.')}</p>
                </div>
                <div className="aip-card p-5 flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex flex-col min-w-0">
                            <span className="text-xs aip-hero font-semibold">{t('Keep screenshots on this device')}</span>
                            <span className="aip-meta leading-snug mt-0.5">
                                {t('Use a local vision model (Ollama) only. Cloud vision is never called.')}
                            </span>
                        </div>
                        <AipSwitch
                            checked={visionLocalOnly}
                            label={t('Keep screenshots on this device')}
                            onChange={(next) => applyVisionMode(next, visionRequired)}
                        />
                    </div>

                    {visionLocalOnly && !localFallbackAvailable && (
                        <div className="aip-inline-warn flex items-start gap-2">
                            <AlertCircle size={12} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden="true" />
                            <span>{t('No local vision model is installed. Screenshot questions will be refused rather than sent to the cloud. Install a vision-capable model under Local & Gateways.')}</span>
                        </div>
                    )}

                    <div className="flex items-center justify-between gap-3 pt-3 border-t" style={{ borderColor: 'var(--aip-divider)' }}>
                        <div className="flex flex-col min-w-0">
                            <span className={`text-xs font-semibold ${visionLocalOnly ? 'aip-faint' : 'aip-hero'}`}>
                                {t('Require a vision-capable provider')}
                            </span>
                            <span className="aip-meta leading-snug mt-0.5">
                                {visionLocalOnly
                                    ? t('Always on while screenshots stay on this device.')
                                    : t('Fail with a clear error instead of quietly answering without the screenshot.')}
                            </span>
                        </div>
                        <AipSwitch
                            checked={visionRequired}
                            disabled={visionLocalOnly}
                            label={t('Require a vision-capable provider')}
                            onChange={(next) => applyVisionMode(visionLocalOnly, next)}
                        />
                    </div>


                    {/* Capture quality, not privacy — but it is about screenshots, and
                        this is the screenshots card, so it groups by subject rather than
                        by which engine owns it. */}
                    <div className="flex items-center justify-between gap-3 pt-3 border-t" style={{ borderColor: 'var(--aip-divider)' }}>
                        <div className="flex flex-col min-w-0">
                            <span className="text-xs aip-hero font-semibold">{t('High-resolution capture for code')}</span>
                            {/* Scope qualifier restored. This writes
                                `technicalInterviewVisionFirst`, whose only consumer is
                                ScreenUnderstandingService.pickOptimizationProfile, and only
                                when the active mode is a technical template. Copy that
                                promised it for screenshots generally described a setting
                                that does nothing on the hotkey/attachment capture path. */}
                            <span className="aip-meta leading-snug mt-0.5">{t('In technical interview and coding modes, captures at the highest-resolution profile so small code text stays legible. Costs more tokens per screenshot.')}</span>
                        </div>
                        <AipSwitch
                            checked={technicalInterviewVisionFirst}
                            label={t('High-resolution capture for code')}
                            onChange={(next) => {
                                setTechnicalInterviewVisionFirst(next);
                                const api: any = window.electronAPI;
                                if (api?.setTechnicalInterviewVisionFirst) {
                                    api.setTechnicalInterviewVisionFirst(next);
                                } else {
                                    window.electronAPI?.setTechnicalInterviewDirectVision?.(next);
                                }
                            }}
                        />
                    </div>

                    {/* The two cards answer overlapping questions and previously never
                        referenced each other, leaving the user to reconcile them.

                        The note used to assert "behaves as on-device only" with no
                        local-model term at all. With the scope off and nothing local
                        installed the screenshot is DROPPED and the question answered
                        without it — the opposite of on-device processing, and the same
                        card's own "Omitted" badge already said so. Each branch below
                        states what actually happens, mirroring visionPolicy.ts. */}
                    {!visionLocalOnly && providerDataScopes.screenshots === false && (
                        <div className="flex items-start gap-2 pt-3 border-t" style={{ borderColor: 'var(--aip-divider)' }}>
                            <Info size={12} strokeWidth={1.75} className="aip-faint shrink-0 mt-0.5" aria-hidden="true" />
                            <p className="aip-meta leading-relaxed">
                                {localFallbackAvailable
                                    ? t('Screenshots are already blocked from cloud providers by the data scope below, so your local vision model handles them.')
                                    : visionRequired
                                        ? t('Screenshots are blocked from cloud providers by the data scope below, and no local vision model is installed. Screenshot questions will be refused rather than answered without the image.')
                                        : t('Screenshots are blocked from cloud providers by the data scope below, and no local vision model is installed — so the screenshot is discarded and the question is answered without it.')}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Cloud Provider Data Scopes — fail-closed cloud share controls.
                Was six equal-weight rows of bare nouns, each growing a WRAPPED second
                line when switched off, plus a permanent footnote restating what those
                lines already said. The card got taller and noisier the more you locked
                down, which is backwards. Now: one icon per row so the list is scanned
                by shape rather than by reading six similar words, a one-word pill
                instead of a sentence, a count so the overall state is legible without
                reading any row, and the footnote only when it carries new information. */}
            <div className="space-y-5">
                <div className="flex items-end justify-between gap-3">
                    <div className="min-w-0">
                        <h3 className="text-sm font-bold aip-hero mb-1">{t('Cloud provider data scopes')}</h3>
                        <p className="text-xs aip-muted">{t('What cloud AI providers are allowed to receive.')}</p>
                    </div>
                    <span className="aip-meta tabular-nums shrink-0 pb-0.5">
                        {/* The count swaps with the switch that changed it. */}
                        <SettingsMotionReady.Provider value={motionReady && scopesMotionReady}>
                            <Presence kind="text" id={String(SCOPE_ROWS.length - disabledScopeCount)}>
                                {SCOPE_ROWS.length - disabledScopeCount}
                            </Presence>
                        </SettingsMotionReady.Provider>
                        /{SCOPE_ROWS.length} {t('shared')}
                    </span>
                </div>
                <SettingsMotionReady.Provider value={motionReady && scopesMotionReady}>
                <div className="aip-card p-4 flex flex-col gap-2">
                    {SCOPE_ROWS.map(({ key, labelKey, Icon }) => {
                        const allowed = providerDataScopes[key] !== false;
                        const label = t(labelKey);
                        return (
                            <div
                                key={key}
                                className="flex items-center gap-3"
                            >
                                <Icon size={13} strokeWidth={1.75} className={`transition-colors duration-150 ease-out ${allowed ? 'aip-faint shrink-0' : 'aip-warn-fg shrink-0'}`} aria-hidden="true" />
                                <span className="text-xs aip-hero min-w-0 truncate">{label}</span>
                                {/* A disabled scope is not inert: LLMHelper reroutes it to a local
                                    model, or DROPS it when none exists. One word each, so the row
                                    never wraps and the card never grows.

                                    Per-row predicate: the gate passes needsVision=true only for
                                    screenshots, so a text-only Ollama install is a real fallback
                                    for Transcripts but NOT for Screenshots. One shared boolean
                                    got one of those two rows wrong whichever value it took.

                                    Transcripts is special-cased again below: denying it does not
                                    merely trim context, it fails the whole request. */}
                                {/* A status tag: transitions.dev "notification badge" (Presence
                                    badge), a bouncy pop in and a quiet exit, keyed on what it
                                    says so On-device -> Omitted re-pops. */}
                                {(() => {
                                    const rowLocal = localFallbackFor(key);
                                    const isKillSwitch = key === 'transcript' && !rowLocal;
                                    const badgeId = allowed ? null : rowLocal ? 'local' : isKillSwitch ? 'kill' : 'omitted';
                                    return (
                                    <Presence kind="badge" id={badgeId} className="shrink-0">
                                    <span
                                        className="aip-badge shrink-0"
                                        data-tone={rowLocal ? 'neutral' : 'warn'}
                                        title={rowLocal
                                            ? t('Handled on-device by your local model.')
                                            : isKillSwitch
                                                ? t('Cloud requests are refused entirely — there is no local model to fall back to.')
                                                : t('Omitted from context — no local model to fall back to.')}
                                    >
                                        {rowLocal ? <Laptop size={9} strokeWidth={2} aria-hidden="true" /> : null}
                                        <span className="aip-badge-label">{rowLocal ? t('On-device') : isKillSwitch ? t('Blocks cloud') : t('Omitted')}</span>
                                    </span>
                                    </Presence>
                                    );
                                })()}
                                <div className="ml-auto shrink-0">
                                    <AipSwitch
                                        checked={allowed}
                                        label={`${t('Allow')} ${label} ${t('to cloud providers')}`}
                                        onChange={() => {
                                            const next = { ...providerDataScopes, [key]: !allowed };
                                            setProviderDataScopes(next);
                                            window.electronAPI?.setProviderDataScopes?.(next);
                                        }}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>
                </SettingsMotionReady.Provider>
                {/* Only when it says something the pills do not. The old version showed a
                    permanent restatement of the per-row text. Each arrives with the
                    panel's own fade-up (.aip-panel-fade) rather than landing. */}
                {providerDataScopes.transcript === false && !localFallbackFor('transcript') && (
                    <div className="aip-inline-warn aip-panel-fade flex items-start gap-2" role="status">
                        <AlertCircle size={12} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden="true" />
                        {/* Transcripts is not a context trim. Every request carries a
                            transcript scope at the provider boundary, so denying it with
                            no local fallback makes the whole cascade refuse and the user
                            sees "All AI providers failed" with no stated cause. Said
                            plainly here because nothing else in the UI says it. */}
                        <span>{t('With Transcripts off and no local model selected, cloud requests are refused entirely — answers will fail rather than run without the transcript. Select Ollama under Local & Gateways to keep answering on-device.')}</span>
                    </div>
                )}
                {disabledScopeCount > 0 && !localFallbackFor('reference_files') && providerDataScopes.transcript !== false && (
                    <div className="aip-inline-warn aip-panel-fade flex items-start gap-2" role="status">
                        <AlertCircle size={12} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden="true" />
                        <span>{t('Disabled types are dropped from context, not handled on-device — select a local model under Local & Gateways to keep them.')}</span>
                    </div>
                )}
            </div>
            </div>
            )}

            {/* LAST child on purpose: as the first child of a `space-y-5` stack it
                would satisfy `> :not([hidden]) ~ :not([hidden])` and push 20px of
                margin onto <header>. */}
            <style>{AIP_CSS}</style>
        </div>
        </SettingsMotionReady.Provider>
    );
};
