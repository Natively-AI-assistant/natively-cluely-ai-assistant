# Card resize

## When to use

Tweening a container's width or height when its layout state changes (compact ↔ expanded card, collapsing panel, list row toggling extra detail). Pure CSS — no JS required beyond the class toggle that drives the size change.

## HTML usage

```html
<div class="t-resize">…</div>
```

Put `.t-resize` on any element and change its width/height
(directly, or via a state class such as `.is-small`). The
transition will tween the two sizes.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--resize-dur` | `300ms` | sourced from `--p4-dur` |
| `--resize-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p4-ease` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --resize-dur: 300ms;
  --resize-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
```

## CSS

```css
.t-resize {
  transition:
    width  var(--resize-dur) var(--resize-ease),
    height var(--resize-dur) var(--resize-ease);
  will-change: width, height;
}

@media (prefers-reduced-motion: reduce) {
  .t-resize { transition: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

None — pure CSS. Toggle the documented HTML attributes or class names from whatever already drives state in your app.

