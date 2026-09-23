# Natively Light Mode Color Palette & Usage Reference

This document maps the **Natively Light Mode** (`[data-theme='light']`) palette: exact hex/RGBA values, CSS variables, and where each color is applied across the app. Values are modeled on Apple's own light appearance (iOS / macOS system colors and apple.com surfaces), with Natively's periwinkle accent unchanged. The matching implementation lives in `natively-light-theme.css`.

---

## 1. Core Principles & Stack Hierarchy

Light mode follows Apple's grouped appearance, as seen in iOS Settings and macOS System Settings:

1. **Canvas**: Soft cool gray (`#F2F2F7`, Apple `systemGroupedBackground`). Large areas are never white, which is where the eye strain reduction comes from.
2. **Chrome & Sidebar**: One step darker (`#EBEBF0`), matching macOS sidebar and toolbar tone.
3. **Cards & Popovers**: Near-white islands (`#FBFBFD`, the apple.com off-white), never stark `#FFFFFF`. Elevated with a very soft shadow plus a hairline.
4. **Borders**: Apple separator hue `rgb(60, 60, 67)` at low alpha, never pure black alpha.
5. **Typography**: Apple label ramp (`#1D1D1F` → `#6E6E73` → `#86868B`), not pure black.
6. **Accent**: Periwinkle scale anchored at `periwinkle-600` (`#8050D4`). Unchanged.

```
Visual Elevation Stack:
[ #EBEBF0 Sidebar / Chrome ] → [ #F2F2F7 Canvas ] → [ #FBFBFD Cards / Popovers (soft shadow) ]
Recessed inside cards: [ #EFEFF4 Inputs ]
```

---

## 2. Canvas & Surface Layers

| CSS Variable | Role / Description | Hex | Apple Equivalent | Where Used |
| :--- | :--- | :--- | :--- | :--- |
| `--bg-primary` | Main App Canvas | `#F2F2F7` | `systemGroupedBackground` | Main application background, list canvas, recessed views. |
| `--bg-secondary` | Chrome & Nav Bar | `#EBEBF0` | macOS toolbar / sidebar tone | Header bar, navigation chrome, top toolbar. |
| `--bg-main` | Content Body Canvas | `#F2F2F7` | `systemGroupedBackground` | Settings modal content body. |
| `--bg-sidebar` | Sidebar Panel Surface | `#EBEBF0` | macOS sidebar tone | Settings sidebar, app navigation sidebar. |
| `--bg-elevated` | Floating Panels & Menus | `#FBFBFD` | apple.com off-white | Modal frame, popup dialogs, context dropdowns. |
| `--bg-card` | Elevated Cards | `#FBFBFD` | `secondarySystemGroupedBackground` (softened) | Content cards, settings sections, detail widgets. |
| `--bg-input` | Form Inputs & Controls | `#EFEFF4` | `tertiarySystemFill` over white | Text fields, search bars, textareas. |
| `--bg-component` | Component Fill | `#E5E5EA` | `systemGray5` | Secondary buttons, segmented controls. |

---

## 3. Typography & Text Hierarchy

| CSS Variable | Token Name | Hex | Contrast on Card / Canvas | Where Used |
| :--- | :--- | :--- | :--- | :--- |
| `--text-primary` | Apple Label | `#1D1D1F` | ~16:1 / ~15:1 | Headings, card titles, primary body prose. |
| `--text-secondary` | Apple Secondary | `#6E6E73` | ~4.9:1 / ~4.6:1 | Subtitles, descriptions, secondary metadata. |
| `--text-tertiary` | Apple Tertiary | `#86868B` | ~3.5:1 / ~3.3:1 | Placeholders, hints, disabled text, captions only. |
| `--text-danger` | Accessible System Red | `#D70015` | ~5.2:1 / ~4.8:1 | Destructive labels, errors, deletion badges. |

Rule: `--text-tertiary` never carries body text or anything the user must read to act.

---

## 4. Accent Palette & Primary Action Scale

Periwinkle scale unchanged, anchored at **Periwinkle-600** (`#8050D4`).

| Token / Property | Role | Value | Where Used |
| :--- | :--- | :--- | :--- |
| `--accent-primary` | Accent Anchor | `#8050D4` (`--periwinkle-600`) | Focus rings, active tab pills, toggles ON, progress bars. |
| `--accent-text` | Accent as Text | `#643EA6` (`--periwinkle-700`) | Accent colored labels on small text, selected nav item label. |
| `--btn-primary-bg` | Primary Button Fill | `#8050D4` | Primary CTA buttons (Save, Submit). |
| `--btn-primary-hover` | Primary Button Hover | `#643EA6` (`--periwinkle-700`) | Hover on primary buttons. |
| `--accent-hover` | Accent Hover | `#643EA6` (`--periwinkle-700`) | Hover on clickable accent elements. |
| `--accent-pressed` | Accent Pressed | `#492E7A` (`--periwinkle-800`) | Pressed / active accent elements. |
| `--on-accent` | Text on Accent | `#FFFFFF` (~5.3:1) | Labels and icons on solid periwinkle. |
| `--on-accent-surface` | Translucent White | `color-mix(in srgb, #FFF 18%, transparent)` | Highlight sheen on active accent surfaces. |
| `--accent-muted` | Soft Accent Fill | `color-mix(in srgb, #8050D4 10%, transparent)` | Accent chips, badge tints. |
| `--accent-border` | Accent Outline | `color-mix(in srgb, #8050D4 24%, transparent)` | Selected card borders, active halos. |
| `--accent-focus` | Focus Halo | `color-mix(in srgb, #8050D4 40%, transparent)` | Keyboard focus rings. |
| `--btn-primary-disabled-bg` | Disabled Button Fill | `#E5E5EA` (`var(--bg-component)`) | Disabled primary buttons. |
| `--btn-primary-disabled-text` | Disabled Button Label | `#86868B` (`var(--text-tertiary)`) | Disabled button text. |

---

## 5. Interactive Elements & Controls

| CSS Variable | Value | Apple Equivalent | Where Used |
| :--- | :--- | :--- | :--- |
| `--bg-item-surface` | `#E5E5EA` | `systemGray5` | List row / sidebar item hover. |
| `--bg-item-active` | `color-mix(in srgb, #8050D4 12%, transparent)` | selection tint | Selected list row, active nav item. |
| `--bg-row-hover` | `#DEDEE3` | between `systemGray5` and `systemGray4` | Full-width row hover on canvas. |
| `--badge-beta-bg` | `#FFCC00` | `systemYellow` | Beta badge fill. |
| `--badge-beta-fg` | `#1C1C1E` | label (dark) | Beta badge text. |
| `--bg-toggle-switch` | `#D1D1D6` | `systemGray4` | Toggle track when OFF. |

---

## 6. Structural Borders, Dividers & Shadows

| CSS Variable | Value | Where Used |
| :--- | :--- | :--- |
| `--border-subtle` | `rgba(60, 60, 67, 0.12)` | Card perimeters, section dividers, list separators. |
| `--border-muted` | `rgba(60, 60, 67, 0.18)` | Input borders, table header dividers, window edge. |
| `--shadow-card` | `0 1px 2px rgba(0,0,0,.04), 0 2px 8px rgba(0,0,0,.04)` | Cards resting on canvas. |
| `--shadow-popover` | `0 8px 24px rgba(0,0,0,.12), 0 2px 6px rgba(0,0,0,.06)` | Menus, dropdowns, dialogs, overlay window. |

Rule: list separators inside cards are inset to start at the text column, not the card edge (as in iOS Settings).

---

## 7. Meeting Notes & Question/Answer Bubbles

| Token / Selector | Value | Where Used |
| :--- | :--- | :--- |
| `--bubble-user-bg` | `#8050D4` | User question bubble. |
| `--bubble-user-fg` | `#FFFFFF` | User bubble text. |
| `--bubble-user-grad-to` | `#764AC3` | Bottom gradient stop of user bubble. |
| `--bubble-user-glow` | `rgba(128, 80, 212, 0.28)` | Ambient shadow around user bubble. |
| `--ai-response-text` | `#1D1D1F` | Body and headings inside AI answer cards. |
| `--ai-response-link` | `#0066CC` (~5.4:1) | Links inside AI responses (Apple link blue). |
| `--mn-skel-strong` | `rgba(60, 60, 67, 0.14)` | Skeleton for headings and titles. |
| `--mn-skel-base` | `rgba(60, 60, 67, 0.09)` | Skeleton for body and bullet lines. |
| `--mn-skel-soft` | `rgba(60, 60, 67, 0.06)` | Skeleton for follow-up draft prose. |

---

## 8. In-Meeting Floating Overlay UI (Apple Thick Material)

| CSS Variable | Value | Where Used |
| :--- | :--- | :--- |
| `--overlay-bg` | `rgba(242, 242, 247, 0.82)` | Overlay shell backdrop (pair with `backdrop-filter: blur(30px) saturate(180%)`). |
| `--overlay-border` | `rgba(60, 60, 67, 0.14)` | Overlay window border. |
| `--overlay-undetectable-ring` | `rgba(0, 0, 0, 0.42)` | Undetectable mode indicator ring. |
| `--overlay-pill-bg` | `rgba(251, 251, 253, 0.55)` | Floating control pills and toolbars. |
| `--overlay-input-bg` | `rgba(251, 251, 253, 0.60)` | Overlay input fields. |
| `--overlay-input-focus-bg` | `rgba(251, 251, 253, 0.92)` | Focused overlay input. |
| `--overlay-control-bg` | `rgba(118, 118, 128, 0.12)` | Overlay buttons and toggles (Apple `tertiarySystemFill`). |
| `--overlay-text-primary` | `rgba(29, 29, 31, 0.96)` | Transcript and answer text. |
| `--overlay-text-secondary` | `rgba(110, 110, 115, 0.95)` | Speaker labels, subtitles. |
| `--overlay-text-muted` | `rgba(134, 134, 139, 0.95)` | Timestamps, status hints. |
| `--hotword-color` | `#6D5AC7` (~5.1:1) | Teleprompter hotword highlight. |

---

## 9. Liquid Glass UI Material System

| Component / Variant | Token | Value | Notes |
| :--- | :--- | :--- | :--- |
| **GlassSurface** | `--glass-fill` | `hsl(240 20% 97% / var(--glass-frost))` | Cool neutral frost, matches canvas hue. |
| | `--glass-rim` | `0 0 2px 1px color-mix(in oklch, black, transparent 88%) inset` | Inset specular hairline rim. |
| | `--glass-drop` | `0 4px 16px rgba(0,0,0,.05), 0 8px 24px rgba(0,0,0,.05)` | Layered soft elevation. |
| **LiquidGlassButton (`lg-clear`)** | `--lg-clear-bg` | `rgba(118, 118, 128, 0.10)` | Apple fill tint over light panel. |
| | `--lg-clear-hover` | `rgba(118, 118, 128, 0.16)` | Darkens under cursor. |
| | `--lg-clear-lens` | `rgba(118, 118, 128, 0.08)` | Refraction lens under cursor. |
| | `--lg-clear-underside` | `inset 0 -1px 0 rgba(60, 60, 67, 0.08)` | Bottom edge anchor. |
| **LiquidGlassButton (`lg-action`)** | box shadow | unchanged from current implementation | Contact shadow reads correctly on `#FBFBFD`. |

---

## 10. Usage Rules

1. Never place large areas of `#FBFBFD` edge to edge. Cards are islands on the `#F2F2F7` canvas with visible canvas gaps between them.
2. Only one solid periwinkle primary button per view. Secondary actions use `--bg-component`.
3. Hover darkens toward `systemGray5`; selection tints toward periwinkle. Never use blue for selection.
4. All borders and fills use the Apple gray hue (`60,60,67` or `118,118,128`), never pure black alpha, so lines stay crisp without looking harsh.
5. Status yellow, danger red and link blue are Apple system values; do not substitute Tailwind equivalents.
