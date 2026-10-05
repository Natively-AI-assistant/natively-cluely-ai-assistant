# Shimmer text

## When to use

A loading / "thinking" label that shimmers — streaming status, "Generating…", any in-progress copy that should feel alive without a spinner. Pure CSS: duplicate the string into `data-text` on `.t-shimmer` and tune `--shimmer-base` / `--shimmer-highlight` per theme.

## HTML usage

```html
<!-- Duplicate the visible string into data-text so the
     ::before layer can mask the gradient onto the same
     glyphs. Keep them in sync if the text changes. -->
<span class="t-shimmer" data-text="Planning next moves">
  Planning next moves
</span>
```

Pure CSS — no JS, no class toggling. Tune --shimmer-base /
--shimmer-highlight in your own theme rules so the colors
follow light / dark mode.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--shimmer-dur` | `2000ms` | sourced from `--p15-dur` |
| `--shimmer-base` | `#7c7c7c` | sourced from `--p15-base` |
| `--shimmer-highlight` | `#0d0d0d` | sourced from `--p15-highlight` |
| `--shimmer-band` | `400%` | sourced from `--p15-band` |
| `--shimmer-ease` | `linear` | sourced from `--p15-ease` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --shimmer-dur: 2000ms;
  --shimmer-base: #7c7c7c;
  --shimmer-highlight: #0d0d0d;
  --shimmer-band: 400%;
  --shimmer-ease: linear;
}
```

## CSS

```css
/* Two-layer construction:
   1. The base text renders normally in --shimmer-base.
   2. ::before duplicates it via content: attr(data-text),
      paints a transparent → highlight → transparent gradient
      onto it, and clips that gradient to the glyphs via
      background-clip: text. Animating background-position
      sweeps the band across the text. */
.t-shimmer {
  position: relative;
  display: inline-block;
  color: var(--shimmer-base);
}
.t-shimmer::before {
  content: attr(data-text);
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: linear-gradient(
    90deg,
    transparent          0%,
    transparent         40%,
    var(--shimmer-highlight) 50%,
    transparent         60%,
    transparent        100%
  );
  background-size: var(--shimmer-band) 100%;
  background-repeat: no-repeat;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  animation: t-shimmer var(--shimmer-dur) var(--shimmer-ease) infinite;
}
@keyframes t-shimmer {
  0%   { background-position: 100% 0; }
  100% { background-position: 0% 0; }
}

@media (prefers-reduced-motion: reduce) {
  .t-shimmer::before { animation: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

None — pure CSS. Toggle the documented HTML attributes or class names from whatever already drives state in your app.

