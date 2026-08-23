# Page side-by-side

## When to use

Sliding between two full pages or screens that live side-by-side: list ↔ detail, step 1 ↔ step 2 in a wizard. Page 1 exits left, page 2 exits right.

## HTML usage

```html
<div class="t-page-slide" data-page="1">
  <section class="t-page" data-page-id="1">…</section>
  <section class="t-page" data-page-id="2">…</section>
</div>
```

State: set data-page="1" or "2" on .t-page-slide.
Page 1 exits to the left, page 2 exits to the right.
--page-exit-enabled (0/1) disables the outgoing slide.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--page-slide-dur` | `250ms` | sourced from `--p8-slide-dur` |
| `--page-fade-dur` | `250ms` | sourced from `--p8-fade-dur` |
| `--page-slide-distance` | `8px` | sourced from `--p8-distance` |
| `--page-blur` | `3px` | sourced from `--p8-blur` |
| `--page-stagger` | `0ms` | sourced from `--p8-stagger` |
| `--page-exit-enabled` | `1` | sourced from `--p8-exit-enabled` |
| `--page-slide-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p8-slide-ease` |
| `--page-fade-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p8-fade-ease` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --page-slide-dur: 250ms;
  --page-fade-dur: 250ms;
  --page-slide-distance: 8px;
  --page-blur: 3px;
  --page-stagger: 0ms;
  --page-exit-enabled: 1;
  --page-slide-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --page-fade-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
```

## CSS

```css
.t-page-slide {
  position: relative;
}
.t-page-slide .t-page[data-page-id="1"] {
  --t-page-from-x: calc(var(--page-slide-distance) * -1);
}
.t-page-slide .t-page[data-page-id="2"] {
  --t-page-from-x: var(--page-slide-distance);
}
.t-page-slide .t-page {
  position: absolute;
  inset: 0;
  opacity: 0;
  pointer-events: none;
  transform: translateX(calc(var(--t-page-from-x, 0px) * var(--page-exit-enabled)));
  filter: blur(calc(var(--page-blur) * var(--page-exit-enabled)));
  transition:
    opacity   var(--page-fade-dur)  var(--page-fade-ease),
    transform var(--page-slide-dur) var(--page-slide-ease),
    filter    var(--page-slide-dur) var(--page-slide-ease);
  will-change: opacity, transform, filter;
}
.t-page-slide[data-page="1"] .t-page[data-page-id="1"],
.t-page-slide[data-page="2"] .t-page[data-page-id="2"] {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(0);
  filter: blur(0);
  transition-delay: var(--page-stagger);
}

@media (prefers-reduced-motion: reduce) {
  .t-page-slide .t-page { transition: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

```js
// Flip data-page on the container — the CSS handles the rest.
// Set --page-exit-enabled: 0 on the container if you want pages to
// fade without sliding (useful on first paint).
const slider = document.querySelector(".t-page-slide");
function showPage(n) {
  slider.setAttribute("data-page", String(n));
}
```

