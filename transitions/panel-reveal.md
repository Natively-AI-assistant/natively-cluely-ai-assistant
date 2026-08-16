# Panel reveal

## When to use

A panel that slides into view inside an existing container — e.g. detail panel inside a card, expanding section. Combines a short translate, opacity, and a 2px cross-blur so a half-height travel still reads as a full open.

## HTML usage

```html
<div class="t-panel-slide" data-open="false">
  <!-- your panel contents -->
</div>
```

The panel slides on the Y axis, fades opacity 0 ↔ 1,
and cross-blurs --panel-blur ↔ 0, all on the same
duration / ease so a shorter travel (e.g. 50% of the
panel height) still reads as a full open / close.
Wrap it in your own container with `overflow: hidden`
if you want the closed state fully clipped. Set
--panel-translate-y to the travel distance (e.g. half
the panel's own height).

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--panel-open-dur` | `400ms` | sourced from `--p3-open-dur` |
| `--panel-close-dur` | `350ms` | sourced from `--p3-close-dur` |
| `--panel-translate-y` | `100px` | sourced from `--p3-translate-y` |
| `--panel-blur` | `2px` | sourced from `--p3-blur` |
| `--panel-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p3-ease` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --panel-open-dur: 400ms;
  --panel-close-dur: 350ms;
  --panel-translate-y: 100px;
  --panel-blur: 2px;
  --panel-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
```

## CSS

```css
.t-panel-slide {
  transform: translateY(var(--panel-translate-y));
  opacity: 0;
  filter: blur(var(--panel-blur));
  pointer-events: none;
  transition:
    transform var(--panel-close-dur) var(--panel-ease),
    opacity   var(--panel-close-dur) var(--panel-ease),
    filter    var(--panel-close-dur) var(--panel-ease);
  will-change: transform, opacity, filter;
}
.t-panel-slide[data-open="true"] {
  transform: translateY(0);
  opacity: 1;
  filter: blur(0);
  pointer-events: auto;
  transition:
    transform var(--panel-open-dur) var(--panel-ease),
    opacity   var(--panel-open-dur) var(--panel-ease),
    filter    var(--panel-open-dur) var(--panel-ease);
}

@media (prefers-reduced-motion: reduce) {
  .t-panel-slide { transition: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

None — pure CSS. Toggle the documented HTML attributes or class names from whatever already drives state in your app.

