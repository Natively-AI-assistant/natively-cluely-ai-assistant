# Tooltip open/close

## When to use

A hover/focus tooltip that fades + scales in with a short appear-delay but disappears immediately on leave. Pure CSS — the wrap (not the trigger) is the hover target so the pointer can drift onto the tooltip without flicker.

## HTML usage

```html
<span class="t-tt-wrap">
  <button class="t-tt-trigger" aria-describedby="tt-1">…</button>
  <span class="t-tt" id="tt-1" role="tooltip">Tooltip text</span>
</span>
```

Pure CSS — no JS. The wrap (not the trigger) is the hover
target so the pointer can drift onto the tooltip without
flicker. transition-delay only applies in the hover/focus
rule, so leaving snaps it to 0 and the disappear plays
immediately. Trigger styling is yours; only the tooltip
positioning + its transition live here.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--tt-in-dur` | `150ms` | sourced from `--p17-in-dur` |
| `--tt-out-dur` | `50ms` | sourced from `--p17-out-dur` |
| `--tt-scale` | `0.98` | sourced from `--p17-scale-from` |
| `--tt-delay` | `80ms` | sourced from `--p17-delay` |
| `--tt-in-ease` | `ease-out` | sourced from `--p17-in-ease` |
| `--tt-out-ease` | `ease-out` | sourced from `--p17-out-ease` |
| `--tt-bg` | `#ffffff` | sourced from `--p17-bg` |
| `--tt-fg` | `#2f2f2f` | sourced from `--p17-fg` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --tt-in-dur: 150ms;
  --tt-out-dur: 50ms;
  --tt-scale: 0.98;
  --tt-delay: 80ms;
  --tt-in-ease: ease-out;
  --tt-out-ease: ease-out;
  --tt-bg: #ffffff;
  --tt-fg: #2f2f2f;
}
```

## CSS

```css
.t-tt-wrap {
  position: relative;
  display: inline-block;
}
.t-tt {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translate(-50%, 0) scale(var(--tt-scale));
  transform-origin: 50% 100%;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--tt-bg);
  color: var(--tt-fg);
  white-space: nowrap;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.06),
    0 2px 6px 0 rgba(0, 0, 0, 0.05),
    0 4px 42px 0 rgba(0, 0, 0, 0.06);
  opacity: 0;
  pointer-events: none;
  /* Default rule controls the LEAVE state. transition-delay
     stays unset so leaving plays without delay. */
  transition:
    opacity   var(--tt-out-dur) var(--tt-out-ease),
    transform var(--tt-out-dur) var(--tt-out-ease);
}
/* The 50ms delay belongs ONLY to the hover rule so leaving
   the trigger snaps the delay back to 0 and the disappear
   plays immediately. */
.t-tt-wrap:hover .t-tt,
.t-tt-trigger:focus-visible + .t-tt {
  opacity: 1;
  transform: translate(-50%, 0) scale(1);
  transition-duration: var(--tt-in-dur);
  transition-timing-function: var(--tt-in-ease);
  transition-delay: var(--tt-delay);
}

@media (prefers-reduced-motion: reduce) {
  .t-tt { transition: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

None — pure CSS. Toggle the documented HTML attributes or class names from whatever already drives state in your app.

