# Checkbox check

## When to use

Checkboxes, to-do completion, multi-select rows — any boolean control where the checked state should feel earned. The box's background fills first, then the checkmark draws itself via stroke-dashoffset after a short delay; unchecking reverses quickly with no draw.

Toggle `aria-checked` on the control. Like **success check**, the draw needs `stroke-dasharray` calibrated to your actual path length (`path.getTotalLength()`).

## HTML usage

```html
<button class="t-check" role="checkbox" aria-checked="false">
  <svg viewBox="0 0 10.1668 10.1668">
    <path d="M1 5.52L3.92 9.17L9.17 1"/>
  </svg>
</button>
```

Toggle `aria-checked`. The box fills, then the check stroke
draws in via stroke-dashoffset. Set --check-len to the path's
getTotalLength() (rounded up) so it never over/under-draws;
transitioning offset lets a mid-draw uncheck reverse cleanly.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--check-box` | `150ms` | sourced from `--p25-box-dur` |
| `--check-draw` | `350ms` | sourced from `--p25-draw-dur` |
| `--check-delay` | `0ms` | sourced from `--p25-draw-delay` |
| `--check-uncheck` | `150ms` | sourced from `--p25-uncheck-dur` |
| `--check-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p25-ease` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --check-box: 150ms;
  --check-draw: 350ms;
  --check-delay: 0ms;
  --check-uncheck: 150ms;
  --check-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
```

## CSS

```css
.t-check {
  transition:
    background var(--check-box) var(--check-ease),
    box-shadow var(--check-box) var(--check-ease);
}
.t-check svg path {
  stroke-dasharray: var(--check-len, 15);
  stroke-dashoffset: var(--check-len, 15);
  transition: stroke-dashoffset var(--check-uncheck) var(--check-ease);
}
.t-check[aria-checked="true"] svg path {
  stroke-dashoffset: 0;
  transition: stroke-dashoffset var(--check-draw) var(--check-ease) var(--check-delay);
}

@media (prefers-reduced-motion: reduce) {
  .t-check, .t-check svg path { transition: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

None — pure CSS. Toggle the documented HTML attributes or class names from whatever already drives state in your app.

