# Cluely App - Font Analysis

*Reverse-engineered from Cluely (New).app installed on device*

---

## Primary UI Fonts

| Font | Purpose | Files Found |
|------|---------|-------------|
| **Geist** (Vercel) | **Primary UI font** - headlines, body text, buttons, everything | `geist-latin-wght-normal.woff2`, `geist-latin-ext-wght-normal.woff2`, `geist-cyrillic-wght-normal.woff2` |
| **Inter** | **Fallback/secondary** - used when Geist unavailable or for specific UI elements | `inter-latin-wght-normal.woff2`, `inter-cyrillic-wght-normal.woff2`, `inter-greek-wght-normal.woff2`, `inter-vietnamese-wght-normal.woff2`, `inter-latin-ext-wght-normal.woff2` |

### CSS Font Stack
```css
font-family: "Geist Variable", "Inter Variable", system-ui, sans-serif;
```

---

## Math/Formula Fonts (KaTeX)

Cluely includes **40+ KaTeX font files** for rendering mathematical notation:

| Font Family | Variants |
|-------------|----------|
| **KaTeX_Main** | Regular, Bold, Italic, BoldItalic |
| **KaTeX_Math** | BoldItalic, Italic |
| **KaTeX_SansSerif** | Regular, Bold, Italic, BoldItalic |
| **KaTeX_Script** | Regular |
| **KaTeX_Fraktur** | Regular, Bold |
| **KaTeX_Caligraphic** | Regular, Bold |
| **KaTeX_Typewriter** | Regular |
| **KaTeX_AMS** | Regular |
| **KaTeX_Size1-4** | Regular (optical sizing) |

**Formats:** `.woff2`, `.woff`, `.ttf`

---

## Font Loading Strategy

```css
/* Variable fonts loaded via @font-face with unicode-range subsetting */
/* Geist/Inter use woff2 with wght axis for variable weight */
/* KaTeX fonts loaded on-demand for math rendering */
```

---

## Summary by Context

| Context | Font |
|---------|------|
| **App UI (all text)** | Geist Variable → Inter Variable → system-ui |
| **Math formulas** | KaTeX fonts (Main, Math, SansSerif, Script, Fraktur, Caligraphic, Typewriter, AMS) |
| **Code blocks** | System monospace (SF Mono / Menlo / Consolas) via `font-mono` Tailwind |
| **Icons** | Lucide React (SVG-based, not font) |

---

## Key Observations

1. **Geist is the defining visual character** - Vercel's custom variable font with a distinctive geometric grotesque style that gives Cluely its clean, modern aesthetic.

2. **Variable fonts** - Both Geist and Inter use variable font technology (woff2 with `wght` axis) allowing weight variations without multiple font files.

3. **Unicode-range subsetting** - Fonts are split by script (Latin, Cyrillic, Greek, Vietnamese, Latin-Extended) for efficient loading.

4. **KaTeX on-demand** - Mathematical fonts only load when math rendering is needed.

3. **No icon fonts** - Uses Lucide React (SVG components) instead of icon fonts.

---

*Generated from reverse engineering of `/Applications/Cluely (New).app` on 2026-10-03*
