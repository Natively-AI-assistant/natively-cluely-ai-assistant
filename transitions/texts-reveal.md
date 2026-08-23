# Texts reveal

## When to use

A headline + supporting line that rise into view with staggered blur — hero copy, empty states, onboarding steps. Exit is decoupled: a single quiet fade with no Y-return so dismissing doesn't replay the reveal in reverse.

## HTML usage

```html
<div class="t-stagger">
  <strong class="t-stagger-line t-stagger-line--1">…</strong>
  <span class="t-stagger-line t-stagger-line--2">…</span>
</div>
```

State:
  - Add `.is-shown` to play the staggered entrance.
  - Add `.is-hiding` (and remove `.is-shown`) to fade
    out in place over a short 200ms — independent of the
    entrance timing so the exit doesn't replay the stagger.

Add more lines by adding `.t-stagger-line--N` with
`transition-delay: calc(var(--stagger-stagger) * (N - 1))`.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--stagger-dur` | `500ms` | sourced from `--p18-dur` |
| `--stagger-distance` | `12px` | sourced from `--p18-distance` |
| `--stagger-stagger` | `40ms` | sourced from `--p18-stagger` |
| `--stagger-blur` | `3px` | sourced from `--p18-blur` |
| `--stagger-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p18-ease` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --stagger-dur: 500ms;
  --stagger-distance: 12px;
  --stagger-stagger: 40ms;
  --stagger-blur: 3px;
  --stagger-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
```

## CSS

```css
/* Lines start translated down + blurred + invisible; .is-shown
   on the parent flips them to their resting state. The second
   line's transition-delay holds it back by --stagger-stagger
   so the eye lands on the headline first. */
.t-stagger-line {
  display: block;
  opacity: 0;
  transform: translateY(var(--stagger-distance));
  filter: blur(var(--stagger-blur));
  transition:
    opacity   var(--stagger-dur) var(--stagger-ease),
    transform var(--stagger-dur) var(--stagger-ease),
    filter    var(--stagger-dur) var(--stagger-ease);
  will-change: transform, opacity, filter;
}
.t-stagger-line--2 { transition-delay: var(--stagger-stagger); }

.t-stagger.is-shown .t-stagger-line {
  opacity: 1;
  transform: translateY(0);
  filter: blur(0);
}
/* Exit decouples from the stagger: same fade for every line,
   no Y return, no blur — so the disappearance reads as a
   single quiet fade instead of a reverse reveal. */
.t-stagger.is-hiding .t-stagger-line {
  opacity: 0;
  transform: translateY(0);
  filter: blur(0);
  transition:
    opacity 200ms ease,
    transform 0s linear,
    filter 0s linear;
  transition-delay: 0s;
}

@media (prefers-reduced-motion: reduce) {
  .t-stagger-line { transition: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

```js
const block = document.querySelector(".t-stagger");

function showText() {
  block.classList.remove("is-hiding");
  block.classList.remove("is-shown");
  void block.offsetHeight;
  block.classList.add("is-shown");
}
function hideText() {
  block.classList.add("is-hiding");
  block.classList.remove("is-shown");
  setTimeout(() => block.classList.remove("is-hiding"), 200);
}
```

