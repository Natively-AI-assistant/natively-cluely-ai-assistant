# Skeleton loader and reveal

## When to use

A placeholder that loads then reveals real content — list rows, cards, profile headers. The skeleton pulses, then both layers cross-fade with a matching cross-blur. Bring your own bars / avatar / text; the skeleton stays in the same slot as the content so the swap is layout-free.

## HTML usage

```html
<div class="t-skel" data-state="loading">
  <div class="t-skel-skeleton is-pulsing">…</div>
  <div class="t-skel-content">…</div>
</div>
```

State:
  - Mount with `.is-pulsing` on the skeleton so it pulses
    --pulse-count times.
  - When data arrives, add `.is-revealed` to .t-skel — the
    skeleton fades out + blurs and the content fades in +
    un-blurs over --reveal-dur.
  - To replay the loading state without animating the
    reverse: add `.is-resetting` to .t-skel, remove
    `.is-revealed`, force a reflow, then drop `.is-resetting`.

Bring your own avatar / text / wrapping. The skeleton stays
in the same flex slot as the content so the swap is
layout-free.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--pulse-dur` | `1000ms` | sourced from `--p14-pulse-dur` |
| `--pulse-count` | `1` | sourced from `--p14-pulse-count` |
| `--pulse-min` | `0.5` | sourced from `--p14-pulse-min` |
| `--reveal-dur` | `400ms` | sourced from `--p14-reveal-dur` |
| `--reveal-blur` | `2px` | sourced from `--p14-reveal-blur` |
| `--reveal-ease` | `ease-in-out` | sourced from `--p14-reveal-ease` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --pulse-dur: 1000ms;
  --pulse-count: 1;
  --pulse-min: 0.5;
  --reveal-dur: 400ms;
  --reveal-blur: 2px;
  --reveal-ease: ease-in-out;
}
```

## CSS

```css
/* The wrap stacks two layers on the same coordinates. The
   skeleton owns the cold pulse + the fade-out side of the
   reveal; the content owns the fade-in side. They share the
   same duration / ease so the swap reads as one motion. */
.t-skel { position: relative; }
.t-skel-skeleton,
.t-skel-content {
  position: absolute;
  inset: 0;
}

.t-skel-skeleton {
  z-index: 1;
  opacity: 1;
  filter: blur(0);
  transition:
    opacity var(--reveal-dur) var(--reveal-ease),
    filter  var(--reveal-dur) var(--reveal-ease);
}
.t-skel-content {
  z-index: 2;
  opacity: 0;
  filter: blur(var(--reveal-blur));
  transition:
    opacity var(--reveal-dur) var(--reveal-ease),
    filter  var(--reveal-dur) var(--reveal-ease);
}
.t-skel.is-revealed .t-skel-skeleton {
  opacity: 0;
  filter: blur(var(--reveal-blur));
}
.t-skel.is-revealed .t-skel-content {
  opacity: 1;
  filter: blur(0);
}
/* Snap-back when replaying: kill transitions so the reverse
   (revealed → skeleton) is instant. Drop `.is-resetting`
   after a forced reflow and the next reveal animates again. */
.t-skel.is-resetting .t-skel-skeleton,
.t-skel.is-resetting .t-skel-content {
  transition: none !important;
}

/* Pulse: place the animation on the bar/avatar children, not
   on the skeleton itself, so the skeleton's opacity / filter
   stay free for the cross-fade transition above. */
.t-skel-skeleton.is-pulsing > * {
  animation: t-skel-pulse var(--pulse-dur) ease-in-out var(--pulse-count);
}
@keyframes t-skel-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: var(--pulse-min); }
}

@media (prefers-reduced-motion: reduce) {
  .t-skel-skeleton, .t-skel-content {
    transition: none !important;
  }
  .t-skel-skeleton.is-pulsing > * { animation: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

```js
const skel = document.querySelector(".t-skel");
const skeleton = skel.querySelector(".t-skel-skeleton");
const cs = getComputedStyle(document.documentElement);
const num = (name, fb) => {
  const v = parseFloat(cs.getPropertyValue(name));
  return Number.isFinite(v) ? v : fb;
};

// Call when async data arrives:
function reveal() {
  skel.classList.add("is-revealed");
}

// Demo replay: snap back, pulse, then reveal.
function replay() {
  skel.classList.add("is-resetting");
  skel.classList.remove("is-revealed");
  skeleton.classList.remove("is-pulsing");
  void skeleton.offsetWidth;
  skel.classList.remove("is-resetting");
  skeleton.classList.add("is-pulsing");
  const total = num("--pulse-dur", 1000) * num("--pulse-count", 1);
  setTimeout(() => skel.classList.add("is-revealed"), total);
}
```

