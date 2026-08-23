# Learn more hover

## When to use

"Learn more", "See all", "Continue" — inline links or buttons with a trailing chevron that should acknowledge hover. The chevron slides toward the text's reading direction while its two arms spread apart into a full arrow, then eases back on exit with a slightly faster out clock.

A hover-only affordance: keyboard focus and touch fall back to the resting state, so nothing essential is communicated by the motion alone.

## HTML usage

```html
<button class="t-learn">Learn more
  <span class="t-learn-chevron"><svg>
    <path class="t-learn-arm t-learn-arm-top" d="M6 4L10 8"/>
    <path class="t-learn-arm t-learn-arm-bot" d="M10 8L6 12"/>
  </svg></span>
</button>
```

On hover the chevron shifts right and its two arms rotate
apart about the apex (10, 8) so the angle opens; hover-out
returns. Pure CSS.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--learn-shift` | `2px` | sourced from `--p24-shift` |
| `--learn-spread` | `8deg` | sourced from `--p24-spread` |
| `--learn-in` | `350ms` | sourced from `--p24-in-dur` |
| `--learn-out` | `350ms` | sourced from `--p24-out-dur` |
| `--learn-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p24-ease` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --learn-shift: 2px;
  --learn-spread: 8deg;
  --learn-in: 350ms;
  --learn-out: 350ms;
  --learn-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
```

## CSS

```css
.t-learn-chevron {
  display: inline-flex;
  transform: translateX(0);
  transition: transform var(--learn-out) var(--learn-ease);
}
.t-learn-arm {
  transform-box: view-box;
  transform-origin: 10px 8px;
  vector-effect: non-scaling-stroke;
  transition: transform var(--learn-out) var(--learn-ease);
}
.t-learn:hover .t-learn-chevron { transform: translateX(var(--learn-shift)); transition-duration: var(--learn-in); }
.t-learn:hover .t-learn-arm { transition-duration: var(--learn-in); }
.t-learn:hover .t-learn-arm-top { transform: rotate(var(--learn-spread)); }
.t-learn:hover .t-learn-arm-bot { transform: rotate(calc(var(--learn-spread) * -1)); }

@media (prefers-reduced-motion: reduce) {
  .t-learn-chevron, .t-learn-arm { transition: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

None — pure CSS. Toggle the documented HTML attributes or class names from whatever already drives state in your app.

