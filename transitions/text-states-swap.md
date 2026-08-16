# Text states swap

## When to use

Swapping the text of a status indicator in place — "Processing…" → "Done", "Save" → "Saved". The old text exits up with blur, the new text enters from below.

## HTML usage

```html
<span class="t-text-swap">Processing…</span>
```

Driven by JS (three-phase sequence):
  1. Add `.is-exit`  -> old text slides up + blurs + fades.
  2. After --text-swap-dur: change textContent, then add
     `.is-enter-start` (jumps to below, no transition).
  3. Force reflow, remove `.is-enter-start` so the new text
     animates back to 0 with the default transition.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--text-swap-dur` | `150ms` | sourced from `--p6-dur` |
| `--text-swap-translate-y` | `4px` | sourced from `--p6-translate-y` |
| `--text-swap-blur` | `2px` | sourced from `--p6-blur` |
| `--text-swap-ease` | `ease-in-out` | sourced from `--p6-ease` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --text-swap-dur: 150ms;
  --text-swap-translate-y: 4px;
  --text-swap-blur: 2px;
  --text-swap-ease: ease-in-out;
}
```

## CSS

```css
.t-text-swap {
  display: inline-block;
  transform: translateY(0);
  filter: blur(0);
  opacity: 1;
  transition:
    transform var(--text-swap-dur) var(--text-swap-ease),
    filter    var(--text-swap-dur) var(--text-swap-ease),
    opacity   var(--text-swap-dur) var(--text-swap-ease);
  will-change: transform, filter, opacity;
}
.t-text-swap.is-exit {
  transform: translateY(calc(var(--text-swap-translate-y) * -1));
  filter: blur(var(--text-swap-blur));
  opacity: 0;
}
.t-text-swap.is-enter-start {
  transform: translateY(var(--text-swap-translate-y));
  filter: blur(var(--text-swap-blur));
  opacity: 0;
  transition: none;
}

@media (prefers-reduced-motion: reduce) {
  .t-text-swap { transition: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

```js
// Three-phase text swap:
//   1. Add .is-exit              — old text exits up with blur.
//   2. After --text-swap-dur, swap textContent and add .is-enter-start
//      (jumps to "below, no transition"), force a reflow.
//   3. Remove .is-enter-start    — new text animates back to rest.
const el = document.querySelector(".t-text-swap");
const dur = parseFloat(
  getComputedStyle(document.documentElement).getPropertyValue("--text-swap-dur")
) || 200;

function swapText(next) {
  el.classList.add("is-exit");
  setTimeout(() => {
    el.textContent = next;
    el.classList.remove("is-exit");
    el.classList.add("is-enter-start");
    void el.offsetHeight; // force reflow so the next change transitions
    el.classList.remove("is-enter-start");
  }, dur);
}
```

