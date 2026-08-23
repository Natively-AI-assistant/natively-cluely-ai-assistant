# Number pop-in

## When to use

Counters, prices, balances, or any number that updates and should re-enter from a direction with blur. Each character animates independently and the last two digits stagger so decimals feel alive without looking chaotic.

## HTML usage

```html
<span class="t-digit-group is-animating">
  <span class="t-digit">1</span>
  <span class="t-digit">2</span>
  <span class="t-digit" data-stagger="1">.</span>
  <span class="t-digit" data-stagger="2">3</span>
</span>
```

Replay:
  - Remove `.is-animating`, re-render digits (or swap text),
    force a reflow, then re-add `.is-animating`.
  - Use data-stagger="1", "2", … to delay individual
    digits by `n * var(--digit-stagger)`.

Direction:
  --digit-dir-x / --digit-dir-y are unit-less multipliers
  (e.g. 1, -1, 0) applied to --digit-distance.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--digit-dur` | `500ms` | sourced from `--p9-dur` |
| `--digit-distance` | `8px` | sourced from `--p9-distance` |
| `--digit-stagger` | `70ms` | sourced from `--p9-stagger` |
| `--digit-blur` | `2px` | sourced from `--p9-blur` |
| `--digit-ease` | `cubic-bezier(0.34, 1.45, 0.64, 1)` | sourced from `--p9-ease` |
| `--digit-dir-x` | `0` | sourced from `--p9-dir-x` |
| `--digit-dir-y` | `1` | sourced from `--p9-dir-y` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --digit-dur: 500ms;
  --digit-distance: 8px;
  --digit-stagger: 70ms;
  --digit-blur: 2px;
  --digit-ease: cubic-bezier(0.34, 1.45, 0.64, 1);
  --digit-dir-x: 0;
  --digit-dir-y: 1;
}
```

## CSS

```css
@keyframes t-digit-pop-in {
  0%   {
    transform: translate(
      calc(var(--digit-distance) * var(--digit-dir-x)),
      calc(var(--digit-distance) * var(--digit-dir-y))
    );
    opacity: 0;
    filter: blur(var(--digit-blur));
  }
  100% { transform: translate(0, 0); opacity: 1; filter: blur(0); }
}

.t-digit-group {
  display: inline-flex;
  align-items: baseline;
}
.t-digit {
  display: inline-block;
  will-change: transform, opacity, filter;
}
.t-digit-group.is-animating .t-digit {
  animation: t-digit-pop-in var(--digit-dur) var(--digit-ease) both;
}
.t-digit-group.is-animating .t-digit[data-stagger="1"] {
  animation-delay: var(--digit-stagger);
}
.t-digit-group.is-animating .t-digit[data-stagger="2"] {
  animation-delay: calc(var(--digit-stagger) * 2);
}

@media (prefers-reduced-motion: reduce) {
  .t-digit-group .t-digit { animation: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

```js
// Replay the digit pop-in: remove .is-animating, swap the digit spans,
// force a reflow, then re-add .is-animating. Mark the last two digits
// with data-stagger="1" / "2" so they ride in 1× / 2× --digit-stagger
// behind the leading digits.
const group = document.querySelector(".t-digit-group");

function setDigits(str) {
  group.classList.remove("is-animating");
  group.replaceChildren();
  const chars = str.split("");
  chars.forEach((ch, i) => {
    const span = document.createElement("span");
    span.className = "t-digit";
    span.textContent = ch;
    if (i === chars.length - 2) span.dataset.stagger = "1";
    else if (i === chars.length - 1) span.dataset.stagger = "2";
    group.appendChild(span);
  });
  void group.offsetHeight; // force reflow
  group.classList.add("is-animating");
}
```

