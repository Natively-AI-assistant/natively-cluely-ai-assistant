# Toast open / close

## When to use

Toasts, snackbars, and transient confirmations that rise into view from the bottom edge — "Saved", "Copied", "Message sent". The toast translates up with a fade, a slight scale, and a cross-blur; opening runs on the slower open clock while dismissing uses the faster close clock, so arriving feels deliberate and leaving feels snappy.

Use **toast** when the surface announces itself and goes away on its own; use **modal** when the user must respond before continuing.

## HTML usage

```html
<div class="t-toast" data-open="false"> … </div>
```

Toggle `.is-open` on the toast. It rises from below with a
fade + cross-blur + slight scale; opening uses the slower
open clock, the resting (closed) transition uses the faster
close clock, so a single class gives the open/close asymmetry.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--toast-open` | `350ms` | sourced from `--p22-open-dur` |
| `--toast-close` | `250ms` | sourced from `--p22-close-dur` |
| `--toast-distance` | `16px` | sourced from `--p22-distance` |
| `--toast-blur` | `2px` | sourced from `--p22-blur` |
| `--toast-scale` | `0.97` | sourced from `--p22-scale` |
| `--toast-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p22-ease` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --toast-open: 350ms;
  --toast-close: 250ms;
  --toast-distance: 16px;
  --toast-blur: 2px;
  --toast-scale: 0.97;
  --toast-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
```

## CSS

```css
.t-toast {
  opacity: 0;
  transform: translateY(var(--toast-distance)) scale(var(--toast-scale));
  filter: blur(var(--toast-blur));
  will-change: transform, opacity, filter;
  transition:
    opacity var(--toast-close) var(--toast-ease),
    transform var(--toast-close) var(--toast-ease),
    filter var(--toast-close) var(--toast-ease);
}
.t-toast.is-open {
  opacity: 1;
  transform: translateY(0) scale(1);
  filter: blur(0);
  transition:
    opacity var(--toast-open) var(--toast-ease),
    transform var(--toast-open) var(--toast-ease),
    filter var(--toast-open) var(--toast-ease);
}

@media (prefers-reduced-motion: reduce) {
  .t-toast { transition: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

None — pure CSS. Toggle the documented HTML attributes or class names from whatever already drives state in your app.

