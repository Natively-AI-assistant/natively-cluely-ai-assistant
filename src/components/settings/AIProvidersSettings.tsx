import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useT } from '../../i18n';
import { Plus, Trash2, Edit2, AlertCircle, Save, ChevronDown, Check, RefreshCw, ExternalLink, Loader2, LogOut, Cloud, Server, Eye, Info, MessageSquare, Image, FileText, User, Boxes, ClipboardList, Laptop } from 'lucide-react';
import { CODEX_CLI_MODEL, CODEX_CLI_MODEL_PRESETS, codexCliSelectorId, STANDARD_CLOUD_MODELS, prettifyModelId } from '../../utils/modelUtils';
import { validateCurl } from '../../lib/curl-validator';
import { ProviderCard } from './ProviderCard';
import { ConfirmDialog } from '../ui/ConfirmDialog';

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
import geminiMark from '../../assets/provider-logos/gemini.svg?raw';
import claudeMark from '../../assets/provider-logos/claude.svg?raw';
import deepseekMark from '../../assets/provider-logos/deepseek.svg?raw';
import groqMark from '../../assets/provider-logos/groq.svg?raw';
import openaiMark from '../../assets/provider-logos/openai.svg?raw';
import ollamaMark from '../../assets/provider-logos/ollama.svg?raw';
// LiteLLM ships its mark only as a raster favicon (160x160 PNG), so this one is a
// URL rather than inlined markup. No currentColor to resolve in a PNG, so <img>
// loses nothing here. Vendored from BerriAI/litellm — MIT, and outside the
// `enterprise/` directory that their LICENSE carves out.
import litellmMark from '../../assets/provider-logos/litellm.png';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';

/* ═══════════════════════════════════════════════════════════════════════════
   AI Providers design system — a locally-scoped token block, PI-style.

   WHY NOT THE TAILWIND SEMANTIC TOKENS: this panel's card grammar needs a
   translucent compositing hairline. In dark mode `--border-subtle` is literally
   `transparent` (src/index.css:84) and the only visible border token is
   `--border-muted` (#333, opaque, far heavier than a hairline). So every card
   here rendered as a fill-only slab with no edge, and nested `bg-bg-input`
   surfaces were DARKER than their parent — the stack read inverted. No Tailwind
   token pair produces the look, hence `--aip-*`.

   `--border-subtle` is NOT changed globally: dozens of other components were
   built against a transparent value.

   The accent is ALIASED, not re-declared per theme: this panel renders inside
   `[data-settings-theme="orchid"]` (SettingsOverlay.tsx) where
   `--accent-primary` already resolves to orchid-300 dark / orchid-600 light.
   `--text-danger` is reused for the same reason (it is already theme-split
   because one red cannot clear 4.5:1 on both fills).

   Tailwind is still used for LAYOUT only inside `.aip-root`. Colour comes from
   `var(--aip-*)`.

   Motion is CSS-only — deliberately no framer-motion in this file. Animations
   stay off the main thread, which matters because this renderer also hosts the
   always-on-top overlay and a 3s Ollama poll.
   ═══════════════════════════════════════════════════════════════════════════ */
const AIP_CSS = `
.aip-root {
    --aip-accent:            var(--accent-primary);
    --aip-on-accent:         var(--on-accent);
    --aip-accent-subtle:     color-mix(in srgb, var(--aip-accent) 8%,  transparent);
    --aip-accent-muted:      color-mix(in srgb, var(--aip-accent) 14%, transparent);
    --aip-accent-border:     color-mix(in srgb, var(--aip-accent) 22%, transparent);
    --aip-accent-ring:       color-mix(in srgb, var(--aip-accent) 12%, transparent);

    --aip-hero:      #ffffff;
    --aip-primary:   rgba(255,255,255,0.86);
    --aip-secondary: rgba(255,255,255,0.56);
    --aip-tertiary:  rgba(255,255,255,0.34);

    --aip-border:        rgba(255,255,255,0.07);
    --aip-border-strong: rgba(255,255,255,0.12);
    --aip-divider:       rgba(255,255,255,0.05);

    --aip-card-bg:       rgba(255,255,255,0.015);
    --aip-card-bg-hover: rgba(255,255,255,0.028);
    --aip-card-lift:     inset 0 1px 0 rgba(255,255,255,0.04);
    --aip-card-shadow:   none;
    --aip-well-bg:       rgba(255,255,255,0.03);
    --aip-code-bg:       rgba(255,255,255,0.04);

    --aip-btn-bg:             rgba(255,255,255,0.06);
    --aip-btn-bg-hover:       rgba(255,255,255,0.10);
    --aip-btn-border:         rgba(255,255,255,0.10);
    --aip-item-hover:         rgba(255,255,255,0.04);
    --aip-item-active:        rgba(255,255,255,0.10);
    --aip-input-bg:           transparent;
    --aip-input-border:       rgba(255,255,255,0.10);
    --aip-input-bg-focus:     color-mix(in srgb, var(--aip-accent) 4%, transparent);
    --aip-input-border-focus: color-mix(in srgb, var(--aip-accent) 40%, transparent);
    --aip-switch-off:         rgba(255,255,255,0.14);
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

    --aip-r-xs: 4px;  --aip-r-sm: 6px;  --aip-r-md: 10px;
    --aip-r-lg: 12px; --aip-r-xl: 16px; --aip-r-pill: 9999px;

    --aip-ease-out:    cubic-bezier(0.23, 1, 0.32, 1);
    --aip-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

    --aip-dur-press:  110ms;
    --aip-dur-state:  160ms;
    --aip-dur-travel: 220ms;

    --aip-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.aip-root[data-theme='light'] {
    --aip-hero:      #111827;
    --aip-primary:   #374151;
    --aip-secondary: #6b7280;
    --aip-tertiary:  #8e8e93;

    --aip-border:        rgba(0,0,0,0.08);
    --aip-border-strong: rgba(0,0,0,0.13);
    --aip-divider:       rgba(0,0,0,0.06);

    --aip-card-bg:       #ffffff;
    --aip-card-bg-hover: #ffffff;
    --aip-card-lift:     none;
    --aip-card-shadow:   0 1px 1px rgba(0,0,0,0.03);
    --aip-well-bg:       #f7f8fa;
    --aip-code-bg:       #f3f4f6;

    --aip-btn-bg:       rgba(0,0,0,0.04);
    --aip-btn-bg-hover: rgba(0,0,0,0.075);
    --aip-btn-border:   rgba(0,0,0,0.08);
    --aip-item-hover:   rgba(0,0,0,0.03);
    --aip-item-active:  rgba(0,0,0,0.06);
    --aip-input-border: rgba(0,0,0,0.11);
    --aip-switch-off:   rgba(0,0,0,0.16);
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
    --aip-warn:          #a16207;
    --aip-warn-bg:       rgba(250,204,21,0.14);
    --aip-warn-border:   rgba(161,98,7,0.20);
    --aip-danger-bg:     rgba(239,68,68,0.08);
    --aip-danger-border: rgba(185,28,28,0.20);
}

/* ── Motion. Two easings: ease-out for everything, spring ONLY for the switch
      thumb. Three durations: press 110 / state 160 / travel 220. ────────── */
@keyframes aip-fade-up  { from { opacity:0; transform:translateY(3px); } to { opacity:1; transform:none; } }
@keyframes aip-spin     { to { transform:rotate(360deg); } }
@keyframes aip-check-in { from { opacity:0; transform:scale(0.6); } to { opacity:1; transform:scale(1); } }
@keyframes aip-shimmer  { 0%,100% { opacity:0.55; } 50% { opacity:1; } }

.aip-panel-fade { animation: aip-fade-up var(--aip-dur-state) var(--aip-ease-out) both; }
.aip-spinner    { animation: aip-spin 0.65s linear infinite; }
.aip-check      { animation: aip-check-in 200ms var(--aip-ease-spring) both; }
.aip-skeleton   { background: var(--aip-btn-bg); border-radius: var(--aip-r-sm);
                  animation: aip-shimmer 1.4s ease-in-out infinite; }

/* ── Surfaces. Definition comes from the EDGE; elevation from translucency
      compositing against the backdrop. ─────────────────────────────────── */
.aip-card {
    border: 1px solid var(--aip-border);
    border-radius: var(--aip-r-lg);
    background: var(--aip-card-bg);
    box-shadow: var(--aip-card-lift), var(--aip-card-shadow);
    transition: border-color var(--aip-dur-travel) var(--aip-ease-out),
                background   var(--aip-dur-travel) var(--aip-ease-out);
}
.aip-card + .aip-card { margin-top: 10px; }
/* .aip-card's "border" SHORTHAND also sets border-style, and this sheet loads
   after Tailwind's, so a Tailwind "border-dashed" on the same element would be
   overridden back to solid. Hence an explicit modifier. */
.aip-card-dashed { border-style: dashed; }

.aip-well { background: var(--aip-well-bg); border: 1px solid var(--aip-border);
            border-radius: var(--aip-r-md); overflow: hidden; }
/* Declared AFTER .aip-well on purpose. This stylesheet is injected into the
   body, i.e. later in document order than Tailwind's, so at equal specificity
   .aip-well's "overflow: hidden" shorthand would otherwise beat a Tailwind
   "overflow-y-auto" on the same element and kill the scroll. */
.aip-scroll-y { overflow-y: auto; overflow-x: hidden; }
.aip-scroll-x { overflow-x: auto; overflow-y: hidden; }
.aip-div  { height:1px; background: var(--aip-divider); border:0; margin:0; }

/* A floating menu needs an OPAQUE surface — --aip-well-bg is translucent by
   design, so content underneath would bleed through the list. The spec has no
   float token because its answer is "no floating layers, use .aip-select".
   The two menus still floating here (Active Model, AI Response Language) are
   pre-existing and out of scope for stages 0-2, so they borrow --bg-elevated,
   which is theme-split for exactly this purpose ("Modal outer frame &
   dropdowns", src/index.css:210). */
.aip-float { background: var(--bg-elevated); border: 1px solid var(--aip-border-strong);
             border-radius: var(--aip-r-md); box-shadow: 0 10px 28px rgba(0,0,0,0.30); }

/* Focus. NOTE: the spec's version also set border-radius here; dropped, because
   at specificity 0,2,0 it outranks Tailwind's .rounded-* (0,1,0) and every
   focused control visibly snapped its corners. Chromium's outline already
   follows the element's own border-radius, so it bought nothing. */
.aip-root :focus-visible { outline: 2px solid var(--aip-accent); outline-offset: 2px; }
.aip-root :focus:not(:focus-visible) { outline: none; }

.aip-press, .aip-btn, .aip-chip, .aip-tab {
    transition: background var(--aip-dur-state) var(--aip-ease-out),
                color var(--aip-dur-state) ease,
                border-color var(--aip-dur-state) ease,
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
.aip-inline-note {
    padding:8px 10px; border-radius: var(--aip-r-md);
    background: var(--aip-well-bg); border:1px solid var(--aip-border);
    color: var(--aip-secondary); font-size:11px; line-height:1.45;
}

/* ── Switch. 34x20 track / 14px thumb / 14px travel (border-box: 34 - 2px
      border - 4px padding - 14px thumb = 14). The thumb is the ONE control
      with a physical metaphor, so it gets travel + spring. ─────────────── */
.aip-switch {
    position:relative; box-sizing:border-box; width:34px; height:20px; flex-shrink:0;
    padding:2px; border-radius:9999px; border:1px solid transparent;
    background: var(--aip-switch-off);
    display:inline-flex; align-items:center; cursor:pointer;
    transition: background var(--aip-dur-state) var(--aip-ease-out),
                border-color var(--aip-dur-state) var(--aip-ease-out);
}
.aip-switch[aria-checked='true'] { background: var(--aip-accent); }
.aip-switch[aria-disabled='true'] { cursor:not-allowed; }
.aip-switch:disabled { cursor:not-allowed; opacity:0.5; }
.aip-switch-thumb {
    width:14px; height:14px; border-radius:9999px; background:#fff;
    box-shadow: 0 1px 2px rgba(0,0,0,0.28);
    transform: translateX(0);
    transition: transform var(--aip-dur-travel) var(--aip-ease-spring),
                background var(--aip-dur-state) var(--aip-ease-out);
}
/* --aip-on-accent, not #fff: in dark mode the accent track is orchid-300
   (#D9A7E8, a LIGHT lilac) so a white thumb sat at ~1.35:1. --on-accent is
   theme-split precisely for solid orchid fills (#1A1020 dark / #fff light). */
.aip-switch[aria-checked='true'] .aip-switch-thumb { transform: translateX(14px); background: var(--aip-on-accent); }

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

/* ── Chips: DUAL encoding — dashed border off / solid + tinted on — so the
      state survives colour-blindness and greyscale. ───────────────────── */
/* ── Model allow-list. Summary row + in-flow disclosure; see AipModelList. ── */
.aip-models-summary {
    display:flex; align-items:center; gap:10px; width:100%;
    height:34px; padding:0 10px; border-radius: var(--aip-r-md);
    background: var(--aip-btn-bg); border:1px solid var(--aip-btn-border);
    color: var(--aip-primary); cursor:pointer; font-family:inherit; text-align:left;
}
.aip-models-summary:hover { background: var(--aip-btn-bg-hover); }
/* max-height, never height: at n=3 the well is short, at n=70 it scrolls. */
.aip-models-well { max-height:216px; padding:4px; }
.aip-model-row {
    display:flex; align-items:center; gap:8px; width:100%;
    min-height:34px; padding:0 8px; border-radius: var(--aip-r-sm);
    background:transparent; border:0; cursor:pointer; font-family:inherit;
    text-align:left; color: var(--aip-secondary);
    transition: background var(--aip-dur-state) var(--aip-ease-out),
                color var(--aip-dur-state) var(--aip-ease-out);
}
.aip-model-row:hover { background: var(--aip-item-hover); color: var(--aip-primary); }
.aip-model-row:active { transform: scale(0.975); }
.aip-model-row[aria-pressed='true'] { color: var(--aip-primary); }
.aip-model-row[aria-disabled='true'] { cursor:default; }
.aip-model-row[aria-disabled='true']:active { transform:none; }
/* Always rendered, never conditionally: a conditional check changes the row's
   intrinsic width and shifts the label as you toggle down a list. */
.aip-model-check {
    color: var(--aip-accent); flex-shrink:0; opacity:0; transform: scale(0.9);
    transition: opacity var(--aip-dur-state) var(--aip-ease-out),
                transform var(--aip-dur-state) var(--aip-ease-out);
}
.aip-model-row[aria-pressed='true'] .aip-model-check { opacity:1; transform: scale(1); }
.aip-model-name { font-size:12px; min-width:0; }
/* --aip-secondary, never --aip-tertiary: tertiary is 2.6:1 in dark and is
   reserved for decorative glyphs and disabled states. */
.aip-model-id { font-size:10.5px; color: var(--aip-secondary); margin-left:auto; flex-shrink:0; max-width:52%; }

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
.aip-reveal { display:grid; grid-template-rows:0fr;
              transition: grid-template-rows var(--aip-dur-travel) var(--aip-ease-out); }
.aip-reveal[data-open='true'] { grid-template-rows:1fr; }
.aip-reveal > div { overflow:hidden; min-height:0;
                    visibility:hidden; transition: visibility 0s linear 220ms; }
.aip-reveal[data-open='true'] > div { visibility:visible; transition-delay:0s; }

/* ── Monogram tile. Not a logo: no provider marks ship in this repo and
      lucide has none, so a two-letter mono monogram on a brand-tinted tile
      is both distinctive and trademark-safe. ──────────────────────────── */
/* Selectable option row (screen-understanding modes). The dot is the second
   and last consumer of --aip-ease-spring; everything else uses ease-out. */
.aip-option { border:1px solid var(--aip-border); background: var(--aip-well-bg);
              border-radius: var(--aip-r-md); cursor:pointer;
              transition: border-color var(--aip-dur-state) var(--aip-ease-out),
                          background var(--aip-dur-state) var(--aip-ease-out); }
.aip-option:hover { border-color: var(--aip-border-strong); }
.aip-option[aria-checked='true'] { border-color: var(--aip-accent-border); background: var(--aip-accent-subtle); }
.aip-option-dot { box-sizing:border-box; width:16px; height:16px; border-radius:9999px;
                  border:2px solid var(--aip-border-strong); flex-shrink:0;
                  transition: border-color var(--aip-dur-state) var(--aip-ease-out),
                              background var(--aip-dur-travel) var(--aip-ease-spring); }
.aip-option[aria-checked='true'] .aip-option-dot { border-color: var(--aip-accent); background: var(--aip-accent); }

/* Row actions: never opacity:0 — that hides them from keyboard and touch
   entirely. Half-visible at rest, full on hover OR focus-within. */
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
.aip-input:focus { background: var(--aip-input-bg-focus); border-color: var(--aip-input-border-focus); }
.aip-input[data-mono='true'] { font-family: var(--aip-mono); font-size:11.5px; }
textarea.aip-input { height:auto; padding:10px; line-height:1.5; resize:none; }
select.aip-input { cursor:pointer; }

/* ── In-flow select expander. Portals are banned in this file (the orchid
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
                border-color var(--aip-dur-state) var(--aip-ease-out);
}
.aip-select-trigger:hover { background: var(--aip-btn-bg-hover); }
.aip-select-trigger[aria-disabled='true'] { cursor:default; }
.aip-select-trigger[aria-disabled='true']:hover { background: var(--aip-btn-bg); }
.aip-select-chevron { color: var(--aip-secondary); flex-shrink:0;
                      transition: transform var(--aip-dur-state) var(--aip-ease-out); }
.aip-select-trigger[aria-expanded='true'] .aip-select-chevron { transform: rotate(180deg); }
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
.aip-select-empty { padding:6px 8px; font-size:12px; color: var(--aip-tertiary); }

/* ── Segmented control. Architecture kept as-is (one absolutely-positioned
      pill translated across the track, so only "transform" animates and the
      work stays on the compositor; the tabs never restyle their own
      background). The pill gets "state", not "travel" — it crosses ~200px so
      a long duration reads as lag. ─────────────────────────────────────── */
.aip-tablist { background: var(--aip-well-bg); border:1px solid var(--aip-border); }
.aip-tab-pill { background: var(--aip-pill-bg); border:1px solid var(--aip-pill-border);
                box-shadow: var(--aip-pill-lift), var(--aip-pill-shadow); }
.aip-tab { color: var(--aip-secondary); background:transparent; cursor:pointer; }
/* The tablist is overflow:hidden, which clips an outside focus ring. Must be
   specific enough to beat ".aip-root :focus-visible" (0,2,0) above. */
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
.aip-title     { font-size:15px; font-weight:600; letter-spacing:-0.012em; color: var(--aip-hero); }
.aip-subtitle  { font-size:12px; font-weight:400; color: var(--aip-secondary); }
.aip-eyebrow   { font-size:11px; font-weight:600; text-transform:uppercase;
                 letter-spacing:0.06em; color: var(--aip-secondary); }
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

@media (prefers-reduced-motion: reduce) {
    .aip-root *, .aip-root *::before, .aip-root *::after {
        animation-duration: 0.01ms !important;
        animation-delay: 0ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
    }
    /* Spinners are EXEMPT — freezing one mid-rotation is worse than motion.
       Rotation is replaced by a pulse rather than removed. */
    .aip-root .aip-spinner { animation: aip-shimmer 1.2s ease-in-out infinite !important; }
    .aip-root .aip-press:active,
    .aip-root .aip-btn:active,
    .aip-root .aip-chip:active,
    .aip-root .aip-tab:active { transform: none; }
    .aip-root .aip-skeleton { animation: none; opacity: 0.55; }
}
`;

/* ───────────────────────── Primitives ─────────────────────────────────────
   These live HERE, not in a new file: `SettingsOrchidPortalScopeGuard.test.mjs`
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
 * One implementation replacing all seven hand-rolled `role="switch"` divs.
 * A real <button role="switch" aria-checked> gets Space/Enter activation,
 * focus and disabled semantics for free — exactly what the divs lacked, which
 * made every toggle in this panel keyboard-unreachable.
 */
export const AipSwitch: React.FC<AipSwitchProps> = ({
    checked, onChange, label, title, disabled = false, hardDisabled = false, className = '',
}) => (
    <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-disabled={disabled || hardDisabled ? true : undefined}
        aria-label={label}
        title={title}
        disabled={hardDisabled}
        onClick={() => onChange(!checked)}
        className={`aip-switch ${className}`}
    >
        <span className="aip-switch-thumb" aria-hidden="true" />
    </button>
);

/** Per-provider brand hues for the monogram tile. */
export const AIP_PROVIDER_BRANDS: Record<string, { mono: string; brand: string }> = {
    gemini:   { mono: 'GE', brand: '#7C9CF5' },
    groq:     { mono: 'GQ', brand: '#F2755C' },
    openai:   { mono: 'OA', brand: '#10A37F' },
    claude:   { mono: 'CL', brand: '#D97757' },
    deepseek: { mono: 'DS', brand: '#4D6BFE' },
    codex:    { mono: 'CX', brand: '#10A37F' },
    litellm:  { mono: 'LL', brand: '#8B5CF6' },
    ollama:   { mono: 'OL', brand: '#9CA3AF' },
};

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
export const AIP_PROVIDER_LOGO_IMAGES: Record<string, string> = {
    litellm: litellmMark,
};

export const AIP_PROVIDER_LOGOS: Record<string, string> = {
    gemini: geminiMark,
    claude: claudeMark,
    anthropic: claudeMark,
    deepseek: deepseekMark,
    groq: groqMark,
    openai: openaiMark,
    codex: openaiMark,
    ollama: ollamaMark,
};

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
                <img src={imageSrc} alt="" width={16} height={16} className="object-contain" />
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


export interface AipModelEntry { id: string; label: string }

interface AipModelListProps {
    /** Presets ∪ persisted catalog. The full universe for this provider. */
    models: AipModelEntry[];
    /** Allow-list. EMPTY MEANS ALL — never "none"; there is no sentinel. */
    enabled: string[];
    onToggle: (modelId: string) => void;
    /** Clears the allow-list back to "all". */
    onReset: () => void;
    /** Shown in the collapsed summary so the resting state names the active model. */
    defaultLabel?: string;
    /** Ids present in `enabled` that the provider no longer offers. */
    staleIds?: string[];
    /** Set while a write is in flight so the header can report a failure. */
    error?: string | null;
}

/** Above this many models, a filter field and the Previews toggle appear. */
const AIP_MODEL_FILTER_THRESHOLD = 12;
/** Preview/experimental/date-stamped variants — matched on the ID, never the label. */
const AIP_PREVIEW_RE = /preview|exp(erimental)?\b|-latest$|-\d{4}-\d{2}-\d{2}$|-\d{2}-\d{2}$/i;

/**
 * The model allow-list: a summary row that discloses a vertical list.
 *
 * One control from n=2 to n=70. What changes with size is whether the well
 * scrolls and whether a filter appears — never what the control *is*.
 *
 * Deliberately NOT a modal or popover. Portals are forbidden in this file
 * (SettingsOrchidPortalScopeGuard) because the design tokens resolve by DOM
 * ancestry, and `overflow-y:auto` on the settings scroller computes `overflow-x`
 * to `auto`, making it a clip box on both axes — a floating layer on a lower card
 * opens into clipped space.
 *
 * Chips were the previous control. They work at n=3 and fail at n=70: a wrapped
 * wall, one tab stop per chip, and flex-wrap reflow that moves a click target
 * between aim and click.
 */
export const AipModelList: React.FC<AipModelListProps> = ({
    models, enabled, onToggle, onReset, defaultLabel, staleIds = [], error,
}) => {
    const t = useT();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [hidePreviews, setHidePreviews] = useState(models.length > AIP_MODEL_FILTER_THRESHOLD);
    const [activeIndex, setActiveIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);
    const summaryRef = useRef<HTMLButtonElement>(null);
    const idRef = useRef(`aip-models-${Math.random().toString(36).slice(2, 9)}`);
    const panelId = `${idRef.current}-panel`;

    const isOn = (id: string) => enabled.length === 0 || enabled.includes(id);
    const enabledCount = enabled.length === 0 ? models.length : enabled.length;

    // Threshold keys off the UNFILTERED count. Keying it off visible rows would make
    // the filter field appear and vanish as you toggle Previews — exactly the jank
    // the threshold exists to prevent.
    const showFilterBar = models.length > AIP_MODEL_FILTER_THRESHOLD;

    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        return models.filter(m => {
            // An allow-listed model is NEVER hidden by a view filter, or the visible
            // list would disagree with the count in the header.
            const listed = enabled.length > 0 && enabled.includes(m.id);
            if (hidePreviews && !listed && AIP_PREVIEW_RE.test(m.id)) return false;
            if (!q) return true;
            return m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q);
        });
    }, [models, query, hidePreviews, enabled]);

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
    const soleEnabled = enabled.length === 1 ? enabled[0] : null;

    return (
        <div className="mt-1 pt-3 border-t" style={{ borderColor: 'var(--aip-divider)' }}>
            <button
                ref={summaryRef}
                type="button"
                onClick={() => { setOpen(o => !o); if (open) setQuery(''); }}
                aria-expanded={open}
                aria-controls={panelId}
                className="aip-models-summary aip-press"
            >
                <span className="aip-label shrink-0">{t('Models')}</span>
                <span className="aip-meta truncate min-w-0 flex-1 text-right">
                    {defaultLabel ? `${defaultLabel} · ${t('default')}` : ''}
                </span>
                {error
                    ? <AipBadge tone="danger" label={t('Not saved')} />
                    : <span className="aip-count shrink-0" aria-live="polite">
                        {enabled.length === 0 ? `${t('All')} ${models.length}` : `${enabledCount} / ${models.length}`}
                      </span>}
                <ChevronDown size={13} strokeWidth={1.75} className={`aip-select-chevron ${open ? 'is-open' : ''}`} aria-hidden="true" />
            </button>

            <div className="aip-reveal" data-open={open ? 'true' : 'false'}>
                <div>
                    <div id={panelId} role="group" aria-label={t('Models shown in the picker')} className="pt-2" onKeyDown={onListKeyDown}>
                        {showFilterBar && (
                            <div className="flex items-center gap-2 mb-2">
                                <input
                                    type="search"
                                    value={query}
                                    onChange={e => setQuery(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); moveTo(0); } }}
                                    placeholder={t('Filter models…')}
                                    className="aip-input flex-1"
                                    data-mono="true"
                                />
                                <button
                                    type="button"
                                    onClick={() => setHidePreviews(v => !v)}
                                    aria-pressed={hidePreviews}
                                    className="aip-chip shrink-0"
                                    title={t('Hide preview, experimental and dated variants')}
                                >
                                    <Check size={9} strokeWidth={2.5} className="aip-chip-check" aria-hidden="true" />
                                    {t('Previews')}
                                </button>
                                {enabled.length > 0 && (
                                    <button type="button" onClick={onReset} className="aip-btn shrink-0" title={t('Show all models again')}>
                                        {t('Reset')}
                                    </button>
                                )}
                            </div>
                        )}

                        <div ref={listRef} className="aip-well aip-scroll-y custom-scrollbar aip-models-well">
                            {visible.length === 0 ? (
                                <p className="aip-meta px-2 py-3 text-center">{t('No models match that filter.')}</p>
                            ) : visible.map((m, i) => {
                                const on = isOn(m.id);
                                const inert = soleEnabled === m.id;
                                const stale = staleIds.includes(m.id);
                                return (
                                    <button
                                        key={m.id}
                                        type="button"
                                        data-index={i}
                                        tabIndex={i === activeIndex ? 0 : -1}
                                        aria-pressed={on}
                                        aria-disabled={inert || undefined}
                                        onClick={() => { if (!inert) onToggle(m.id); }}
                                        onFocus={() => setActiveIndex(i)}
                                        title={inert
                                            ? t('At least one model must stay on. Turn the provider off to hide it entirely.')
                                            : m.id}
                                        className="aip-model-row"
                                    >
                                        <Check size={11} strokeWidth={2.5} className="aip-model-check" aria-hidden="true" />
                                        <span className="aip-model-name truncate">{m.label}</span>
                                        {m.label !== m.id && (
                                            <span className="aip-model-id aip-mono truncate">{m.id}</span>
                                        )}
                                        {stale && <AipBadge tone="warn" label={t('Not offered')} />}
                                    </button>
                                );
                            })}
                        </div>

                        {models.length <= AIP_MODEL_FILTER_THRESHOLD && (
                            <p className="aip-meta mt-2">{t('Showing built-in models. Fetch to see everything your key can reach.')}</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export interface AipSelectOption { id: string; name: string }

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
 *  - portals are banned in this file (the orchid tokens resolve by DOM
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
}

const ModelSelect: React.FC<ModelSelectProps> = ({ value, options, onChange, placeholder, className = "" }) => {
    const t = useT();
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);

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

    return (
        <div className="relative" ref={containerRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
                aria-haspopup="listbox"
                className={`aip-select-trigger w-40 ${className}`}
                type="button"
            >
                <span className="truncate pr-2">{selectedOption ? selectedOption.name : resolvedPlaceholder}</span>
                <ChevronDown size={14} strokeWidth={1.75} className="aip-select-chevron" aria-hidden="true" />
            </button>

            {isOpen && (
                <div
                    role="listbox"
                    className="aip-float aip-scroll-y aip-panel-fade absolute top-full right-0 mt-1 w-full z-50 max-h-60 p-1 custom-scrollbar"
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
                            className="aip-select-option"
                            type="button"
                        >
                            <span className="truncate">{option.name}</span>
                            {value === option.id && <Check size={13} strokeWidth={1.75} className="aip-accent-fg shrink-0 ml-2" aria-hidden="true" />}
                        </button>
                    ))}
                    {options.length === 0 && (
                        <div className="aip-select-empty">{t('No models available')}</div>
                    )}
                </div>
            )}
        </div>
    );
};

/**
 * Codex model picker. Was a free-text input beside a narrow "Preset" dropdown,
 * which showed the same id twice — once as editable text, once as the dropdown's
 * value. The dropdown is now the whole control.
 *
 * Trade-off, deliberate: typing an id outside CODEX_CLI_MODEL_PRESETS is no longer
 * possible. A model already persisted from elsewhere still renders and stays
 * selected (it is prepended to the option list below), so no existing
 * configuration breaks — but a NEW arbitrary id can't be entered here any more.
 * Add it to CODEX_CLI_MODEL_PRESETS in src/utils/modelUtils.ts instead.
 */
const CodexCliModelField: React.FC<{
    label: string;
    value: string;
    onSelect: (value: string) => void;
}> = ({ label, value, onSelect }) => {
    const t = useT();
    return (
    <label className="space-y-1 block min-w-0">
        <span className="aip-label">{label}</span>
        <ModelSelect
            value={value}
            options={value && !CODEX_CLI_MODEL_PRESETS.some(option => option.id === value)
                // Keep a value that came from a previous build or a hand-edited
                // config selectable rather than silently dropping it.
                ? [{ id: value, name: prettifyModelId(value) }, ...CODEX_CLI_MODEL_PRESETS]
                : CODEX_CLI_MODEL_PRESETS}
            onChange={onSelect}
            placeholder={t("Select a model")}
        />
    </label>
    );
};

interface AIProvidersSettingsProps {
    aiResponseLanguage: string;
    availableAiLanguages: any[];
    isAiLangDropdownOpen: boolean;
    onToggleAiLangDropdown: () => void;
    onSelectAiLanguage: (code: string) => void;
    aiLangDropdownRef: React.RefObject<HTMLDivElement | null>;
}

export const AIProvidersSettings: React.FC<AIProvidersSettingsProps> = ({
    aiResponseLanguage,
    availableAiLanguages,
    isAiLangDropdownOpen,
    onToggleAiLangDropdown,
    onSelectAiLanguage,
    aiLangDropdownRef,
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

    // --- LiteLLM proxy (OpenAI-compatible gateway: baseURL + optional virtual key) ---
    const [litellmBaseURL, setLitellmBaseURL] = useState('');
    const [litellmApiKey, setLitellmApiKey] = useState('');
    // Max output tokens for proxied models. '' = Auto: per-model budget from the
    // proxy's /model/info (standard registry value), falling back to 8192.
    const [litellmMaxTokens, setLitellmMaxTokens] = useState('');
    const [litellmModels, setLitellmModels] = useState<string[]>([]);
    const [isRefreshingLitellm, setIsRefreshingLitellm] = useState(false);
    // Provider visibility filters. `disabledProviders` hides a provider's models
    // without touching its stored credential; `cloudEnabledModels[prov]` narrows
    // which of that provider's models reach the picker (empty = all).
    const [disabledProviders, setDisabledProviders] = useState<string[]>([]);
    const [cloudEnabledModels, setCloudEnabledModelsState] = useState<Record<string, string[]>>({});
    // Per-provider catalog, as last fetched from the provider API. Persisted in
    // CredentialsManager so it survives the settings-tab switch that unmounts this
    // panel (SettingsOverlay renders it behind `activeTab === 'ai-providers' &&`).
    const [cloudFetchedModels, setCloudFetchedModels] = useState<Record<string, AipModelEntry[]>>({});
    const [modelSaveError, setModelSaveError] = useState<Record<string, boolean>>({});

    // Status
    const [savedStatus, setSavedStatus] = useState<Record<string, boolean>>({});
    const [savingStatus, setSavingStatus] = useState<Record<string, boolean>>({});
    const [hasStoredKey, setHasStoredKey] = useState<Record<string, boolean>>({});
    const [testStatus, setTestStatus] = useState<Record<string, 'idle' | 'testing' | 'success' | 'error'>>({});
    const [testError, setTestError] = useState<Record<string, string>>({});

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
    const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'detected' | 'not-found' | 'fixing'>('checking');
    const [ollamaRestarted, setOllamaRestarted] = useState(false);
    const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
    const [confirmBusy, setConfirmBusy] = useState(false);
    const [activeTab, setActiveTab] = useState<ProviderTabId>('cloud');
    // Index drives the sliding pill's translate; -1 can't happen (state is typed
    // to the tab ids) but Math.max keeps a bad persisted value from shifting it off-track.
    const activeTabIndex = Math.max(0, PROVIDER_TABS.findIndex((tab) => tab.id === activeTab));
    const [isRefreshingOllama, setIsRefreshingOllama] = useState(false);
    // Roving tabindex: only the selected tab is a tab stop, so Arrow/Home/End
    // are the ONLY way to reach the other two. Without this a keyboard user
    // landed on the active tab and could never leave it.
    const tabRefs = useRef<Partial<Record<ProviderTabId, HTMLButtonElement | null>>>({});

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
    const [codexCliConfig, setCodexCliConfig] = useState({ enabled: false, path: 'codex', model: 'gpt-5.4', fastModel: 'gpt-5.3-codex-spark', timeoutMs: 60000, sandboxMode: 'read-only' as string, serviceTier: 'default', modelReasoningEffort: undefined as string | undefined });
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
    const [codexOauthStatus, setCodexOauthStatus] = useState<{ signedIn: boolean; email?: string; expiresAt?: number }>({ signedIn: false });
    const [codexOauthInProgress, setCodexOauthInProgress] = useState(false);

    // --- Default Model ---
    const [defaultModel, setDefaultModel] = useState<string>('gemini-3.6-flash');
    const [fastResponseMode, setFastResponseMode] = useState(false);
    const [credentialsLoaded, setCredentialsLoaded] = useState(false);
    const canUseFastMode = !!(hasStoredKey.groq || hasStoredKey.natively || (codexCliConfig.enabled && codexOauthStatus.signedIn));

    // --- Dynamic Model Discovery ---
    const [preferredModels, setPreferredModels] = useState<Record<string, string>>({});

    // --- Screen Understanding (vision routing) ---
    const [screenUnderstandingMode, setScreenUnderstandingMode] = useState<'vision_first' | 'vision_only' | 'private_vision'>('vision_first');
    const [technicalInterviewVisionFirst, setTechnicalInterviewVisionFirst] = useState<boolean>(true);

    // --- Cloud Provider Data Scopes (fail-closed cloud share controls) ---
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

    const applyVisionMode = (localOnly: boolean, required: boolean) => {
        const mode = localOnly ? 'private_vision' : (required ? 'vision_only' : 'vision_first');
        setScreenUnderstandingMode(mode);
        window.electronAPI?.setScreenUnderstandingMode?.(mode);
    };

    // Where a disabled scope's data actually goes. LLMHelper reroutes it to Ollama
    // when a local model exists and OMITS it from context when one does not — see
    // logScopeFallback(). Only the console ever knew which of those happened.
    const localFallbackAvailable = ollamaModels.length > 0;
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
                // @ts-ignore
                const creds = await window.electronAPI?.getStoredCredentials?.();
                if (creds) {
                    setHasStoredKey({
                        gemini: creds.hasGeminiKey,
                        groq: creds.hasGroqKey,
                        openai: creds.hasOpenaiKey,
                        claude: creds.hasClaudeKey,
                        deepseek: creds.hasDeepseekKey || false,
                        litellm: creds.hasLitellmBaseURL || false,
                        natively: creds.hasNativelyKey || false
                    });
                    // Prefill stored LiteLLM config so re-saving doesn't silently reset it.
                    // (baseURL is config, not a secret; the key stays masked/blank = keep.)
                    // Also clear the fields when another window removes the proxy.
                    setLitellmBaseURL(creds.litellmBaseURL || '');
                    setLitellmMaxTokens(creds.litellmMaxTokens ? String(creds.litellmMaxTokens) : '');
                    // Load preferred models
                    const pm: Record<string, string> = {};
                    if (creds.geminiPreferredModel) pm.gemini = creds.geminiPreferredModel;
                    if (creds.groqPreferredModel) pm.groq = creds.groqPreferredModel;
                    if (creds.openaiPreferredModel) pm.openai = creds.openaiPreferredModel;
                    if (creds.claudePreferredModel) pm.claude = creds.claudePreferredModel;
                    if (creds.deepseekPreferredModel) pm.deepseek = creds.deepseekPreferredModel;
                    setDisabledProviders(Array.isArray(creds.disabledProviders) ? creds.disabledProviders : []);
                    setCloudEnabledModelsState(creds.cloudEnabledModels || {});
                    window.electronAPI?.getCloudFetchedModels?.()
                        .then((res: { models?: Record<string, AipModelEntry[]> }) => { if (res?.models) setCloudFetchedModels(res.models); })
                        .catch(() => {});
                    setPreferredModels(pm);
                }

                // Now it's safe to read fast mode — hasStoredKey is already set so
                // canUseFastMode will be correct when the enforcement effect runs.
                // @ts-ignore
                const cliConfig = await window.electronAPI?.getCodexCliConfig?.();
                if (cliConfig) setCodexCliConfig(cliConfig as typeof codexCliConfig);

                // Codex OAuth status — read once on mount so the Settings UI
                // shows the right state without waiting for a user click.
                // @ts-ignore
                const oauthStatus = await window.electronAPI?.codexLoginStatus?.();
                if (oauthStatus?.success) {
                    setCodexOauthStatus({
                        signedIn: !!oauthStatus.signedIn,
                        email: oauthStatus.email,
                        expiresAt: oauthStatus.expiresAt,
                    });
                }

                const fastMode = await window.electronAPI?.getGroqFastTextMode();
                if (fastMode) setFastResponseMode(fastMode.enabled);

                // @ts-ignore
                const custom = await window.electronAPI?.getCustomProviders();
                if (custom) {
                    setCustomProviders(custom);
                }

                // Load persisted default model
                // @ts-ignore
                const result = await window.electronAPI?.getDefaultModel();
                if (result && result.model) {
                    setDefaultModel(result.model);
                }

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
        if (window.electronAPI?.onCredentialsChanged) {
            // @ts-ignore
            unsubs.push(window.electronAPI.onCredentialsChanged(() => {
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
    const isModelEnabled = (provider: string, modelId: string) => {
        const allowList = cloudEnabledModels[provider] || [];
        return allowList.length === 0 || allowList.includes(modelId);
    };

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
        (cloudFetchedModels[provider] || []).forEach(m => push(m.id, m.label || m.id));
        // Allow-listed ids with no catalog entry still get a row, labelled as best we can.
        (cloudEnabledModels[provider] || []).forEach(id => push(id, prettifyModelId(id)));
        return out;
    }, [cloudFetchedModels, cloudEnabledModels]);

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
        if (isCodexReady && isProviderEnabled('codex-cli')) {
            opts.push({ id: CODEX_CLI_MODEL.id, name: `${CODEX_CLI_MODEL.name} (${prettifyModelId(codexCliConfig.model)})` });
            CODEX_CLI_MODEL_PRESETS.forEach(model => {
                const id = codexCliSelectorId(model.id);
                if (!opts.find(o => o.id === id)) {
                    opts.push({ id, name: `${CODEX_CLI_MODEL.name}: ${model.name}` });
                }
            });
        }
        if (hasStoredKey.litellm && isProviderEnabled('litellm')) {
            litellmModels.forEach(model => opts.push({ id: `litellm/${model}`, name: `${prettifyModelId(model)} (LiteLLM)` }));
        }
        if (isProviderEnabled('custom')) {
            customProviders.forEach(p => opts.push({ id: p.id, name: p.name }));
        }
        if (isProviderEnabled('ollama')) {
            ollamaModels.forEach(m => opts.push({ id: `ollama-${m}`, name: `${m} (Local)` }));
        }
        return opts;
    };

    // Keep the persisted default model from pointing at a provider the user just
    // removed/signed out of. This turns credential changes into immediate routing
    // changes instead of waiting for a failing request to discover stale state.
    useEffect(() => {
        if (!credentialsLoaded) return;
        const opts = buildAvailableModelOptions();
        if (!defaultModel || opts.some(o => o.id === defaultModel) || opts.length === 0) return;
        const next = opts[0].id;
        setDefaultModel(next);
        window.electronAPI?.setDefaultModel?.(next).catch(console.error);
    }, [credentialsLoaded, defaultModel, hasStoredKey, preferredModels, isCodexReady, codexCliConfig.model, customProviders, ollamaModels, litellmModels, disabledProviders, cloudEnabledModels]);

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
    const handleToggleModel = async (provider: string, modelId: string) => {
        const universe = effectiveModels(provider).map(m => m.id);
        const current = cloudEnabledModels[provider] || [];
        // An empty allow-list means "all", so the first un-check has to materialise
        // the full set minus the one being removed. The set is the EFFECTIVE universe,
        // not just the presets — normalising against presets while the list also holds
        // fetched ids collapses at the wrong cardinality and wipes the selection.
        const effective = current.length === 0 ? universe : current;
        const nextList = effective.includes(modelId)
            ? effective.filter(id => id !== modelId)
            : [...effective, modelId];
        // Everything selected → store [] (no filter). Never store "none": the UI keeps
        // the last remaining row inert so this branch is unreachable from a click.
        const normalised = (nextList.length === 0 || nextList.length === universe.length) ? [] : nextList;
        const prev = cloudEnabledModels;
        setCloudEnabledModelsState(p => ({ ...p, [provider]: normalised }));
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
                    setCodexOauthStatus(prev => ({ ...prev, signedIn: true, email: info?.email || prev.email }));
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
        window.electronAPI?.getProviderDataScopes?.().then(setProviderDataScopes).catch(() => { });
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
            // @ts-ignore
            const result = await window.electronAPI?.invoke?.('ensure-ollama-running');
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

    const checkOllama = async (_isInitial = true) => {
        // Don't override 'checking' if we are already in smart-start mode
        // if (isInitial) setOllamaStatus('checking'); 

        try {
            // @ts-ignore
            const models = await window.electronAPI?.getAvailableOllamaModels?.();
            if (models && models.length > 0) {
                setOllamaModels(models);
                setOllamaStatus('detected');
            } else {
                // Silent failure on background checks
                // Only set not-found if we haven't detected it yet
                if (ollamaStatus !== 'detected') {
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
            // @ts-ignore
            const result = await window.electronAPI?.invoke?.('force-restart-ollama');
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
                    const status = await api?.codexLoginStatus?.();
                    if (status?.success) {
                        setCodexOauthStatus({ signedIn: !!status.signedIn, email: status.email, expiresAt: status.expiresAt });
                    }
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

            if (result && result.success) {
                setSavedStatus(prev => ({ ...prev, [provider]: true }));
                setHasStoredKey(prev => ({ ...prev, [provider]: true }));
                setter('');
                setTimeout(() => setSavedStatus(prev => ({ ...prev, [provider]: false })), 2000);
            }
        } catch (e) {
            console.error(`Failed to save ${provider} key:`, e);
        } finally {
            setSavingStatus(prev => ({ ...prev, [provider]: false }));
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
            }
        } catch (e) {
            console.error('Failed to remove LiteLLM config:', e);
        }
    };

    const handleRemoveKey = (provider: string, setter: (val: string) => void) => {
        setPendingConfirm({ kind: 'providerKey', provider, setter });
    };

    const performRemoveKey = async (provider: string, setter: (val: string) => void) => {
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

            if (result && result.success) {
                setHasStoredKey(prev => ({ ...prev, [provider]: false }));
                setter('');
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

    const openKeyUrl = (provider: string) => {
        const urls: Record<string, string> = {
            gemini: 'https://aistudio.google.com/app/apikey',
            groq: 'https://console.groq.com/keys',
            openai: 'https://platform.openai.com/api-keys',
            claude: 'https://console.anthropic.com/settings/keys'
        };
        // @ts-ignore
        window.electronAPI?.openExternal(urls[provider]);
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
            case 'litellm':
                return {
                    title: t('Remove LiteLLM proxy configuration?'),
                    description: t('The proxy URL, virtual key, and token limit will be cleared. Discovered models will no longer appear in the model picker.'),
                    confirmLabel: t('Remove'),
                };
            case 'providerKey':
                return {
                    title: `${t('Remove the')} ${pendingConfirm.provider} ${t('API key?')}`,
                    description: t('The stored key is deleted. You will need to paste it again to re-enable this provider.'),
                    confirmLabel: t('Remove key'),
                };
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
        <div className="aip-root space-y-5 pb-10" data-theme={theme}>
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
                <h3 className="aip-title mb-1">{t('AI Providers')}</h3>
                <p className="aip-subtitle mb-5">
                    {t('Pick a default model and connect the cloud, local, or custom providers you want available.')}
                </p>
            </header>

            {/* Default Model for Chat */}
            <div className="space-y-5">
                <div className="aip-card p-5 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                        <label className="block text-xs font-medium uppercase tracking-wide mb-0 aip-hero">{t('Active Model')}</label>
                        <p className="text-[10px] aip-muted">{t('Applies to new chats instantly.')}</p>
                    </div>
                    <ModelSelect
                        value={defaultModel}
                        options={buildAvailableModelOptions()}
                        onChange={(val) => {
                            setDefaultModel(val);
                            // @ts-ignore - persist as default + update runtime + broadcast
                            window.electronAPI?.setDefaultModel(val).catch(console.error);
                        }}
                    />
                </div>

                {/* Fast Response Mode */}
                <div
                    className={`aip-card p-5 flex items-center justify-between gap-4 ${!canUseFastMode ? 'opacity-50 grayscale' : ''}`}
                    title={!canUseFastMode ? t("Requires Groq, Natively API, or Codex CLI to be configured") : ""}
                >
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <label className="block text-xs font-medium uppercase tracking-wide mb-0 aip-hero">{t('Fast Response Mode')}</label>
                            <AipBadge tone="info" label={t('New')} />
                            {!canUseFastMode && <AipBadge tone="warn" label={t('Needs Groq')} />}
                        </div>
                        <p className="text-[10px] aip-muted mt-0.5">{t('Uses the fastest available provider instead of your selected model.')}</p>
                        {!canUseFastMode && (
                            <p className="text-[10px] aip-warn-fg mt-0.5 font-medium">{t('Requires Groq, Natively API, or Codex CLI to be configured.')}</p>
                        )}
                    </div>
                    {/* aria-disabled, not disabled: the onClick guard below is the
                        only thing that explains WHY the toggle is unavailable, and
                        Stage 3 owns replacing that alert() with an inline hint.
                        Hard-disabling here would make it unreachable dead code. */}
                    <AipSwitch
                        checked={fastResponseMode}
                        disabled={!canUseFastMode}
                        label={t('Fast Response Mode')}
                        onChange={async () => {
                            if (!canUseFastMode) {
                                alert(t("Please configure Groq, Natively API, or Codex CLI first to enable Fast Response Mode."));
                                return;
                            }
                            const newState = !fastResponseMode;
                            setFastResponseMode(newState);
                            localStorage.setItem('natively_groq_fast_text', String(newState));
                            // @ts-ignore
                            await window.electronAPI?.setGroqFastTextMode(newState);
                        }}
                    />
                </div>

                {/* Capture quality. NOT privacy — an image-resolution profile, which is
                    why it does not live in the Privacy tab. It sits with the other global
                    defaults (active model, response language) because that is what it is:
                    a default applied to every screenshot, independent of
                    screenUnderstandingMode's routing strategy. */}
                <div className="aip-card p-5 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                        <label className="block text-xs font-medium uppercase tracking-wide mb-0 aip-hero">{t('High-resolution capture for code')}</label>
                        <p className="text-[10px] aip-muted mt-0.5">{t('Keeps small code text legible in screenshots. Costs more tokens per screenshot.')}</p>
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

                {/* AI Response Language */}
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
                    <div className="relative" ref={aiLangDropdownRef}>
                        <button
                            onClick={onToggleAiLangDropdown}
                            aria-expanded={isAiLangDropdownOpen}
                            className="aip-btn min-w-[110px] justify-between"
                        >
                            <span className="capitalize text-ellipsis overflow-hidden whitespace-nowrap flex items-center gap-1">
                                {aiResponseLanguage === 'auto' ? t('Auto') : aiResponseLanguage}
                            </span>
                            <ChevronDown size={12} strokeWidth={1.75} className={`shrink-0 transition-transform ${isAiLangDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isAiLangDropdownOpen && (
                            <div
                                role="listbox"
                                aria-label={t('AI Response Language')}
                                className="aip-float aip-scroll-y aip-panel-fade absolute right-0 top-full mt-1 min-w-full w-max z-20 p-1 select-none max-h-60 custom-scrollbar"
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
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Provider groups. Splits the sections below into three views instead
                of one long scroll. Each tab now carries id + aria-controls, each
                panel role="tabpanel" + aria-labelledby + tabIndex, and the list has
                a roving-tabindex key handler (see handleTabKeyDown) — without it a
                keyboard user landed on the active tab and could never leave it.

                Motion matches the Plans & Billing tier switcher: the selection is
                one absolutely-positioned pill translated across a fixed-width
                track, so only `transform` animates and the work stays on the
                compositor. The tabs themselves never restyle their background —
                which is what stops the four-way colour swap that a per-button
                `bg` transition produces. */}
            <div
                role="tablist"
                aria-label={t('Provider groups')}
                className="aip-tablist grid grid-cols-3 relative p-1 rounded-lg overflow-hidden"
            >
                {/* Active sliding pill. duration-150 is what the Plans & Billing
                    pill actually renders at — its `duration-220` is not a real
                    Tailwind class (no 220 on the scale, and the config doesn't
                    extend transitionDuration), so it is dropped and
                    transition-transform's own 150ms default applies there.
                    Bump both to duration-[220ms] together to get the timing that
                    code originally intended. */}
                <div
                    aria-hidden="true"
                    className="absolute top-0 bottom-0 left-0 w-1/3 p-1 transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] will-change-transform motion-reduce:transition-none"
                    style={{ transform: `translate3d(${activeTabIndex * 100}%, 0, 0)` }}
                >
                    <div className="w-full h-full rounded-md aip-tab-pill" />
                </div>

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
            >
            {/* Cloud Providers */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-sm font-bold aip-hero mb-1">{t('Cloud Providers')}</h3>
                    <p className="text-xs aip-muted mb-2">{t('Add API keys to unlock cloud AI models.')}</p>
                </div>

                <div className="space-y-4">

                    {/* Gemini */}
                    <ProviderCard
                        providerId="gemini"
                        isDisabled={disabledProviders.includes('gemini')}
                        onToggleDisabled={(enabled) => handleToggleProvider('gemini', enabled)}
                        selectableModels={effectiveModels('gemini')}
                        enabledModels={cloudEnabledModels['gemini']}
                        onToggleModel={(modelId) => handleToggleModel('gemini', modelId)}
                        onResetModels={() => handleResetModels('gemini')}
                        modelSaveError={!!modelSaveError['gemini']}
                        providerName="Gemini"
                        apiKey={apiKey}
                        preferredModel={preferredModels.gemini}
                        hasStoredKey={!!hasStoredKey.gemini}
                        onKeyChange={setApiKey}
                        onSaveKey={async () => { await handleSaveKey('gemini', apiKey, setApiKey); }}
                        onRemoveKey={() => handleRemoveKey('gemini', setApiKey)}
                        onTestConnection={() => handleTestConnection('gemini', apiKey)}
                        testStatus={testStatus.gemini || 'idle'}
                        testError={testError.gemini}
                        savingStatus={!!savingStatus.gemini}
                        savedStatus={!!savedStatus.gemini}
                        keyPlaceholder="AIzaSy..."
                        keyUrl="https://aistudio.google.com/app/apikey"
                        onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, gemini: model }))}
                    />

                    {/* Groq */}
                    <ProviderCard
                        providerId="groq"
                        isDisabled={disabledProviders.includes('groq')}
                        onToggleDisabled={(enabled) => handleToggleProvider('groq', enabled)}
                        selectableModels={effectiveModels('groq')}
                        enabledModels={cloudEnabledModels['groq']}
                        onToggleModel={(modelId) => handleToggleModel('groq', modelId)}
                        onResetModels={() => handleResetModels('groq')}
                        modelSaveError={!!modelSaveError['groq']}
                        providerName="Groq"
                        apiKey={groqApiKey}
                        preferredModel={preferredModels.groq}
                        hasStoredKey={!!hasStoredKey.groq}
                        onKeyChange={setGroqApiKey}
                        onSaveKey={async () => { await handleSaveKey('groq', groqApiKey, setGroqApiKey); }}
                        onRemoveKey={() => handleRemoveKey('groq', setGroqApiKey)}
                        onTestConnection={() => handleTestConnection('groq', groqApiKey)}
                        testStatus={testStatus.groq || 'idle'}
                        testError={testError.groq}
                        savingStatus={!!savingStatus.groq}
                        savedStatus={!!savedStatus.groq}
                        keyPlaceholder="gsk_..."
                        keyUrl="https://console.groq.com/keys"
                        onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, groq: model }))}
                    />

                    {/* OpenAI */}
                    <ProviderCard
                        providerId="openai"
                        isDisabled={disabledProviders.includes('openai')}
                        onToggleDisabled={(enabled) => handleToggleProvider('openai', enabled)}
                        selectableModels={effectiveModels('openai')}
                        enabledModels={cloudEnabledModels['openai']}
                        onToggleModel={(modelId) => handleToggleModel('openai', modelId)}
                        onResetModels={() => handleResetModels('openai')}
                        modelSaveError={!!modelSaveError['openai']}
                        providerName="OpenAI"
                        apiKey={openaiApiKey}
                        preferredModel={preferredModels.openai}
                        hasStoredKey={!!hasStoredKey.openai}
                        onKeyChange={setOpenaiApiKey}
                        onSaveKey={async () => { await handleSaveKey('openai', openaiApiKey, setOpenaiApiKey); }}
                        onRemoveKey={() => handleRemoveKey('openai', setOpenaiApiKey)}
                        onTestConnection={() => handleTestConnection('openai', openaiApiKey)}
                        testStatus={testStatus.openai || 'idle'}
                        testError={testError.openai}
                        savingStatus={!!savingStatus.openai}
                        savedStatus={!!savedStatus.openai}
                        keyPlaceholder="sk-..."
                        keyUrl="https://platform.openai.com/api-keys"
                        onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, openai: model }))}
                    />

                    {/* Claude */}
                    <ProviderCard
                        providerId="claude"
                        isDisabled={disabledProviders.includes('claude')}
                        onToggleDisabled={(enabled) => handleToggleProvider('claude', enabled)}
                        selectableModels={effectiveModels('claude')}
                        enabledModels={cloudEnabledModels['claude']}
                        onToggleModel={(modelId) => handleToggleModel('claude', modelId)}
                        onResetModels={() => handleResetModels('claude')}
                        modelSaveError={!!modelSaveError['claude']}
                        providerName="Claude"
                        apiKey={claudeApiKey}
                        preferredModel={preferredModels.claude}
                        hasStoredKey={!!hasStoredKey.claude}
                        onKeyChange={setClaudeApiKey}
                        onSaveKey={async () => { await handleSaveKey('claude', claudeApiKey, setClaudeApiKey); }}
                        onRemoveKey={() => handleRemoveKey('claude', setClaudeApiKey)}
                        onTestConnection={() => handleTestConnection('claude', claudeApiKey)}
                        testStatus={testStatus.claude || 'idle'}
                        testError={testError.claude}
                        savingStatus={!!savingStatus.claude}
                        savedStatus={!!savedStatus.claude}
                        keyPlaceholder="sk-ant-..."
                        keyUrl="https://console.anthropic.com/settings/keys"
                        onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, claude: model }))}
                    />

                    {/* DeepSeek — text-only; intentionally not part of the screenshot/vision fallback chain. */}
                    <ProviderCard
                        providerId="deepseek"
                        isDisabled={disabledProviders.includes('deepseek')}
                        onToggleDisabled={(enabled) => handleToggleProvider('deepseek', enabled)}
                        selectableModels={effectiveModels('deepseek')}
                        enabledModels={cloudEnabledModels['deepseek']}
                        onToggleModel={(modelId) => handleToggleModel('deepseek', modelId)}
                        onResetModels={() => handleResetModels('deepseek')}
                        modelSaveError={!!modelSaveError['deepseek']}
                        providerName="DeepSeek"
                        apiKey={deepseekApiKey}
                        preferredModel={preferredModels.deepseek}
                        hasStoredKey={!!hasStoredKey.deepseek}
                        onKeyChange={setDeepseekApiKey}
                        onSaveKey={async () => { await handleSaveKey('deepseek', deepseekApiKey, setDeepseekApiKey); }}
                        onRemoveKey={() => handleRemoveKey('deepseek', setDeepseekApiKey)}
                        onTestConnection={() => handleTestConnection('deepseek', deepseekApiKey)}
                        testStatus={testStatus.deepseek || 'idle'}
                        testError={testError.deepseek}
                        savingStatus={!!savingStatus.deepseek}
                        savedStatus={!!savedStatus.deepseek}
                        keyPlaceholder="sk-..."
                        keyUrl="https://platform.deepseek.com/api_keys"
                        onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, deepseek: model }))}
                    />

                </div>
            </div>

            {/* Codex — ChatGPT subscription proxy */}
            <div className="space-y-5">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                        <AipProviderMark provider="codex" name="ChatGPT (Codex)" className="mt-0.5" />
                        <div className="min-w-0">
                        <h3 className="text-sm font-bold aip-hero mb-1">ChatGPT (Codex)</h3>
                        <p className="text-xs aip-muted">{t('Use your ChatGPT Plus/Pro subscription as an AI provider — no API key needed.')}</p>
                        </div>
                    </div>
                    <AipSwitch
                        checked={!disabledProviders.includes('codex-cli')}
                        onChange={() => handleToggleProvider('codex-cli', disabledProviders.includes('codex-cli'))}
                        label={`${disabledProviders.includes('codex-cli') ? t('Enable') : t('Disable')} Codex`}
                        title={disabledProviders.includes('codex-cli') ? t('Enable provider') : t('Disable provider')}
                    />
                </div>

                <div className="aip-card p-5 space-y-4">
                    {/* Header row: title + sign-in state + actions — mirrors ProviderCard */}
                    <div className="flex items-center justify-between gap-3 mb-2">
                        <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide aip-hero">
                            {t('ChatGPT Account')}
                            {codexOauthStatus.signedIn && <AipBadge tone="ok" label={t('Connected')} />}
                        </label>
                        {codexOauthStatus.signedIn ? (
                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    type="button"
                                    onClick={handleCodexRefresh}
                                    disabled={codexOauthInProgress}
                                    className="aip-btn"
                                    data-size="sm"
                                    data-variant="ghost"
                                    title={t("Refresh session")}
                                >
                                    <RefreshCw size={12} strokeWidth={1.75} />
                                    <span className="uppercase tracking-wide">{t('Refresh')}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleCodexSignOut}
                                    disabled={codexOauthInProgress}
                                    className="aip-btn"
                                    data-size="sm"
                                    data-variant="ghost"
                                >
                                    <LogOut size={12} strokeWidth={1.75} />
                                    <span className="uppercase tracking-wide">{t('Sign out')}</span>
                                </button>
                            </div>
                        ) : null}
                    </div>

                    {/* Sign-in area or signed-in account display */}
                    {codexOauthStatus.signedIn ? (
                        <div className="flex gap-2 mb-3">
                            <div className="aip-well flex-1 min-w-0 px-3 py-2.5 text-xs aip-text flex items-center gap-2">
                                <span className="aip-badge-dot aip-ok-fg" aria-hidden="true" />
                                <span className="truncate">{codexOauthStatus.email || t('ChatGPT account connected')}</span>
                            </div>
                        </div>
                    ) : (
                        <div className="flex gap-2 mb-3">
                            <button
                                type="button"
                                onClick={() => handleCodexAuthAction('login')}
                                disabled={codexOauthInProgress || codexAuthAction !== 'idle'}
                                className="aip-btn flex-1"
                                data-size="row"
                                data-variant="accent"
                            >
                                {codexOauthInProgress || codexAuthAction === 'login'
                                    ? <><Loader2 size={13} strokeWidth={1.75} className="aip-spinner" /> {t('Waiting for browser…')}</>
                                    : <><ExternalLink size={13} strokeWidth={1.75} /> {t('Sign in with ChatGPT')}</>}
                            </button>
                        </div>
                    )}

                    {codexAuthMessage && (
                        <p className={`text-[10px] mt-1.5 mb-2 ${codexAuthStatus === 'error' ? 'aip-danger-fg' : 'aip-ok-fg'}`}>
                            {codexAuthMessage}
                        </p>
                    )}

                    {/* Model + settings — only shown once signed in */}
                    {codexOauthStatus.signedIn && (
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <CodexCliModelField
                                    label={t("Model")}
                                    value={codexCliConfig.model}
                                    onSelect={(model) => {
                                        setCodexCliConfig(prev => ({ ...prev, model }));
                                        saveCodexCliConfig({ ...codexCliConfig, model });
                                    }}
                                />
                                <CodexCliModelField
                                    label={t("Fast Mode Model")}
                                    value={codexCliConfig.fastModel}
                                    onSelect={(fastModel) => {
                                        setCodexCliConfig(prev => ({ ...prev, fastModel }));
                                        saveCodexCliConfig({ ...codexCliConfig, fastModel });
                                    }}
                                />
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
                            <div className="flex items-end justify-between gap-4 mt-1">
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
                                    {codexCliStatus === 'error' && codexCliError && (
                                        <p className="text-[10px] aip-danger-fg mt-1">{codexCliError}</p>
                                    )}
                                </label>
                                {/* Fixed min-width + centred content: a label change
                                    ("Test Connection" → "Testing…") must not reflow
                                    the row it sits in. */}
                                <button
                                    type="button"
                                    onClick={handleTestCodexCli}
                                    disabled={codexCliStatus === 'testing'}
                                    className="aip-btn shrink-0 min-w-[124px]"
                                    data-tone={codexCliStatus === 'success' ? 'ok' : codexCliStatus === 'error' ? 'danger' : undefined}
                                >
                                    {codexCliStatus === 'testing' ? (
                                        <><Loader2 size={12} strokeWidth={1.75} className="aip-spinner" /> {t('Testing…')}</>
                                    ) : codexCliStatus === 'success' ? (
                                        <><Check size={12} strokeWidth={2} className="aip-check" /> {t('Connected')}</>
                                    ) : codexCliStatus === 'error' ? (
                                        <><AlertCircle size={12} strokeWidth={1.75} /> {t('Failed')}</>
                                    ) : (
                                        t('Test Connection')
                                    )}
                                </button>
                            </div>
                        </>
                    )}
                </div>
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
                                    {/* tabular-nums so the digit does not twitch as the
                                        count changes. No odometer, no flash, no pulse. */}
                                    <span className="aip-count">
                                        {litellmModels.length === 1
                                            ? t('1 model')
                                            : `${litellmModels.length} ${t('models')}`}
                                    </span>
                                    {/* Discovery is explicit now — the model picker reads a
                                        cache so it never blocks on the proxy. */}
                                    <button
                                        type="button"
                                        onClick={handleRefreshLitellmModels}
                                        disabled={isRefreshingLitellm}
                                        className="aip-btn"
                                        data-size="sm"
                                        title={t('Re-discover models from the proxy')}
                                    >
                                        <RefreshCw size={10} strokeWidth={1.75} className={isRefreshingLitellm ? 'aip-spinner' : ''} />
                                        {isRefreshingLitellm ? t('Refreshing...') : t('Refresh')}
                                    </button>
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

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handleSaveLitellm}
                                disabled={!litellmBaseURL.trim() || !!savingStatus.litellm}
                                className="aip-btn min-w-[92px]"
                                data-variant="accent"
                            >
                                {savingStatus.litellm
                                    ? <><Loader2 size={12} strokeWidth={1.75} className="aip-spinner" /> {t('Saving…')}</>
                                    : savedStatus.litellm
                                        ? <><Check size={12} strokeWidth={2} className="aip-check" /> {t('Saved')}</>
                                        : t('Save')}
                            </button>
                            {hasStoredKey.litellm && (
                                <button
                                    type="button"
                                    onClick={handleRemoveLitellm}
                                    className="aip-btn"
                                    data-variant="ghost"
                                >
                                    {t('Remove')}
                                </button>
                            )}
                        </div>
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
                                {ollamaModels.map(model => (
                                    <div key={model} className="aip-well flex items-center justify-between gap-2 p-2">
                                        <span className="aip-mono truncate">{model}</span>
                                        <AipBadge tone="neutral" label={t('Local')} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {ollamaStatus === 'detected' && ollamaModels.length === 0 && (
                        <div className="text-xs aip-muted">
                            {t('Ollama is running but no models found. Run `ollama pull llama3` to get started.')}
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
                                {/* A native <select> ignores every --aip-* token; swapping
                                    it for AipSelect is Stage 5's job (the option labels
                                    are translated keys that need re-plumbing). */}
                                <select
                                    value={customVision}
                                    onChange={(e) => setCustomVision(e.target.value as 'auto' | 'on' | 'off')}
                                    className="aip-input"
                                >
                                    <option value="auto">{t('Auto-detect (recommended)')}</option>
                                    <option value="on">{t('Always send screenshots')}</option>
                                    <option value="off">{t('Never send screenshots (text only)')}</option>
                                </select>
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
                <div className="aip-card p-4 flex flex-col gap-3">
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
                            <span>{t('No local vision model is installed, so screen understanding will fail. Install one under Local & Gateways.')}</span>
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

                    {/* The two cards answer overlapping questions and previously never
                        referenced each other, leaving the user to reconcile them. */}
                    {!visionLocalOnly && providerDataScopes.screenshots === false && (
                        <div className="flex items-start gap-2 pt-3 border-t" style={{ borderColor: 'var(--aip-divider)' }}>
                            <Info size={12} strokeWidth={1.75} className="aip-faint shrink-0 mt-0.5" aria-hidden="true" />
                            <p className="aip-meta leading-relaxed">
                                {t('Screenshots are already blocked from cloud providers by the data scope below, so this behaves as on-device only.')}
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
                        {SCOPE_ROWS.length - disabledScopeCount}/{SCOPE_ROWS.length} {t('shared')}
                    </span>
                </div>
                <div className="aip-card">
                    {SCOPE_ROWS.map(({ key, labelKey, Icon }, i) => {
                        const allowed = providerDataScopes[key] !== false;
                        const label = t(labelKey);
                        return (
                            <div
                                key={key}
                                className="flex items-center gap-3 px-4 py-2.5"
                                style={i > 0 ? { borderTop: '1px solid var(--aip-divider)' } : undefined}
                            >
                                <Icon size={13} strokeWidth={1.75} className={allowed ? 'aip-faint shrink-0' : 'aip-warn-fg shrink-0'} aria-hidden="true" />
                                <span className="text-xs aip-hero min-w-0 truncate">{label}</span>
                                {/* A disabled scope is not inert: LLMHelper reroutes it to a local
                                    model, or DROPS it when none exists. One word each, so the row
                                    never wraps and the card never grows. */}
                                {!allowed && (
                                    <span
                                        className="aip-badge shrink-0"
                                        data-tone={localFallbackAvailable ? 'neutral' : 'warn'}
                                        title={localFallbackAvailable
                                            ? t('Handled on-device by your local model.')
                                            : t('Omitted from context — no local model to fall back to.')}
                                    >
                                        {localFallbackAvailable ? <Laptop size={9} strokeWidth={2} aria-hidden="true" /> : null}
                                        <span className="aip-badge-label">{localFallbackAvailable ? t('On-device') : t('Omitted')}</span>
                                    </span>
                                )}
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
                {/* Only when it says something the pills do not. The old version showed a
                    permanent restatement of the per-row text. */}
                {disabledScopeCount > 0 && !localFallbackAvailable && (
                    <div className="aip-inline-warn flex items-start gap-2" role="status">
                        <AlertCircle size={12} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden="true" />
                        <span>{t('Disabled types are dropped from context, not handled on-device — install a local model under Local & Gateways to keep them.')}</span>
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
    );
};
