# Modal open / close

## When to use

Modal dialogs and full-overlay surfaces that scale up from center. Use when the surface is conceptually "on top of" the page rather than anchored to a trigger.

## HTML usage

```html
<div class="t-modal" role="dialog">…</div>
```

State:
  - Add `.is-open` to open (scales up from --modal-scale).
  - On close, swap `.is-open` for `.is-closing`, then remove
    `.is-closing` after --modal-close-dur.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--modal-open-dur` | `250ms` | sourced from `--p7-open-dur` |
| `--modal-close-dur` | `150ms` | sourced from `--p7-close-dur` |
| `--modal-scale` | `0.96` | sourced from `--p7-scale` |
| `--modal-scale-close` | `0.96` | sourced from `--p7-scale-close` |
| `--modal-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p7-ease` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --modal-open-dur: 250ms;
  --modal-close-dur: 150ms;
  --modal-scale: 0.96;
  --modal-scale-close: 0.96;
  --modal-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
```

## CSS

```css
.t-modal {
  transform-origin: center;
  transform: scale(var(--modal-scale));
  opacity: 0;
  pointer-events: none;
  transition:
    transform var(--modal-open-dur) var(--modal-ease),
    opacity   var(--modal-open-dur) var(--modal-ease);
  will-change: transform, opacity;
}
.t-modal.is-open {
  transform: scale(1);
  opacity: 1;
  pointer-events: auto;
}
.t-modal.is-closing {
  transform: scale(var(--modal-scale-close));
  opacity: 0;
  pointer-events: none;
  transition:
    transform var(--modal-close-dur) var(--modal-ease),
    opacity   var(--modal-close-dur) var(--modal-ease);
}

@media (prefers-reduced-motion: reduce) {
  .t-modal { transition: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

```js
// Same close-then-cleanup pattern as the dropdown — modals scale from
// --modal-scale up to 1, then on close dip to --modal-scale-close.
const modal = document.querySelector(".t-modal");
const closeMs = parseFloat(
  getComputedStyle(document.documentElement).getPropertyValue("--modal-close-dur")
) || 150;

function openModal() {
  modal.classList.remove("is-closing");
  modal.classList.add("is-open");
}
function closeModal() {
  modal.classList.remove("is-open");
  modal.classList.add("is-closing");
  setTimeout(() => modal.classList.remove("is-closing"), closeMs);
}
```

